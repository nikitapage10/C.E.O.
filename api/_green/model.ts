/**
 * The Green's predictions (#252), worked out on the server from what Sleeper (and FantasyPros, when its key is set)
 * said. Pure: no reads, no clock, so every call is testable.
 *
 *   Projection   FantasyPros' weekly projection in the league's scoring while those are live for this week (a player
 *                it doesn't project has none, never a form fallback); without them, the player's form here: his league scores this season, the last three games weighted over the season (weeks he
 *                didn't score are taken as byes or injuries and left out). Out, IR or suspended counts as zero,
 *                doubtful as 30% and questionable as 85%; a bye week as zero.
 *   Byes         Sleeper's schedule: a team with no game this week is on bye. And while FantasyPros' projections for
 *                this week are live, a team with no projection rows at all is on bye too. FantasyPros' rankings
 *                (each player's bye week) count only when the schedule can't say. A player on bye or out is
 *                never the one a call says to start.
 *   Win chance   The two lineups' expected finals (points scored plus projections for starters still to play), with a
 *                normal spread of about 45% of each unplayed projection (at least 3 points a player).
 *   Lineup       The best lineup by projection; each change is one start-or-sit call, with how much it gains.
 *   Pickups      Free agents ranked by FantasyPros' rest-of-season consensus when it's there, else by how many Sleeper
 *                leagues added them today; each with the bench player he'd replace, when one is clearly worse.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { FpData, FpView } from "./fantasypros.js";
import { fpIndex } from "./fantasypros.js";
import type { League, MatchupRow, NflState, Roster, Schedule, SlimPlayer } from "./sleeper.js";
import { NFL_TEAMS, USER_ID, byesOf } from "./sleeper.js";
import { GREEN_PICKUPS_MAX, type FpState, type GreenBoard, type GreenInjury, type GreenPickup, type GreenPlayer, type GreenPos, type GreenSide, type GreenSlot, type GreenStanding, type GreenSwap } from "./types.js";

export interface ModelInput {
  league: League;
  state: NflState;
  rosters: Roster[];
  teamNames: Record<string, string>;
  /** This week's matchups (empty off-season). */
  matchups: MatchupRow[];
  /** Earlier weeks' matchups, any order. */
  history: MatchupRow[][];
  players: Record<string, SlimPlayer>;
  adds: Record<string, number>;
  drops: Record<string, number>;
  fp: FpData | null;
  fpState: FpState;
  /** Sleeper's schedule for the season, for the byes; null when it didn't answer. */
  schedule?: Schedule | null;
  at: string;
}

/** FantasyPros' projections count as covering the week once this many teams have rows (a bye week rests at most 8). */
const FP_TEAMS_MIN = 20;

/** Whether FantasyPros' weekly data (projections or this week's consensus) is in for this week. */
export const fpLiveFor = (fp: FpData | null, week: number): boolean => fp !== null && fp.week === week && (fp.proj.length > 0 || (fp.weekly?.length ?? 0) > 0);

/** The teams FantasyPros' projections for this week leave out entirely, once they cover the league; else null. */
function projGap(fp: FpData | null, week: number): Set<string> | null {
  if (!fp || fp.week !== week) return null;
  const teams = new Set(fp.proj.map((p) => p.team).filter((t): t is string => t !== null && NFL_TEAMS.has(t)));
  return teams.size >= FP_TEAMS_MIN ? new Set([...NFL_TEAMS].filter((t) => !teams.has(t))) : null;
}

/**
 * The teams FantasyPros puts on bye this week: those whose players' `player_bye_week` is this week, and (while its
 * projections cover the league) every team it projects nobody on. Null when FantasyPros has nothing for this week.
 */
export function fpByeTeams(fp: FpData | null, week: number): Set<string> | null {
  if (!fp || fp.week !== week) return null;
  const out = new Set<string>();
  for (const r of [...(fp.weekly ?? []), ...fp.ranks]) if (r.bye === week && r.team && NFL_TEAMS.has(r.team)) out.add(r.team);
  for (const t of projGap(fp, week) ?? []) out.add(t);
  return out.size || fpLiveFor(fp, week) ? out : null;
}

/** This week's byes from every source: FantasyPros' and Sleeper's schedule. Null when neither can say. */
export function byeTeams(schedule: Schedule | null | undefined, fp: FpData | null, week: number): Set<string> | null {
  const fromSchedule = byesOf(schedule ?? null, week);
  const fromFp = fpByeTeams(fp, week);
  if (!fromSchedule && !fromFp) return null;
  return new Set([...(fromSchedule ?? []), ...(fromFp ?? [])]);
}

