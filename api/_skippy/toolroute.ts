/**
 * The call's live lookups (#479): GET /api/skippy-tools?read=<room>, called by ElevenLabs mid-call when Skippy or one
 * of his subminds uses a read tool (api/_skippy/voicecrew.ts). Azure only (azure/src/index.ts).
 *
 * Only a live call's own tool token opens it (`x-ceo-voice-tool`, api/_skippy/voicetoken.ts): signed by this Desk's
 * key, unexpired, kept with its call and not ended. The site gate lets exactly this method and path through on a
 * signed, unexpired token (api/_site/gate.ts); this handler checks it fully again. Anything else is 401, with no
 * hint of which part failed. At most READS_PER_CALL lookups per call.
 *
 * GET ?read=<room> → 200 { read, text }: the room as a few short lines (api/_skippy/voicereads.ts; `haven` is the
 *   home, the thermostat first, instant from the kept reading), or { slow: true }
 *   past READ_BUDGET_MS. Never cached; its money (the positions and the bill) leaves only to the call that asked.
 * POST ?act=kernel { ask } → the hand_to_kernel tool (#480; since #926 Skippy's one brain on the call): the ask runs as
 *   the passkey that started the call (its tool token is bound to it, voicetoken.ts), through the same rules tier and
 *   fast tier as every surface, with every room's reads and actions, inside the tool's time budget, and the answer
 *   comes back in the tool result to be said at once. Only when the fast tier hands up (or runs out of time) is the
 *   ask filed in the `kernel` room's log and noted with the call (at most MAX_HANDOFFS): its deeper run (Sonnet or
 *   Opus with the same tools, api/skippy.ts deepAnswer) starts from that write and its answer is put into the call.
 *   Every hand_to_kernel question is timed from its arrival to its answer (#1065, answertimes.ts): the quick pass's
 *   when it is said, a passed-on one's when it is kept (calldeliver.ts). Milliseconds and the kind only.
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
import { answerDeps, callAnswer, deepAnswer, foundryIssues, keepAnswer, type CallTurn } from "../skippy.js";
import { contextLines, deskContext } from "./context.js";
import { liveRoomReads } from "./roomReads.js";
import { takeLine } from "./rooms.js";
import { creditsReader } from "./voice.js";
import { billText, boilerText, capLines, said, exchangeText, foundryText, greenText, isRead, positionsText, relayText, type BillInput, type ReadName } from "./voicereads.js";
import { BlobCrewStore, MAX_HANDOFFS, TOOL_HEADER, checkToolToken, noteHandoff, type CrewStore, type TokenCheck } from "./voicetoken.js";
import { BlobRoomLog, CALL_HARD, CALL_MODEL, isCallAsk, turnId, type LoggedTurn, type RoomLog } from "./log.js";
import { privateParts } from "../_privacy.js";
import { PLAYERS_PATH, keptOrRead, pickGreenStore } from "../_green/cache.js";
import { fpKey, readFpPlayerNews } from "../_green/fantasypros.js";
import { readPlayers } from "../_green/sleeper.js";
import { BlobChatLedger, KERNEL_LEDGER_PATH, canChat, skippyBudget, skippySpent } from "./budget.js";
import { claudeKey } from "../_world/claude.js";
import { NEWS_PENDING, NO_MORE_LINES, SAY_WAITING_LINE, STILL_SEARCHING, claudeSearch, cleanPlayer, isEmptyLookup, mergeStatusNews, playerNews, runningSearch, waitingLine, webSearch, type PlayerSources, type WebDeps } from "./voicelookups.js";
import { deliverCallAnswer, type CallJob } from "./calldeliver.js";
import type { AnswerKind } from "./answertimes.js";
import { BlobAnswerStore, timeAnswer } from "../_boot/talkTiming.js";
import { liveScores } from "./sports.js";
import { NO_WEATHER, homeWeather, isHomeWeather, weatherText } from "./weather.js";
import { readKroger } from "../_haven/kroger/store.js";
import { NO_HOUSE } from "../_haven/house.js";

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
  /** The home devices' lines (#926, api/_haven/devices/homeread.ts homeNow): instant from the kept reading. */
  home?(): Promise<string>;
  /** The live forecast near home (#1069, api/_skippy/weather.ts): the Weather Service's, keyless. */
  weather?(): Promise<string>;
  /** "How's the house?" (#1067, api/_haven/house.ts): one spoken line from the Haven's own reads. Private to Nikita. */
  house?(): Promise<string>;
  /** The live scoreboard (#537); ESPN's by default. */
  scores?: (league: string | null, team: string | null, now: number) => Promise<string>;
}

