/**
 * Skippy, the Magnificent on the Desk (#224), as a Vercel function (and an Azure one, through azure/src/index.ts):
 * Nikita types or says something on Today, and Skippy answers in a line or two and suggests where it should go.
 *
 * GET  → { ready }: whether the chat can work here (the Desk's sign-in and Claude are both set up). Nothing else.
 * GET /api/skippy-log?room=<room> (on Vercel a rewrite to ?log=1 here; on Azure its own route into this file) → the
 *        room's "Asked Skippy" turns, newest first (#273, api/_skippy/log.ts): signed-in Desk only (requireSession),
 *        401 signed-out, 403 cross-site, 400 for a room outside the set, 503 not-set-up. `&needs=skippy`, `&needs=<submind
 *        id>` or `&needs=any` lists only the hand-offs still open (#312); 400 for any other value.
 * POST /api/skippy-answer (on Vercel a rewrite to ?answer=1 here; on Azure its own route) → the return leg of a
 *        hand-off (#312): { id, text, from } with `Authorization: Bearer <SUBMIND_FEED_TOKEN>` (the room threads' write
 *        key, #281; at least 32 characters, compared in constant time, and nothing else opens it). `from` is "skippy" or
 *        the submind the turn was handed to; `text` one plain line of at most 700 characters, held back whole when it
 *        looks private (422). Kept on the turn as its follow-up, which closes the hand-off, and the Desk pings Nikita's
 *        phone (counts-only words, never the text; quiet hours kept). 200 { ok, room, pinged }, 401 without the key,
 *        404 no such turn, 409 not handed off or already answered, 403 a submind answering another's, 503 not-set-up.
 * POST → { message, history? } from a signed-in Desk only (requireSession, #132): `message` is what Nikita just said
 *        (at most 600 characters), `history` the last few turns the browser kept ({ who: "nikita" | "skippy", text },
 *        at most eight). The browser holds the conversation, and the history is never stored. Each answered question
 *        and its reply is kept in the private store under the room Skippy tagged it with (#273, api/_skippy/log.ts):
 *        the last 200 per room, 30 days at most, read back only in a Desk session. No message text is ever logged.
 *        200 { reply, actions, room }: Skippy's answer, the room it belongs with ("green", "exchange", "boiler",
 *        "foundry", "relay" or "none"), and up to three buttons from a closed set (api/_skippy/prompt.ts):
 *          { kind: "idea", label, text }            file `text` as an idea, through the Suggest box's own path
 *          { kind: "answer", label, issue, text }   answer Rivet's open question on `issue`, through the Desk's path
 *          { kind: "open", label, page }            open a Desk page
 *          { kind: "lattice", label, room? }        enter the Lattice
 *        Skippy can't do any of them himself: the Desk shows them as buttons, and only Nikita's tap sends one, to
 *        api/foundry.ts with all of its own checks (the privacy check, the labels, the sign-in).
 *        200 { reply, actions: [], capped: true } when the month's chat budget is spent (api/_skippy/budget.ts).
 *        401 signed-out, 403 cross-site, 400 bad-request, 422 { error: "private", held } (the privacy check, before
 *        anything reaches Claude), 429 { error: "slow-down", wait } (api/_skippy/limits.ts), 502 model, 503 not-set-up.
 *
 * What Skippy is told about the Desk is what the Desk already shows (api/_skippy/context.ts): titles, numbers, labels
 * and counts from the Foundry's issues, the setup list's states and the world clock, scrubbed like the public feeds.
 * He is also told what C.E.O. runs on (#312): the sheet generated from the repo at build time and an OSV.dev advisory
 * summary of the locked packages, cached (api/_skippy/advisories.ts). When he can't settle an ask, or it is work for a
 * room, he hands it off ("needs" in his answer) and the turn is kept flagged for Skippy's thread or the room's submind.
 *
 * Environment: FOUNDRY_DESK_KEY and the blob store (the Desk's sign-in), CLAUDE_API_KEY (or ANTHROPIC_API_KEY),
 * optional SKIPPY_BUDGET_USD (the chat's share of the $10 monthly Claude cap, $2 by default). Skippy answers on Claude
 * Sonnet 5.5, goes to Claude Opus 5.5 for the hard questions, and can run a web lookup (claudeChat below).
 */

