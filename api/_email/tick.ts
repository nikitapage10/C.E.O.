/**
 * The email agent's minute (#263, docs/GMAIL.md, "Every minute"): a timer function on the Azure copy runs `tick` once
 * a minute.
 *
 *   1. Gmail's history since the last history id (no Claude, no cost): which messages were added to the inbox.
 *   2. Only for those new ones, the message itself, made plain and trimmed (./gmail.ts, readMessage).
 *   3. Gmail's own Promotions and Social tabs are noise by rule. Everything else Dialtone sorts on Haiku; for
 *      needs-you mail Blasto writes advice and a draft on Sonnet. Each call is priced from its usage and checked
 *      against the month's cap first (./budget.ts): past it, mail is counted, not read by a model.
 *   4. New needs-you mail pings the phone (the Desk's own Web Push pings), counts only, never 10pm to 7am Mountain.
 *   5. The sealed state is saved, and the public counts (./status.ts) written beside it.
 *
 * Two ticks never sort the same mail: the first one claims the state (busyUntil, saved against its version) and
 * a second one that finds it claimed does nothing. Nothing here logs mail content: errors are kept by kind only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { isQuiet, type PingText } from "../_desk/pings.js";
import { monthOf } from "../_world/budget.js";
import { addSpend, ADVISE_MODEL, budgetPct, canSpend, SORT_MODEL } from "./budget.js";
import { accessToken, currentHistoryId, historySince, HistoryGoneError, lastHistoryId, newInboxIds, readMessage, readMessageRaw, TokenRefusedError, type Fetcher, type OAuthClient } from "./gmail.js";
import { adviseMail, sortMail, type ClaudeCall } from "./sort.js";
import { EMAIL_STATUS_VERSION, type EmailStatus } from "./status.js";
import type { EmailStore } from "./store.js";
import { ITEM_KEEP_MS, MAX_ITEMS, MAX_PER_TICK, MAX_SEEN, type EmailItem, type EmailState } from "./types.js";

/** A tick holds the state at most this long. */
export const CLAIM_MS = 55_000;

export interface TickDeps {
  store: EmailStore;
  fetcher: Fetcher;
  /** The OAuth client (GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET), or null until both are set. */
  client: Pick<OAuthClient, "clientId" | "clientSecret"> | null;
  /** Claude, or null without CLAUDE_API_KEY (mail is then counted, not sorted). */
  claude: ClaudeCall | null;
  budget: number;
  now: number;
  /** Sends one ping to every device that turned pings on; how many took it. */
  ping: (text: PingText) => Promise<number>;
}

export type TickResult = "waiting" | "busy" | "not-connected" | "refused" | "started" | "resynced" | "checked" | "error";

const MT = "America/Denver";
/** The Mountain day of a time, "2026-10-22". */
export const mountainDay = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: MT, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** The public counts for a state: counts and states only. */
export function statusOf(state: EmailState, opts: { ready: boolean; claude: boolean; budget: number; now: number }): EmailStatus {
  const open = state.items.filter((i) => !i.done);
  const today = state.day.day === mountainDay(opts.now);
  const paused = !canSpend(state, SORT_MODEL, opts.budget, opts.now);
  const agent: EmailStatus["agent"] = !opts.ready || !opts.claude ? "waiting" : state.gmail === "connected" && state.lastError && state.lastError !== "claude" ? "error" : paused ? "paused" : "listening";
  return {
    v: EMAIL_STATUS_VERSION,
    at: Math.floor(opts.now),
    gmail: state.gmail,
    agent,
    needsYou: Math.min(9_999, open.filter((i) => i.kind === "needs-you").length),
    fyi: Math.min(9_999, open.filter((i) => i.kind === "fyi").length),
    noise: Math.min(9_999, today ? state.day.noise : 0),
    newToday: Math.min(9_999, today ? state.day.newCount : 0),
    unsorted: Math.min(9_999, state.unsorted),
    budgetPct: budgetPct(state, opts.budget, opts.now),
    lastCheck: state.lastCheck === null ? null : Math.floor(state.lastCheck),
  };
}

