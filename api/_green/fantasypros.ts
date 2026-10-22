/**
 * FantasyPros' official public API (#252; api.fantasypros.com/public/v2/json, an `x-api-key` header). Only where the
 * key is set: on Azure it is the `FANTASYPROS` app setting (a Key Vault reference, infra/resources.bicep); on Vercel it
 * isn't set, and the Green runs on Sleeper alone and says the FantasyPros part is waiting. The key is read from the
 * environment at call time, sent only in that header, and never logged, stored or put in an error.
 *
 *   /nfl/<season>/projections?position=<P>&week=<w>&scoring=<S>     this week's projected points, one call a position
 *   /nfl/<season>/consensus-rankings?position=<P>&type=WEEKLY&scoring=<S>&week=<w>   this week's consensus, one call a
 *                                                                    position: FantasyPros' own start/sit order
 *   /nfl/<season>/consensus-rankings?position=ALL&type=ROS&scoring=<S>&week=<w>   rest-of-season consensus (ECR)
 *   /nfl/injuries?year=<season>&week=<w>                             the injury report
 *
 * Each player's bye is the rankings' `player_bye_week` (a string, "14"); the weekly rankings' first, then the ROS.
 * What answered is kept as counts per part, with the status of any part that failed (never the key, never a URL).
 *
 * At most thirteen calls, every six hours (cache.ts keeps the trimmed answer in the private store, so warm and cold
 * instances alike share one read). Answers are untrusted: only the fields used are kept, names cleaned, numbers checked.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { cleanText, getJson, num, type Fetcher, type SlimPlayer } from "./sleeper.js";
import type { FpParts, GreenInjury, GreenPos } from "./types.js";

export const FP_BASE = "https://api.fantasypros.com/public/v2/json";
const FP_MAX_BYTES = 6_000_000;

/** The key, or null when it isn't set (or is blank). */
export function fpKey(env: Record<string, string | undefined> = process.env): string | null {
  const k = env.FANTASYPROS?.trim();
  return k ? k : null;
}

export type FpScoring = "STD" | "HALF" | "PPR";
export const scoringOf = (rec: number): FpScoring => (rec >= 0.75 ? "PPR" : rec >= 0.25 ? "HALF" : "STD");

export interface FpProj {
  /** FantasyPros' own player id, which its rankings carry too (absent in copies kept before #259). */
  fpid?: string | null;
  name: string;
  pos: GreenPos;
  team: string | null;
  pts: number;
}

export interface FpRank {
  /** FantasyPros' own player id (`player_id`), to find his weekly projection whatever the name says. */
  fpid?: string | null;
  name: string;
  pos: GreenPos;
  team: string | null;
  yh: string | null;
  sr: string | null;
  ecr: number;
  posRank: string | null;
  bye: number | null;
}

export interface FpInjury {
  name: string;
  yh: string | null;
  inj: GreenInjury | null;
}

export interface FpData {
  at: string;
  season: string;
  week: number;
  scoring: FpScoring;
  proj: FpProj[];
  /** This week's consensus rankings, every position (absent in copies kept before #259). */
  weekly?: FpRank[];
  /** Rest-of-season consensus. */
  ranks: FpRank[];
  injuries: FpInjury[];
  /** What answered (absent in copies kept before #259). */
  parts?: FpParts;
}

/** Thrown when no part of FantasyPros answered; carries which part failed how. */
export class FpUnavailable extends Error {
  constructor(readonly parts: FpParts) {
    super("fantasypros unavailable");
  }
}

/** A failed read's status, for the diagnostics: the HTTP code, "timeout" or "error". Never the message (it could carry a URL). */
export function statusOf(e: unknown): number | "timeout" | "error" {
  if (e instanceof Error && /^upstream \d{3}$/.test(e.message)) return Number(e.message.slice(9));
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout";
  return "error";
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const TEAM = /^[A-Z]{2,3}$/;

/** FantasyPros' team codes where they differ from Sleeper's. */
const TEAM_ALIAS: Record<string, string> = { JAC: "JAX", WSH: "WAS", LA: "LAR", LV: "LV", OAK: "LV", SD: "LAC", STL: "LAR" };
export const teamOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  return TEAM.test(t) ? (TEAM_ALIAS[t] ?? t) : null;
};

const posOf = (v: unknown): GreenPos | null => {
  const p = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (p === "DST" || p === "DEF" || p === "D/ST") return "DEF";
  return p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K" ? p : null;
};

/** FantasyPros' player id: digits, as a number or a string. */
const fpidOf = (v: unknown): string | null => {
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d{1,9}$/.test(s) ? s : null;
};

