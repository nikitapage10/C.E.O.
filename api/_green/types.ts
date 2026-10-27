/**
 * What the Green's league board reads (#252): Nikita's Sleeper league, trimmed to the fields the Desk shows, with the
 * predictions worked out on the server. Shared by the function (api/_green/route.ts) and the Desk
 * (apps/world/src/desk/green/league.ts).
 *
 * Only league and team names, player names and football numbers: no usernames, no avatars, nothing private.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** Positions the Green deals in. "DEF" is a team defence (Sleeper's word; FantasyPros says DST). */
export type GreenPos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
export const GREEN_POS: readonly GreenPos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Injury words, shortened: Q questionable, D doubtful, O out, IR injured reserve, SUS suspended, PUP, NA not active. */
export type GreenInjury = "Q" | "D" | "O" | "IR" | "SUS" | "PUP" | "NA";

/** Where a player's projection came from: FantasyPros' weekly projection, or his own league scores so far. */
export type ProjSource = "fp" | "form" | "none";

export interface GreenPlayer {
  /** Sleeper's player id (digits, or a team code for a defence). */
  id: string;
  name: string;
  pos: GreenPos;
  /** NFL team code, null for a free agent. */
  team: string | null;
  inj: GreenInjury | null;
  /** This week's projected points in the league's scoring, after injuries; null when nothing to go on. */
  proj: number | null;
  src: ProjSource;
  /** Average league points a game this season (weeks he scored), and the last game's; null when he hasn't played for a team here. */
  avg: number | null;
  last: number | null;
  /** FantasyPros' consensus rank at his position for this week (its start/sit order), when the key is set. */
  wk: number | null;
  /** FantasyPros' rest-of-season consensus rank, overall and by position ("RB12"), when the key is set. */
  ecr: number | null;
  posRank: string | null;
  /**
   * His bye week: FantasyPros' (`player_bye_week`), or this week when FantasyPros projects nobody on his team while its
   * projections are live; Sleeper's schedule only when FantasyPros has nothing on him.
   */
  bye: number | null;
  /** When his game kicks off this week, epoch milliseconds (FantasyPros' `player_game_kickoff_ts`, #370); absent when unknown. */
  ko?: number | null;
  /**
   * FantasyPros' own weekly projection in the league's scoring, exactly as it published it (#340): no injury scaling.
   * `proj` equals it unless he is doubtful (30%), out or on bye. Null when FantasyPros doesn't project him this week;
   * absent without FantasyPros.
   */
  fp?: number | null;
  /** Sleeper's own projection for this week in the league's scoring (#276), shown beside FantasyPros', never averaged. */
  sl?: number | null;
  /** His NFL opponent this week (a team code), from Sleeper's projections; absent when unknown. */
  opp?: string | null;
  /** FantasyPros' experts this week at his position: the best and worst rank any gave him, and their spread (#276). */
  range?: { min: number; max: number; std: number } | null;
  /** FantasyPros' tier this week at his position (1 is the top tier). */
  tier?: number | null;
  /** Rest-of-season consensus rank moved since last week: positive is up (better), negative down. */
  delta?: number | null;
  /** Share of leagues he is rostered in, 0..100 (FantasyPros' average across hosts). */
  own?: number | null;
}

/** A starter in a lineup slot ("FLEX" takes RB, WR or TE). */
export interface GreenSlot {
  slot: string;
  player: GreenPlayer | null;
  /** Points so far this week (live), 0 before kick-off. */
  pts: number;
}

export interface GreenSide {
  rosterId: number;
  team: string;
  record: string;
  /** Points so far this week. */
  pts: number;
  /** Expected final: points already scored plus projections for starters who haven't. */
  proj: number;
  starters: GreenSlot[];
}

export interface GreenMatchup {
  week: number;
  me: GreenSide;
  them: GreenSide | null;
  /** Chance Nikita wins, 0..1; null on a bye or without projections. */
  win: number | null;
  /** Some starters have scored: the game is on. */
  live: boolean;
}

/** A swap the lineup should make: start `in` in `slot` instead of `out`. */
export interface GreenSwap {
  slot: string;
  in: GreenPlayer;
  out: GreenPlayer | null;
  /** Projected points gained. */
  gain: number;
  why: string;
  /** Set when `in` was chosen over a better-projected, later-kicking Q/D starter (#370): why. */
  lateRisk?: string | null;
}

export interface GreenPickup {
  player: GreenPlayer;
  /** How many Sleeper leagues added him in the last day. */
  adds: number;
  /** One line on why. */
  why: string;
  /** Who on Nikita's bench he'd replace, if anyone is clearly worse. */
  drop: GreenPlayer | null;
}

export interface GreenStanding {
  rosterId: number;
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  me: boolean;
}

/** FantasyPros' part: "live" with the key and a good read, "waiting" without a key, "failed" when it didn't answer. */
export type FpState = "live" | "waiting" | "failed";

