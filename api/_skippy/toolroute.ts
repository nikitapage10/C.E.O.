/**
 * The call's live lookups (#479): GET /api/skippy-tools?read=<room>, called by ElevenLabs mid-call when Skippy or one
 * of his subminds uses a read tool (api/_skippy/voicecrew.ts). Azure only (azure/src/index.ts).
 *
 * Only a live call's own tool token opens it (`x-ceo-voice-tool`, api/_skippy/voicetoken.ts): signed by this Desk's
 * key, unexpired, kept with its call and not ended. The site gate lets exactly this method and path through on a
 * signed, unexpired token (api/_site/gate.ts); this handler checks it fully again. Anything else is 401, with no
 * hint of which part failed. At most READS_PER_CALL lookups per call.
 *
 * GET ?read=<room> → 200 { read, text }: the room as a few short lines (api/_skippy/voicereads.ts), or { slow: true }
 *   past READ_BUDGET_MS. Never cached; its money (the positions and the bill) leaves only to the call that asked.
 * POST ?act=kernel { ask } → the hand_to_kernel tool (#480): files the ask in the `kernel` room's log, handed to
 *   Skippy's own thread, as the typed chat files one, and notes it with the call (at most MAX_HANDOFFS).
 * GET ?read=answers → the check_answers tool: this call's hand-offs and their answers so far (interim or final).
 * GET ?read=player_news[&player=<name>] → the player_news tool (#491): Sleeper's injury status and FantasyPros' injury
 *   report and news on one player, or the C.E.O.'s roster (api/_skippy/voicelookups.ts).
 * POST ?act=web { query } → the web_search tool (#491): the typed chat's web lookup, kept per call while it runs.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../_blob.js";
import { setupList } from "../foundry.js";
import type { SetupStatus } from "../_desk/setup.js";
import { readEmailStatus, type EmailStatus } from "../_email/status.js";
import * as emailRoute from "../_email/route.js";
import * as exchangeRoute from "../_exchange/route.js";
import { keyFrom, readPositions } from "../_exchange/positions.js";
import type { PmBoard, PmPositions } from "../_exchange/types.js";
import * as greenRoute from "../_green/route.js";
import type { GreenAnalysis, GreenBoard } from "../_green/types.js";
import * as foundryFeed from "../foundry-feed.js";
import type { JobRun, OpenPull } from "../foundry-feed.js";
import { elevenFromEnv } from "../_world/story.js";
import { pickStore } from "../_world/store.js";
import type { WorldState } from "../_world/types.js";
import { foundryIssues } from "../skippy.js";
import { contextLines, deskContext } from "./context.js";
import { liveRoomReads } from "./roomReads.js";
import { takeLine } from "./rooms.js";
import { creditsReader } from "./voice.js";
import { billText, boilerText, capLines, said, exchangeText, foundryText, greenText, isRead, positionsText, relayText, type BillInput, type ReadName } from "./voicereads.js";
import { BlobCrewStore, MAX_HANDOFFS, TOOL_HEADER, checkToolToken, noteHandoff, type CrewStore, type TokenCheck } from "./voicetoken.js";
import { BlobRoomLog, turnId, type LoggedTurn, type RoomLog } from "./log.js";
import { ponderLine } from "./ponder.js";
import { privateParts } from "../_privacy.js";
import { PLAYERS_PATH, keptOrRead, pickGreenStore } from "../_green/cache.js";
import { fpKey, readFpPlayerNews } from "../_green/fantasypros.js";
import { readPlayers } from "../_green/sleeper.js";
import { BlobChatLedger, canChat, chatMonth, skippyBudget } from "./budget.js";
import { monthTotals, worldBudget } from "../_world/budget.js";
import { claudeKey } from "../_world/claude.js";
import { NEWS_PENDING, NO_MORE_LINES, SAY_WAITING_LINE, STILL_SEARCHING, claudeSearch, cleanPlayer, isEmptyLookup, mergeStatusNews, playerNews, waitingLine, webSearch, type PlayerSources, type WebDeps } from "./voicelookups.js";
import { liveScores } from "./sports.js";

export const PATH = "/api/skippy-tools";
/** How long a lookup may take before the route answers "slow" (ElevenLabs' tool timeout is five seconds). */
export const READ_BUDGET_MS = 4_300;
/** What the call hears when a room is too slow: the agent then answers from what it already knows. */
export const SLOW_TEXT = "That data is slow right now. Don't guess and don't send Nikita anywhere: hand the question to hand_to_kernel and say one short in-character line about it, then stop until the answer is put into the call.";
/** The most lookups one call may make. */
export const READS_PER_CALL = 60;