/** Skippy's one brain for a call's ask (#926, api/skippy.ts callAnswer): the answer, how deep to go, or what failed. */
export type CallBrain = (ask: string, passkey: string, screen?: string) => Promise<CallTurn>;

export interface ToolDeps {
  deskKey: string;
  crew: CrewStore | null;
  sources: RoomSources;
  /** The brain for hand_to_kernel; left out, every ask is filed for the deeper run as before. */
  brain?: CallBrain | null;
  /** The room log, for the Kernel's hand-offs (#480). */
  log?: RoomLog | null;
  now: number;
  /** For tests: the read budget (ms). */
  budgetMs?: number;
  /**
   * Answers a question passed on past the tool's budget (#1054, calldeliver.ts): started and not awaited, so the tool
   * answers at once and the answer is kept on the turn the moment it is in. Left out, the hand-off's trigger takes it.
   */
  deliver?: ((job: CallJob) => void) | null;
  /** Notes a quick answer's time from `askedAt` (#1065); not awaited, so the answer never waits on it. */
  timed?: ((kind: AnswerKind, askedAt: number) => void) | null;
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
    case "haven":
      return s.home ? await q(s.home(), "The home devices didn't answer just now.") : "The home devices aren't set up on this copy.";
    case "weather":
      return s.weather ? await q(s.weather(), NO_WEATHER) : NO_WEATHER;
    case "house":
      return s.house ? await q(s.house(), NO_HOUSE) : NO_HOUSE;
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
      const query = cleanQueryText(body?.query);
      // The weather near home (#1069): the live forecast, at once, never a web page that may be a day stale.
      if (query && deps.sources.weather && isHomeWeather(query)) {
        const forecast = await withBudget(readText("weather", deps.sources, deps.now), budget);
        if (forecast !== SLOW_TEXT && !isEmptyLookup(forecast)) return json({ read: "web", text: forecast });
      }
      const key = `${check.hash}|${query.toLowerCase()}`;
      // One path per question (#952): once a slow search is passed on, asking it again is answered with silence, so
      // the search's late result is never said as a second answer.
      if (query && passedOn.has(key)) return json({ read: "web", text: PASSED_ON });
      // The same question already passed on another way (#1116): no second lookup.
      const again = query ? askedBefore(check.hash, query, deps.now) : null;
      if (again) return json({ read: "web", text: again });
      const text = await webSearch(body?.query, check.hash, deps.sources.web, deps.now, budget - WEB_FILE_MS);
      // Slow: no polling. The question is passed on once, with its one waiting line, and the search that is still
      // running answers it the moment it is in (#1054; before, its late answer was dropped); its answer is put into the
      // call as it lands (#952: polling kept a tool out while the answer landed, so it went unsaid).
      if (text === STILL_SEARCHING && query) {
        const filed = await fileHandoff(query, deps, check, "talk", runningSearch(check.hash, body?.query));
        if (filed.ok) {
          if (passedOn.size > 500) passedOn.clear();
          passedOn.add(key);
          return json({ read: "web", text: filed.text, escalated: true });
        }
      }
      return json(await settle("web", text, query, deps, check));
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
  // No forecast: the question goes on to be answered (the web, then deeper), never "it didn't answer" (#1069).
  if (read === "weather") return json(await settle(read, text, "What's the weather near home today?", deps, check));
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

/** What the call is told when the brain couldn't take the ask: what failed, in words to say. */
const CALL_FAILED: Record<string, string> = {
  private: "That ask had something private in it, so it went nowhere. Say so in one line and ask him to say it without the private part.",
  "slow-down": "Too many asks in a minute. Say in one line that he should give you a moment, then stop.",
  "not-set-up": "Your mind's chat isn't switched on on this copy. Say that in one line.",
  text: "Texts go through draft_text on this call. Use it.",
};

/** A call's searches already passed on to the deeper mind (#952), by call and query, on this instance. */
const passedOn = new Set<string>();
/** What a repeat of a passed-on search hears: nothing to say, the answer is coming. */
export const PASSED_ON = "That question is already being looked up, and its answer is put into the call the moment it lands. Say nothing now, don't search again, and stop.";

/**
 * One lookup per question on a call (#1116). Nikita, 2026-11-13: asked about an election, the call ran its web search
 * and its deeper mind on the same question, said two answers, and "keep going" started a third lookup that sat on
 * "Still pondering…". So a call's passed-on questions are noted (on this instance, like `passedOn`): the same
 * question again, by the search or the deeper mind, is answered with silence while its answer comes; "keep going"
 * after one is finished from what has come back, not looked up again.
 */
const asked = new Map<string, { ask: string; at: number }[]>();
/** How long a passed-on question counts as the one being answered: its answer's own deadline, and a little. */
export const ASKED_MS = 90_000;
/** "Keep going", "go on", "and?": the rest of the last answer, not a new question. */
export const CONTINUE = /^(?:ok(?:ay)?[, ]+)?(?:keep going|go on|carry on|continue|and\??|and then\??|then what\??|what else\??|more|tell me more|finish(?: it| that)?|the rest)[.!?]*$/i;
/** What "keep going" hears: finish the last answer from what came back. */
export const GO_ON = "Nikita wants the rest of what you were telling him. Finish the last answer your deeper mind gave, from what is already in the call, in a sentence or two, with no waiting line and no new lookup. If its answer hasn't come in yet, say nothing and stop: it is put into the call the moment it lands.";
const WORD_SKIP = new Set(["what", "when", "where", "which", "about", "there", "their", "with", "that", "this", "from", "have", "were", "will", "would", "could", "recent", "recently", "latest", "skippy", "tell", "know"]);
const wordsOf = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !WORD_SKIP.has(w)));