const OUT: ReadonlySet<GreenInjury> = new Set(["O", "IR", "SUS", "PUP", "NA"]);
const INJ_FACTOR: Partial<Record<GreenInjury, number>> = { D: 0.3, Q: 0.85 };

/** Which positions may fill a slot. */
export function slotTakes(slot: string): GreenPos[] {
  switch (slot) {
    case "FLEX":
    case "WRT":
      return ["RB", "WR", "TE"];
    case "WRRB_FLEX":
      return ["RB", "WR"];
    case "REC_FLEX":
      return ["WR", "TE"];
    case "SUPER_FLEX":
      return ["QB", "RB", "WR", "TE"];
    case "QB":
    case "RB":
    case "WR":
    case "TE":
    case "K":
    case "DEF":
      return [slot];
    default:
      return [];
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Each player's scores this season, oldest week first, weeks without a score left out. */
export function formOf(history: MatchupRow[][]): Map<string, number[]> {
  const weeks = history.filter((w) => w.length);
  const out = new Map<string, number[]>();
  for (const week of weeks) {
    const seen = new Map<string, number>();
    for (const row of week) for (const [id, p] of Object.entries(row.playerPoints)) if (p !== 0) seen.set(id, p);
    for (const [id, p] of seen) out.set(id, [...(out.get(id) ?? []), p]);
  }
  return out;
}

/** Form projection: the last three games' average weighted 60/40 over the season's. */
export function formProjection(scores: number[] | undefined): number | null {
  if (!scores?.length) return null;
  return Math.max(0, round1(0.6 * mean(scores.slice(-3)) + 0.4 * mean(scores)));
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, plenty for a win chance). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** The spread of one unplayed player's score. */
const sdOf = (proj: number) => Math.max(3, 0.45 * proj);

export function winChance(me: { proj: number; varr: number }, them: { proj: number; varr: number }): number {
  const sd = Math.sqrt(me.varr + them.varr);
  if (sd < 1e-6) return me.proj > them.proj ? 1 : me.proj < them.proj ? 0 : 0.5;
  return Math.round(normCdf((me.proj - them.proj) / sd) * 1000) / 1000;
}

const record = (r: Roster) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;

export function isMine(r: Roster, userId = USER_ID): boolean {
  return r.ownerId === userId || r.coOwners.includes(userId);
}

/** Everything the board shows, from one set of reads. Throws "not-in-league" when Nikita has no team in it. */
export function buildBoard(input: ModelInput): GreenBoard {
  const { league, state, rosters, teamNames, matchups, history, players, adds, drops, fp, fpState, schedule, at } = input;
  const week = state.week;
  const mine = rosters.find((r) => isMine(r));
  if (!mine) throw new Error("not-in-league");
  const teamName = (r: Roster) => (r.ownerId && teamNames[r.ownerId]) || `Team ${r.rosterId}`;
  const form = formOf(history);
  const fpOf: (p: SlimPlayer) => FpView | null = fp ? fpIndex(fp) : () => null;
  // With FantasyPros' weekly data in, it is the authority for start/sit and for byes; the schedule is the backup.
  const fpWeek = fpLiveFor(fp, week);
  const fpByes = fpByeTeams(fp, week);
  const schedList = byesOf(schedule ?? null, week);
  const schedByes = schedList ? new Set(schedList) : null;
  const byes = byeTeams(schedule, fp, week);
  const fpGap = projGap(fp, week);

  const cache = new Map<string, GreenPlayer>();
  const player = (id: string): GreenPlayer => {
    const kept = cache.get(id);
    if (kept) return kept;
    const slim = players[id];
    const scores = form.get(id);
    const v = slim ? fpOf(slim) : null;
    const inj = v?.inj ?? slim?.inj ?? null;
    const team = slim?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : null);
    const fpBye = v?.bye ?? null;
    const inSet = (set: Set<string> | null | undefined) => team !== null && !!set?.has(team);
    // FantasyPros' own bye week for him decides (or its projections leaving his whole team out); with nothing from
    // FantasyPros on him, its byes by team and then Sleeper's schedule.
    const onBye = fpBye !== null ? fpBye === week || inSet(fpGap) : inSet(fpByes) || inSet(schedByes);
    const bye = onBye ? week : fpBye;
    let proj: number | null = null;
    let src: GreenPlayer["src"] = "none";
    if (fpWeek) {
      // FantasyPros decides this week. No projection from it means no projection: never his form here, which
      // can't know about a bye, a benching or a game-day scratch.
      if (v?.proj != null) proj = v.proj;
      if (v?.proj != null || v?.wk != null) src = "fp";
    } else {
      const f = formProjection(scores);
      if (f !== null) {
        proj = f;
        src = "form";
      }
    }
    if (onBye || (inj && OUT.has(inj))) proj = 0;
    else if (proj !== null && inj) proj = round1(proj * (INJ_FACTOR[inj] ?? 1));
    const p: GreenPlayer = {
      id,
      name: slim?.n ?? (/^[A-Z]{2,3}$/.test(id) ? `${id} D/ST` : `Player ${id}`),
      pos: slim?.pos ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "WR"),
      team,
      inj,
      proj,
      src,
      avg: scores?.length ? round1(mean(scores)) : null,
      last: scores?.length ? round1(scores[scores.length - 1]!) : null,
      wk: v?.wk ?? null,
      ecr: v?.ecr ?? null,
      posRank: v?.posRank ?? null,
      bye,
    };
    cache.set(id, p);
    return p;
  };

  // This week's points so far, by player, from the matchups.
  const weekPts = new Map<string, number>();
  for (const row of matchups) for (const [id, p] of Object.entries(row.playerPoints)) weekPts.set(id, p);
  const ptsOf = (id: string) => weekPts.get(id) ?? 0;

  const slotsFor = (starters: string[]): GreenSlot[] => league.slots.map((slot, i) => {
    const id = starters[i];
    return { slot, player: id && id !== "0" ? player(id) : null, pts: id && id !== "0" ? round1(ptsOf(id)) : 0 };
  });

  const sideOf = (r: Roster, row: MatchupRow | undefined): GreenSide & { varr: number } => {
    const starters = slotsFor(row?.starters.length ? row.starters : r.starters);
    let proj = 0;
    let varr = 0;
    for (const s of starters) {
      if (!s.player) continue;
      if (s.pts !== 0) proj += s.pts;
      else {
        const p = s.player.proj ?? 0;
        proj += p;
        if (p > 0) varr += sdOf(p) ** 2;
      }
    }
    return { rosterId: r.rosterId, team: teamName(r), record: record(r), pts: round1(row?.points ?? 0), proj: round1(proj), starters, varr };
  };

  const myRow = matchups.find((m) => m.rosterId === mine.rosterId);
  const theirRow = myRow?.matchupId != null ? matchups.find((m) => m.matchupId === myRow.matchupId && m.rosterId !== mine.rosterId) : undefined;
  const theirs = theirRow ? rosters.find((r) => r.rosterId === theirRow.rosterId) : undefined;
  const meSide = sideOf(mine, myRow);
  const themSide = theirs ? sideOf(theirs, theirRow) : null;
  const live = [...meSide.starters, ...(themSide?.starters ?? [])].some((s) => s.pts !== 0);
  const anyProj = meSide.starters.some((s) => s.player?.proj != null);
  const strip = ({ varr: _v, ...s }: GreenSide & { varr: number }): GreenSide => s;
  const matchup = myRow
    ? { week, me: strip(meSide), them: themSide ? strip(themSide) : null, win: themSide && (anyProj || live) ? winChance(meSide, themSide) : null, live }
    : null;

  // The roster: starters, bench, reserve.
  const starterIds = new Set(mine.starters.filter((id) => id !== "0"));
  const reserveIds = new Set(mine.reserve);
  const bench = mine.players.filter((id) => !starterIds.has(id) && !reserveIds.has(id)).map(player);
  const reserve = mine.reserve.map(player);
  const byProj = (a: GreenPlayer, b: GreenPlayer) => (b.proj ?? -1) - (a.proj ?? -1);
  bench.sort(byProj);

  const swaps = lineupSwaps(league.slots, meSide.starters, bench, (id) => ptsOf(id) !== 0, week, fpWeek);

  // Pickups.
  const owned = new Set(rosters.flatMap((r) => [...r.players, ...r.reserve]));
  const wanted = new Set(league.slots.flatMap(slotTakes));
  const free = Object.values(players).filter((p) => !owned.has(p.id) && wanted.has(p.pos));
  const pickups = pickupsFor(free.map((p) => player(p.id)), adds, bench, meSide.starters, fp !== null && fp.ranks.length > 0, (id) => players[id]?.rank ?? 9999);

  // Standings.
  const standings: GreenStanding[] = [...rosters]
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pf - a.pf)
    .map((r) => ({ rosterId: r.rosterId, team: teamName(r), wins: r.wins, losses: r.losses, ties: r.ties, pf: round1(r.pf), me: r === mine }));
  const rank = standings.findIndex((s) => s.me) + 1;

  const dropping = mine.players
    .filter((id) => (drops[id] ?? 0) > 0)
    .map((id) => ({ player: player(id), drops: drops[id]! }))
    .sort((a, b) => b.drops - a.drops)
    .slice(0, 3);

  return {
    ok: true,
    at,
    season: state.season,
    week,
    league: { id: league.id, name: league.name, teams: league.teams, scoring: league.rec >= 0.75 ? "PPR" : league.rec >= 0.25 ? "Half PPR" : "Standard", faab: league.faab },
    me: {
      rosterId: mine.rosterId,
      team: teamName(mine),
      record: record(mine),
      rank,
      pf: round1(mine.pf),
      pa: round1(mine.pa),
      benchLeft: mine.ppts !== null && mine.ppts >= mine.pf ? round1(mine.ppts - mine.pf) : null,
      faabLeft: league.faab !== null ? Math.max(0, league.faab - mine.faabUsed) : null,
      streak: mine.streak,
    },
    roster: { starters: meSide.starters, bench, reserve },
    matchup,
    swaps,
    pickups,
    standings,
    dropping,
    byes: byes ? [...byes].sort() : [],
    sources: { sleeper: "live", fantasypros: fpState, fpAt: fp?.at ?? null, calls: fpWeek ? "fp" : "form", fpParts: fp?.parts ?? null },
  };
}

