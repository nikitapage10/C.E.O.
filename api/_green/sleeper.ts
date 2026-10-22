/**
 * Sleeper's public API, read-only (#252; docs.sleeper.com): no key, no sign-in, nothing written. The Green reads
 * Nikita's league ("Horse Meat", 2026), its rosters and team names, this week's and past weeks' matchups, the NFL
 * state (season and week), trending adds and drops, and the players list.
 *
 *   https://api.sleeper.app/v1/state/nfl
 *   https://api.sleeper.app/v1/user/<user>/leagues/nfl/<season>      (only when the season rolls over)
 *   https://api.sleeper.app/v1/league/<league>                        /rosters /users /matchups/<week>
 *   https://api.sleeper.app/v1/players/nfl/trending/add|drop?lookback_hours=24&limit=50
 *   https://api.sleeper.app/v1/players/nfl                            ~15 MB: read at most once a day (cache.ts)
 *   https://api.sleeper.com/schedule/nfl/regular/<season>             the season's games (~27 kB), once a day: the byes
 *
 * Everything that comes back is untrusted: rebuilt with only the fields the board needs, text stripped of control and
 * direction characters and cut short, ids checked, numbers range-checked, answers past a size cap refused.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { GREEN_POS, GREEN_TEXT_MAX, type GreenInjury, type GreenPos } from "./types.js";

export const SLEEPER = "https://api.sleeper.app/v1";
/** Sleeper's schedule lives on its other host. */
export const SLEEPER_SCHEDULE = "https://api.sleeper.com/schedule/nfl/regular";
/** Nikita's Sleeper account and league (Nikita, 2026-10-22). Public ids, not secrets. */
export const USER_ID = "464876436994387968";
export const LEAGUE_ID = "1382508114531598336";

const MAX_BYTES = 2_000_000;
/** The players list is about 15 MB; anything past this is refused. */
const MAX_PLAYERS_BYTES = 40_000_000;
const TIMEOUT_MS = 8000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const SNOWFLAKE = /^\d{1,24}$/;
/** A Sleeper player id: digits, or a team code for a defence. */
export const PLAYER_ID = /^(\d{1,8}|[A-Z]{2,3})$/;
const TEAM = /^[A-Z]{2,3}$/;

/** The 32 teams, in Sleeper's codes. */
export const NFL_TEAMS: ReadonlySet<string> = new Set(["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"]);

/** Plain, short text: no control, zero-width or direction characters, whitespace collapsed. */
export function cleanText(v: unknown, max = GREEN_TEXT_MAX): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const flat = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ids = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string" && PLAYER_ID.test(x));