/** Whether two asks are the same question: most of the shorter one's words are in the other. */
export function sameQuestion(a: string, b: string): boolean {
  const x = wordsOf(a);
  const y = wordsOf(b);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  // At least two words in common, so two short asks that share one word ("ask number one", "ask number two") differ.
  return hit >= 2 && hit / small.size >= 0.6;
}

/** What a repeat of a recent question on this call hears (silence, or finish it), or null for a new question. */
export function askedBefore(call: string, ask: string, now: number): string | null {
  const recent = (asked.get(call) ?? []).filter((r) => now - r.at < ASKED_MS);
  if (!recent.length) return null;
  if (CONTINUE.test(ask.trim())) return GO_ON;
  return recent.some((r) => sameQuestion(r.ask, ask)) ? PASSED_ON : null;
}

/** Notes a question passed on from this call. */
export function noteAsked(call: string, ask: string, now: number): void {
  if (asked.size > 200) asked.clear();
  asked.set(call, [...(asked.get(call) ?? []).filter((r) => now - r.at < ASKED_MS), { ask, at: now }]);
}

/** What the web tool keeps of its budget for passing a slow search on (two blob writes), inside the five seconds. */
export const WEB_FILE_MS = 900;

/** How long the brain's quick pass may take inside the tool's five seconds. */
export const QUICK_BUDGET_MS = 3_800;

