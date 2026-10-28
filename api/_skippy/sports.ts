/**
 * Live sports for the call and the Kernel agent (#537): ESPN's free public scoreboard, no key.
 *
 *   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard[?dates=YYYYMMDD]
 *
 * One read answers a score, a game's status ("Top 6th", "Final", "7:08 PM") and, in a postseason, the series state
 * ("Brewers lead 2-1"). Any "score / right now / tonight / is the game on" ask uses it, never plain web search, which
 * finds only last night's final. A scoreboard is kept ~25 s per league and date on a warm instance. Never a made-up
 * score: when ESPN has no such game, the text says so plainly and the caller escalates (voicelookups.ts, EMPTY_LOOKUP).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { capLines, said } from "./voicereads.js";

export const ESPN_HOST = "site.api.espn.com";
export const ESPN_BASE = `https://${ESPN_HOST}/apis/site/v2/sports`;
/** How long a scoreboard is kept. */
export const SCORE_KEEP_MS = 25_000;

/** League names as Nikita says them, to ESPN's sport and league path. */
export const LEAGUES: Record<string, { sport: string; league: string; name: string }> = {
  nfl: { sport: "football", league: "nfl", name: "NFL" },
  mlb: { sport: "baseball", league: "mlb", name: "MLB" },
  nba: { sport: "basketball", league: "nba", name: "NBA" },
  nhl: { sport: "hockey", league: "nhl", name: "NHL" },
  wnba: { sport: "basketball", league: "wnba", name: "WNBA" },
  ncaaf: { sport: "football", league: "college-football", name: "college football" },
  mls: { sport: "soccer", league: "usa.1", name: "MLS" },
  epl: { sport: "soccer", league: "eng.1", name: "Premier League" },
};

/** The league a tool call names, folded ("MLB", "baseball", "college football"); null when unknown. */
export function leagueOf(raw: unknown): keyof typeof LEAGUES | null {
  if (typeof raw !== "string") return null;
  const t = raw.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (t in LEAGUES) return t;
  if (/baseball|world series/.test(t)) return "mlb";
  if (/college|ncaa/.test(t)) return "ncaaf";
  if (/football|nfl/.test(t)) return "nfl";
  if (/basketball/.test(t)) return "nba";
  if (/hockey/.test(t)) return "nhl";
  if (/premier/.test(t)) return "epl";
  if (/soccer/.test(t)) return "mls";
  return null;
}

export interface Game {
  name: string;
  state: "pre" | "in" | "post";
  /** ESPN's own status line: "Top 6th", "Final", "Thu, October 29th at 8:08 PM EDT". */
  detail: string;
  at: string;
  home: { name: string; abbr: string; score: string };
  away: { name: string; abbr: string; score: string };
  /** The postseason note and series state, when it is one ("NLCS, Game 4", "Brewers lead 2-1"). */
  note: string;
  series: string;
}

const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** ESPN's scoreboard JSON as games; anything malformed is skipped, never guessed. */
export function parseScoreboard(raw: unknown): Game[] {
  const events = obj(raw).events;
  if (!Array.isArray(events)) return [];
  const games: Game[] = [];
  for (const e of events.slice(0, 60)) {
    const ev = obj(e);
    const comp = obj(Array.isArray(ev.competitions) ? ev.competitions[0] : null);
    const cs = Array.isArray(comp.competitors) ? comp.competitors.map(obj) : [];
    const side = (which: string) => {
      const c = cs.find((x) => x.homeAway === which);
      if (!c) return null;
      const team = obj(c.team);
      const name = str(team.displayName) || str(team.name);
      const score = typeof c.score === "string" || typeof c.score === "number" ? String(c.score) : "";
      return name ? { id: str(c.id ?? team.id, 20), name, abbr: str(team.abbreviation, 6), score } : null;
    };
    const home = side("home");
    const away = side("away");
    const type = obj(obj(ev.status).type);
    const state = type.state === "in" || type.state === "post" || type.state === "pre" ? type.state : null;
    if (!home || !away || !state) continue;
    const notes = Array.isArray(comp.notes) ? comp.notes.map(obj) : [];
    const series = obj(comp.series);
    let seriesText = "";
    if (series.type === "playoff" || Array.isArray(series.competitors)) {
      const wins = (Array.isArray(series.competitors) ? series.competitors.map(obj) : []).map((c) => ({ id: str(c.id, 20), wins: Number(c.wins) }));
      const a = wins.find((w) => w.id === away.id);
      const h = wins.find((w) => w.id === home.id);
      if (a && h && Number.isFinite(a.wins) && Number.isFinite(h.wins)) {
        seriesText = a.wins === h.wins ? `series tied ${a.wins}-${h.wins}` : a.wins > h.wins ? `${away.name} lead the series ${a.wins}-${h.wins}` : `${home.name} lead the series ${h.wins}-${a.wins}`;
      } else seriesText = str(series.summary, 80);
    }
    games.push({
      name: str(ev.name, 100),
      state,
      detail: str(type.shortDetail, 60) || str(type.detail, 80) || str(type.description, 40),
      at: str(ev.date, 30),
      home: { name: home.name, abbr: home.abbr, score: home.score },
      away: { name: away.name, abbr: away.abbr, score: away.score },
      note: str(obj(notes[0]).headline, 80),
      series: seriesText,
    });
  }
  return games;
}

