/**
 * The Green's predictions (#252), worked out on the server from what Sleeper (and FantasyPros, when its key is set)
 * said. Pure: no reads, no clock, so every call is testable.
 *
 *   Projection   FantasyPros' weekly projection in the league's scoring when it has one for the player; otherwise
 *                his form here (#266): his league scores this season, the last three games weighted over the season
 *                (weeks he didn't score are taken as byes or injuries and left out). Out, IR or suspended counts as zero,
 *                doubtful as 30%; a bye week as zero. Questionable takes 85% off his form only: a published
 *                projection (FantasyPros', Sleeper's) already prices the risk and is used as published (#340: the
 *                board showed Goedert, questionable, at 7.5 when FantasyPros had him at 8.8 in half PPR). FantasyPros'
 *                own number is kept beside it (`fp`), so the board never shows a FantasyPros figure FantasyPros didn't give.
 *   Byes         FantasyPros' bye week for the player (`player_bye_week`) and Sleeper's schedule (a team with no game
 *                this week). Never inferred from rows missing in FantasyPros' answer, which can be partial (#266). A player on bye or out is
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
import { fpIndex, nameKey } from "./fantasypros.js";
import type { League, MatchupRow, Move, NflState, Roster, Schedule, SlimPlayer, SlProj } from "./sleeper.js";
import { NFL_TEAMS, USER_ID, byesOf } from "./sleeper.js";
import { bidCandidates, bidsFor, bestLineup, callsFor, simulate, teamsFor, tradeFor, worth, type OddsGame, type OddsTeam, type RosterView } from "./analyst.js";
import { GREEN_PICKUPS_MAX, type FpState, type GreenBoard, type GreenByeWeek, type GreenInjury, type GreenMove, type GreenNews, type GreenPickup, type GreenPlayer, type GreenPos, type GreenSide, type GreenSlot, type GreenStanding, type GreenSwap } from "./types.js";

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
  /** Sleeper's own projections for this week (#276), by player id; null when they didn't answer. */
  slProj?: Record<string, SlProj> | null;
  /** The league's moves this week and last (#276). */
  moves?: Move[];
  /** The rest of the regular season's matchups, next week first (#276): who plays whom. */
  future?: MatchupRow[][];
  at: string;
}

/** Whether FantasyPros' weekly data (projections or this week's consensus) is in for this week. */
export const fpLiveFor = (fp: FpData | null, week: number): boolean => fp !== null && fp.week === week && (fp.proj.length > 0 || (fp.weekly?.length ?? 0) > 0);

/** The teams FantasyPros puts on bye this week: those whose players' `player_bye_week` is this week. Null when it has nothing for this week. */
export function fpByeTeams(fp: FpData | null, week: number): Set<string> | null {
  if (!fp || fp.week !== week) return null;
  const out = new Set<string>();
  for (const r of [...(fp.weekly ?? []), ...fp.ranks]) if (r.bye === week && r.team && NFL_TEAMS.has(r.team)) out.add(r.team);
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
/** What a published projection (FantasyPros', Sleeper's) is scaled by: doubtful only; it already prices a questionable tag (#340). */
const PUBLISHED_FACTOR: Partial<Record<GreenInjury, number>> = { D: 0.3 };

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
    // FantasyPros' own bye week for him decides; with nothing from FantasyPros on him, its byes by team and then
    // Sleeper's schedule. A team missing from a partial answer is not a bye (#266).
    const onBye = fpBye !== null ? fpBye === week : inSet(fpByes) || inSet(schedByes);
    const bye = onBye ? week : fpBye;
    let proj: number | null = null;
    let src: GreenPlayer["src"] = "none";
    if (fpWeek && v?.proj != null) {
      proj = v.proj;
      src = "fp";
    } else {
      // FantasyPros' answer can leave players out (#266): his form here stands in, marked as form, and the start/sit
      // calls still never start a player FantasyPros doesn't know this week (lineupSwaps, fpOnly).
      const f = formProjection(scores);
      if (f !== null) {
        proj = f;
        src = "form";
      } else if (fpWeek && v?.wk != null) src = "fp";
    }
    const slRaw = input.slProj?.[id];
    let sl: number | null = slRaw ? slRaw.pts : null;
    if (onBye || (inj && OUT.has(inj))) {
      proj = 0;
      if (sl !== null) sl = 0;
    } else if (inj) {
      if (proj !== null) proj = round1(proj * ((src === "fp" ? PUBLISHED_FACTOR : INJ_FACTOR)[inj] ?? 1));
      if (sl !== null) sl = round1(sl * (PUBLISHED_FACTOR[inj] ?? 1));
    }
    // FantasyPros' own figure for him this week, as it published it (none on a bye, or when it doesn't project him).
    const fpOwn = fpWeek && v?.proj != null && !onBye ? v.proj : null;
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
      ...(v?.ko != null && { ko: v.ko }),
      ...(fp && { fp: fpOwn }),
      ...(input.slProj && { sl }),
      ...(slRaw?.opp && { opp: slRaw.opp }),
      ...(v && { range: v.range, tier: v.tier, delta: v.delta, own: v.own }),
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

  const desk = analystDesk({ input, mine, teamName, player, sideOf, meSide, matchup, bench, swaps, pickups, standings, byes, ptsOf, fpOf, free: free.map((p) => player(p.id)) });

  return {
    ok: true,
    at,
    season: state.season,
    week,
    ...(state.nflWeek !== undefined && { nflWeek: state.nflWeek }),
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
    ...desk,
  };
}