import Anthropic from "@anthropic-ai/sdk";
import { pickBlob } from "./_blob.js";
import { deskKeyFor, keyMatches } from "./_desk/keys.js";
import { requireSession, withCookie } from "./_desk/session.js";
import { pickAuthStore, type AuthStore } from "./_desk/store.js";
import { KEY_LOG_ROOMS, readsWithLogKey } from "./_site/roomkeys.js";
import type { SetupStatus } from "./_desk/setup.js";
import { memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";
import { PRIVATE_LABEL, privateParts } from "./_privacy.js";
import { costOf, setupList, type Usage } from "./foundry.js";
import { BlobChatLedger, CHAT_MAX_TOKENS, LOOKUP_MAX_TOKENS, OPUS_PRICE, SEARCH_MAX, SEARCH_USD, SONNET_PRICE, canChat, chatMonth, skippyBudget, type ChatLedger } from "./_skippy/budget.js";
import { contextLines, deskContext, EMPTY_CONTEXT, type ContextIssue, type DeskContext } from "./_skippy/context.js";
import { chatTag, chatWait, countChat } from "./_skippy/limits.js";
import { advisoryCache, stackBrief, stackLines, wantsStack } from "./_skippy/advisories.js";
import { BlobRoomLog, cleanFollowUp, isLogRoom, isNeeds, isNeedsFilter, isTurnId, needsName, type LogRoom, type Needs, type RoomLog } from "./_skippy/log.js";
import { deliver, webPushSend } from "./desk-pings.js";
import { isQuiet, liveSubs, type PingText } from "./_desk/pings.js";
import { plainLine } from "./foundry.js";
import { LOOKUP_PROMPT, OVER_BUDGET, SKIPPY_PROMPT, SKIPPY_SCHEMA, chatInput, lookupInput, readChat, readDeeper, readLookup, readReply, withWeb } from "./_skippy/prompt.js";
import { monthTotals, worldBudget } from "./_world/budget.js";
import { claudeKey } from "./_world/claude.js";
import { pickStore } from "./_world/store.js";
import type { WorldState } from "./_world/types.js";

/** Sonnet answers; Opus takes the questions Sonnet marks "deeper"; Sonnet with web search runs a lookup. */
export const SKIPPY_MODEL = "claude-sonnet-5-5";
export const SKIPPY_DEEP_MODEL = "claude-opus-5-5";
export const LOOKUP_MODEL = "claude-sonnet-5-5";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

/**
 * One answer from Claude: the parsed answer (null when unusable), what it used in all (null when nothing answered),
 * what that cost, and the model whose answer it is (kept with the turn, #273).
 */
export type Ask = (system: string, input: string) => Promise<{ answer: unknown; usage: Usage | null; usd?: number; model?: string }>;

const sumUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
});

/**
 * Skippy's answer in up to three calls, each with the fixed rules, fenced input and a hard max_tokens:
 *
 *   1. Claude Sonnet 5.5 answers in the closed schema. Most answers end here.
 *   2. When it asked for a lookup, a separate Sonnet call with web search (at most three searches) writes a plain
 *      summary. That call sees only the query, never the Desk or the conversation.
 *   3. When it asked for a lookup or to go deeper, it answers again in the closed schema, with the summary in a <web>
 *      block, on Claude Opus 5.5 when it asked to go deeper. If a later call fails, the first answer stands.
 *
 * Thinking can't be turned off on Sonnet 5.5 or Opus 5.5: effort "low" keeps it short, and max_tokens leaves room.
 */
export function claudeChat(key: string): Ask {
  const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 0 });
  const answer = async (model: string, system: string, input: string) => {
    const res = await client.messages.create({
      model,
      max_tokens: CHAT_MAX_TOKENS,
      output_config: { effort: "low", format: { type: "json_schema", schema: SKIPPY_SCHEMA } },
      system,
      messages: [{ role: "user", content: input }],
    });
    const text = res.content.find((b) => b.type === "text");
    let parsed: unknown = null;
    if (res.stop_reason === "end_turn" && text && text.type === "text") {
      try {
        parsed = JSON.parse(text.text);
      } catch {
        parsed = null;
      }
    }
    return { parsed, usage: res.usage as Usage };
  };
  const lookup = async (query: string) => {
    const res = await client.messages.create({
      model: LOOKUP_MODEL,
      max_tokens: LOOKUP_MAX_TOKENS,
      output_config: { effort: "low" },
      system: LOOKUP_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: SEARCH_MAX }],
      messages: [{ role: "user", content: lookupInput(query) }],
    });
    const found = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ");
    const searches = Math.min(SEARCH_MAX, (res.usage as { server_tool_use?: { web_search_requests?: number } | null }).server_tool_use?.web_search_requests ?? 0);
    return { found: res.stop_reason === "end_turn" ? found : "", usage: res.usage as Usage, searches };
  };
  return async (system, input) => {
    const first = await answer(SKIPPY_MODEL, system, input);
    let usage = first.usage;
    let usd = costOf(first.usage, SONNET_PRICE);
    const query = readLookup(first.parsed);
    const deeper = readDeeper(first.parsed);
    if (!query && !deeper) return { answer: first.parsed, usage, usd, model: SKIPPY_MODEL };
    let again = input;
    if (query) {
      try {
        const got = await lookup(query);
        usage = sumUsage(usage, got.usage);
        usd += costOf(got.usage, SONNET_PRICE) + got.searches * SEARCH_USD;
        again = withWeb(input, got.found);
      } catch {
        again = withWeb(input, "");
      }
    }
    try {
      const second = await answer(deeper ? SKIPPY_DEEP_MODEL : SKIPPY_MODEL, system, again);
      usage = sumUsage(usage, second.usage);
      usd += costOf(second.usage, deeper ? OPUS_PRICE : SONNET_PRICE);
      const model = second.parsed ? (deeper ? SKIPPY_DEEP_MODEL : SKIPPY_MODEL) : SKIPPY_MODEL;
      return { answer: second.parsed ?? first.parsed, usage, usd, model };
    } catch {
      return { answer: first.parsed, usage, usd, model: SKIPPY_MODEL };
    }
  };
}

