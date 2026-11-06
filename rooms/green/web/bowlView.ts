import { onBye, type GreenBoard, type GreenPlayer, type GreenSlot } from "../data/league.ts";
import { formation, yardAt, type Tok, type TokState } from "./stadium.ts";

/**
 * What the bowl shows (#824), worked out from the league board alone, with no three.js: both lineups standing on the
 * turf in formation (each a pillar of what he has scored, and the wire of what FantasyPros still has him for), the
 * ball on the yard line of the win chance, the names on the end zones and the jumbotron, and the calls set over the
 * scene. Everything here is the board's: an empty board is an empty field, never a made-up one.
 */

/** The FantasyPros figure to show: its own number as published (#340), else the board's projection (form, or an older board). */
export const fpPts = (p: GreenPlayer): number | null => (p.fp != null ? p.fp : p.proj);

/** "Tyrone Tracy Jr." → "Tracy"; a defence keeps its name's last word ("D/ST"). */
export const surname = (name: string) => {
  const w = name.split(/\s+/).filter((x) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(x));
  return w[w.length - 1] ?? name;
};

export interface Man {
  tok: Tok;
  p: GreenPlayer | null;
  pts: number;
  mine: boolean;
  risk: boolean;
}

/** Both teams' starters as the bowl draws them: what each has scored, what FantasyPros still has him for, his mark. */
export function lineups(board: GreenBoard | null): { mine: Man[]; theirs: Man[] } {
  if (!board) return { mine: [], theirs: [] };
  const m = board.matchup;
  const live = !!m?.live;
  const calls = board.calls ?? [];
  const outs = new Set(calls.filter((c) => c.change).map((c) => c.sit.id));
  const risks = new Set(calls.filter((c) => c.lateRisk).map((c) => c.sit.id));
  const man = (s: GreenSlot, i: number, mine: boolean): Man => {
    const p = s.player;
    const state: TokState = !p ? "empty" : onBye(p, board.week) ? "bye" : p.inj && ["O", "IR", "SUS"].includes(p.inj) ? "out" : mine && outs.has(p.id) ? "sit" : "";
    const scored = live ? Math.max(0, s.pts) : 0;
    const proj = p ? (fpPts(p) ?? p.sl ?? 0) : 0;
    return { tok: { id: p?.id ?? `${mine ? "m" : "t"}-${i}`, slot: s.slot, pos: p?.pos ?? s.slot, banked: scored, proj: Math.max(scored, proj), state }, p, pts: s.pts, mine, risk: !!p && risks.has(p.id) };
  };
  return {
    mine: board.roster.starters.map((s, i) => man(s, i, true)),
    theirs: (m?.them?.starters ?? []).map((s, i) => man(s, i, false)),
  };
}

/** One starter on the turf, for the scene. Ids are unique across both sides (theirs are prefixed). */
export interface BowlMan {
  id: string;
  mine: boolean;
  along: number;
  across: number;
  banked: number;
  proj: number;
  state: TokState;
}

export interface BowlSide {
  team: string;
  /** What the scoreboard shows: points so far once the game is on, the projection before it. */
  score: number;
}

export interface BowlView {
  week: number;
  league: string;
  live: boolean;
  /** Your chance to win, 0..1; null on a bye or without projections (then there is no line of scrimmage). */
  win: number | null;
  /** Where the ball sits, a share of the field's length (midfield without a win chance). */
  ball: number;
  me: BowlSide | null;
  them: BowlSide | null;
  men: BowlMan[];
}

/** The scene's own id for a starter: yours by player id, theirs prefixed so the same player can't collide. */
export const manId = (x: Man) => (x.mine ? x.tok.id : `t:${x.tok.id}`);

export function bowlView(board: GreenBoard | null, ups = lineups(board)): BowlView {
  const m = board?.matchup ?? null;
  const live = !!m?.live;
  const win = m?.win ?? null;
  const spotsMine = formation(
    ups.mine.map((x) => x.tok),
    "mine",
  );
  const spotsTheirs = formation(
    ups.theirs.map((x) => x.tok),
    "theirs",
  );
  const men: BowlMan[] = [
    ...ups.mine.map((x, i) => ({ x, s: spotsMine[i]! })),
    ...ups.theirs.map((x, i) => ({ x, s: spotsTheirs[i]! })),
  ].map(({ x, s }) => ({ id: manId(x), mine: x.mine, along: s.along, across: s.across, banked: x.tok.banked, proj: x.tok.proj, state: x.tok.state }));
  return {
    week: m?.week ?? board?.week ?? 0,
    league: board?.league.name ?? "",
    live,
    win,
    ball: win === null ? 0.5 : yardAt(win * 100),
    me: m ? { team: m.me.team, score: live ? m.me.pts : m.me.proj } : board ? { team: board.me.team, score: 0 } : null,
    them: m?.them ? { team: m.them.team, score: live ? m.them.pts : m.them.proj } : null,
    men,
  };
}

/** A call set over the scene: what to do, and where on the page it opens. */
export interface BowlCall {
  key: string;
  tag: "Start" | "Set" | "Watch" | "Claim";
  text: string;
  go: "calls" | "wire";
}

/**
 * The calls over the bowl, straight from the board: each lineup change FantasyPros makes (two at most), a late-game
 * risk on a call that keeps the lineup, the first bid worth placing on the wire. With no change to make, it says the
 * lineup's set. Empty without a board.
 */
export function bowlCalls(board: GreenBoard | null): BowlCall[] {
  if (!board) return [];
  const calls = board.calls ?? [];
  const out: BowlCall[] = [];
  const changes = calls.filter((c) => c.change);
  for (const c of changes.slice(0, 2)) out.push({ key: `s-${c.slot}-${c.start.id}`, tag: "Start", text: `${c.start.name}, ${c.start.pos} · over ${surname(c.sit.name)}`, go: "calls" });
  if (!changes.length) out.push({ key: "set", tag: "Set", text: calls.length ? `Lineup's set · ${calls.length} close call${calls.length === 1 ? "" : "s"} kept` : "Lineup's set", go: "calls" });
  const risk = calls.find((c) => !c.change && c.lateRisk);
  if (risk) out.push({ key: `r-${risk.start.id}`, tag: "Watch", text: `${risk.start.name} · late-game risk`, go: "calls" });
  const bid = board.bids?.[0];
  if (bid) {
    const faab = board.league.faab !== null && bid.bid > 0;
    out.push({ key: `c-${bid.player.id}`, tag: "Claim", text: `${bid.player.name}, ${bid.player.pos}${faab ? ` · bid ${bid.bid}` : ""}`, go: "wire" });
  }
  return out;
}