const FP_INJ: Record<string, GreenInjury> = { Q: "Q", D: "D", O: "O", OUT: "O", IR: "IR", "COV-IR": "IR", PUP: "PUP", S: "SUS", NS: "O" };

/** A name for matching: lower case, letters only, suffixes dropped ("D.K. Metcalf Jr." → "dkmetcalf"). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

export function shapeProjections(raw: unknown, scoring: FpScoring, posHint: GreenPos): FpProj[] {
  const field = scoring === "PPR" ? "points_ppr" : scoring === "HALF" ? "points_half" : "points";
  const out: FpProj[] = [];
  for (const v of arr(obj(raw).players)) {
    const p = obj(v);
    const pos = posOf(p.position_id) ?? posHint;
    const statsRaw = p.stats;
    const stats = obj(Array.isArray(statsRaw) ? statsRaw[0] : statsRaw);
    const pts = num(stats[field]) ?? num(stats.points);
    const team = teamOf(p.team_id);
    const name = pos === "DEF" ? (team ?? "") : cleanText(p.name);
    if (!name || pts === null || pts < -10 || pts > 80) continue;
    out.push({ fpid: fpidOf(p.fpid), name, pos, team, pts: Math.round(pts * 10) / 10 });
  }
  return out;
}

export function shapeRankings(raw: unknown): FpRank[] {
  const out: FpRank[] = [];
  for (const v of arr(obj(raw).players)) {
    const p = obj(v);
    const pos = posOf(p.player_position_id ?? p.player_positions);
    const ecr = num(p.rank_ecr);
    if (!pos || ecr === null || ecr < 1 || ecr > 2000) continue;
    const team = teamOf(p.player_team_id);
    const name = pos === "DEF" ? (team ?? "") : cleanText(p.player_name);
    if (!name) continue;
    const yh = typeof p.player_yahoo_id === "string" && /^\d{1,8}$/.test(p.player_yahoo_id) ? p.player_yahoo_id : null;
    const sr = typeof p.sportsdata_id === "string" && /^[0-9a-f-]{36}$/i.test(p.sportsdata_id) ? p.sportsdata_id.toLowerCase() : null;
    const posRank = typeof p.pos_rank === "string" && /^[A-Z/]{1,4}\d{1,3}$/.test(p.pos_rank) ? p.pos_rank.replace("DST", "DEF") : null;
    const bye = num(p.player_bye_week);
    out.push({ fpid: fpidOf(p.player_id), name, pos, team, yh, sr, ecr: Math.round(ecr), posRank, bye: bye !== null && bye >= 1 && bye <= 18 ? bye : null });
  }
  return out;
}

export function shapeInjuries(raw: unknown): FpInjury[] {
  const out: FpInjury[] = [];
  for (const v of arr(obj(raw).injuries)) {
    const p = obj(v);
    const name = cleanText(p.name);
    if (!name) continue;
    const short = typeof p.status_short === "string" ? p.status_short.trim().toUpperCase() : "";
    const yh = typeof p.yahoo_id === "string" && /^\d{1,8}$/.test(p.yahoo_id) ? p.yahoo_id : null;
    out.push({ name, yh, inj: FP_INJ[short] ?? null });
  }
  return out;
}

const PROJ_POS: Record<GreenPos, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DST" };

/**
 * Reads this week's projections and consensus, the rest-of-season consensus and the injury report. A part that fails is
 * left empty and noted; when every part fails it throws FpUnavailable (the caller then says FantasyPros didn't answer).
 */