/** Each room's read, as plain data (the same reads the Desk's room pages use). Null when it didn't answer. */
export interface RoomSources {
  green(): Promise<GreenBoard | null>;
  /** The Commentator's latest weekly take (#478's read), when kept. */
  take?(): Promise<GreenAnalysis | null>;
  exchange(): Promise<PmBoard | null>;
  positions(): Promise<PmPositions | null>;
  email(): Promise<EmailStatus | null>;
  /** The typed chat's Foundry lines (api/_skippy/context.ts). */
  foundryBoard(): Promise<string>;
  jobs(): Promise<{ jobs: JobRun[] | null; open: OpenPull[] | null }>;
  world(): Promise<WorldState | null>;
  bill(): Promise<BillInput | null>;
  /** The player lookup's sources (#491). */
  players?: PlayerSources;
  /** The web search (#491). */
  web?: WebDeps;
  /** The live scoreboard (#537); ESPN's by default. */
  scores?: (league: string | null, team: string | null, now: number) => Promise<string>;
}

export interface ToolDeps {
  deskKey: string;
  crew: CrewStore | null;
  sources: RoomSources;
  /** The room log, for the Kernel's hand-offs (#480). */
  log?: RoomLog | null;
  now: number;
  /** For tests: the read budget (ms). */
  budgetMs?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

/** One room's text from its sources. */
export async function readText(read: ReadName, s: RoomSources, now: number): Promise<string> {
  const q = <T>(p: Promise<T>, empty: T) => p.catch(() => empty);
  switch (read) {
    case "green": {
      const [board, take] = await Promise.all([q(s.green(), null), s.take ? q(s.take(), null) : null]);
      const text = greenText(board);
      return board && take ? capLines([text, takeLine(take)]) : text;
    }
    case "exchange":
      return exchangeText(await q(s.exchange(), null));
    case "exchange_positions":
      return positionsText(await q(s.positions(), null));
    case "relay":
      return relayText(await q(s.email(), null));
    case "foundry": {
      const [board, { open }] = await Promise.all([q(s.foundryBoard(), ""), q(s.jobs(), { jobs: null, open: null })]);
      return foundryText(board, open);
    }
    case "boiler": {
      const [{ jobs, open }, world, email, green, exchange] = await Promise.all([q(s.jobs(), { jobs: null, open: null }), q(s.world(), null), q(s.email(), null), q(s.green(), null), q(s.exchange(), null)]);
      return boilerText({ jobs, open, world: world ? { step: world.step, at: world.at } : null, email, green, exchange, now });
    }
    case "voice_bill": {
      const b = await q(s.bill(), null);
      return b ? billText(b) : "ElevenLabs isn't set up for the plan's credits right now.";
    }
  }
}

/** Lookups counted per call, in this instance (a call stays on one instance or two; the cap is a seatbelt). */
const counted = new Map<string, number>();

export async function handle(request: Request, deps: ToolDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method" }, 405);
  const token = request.headers.get(TOOL_HEADER);
  const check = await checkToolToken(token, deps.deskKey, deps.crew, deps.now);
  if (!check.ok) return json({ error: "not-allowed" }, check.why === "store" ? 503 : 401);
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const n = (counted.get(check.hash) ?? 0) + 1;
  if (counted.size > 50) counted.clear();
  counted.set(check.hash, n);
  if (n > READS_PER_CALL) return json({ error: "slow-down" }, 429);
  const budget = deps.budgetMs ?? READ_BUDGET_MS;
  if (request.method === "POST") {
    const act = url.searchParams.get("act");
    if (keys.length !== 1 || url.searchParams.getAll("act").length !== 1 || (act !== KERNEL_ACT && act !== WEB_ACT)) return json({ error: "bad-request" }, 400);
    if (act === WEB_ACT) {
      const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
      if (!deps.sources.web) return json({ read: "web", text: "Web search isn't set up on this call; hand the question to hand_to_kernel." });
      const text = await webSearch(body?.query, check.hash, deps.sources.web, deps.now, budget - 300);
      return json(await settle("web", text, cleanQueryText(body?.query), deps, check));
    }
    return handOff(request, deps, check);
  }
  const read = url.searchParams.get("read");
  if (url.searchParams.getAll("read").length !== 1) return json({ error: "bad-request" }, 400);
  if (read === PLAYER_READ) {
    const extra = keys.filter((k) => k !== "read");
    if (extra.some((k) => k !== "player") || url.searchParams.getAll("player").length > 1) return json({ error: "bad-request" }, 400);
    if (!deps.sources.players) return json({ read, text: "Player news isn't set up on this call; hand the question to hand_to_kernel." });
    const player = cleanPlayer(url.searchParams.get("player"));
    // A named player gets the listing and the fresh-news search in one answer (#537).
    const web = player && deps.sources.web ? deps.sources.web : null;
    const [listing, news] = await Promise.all([
      withBudget(playerNews(player, deps.sources.players, deps.now, budget - 400), budget),
      web ? withBudget(webSearch(`${player} injury status latest news`, check.hash, web, deps.now, budget - 700), budget) : Promise.resolve(null),
    ]);
    const text = listing === SLOW_TEXT ? listing : mergeStatusNews(listing, news === SLOW_TEXT ? null : news);
    return json(await settle(read, text, player ? `Is ${player} playing? What is his injury status and the latest news?` : "Which players on the C.E.O.'s roster are hurt, and what is the latest?", deps, check));
  }
  if (read === SPORTS_READ) {
    const extra = keys.filter((k) => k !== "read");
    if (extra.some((k) => k !== "league" && k !== "team") || url.searchParams.getAll("league").length > 1 || url.searchParams.getAll("team").length > 1) return json({ error: "bad-request" }, 400);
    const league = url.searchParams.get("league");
    const team = url.searchParams.get("team");
    const text = await withBudget((deps.sources.scores ?? liveScores)(league, team, deps.now), budget);
    return json(await settle(read, text, `What is the live score or game status for ${team || "today's games"}${league ? ` in ${league}` : ""} right now? Use the live scoreboard, not last night's final.`, deps, check));
  }
  if (keys.length !== 1) return json({ error: "bad-request" }, 400);
  if (read === ANSWERS_READ) return json({ read, text: await answersText(deps, check.handoffs) });
  if (!isRead(read)) return json({ error: "bad-request" }, 400);
  const text = await withBudget(readText(read, deps.sources, deps.now), budget);
  return json({ read, text, ...(text === SLOW_TEXT && { slow: true }) });
}

/** A lookup's text, or SLOW_TEXT past the budget. */
function withBudget(work: Promise<string>, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(SLOW_TEXT), ms);
  });
  return Promise.race([work, slow]).finally(() => clearTimeout(timer));
}

