/**
 * The call's open lookups (#491): what Skippy and the Commentator can look up beyond the rooms' own reads, so a question
 * like "is Lamar Jackson playing on Sunday?" gets an answer on the mic instead of a refusal.
 *
 *   player_news  GET ?read=player_news[&player=<name>]: one player (or, with no name, the C.E.O.'s roster) as
 *                Sleeper and FantasyPros see him: Sleeper's injury status, body part, practice and note (its players
 *                list, kept a day by the Green, api/_green/cache.ts), FantasyPros' injury report and its latest news
 *                (FantasyPros' v2 API with the FANTASYPROS key: /nfl/injuries and /nfl/news, the Green's own
 *                endpoints, api/_green/fantasypros.ts), and whether he is on the C.E.O.'s roster or on bye.
 *   web_search   POST ?act=web { query }: the typed chat's own web lookup (api/skippy.ts, claudeChat's `lookup`: Claude
 *                Sonnet 5.5 with Anthropic's web search and LOOKUP_PROMPT), under the chat's month budget and ledger
 *                (api/_skippy/budget.ts). A search often takes longer than the call's 4.3 s read budget, so it runs on
 *                and is kept per call: the first ask answers "still searching" when it is not back in time, and asking
 *                again with the same query (or check_answers after a hand-off) brings it.
 *
 * Football news and injury lines are public; every line still goes through `said` (the public feeds' scrub). The query
 * a search carries goes through the typed chat's privacy check first and never into a log.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FpInjuryDetail, FpNewsDetail } from "../_green/fantasypros.js";
import type { SlimPlayer } from "../_green/sleeper.js";
import type { GreenBoard, GreenPlayer } from "../_green/types.js";
import { privateParts } from "../_privacy.js";
import { costOf, type Usage } from "../foundry.js";
import { LOOKUP_MODEL } from "../skippy.js";
import { SEARCH_USD, SONNET_PRICE } from "./budget.js";
import { LOOKUP_PROMPT, lookupInput } from "./prompt.js";
import { NO_GAME } from "./sports.js";
import { capLines, said } from "./voicereads.js";

/* ── player_news ── */

export interface PlayerSources {
  /** The Green's board (the C.E.O.'s roster, the week, the byes). */
  board(): Promise<GreenBoard | null>;
  /** Sleeper's players list as the Green keeps it, and when it was read (ms). */
  players(): Promise<{ value: Record<string, SlimPlayer>; at: number } | null>;
  /** FantasyPros' news and injury report, live; null without the key or when it doesn't answer. */
  fp(season: string, week: number): Promise<{ news: FpNewsDetail[]; injuries: FpInjuryDetail[] } | null>;
}

/** The longest name a lookup takes. */
export const PLAYER_MAX = 60;

/** A name as compared: lower case, no accents, no punctuation, no Jr./Sr./II. */
export function normName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `query` names this player: every word of it in his name ("lamar", "jackson", "lamar jackson"). */
export function namesPlayer(query: string, name: string): boolean {
  const q = normName(query).split(" ").filter(Boolean);
  if (!q.length) return false;
  const words = new Set(normName(name).split(" "));
  return q.every((w) => words.has(w));
}

const STATUS: Record<string, string> = { Q: "questionable", D: "doubtful", O: "out", IR: "on injured reserve", SUS: "suspended", PUP: "on the PUP list", NA: "not active" };

const hoursAgo = (at: number | string | null | undefined, now: number) => {
  const t = typeof at === "string" ? Date.parse(at) : typeof at === "number" ? at : NaN;
  if (!Number.isFinite(t)) return "";
  const h = Math.max(0, Math.round((now - t) / 3_600_000));
  return h < 1 ? "within the hour" : h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
};

function rosterOf(b: GreenBoard | null): GreenPlayer[] {
  if (!b) return [];
  return [...b.roster.starters.flatMap((s) => (s.player ? [s.player] : [])), ...b.roster.bench, ...b.roster.reserve];
}

function sleeperLine(p: SlimPlayer, listAt: number, now: number): string {
  const status = p.inj ? STATUS[p.inj] ?? p.inj : "no injury listed";
  const parts = [p.ib ? `${said(p.ib, 30)}` : "", p.prac ? `practice: ${said(p.prac, 20)}` : "", p.inote ? said(p.inote, 140) : "", p.nu ? `news updated ${hoursAgo(p.nu, now)}` : ""].filter(Boolean);
  return `Sleeper: ${status}${parts.length ? ` (${parts.join("; ")})` : ""}; Sleeper's list read ${hoursAgo(listAt, now) || "today"}.`;
}