/** Whether `query` names one of the game's teams: every word of it in a name or the abbreviation. */
export function playsIn(game: Game, query: string): boolean {
  const words = query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [game.home.name, game.away.name, game.home.abbr, game.away.abbr].join(" ").toLowerCase().split(/[^a-z0-9]+/);
  return words.every((w) => hay.includes(w));
}

/** One game as spoken: score and status, then the series. */
export function gameLine(g: Game): string {
  const score = g.state === "pre" ? `${g.away.name} at ${g.home.name}, ${g.detail}` : `${g.away.name} ${g.away.score}, ${g.home.name} ${g.home.score}, ${g.detail}`;
  const tag = g.state === "in" ? "LIVE NOW: " : g.state === "post" ? "Final: " : "Not started: ";
  return `${tag}${score}${g.note ? ` (${g.note})` : ""}${g.series ? `; ${g.series}` : ""}.`;
}

/** What the lookup says when ESPN has nothing for the ask: the caller escalates on this. */
export const NO_GAME = "ESPN's scoreboard has no such game";

/** The scoreboard's answer for an ask: the games that match (or the league's day), or NO_GAME text. */
export function scoreText(league: keyof typeof LEAGUES, team: string, days: { label: string; games: Game[] }[]): string {
  const name = LEAGUES[league]!.name;
  for (const d of days) {
    const hits = d.games.filter((g) => playsIn(g, team));
    if (hits.length) {
      const live = hits.filter((g) => g.state === "in");
      const shown = (live.length ? live : hits).slice(0, team ? 3 : 8);
      return capLines([`${name} scoreboard from ESPN (${d.label}, live, not a web search):`, ...shown.map(gameLine)]);
    }
  }
  return `${NO_GAME}${team ? ` for "${said(team, 40)}"` : ""} in ${name} today or yesterday.`;
}

const kept = new Map<string, { at: number; games: Game[] }>();
export const forgetScores = () => kept.clear();

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/** One league's scoreboard for a day (undefined = ESPN's current day), kept ~25 s. Null when ESPN doesn't answer. */
export async function readScoreboard(league: keyof typeof LEAGUES, date: string | undefined, now: number, fetcher: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<Game[] | null> {
  const l = LEAGUES[league]!;
  const key = `${league}|${date ?? ""}`;
  const k = kept.get(key);
  if (k && now - k.at < SCORE_KEEP_MS) return k.games;
  try {
    const res = await fetcher(`${ESPN_BASE}/${l.sport}/${l.league}/scoreboard${date ? `?dates=${date}` : ""}`);
    if (!res.ok) return null;
    const games = parseScoreboard(await res.json());
    if (kept.size > 40) kept.clear();
    kept.set(key, { at: now, games });
    return games;
  } catch {
    return null;
  }
}

/** The leagues tried, in order, when an ask names a team and no league. */
export const SEARCH_LEAGUES = ["mlb", "nfl", "nba", "nhl", "ncaaf"] as const;

/** The score lookup: today, then yesterday for a team that isn't on today's board; no league = every big one. */
export async function liveScores(rawLeague: unknown, rawTeam: unknown, now: number, fetcher?: (u: string) => Promise<Response>): Promise<string> {
  const team = typeof rawTeam === "string" ? rawTeam.replace(/[^\p{L}\p{N} .'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  const named = leagueOf(rawLeague);
  const leagues: (keyof typeof LEAGUES)[] = named ? [named] : team ? [...SEARCH_LEAGUES] : ["mlb"];
  let last = "";
  for (const league of leagues) {
    const today = await readScoreboard(league, undefined, now, fetcher);
    const days: { label: string; games: Game[] }[] = [{ label: "today", games: today ?? [] }];
    if (team && !(today ?? []).some((g) => playsIn(g, team))) {
      const y = await readScoreboard(league, ymd(now - 24 * 3_600_000), now, fetcher);
      days.push({ label: "yesterday", games: y ?? [] });
    }
    last = scoreText(league, team, days);
    if (!last.startsWith(NO_GAME)) return last;
  }
  return leagues.length > 1 ? `${NO_GAME} for "${said(team, 40)}" in any big league today or yesterday.` : last;
}