export async function getJson(fetcher: Fetcher, url: string, max = MAX_BYTES, init: RequestInit = {}): Promise<unknown> {
  const res = await fetcher(url, { ...init, headers: { Accept: "application/json", ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) throw new Error("answer too big");
  const text = await res.text();
  if (text.length > max) throw new Error("answer too big");
  return JSON.parse(text) as unknown;
}

/* ── the players list, trimmed ── */

/** One player as the Green keeps him: about 100 bytes instead of 1.2 kB. */
export interface SlimPlayer {
  id: string;
  n: string;
  pos: GreenPos;
  team: string | null;
  inj: GreenInjury | null;
  /** Sleeper's own popularity rank (lower is better), 9999 when unknown. */
  rank: number;
  /** Yahoo and Sportradar ids, to match FantasyPros' players. */
  yh: string | null;
  sr: string | null;
}

const INJURY: Record<string, GreenInjury> = { questionable: "Q", doubtful: "D", out: "O", ir: "IR", sus: "SUS", suspended: "SUS", pup: "PUP", na: "NA", dnr: "NA", cov: "IR" };

export function injuryOf(v: unknown): GreenInjury | null {
  return typeof v === "string" ? (INJURY[v.trim().toLowerCase()] ?? null) : null;
}

/** Trims Sleeper's players list to the fantasy positions on an NFL team (a few thousand players). */
export function slimPlayers(raw: unknown): Record<string, SlimPlayer> {
  const out: Record<string, SlimPlayer> = {};
  for (const [key, v] of Object.entries(obj(raw))) {
    const p = obj(v);
    const pos = p.position;
    const team = typeof p.team === "string" && TEAM.test(p.team) ? p.team : null;
    if (!PLAYER_ID.test(key) || typeof pos !== "string" || !(GREEN_POS as readonly string[]).includes(pos) || !team) continue;
    const name = pos === "DEF" ? `${cleanText(p.last_name, 30) || team} D/ST` : cleanText(p.full_name) || cleanText(`${typeof p.first_name === "string" ? p.first_name : ""} ${typeof p.last_name === "string" ? p.last_name : ""}`);
    if (!name) continue;
    const rank = num(p.search_rank);
    const yh = num(p.yahoo_id);
    const sr = typeof p.sportradar_id === "string" && /^[0-9a-f-]{36}$/i.test(p.sportradar_id) ? p.sportradar_id.toLowerCase() : null;
    out[key] = { id: key, n: name, pos: pos as GreenPos, team, inj: injuryOf(p.injury_status), rank: rank !== null && rank >= 0 && rank < 1e7 ? Math.round(rank) : 9999, yh: yh !== null && yh > 0 ? String(Math.round(yh)) : null, sr };
  }
  return out;
}

/** Reads the whole players list and trims it at once (the big answer never leaves this function). */
export async function readPlayers(fetcher: Fetcher): Promise<Record<string, SlimPlayer>> {
  const slim = slimPlayers(await getJson(fetcher, `${SLEEPER}/players/nfl`, MAX_PLAYERS_BYTES));
  if (Object.keys(slim).length < 100) throw new Error("players list too short");
  return slim;
}

/* ── the league ── */

export interface NflState {
  season: string;
  week: number;
  type: string;
}

export function shapeState(raw: unknown): NflState {
  const s = obj(raw);
  const season = typeof s.league_season === "string" && /^\d{4}$/.test(s.league_season) ? s.league_season : typeof s.season === "string" && /^\d{4}$/.test(s.season) ? s.season : null;
  const week = num(s.display_week) ?? num(s.week);
  if (!season || week === null || week < 0 || week > 25) throw new Error("bad state");
  return { season, week: Math.round(week), type: typeof s.season_type === "string" ? s.season_type : "regular" };
}

export interface League {
  id: string;
  name: string;
  season: string;
  teams: number;
  /** Starting slots in order ("QB", "RB", "FLEX", "DEF"…); bench and reserve slots left out. */
  slots: string[];
  /** Points per reception: 0, 0.5 or 1 (FantasyPros' STD, HALF, PPR). */
  rec: number;
  faab: number | null;
  playoffStart: number;
}

const SLOT = /^(QB|RB|WR|TE|K|DEF|FLEX|WRRB_FLEX|REC_FLEX|SUPER_FLEX|WRT)$/;

export function shapeLeague(raw: unknown): League {
  const l = obj(raw);
  const s = obj(l.settings);
  const id = typeof l.league_id === "string" && SNOWFLAKE.test(l.league_id) ? l.league_id : null;
  if (!id) throw new Error("bad league");
  const slots = arr(l.roster_positions).filter((x): x is string => typeof x === "string" && SLOT.test(x));
  const rec = num(obj(l.scoring_settings).rec) ?? 0;
  const budget = num(s.waiver_budget);
  return {
    id,
    name: cleanText(l.name) || "The league",
    season: typeof l.season === "string" ? l.season : "",
    teams: Math.max(2, Math.min(32, num(l.total_rosters) ?? 12)),
    slots: slots.length ? slots : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF"],
    rec: Math.max(0, Math.min(1, rec)),
    faab: num(s.waiver_type) === 2 && budget !== null ? budget : null,
    playoffStart: num(s.playoff_week_start) ?? 15,
  };
}

export interface Roster {
  rosterId: number;
  ownerId: string | null;
  coOwners: string[];
  players: string[];
  starters: string[];
  reserve: string[];
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  /** Max potential points (Sleeper's "ppts"), null when it hasn't worked it out. */
  ppts: number | null;
  faabUsed: number;
  streak: string | null;
}

const pts = (whole: unknown, dec: unknown): number => (num(whole) ?? 0) + (num(dec) ?? 0) / 100;

export function shapeRosters(raw: unknown): Roster[] {
  return arr(raw)
    .map((v): Roster | null => {
      const r = obj(v);
      const s = obj(r.settings);
      const rid = num(r.roster_id);
      if (rid === null || rid < 1 || rid > 64) return null;
      const streak = obj(r.metadata).streak;
      return {
        rosterId: rid,
        ownerId: typeof r.owner_id === "string" && SNOWFLAKE.test(r.owner_id) ? r.owner_id : null,
        coOwners: arr(r.co_owners).filter((x): x is string => typeof x === "string" && SNOWFLAKE.test(x)),
        players: ids(r.players),
        starters: arr(r.starters).map((x) => (typeof x === "string" && PLAYER_ID.test(x) ? x : "0")),
        reserve: ids(r.reserve),
        wins: num(s.wins) ?? 0,
        losses: num(s.losses) ?? 0,
        ties: num(s.ties) ?? 0,
        pf: pts(s.fpts, s.fpts_decimal),
        pa: pts(s.fpts_against, s.fpts_against_decimal),
        ppts: s.ppts === undefined ? null : pts(s.ppts, s.ppts_decimal),
        faabUsed: num(s.waiver_budget_used) ?? 0,
        streak: typeof streak === "string" && /^\d{1,2}[WLT]$/.test(streak) ? streak : null,
      };
    })
    .filter((r): r is Roster => r !== null);
}

/** Team names by owner (the name the manager gave the team; never the username). */
export function shapeTeamNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of arr(raw)) {
    const u = obj(v);
    if (typeof u.user_id !== "string" || !SNOWFLAKE.test(u.user_id)) continue;
    const name = cleanText(obj(u.metadata).team_name, 40);
    if (name) out[u.user_id] = name;
  }
  return out;
}