function fpInjuryLine(i: FpInjuryDetail, now: number): string {
  const bits = [i.status ? said(i.status, 30) : "listed", i.injury ? said(i.injury, 40) : "", i.note ? said(i.note, 160) : "", i.at ? `updated ${hoursAgo(i.at, now)}` : ""].filter(Boolean);
  return `FantasyPros injury report: ${bits.join(", ")}.`;
}

const fpNewsLine = (n: FpNewsDetail, now: number) => `FantasyPros news${n.at ? ` (${hoursAgo(n.at, now)})` : ""}: ${said(n.text, 140)}${n.desc ? ` ${said(n.desc, 220)}` : ""}`;

/** One player, or the roster, as the call hears it. */
export function playerNewsText(query: string | null, d: { board: GreenBoard | null; players: { value: Record<string, SlimPlayer>; at: number } | null; fp: { news: FpNewsDetail[]; injuries: FpInjuryDetail[] } | null; now: number }): string {
  const roster = rosterOf(d.board);
  const mine = new Set(roster.map((p) => p.id));
  const byes = new Set(d.board?.byes ?? []);
  const fpState = d.fp ? "" : " FantasyPros didn't answer this time, so this is Sleeper's side only.";
  const lines: string[] = [];
  const about = (id: string | null, name: string, pos: string, team: string | null) => {
    const sl = id && d.players ? d.players.value[id] : undefined;
    const head = `${said(name, 40)} (${pos}${team ? `, ${team}` : ""})${id && mine.has(id) ? ", on the C.E.O.'s roster" : ""}${team && byes.has(team) ? `, his team is on bye in week ${d.board?.week}` : ""}.`;
    const out = [head];
    if (sl && d.players) out.push(sleeperLine(sl, d.players.at, d.now));
    const inj = d.fp?.injuries.find((i) => namesPlayer(name, i.name) && (!team || !i.team || i.team.toUpperCase() === team));
    if (inj) out.push(fpInjuryLine(inj, d.now));
    else if (d.fp) out.push("Not on FantasyPros' injury report this week.");
    for (const n of (d.fp?.news ?? []).filter((x) => x.name && namesPlayer(name, x.name)).slice(0, 3)) out.push(fpNewsLine(n, d.now));
    return out.join(" ");
  };

  if (query) {
    const q = query.trim();
    const found: { id: string | null; name: string; pos: string; team: string | null }[] = [];
    const rosterHits = roster.filter((p) => namesPlayer(q, p.name));
    for (const p of rosterHits) found.push({ id: p.id, name: p.name, pos: p.pos, team: p.team });
    if (d.players) {
      const hits = Object.values(d.players.value)
        .filter((p) => !mine.has(p.id) && namesPlayer(q, p.n))
        .sort((a, b) => a.rank - b.rank);
      for (const p of hits) found.push({ id: p.id, name: p.n, pos: p.pos, team: p.team });
    }
    if (!found.length) {
      const inj = d.fp?.injuries.find((i) => namesPlayer(q, i.name));
      const news = (d.fp?.news ?? []).find((n) => n.name && namesPlayer(q, n.name));
      if (inj || news) found.push({ id: null, name: inj?.name ?? news!.name, pos: inj?.pos ?? "player", team: inj?.team ?? null });
    }
    if (!found.length) return `No player matching "${said(q, PLAYER_MAX)}" on Sleeper's list or in FantasyPros' feeds.${fpState} Try the full name, or call hand_to_kernel.`;
    for (const f of found.slice(0, 2)) lines.push(about(f.id, f.name, f.pos, f.team));
    if (found.length > 2) lines.push(`${found.length - 2} more players match that name; say the team to narrow it.`);
    return capLines([...lines, ...(fpState ? [fpState.trim()] : [])]);
  }

  if (!roster.length) return `The C.E.O.'s roster isn't answering right now.${fpState} Hand the question to hand_to_kernel.`;
  const flagged = roster.filter((p) => p.inj || (d.fp?.injuries ?? []).some((i) => namesPlayer(p.name, i.name)) || (d.fp?.news ?? []).some((n) => n.name && namesPlayer(p.name, n.name)));
  if (!flagged.length) return `Nobody on the C.E.O.'s roster is on Sleeper's or FantasyPros' injury list, and FantasyPros has no fresh news on them.${fpState}`;
  lines.push(`The C.E.O.'s roster, injuries and news (week ${d.board?.week}):`);
  for (const p of flagged.slice(0, 8)) lines.push(about(p.id, p.name, p.pos, p.team));
  return capLines([...lines, ...(fpState ? [fpState.trim()] : [])]);
}