/* ── The Kernel (#480): hand an ask to Skippy's own thread from the call, and read its answers back ── */

/** POST ?act=kernel { ask }: the hand_to_kernel tool. */
export const KERNEL_ACT = "kernel";
/** POST ?act=web { query }: the web_search tool (#491). */
export const WEB_ACT = "web";
/** GET ?read=player_news[&player=]: the player_news tool (#491). */
export const PLAYER_READ = "player_news";
/** GET ?read=sports[&league=&team=]: the live_scores tool (#537), ESPN's scoreboard. */
export const SPORTS_READ = "sports";
/** GET ?read=answers: the check_answers tool. */
export const ANSWERS_READ = "answers";
/** The longest ask handed over (the typed chat's message cap). */
export const ASK_MAX = 600;
/**
 * What the Kernel's turn says Skippy answered on the call: in character (#498), it shows on the Desk under Asked Skippy.
 * The tool answers below tell the voice what to do without the plumbing's words, so none of them is said aloud.
 */
export const CALL_REPLY = "Asked on a Talk call. Consulting the deeper me; the answer lands in the chat.";

const UNREACHABLE = "Your deeper mind can't be reached from the call right now; say, in character, to type it into the chat.";
/** How far back check_answers looks at Nikita's earlier calls (#498): what he asked yesterday is still his to hear. */
export const EARLIER_CALLS_MS = 48 * 60 * 60_000;
/** The most earlier asks it reads back, newest first. */
export const EARLIER_MAX = 4;

