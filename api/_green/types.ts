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
  /** FantasyPros' rest-of-season consensus rank, overall and by position ("RB12"), when the key is set. */
  ecr: number | null;
  posRank: string | null;
  /** His bye week, when FantasyPros says. */
  bye: number | null;
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
  sources: { sleeper: "live"; fantasypros: FpState; fpAt: string | null };
  /** True when Sleeper didn't answer and this is the last good read. */
  stale?: true;
}

export const GREEN_PICKUPS_MAX = 8;
export const GREEN_TEXT_MAX = 60;
