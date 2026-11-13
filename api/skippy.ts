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
 *        looks private (422); optional `final` (#480), false for an interim answer that keeps the hand-off open. Kept on the
 *        turn as its follow-up, which closes the hand-off unless it was interim, and the Desk pings Nikita's
 *        phone (counts-only words, never the text; quiet hours kept). 200 { ok, room, pinged }, 401 without the key,
 *        404 no such turn, 409 not handed off or already answered, 403 a submind answering another's, 503 not-set-up.
 * POST → { message, history? } from a signed-in Desk only (requireSession, #132): `message` is what Nikita just said
 *        (at most 600 characters), `history` the last few turns the browser kept ({ who: "nikita" | "skippy", text },
 *        at most eight), and `page`, what the Desk page shows (#341: the Green's start/sit rows first, then the other
        live rooms; plain lines, at most 1,600 characters, a private-looking line dropped). The browser holds the
        conversation, and neither the history nor the page is ever stored. A hand-off's answer also carries `turn`, the
        kept turn's id, so the Desk can wait for the room's answer in the same chat. Each answered question
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
 * and counts from the Foundry's issues, the setup list's states and the world clock, scrubbed like the public feeds,
 * and the ElevenLabs plan's credits (#477, billLines, when ElevenLabs answers; the site caps nothing of its own, #532). They are only ever in this signed-in answer, never on the Lattice.
 * And a line or two per live room (#478, api/_skippy/rooms.ts): the Green's matchup and calls, Relay's counts, the
 * Exchange's open positions and the Boiler Room's pipes, each read on its own inside one time budget.
 * He is also told what C.E.O. runs on (#312): the sheet generated from the repo at build time and an OSV.dev advisory
 * summary of the locked packages, cached (api/_skippy/advisories.ts). When he can't settle an ask, or it is work for a
 * room, he hands it off ("needs" in his answer) and the turn is kept flagged for Skippy's thread or the room's submind.
 *
 * Since #646 the answer comes from Skippy's agent loop (api/_skippy/agent/loop.ts): Haiku triages, Sonnet talks with
 * the rooms' tools (the one registry shared with the room voice hook) and web search, Opus takes the hard asks, his
 * private memory's core card rides in the cached prefix, and the answer adds `looked` (what it read), `did` (what it
 * changed), `confirm` (Yes buttons for anything that sends, spends or deletes, run by POST /api/skippy-act) and `spend`
 * (Skippy's month against his cap).
 *
 * Environment: FOUNDRY_DESK_KEY and the blob store (the Desk's sign-in), CLAUDE_API_KEY (or ANTHROPIC_API_KEY),
 * optional SKIPPY_BUDGET_USD (Skippy's one month cap, $60 by default, a hard stop, #646; the Kernel responder's month
 * counts inside it).
 */

import Anthropic from "@anthropic-ai/sdk";
import { pickBlob } from "./_blob.js";
import { deskKeyFor, keyMatches } from "./_desk/keys.js";
import { requireSession, withCookie } from "./_desk/session.js";
import { pickAuthStore, type AuthStore } from "./_desk/store.js";
import { KEY_ASKED_ROOMS, readsWithLogKey } from "./_site/roomkeys.js";
import type { SetupStatus } from "./_desk/setup.js";
import { memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";
import { PRIVATE_LABEL, privateParts } from "./_privacy.js";
import { costOf, setupList, type Usage } from "./foundry.js";
import { AGENT_CEILING_USD, BlobChatLedger, CHAT_MAX_TOKENS, KERNEL_LEDGER_PATH, LOOKUP_MAX_TOKENS, OPUS_PRICE, SEARCH_MAX, SEARCH_USD, SONNET_PRICE, canChat, chatMonth, skippyBudget, skippySpent, skippyWarn, type ChatLedger } from "./_skippy/budget.js";
import { contextLines, deskContext, EMPTY_CONTEXT, type ContextIssue, type DeskContext } from "./_skippy/context.js";
import { clockLine } from "./_skippy/clock.js";
import { chatTag, chatWait, countChat } from "./_skippy/limits.js";
import { advisoryCache, stackBrief, stackLines, wantsStack } from "./_skippy/advisories.js";
import { FLOOR_REPLY, floorQuestion, readFloor } from "./_today/floor.js";
import { BlobRoomLog, cardText, cleanCard, cleanFollowUp, handoffTo, isLogRoom, isNeeds, isNeedsFilter, type FollowFrom, isTurnId, needsName, turnId, type LogRoom, type Needs, type RoomLog } from "./_skippy/log.js";
import { deliver, webPushSend } from "./desk-pings.js";
import { isQuiet, liveSubs, type PingText } from "./_desk/pings.js";
import { plainLine } from "./foundry.js";
import { CALL_RULES, lookupPrompt, OVER_BUDGET, PHONE_RULES, SKIPPY_PROMPT, SKIPPY_SCHEMA, chatInput, lookupInput, publicScreen, readChat, readDeeper, readLookup, readReply, screenLine, withWeb, type SkippyReply } from "./_skippy/prompt.js";
import { BlobShots, type ShotStore } from "./_skippy/shots.js";
import { claudeKey } from "./_world/claude.js";
import { pickStore } from "./_world/store.js";
import { elevenFromEnv } from "./_world/story.js";
import { billLines, creditsReader } from "./_skippy/voice.js";
import { roomLines } from "./_skippy/rooms.js";
import { askRuled } from "./_relay/compose.js";
import { skipTermsFrom } from "./_email/filter.js";
import { liveRoomReads } from "./_skippy/roomReads.js";
import type { WorldState } from "./_world/types.js";
import type { PendingConfirm } from "@ceo/engine/tools";
import { claudeModel, runAgent, type AgentCtx } from "./_skippy/agent/loop.js";
import { liveHost, livePending } from "./_skippy/agent/host.js";
import { BlobMemory, coreBlock, type MemoryStore } from "./_skippy/agent/memory.js";
import { BlobChatLog, type ChatLog } from "./_skippy/chatlog.js";
import type { PendingStore } from "./_skippy/agent/pending.js";
import { callTool, type CallResult, type TextAction, type ToolHost } from "./_skippy/agent/tools.js";
import { directAsk } from "./_skippy/agent/words.js";
import { spokenOf } from "./_haven/classify.js";
import { dryHost, dryMemory, dryPending, gradeAnswer, isProbe, probeToken, readProbe, type DryRecord, type ProbeTurn } from "./_skippy/probe.js";

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
export type Ask = (
  system: string,
  input: string,
  ctx?: AgentCtx,
) => Promise<{ answer: unknown; usage: Usage | null; usd?: number; model?: string; parts?: Record<string, number>; looked?: string[]; did?: string[]; wrote?: string[]; confirm?: PendingConfirm[]; textAction?: TextAction; tier?: string; deeper?: "talk" | "hard" | "floor"; needScreen?: boolean }>;

/** The live answer (#646): the agent loop when the turn brings its tools, else the one-shot chat. */
export function agentChat(key: string): Ask {
  const call = claudeModel(key);
  const oneShot = claudeChat(key);
  return (system, input, ctx) => (ctx ? runAgent(call, system, input, ctx) : oneShot(system, input));
}

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
      system: lookupPrompt(Date.now()),
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
export const foundryIssues = memo(30_000, async () => {
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
  /** The Kernel responder's ledger (#501): its month counts inside Skippy's cap (#646). */
  kernelLedger?: ChatLedger | null;
  ask: Ask | null;
  /** Skippy's private memory of Nikita (#646): its core card rides in every turn; the journal keeps the turns. */
  memory?: MemoryStore | null;
  /** Desk chats kept whole (#1097, api/_skippy/chatlog.ts): every typed, phone and room turn. A call's come from its transcript. */
  chats?: ChatLog | null;
  /** The rooms' tools' reach (#646); left out, the turn runs without tools (the one-shot chat). */
  host?: () => ToolHost;
  /** Where calls that wait for Nikita's tap are kept (#646). */
  pending?: PendingStore | null;
  /** The private screenshots (#1027, api/_skippy/shots.ts): the one the browser sent back after look_at_screen. */
  shots?: ShotStore | null;
  /** Where each answered ask is kept by room (#273); null or left out keeps nothing. */
  log?: RoomLog | null;
  /** The <stack> block (#312): the whole sheet with the advisory summary when `full`, else one line. Left out, no block. */
  stack?: (full: boolean) => Promise<string>;
  /** The saved world (its spend and its clock), or null. */
  world: () => Promise<WorldState | null>;
  /** The Desk's live state for Skippy. */
  desk: (world: WorldState | null) => Promise<DeskContext>;
  /** The ElevenLabs plan's credits as plain lines (#477, api/_skippy/voice.ts billLines), added to <desk>; "" or left out, none. */
  bill?: () => Promise<string>;
  /** The live rooms as plain lines (#478, api/_skippy/rooms.ts), added to <desk>; "" or left out, none. */
  rooms?: (world: WorldState | null) => Promise<string>;
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
    kernelLedger: blob ? new BlobChatLedger(blob, KERNEL_LEDGER_PATH) : null,
    log: blob ? new BlobRoomLog(blob) : null,
    ask: key ? agentChat(key) : null,
    memory: blob ? new BlobMemory(blob, skipTermsFrom(env.EMAIL_SKIP_TERMS)) : null,
    chats: blob ? new BlobChatLog(blob, skipTermsFrom(env.EMAIL_SKIP_TERMS)) : null,
    host: () => liveHost(env),
    pending: livePending(env),
    shots: blob ? new BlobShots(blob) : null,
    world: async () => (await pickStore(env)?.loadState().catch(() => null)) ?? null,
    desk: async (world) => {
      const [{ open, shipped }, setup] = await Promise.all([foundryIssues().catch(() => ({ open: [], shipped: [] })), setupList().catch((): SetupStatus | null => null)]);
      return deskContext(open, shipped, setup, world);
    },
    rooms: (world) => roomLines({ ...liveRoomReads(env), clock: async () => world?.at ?? null }, Date.now()),
    bill: async () => {
      const eleven = elevenFromEnv(env);
      return eleven ? billLines(await creditsReader(eleven.key)()) : "";
    },
    now: Date.now(),
    env,
  };
}

/** What Skippy adds when the relay's rules keep a text from Blasto (#536). */
export const TEXT_RULED = "That one you text yourself, monkey: Relay keeps money, legal and the skip list away from Blasto.";

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
    if (!(KEY_ASKED_ROOMS as readonly string[]).includes(room ?? "") || !isLogRoom(room) || (needs !== null && !isNeedsFilter(needs))) return json({ error: "bad-request" }, 400);
    if (!deps.log) return json({ error: "not-set-up" }, 503);
    try {
      // A Talk call's submind exchanges (#479) stay Desk-only: the read key never lists them.
      const turns = (await deps.log.list(room, deps.now, needs ?? undefined)).filter((t) => t.via !== "voice");
      return json({ room, ...(needs && { needs }), turns });
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
  if (isProbe(request)) return probe(request, defaultDeps());
  return chat(request, defaultDeps());
}

/** The shortest SUBMIND_FEED_TOKEN that counts, as for the site's bypass token. */
export const MIN_TOKEN = 32;
/** The Desk page each room's asks live on, for the ping to open. */
const ROOM_PAGE: Record<LogRoom, string> = { green: "/green", exchange: "/exchange", boiler: "/boiler", foundry: "/foundry", relay: "/relay", haven: "/haven", kernel: "/", none: "/" };

export interface AnswerDeps {
  /** SUBMIND_FEED_TOKEN, or "" (then the return leg is off). */
  token: string;
  log: RoomLog | null;
  /** Pings Nikita's phones; how many took it. */
  ping: (text: PingText) => Promise<number>;
  now: number;
}

export function answerDeps(): AnswerDeps {
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
export const answerPing = (from: FollowFrom, room: LogRoom): PingText => ({
  title: "C.E.O. Desk",
  body: `${from === "skippy" || from === "kernel-agent" ? "Skippy" : needsName(from)} answered something you asked on the Desk.`,
  url: ROOM_PAGE[room],
});

/** The return leg of a hand-off (#312): the thread side's answer, kept on the turn, and a ping. */
export async function followUp(request: Request, deps: AnswerDeps): Promise<Response> {
  if (deps.token.length < MIN_TOKEN || !deps.log) return json({ error: "not-set-up" }, 503);
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !keyMatches(auth.slice(7).trim(), deps.token)) return json({ error: "unauthorized" }, 401);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const body = (await request.json().catch(() => null)) as { id?: unknown; text?: unknown; from?: unknown; card?: unknown; final?: unknown } | null;
  if (!body || typeof body !== "object" || !isTurnId(body.id) || !isNeeds(body.from) || typeof body.text !== "string") return json({ error: "bad-request" }, 400);
  // `final` (#480): false for an interim answer that keeps the hand-off open; left out or true closes it.
  if (body.final !== undefined && typeof body.final !== "boolean") return json({ error: "bad-request" }, 400);
  const final = body.final !== false;
  const text = plainLine(body.text, 700);
  if (!text) return json({ error: "bad-request" }, 400);
  // The answer card (#341) is optional; one that is sent must be a card (a verdict at least), never silently dropped.
  const card = body.card === undefined || body.card === null ? null : cleanCard(body.card);
  if (body.card !== undefined && body.card !== null && !card) return json({ error: "bad-request" }, 400);
  const held = [text, ...(card ? cardText(card) : [])].flatMap((t) => privateParts(t));
  if (held.length) return json({ error: "private", held: [...new Set(held)].map((k) => PRIVATE_LABEL[k]) }, 422);
  return keepAnswer(deps, { id: body.id, from: body.from, text, final, ...(card && { card }) });
}

/**
 * Keeps an answer on a hand-off's turn and pings (#312): the one path every answer takes, the thread's POST above and the
 * always-on responder (#501, api/_skippy/kernelagent.ts), which has already put its text through the same checks.
 */
export async function keepAnswer(deps: Pick<AnswerDeps, "log" | "ping" | "now">, a: { id: string; from: FollowFrom; text: string; final: boolean; card?: ReturnType<typeof cleanCard>; ping?: boolean }): Promise<Response> {
  if (!deps.log) return json({ error: "not-set-up" }, 503);
  const f = cleanFollowUp({ from: a.from, text: a.text, at: new Date(deps.now).toISOString(), ...(a.card && { card: a.card }), ...(!a.final && { final: false }) });
  if (!f) return json({ error: "bad-request" }, 400);
  let result: Awaited<ReturnType<RoomLog["answer"]>>;
  try {
    result = await deps.log.answer(a.id, f, deps.now);
  } catch {
    return json({ error: "unreadable" }, 502);
  }
  if (!result.ok) {
    const status = result.why === "missing" ? 404 : result.why === "wrong-thread" ? 403 : 409;
    return json({ error: result.why }, status);
  }
  // Quiet hours hold the ping (the follow-up still shows on the Desk); a failed ping never loses the answer.
  const pinged = a.ping === false || isQuiet(deps.now) ? 0 : await deps.ping(answerPing(f.from, result.turn.room)).catch(() => 0);
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
  // A yes to an item on Today's floor (api/_today/floor.ts): straight to Skippy, the Magnificent, no model.
  if (body && typeof body === "object" && "floor" in body) return floorTurn(body, deps, store, passkey);
  const said = readChat(body);
  if (!said) return json({ error: "bad-request" }, 400);
  return skippyTurn(said, deps, store, passkey, "desk");
}

/**
 * POST { floor, message }: Nikita approved an item on Today's floor ("go ahead and fix this" on a Repair). The ask is
 * built from the item's own safe words and Nikita's, put through the privacy check and the chat's pace, and kept in the
 * `kernel` log handed to Skippy, the Magnificent, exactly as a chat hand-off is (his always-on responder and his
 * thread's watcher take it from there). No model runs here, so it costs nothing. 200 { reply, room, needs, turn }.
 */
async function floorTurn(body: unknown, deps: ChatDeps, store: AuthStore, passkey: string): Promise<Response> {
  const got = readFloor(body);
  if (!got) return json({ error: "bad-request" }, 400);
  const question = floorQuestion(got.item, got.said);
  const held = [...new Set(privateParts(question))];
  if (held.length) return json({ error: "private", held: held.map((k) => PRIVATE_LABEL[k]) }, 422);
  const tag = chatTag(passkey, await deskKeyFor(deps.deskKey, "client"));
  const limits = await store.limits();
  const wait = chatWait(limits, tag, deps.now);
  if (wait > 0) {
    const s = Math.ceil(wait / 1000);
    return json({ error: "slow-down", wait: s }, 429, { "Retry-After": String(s) });
  }
  await store.saveLimits(countChat(limits, tag, deps.now));
  if (!deps.log) return json({ error: "not-set-up" }, 503);
  const at = new Date(deps.now).toISOString();
  const id = turnId(at, question);
  try {
    await deps.log.add({ id, at, question, answer: FLOOR_REPLY, room: "kernel", model: "floor", needs: "skippy" }, deps.now);
  } catch {
    return json({ error: "model" }, 502);
  }
  return json({ reply: FLOOR_REPLY, actions: [], room: "kernel", needs: "skippy", turn: id });
}

/**
 * Where Nikita is talking from: the Desk's chat, the iPhone's "Skippy" shortcut (#627), a room's mic or hold Space on
 * any page (#638, #905), or a Talk call's ask (#926). One brain answers them all, with the same tools and memory.
 */
export type Surface = "desk" | "phone" | "room" | "call";

/** A room's voice (#638, api/_skippy/roomvoice.ts): the extra rules, the room its turns are kept under, who answers. */
export interface RoomTurn {
  rules: string;
  log: LogRoom | null;
  by: Needs | null;
  /** What the page shows (#926): a hint for "this" and "that one", never a limit on what he can do. */
  page?: string;
  /** On the Senate's floor: a remark on the debate is given back to the members (`floor` in the answer). */
  floor?: boolean;
  /** What Nikita is looking at (#1027): the screen's metadata, and the screenshot's id once he's been looked at. */
  screen?: unknown;
  shot?: string;
  /** False when the browser couldn't capture the page: go on the metadata alone. */
  look?: boolean;
}

/**
 * One turn of Skippy's chat, after the caller has signed it in: the privacy check, the pace, the month's budget, the
 * model, the room log and the hand-off. The Desk (above) and the phone (`phoneAnswer`, below) both come through here,
 * so the phone gets the same prompt, router, caps and hand-offs as the Desk. `paceId` names who is paced (a passkey's
 * id, or "phone:<id>").
 */
async function skippyTurn(said: NonNullable<ReturnType<typeof readChat>>, deps: ChatDeps, store: AuthStore, paceId: string, surface: Surface, room?: RoomTurn, opts?: { agent?: Partial<AgentCtx>; keep?: boolean }): Promise<Response> {
  const passkey = paceId;
  if (!deps.host && (!deps.ask || !deps.ledger)) return json({ error: "not-set-up" }, 503);
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

  // The quick tier, by rules (#926, api/_skippy/agent/words.ts): the thermostat and the home devices need no model, so
  // they answer in the time the device takes, on every surface, even with the month's budget spent.
  const direct = deps.host ? directAsk(said.message) : null;
  if (direct && deps.host) {
    const got = await callTool(direct.tool, direct.input, deps.host(), { pending: deps.pending ?? null, surface: surface === "desk" ? "desk" : "spoken", said: said.message, via: surface === "phone" ? "phone" : "desk" });
    return json(directReply(got, surface));
  }
  if (!deps.ask || !deps.ledger) return json({ error: "not-set-up" }, 503);

  // Skippy's month (#646): the chat's ledger and the Kernel responder's, under his one cap, a hard stop. Unreadable
  // means no call (fail closed).
  const world = await deps.world();
  const cap = skippyBudget(deps.env.SKIPPY_BUDGET_USD);
  let spent: number;
  try {
    spent = chatMonth(await deps.ledger.load(), deps.now).usd + (deps.kernelLedger ? chatMonth(await deps.kernelLedger.load(), deps.now).usd : 0);
  } catch {
    return json({ error: "not-set-up" }, 503);
  }
  const meter = (usd: number) => ({ usd: Math.round(usd * 10_000) / 10_000, cap, warn: skippyWarn(cap) });
  if (!canChat(spent, cap, deps.host ? AGENT_CEILING_USD : undefined)) {
    return json({ reply: OVER_BUDGET[Math.floor(deps.now / 60_000) % OVER_BUDGET.length], actions: [], capped: true, spend: meter(spent) });
  }

  // What the turn starts knowing. Typed on the Desk: the Desk's lines, the live rooms, the bill and the stack. Spoken
  // (#926): nothing up front, so the first word comes fast; the tools read what the ask needs, room by room.
  const typed = surface === "desk";
  const [desk, rooms, bill, stack] = typed
    ? await Promise.all([deps.desk(world).catch(() => EMPTY_CONTEXT), deps.rooms ? deps.rooms(world).catch(() => "") : Promise.resolve(""), deps.bill ? deps.bill().catch(() => "") : Promise.resolve(""), deps.stack ? deps.stack(wantsStack([said.message, ...said.history.slice(-2).map((t) => t.text)].join(" "))).catch(() => "") : Promise.resolve("")])
    : [EMPTY_CONTEXT, "", "", ""];
  // The agent's turn (#646): the core card of Nikita's memory, the rooms' tools and the taps' store.
  const core = deps.memory ? coreBlock(await deps.memory.load().catch(() => ({ core: "", pages: [], facts: [] }))) : "";
  // What Nikita is looking at (#1027): the metadata always; the screenshot only once Skippy asked to look (look_at_screen)
  // and the browser sent it back. An issue the turn files carries the shot's id and the metadata scrubbed of its private fields.
  const shot = said.shot && deps.shots ? await deps.shots.read(said.shot).catch(() => null) : null;
  const scrubbed = publicScreen(said.screen);
  const attach = shot || scrubbed ? { ...(shot && { shot: said.shot }), ...(scrubbed && { screen: scrubbed }) } : undefined;
  const look = shot ? { image: { data: Buffer.from(shot.bytes).toString("base64"), type: shot.type } } : { canLook: said.look && (surface === "desk" || surface === "room") };
  const ctx: AgentCtx | undefined = deps.host
    ? { surface, message: said.message, core, host: attach ? { ...deps.host(), attach } : deps.host(), pending: deps.pending ?? null, ...look, ...(surface === "phone" && { via: "phone" as const }), ...opts?.agent }
    : undefined;
  let got: Awaited<ReturnType<Ask>>;
  try {
    got = await deps.ask(surface === "phone" ? `${SKIPPY_PROMPT}\n${PHONE_RULES}` : room ? `${SKIPPY_PROMPT}\n${room.rules}` : surface === "call" ? `${SKIPPY_PROMPT}\n${CALL_RULES}` : SKIPPY_PROMPT, chatInput(typed ? [contextLines(desk, deps.now), rooms, bill].filter(Boolean).join("\n") : `Now: ${clockLine(deps.now)}.`, said.history, said.message, stack, said.page, screenLine(said.screen)), ctx);
  } catch {
    return json({ error: "model" }, 502);
  }
  // Skippy asked to look at the screen (#1027): the browser captures the page (no prompt to Nikita), keeps it privately
  // and sends the same words again with the shot's id. Nothing of this pass is kept; what it cost counts.
  if (got.needScreen) {
    if (got.usage) await deps.ledger.add(deps.now, got.usage, got.usd, got.parts).catch(() => undefined);
    return json({ needScreen: true, spend: meter(spent + (got.usd ?? 0)) });
  }
  // A call's quick pass that handed up (#926): the deeper run goes on its own; nothing is kept yet.
  if (got.deeper && !got.answer) {
    if (got.usage) await deps.ledger.add(deps.now, got.usage, got.usd, got.parts).catch(() => undefined);
    return json({ deeper: got.deeper, spend: meter(spent + (got.usd ?? 0)) });
  }
  // Every call that answered counts against the month, usable or not.
  if (got.usage) await deps.ledger.add(deps.now, got.usage, got.usd, got.parts).catch(() => undefined);
  // What the turn read, changed and left waiting for a tap (#646), and the month so far.
  const extra = {
    ...(got.looked?.length && { looked: got.looked.slice(0, 6) }),
    ...(got.did?.length && { did: got.did.slice(0, 4) }),
    // Which tools changed something (#698): the Kitchen's planner reads itself again when a meal tool did.
    ...(got.wrote?.length && { wrote: got.wrote.slice(0, 8) }),
    ...(got.confirm?.length && { confirm: got.confirm.slice(0, 3) }),
    ...(got.tier && { tier: got.tier }),
    spend: meter(spent + (got.usd ?? 0)),
  };
  // A text the agent had drafted (draft_text) goes through the same checks as the chat's own "text" action.
  const answered = got.textAction && got.answer && typeof got.answer === "object" ? { ...(got.answer as object), actions: [...(Array.isArray((got.answer as { actions?: unknown }).actions) ? ((got.answer as { actions: unknown[] }).actions) : []), got.textAction] } : got.answer;
  const first = readReply(answered, desk);
  // On the Senate's floor an answer that can't be read goes to the members (#952), never the hiccup line.
  if (!first) return opts?.agent?.floor ? json({ deeper: "floor", ...extra }) : json({ error: "model" }, 502);
  // A room's voice keeps its turns under its own room (#638), real work for the deeper self aside; a hand-off to "the
  // submind" then goes to that room's.
  const read = room?.log && first.room !== "kernel" ? withRoom(first, room.log) : first;
  // A text to draft (#536) passes the relay's own rules before the Desk ever asks the Mac for it: the skip list, money
  // and legal, codes. One that trips them is dropped, and Skippy says Nikita texts that one himself.
  const asked = read.actions.find((a) => a.kind === "text");
  const ruled = asked?.kind === "text" && askRuled(asked.who, asked.text, skipTermsFrom(deps.env.EMAIL_SKIP_TERMS)) !== null;
  const reply = ruled ? { ...read, actions: read.actions.filter((a) => a.kind !== "text"), reply: `${read.reply.slice(0, 700 - TEXT_RULED.length - 1)} ${TEXT_RULED}` } : read;
  // A texting ask isn't kept in the room log: who and what to say stay out of every log (docs/RELAY-PRIVACY.md).
  if (asked) return json({ reply: reply.reply, actions: reply.actions, room: "relay", ...extra });
  // Kept under its room for the room's Desk page (#273): the question (already through the privacy check), the answer,
  // the room, the time and the model. A failed write never costs Nikita the answer.
  const at = new Date(deps.now).toISOString();
  const id = turnId(at, said.message);
  let kept = false;
  // A call's deeper run answers a turn already kept (#926): nothing new is kept for it.
  if (opts?.keep === false) return json({ ...reply, ...extra });
  if (deps.log) {
    kept = await deps.log
      .add({ id, at, question: said.message, answer: reply.reply, room: reply.room, model: got.model ?? SKIPPY_MODEL, ...(reply.needs && { needs: reply.needs }), ...(surface === "phone" && { via: "phone" as const }), ...(surface === "call" && { via: "voice" as const }), ...(surface === "room" && { via: "room" as const, ...(room?.by && { by: room.by }) }) }, deps.now)
      .then(() => true)
      .catch(() => false);
  }
  // The journal of Skippy's memory (#646): the turn, trimmed; one that trips the memory's rules is left out whole.
  if (deps.memory) await deps.memory.journal({ at, via: surface === "call" ? "talk" : surface, q: said.message, a: reply.reply }, deps.now).catch(() => false);
  // The whole turn, for the Magnificent's thread (#1097); a Talk call's turns come from its finished transcript instead.
  if (deps.chats && surface !== "call") await deps.chats.add([{ at, via: surface, q: said.message, a: reply.reply, ...(surface === "room" && reply.room && { room: reply.room }) }], deps.now).catch(() => 0);
  // A hand-off that was kept carries its turn's id (#341), so the Desk's chat can wait for the answer in place.
  return json({ ...(reply.needs && kept ? { ...reply, turn: id } : reply), ...extra });
}

/**
 * The Skippy probe (#955, api/_skippy/probe.ts): the upkeep run's battery of real asks, each through Skippy's own turn
 * on the surface it names, as a dry run: the tools reach a dry host (reads real, writes recorded, never sent), a Yes
 * tap waits in a throwaway store, and nothing is kept (no room log, no journal, no hand-off). Past the month's warn line
 * only the rules' asks (free) still run. Only the graded verdict comes back, never the reply's words.
 */
export async function probe(request: Request, deps: ChatDeps): Promise<Response> {
  const token = probeToken(deps.env);
  if (!token || !deps.deskKey || !deps.store || !deps.host || !deps.ledger) return json({ error: "not-set-up" }, 503);
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !keyMatches(auth.slice(7).trim(), token)) return json({ error: "unauthorized" }, 401);
  const got = readProbe(await request.json().catch(() => null));
  if (!got) return json({ error: "bad-request" }, 400);
  const live = deps.host;
  const ledger = deps.ledger;
  const cap = skippyBudget(deps.env.SKIPPY_BUDGET_USD);
  const turns: ProbeTurn[] = [];
  const history: { who: "nikita" | "skippy"; text: string }[] = [];
  for (const message of got.asks) {
    const rec: DryRecord = { wouldRun: [] };
    const now = Date.now();
    // Under the warn line only: past it, an ask the rules don't settle (a model call) isn't sent.
    const spent = await skippySpent(ledger, deps.kernelLedger ?? null, now).catch(() => Infinity);
    if (spent >= skippyWarn(cap) && !directAsk(message)) {
      turns.push({ status: 200, skipped: "budget", ms: 0, chars: 0, flags: [], looked: [], wrote: [], wouldRun: [], taps: 0 });
      break;
    }
    const dry: ChatDeps = { ...deps, now, host: () => dryHost(live(), rec), pending: dryPending(rec), log: null, chats: null, memory: deps.memory ? dryMemory(deps.memory, () => undefined) : null };
    const said = { message: message.slice(0, 600), history: history.slice(-8), page: "", screen: null, shot: "", look: false };
    const started = performance.now();
    let res: Response;
    let handedUp = false;
    if (got.surface === "call") {
      res = await skippyTurn(said, dry, deps.store, "probe", "call", undefined, { agent: { fastOnly: true } });
      const first = (await res.clone().json().catch(() => ({}))) as { deeper?: unknown };
      if (res.ok && (first.deeper === "talk" || first.deeper === "hard")) {
        handedUp = true;
        res = await skippyTurn(said, { ...dry, now: Date.now() }, deps.store, "probe", "call", undefined, { agent: { start: first.deeper }, keep: false });
      }
    } else {
      res = await skippyTurn(said, dry, deps.store, "probe", got.surface);
    }
    const ms = performance.now() - started;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    turns.push({ ...gradeAnswer(res.status, body, ms, rec), ...(handedUp && { handedUp: true }) });
    if (!res.ok || typeof body.reply !== "string") break;
    history.push({ who: "nikita", text: message }, { who: "skippy", text: body.reply });
  }
  return json({ turns });
}

/** Where the quick tier's tools belong. */
const DIRECT_ROOM = "haven";

/**
 * The quick tier's answer (#926): the tool's own words (the thermostat's line, the device's spoken confirmation, or
 * what failed), shaped like any reply. A device runs on every surface, typed on the Desk too (#1015). A finished
 * device action from the phone is quiet (#652): a notification, not a voice.
 */
function directReply(got: CallResult, surface: Surface): Record<string, unknown> {
  const tool = got.tool;
  if (got.ok && "confirm" in got) {
    return { reply: `Tap Yes and it goes: ${got.confirm.summary}.`, actions: [], room: DIRECT_ROOM, confirm: [got.confirm], tier: "rules" };
  }
  const reply = plainLine(got.text, 700) || "That didn't answer just now.";
  const changed = got.ok && tool && tool.effect !== "read";
  const quiet = surface === "phone" && changed && !got.warned && !/wet food feeder's lid is open|closing itself/i.test(reply);
  return {
    reply,
    actions: [],
    room: DIRECT_ROOM,
    tier: "rules",
    ...(got.ok && tool?.effect === "read" && { looked: [tool.title] }),
    ...(changed && "did" in got && got.did && { did: [got.did] }),
    ...(changed && tool && { wrote: [tool.name] }),
    ...(quiet && { quiet: true }),
  };
}

/** A reply refiled under a room: the room, and a hand-off to "the submind" re-pointed at that room's. */
function withRoom(r: SkippyReply, room: LogRoom): SkippyReply {
  const needs = r.needs && r.needs !== "skippy" ? (handoffTo("submind", room) ?? "skippy") : r.needs;
  return { ...r, room, ...(needs && { needs }) };
}

/** What the phone gets back from a Skippy turn: the reply, whether it was handed off, and whether the month's cap stopped it. */
export interface PhoneTurn {
  reply: string;
  handedOff: boolean;
  capped?: boolean;
  /** Why there is no reply: the privacy check held it, the pace, or the chat isn't working here. */
  error?: "private" | "slow-down" | "not-set-up" | "model" | "text";
  /** The tools that changed something, and what they did (#698), for the page to read itself again. */
  wrote?: string[];
  did?: string[];
  /** A finished device action from the phone (#652): shown, not spoken. */
  quiet?: boolean;
  /** Which tier answered (#926): "rules", "fast", "talk" or "hard". */
  tier?: string;
  /** On the Senate's floor: the words were a remark on the debate, for the members to answer. */
  floor?: boolean;
  /** Skippy asked to look at the screen (#1027): the browser captures the page and asks again with the shot. */
  needScreen?: boolean;
}

/**
 * Hey Skippy from the iPhone (#627, api/_haven/route.ts): the capture endpoint has already checked the phone's key, so
 * this is the Desk's own turn with the phone as the surface: the same prompt plus PHONE_RULES (one or two spoken
 * sentences, no buttons), the same model router, budget caps, room log (marked `via: "phone"`) and hand-offs. Paced
 * per phone, beside the phone's own 30 an hour. `history` is the phone's last few turns, kept ten quiet minutes.
 */
export async function phoneAnswer(message: string, phoneId: string, history: { who: "nikita" | "skippy"; text: string }[] = [], deps: ChatDeps = defaultDeps()): Promise<PhoneTurn> {
  if (!deps.deskKey || !deps.store) return { reply: "", handedOff: false, error: "not-set-up" };
  // The phone's last few turns (api/_haven/convo.ts) are its history, as the Desk's browser sends its own.
  const said = readChat({ message, history });
  if (!said) return { reply: "", handedOff: false, error: "model" };
  return turnOf(await skippyTurn(said, deps, deps.store, `phone:${phoneId}`, "phone"));
}

/**
 * A room's voice (#638, api/_skippy/roomroute.ts): Nikita's words from the mic on a room's Desk page, after the route has
 * checked the passkey session, answered by Desk Skippy's own chat as the room's submind: the same prompt plus the
 * room's rules (roomRules), the same router, budget caps, pace (per passkey, the Desk chat's own), room log (marked
 * `via: "room"`, `by` the submind) and hand-offs. The reply comes back whole; the route cuts it for speaking.
 */
export async function roomAnswer(message: string, history: { who: "nikita" | "skippy"; text: string }[], passkey: string, room: RoomTurn, deps: ChatDeps = defaultDeps()): Promise<PhoneTurn> {
  if (!deps.deskKey || !deps.store) return { reply: "", handedOff: false, error: "not-set-up" };
  const said = readChat({ message, history, ...(room.page && { page: room.page }), ...(room.screen !== undefined && { screen: room.screen }), ...(room.shot && { shot: room.shot }), ...(room.look === false && { look: false }) });
  if (!said) return { reply: "", handedOff: false, error: "model" };
  const res = await skippyTurn(said, deps, deps.store, passkey, "room", room, room.floor ? { agent: { floor: true } } : undefined);
  return turnOf(res);
}

/** A turn's answer as the phone and a room's voice read it. */
async function turnOf(res: Response): Promise<PhoneTurn> {
  const body = (await res.json().catch(() => ({}))) as { reply?: unknown; needs?: unknown; capped?: unknown; error?: unknown; actions?: { kind?: unknown }[]; wrote?: unknown; did?: unknown; quiet?: unknown; tier?: unknown; deeper?: unknown; needScreen?: unknown };
  if (res.ok && body.deeper === "floor") return { reply: "", handedOff: false, floor: true };
  if (res.ok && body.needScreen === true) return { reply: "", handedOff: false, needScreen: true };
  if (res.status === 422) return { reply: "", handedOff: false, error: "private" };
  if (res.status === 429) return { reply: "", handedOff: false, error: "slow-down" };
  if (res.status === 503) return { reply: "", handedOff: false, error: "not-set-up" };
  if (!res.ok || typeof body.reply !== "string") return { reply: "", handedOff: false, error: "model" };
  // A text to draft needs the Desk's card to show it before anything goes; a voice can't show one.
  if (Array.isArray(body.actions) && body.actions.some((a) => a?.kind === "text")) return { reply: body.reply, handedOff: false, error: "text" };
  const words = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : []);
  const wrote = words(body.wrote);
  return {
    reply: body.reply,
    handedOff: typeof body.needs === "string",
    ...(body.capped === true && { capped: true }),
    ...(wrote.length && { wrote, did: words(body.did) }),
    ...(body.quiet === true && { quiet: true }),
    ...(typeof body.tier === "string" && { tier: body.tier }),
  };
}

/* ── A Talk call's asks (#926): the same brain, quick on the call, deeper on its own ── */

/** What a call's ask comes back as: the answer, or how deep the rest must go (the deeper run answers into the call). */
export type CallTurn = { reply: string; tier?: string } | { deeper: "talk" | "hard" } | { error: NonNullable<PhoneTurn["error"]> };

/**
 * A Talk call's ask (api/_skippy/toolroute.ts, `hand_to_kernel`): the call's tool token is bound to the passkey that
 * started the call, so this is that passkey's own turn, paced with the Desk's chat: the rules, then the fast tier only.
 * When the fast tier hands up, the answer says how deep, and the caller starts the deeper run (`deepAnswer`).
 */
export async function callAnswer(message: string, passkey: string, deps: ChatDeps = defaultDeps(), screen?: string): Promise<CallTurn> {
  if (!deps.deskKey || !deps.store) return { error: "not-set-up" };
  // What was on screen when the call started (#1027), kept with the call's token; never a screenshot on a call.
  const said = readChat({ message, history: [], ...(screen && { screen }) });
  if (!said) return { error: "model" };
  const res = await skippyTurn(said, deps, deps.store, passkey, "call", undefined, { agent: { fastOnly: true } });
  const body = (await res.clone().json().catch(() => ({}))) as { deeper?: unknown };
  if (res.ok && (body.deeper === "talk" || body.deeper === "hard")) return { deeper: body.deeper };
  const turn = await turnOf(res);
  if (turn.error) return { error: turn.error };
  return { reply: spokenOf(turn.reply, false), ...(turn.tier && { tier: turn.tier }) };
}

/**
 * The deeper run of a call's ask (#926): Sonnet, or Opus for judgment, with every room's tools, the core card and the
 * memory's pages on demand, under Skippy's month; no Desk lines up front and no days of turns. It answers the call's
 * kept turn (api/_skippy/kernelroute.ts, from the hand-off's own trigger). A failure says what failed.
 */
export async function deepAnswer(message: string, depth: "talk" | "hard" = "talk", deps: ChatDeps = defaultDeps()): Promise<string> {
  if (!deps.deskKey || !deps.store) return "My deeper mind isn't switched on here, so that one has to wait for the Desk.";
  const said = readChat({ message, history: [] });
  if (!said) return "That ask didn't come through whole; say it again.";
  const res = await skippyTurn(said, { ...deps, store: deps.store }, deps.store, "call:deep", "call", undefined, { agent: { start: depth }, keep: false });
  const turn = await turnOf(res);
  if (turn.error === "private") return "That had something private in it, so it went nowhere.";
  if (turn.error === "slow-down") return "Too many asks at once; that one has to wait a minute.";
  if (turn.error) return "My deeper mind's model didn't answer just now; ask again in a minute.";
  if (turn.capped) return turn.reply;
  return spokenOf(turn.reply, false);
}