/** What FantasyPros' read brought back: rows per part, and the status of each part that failed (an HTTP code, "timeout" or "error"). */
export interface FpParts {
  proj: number;
  weekly: number;
  ros: number;
  injuries: number;
  /** Projections per position ("QB": 32), to see which part came back short. */
  projBy?: Record<string, number>;
  errors: { part: string; status: number | "timeout" | "error" }[];
}

/** Where the start-or-sit calls come from. */
export type CallSource = "fp" | "form";

export interface GreenBoard {
  ok: true;
  /** When the server put this together (ISO). */
  at: string;
  season: string;
  week: number;
  /** The league: its Sleeper id (for the "Open in Sleeper" link), name, size, scoring and FAAB budget. */
  league: { id: string; name: string; teams: number; scoring: string; faab: number | null };
  me: {
    rosterId: number;
    team: string;
    record: string;
    rank: number;
    pf: number;
    pa: number;
    /** Points the best possible lineup would have scored this season, minus what started: left on the bench. */
    benchLeft: number | null;
    faabLeft: number | null;
    streak: string | null;
  };
  /** Starters in slot order, then the bench, then injured reserve. */
  roster: { starters: GreenSlot[]; bench: GreenPlayer[]; reserve: GreenPlayer[] };
  matchup: GreenMatchup | null;
  swaps: GreenSwap[];
  pickups: GreenPickup[];
  standings: GreenStanding[];
  /** My players other leagues are dropping fastest today. */
  dropping: { player: GreenPlayer; drops: number }[];
  /** Teams on bye this week (Sleeper's schedule, and FantasyPros' projections when live); empty when unknown. */
  byes: string[];
  /**
   * `calls`: where the start-or-sit calls come from: "fp" when FantasyPros' projections for this week drive them,
   * "form" when they come from the players' scores here (FantasyPros waiting, failed, or without this week yet).
   */
  sources: { sleeper: "live"; fantasypros: FpState; fpAt: string | null; calls: CallSource; fpParts: FpParts | null };
  /** True when Sleeper didn't answer and this is the last good read. */
  stale?: true;
  /* #276 additions (optional, so an older board still reads) */
  calls?: GreenCall[];
  teams?: GreenTeam[];
  bids?: GreenBid[];
  trade?: GreenTrade | null;
  odds?: GreenOdds | null;
  news?: GreenNews[];
  moves?: GreenMove[];
  feeds?: GreenFeed[];
  /** The next four weeks' byes for Nikita's roster: who sits, and the lineup slots he can't fill because of it. */
  byeWeeks?: GreenByeWeek[];
}

/* ── #276: the analyst desk ── */

/**
 * One start-or-sit decision: FantasyPros' call (it decides), with Sleeper's projection beside it. `split` when the two
 * order the pair differently, or their margins differ by 3 points or more. `tiebreak` only when FantasyPros has the two
 * within a point: the projected underdog leans to the higher ceiling, the favourite to the safer floor.
 */
export interface GreenCall {
  slot: string;
  start: GreenPlayer;
  sit: GreenPlayer;
  /** True when the call changes the lineup that's set in Sleeper. */
  change: boolean;
  /** FantasyPros' (or, without it, the form's) projected margin for `start` over `sit`. */
  edge: number;
  /** Sleeper's margin for the same pair (negative: Sleeper prefers `sit`); null without both Sleeper projections. */
  slEdge: number | null;
  sleeper: "agrees" | "disagrees" | "unknown";
  split: boolean;
  tiebreak: string | null;
  /** The "late-game risk" label (#370): a Q/D starter in a later window, within the threshold of an earlier-kicking alternative; why. */
  lateRisk?: string | null;
  why: string;
}

/** One manager in the league, as the analysis sees them: never a username, only the team name. */
export interface GreenTeam {
  rosterId: number;
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  /** FAAB left (fantasy budget units, not money); null when the league doesn't use FAAB. */
  faab: number | null;
  /** Positions where their starters fall short of the league's middle, or have a bye or injury hole soon. */
  needs: string[];
  /** Positions where their bench holds a player who would start for many teams. */
  surplus: string[];
  /** Where their starters rank in the league at each position, 1 the best (QB, RB, WR, TE…). */
  posRank?: Record<string, number>;
  /** This week's opponent's roster id, null on a bye. */
  opp: number | null;
  /** This week's projected total. */
  proj: number | null;
  /** Chance of making the playoffs, 0..1, from the simulation; null without one. */
  playoff: number | null;
}

/** A free agent worth a claim, priced for FAAB against the league's needs and budgets. */
export interface GreenBid {
  player: GreenPlayer;
  /** Suggested bid in FAAB units (0 when claims are free), and the range around it. */
  bid: number;
  low: number;
  high: number;
  /** Rival teams with a need at his position and FAAB to chase him. */
  rivals: string[];
  /** A rival close in the standings who needs him: taking him blocks them. */
  blocks: string | null;
  drop: GreenPlayer | null;
  why: string;
}