async function handOff(request: Request, deps: ToolDeps, check: Extract<TokenCheck, { ok: true }>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ask?: unknown } | null;
  const ask = typeof body?.ask === "string" ? body.ask.replace(/\s+/g, " ").trim().slice(0, ASK_MAX) : "";
  if (!ask) return json({ error: "bad-request" }, 400);
  return json(await fileHandoff(ask, deps, check));
}

/**
 * Files an ask with the deeper mind for the call. The result's text tells the agent what to do next: one waiting line
 * (only the first time a question needs one, #537), then silence until the answer lands in the call.
 */
async function fileHandoff(ask: string, deps: ToolDeps, check: Extract<TokenCheck, { ok: true }>): Promise<{ ok: boolean; text: string; turn?: string }> {
  // The same check as the typed chat: a private-looking ask is never kept or handed on.
  if (privateParts(ask).length) return { ok: false, text: "That ask has something private in it, so it wasn't handed over. Ask Nikita to say it without the private part, or to type it in the chat." };
  if (!deps.log || !deps.crew) return { ok: false, text: UNREACHABLE };
  if (check.handoffs.length >= MAX_HANDOFFS) return { ok: false, text: "This call has passed on all it may; say, in character, to type the rest into the chat." };
  const at = new Date(deps.now).toISOString();
  const id = turnId(at, ask);
  try {
    await deps.log.add({ id, at, question: ask, answer: CALL_REPLY, room: "kernel", model: "voice", needs: "skippy" }, deps.now);
    await noteHandoff(deps.crew, check.hash, id, deps.now);
  } catch {
    return { ok: false, text: UNREACHABLE };
  }
  const line = waitingLine(check.hash, deps.now)
    ? `Say one short in-character line, like "${ponderLine(id).replace(/…$/, "")}" (never "thread", "hand-off", "Kernel" or "crew"), then stop.`
    : "You already said this question's waiting line: say nothing now, and stop.";
  return { ok: true, turn: id, text: `Passed on to your deeper mind. ${line} The answer is put into the call the moment it lands; don't call check_answers for it.` };
}

const cleanQueryText = (raw: unknown): string => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, ASK_MAX) : "");

/**
 * A lookup's result as the agent hears it (#537). Empty (nothing usable) goes straight to your deeper mind, so Nikita
 * never hears that the tool failed; a wait carries the question's one waiting line.
 */
