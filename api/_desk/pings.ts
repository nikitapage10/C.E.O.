/**
 * Pings (#135): one notification on Nikita's phone, and only when something needs Nikita's call. No emails.
 *
 * What pings, read from the Foundry's open issues on GitHub (the labels in docs/FOUNDRY.md):
 *   idea      a `foundry:idea` waiting for the pick: no `foundry:revise` (Rivet is still writing it) and no
 *             `foundry:question` (that pings as a question). Ideas Nikita proposed on the Desk don't: they were
 *             Nikita's own a moment ago.
 *   question  Rivet asked something first (`foundry:question`, the issue's `**Question:**` line). A second question
 *             on the same idea is a new question and pings again; the same one never does.
 *   blocker   the Builder can't go on without Nikita (`foundry:blocked`, docs/FOUNDRY.md) or a fix is stuck after
 *             rung 3 (`foundry:stuck`). Cleared and flagged again later, it pings again.
 * Nothing else pings: work in flight, shipped jobs, checks and upkeep stay quiet.
 *
 * Each item pings once ("sent" remembers its key), and everything new at one scan goes out as one ping. Between
 * 10pm and 7am Mountain nothing is sent: what arrives waits, and the first scan from 7am sends one summary of what
 * still needs Nikita (whatever was handled overnight is no longer on the list, so it is simply dropped).
 *
 * A ping says only how many of each, in words safe for a lock screen anyone might glance at ("Rivet has a
 * question", "3 ideas waiting for your pick"): never a title, a body, a name or a link to an issue.
 *
 * The subscriptions live in the private Blob store beside the passkeys (api/_desk/store.ts). Each names the passkey
 * that was signed in when it was made: removing that device drops its pings, signing out on a device drops that
 * device's, and a send to a device that is no longer enrolled never happens.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash } from "node:crypto";
import type { AuthStore, Passkey } from "./store.js";

/** No pings from 10pm to 7am Mountain (America/Denver, which follows daylight saving). */
export const QUIET_HOURS = { from: 22, until: 7, timeZone: "America/Denver" } as const;

/** At most this many devices get pings (as many as can be enrolled). */
export const MAX_SUBS = 10;

/** What was pinged is remembered this long at most, and dropped sooner once its issue is closed. */
export const SENT_KEEP_MS = 60 * 24 * 60 * 60_000;

/** How long a push service holds a ping for a phone that is off: half a day, then it is stale. */
export const PING_TTL_S = 12 * 60 * 60;

export interface PingSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The passkey that was signed in when pings were turned on: the device it belongs to. */
  passkey: string;
  /** ISO time it was turned on. */
  added: string;
}

export interface PingState {
  subs: PingSub[];
  /** Key of each item pinged (see `Need.key`) → when (ms). */
  sent: Record<string, number>;
  /** When the pings workflow last scanned with the right secret (ms): how the setup list sees the Actions secret (#164). */
  scanned?: number;
}

export type NeedKind = "idea" | "question" | "blocker";

export interface Need {
  kind: NeedKind;
  issue: number;
  /** Stable per item: `idea:#12`, `question:#12:<hash of the question>`, `blocker:#12`. */
  key: string;
}

/** The fields of a GitHub issue the scan reads. The body is read here only, never sent anywhere. */
export interface GhIssueLite {
  number: number;
  state?: string;
  body?: string | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

/** The label the Builder puts on a job it can't go on with until Nikita decides something (docs/FOUNDRY.md). */
export const BLOCKED_LABEL = "foundry:blocked";

/** Where a ping opens the Desk, per kind: all three are decided on the Foundry tab. */
export const TAB_FOR: Record<NeedKind, string> = { idea: "/foundry", question: "/foundry", blocker: "/foundry" };

/* ── Subscriptions ── */

/** The push services the big browsers use. A subscription anywhere else is refused, so the server only ever posts to these. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** A browser's PushSubscription JSON as stored, or null when it isn't one from a known push service. */
export function readSubscription(given: unknown): Pick<PingSub, "endpoint" | "keys"> | null {
  if (!given || typeof given !== "object") return null;
  const g = given as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof g.endpoint !== "string" || g.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(g.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !PUSH_HOSTS.test(url.hostname)) return null;
  const p256dh = g.keys?.p256dh;
  const auth = g.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 64 || !B64URL.test(p256dh) || !B64URL.test(auth)) return null;
  return { endpoint: url.href, keys: { p256dh, auth } };
}

/** The state with this device's subscription added (or replaced), newest kept when over the cap. */
export function withSub(state: PingState, sub: PingSub): PingState {
  const subs = [...state.subs.filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_SUBS);
  return { ...state, subs };
}

/** Drops one device's subscription, by its endpoint. */
export async function dropEndpoint(store: AuthStore, endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== "string" || !endpoint) return false;
  const state = await store.pings();
  const subs = state.subs.filter((s) => s.endpoint !== endpoint);
  if (subs.length === state.subs.length) return false;
  await store.savePings({ ...state, subs });
  return true;
}

/** Drops every subscription made on a passkey (the device was removed). */
export async function dropPasskey(store: AuthStore, passkey: string): Promise<void> {
  const state = await store.pings();
  const subs = state.subs.filter((s) => s.passkey !== passkey);
  if (subs.length !== state.subs.length) await store.savePings({ ...state, subs });
}