export interface MatchupRow {
  rosterId: number;
  matchupId: number | null;
  points: number;
  starters: string[];
  startersPoints: number[];
  /** Every rostered player's points this week, in the league's scoring. */
  playerPoints: Record<string, number>;
}

export function shapeMatchups(raw: unknown): MatchupRow[] {
  return arr(raw)
    .map((v): MatchupRow | null => {
      const m = obj(v);
      const rid = num(m.roster_id);
      if (rid === null) return null;
      const pp: Record<string, number> = {};
      for (const [k, p] of Object.entries(obj(m.players_points))) {
        const n = num(p);
        if (PLAYER_ID.test(k) && n !== null && n > -50 && n < 150) pp[k] = n;
      }
      return {
        rosterId: rid,
        matchupId: num(m.matchup_id),
        points: num(m.points) ?? 0,
        starters: arr(m.starters).map((x) => (typeof x === "string" && PLAYER_ID.test(x) ? x : "0")),
        startersPoints: arr(m.starters_points).map((x) => num(x) ?? 0),
        playerPoints: pp,
      };
    })
    .filter((r): r is MatchupRow => r !== null);
}

/** Trending adds or drops: player id → how many leagues, in the last day. */
export function shapeTrending(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of arr(raw)) {
    const t = obj(v);
    const c = num(t.count);
    if (typeof t.player_id === "string" && PLAYER_ID.test(t.player_id) && c !== null && c >= 0) out[t.player_id] = Math.round(c);
  }
  return out;
}

/** Which of the user's leagues this season is the Horse Meat league: the known id, else one with the same name. */
export function pickLeague(raw: unknown, knownId: string, knownName: string | null): string | null {
  const list = arr(raw).map(obj);
  if (list.some((l) => l.league_id === knownId)) return knownId;
  const same = knownName ? list.find((l) => typeof l.name === "string" && l.name.trim().toLowerCase() === knownName.toLowerCase()) : undefined;
  return typeof same?.league_id === "string" && SNOWFLAKE.test(same.league_id) ? same.league_id : null;
}

/* ── the schedule, for the byes ── */

/** Which teams play in each regular-season week: week → team codes. */
export type Schedule = Record<string, string[]>;

/** Sleeper's schedule trimmed to who plays when; games with an unknown team or a week out of range are dropped. */
export function shapeSchedule(raw: unknown): Schedule {
  const weeks = new Map<number, Set<string>>();
  for (const v of arr(raw)) {
    const g = obj(v);
    const week = num(g.week);
    const home = typeof g.home === "string" ? g.home.trim().toUpperCase() : "";
    const away = typeof g.away === "string" ? g.away.trim().toUpperCase() : "";
    if (week === null || !Number.isInteger(week) || week < 1 || week > 18 || !NFL_TEAMS.has(home) || !NFL_TEAMS.has(away) || home === away) continue;
    const set = weeks.get(week) ?? new Set<string>();
    set.add(home).add(away);
    weeks.set(week, set);
  }
  const out: Schedule = {};
  for (const [w, set] of [...weeks].sort((a, b) => a[0] - b[0])) out[String(w)] = [...set].sort();
  return out;
}

/** Reads the season's schedule; refuses one too thin to be the real thing. */
export async function readSchedule(fetcher: Fetcher, season: string): Promise<Schedule> {
  const s = shapeSchedule(await getJson(fetcher, urls.schedule(season)));
  if (Object.keys(s).length < 10) throw new Error("schedule too short");
  return s;
}

/**
 * The teams on bye in a week, by the schedule: every team without a game. Null when the schedule can't say (no games
 * that week, or so few that it looks wrong: the NFL never rests more than eight teams at once).
 */
export function byesOf(schedule: Schedule | null, week: number): string[] | null {
  const playing = schedule?.[String(week)];
  if (!playing || playing.length < NFL_TEAMS.size - 8) return null;
  const set = new Set(playing);
  return [...NFL_TEAMS].filter((t) => !set.has(t)).sort();
}

export const urls = {
  state: () => `${SLEEPER}/state/nfl`,
  userLeagues: (season: string) => `${SLEEPER}/user/${USER_ID}/leagues/nfl/${season}`,
  league: (id: string) => `${SLEEPER}/league/${id}`,
  rosters: (id: string) => `${SLEEPER}/league/${id}/rosters`,
  users: (id: string) => `${SLEEPER}/league/${id}/users`,
  matchups: (id: string, week: number) => `${SLEEPER}/league/${id}/matchups/${week}`,
  schedule: (season: string) => `${SLEEPER_SCHEDULE}/${encodeURIComponent(season)}`,
  trending: (kind: "add" | "drop") => `${SLEEPER}/players/nfl/trending/${kind}?lookback_hours=24&limit=50`,
};