async function settle(read: string, text: string, ask: string, deps: ToolDeps, check: Extract<TokenCheck, { ok: true }>): Promise<Record<string, unknown>> {
  if (text !== SLOW_TEXT && !isEmptyLookup(text)) {
    const wait = text === STILL_SEARCHING || text.endsWith(NEWS_PENDING);
    return { read, text: wait ? `${text}${waitingLine(check.hash, deps.now) ? SAY_WAITING_LINE : NO_MORE_LINES}` : text };
  }
  if (ask) {
    const filed = await fileHandoff(ask, deps, check);
    if (filed.ok) return { read, text: filed.text, escalated: true };
  }
  return { read, text, ...(text === SLOW_TEXT && { slow: true }) };
}

/** One ask's line: its question and where its answer stands. */
function answerLine(t: LoggedTurn, earlier: boolean): string {
  const q = `${earlier ? "Earlier call, " : ""}"${said(t.question, 120)}"`;
  if (!t.followUp) return `${q}: no answer yet.`;
  // The responder's interim "still pondering" (#501) is no answer (#506): said as such, so it is never read out as one.
  if (t.followUp.final === false) return t.followUp.from === "kernel-agent" ? `${q}: no answer yet, still being worked out.` : `${q}: not final yet, so far: ${said(t.followUp.text, 400)}`;
  return `${q}: answered: ${said(t.followUp.text, 400)}`;
}

/**
 * The answers to what Nikita asked on this call so far, interim or final, then to what he asked on his calls in the
 * last two days (#498): an answer that landed after an earlier call hung up is still his to hear. Lines only.
 */
async function answersText(deps: ToolDeps, handoffs: string[]): Promise<string> {
  if (!deps.log) return "Your deeper mind can't be read right now.";
  const turns = await deps.log.list("kernel", deps.now).catch(() => null);
  if (!turns) return "Your deeper mind can't be read right now.";
  const mine = new Set(handoffs);
  const now = handoffs.map((h) => turns.find((x) => x.id === h)).filter((t): t is LoggedTurn => !!t).map((t) => answerLine(t, false));
  const earlier = turns
    .filter((t) => t.model === "voice" && !mine.has(t.id) && deps.now - Date.parse(t.at) <= EARLIER_CALLS_MS)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, EARLIER_MAX)
    .map((t) => answerLine(t, true));
  if (!now.length && !earlier.length) return "Nothing asked of your deeper mind on this call or the last few.";
  return capLines([...now, ...earlier]) || "No answers yet.";
}

/* ── The live sources ── */

const bodyOf = async <T>(res: Response | Promise<Response>): Promise<T | null> => {
  const r = await res;
  return r.ok ? ((await r.json().catch(() => null)) as T | null) : null;
};
const local = (path: string) => new Request(`https://localhost${path}`);

let posKept: { at: number; value: PmPositions } | null = null;

export function liveSources(env: Record<string, string | undefined> = process.env): RoomSources {
  const feed = () => bodyOf<{ jobs?: unknown; open?: unknown }>(foundryFeed.GET(local("/api/foundry-feed")));
  // #478's reads where they fit: the Commentator's take and Relay's counts straight from their stores.
  const rooms = liveRoomReads(env);
  return {
    green: () => bodyOf<GreenBoard>(greenRoute.GET(local(greenRoute.PATH))),
    ...(rooms.take && { take: rooms.take }),
    exchange: () => bodyOf<PmBoard>(exchangeRoute.GET(local(exchangeRoute.PATH))),
    positions: async () => {
      const key = keyFrom(env);
      if ("error" in key) return { ok: true, state: "waiting", reason: key.error };
      const now = Date.now();
      if (posKept && now - posKept.at < 60_000) return posKept.value;
      const value = await readPositions((u, i) => fetch(u, i), key, now);
      posKept = { at: now, value };
      return value;
    },
    email: async () => (rooms.relay ? rooms.relay() : readEmailStatus((await bodyOf<{ status?: unknown }>(emailRoute.GET(local("/api/email?view=status"))))?.status)),
    foundryBoard: async () => {
      const [{ open, shipped }, setup, world] = await Promise.all([
        foundryIssues().catch(() => ({ open: [], shipped: [] })),
        setupList().catch((): SetupStatus | null => null),
        pickStore(env)
          ?.loadState()
          .catch(() => null) ?? Promise.resolve(null),
      ]);
      return contextLines(deskContext(open, shipped, setup, world ?? null), Date.now());
    },
    jobs: async () => {
      const f = await feed().catch(() => null);
      // The job board is [{ file, run }], run trimmed to JobRun (or null when the workflow has none).
      const jobs = Array.isArray(f?.jobs) ? (f.jobs as { run?: JobRun | null }[]).map((j) => j?.run).filter((r): r is JobRun => !!r && typeof r.name === "string") : null;
      return { jobs, open: Array.isArray(f?.open) ? (f.open as OpenPull[]) : null };
    },
    world: async () => (await pickStore(env)?.loadState()) ?? null,
    players: playerSources(env),
    web: webDeps(env),
    bill: async () => {
      const eleven = elevenFromEnv(env);
      return eleven ? { credits: await creditsReader(eleven.key)() } : null;
    },
  };
}