/** Only devices still enrolled get pings. */
export const liveSubs = (subs: PingSub[], passkeys: Passkey[]): PingSub[] => subs.filter((s) => passkeys.some((p) => p.id === s.passkey));

/* ── What needs Nikita ── */

const labelNames = (issue: GhIssueLite) => new Set(issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))));
const shortHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** The `**Question:**` line of an issue body (the same reading as api/foundry.ts), or "". */
const questionLine = (body: string) => /^\*\*Question:\*\*[ \t]*(.*)$/m.exec(body)?.[1]?.trim() ?? "";

/** Ideas Nikita filed on the Desk carry this line (api/foundry.ts): those are Nikita's own, so they don't ping. */
const FROM_DESK = "**From Nikita (on the Desk):**";

/** What on the Foundry's open issues needs Nikita's call right now, one entry per item. */
export function needsOf(issues: GhIssueLite[]): Need[] {
  const out: Need[] = [];
  for (const issue of issues) {
    if (issue.pull_request || (issue.state && issue.state !== "open")) continue;
    const labels = labelNames(issue);
    if (!labels.has("foundry")) continue;
    const n = issue.number;
    if (labels.has(BLOCKED_LABEL) || labels.has("foundry:stuck")) out.push({ kind: "blocker", issue: n, key: `blocker:#${n}` });
    if (!labels.has("foundry:idea")) continue;
    const body = issue.body ?? "";
    if (labels.has("foundry:question")) {
      out.push({ kind: "question", issue: n, key: `question:#${n}:${shortHash(questionLine(body))}` });
    } else if (!labels.has("foundry:revise") && !labels.has("foundry:build") && !body.includes(FROM_DESK)) {
      out.push({ kind: "idea", issue: n, key: `idea:#${n}` });
    }
  }
  return out;
}

/** Whether `now` (ms) falls in the quiet hours. */
export function isQuiet(now: number, hours: { from: number; until: number; timeZone: string } = QUIET_HOURS): boolean {
  const h = hourIn(now, hours.timeZone);
  return hours.from > hours.until ? h >= hours.from || h < hours.until : h >= hours.from && h < hours.until;
}

/** The hour (0 to 23) at `now` in a time zone. */
export function hourIn(now: number, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
}

export interface Plan {
  /** What to ping now, all in one ping; empty for none. */
  ping: Need[];
  /** In the quiet hours: how many are waiting for the morning. */
  held: number;
  /** The first hour after the quiet: the ping is the morning's summary. */
  morning: boolean;
  /** `sent` as it should be saved, with this ping's items in and closed issues' out. */
  sent: Record<string, number>;
}

/**
 * The one decision: what to ping now. Items already pinged never go again; new ones all go together; in the quiet
 * hours nothing goes and nothing is marked, so the morning's first scan finds whatever still needs Nikita.
 * `open` is every open Foundry issue's number, so an item is forgotten once its issue closes.
 */
export function planPings(needs: Need[], sent: Record<string, number>, now: number, open: Set<number>): Plan {
  const flagged = new Set(needs.filter((n) => n.kind === "blocker").map((n) => n.key));
  const kept: Record<string, number> = {};
  for (const [key, at] of Object.entries(sent)) {
    const issue = Number(/#(\d+)/.exec(key)?.[1]);
    if (now - at > SENT_KEEP_MS || !open.has(issue)) continue;
    // A blocker that was cleared is forgotten, so flagging it again pings again.
    if (key.startsWith("blocker:") && !flagged.has(key)) continue;
    kept[key] = at;
  }
  const fresh = needs.filter((n) => !(n.key in kept));
  if (isQuiet(now)) return { ping: [], held: fresh.length, morning: false, sent: kept };
  for (const n of fresh) kept[n.key] = now;
  return { ping: fresh, held: 0, morning: fresh.length > 0 && hourIn(now, QUIET_HOURS.timeZone) === QUIET_HOURS.until, sent: kept };
}

/* ── What a ping says ── */

export interface PingText {
  title: string;
  body: string;
  /** The Desk tab it opens. */
  url: string;
}

/** A ping's words: counts and who is asking, nothing from an issue. Safe on a lock screen. */
export function pingText(needs: Need[], morning = false): PingText {
  const count = (k: NeedKind) => needs.filter((n) => n.kind === k).length;
  const ideas = count("idea");
  const questions = count("question");
  const blockers = count("blocker");
  const parts: string[] = [];
  if (blockers) parts.push(blockers === 1 ? "A job is blocked and needs you" : `${blockers} jobs are blocked and need you`);
  if (questions) parts.push(questions === 1 ? "Rivet has a question" : `Rivet has ${questions} questions`);
  if (ideas) parts.push(ideas === 1 ? "An idea is waiting for your pick" : `${ideas} ideas are waiting for your pick`);
  const first = needs.find((n) => n.kind === "blocker") ?? needs.find((n) => n.kind === "question") ?? needs[0];
  return {
    title: morning ? "Good morning from the Desk" : "C.E.O. Desk",
    body: parts.join(" · ") || "Something needs your call.",
    url: first ? TAB_FOR[first.kind] : "/",
  };
}

/** The welcome ping a device gets when pings are turned on, so Nikita knows they work. */
export const WELCOME: PingText = { title: "C.E.O. Desk", body: "Pings are on. You'll hear from the Desk only when it needs your call.", url: "/foundry" };
