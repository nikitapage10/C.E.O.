/**
 * The Green's league board (#252), as a route inside an existing function: the Hobby plan's twelve functions are all
 * taken, so vercel.json rewrites /api/green-league to /api/world?green=league and api/world.ts hands it here. On Azure
 * it is its own endpoint (azure/src/index.ts), behind the same site gate.
 *
 * GET /api/green-league → GreenBoard (api/_green/types.ts): Nikita's roster, this week's matchup with a win chance,
 *                         start-or-sit calls, waiver pickups, the standings, and which sources answered. Cached at the
 *                         edge for two minutes, and a warm instance reads Sleeper at most once in that time; any other
 *                         query string is sent back to the bare address.
 *
 * Byes come from Sleeper's schedule (a team with no game this week), and from FantasyPros' weekly projections when they
 * are live (a team with no rows at all), never from FantasyPros alone.
 *
 * Read-only everywhere: Sleeper's public API (no key) and, where the `FANTASYPROS` key is set (Azure), FantasyPros'
 * official API. Nothing is written to either; the Desk links to Sleeper for the moves.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { FP_PATH, PLAYERS_PATH, SCHEDULE_PATH, SL_PROJ_PATH, keptOrRead, peekKept, pickGreenStore, type GreenStore } from "./cache.js";
import { FpUnavailable, fpKey, prevSnapshot, readFantasyPros, scoringOf, type FpData } from "./fantasypros.js";
import { buildBoard, slotTakes } from "./model.js";
import { LEAGUE_ID, getJson, pickLeague, readPlayers, readSchedule, readSlProjections, shapeLeague, shapeMatchups, shapeRosters, shapeState, shapeTeamNames, shapeTransactions, shapeTrending, urls, type Fetcher, type League, type MatchupRow, type Move, type NflState, type Schedule, type SlProj } from "./sleeper.js";
import { GREEN_POS, type FpParts, type FpState, type GreenBoard, type GreenFeed, type GreenPos } from "./types.js";

export const PATH = "/api/green-league";
/** How long the edge and a warm instance keep a board. */
export const FRESH_S = 120;
/** How long a last good board may stand in when Sleeper doesn't answer. */
const STALE_MS = 30 * 60_000;
const DAY_MS = 24 * 3_600_000;
const FP_TTL_MS = 6 * 3_600_000;
const SL_PROJ_TTL_MS = 3 * 3_600_000;

export interface GreenDeps {
  fetcher: Fetcher;
  store: GreenStore | null;
  /** The FantasyPros key, or null; read at call time, never kept. */
  fpKey: string | null;
  now: number;
}

export const liveDeps = (): GreenDeps => ({ fetcher: (url, init) => fetch(url, init), store: pickGreenStore(), fpKey: fpKey(), now: Date.now() });

/** Whether a request to the host function is for this route (by its own path, or the rewrite's query). */
export function isGreen(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === PATH || url.searchParams.get("green") === "league";
}

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

/* ── what a warm instance remembers ── */

let boardKept: { at: number; board: GreenBoard } | null = null;
let stateKept: { at: number; value: NflState } | null = null;
let leagueKept: { at: number; season: string; value: League } | null = null;
const weeksKept = new Map<string, { at: number; rows: MatchupRow[] }>();

/** For tests: forget what this instance read. */
export function forgetGreen(): void {
  boardKept = null;
  stateKept = null;
  leagueKept = null;
  weeksKept.clear();
  futureKept.clear();
}

async function stateNow(deps: GreenDeps): Promise<NflState> {
  if (stateKept && deps.now - stateKept.at < 10 * 60_000) return stateKept.value;
  const value = shapeState(await getJson(deps.fetcher, urls.state()));
  stateKept = { at: deps.now, value };
  return value;
}

/** The Horse Meat league for this season: the known one, or (once the season rolls over) its renewal. */
async function leagueNow(deps: GreenDeps, season: string): Promise<League> {
  if (leagueKept && leagueKept.season === season && deps.now - leagueKept.at < 6 * 3_600_000) return leagueKept.value;
  let league = shapeLeague(await getJson(deps.fetcher, urls.league(LEAGUE_ID)));
  if (league.season !== season) {
    const next = pickLeague(await getJson(deps.fetcher, urls.userLeagues(season)).catch(() => []), LEAGUE_ID, league.name);
    if (next && next !== league.id) league = shapeLeague(await getJson(deps.fetcher, urls.league(next)));
  }
  leagueKept = { at: deps.now, season, value: league };
  return league;
}