async function handOff(request: Request, deps: ToolDeps, check: Extract<TokenCheck, { ok: true }>): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ask?: unknown } | null;
  const ask = typeof body?.ask === "string" ? body.ask.replace(/\s+/g, " ").trim().slice(0, ASK_MAX) : "";
  if (!ask) return json({ error: "bad-request" }, 400);
  if (privateParts(ask).length) return json({ ok: false, text: CALL_FAILED.private });
  // A question already on its way, or "keep going" after one (#1116): no second lookup.
  const again = askedBefore(check.hash, ask, deps.now);
  if (again) return json({ ok: true, answered: true, text: again });
  // The one brain (#926): quick first, on the call itself, as the passkey that started it.
  if (deps.brain && check.passkey) {
    const quick = await withTime(deps.brain(ask, check.passkey, check.screen).catch((): CallTurn => ({ error: "model" })), Math.min(QUICK_BUDGET_MS, (deps.budgetMs ?? READ_BUDGET_MS) - 300));
    if (quick && "reply" in quick && quick.reply) {
      deps.timed?.("quick", deps.now);
      return json({ ok: true, answered: true, text: `Say this to Nikita now, in your own voice, in one or two short sentences, with no waiting line first: ${said(quick.reply, 600)}` });
    }
    if (quick && "error" in quick && quick.error !== "model") return json({ ok: false, text: CALL_FAILED[quick.error] ?? CALL_FAILED["not-set-up"] });
    // Deeper (or the quick pass ran late, or its model failed): the deeper run takes it, and the answer comes in.
    return json(await fileHandoff(ask, deps, check, quick && "deeper" in quick ? quick.deeper : "talk"));
  }
  return json(await fileHandoff(ask, deps, check));
}

/** A promise's value, or null once `ms` has passed. */
function withTime<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Files an ask with the deeper mind for the call. The result's text tells the agent what to do next: one waiting line
 * (only the first time a question needs one, #537), then silence until the answer lands in the call.
 */
async function fileHandoff(ask: string, deps: ToolDeps, check: Extract<TokenCheck, { ok: true }>, depth: "talk" | "hard" = "talk", search?: Promise<string> | null): Promise<{ ok: boolean; text: string; turn?: string }> {
  // The same check as the typed chat: a private-looking ask is never kept or handed on.
  if (privateParts(ask).length) return { ok: false, text: "That ask has something private in it, so it wasn't handed over. Ask Nikita to say it without the private part, or to type it in the chat." };
  if (!deps.log || !deps.crew) return { ok: false, text: UNREACHABLE };
  if (check.handoffs.length >= MAX_HANDOFFS) return { ok: false, text: "This call has passed on all it may; say, in character, to type the rest into the chat." };
  const at = new Date(deps.now).toISOString();
  const id = turnId(at, ask);
  try {
    // "voice" (or "voice-hard" for judgment) marks a call's ask: its deeper run is Skippy's one brain (kernelroute.ts).
    await deps.log.add({ id, at, question: ask, answer: CALL_REPLY, room: "kernel", model: depth === "hard" ? CALL_HARD : CALL_MODEL, needs: "skippy" }, deps.now);
    await noteHandoff(deps.crew, check.hash, id, deps.now);
  } catch {
    return { ok: false, text: UNREACHABLE };
  }
  noteAsked(check.hash, ask, deps.now);
  // Answered here, not awaited (#1054): the search when there is one, else the deeper run, else an honest line.
  deps.deliver?.({ id, ask, depth, asked: deps.now, ...(search && { search }) });
  const line = waitingLine(check.hash, deps.now) ? WAIT_QUIP : "You already said this question's waiting line: say nothing now, and stop.";
  return { ok: true, turn: id, text: `Still looking. ${line} The answer is put into the call the moment it lands; say it then, and don't call check_answers for it.` };
}

/**
 * The one waiting line a passed-on question gets (#1069): topical and funny, in his own words, said once. Nikita,
 * 2026-11-12: a stock "consulting the deeper me" sounded like a hand-off; he wants a quip on the subject while he looks.
 * Never a stock line, and never the plumbing's words.
 */
export const WAIT_QUIP = `Unless you already said a line about this question, say one short in-character line about what he asked, quick and funny, on its subject and your own, like whether he'll need an umbrella for that monkey fur when it's the weather (never "thread", "hand-off", "Kernel" or "crew", never "team", and never a stock "consulting the deeper me"), then stop.`;

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
    .filter((t) => isCallAsk(t.model) && !mine.has(t.id) && deps.now - Date.parse(t.at) <= EARLIER_CALLS_MS)
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
    home: async () => {
      const [{ homeFromEnv }, { homeNow }] = await Promise.all([import("../_haven/devices/live.js"), import("../_haven/devices/homeread.js")]);
      const home = homeFromEnv(env);
      if (!home) return "The home devices aren't set up on this copy.";
      return homeNow(() => home.status(), pickBlob(env), Date.now());
    },
    players: playerSources(env),
    web: webDeps(env),
    // The home's ZIP from the Haven's private store at run time (Denver without one); never in the code or a log.
    weather: async () => {
      const blob = pickBlob(env);
      return weatherText(await homeWeather({ fetch: (u, i) => fetch(u, i), zip: async () => (blob ? (await readKroger(blob)).zip : ""), now: Date.now() }), Date.now());
    },
    // The house in one line (#1067): the reads the Haven already makes, nothing new asked of a device.
    house: () => houseNow(env),
    bill: async () => {
      const eleven = elevenFromEnv(env);
      return eleven ? { credits: await creditsReader(eleven.key)() } : null;
    },
  };
}