async function readGithub<T>(path: string, fallback: T): Promise<T> {
  try {
    const token = await githubToken("read");
    const res = await fetch(`${GH}${path}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The Foundry's open issues and the last ships, kept 30 seconds per warm function. */
const foundryIssues = memo(30_000, async () => {
  const [open, shipped] = await Promise.all([
    readGithub<ContextIssue[]>("/issues?labels=foundry&state=open&sort=updated&direction=desc&per_page=50", []),
    readGithub<ContextIssue[]>("/issues?labels=foundry:shipped&state=closed&sort=updated&direction=desc&per_page=5", []),
  ]);
  return { open, shipped };
});

export interface ChatDeps {
  deskKey: string;
  store: AuthStore | null;
  ledger: ChatLedger | null;
  ask: Ask | null;
  /** Where each answered ask is kept by room (#273); null or left out keeps nothing. */
  log?: RoomLog | null;
  /** The <stack> block (#312): the whole sheet with the advisory summary when `full`, else one line. Left out, no block. */
  stack?: (full: boolean) => Promise<string>;
  /** The saved world (its spend and its clock), or null. */
  world: () => Promise<WorldState | null>;
  /** The Desk's live state for Skippy. */
  desk: (world: WorldState | null) => Promise<DeskContext>;
  now: number;
  env: Record<string, string | undefined>;
}

/** The advisory summary, kept per warm function and in the blob store (api/_skippy/advisories.ts). */
let advisories: ReturnType<typeof advisoryCache> | null = null;

function defaultDeps(): ChatDeps {
  const env = process.env;
  const blob = pickBlob(env);
  const key = claudeKey(env);
  advisories ??= advisoryCache({ fetcher: (input, init) => fetch(input, init), blob });
  const lookup = advisories;
  return {
    stack: async (full) => (full ? stackLines(await lookup(Date.now()).catch(() => null)) : stackBrief()),
    deskKey: env.FOUNDRY_DESK_KEY ?? "",
    store: pickAuthStore(env),
    ledger: blob ? new BlobChatLedger(blob) : null,
    log: blob ? new BlobRoomLog(blob) : null,
    ask: key ? claudeChat(key) : null,
    world: async () => (await pickStore(env)?.loadState().catch(() => null)) ?? null,
    desk: async (world) => {
      const [{ open, shipped }, setup] = await Promise.all([foundryIssues().catch(() => ({ open: [], shipped: [] })), setupList().catch((): SetupStatus | null => null)]);
      return deskContext(open, shipped, setup, world);
    },
    now: Date.now(),
    env,
  };
}

/** The room log's own address; on Vercel vercel.json rewrites it to /api/skippy?log=1. */
export const LOG_PATH = "/api/skippy-log";

/** The hand-off's return leg (#312); on Vercel vercel.json rewrites it to /api/skippy?answer=1. */
export const ANSWER_PATH = "/api/skippy-answer";

/** Whether a request is for the room log rather than the chat. */
export function isLog(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === LOG_PATH || url.searchParams.has("log");
}

/** Whether a request is a hand-off's answer coming back. */
export function isAnswer(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === ANSWER_PATH || url.searchParams.has("answer");
}

export async function GET(request?: Request): Promise<Response> {
  if (request && isLog(request)) return roomLog(request, defaultDeps());
  const d = defaultDeps();
  return json({ ready: Boolean(d.deskKey && d.store && d.ledger && d.ask) });
}

/**
 * A room's "Asked Skippy" turns (#273), newest first: only in a passkey session, checked before anything is read, or
 * to a submind thread holding the read key (#281) for one of the four active rooms. Everything it holds is private
 * (the Exchange's and Relay's asks included), so there is no public view of it.
 */
export async function roomLog(request: Request, deps: Pick<ChatDeps, "deskKey" | "store" | "log" | "now"> & Partial<Pick<ChatDeps, "env">>): Promise<Response> {
  // A submind thread with the read key (#281, api/_site/roomkeys.ts): its own four rooms only, never Relay's or "none".
  if (readsWithLogKey(request, deps.env ?? {})) {
    const query = new URL(request.url).searchParams;
    const room = query.get("room");
    const needs = query.get("needs");
    if (!(KEY_LOG_ROOMS as readonly string[]).includes(room ?? "") || !isLogRoom(room) || (needs !== null && !isNeedsFilter(needs))) return json({ error: "bad-request" }, 400);
    if (!deps.log) return json({ error: "not-set-up" }, 503);
    try {
      return json({ room, ...(needs && { needs }), turns: await deps.log.list(room, deps.now, needs ?? undefined) });
    } catch {
      return json({ error: "unreadable" }, 502);
    }
  }
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  const signed = await requireSession(request, { deskKey: deps.deskKey, store: deps.store, now: deps.now });
  if (!signed.ok) return signed.response;
  const query = new URL(request.url).searchParams;
  const room = query.get("room");
  const needs = query.get("needs");
  if (!isLogRoom(room) || (needs !== null && !isNeedsFilter(needs))) return withCookie(json({ error: "bad-request" }, 400), signed);
  if (!deps.log) return withCookie(json({ error: "not-set-up" }, 503), signed);
  try {
    return withCookie(json({ room, ...(needs && { needs }), turns: await deps.log.list(room, deps.now, needs ?? undefined) }), signed);
  } catch {
    return withCookie(json({ error: "unreadable" }, 502), signed);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (isAnswer(request)) return followUp(request, answerDeps());
  return chat(request, defaultDeps());
}

/** The shortest SUBMIND_FEED_TOKEN that counts, as for the site's bypass token. */
export const MIN_TOKEN = 32;
/** The Desk page each room's asks live on, for the ping to open. */
const ROOM_PAGE: Record<LogRoom, string> = { green: "/green", exchange: "/exchange", boiler: "/boiler", foundry: "/foundry", relay: "/relay", none: "/" };

export interface AnswerDeps {
  /** SUBMIND_FEED_TOKEN, or "" (then the return leg is off). */
  token: string;
  log: RoomLog | null;
  /** Pings Nikita's phones; how many took it. */
  ping: (text: PingText) => Promise<number>;
  now: number;
}

function answerDeps(): AnswerDeps {
  const env = process.env;
  const blob = pickBlob(env);
  const store = pickAuthStore(env);
  const pingsOn = Boolean(env.DESK_VAPID_PUBLIC_KEY && env.DESK_VAPID_PRIVATE_KEY && store);
  return {
    token: env.SUBMIND_FEED_TOKEN?.trim() ?? "",
    log: blob ? new BlobRoomLog(blob) : null,
    ping: async (text) => {
      if (!pingsOn || !store) return 0;
      const [state, passkeys] = await Promise.all([store.pings(), store.passkeys()]);
      const subs = liveSubs(state.subs, passkeys);
      return subs.length ? deliver(store, subs, text, webPushSend) : 0;
    },
    now: Date.now(),
  };
}

/** The words of an answer's ping: who answered, never what. Safe on a lock screen. */
export const answerPing = (from: Needs, room: LogRoom): PingText => ({
  title: "C.E.O. Desk",
  body: `${from === "skippy" ? "Skippy" : needsName(from)} answered something you asked on the Desk.`,
  url: ROOM_PAGE[room],
});

/** The return leg of a hand-off (#312): the thread side's answer, kept on the turn, and a ping. */
export async function followUp(request: Request, deps: AnswerDeps): Promise<Response> {
  if (deps.token.length < MIN_TOKEN || !deps.log) return json({ error: "not-set-up" }, 503);
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !keyMatches(auth.slice(7).trim(), deps.token)) return json({ error: "unauthorized" }, 401);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const body = (await request.json().catch(() => null)) as { id?: unknown; text?: unknown; from?: unknown } | null;
  if (!body || typeof body !== "object" || !isTurnId(body.id) || !isNeeds(body.from) || typeof body.text !== "string") return json({ error: "bad-request" }, 400);
  const text = plainLine(body.text, 700);
  if (!text) return json({ error: "bad-request" }, 400);
  const held = privateParts(text);
  if (held.length) return json({ error: "private", held: [...new Set(held)].map((k) => PRIVATE_LABEL[k]) }, 422);
  const f = cleanFollowUp({ from: body.from, text, at: new Date(deps.now).toISOString() });
  if (!f) return json({ error: "bad-request" }, 400);
  let result: Awaited<ReturnType<RoomLog["answer"]>>;
  try {
    result = await deps.log.answer(body.id, f, deps.now);
  } catch {
    return json({ error: "unreadable" }, 502);
  }
  if (!result.ok) {
    const status = result.why === "missing" ? 404 : result.why === "wrong-thread" ? 403 : 409;
    return json({ error: result.why }, status);
  }
  // Quiet hours hold the ping (the follow-up still shows on the Desk); a failed ping never loses the answer.
  const pinged = isQuiet(deps.now) ? 0 : await deps.ping(answerPing(f.from, result.turn.room)).catch(() => 0);
  return json({ ok: true, room: result.turn.room, pinged });
}

/** The chat itself, with everything it touches handed in (the tests stub each piece). */
export async function chat(request: Request, deps: ChatDeps): Promise<Response> {
  if (!deps.deskKey || !deps.store) return json({ error: "not-set-up" }, 503);
  // Only in a passkey session, checked before the body is even read: without one nothing goes anywhere.
  const signed = await requireSession(request, { deskKey: deps.deskKey, store: deps.store, now: deps.now });
  if (!signed.ok) return signed.response;
  return withCookie(await answer(request, deps, deps.store, signed.passkey.id), signed);
}

async function answer(request: Request, deps: ChatDeps, store: AuthStore, passkey: string): Promise<Response> {
  if (!deps.ask || !deps.ledger) return json({ error: "not-set-up" }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const said = readChat(body);
  if (!said) return json({ error: "bad-request" }, 400);

  // The privacy check (#127), on everything that would reach Claude: text that looks private is held back whole.
  const held = [...new Set([said.message, ...said.history.map((t) => t.text)].flatMap((t) => privateParts(t)))];
  if (held.length) return json({ error: "private", held: held.map((k) => PRIVATE_LABEL[k]) }, 422);

  // The pace, per passkey: counted before the call, so a refused or failed call still counts.
  const tag = chatTag(passkey, await deskKeyFor(deps.deskKey, "client"));
  const limits = await store.limits();
  const wait = chatWait(limits, tag, deps.now);
  if (wait > 0) {
    const s = Math.ceil(wait / 1000);
    return json({ error: "slow-down", wait: s }, 429, { "Retry-After": String(s) });
  }
  await store.saveLimits(countChat(limits, tag, deps.now));

  // The month's budget: the world's spend and the chat's own ledger. Unreadable means no call (fail closed).
  const world = await deps.world();
  let spent: number;
  try {
    spent = chatMonth(await deps.ledger.load(), deps.now).usd;
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  const worldUsd = monthTotals(world ?? { spend: {} }, deps.now).usd;
  if (!canChat(spent, worldUsd, skippyBudget(deps.env.SKIPPY_BUDGET_USD, worldBudget(deps.env.WORLD_BUDGET_USD)))) {
    return json({ reply: OVER_BUDGET[Math.floor(deps.now / 60_000) % OVER_BUDGET.length], actions: [], capped: true });
  }

  const [desk, stack] = await Promise.all([deps.desk(world).catch(() => EMPTY_CONTEXT), deps.stack ? deps.stack(wantsStack([said.message, ...said.history.slice(-2).map((t) => t.text)].join(" "))).catch(() => "") : Promise.resolve("")]);
  let got: Awaited<ReturnType<Ask>>;
  try {
    got = await deps.ask(SKIPPY_PROMPT, chatInput(contextLines(desk, deps.now), said.history, said.message, stack));
  } catch {
    return json({ error: "model" }, 502);
  }
  // Every call that answered counts against the month, usable or not.
  if (got.usage) await deps.ledger.add(deps.now, got.usage, got.usd).catch(() => undefined);
  const reply = readReply(got.answer, desk);
  if (!reply) return json({ error: "model" }, 502);
  // Kept under its room for the room's Desk page (#273): the question (already through the privacy check), the answer,
  // the room, the time and the model. A failed write never costs Nikita the answer.
  if (deps.log) {
    await deps.log
      .add({ at: new Date(deps.now).toISOString(), question: said.message, answer: reply.reply, room: reply.room, model: got.model ?? SKIPPY_MODEL, ...(reply.needs && { needs: reply.needs }) }, deps.now)
      .catch(() => undefined);
  }
  return json(reply);
}