/** A finished week's matchups barely change (stat corrections): kept a day, last week's an hour. */
async function weekRows(deps: GreenDeps, league: string, week: number, current: number): Promise<MatchupRow[]> {
  const key = `${league}:${week}`;
  const kept = weeksKept.get(key);
  const ttl = week < current - 1 ? DAY_MS : 3_600_000;
  if (kept && deps.now - kept.at < ttl) return kept.rows;
  const rows = shapeMatchups(await getJson(deps.fetcher, urls.matchups(league, week)));
  weeksKept.set(key, { at: deps.now, rows });
  return rows;
}

/** Bumped whenever the kept FantasyPros shape changes, so an old copy is never served as this one. */
export const FP_SHAPE = "v3";

const positionsOf = (league: League) => GREEN_POS.filter((p) => league.slots.some((s) => slotTakes(s).includes(p))) as GreenPos[];

async function fantasyPros(deps: GreenDeps, league: League, state: NflState): Promise<{ fp: FpData | null; fpState: FpState; fpParts?: FpParts }> {
  if (!deps.fpKey) return { fp: null, fpState: "waiting" };
  const key = deps.fpKey;
  const positions = positionsOf(league);
  const tag = `${FP_SHAPE}-${state.season}-${state.week}-${scoringOf(league.rec)}`;
  try {
    const got = await keptOrRead(deps.store, FP_PATH, tag, FP_TTL_MS, DAY_MS, deps.now, async () => {
      // The copy kept before this read carries last week's rest-of-season ranks: who moved since (#276).
      const before = await peekKept<FpData>(deps.store, FP_PATH).catch(() => null);
      const fresh = await readFantasyPros(deps.fetcher, key, state.season, state.week, league.rec, positions);
      return { ...fresh, prev: prevSnapshot(before?.value ?? null, state.week) };
    });
    return { fp: got.value, fpState: "live" };
  } catch (e) {
    return { fp: null, fpState: "failed", ...(e instanceof FpUnavailable && { fpParts: e.parts }) };
  }
}

/** The rest of the regular season's pairings (they're set for the season): kept six hours. */
const futureKept = new Map<string, { at: number; rows: MatchupRow[][] }>();
async function futureRows(deps: GreenDeps, league: League, week: number): Promise<MatchupRow[][]> {
  const key = `${league.id}:${week}`;
  const kept = futureKept.get(key);
  if (kept && deps.now - kept.at < 6 * 3_600_000) return kept.rows;
  const weeks = Array.from({ length: Math.max(0, league.playoffStart - week - 1) }, (_, i) => week + 1 + i).slice(0, 14);
  const rows = await Promise.all(weeks.map((w) => getJson(deps.fetcher, urls.matchups(league.id, w)).then(shapeMatchups).catch(() => [] as MatchupRow[])));
  futureKept.set(key, { at: deps.now, rows });
  return rows;
}

export async function readBoard(deps: GreenDeps): Promise<GreenBoard> {
  const state = await stateNow(deps);
  const league = await leagueNow(deps, state.season);
  const week = state.week;
  const pastWeeks = Array.from({ length: Math.max(0, week - 1) }, (_, i) => i + 1);
  const extras = Promise.all([
    week >= 1
      ? keptOrRead(deps.store, SL_PROJ_PATH, `${state.season}-${week}-${league.rec}`, SL_PROJ_TTL_MS, DAY_MS, deps.now, () => readSlProjections(deps.fetcher, state.season, week, league.rec, positionsOf(league)))
          .then((k): { value: Record<string, SlProj>; at: number } | null => (k.value && typeof k.value === "object" ? { value: k.value, at: k.at } : null))
          .catch(() => null)
      : Promise.resolve(null),
    week >= 1
      ? Promise.all([week, week - 1].filter((w) => w >= 1).map((w) => getJson(deps.fetcher, urls.transactions(league.id, w)).then(shapeTransactions)))
          .then((m): Move[] => m.flat().sort((a, b) => (b.at ?? 0) - (a.at ?? 0)))
          .catch((): Move[] | null => null)
      : Promise.resolve([] as Move[]),
    week >= 1 && week < league.playoffStart ? futureRows(deps, league, week) : Promise.resolve([] as MatchupRow[][]),
  ]);
  const [rosters, users, matchups, history, adds, drops, players, schedule] = await Promise.all([
    getJson(deps.fetcher, urls.rosters(league.id)).then(shapeRosters),
    getJson(deps.fetcher, urls.users(league.id)).then(shapeTeamNames),
    week >= 1 ? getJson(deps.fetcher, urls.matchups(league.id, week)).then(shapeMatchups) : Promise.resolve([]),
    Promise.all(pastWeeks.map((w) => weekRows(deps, league.id, w, week).catch(() => [] as MatchupRow[]))),
    getJson(deps.fetcher, urls.trending("add")).then(shapeTrending).catch(() => ({})),
    getJson(deps.fetcher, urls.trending("drop")).then(shapeTrending).catch(() => ({})),
    keptOrRead(deps.store, PLAYERS_PATH, "nfl", DAY_MS, 7 * DAY_MS, deps.now, () => readPlayers(deps.fetcher)).then((k) => k.value),
    // The byes, from the schedule (independent of FantasyPros); without it the board still answers.
    keptOrRead(deps.store, SCHEDULE_PATH, state.season, DAY_MS, 7 * DAY_MS, deps.now, () => readSchedule(deps.fetcher, state.season))
      .then((k): Schedule | null => k.value)
      .catch(() => null),
  ]);
  const [{ fp, fpState, fpParts }, [slProj, moves, future]] = await Promise.all([fantasyPros(deps, league, state), extras]);
  const at = new Date(deps.now).toISOString();
  const board = buildBoard({ league, state, rosters, teamNames: users, matchups, history, players, adds, drops, fp, fpState, schedule, slProj: slProj?.value ?? null, moves: moves ?? [], future, at });
  if (fpParts && !board.sources.fpParts) board.sources.fpParts = fpParts;
  board.feeds = feedsOf({ at, fpState, fp, fpParts: board.sources.fpParts, slProjAt: slProj ? new Date(slProj.at).toISOString() : null, moves: moves !== null, schedule: schedule !== null });
  return board;
}