export async function readFantasyPros(fetcher: Fetcher, key: string, season: string, week: number, rec: number, positions: GreenPos[]): Promise<FpData> {
  const scoring = scoringOf(rec);
  const init: RequestInit = { headers: { "x-api-key": key } };
  const get = (path: string) => getJson(fetcher, `${FP_BASE}${path}`, FP_MAX_BYTES, init);
  const y = encodeURIComponent(season);
  const [projParts, weeklyParts, rest] = await Promise.all([
    Promise.allSettled(positions.map((p) => get(`/nfl/${y}/projections?position=${PROJ_POS[p]}&week=${week}&scoring=${scoring}`).then((r) => shapeProjections(r, scoring, p)))),
    Promise.allSettled(positions.map((p) => get(`/nfl/${y}/consensus-rankings?position=${PROJ_POS[p]}&type=WEEKLY&scoring=${scoring}&week=${week}`).then(shapeRankings))),
    Promise.allSettled([get(`/nfl/${y}/consensus-rankings?position=ALL&type=ROS&scoring=${scoring}&week=${week}`).then(shapeRankings), get(`/nfl/injuries?year=${y}&week=${week}`).then(shapeInjuries)]),
  ]);
  const [ranks, injuries] = rest;
  const errors: FpParts["errors"] = [];
  const fail = (part: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") errors.push({ part, status: statusOf(r.reason) });
  };
  projParts.forEach((r, i) => fail(`projections ${PROJ_POS[positions[i]!]}`, r));
  weeklyParts.forEach((r, i) => fail(`weekly ${PROJ_POS[positions[i]!]}`, r));
  fail("ROS rankings", ranks);
  fail("injuries", injuries);
  const proj = projParts.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const weekly = weeklyParts.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const ros = ranks.status === "fulfilled" ? ranks.value : [];
  const inj = injuries.status === "fulfilled" ? injuries.value : [];
  const parts: FpParts = { proj: proj.length, weekly: weekly.length, ros: ros.length, injuries: inj.length, errors };
  if (!proj.length && !weekly.length && ranks.status === "rejected" && injuries.status === "rejected") throw new FpUnavailable(parts);
  return { at: new Date().toISOString(), season, week, scoring, proj, weekly, ranks: ros, injuries: inj, parts };
}

/** What FantasyPros says about one Sleeper player. */
export interface FpView {
  proj: number | null;
  /** This week's consensus rank at his position, FantasyPros' start/sit order (1 is the surest start). */
  wk: number | null;
  ecr: number | null;
  posRank: string | null;
  bye: number | null;
  inj: GreenInjury | null;
}

/**
 * Matches FantasyPros' players to Sleeper's: by Sportradar id, then Yahoo id, then name and position (team for
 * defences). His weekly projection follows the ranking's FantasyPros id when there is one, else the name.
 */
export function fpIndex(fp: FpData): (p: SlimPlayer) => FpView | null {
  const ranksBy = (list: FpRank[]) => {
    const bySr = new Map<string, FpRank>();
    const byYh = new Map<string, FpRank>();
    const byName = new Map<string, FpRank>();
    for (const r of list) {
      if (r.sr) bySr.set(r.sr, r);
      if (r.yh) byYh.set(r.yh, r);
      byName.set(r.pos === "DEF" ? `DEF|${r.team}` : `${r.pos}|${nameKey(r.name)}`, r);
    }
    return (p: SlimPlayer, key: string) => (p.sr ? bySr.get(p.sr) : undefined) ?? (p.yh ? byYh.get(p.yh) : undefined) ?? byName.get(key);
  };
  const rosOf = ranksBy(fp.ranks);
  const weeklyOf = ranksBy(fp.weekly ?? []);
  const projByName = new Map<string, number>();
  const projById = new Map<string, number>();
  for (const p of fp.proj) {
    projByName.set(p.pos === "DEF" ? `DEF|${p.team}` : `${p.pos}|${nameKey(p.name)}`, p.pts);
    if (p.fpid) projById.set(p.fpid, p.pts);
  }
  const injByYh = new Map<string, FpInjury>();
  const injByName = new Map<string, FpInjury>();
  for (const i of fp.injuries) {
    if (i.yh) injByYh.set(i.yh, i);
    injByName.set(nameKey(i.name), i);
  }
  return (p) => {
    const key = p.pos === "DEF" ? `DEF|${p.team}` : `${p.pos}|${nameKey(p.n)}`;
    const rank = rosOf(p, key);
    const wk = weeklyOf(p, key);
    const byId = (r: FpRank | undefined) => (r?.fpid ? projById.get(r.fpid) : undefined);
    const byRankName = (r: FpRank | undefined) => (r && r.pos !== "DEF" ? projByName.get(`${r.pos}|${nameKey(r.name)}`) : undefined);
    const proj = byId(wk) ?? byId(rank) ?? projByName.get(key) ?? byRankName(wk) ?? byRankName(rank);
    const inj = p.pos === "DEF" ? undefined : ((p.yh ? injByYh.get(p.yh) : undefined) ?? injByName.get(nameKey(p.n)));
    if (!rank && !wk && proj === undefined && !inj) return null;
    const wkRank = wk?.posRank ? Number(wk.posRank.replace(/^\D+/, "")) : null;
    return { proj: proj ?? null, wk: wkRank !== null && Number.isFinite(wkRank) && wkRank > 0 ? wkRank : (wk?.ecr ?? null), ecr: rank?.ecr ?? null, posRank: rank?.posRank ?? null, bye: wk?.bye ?? rank?.bye ?? null, inj: inj?.inj ?? null };
  };
}