/* ── #276: the analyst desk, from the whole league ── */

interface DeskIn {
  input: ModelInput;
  mine: Roster;
  teamName: (r: Roster) => string;
  player: (id: string) => GreenPlayer;
  sideOf: (r: Roster, row: MatchupRow | undefined) => GreenSide & { varr: number };
  meSide: GreenSide & { varr: number };
  matchup: GreenBoard["matchup"];
  bench: GreenPlayer[];
  swaps: GreenSwap[];
  pickups: GreenPickup[];
  standings: GreenStanding[];
  byes: Set<string> | null;
  ptsOf: (id: string) => number;
  fpOf: (p: SlimPlayer) => FpView | null;
  /** Every free agent at a position the league starts. */
  free: GreenPlayer[];
}

/** Points a game a team can expect, and the spread of one week's score, for the simulation. */
const TEAM_SD = 22;

function analystDesk(d: DeskIn): Pick<GreenBoard, "calls" | "teams" | "bids" | "trade" | "odds" | "news" | "moves" | "byeWeeks"> {
  const { input, mine, teamName, player, sideOf, meSide, matchup, bench, swaps, pickups, standings } = d;
  const { league, state, rosters, matchups, fp, schedule } = input;
  const week = state.week;

  // The byes for a week: Sleeper's schedule, and FantasyPros' own bye weeks for players it ranks.
  const fpByeByTeam = new Map<number, Set<string>>();
  for (const r of [...(fp?.weekly ?? []), ...(fp?.ranks ?? [])]) if (r.bye && r.team && NFL_TEAMS.has(r.team)) fpByeByTeam.set(r.bye, (fpByeByTeam.get(r.bye) ?? new Set()).add(r.team));
  const byesIn = (w: number): Set<string> => new Set([...(byesOf(schedule ?? null, w) ?? []), ...(fpByeByTeam.get(w) ?? []), ...(w === week ? (d.byes ?? []) : [])]);
  const ahead = [0, 1, 2, 3].map((k) => week + k).filter((w) => w >= 1 && w <= 18);
  const upcoming = ahead.map(byesIn);

  // Every roster as the analysis sees it.
  const views: RosterView[] = rosters.map((r) => {
    const row = matchups.find((m) => m.rosterId === r.rosterId);
    const opp = row?.matchupId != null ? (matchups.find((m) => m.matchupId === row.matchupId && m.rosterId !== r.rosterId)?.rosterId ?? null) : null;
    return {
      rosterId: r.rosterId,
      team: teamName(r),
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pf: r.pf,
      faab: league.faab !== null ? Math.max(0, league.faab - r.faabUsed) : null,
      players: [...new Set([...r.players, ...r.reserve])].map(player),
      games: r.wins + r.losses + r.ties,
      opp,
    };
  });
  const sides = new Map(rosters.map((r) => [r.rosterId, r === mine ? meSide : sideOf(r, matchups.find((m) => m.rosterId === r.rosterId))]));
  const projOf = new Map([...sides].map(([id, s]) => [id, matchups.length ? s.proj : null]));

  // The playoff odds: this week as it stands, then the rest of the regular season from each team's mean.
  let odds: GreenBoard["odds"] = null;
  let byTeam: Map<number, number> | null = null;
  if (week >= 1 && week < league.playoffStart && matchups.length) {
    const oddsTeams: OddsTeam[] = views.map((v) => {
      const ppg = v.games ? v.pf / v.games : null;
      const best = bestLineup(league.slots, v.players.filter((p) => !(p.inj && ["O", "IR", "SUS", "PUP", "NA"].includes(p.inj))), worth).total;
      const mean = ppg !== null && best > 0 ? 0.6 * ppg + 0.4 * best : (ppg ?? (best || 90));
      return { rosterId: v.rosterId, team: v.team, wins: v.wins, losses: v.losses, ties: v.ties, pf: v.pf, mean, sd: TEAM_SD };
    });
    const pairsOf = (rows: MatchupRow[]) => {
      const by = new Map<number, number[]>();
      for (const r of rows) if (r.matchupId != null) by.set(r.matchupId, [...(by.get(r.matchupId) ?? []), r.rosterId]);
      return [...by.values()].filter((p) => p.length === 2).map(([a, b]) => ({ a: a!, b: b! }));
    };
    const thisWeek: OddsGame[] = pairsOf(matchups).map(({ a, b }) => {
      const sa = sides.get(a);
      const sb = sides.get(b);
      return { a, b, ...(sa && sa.proj > 0 && { aMean: sa.proj, aSd: Math.max(4, Math.sqrt(sa.varr)) }), ...(sb && sb.proj > 0 && { bMean: sb.proj, bSd: Math.max(4, Math.sqrt(sb.varr)) }) };
    });
    const rest = (input.future ?? []).slice(0, Math.max(0, league.playoffStart - week - 1)).map(pairsOf);
    const sim = simulate(oddsTeams, [thisWeek, ...rest], mine.rosterId, league.playoffTeams, Number(state.season) * 100 + week);
    if (sim) {
      odds = sim.odds;
      byTeam = sim.byTeam;
    }
  }

  const teams = teamsFor(league.slots, views, week, upcoming, projOf, byTeam);
  const locked = (id: string) => d.ptsOf(id) !== 0;
  const calls = callsFor(meSide.starters, bench, swaps, week, matchup?.win ?? null, locked);

  // FAAB bids on the pickups.
  const rank = new Map(standings.map((s, i) => [s.rosterId, i + 1]));
  const thisByes = upcoming[0] ?? new Set<string>();
  const holesNow = new Set(meSide.starters.filter((s) => s.player && ((s.player.team && thisByes.has(s.player.team)) || (s.player.inj && ["O", "IR", "SUS"].includes(s.player.inj)))).map((s) => s.player!.pos));
  const history = (input.moves ?? []).filter((m) => m.kind === "waiver" && m.bid !== null).map((m) => m.bid!);
  const meView = views.find((v) => v.rosterId === mine.rosterId)!;
  const meTeam = teams.find((t) => t.rosterId === mine.rosterId);
  const benchIds = new Set(bench.map((b) => b.id));
  // The weakest bench player who'd make room: same position first, never a lone QB or defence.
  const dropFor = (cand: GreenPlayer, taken: Set<string>): GreenPlayer | null => {
    const pool = meView.players.filter((p) => benchIds.has(p.id) && !taken.has(p.id) && worth(p) + 2 < worth(cand));
    const same = pool.filter((p) => p.pos === cand.pos).sort((a, b) => worth(a) - worth(b))[0];
    const any = pool.filter((p) => !["QB", "DEF", "K"].includes(p.pos) || meView.players.filter((x) => x.pos === p.pos).length > 1).sort((a, b) => worth(a) - worth(b))[0];
    if (same ?? any) return same ?? any ?? null;
    // A full roster has to cut someone: the weakest bench player who isn't the only one at his position.
    return meView.players.filter((p) => benchIds.has(p.id) && !taken.has(p.id) && meView.players.filter((x) => x.pos === p.pos).length > 1).sort((a, b) => worth(a) - worth(b))[0] ?? null;
  };
  const taken = new Set<string>();
  const adds = input.adds;
  const bids = bidsFor(
    bidCandidates(d.free, adds, meTeam, meView.players, league.slots, week).map((p) => {
      const known = pickups.find((x) => x.player.id === p.id);
      const drop = known?.drop && !taken.has(known.drop.id) ? known.drop : dropFor(p, taken);
      if (drop) taken.add(drop.id);
      return { player: p, adds: adds[p.id] ?? 0, drop, covers: (known?.why.startsWith("Covers for") ?? false) || holesNow.has(p.pos) };
    }),
    teams,
    mine.rosterId,
    league.faab,
    league.faab !== null ? Math.max(0, league.faab - mine.faabUsed) : null,
    rank,
    history,
  );

  const me = meView;
  const trade = tradeFor(league.slots, me, views.filter((v) => v.rosterId !== mine.rosterId), teams);

  // The bye calendar: the next four weeks, who of Nikita's sits and which fixed slots he can't fill.
  const fixed = league.slots.filter((s) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(s));
  const byeWeeks: GreenByeWeek[] = ahead.map((w, k) => {
    const set = upcoming[k]!;
    const off = (p: GreenPlayer) => (p.team !== null && set.has(p.team)) || (w === week && p.bye === w);
    const outList = me.players.filter(off);
    const able = me.players.filter((p) => !off(p) && !(p.inj && ["IR", "SUS", "PUP"].includes(p.inj)));
    const holes: string[] = [];
    for (const pos of new Set(fixed)) {
      const need = fixed.filter((s) => s === pos).length;
      if (able.filter((p) => p.pos === pos).length < need) holes.push(pos);
    }
    return { week: w, teams: [...set].sort(), out: outList.map((p) => ({ id: p.id, name: p.name, pos: p.pos })), holes };
  });

  // The ticker: FantasyPros' headlines for players in the league, then Sleeper's injury flags and the hottest adds.
  const owner = new Map<string, number>();
  for (const r of rosters) for (const id of [...r.players, ...r.reserve]) owner.set(id, r.rosterId);
  const oppId = matchup?.them?.rosterId ?? null;
  const whose = (id: string | null): GreenNews["whose"] => {
    const o = id ? owner.get(id) : undefined;
    return o === undefined ? "free" : o === mine.rosterId ? "mine" : o === oppId ? "opp" : "league";
  };
  const byFpid = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const id of owner.keys()) {
    const slim = input.players[id];
    if (!slim) continue;
    const v = d.fpOf(slim);
    if (v?.fpid) byFpid.set(v.fpid, id);
    byName.set(nameKey(slim.n), id);
  }
  const news: GreenNews[] = [];
  for (const n of fp?.news ?? []) {
    const id = (n.fpid ? byFpid.get(n.fpid) : undefined) ?? (n.name ? byName.get(nameKey(n.name)) : undefined) ?? null;
    if (!id) continue;
    const name = player(id).name;
    // A headline that opens with his name reads twice on the ticker: the name is shown already.
    const text = n.text.toLowerCase().startsWith(name.toLowerCase()) ? n.text.slice(name.length).replace(/^(?:['’]s\b)?[\s:,-]*/, "") || n.text : n.text;
    news.push({ id, name, text, at: n.at, whose: whose(id), src: "fp" });
  }
  const INJ_LINE: Partial<Record<GreenInjury, string>> = { Q: "questionable", D: "doubtful", O: "out", IR: "on injured reserve", SUS: "suspended" };
  const flagged = [...me.players, ...(oppId !== null ? (views.find((v) => v.rosterId === oppId)?.players ?? []) : [])].filter((p) => p.inj && INJ_LINE[p.inj] && !news.some((n) => n.id === p.id));
  for (const p of flagged) news.push({ id: p.id, name: p.name, text: `${INJ_LINE[p.inj!]}${p.bye === week ? ", and on bye" : ""}`, at: null, whose: whose(p.id), src: "sleeper" });
  for (const p of pickups.slice(0, 3)) if (p.adds >= 1000) news.push({ id: p.player.id, name: p.player.name, text: `free agent, added in ${p.adds >= 100_000 ? `${Math.round(p.adds / 1000)}k` : `${Math.round(p.adds / 100) / 10}k`} leagues today`, at: null, whose: "free", src: "sleeper" });
  const ORDER: Record<GreenNews["whose"], number> = { mine: 0, opp: 1, free: 2, league: 3 };
  news.sort((a, b) => ORDER[a.whose] - ORDER[b.whose] || (b.at ?? "").localeCompare(a.at ?? ""));

  // The league's latest moves.
  const nameOf = (rid: number) => views.find((v) => v.rosterId === rid)?.team ?? `Team ${rid}`;
  const moves: GreenMove[] = (input.moves ?? []).slice(0, 10).map((m) => ({
    team: m.rosterIds.map(nameOf).join(" & ") || "A team",
    kind: m.kind,
    adds: Object.keys(m.adds).map((id) => player(id).name),
    drops: Object.keys(m.drops).map((id) => player(id).name),
    bid: m.kind === "waiver" ? m.bid : null,
    at: m.at ? new Date(m.at).toISOString() : null,
  }));

  return { calls, teams, bids, trade, odds, news: news.slice(0, 16), moves, byeWeeks };
}

function reasonOut(p: GreenPlayer | null, week: number, fpOnly = false): string | null {
  if (!p) return "the slot is empty";
  if (p.bye !== null && p.bye === week) return `${p.name} is on bye`;
  if (p.inj && OUT.has(p.inj)) return `${p.name} is ${p.inj === "IR" ? "on IR" : p.inj === "SUS" ? "suspended" : "out"}`;
  if (fpOnly && p.src !== "fp") return `FantasyPros doesn't rank or project ${p.name} this week`;
  if (p.inj === "D") return `${p.name} is doubtful`;
  return null;
}

/** The late-game risk rule (#370): a Q/D starter loses his slot to an earlier-kicking bench player FantasyPros has within this many points. */
export const LATE_GAME_RISK_GAP = 1.5;
/** How much later his kickoff must be to count as a later window (3 hours: Sunday 1pm and 4pm are different windows, 1:00 and 1:25 are not). */
export const LATE_GAME_WINDOW_MS = 3 * 60 * 60 * 1000;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The weekday of a kickoff in US Eastern time (NFL's calendar). */
const dayOf = (ms: number): string => {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/New_York" }).format(new Date(ms));
  return DAY_NAMES.includes(d) ? d : "later";
};

/** The published FantasyPros figure for the gap: his own number, else the board's projection. */
const fpGapPts = (p: GreenPlayer) => p.fp ?? p.proj;

/**
 * The earlier-kicking bench alternative to a questionable or doubtful starter, if the rule applies: he is Q or D, the
 * alternative isn't, his game kicks off a window earlier, and FantasyPros has them under LATE_GAME_RISK_GAP apart.
 * Null otherwise (a missing kickoff or projection never triggers it).
 */
export function lateGameAlt(starter: GreenPlayer, options: GreenPlayer[]): { alt: GreenPlayer; why: string } | null {
  if ((starter.inj !== "Q" && starter.inj !== "D") || starter.ko == null) return null;
  const sp = fpGapPts(starter);
  if (sp == null) return null;
  const alt = options
    .filter((a) => a.id !== starter.id && a.inj !== "Q" && a.inj !== "D" && a.ko != null && starter.ko! - a.ko >= LATE_GAME_WINDOW_MS)
    .filter((a) => {
      const ap = fpGapPts(a);
      return ap != null && Math.abs(sp - ap) < LATE_GAME_RISK_GAP;
    })
    .sort((a, b) => (fpGapPts(b) ?? 0) - (fpGapPts(a) ?? 0) || a.ko! - b.ko!)[0];
  if (!alt) return null;
  const tag = starter.inj === "Q" ? "questionable" : "doubtful";
  const gap = Math.abs(sp - fpGapPts(alt)!).toFixed(1);
  return { alt, why: `Late-game risk: ${starter.name} is ${tag} and kicks off ${dayOf(starter.ko)}; ${alt.name} plays ${dayOf(alt.ko!)} and FantasyPros has them just ${gap} apart (under ${LATE_GAME_RISK_GAP}), so ${alt.name} starts and nothing waits on a late status.` };
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
  const nowInEarly = new Set(current.map((c) => c.player?.id).filter(Boolean) as string[]);
  const benchIds = new Set(bench.map((b) => b.id));
  const lateRisk = new Map<string, string>();
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
      // Late-game risk (#370): a Q/D starter whose game is in a later window than a close bench alternative's.
      const risk = nowInEarly.has(pick.id) ? lateGameAlt(pick, pool.filter((p) => benchIds.has(p.id) && !used.has(p.id) && !locked(p.id) && !unavailable(p) && takes.includes(p.pos))) : null;
      const chosen = risk ? risk.alt : pick;
      if (risk) lateRisk.set(chosen.id, risk.why);
      best[i] = chosen;
      used.add(chosen.id);
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
    const forced = reasonOut(out, week);
    const risk = lateRisk.get(p.id);
    if (gain < 0.5 && !forced && !risk) continue;
    taken.add(hit.k);
    const why = forced ?? risk ?? (out ? `${p.name} projects ${(p.proj ?? 0).toFixed(1)}, ${out.name} ${(out.proj ?? 0).toFixed(1)}` : "the slot is empty");
    swaps.push({ slot: hit.c.slot, in: p, out, gain, why, ...(risk && !forced && { lateRisk: risk }) });
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