function reasonOut(p: GreenPlayer | null, week: number, fpOnly = false): string | null {
  if (!p) return "the slot is empty";
  if (p.bye !== null && p.bye === week) return `${p.name} is on bye`;
  if (p.inj && OUT.has(p.inj)) return `${p.name} is ${p.inj === "IR" ? "on IR" : p.inj === "SUS" ? "suspended" : "out"}`;
  if (fpOnly && p.src !== "fp") return `FantasyPros doesn't rank or project ${p.name} this week`;
  if (p.inj === "D") return `${p.name} is doubtful`;
  return null;
}

/**
 * The start-or-sit calls: the best lineup by projection (FantasyPros' weekly rank breaking ties), compared with the one
 * set. Players already locked (scored this week) stay where they are. Each call names who comes in, who goes out, and
 * what it gains. With `fpOnly` (FantasyPros' weekly data is in), a player it neither ranks nor projects is never a start.
 */
export function lineupSwaps(slots: string[], current: GreenSlot[], bench: GreenPlayer[], locked: (id: string) => boolean, week: number, fpOnly = false): GreenSwap[] {
  const val = (p: GreenPlayer | null) => (p?.proj ?? -1);
  const wk = (p: GreenPlayer | null) => p?.wk ?? 9999;
  const better = (a: GreenPlayer, b: GreenPlayer) => val(b) - val(a) || wk(a) - wk(b);
  // On bye, out, on IR or suspended (or, with fpOnly, unknown to FantasyPros this week): never the one a call starts.
  const unavailable = (p: GreenPlayer) => reasonOut(p, week, fpOnly) !== null && p.inj !== "D";
  // Fill the fixed slots first, then the flexes, each with the best player left who fits.
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => slotTakes(a.s).length - slotTakes(b.s).length);
  const pool = [...current.map((c) => c.player).filter((p): p is GreenPlayer => p !== null), ...bench];
  const used = new Set<string>();
  const best: (GreenPlayer | null)[] = slots.map(() => null);
  // Locked starters keep their slots.
  current.forEach((c, i) => {
    if (c.player && locked(c.player.id)) {
      best[i] = c.player;
      used.add(c.player.id);
    }
  });
  for (const { s, i } of order) {
    if (best[i]) continue;
    const takes = slotTakes(s);
    const pick = pool.filter((p) => !used.has(p.id) && !locked(p.id) && !unavailable(p) && takes.includes(p.pos)).sort(better)[0];
    if (pick) {
      best[i] = pick;
      used.add(pick.id);
    }
  }
  const nowIn = new Set(current.map((c) => c.player?.id).filter(Boolean) as string[]);
  const ins = best.filter((p): p is GreenPlayer => p !== null && !nowIn.has(p.id));
  const outs = current.filter((c) => !c.player || !used.has(c.player.id));
  const swaps: GreenSwap[] = [];
  const taken = new Set<number>();
  for (const p of ins.sort(better)) {
    // The starter he replaces: an empty slot or the weakest one he can fill, same position first.
    const cands = outs
      .map((c, k) => ({ c, k }))
      .filter(({ c, k }) => !taken.has(k) && slotTakes(c.slot).includes(p.pos))
      .sort((a, b) => Number(b.c.player?.pos === p.pos) - Number(a.c.player?.pos === p.pos) || val(a.c.player) - val(b.c.player));
    const hit = cands[0];
    if (!hit) continue;
    const out = hit.c.player;
    const gain = round1((p.proj ?? 0) - Math.max(0, out?.proj ?? 0));
    const forced = reasonOut(out, week, fpOnly);
    if (gain < 0.5 && !forced) continue;
    taken.add(hit.k);
    const why = forced ?? (out ? `${p.name} projects ${(p.proj ?? 0).toFixed(1)}, ${out.name} ${(out.proj ?? 0).toFixed(1)}` : "the slot is empty");
    swaps.push({ slot: hit.c.slot, in: p, out, gain, why });
  }
  return swaps;
}