/** A source held to `ms`: null when it is slower or fails. */
export const within = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.())]);

/** The player lookup from its sources, each held to `ms`. */
export async function playerNews(query: string | null, s: PlayerSources, now: number, ms: number): Promise<string> {
  const [board, players] = await Promise.all([within(s.board(), ms), within(s.players(), ms)]);
  const season = board?.season ?? String(new Date(now).getUTCFullYear());
  const fp = board ? await within(s.fp(season, board.week), Math.max(500, ms - 600)) : null;
  return playerNewsText(query, { board, players, fp, now });
}

/** A player name as the tool passes it: one short plain line of letters, or null. */
export function cleanPlayer(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.normalize("NFKC").replace(/[^\p{L}\p{N} .'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, PLAYER_MAX);
  return t.length >= 2 ? t : null;
}

/* ── web_search ── */

export interface WebDeps {
  /** One search: its spoken-length summary, what it used and cost. Null when there is no Claude key. */
  search: ((query: string) => Promise<{ text: string; usage: Usage; usd: number }>) | null;
  /** Whether one more search fits the chat's month budget (the typed chat's own check). */
  canSpend(): Promise<boolean>;
  /** Adds a search to the chat's ledger. */
  addSpend(usage: Usage, usd: number): Promise<void>;
}

/** The longest query. */
export const QUERY_MAX = 200;
/** The most searches one call may start. */
export const SEARCHES_PER_CALL = 6;
/** How long a search's answer is kept for its call. */
const KEEP_MS = 15 * 60_000;

export const STILL_SEARCHING =
  "Still searching the web for that. Call web_search again with the same query in a few seconds, without filling the wait with talk, and never say you couldn't find it while this runs. If it's still not back then, hand the question to hand_to_kernel.";

/** Added to a wait's result the first time a question needs a waiting line (waitingLine), so there is one and no more. */
export const SAY_WAITING_LINE = " Say one short in-character line about it now (this question's only waiting line), then silence until the answer.";
export const NO_MORE_LINES = " You already said this question's waiting line: say nothing now.";

interface Search {
  at: number;
  done: string | null;
  run: Promise<string>;
}
/** Searches by call and query, on this instance (a call stays on one instance or two). */
const searches = new Map<string, Search>();

export const forgetSearches = () => searches.clear();

/** The query as a search takes it: one plain line, capped; "" when empty. */
export const cleanQuery = (raw: unknown) =>
  typeof raw === "string"
    ? raw
        .normalize("NFKC")
        .replace(/\p{Cf}/gu, "")
        .replace(/[<>{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, QUERY_MAX)
    : "";

/**
 * A web search for a call: answered within `waitMs` when it is that quick, else STILL_SEARCHING while it runs on; the
 * same query again on the same call answers from it. Never more than SEARCHES_PER_CALL searches a call.
 */
export async function webSearch(rawQuery: unknown, call: string, d: WebDeps, now: number, waitMs: number): Promise<string> {
  const query = cleanQuery(rawQuery);
  if (!query) return "That search was empty; ask Nikita what to look up.";
  if (privateParts(query).length) return "That search has something private in it, so it wasn't run. Search without the private part.";
  for (const [k, s] of searches) if (now - s.at > KEEP_MS) searches.delete(k);
  const key = `${call}|${query.toLowerCase()}`;
  let s = searches.get(key);
  if (!s) {
    if (!d.search) return "Web search isn't set up on this call; hand the question to hand_to_kernel.";
    if ([...searches.keys()].filter((k) => k.startsWith(`${call}|`)).length >= SEARCHES_PER_CALL) return "This call has run all the web searches it may; hand the rest to hand_to_kernel.";
    if (!(await d.canSpend().catch(() => false))) return "The month's search budget is spent; hand the question to hand_to_kernel.";
    const search = d.search;
    const entry: Search = { at: now, done: null, run: Promise.resolve("") };
    entry.run = search(query)
      .then(async (got) => {
        await d.addSpend(got.usage, got.usd).catch(() => undefined);
        return got.text ? capLines([`Web search for "${said(query, 120)}":`, said(got.text, 1_400)]) : `The web search for "${said(query, 120)}" found nothing reliable; hand it to hand_to_kernel.`;
      })
      .catch(() => `The web search for "${said(query, 120)}" failed; hand the question to hand_to_kernel.`)
      .then((text) => {
        entry.done = text;
        return text;
      });
    searches.set(key, entry);
    s = entry;
  }
  if (s.done !== null) return s.done;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(STILL_SEARCHING), Math.max(0, waitMs));
  });
  return Promise.race([s.run, late]).finally(() => clearTimeout(timer));
}

/** The voice summary's rules: the typed chat's lookup prompt, held to a spoken length. */
export const VOICE_LOOKUP_PROMPT = `${LOOKUP_PROMPT} The summary is read aloud on a live call: at most 90 words, the answer first, with dates.`;

/** The most a search's summary may write (thinking included). */
export const VOICE_LOOKUP_TOKENS = 1_200;
/** The most searches one lookup may run (fewer than the typed chat's three, for speed). */
export const VOICE_SEARCH_MAX = 2;

/** The search on Claude: the typed chat's lookup model and web search, short. */
export function claudeSearch(key: string): (query: string) => Promise<{ text: string; usage: Usage; usd: number }> {
  const client = new Anthropic({ apiKey: key, timeout: 25_000, maxRetries: 0 });
  return async (query) => {
    const res = await client.messages.create({
      model: LOOKUP_MODEL,
      max_tokens: VOICE_LOOKUP_TOKENS,
      output_config: { effort: "low" },
      system: VOICE_LOOKUP_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: VOICE_SEARCH_MAX }],
      messages: [{ role: "user", content: lookupInput(query) }],
    });
    const text = res.stop_reason === "end_turn" ? res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ") : "";
    const usage = res.usage as Usage;
    const n = Math.min(VOICE_SEARCH_MAX, (res.usage as { server_tool_use?: { web_search_requests?: number } | null }).server_tool_use?.web_search_requests ?? 0);
    return { text, usage, usd: costOf(usage, SONNET_PRICE) + n * SEARCH_USD };
  };
}