/** The words of a needs-you ping: a count, never a subject or a sender. Safe on a lock screen. */
export function emailPing(n: number): PingText {
  return { title: "C.E.O. Desk", body: n === 1 ? "An email needs you" : `${n} emails need you`, url: "/relay" };
}

/** Items kept: a week at most, newest first, at most MAX_ITEMS. */
export function pruneItems(items: EmailItem[], now: number): EmailItem[] {
  return items
    .filter((i) => now - i.at < ITEM_KEEP_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ITEMS);
}

async function writeStatus(deps: TickDeps, state: EmailState): Promise<void> {
  await deps.store.saveStatus(statusOf(state, { ready: deps.client !== null, claude: deps.claude !== null, budget: deps.budget, now: deps.now })).catch(() => undefined);
}

/** Sorts one new mail into an item (or null for noise), spending only what the cap allows. */
async function sortOne(deps: TickDeps, state: EmailState, raw: unknown): Promise<{ state: EmailState; item: EmailItem | null; claudeFailed: boolean }> {
  const mail = readMessage(raw);
  if (!mail) return { state, item: null, claudeFailed: false };
  let s: EmailState = { ...state, day: { ...state.day, newCount: state.day.newCount + 1 } };
  const base: EmailItem = { id: mail.id, at: mail.at, from: mail.from, subject: mail.subject, kind: "unsorted", summary: "", action: "", done: false };
  if (mail.promo) return { state: { ...s, day: { ...s.day, noise: s.day.noise + 1 } }, item: null, claudeFailed: false };
  if (!deps.claude || !canSpend(s, SORT_MODEL, deps.budget, deps.now)) {
    // Paused (or no key): counted, not read by a model.
    return { state: { ...s, unsorted: s.unsorted + 1 }, item: base, claudeFailed: false };
  }
  try {
    const { sorted, usage } = await sortMail(deps.claude, mail);
    s = addSpend(s, SORT_MODEL, usage, deps.now);
    if (!sorted) return { state: s, item: base, claudeFailed: true };
    if (sorted.kind === "noise") return { state: { ...s, day: { ...s.day, noise: s.day.noise + 1 } }, item: null, claudeFailed: false };
    const item: EmailItem = { ...base, kind: sorted.kind, summary: sorted.summary, action: sorted.action };
    if (sorted.kind !== "needs-you" || !canSpend(s, ADVISE_MODEL, deps.budget, deps.now)) return { state: s, item, claudeFailed: false };
    const { advice, usage: u2 } = await adviseMail(deps.claude, mail);
    s = addSpend(s, ADVISE_MODEL, u2, deps.now);
    return { state: s, item: advice ? { ...item, advice: advice.advice, ...(advice.draft && { draft: advice.draft }) } : item, claudeFailed: !advice };
  } catch {
    return { state: s, item: base, claudeFailed: true };
  }
}