const fmtAdds = (n: number) => (n >= 100_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** Free agents worth a claim, best first, each with the bench player he'd replace when one is clearly worse. */
export function pickupsFor(free: GreenPlayer[], adds: Record<string, number>, bench: GreenPlayer[], starters: GreenSlot[], useEcr: boolean, rankOf: (id: string) => number = () => 9999): GreenPickup[] {
  const ranked = useEcr
    ? free.filter((p) => p.ecr !== null && !(p.inj && OUT.has(p.inj))).sort((a, b) => a.ecr! - b.ecr! || (adds[b.id] ?? 0) - (adds[a.id] ?? 0))
    : free.filter((p) => (adds[p.id] ?? 0) > 0 && !(p.inj && OUT.has(p.inj))).sort((a, b) => (adds[b.id] ?? 0) - (adds[a.id] ?? 0));
  // Whether a bench player is clearly worse: by consensus rank with FantasyPros; without it, by form here, and by
  // Sleeper's own popularity rank as well, so a good player who simply hasn't played for a team here is never cut.
  const worse = (cand: GreenPlayer, mine: GreenPlayer) => {
    // A player the consensus doesn't rank is unknown, not bad: never the one cut.
    if (useEcr) return mine.ecr !== null && cand.ecr !== null && mine.ecr > cand.ecr + 15;
    const lower = rankOf(mine.id) > rankOf(cand.id) + 50;
    return cand.avg !== null ? lower && (mine.avg ?? 0) + 2 < cand.avg : lower && (mine.avg ?? 0) < 4;
  };
  const hurt = starters.filter((s) => s.player && s.player.inj && OUT.has(s.player.inj)).map((s) => s.player!);
  const dropFor = (cand: GreenPlayer, gone: Set<string>): GreenPlayer | null => {
    const pool = bench.filter((b) => !gone.has(b.id) && worse(cand, b));
    const key = (b: GreenPlayer) => (useEcr ? -(b.ecr ?? 9999) : (b.avg ?? 0));
    return pool.filter((b) => b.pos === cand.pos).sort((a, b) => key(a) - key(b))[0] ?? pool.filter((b) => b.pos !== "QB" && b.pos !== "DEF").sort((a, b) => key(a) - key(b))[0] ?? null;
  };
  const gone = new Set<string>();
  return ranked.slice(0, GREEN_PICKUPS_MAX).map((p) => {
    const n = adds[p.id] ?? 0;
    const bits: string[] = [];
    const fills = hurt.find((h) => h.pos === p.pos);
    if (fills) bits.push(`Covers for ${fills.name}`);
    if (useEcr && p.ecr !== null) bits.push(`FantasyPros #${p.ecr}${p.posRank ? ` (${p.posRank})` : ""} rest of season`);
    if (n > 0) bits.push(`added in ${fmtAdds(n)} leagues today`);
    if (p.avg !== null) bits.push(`${p.avg.toFixed(1)} a game here`);
    const drop = dropFor(p, gone);
    if (drop) gone.add(drop.id);
    const why = bits.join(" · ");
    return { player: p, adds: n, why: why.charAt(0).toUpperCase() + why.slice(1), drop };
  });
}