/** One trade idea: a rival's surplus for Nikita's thin spot, paid from Nikita's surplus where they're thin. */
export interface GreenTrade {
  team: string;
  give: GreenPlayer[];
  get: GreenPlayer[];
  why: string;
}

/** Another game this week that moves Nikita's playoff chance, and who to root for. */
export interface GreenSwing {
  a: string;
  b: string;
  /** Root for this team. */
  root: string;
  /** Nikita's playoff chance if `root` wins, and if they lose. */
  ifWin: number;
  ifLose: number;
}

export interface GreenOdds {
  /** Chance of making the playoffs, 0..1. */
  playoff: number;
  /** Chance of each final seed, 1-based (index 0 is the 1 seed), regular season's end. */
  seeds: number[];
  playoffTeams: number;
  /** Weeks left in the regular season, this one included. */
  weeksLeft: number;
  sims: number;
  swing: GreenSwing[];
}

/** One line on the ticker: a headline, or a status change, for a player in the league. */
export interface GreenNews {
  /** Sleeper player id when matched (for the face). */
  id: string | null;
  name: string;
  text: string;
  /** ISO time, when known. */
  at: string | null;
  /** Whose player: Nikita's, his opponent's, another team's, or a free agent. */
  whose: "mine" | "opp" | "league" | "free";
  src: "fp" | "sleeper";
}

/** A recent move in the league (Sleeper's transactions): team names and players only. */
export interface GreenMove {
  team: string;
  kind: "waiver" | "free_agent" | "trade";
  adds: string[];
  drops: string[];
  /** The winning FAAB bid on a waiver claim. */
  bid: number | null;
  at: string | null;
}

/** Where a number on the board came from, and when it was read. */
export interface GreenFeed {
  name: string;
  state: "live" | "waiting" | "failed" | "off";
  at: string | null;
  note?: string;
}

export interface GreenByeWeek {
  week: number;
  /** Teams on bye that week. */
  teams: string[];
  /** Nikita's players on bye. */
  out: { id: string; name: string; pos: GreenPos }[];
  /** Fixed lineup slots (QB, RB…) he can't fill that week from his own roster. */
  holes: string[];
}

export const GREEN_PICKUPS_MAX = 8;
export const GREEN_TEXT_MAX = 60;

/* ── #276: the Commentator's call (api/_green/analysis.ts) ── */

/** The numbers the Commentator's words are written from: every figure in the words comes from here. */
export interface AnalysisFacts {
  team: string;
  record: string;
  rank: number;
  teams: number;
  matchup: { opp: string | null; proj: number | null; oppProj: number | null; win: number | null; live: boolean; pts: number; oppPts: number } | null;
  /** Positions where Nikita's lineup falls short of the league's middle, with who starts there. */
  weak: { pos: string; rank: number | null; starters: { name: string; proj: number | null; rank: string | null }[] }[];
  byes: { week: number; out: string[]; holes: string[] }[];
  injuries: { name: string; pos: string; status: string; starting: boolean }[];
  trade: { team: string; give: string[]; get: string[]; why: string } | null;
  waiver: { action: "bid" | "claim" | "hold"; player: string | null; pos: string | null; bid: number | null; low: number | null; high: number | null; faabLeft: number | null; drop: string | null; rivals: number; blocks: string | null };
  splits: { slot: string; start: string; sit: string; fp: [number, number]; sl: [number, number] }[];
  odds: { playoff: number; seeds: number[]; swing: { root: string; other: string; ifWin: number; ifLose: number }[] } | null;
  /**
   * The start-or-sit calls (#261), FantasyPros' (or, while it waits, form's): who to start over whom, the margin, how
   * sure (api/_green/confidence.ts), and each one's FantasyPros rank this week ("WR14"). Absent on an older analysis.
   */
  calls?: { slot: string; start: string; sit: string; edge: number; sure: "high" | "medium" | "low"; startRank: string | null; sitRank: string | null; change: boolean }[];
  /** A short review of FantasyPros' week (#261): its state, how its calls sat with Sleeper's, and the roster's biggest rank movers. */
  review?: { state: FpState; calls: CallSource; agree: number; disagree: number; splits: number; movers: { name: string; delta: number }[] };
}

export type AnalysisKey = "matchup" | "calls" | "weak" | "byes" | "injuries" | "trade" | "waiver" | "review";

export interface GreenAnalysis {
  at: string;
  season: string;
  week: number;
  trigger: "scheduled" | "manual";
  headline: string;
  sections: { key: AnalysisKey; title: string; text: string }[];
  facts: AnalysisFacts;
  /** A second opinion on each split decision, from OpenAI when its key is set on the server. */
  second: { start: string; sit: string; take: string }[];
  /** Who wrote the words: Claude Haiku from the facts, or the facts said plainly (no key, the month's cap, or a failed check). */
  writer: "claude" | "scripted";
  /** Why the words are scripted, when they are. */
  scripted?: "no-key" | "capped" | "failed" | "checked";
  /** Every feed the analysis used, with when it was read, and the ones that were unavailable. */
  sources: GreenFeed[];
}