/** One minute's check. Never throws; the result says what happened, by kind only. */
export async function tick(deps: TickDeps): Promise<TickResult> {
  if (!deps.client) {
    // Not set up yet: the public counts say the agent is waiting.
    const { state } = await deps.store.load().catch(() => ({ state: null }));
    if (state) await writeStatus(deps, state);
    return "waiting";
  }
  let loaded: Awaited<ReturnType<EmailStore["load"]>>;
  try {
    loaded = await deps.store.load();
  } catch {
    return "error";
  }
  if (loaded.state.busyUntil > deps.now) return "busy";
  // Claim the state first, so a second tick landing now does nothing.
  const claimed: EmailState = { ...loaded.state, busyUntil: deps.now + CLAIM_MS };
  if (!(await deps.store.save(claimed, loaded.version).catch(() => false))) return "busy";

  let state: EmailState = claimed;
  const today = mountainDay(deps.now);
  if (state.day.day !== today) state = { ...state, day: { day: today, newCount: 0, noise: 0 } };
  // A new month lifts the pause, and its count of mail left unsorted starts again.
  if (state.lastCheck !== null && monthOf(state.lastCheck) !== monthOf(deps.now)) state = { ...state, unsorted: 0 };
  let result: TickResult = "checked";
  let lastError: EmailState["lastError"] = null;

  try {
    const token = await deps.store.token();
    if (!token) {
      state = { ...state, gmail: "not-connected", historyId: null };
      result = "not-connected";
    } else {
      const access = await accessToken(deps.fetcher, deps.client, token.refresh);
      state = { ...state, gmail: "connected" };
      if (!state.historyId) {
        // The first check: start from now. Older mail is Gmail's to show, not ours to sort.
        state = { ...state, historyId: await currentHistoryId(deps.fetcher, access) };
        result = "started";
      } else {
        let pages;
        try {
          pages = await historySince(deps.fetcher, access, state.historyId);
        } catch (e) {
          if (!(e instanceof HistoryGoneError)) throw e;
          pages = null;
        }
        if (!pages) {
          state = { ...state, historyId: await currentHistoryId(deps.fetcher, access) };
          result = "resynced";
        } else {
          const fresh = newInboxIds(pages, state.seen);
          const now = fresh.slice(0, MAX_PER_TICK);
          const items: EmailItem[] = [];
          let needs = 0;
          for (const id of now) {
            let raw: unknown;
            try {
              raw = await readMessageRaw(deps.fetcher, access, id);
            } catch (e) {
              if (e instanceof TokenRefusedError) throw e;
              // A message that vanished (deleted already) is skipped, and remembered as seen.
              state = { ...state, seen: [...state.seen, id].slice(-MAX_SEEN) };
              continue;
            }
            const got = await sortOne(deps, state, raw);
            state = { ...got.state, seen: [...got.state.seen, id].slice(-MAX_SEEN) };
            if (got.claudeFailed) lastError = "claude";
            if (got.item) {
              items.push(got.item);
              if (got.item.kind === "needs-you") needs += 1;
            }
          }
          // When more arrived than one tick reads, the history id stays put and the next tick takes the rest (the
          // ones read now are in `seen`).
          const historyId = fresh.length > now.length ? state.historyId : lastHistoryId(pages, state.historyId!);
          state = { ...state, historyId, items: pruneItems([...items, ...state.items.filter((i) => !items.some((n) => n.id === i.id))], deps.now), pingPending: state.pingPending + needs };
        }
      }
    }
  } catch (e) {
    if (e instanceof TokenRefusedError) {
      state = { ...state, gmail: "refused" };
      lastError = "token";
      result = "refused";
    } else {
      lastError = "gmail";
      result = "error";
    }
  }

  if (state.pingPending > 0 && !isQuiet(deps.now)) {
    await deps.ping(emailPing(state.pingPending)).catch(() => 0);
    state = { ...state, pingPending: 0 };
  }
  state = { ...state, items: pruneItems(state.items, deps.now), lastCheck: deps.now, lastError, busyUntil: 0 };
  // Saved over whatever is stored now, keeping any Done Nikita pressed on the Desk while this tick ran.
  // Disconnected on the Desk while this tick ran: nothing of the inbox is kept.
  if (!(await deps.store.token().catch(() => null))) state = { ...state, items: [], historyId: null, seen: [], gmail: "not-connected", pingPending: 0 };
  let saved = false;
  for (let i = 0; i < 2 && !saved; i++) {
    const current = await deps.store.load().catch(() => null);
    if (!current) break;
    const doneNow = new Set(current.state.items.filter((x) => x.done).map((x) => x.id));
    const merged = { ...state, items: state.items.map((x) => (doneNow.has(x.id) ? { ...x, done: true } : x)) };
    saved = await deps.store.save(merged, current.version).catch(() => false);
    if (saved) state = merged;
  }
  if (!saved) return "error";
  await writeStatus(deps, state);
  return result;
}

/** Marks one mail handled (Done on the Desk): it leaves the needs-you count. Retries once on a lost race. */
export async function markDone(store: EmailStore, id: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    const { state, version } = await store.load();
    if (!state.items.some((x) => x.id === id)) return false;
    const next = { ...state, items: state.items.map((x) => (x.id === id ? { ...x, done: true } : x)) };
    if (await store.save(next, version)) return true;
  }
  return false;
}