const DAY_MS = 24 * 60 * 60_000;
/** FantasyPros' news and injuries, kept a few minutes per warm instance, so a call's follow-ups don't re-read them. */
let fpKept: { tag: string; at: number; value: Awaited<ReturnType<typeof readFpPlayerNews>> } | null = null;
const FP_KEEP_MS = 5 * 60_000;

/** The player lookup's live sources (#491): the Green's board, Sleeper's kept players list and FantasyPros live. */
export function playerSources(env: Record<string, string | undefined>): PlayerSources {
  const fetcher = (u: string, i?: RequestInit) => fetch(u, i);
  return {
    board: () => bodyOf<GreenBoard>(greenRoute.GET(local(greenRoute.PATH))),
    // The same kept copy the Green reads (tag "nfl", a day fresh), so this rarely reads Sleeper itself.
    players: async () => {
      const k = await keptOrRead(pickGreenStore(env), PLAYERS_PATH, "nfl", DAY_MS, 7 * DAY_MS, Date.now(), () => readPlayers(fetcher));
      return { value: k.value, at: k.at };
    },
    fp: async (season, week) => {
      const key = fpKey(env);
      if (!key) return null;
      const tag = `${season}-${week}`;
      if (fpKept && fpKept.tag === tag && Date.now() - fpKept.at < FP_KEEP_MS) return fpKept.value;
      const value = await readFpPlayerNews(fetcher, key, season, week, 3_000);
      fpKept = { tag, at: Date.now(), value };
      return value;
    },
  };
}

/** The web search's live deps (#491): Claude's key, and the typed chat's ledger and month budget. */
export function webDeps(env: Record<string, string | undefined>): WebDeps {
  const key = claudeKey(env);
  const blob = pickBlob(env);
  const ledger = blob ? new BlobChatLedger(blob) : null;
  return {
    search: key && ledger ? claudeSearch(key) : null,
    canSpend: async () => {
      if (!ledger) return false;
      const now = Date.now();
      const world = await pickStore(env)
        ?.loadState()
        .catch(() => null);
      return canChat(chatMonth(await ledger.load(), now).usd, monthTotals(world ?? { spend: {} }, now).usd, skippyBudget(env.SKIPPY_BUDGET_USD, worldBudget(env.WORLD_BUDGET_USD)));
    },
    addSpend: async (usage, usd) => {
      if (ledger) await ledger.add(Date.now(), usage, usd);
    },
  };
}

export function GET(request: Request): Promise<Response> {
  const env = process.env;
  const blob = pickBlob(env);
  return handle(request, { deskKey: env.FOUNDRY_DESK_KEY ?? "", crew: blob ? new BlobCrewStore(blob) : null, sources: liveSources(env), log: blob ? new BlobRoomLog(blob) : null, now: Date.now() });
}

export const POST = GET;