/* ── One ask, one answer (#537) ── */

/**
 * Whether a lookup came back with nothing usable: no such player, a search with nothing reliable or that failed, no
 * game on ESPN's board, a source that didn't answer. The route then escalates to the deeper Skippy itself, instead of
 * leaving the agent to tell Nikita it failed (toolroute.ts).
 */
export const isEmptyLookup = (text: string): boolean =>
  /^No player matching|found nothing reliable|^The web search for .* failed|^The C\.E\.O\.'s roster isn't answering|^ESPN isn't answering|isn't set up on this call|search budget is spent|all the web searches/i.test(text) || text.startsWith(NO_GAME);

/** Marks a listing whose fresh-news half is still running. */
export const NEWS_PENDING = "Fresh news is still being checked. Don't answer from the listing alone: call player_news again with the same player in a few seconds, silently, then answer once with both.";

/**
 * A player-status ask answered once (#537): the Sleeper/FantasyPros listing and the fresh-news web search together.
 * `news` is the web search's text, null when there is no search on this call, or STILL_SEARCHING while it runs.
 * When both are in, the agent is told to say a conflict in one line ("listed Out, but the coach says Wednesday decides").
 */
export function mergeStatusNews(listing: string, news: string | null): string {
  if (news === null) return listing;
  if (news === STILL_SEARCHING || !news.trim()) return `${listing} ${NEWS_PENDING}`;
  if (isEmptyLookup(news)) return listing;
  return capLines([
    `${listing}`,
    `Fresh news from the web, newer than the listing: ${news.replace(/^Web search for "[^"]*":\s*/, "")}`,
    'Answer once from both, status first. If the listing and the fresh news disagree, say so in one line ("listed Out, but the coach says Wednesday decides"), and go with the fresher word.',
  ]);
}

/** How long one question's waiting line holds: a second tool result inside it is told to stay quiet. */
export const WAIT_LINE_MS = 25_000;
const lined = new Map<string, number>();
export const forgetWaitingLines = () => lined.clear();

/**
 * The one-waiting-line rule (#537): true the first time a call needs a waiting line for a question, false for any
 * further wait inside WAIT_LINE_MS, so the tool results tell him to say one line and then nothing.
 */
export function waitingLine(call: string, now: number): boolean {
  const last = lined.get(call);
  if (last !== undefined && now - last < WAIT_LINE_MS) return false;
  if (lined.size > 200) lined.clear();
  lined.set(call, now);
  return true;
}