/** Where the board's numbers came from and when, for its Sources footer (#276). Names and times only. */
export function feedsOf(o: { at: string; fpState: FpState; fp: FpData | null; fpParts: FpParts | null; slProjAt: string | null; moves: boolean; schedule: boolean }): GreenFeed[] {
  const fpAt = o.fp?.at ?? null;
  const failed = (part: string) => o.fpParts?.errors.some((e) => e.part.startsWith(part)) ?? false;
  const fpLive = o.fpState === "live";
  const fpWord = o.fpState === "waiting" ? "waiting" : o.fpState === "failed" ? "failed" : null;
  const part = (name: string, prefix: string, rows: number, note: string): GreenFeed =>
    fpWord ? { name, state: fpWord, at: null, ...(o.fpState === "waiting" && { note: "its key is on the Azure copy only" }) } : failed(prefix) && !rows ? { name, state: "failed", at: fpAt } : { name, state: rows ? "live" : "off", at: fpAt, note };
  return [
    { name: "Sleeper league (rosters, matchups, standings)", state: "live", at: o.at },
    o.slProjAt ? { name: "Sleeper projections", state: "live", at: o.slProjAt } : { name: "Sleeper projections", state: "failed", at: null },
    { name: "Sleeper transactions and FAAB", state: o.moves ? "live" : "failed", at: o.moves ? o.at : null },
    { name: "Sleeper schedule (byes)", state: o.schedule ? "live" : "failed", at: o.schedule ? o.at : null },
    part("FantasyPros projections", "projections", o.fp?.proj.length ?? 0, `${o.fp?.proj.length ?? 0} players`),
    part("FantasyPros rankings (this week and rest of season)", "weekly", (o.fp?.weekly?.length ?? 0) + (o.fp?.ranks.length ?? 0), `${o.fp?.weekly?.length ?? 0} this week, ${o.fp?.ranks.length ?? 0} rest of season`),
    fpLive ? part("Injury report", "injuries", o.fp?.injuries.length ?? 0, "FantasyPros") : { name: "Injury report", state: "live", at: o.at, note: "Sleeper's player statuses" },
    part("FantasyPros news", "news", o.fp?.news?.length ?? 0, `${o.fp?.news?.length ?? 0} headlines`),
  ];
}

export async function GET(request: Request, deps: GreenDeps = liveDeps()): Promise<Response> {
  const url = new URL(request.url);
  // The board takes no parameters: a made-up query would miss the edge cache and cost Sleeper reads.
  const extra = [...url.searchParams.keys()].some((k) => k !== "green") || url.searchParams.getAll("green").length > 1;
  if (extra) return new Response(null, { status: 308, headers: { Location: PATH, "Cache-Control": "public, s-maxage=3600" } });
  if (boardKept && deps.now - boardKept.at < FRESH_S * 1000) return json(boardKept.board, 200, `public, s-maxage=${FRESH_S}, stale-while-revalidate=${FRESH_S * 2}`);
  try {
    const board = await readBoard(deps);
    boardKept = { at: deps.now, board };
    return json(board, 200, `public, s-maxage=${FRESH_S}, stale-while-revalidate=${FRESH_S * 2}`);
  } catch (e) {
    if (e instanceof Error && e.message === "not-in-league") return json({ error: "not-in-league" }, 404);
    if (boardKept && deps.now - boardKept.at < STALE_MS) return json({ ...boardKept.board, stale: true }, 200);
    return json({ error: "upstream" }, 502);
  }
}