/**
 * "How's the house?" (#1067): the home's lines (the same instant read as read_haven), the lights' kept view, the
 * private plan's rooms, Today's to-dos and the Kitchen's plan, each loaded only when asked.
 */
async function houseNow(env: Record<string, string | undefined>): Promise<string> {
  const blob = pickBlob(env);
  const { houseText } = await import("../_haven/house.js");
  return houseText(
    {
      home: async () => {
        const [{ homeFromEnv }, { homeNow }] = await Promise.all([import("../_haven/devices/live.js"), import("../_haven/devices/homeread.js")]);
        const home = homeFromEnv(env);
        return home ? homeNow(() => home.status(), blob, Date.now()) : "";
      },
      lights: async () => (await (await import("../_haven/lights/live.js")).lightsFromEnv(env)?.view()) ?? null,
      ...(blob && {
        plan: async () => new (await import("../_haven/plan.js")).PlanStore(blob).read(),
        todos: async () => new (await import("../_today/store.js")).BlobTodoStore(blob).load(Date.now()),
        meals: async () => new (await import("../_haven/meals.js")).MealsStore(blob).read(),
      }),
    },
    Date.now(),
  );
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
      // Skippy's whole month (#646): the chat's and the Kernel responder's spend under his one cap.
      return canChat(await skippySpent(ledger, blob ? new BlobChatLedger(blob, KERNEL_LEDGER_PATH) : null, now), skippyBudget(env.SKIPPY_BUDGET_USD));
    },
    addSpend: async (usage, usd) => {
      if (ledger) await ledger.add(Date.now(), usage, usd);
    },
  };
}

/**
 * The live answerer for a call's passed-on question (#1054): runs on this instance, not awaited by the response (so
 * it is not held to the route's settle time either), and keeps its one final answer as the always-on part of Skippy.
 */
export function liveDeliver(log: RoomLog, timed: ReturnType<typeof timeAnswer> = timeAnswer(null)): (job: CallJob) => void {
  return (job) => {
    void deliverCallAnswer(job, {
      keep: async (id, text) => (await keepAnswer({ ...answerDeps(), log }, { id, from: "kernel-agent", text, final: true, ping: true })).ok,
      deep: (ask, depth) => deepAnswer(ask, depth),
      now: Date.now,
      log: (line) => console.log(line),
      timed: (kind, ms) => timed(kind, ms, Date.now()),
    }).catch(() => undefined);
  };
}

export function GET(request: Request): Promise<Response> {
  const env = process.env;
  const blob = pickBlob(env);
  const log = blob ? new BlobRoomLog(blob) : null;
  const time = timeAnswer(blob ? new BlobAnswerStore(blob) : null);
  return handle(request, {
    deskKey: env.FOUNDRY_DESK_KEY ?? "",
    crew: blob ? new BlobCrewStore(blob) : null,
    sources: liveSources(env),
    brain: (ask, passkey, screen) => callAnswer(ask, passkey, undefined, screen),
    log,
    now: Date.now(),
    deliver: log ? liveDeliver(log, time) : null,
    timed: (kind, askedAt) => void time(kind, Date.now() - askedAt, Date.now()),
  });
}

export const POST = GET;
