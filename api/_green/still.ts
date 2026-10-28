/**
 * Who is still to play, and what it takes to win (#551): pure helpers over the board's matchup, shared by the function
 * (the Talk and Desk chat lines), the Desk's Green page and the Lattice's scoreboard so all of them say the same thing.
 *
 * A side is "done" only when every starter's game is known and final (or a bye); one unknown game and the side is never
 * called done, and no "need" figure is made up.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { GreenMatchup, GreenSide, GreenSlot } from "./types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The starters whose game isn't over: yet to play, or playing now. */
export const stillToPlay = (side: GreenSide): GreenSlot[] => side.starters.filter((s) => s.player && (s.game === "yet" || s.game === "playing"));

/** Every starter's game is known, and none is left: nothing more can be scored (the side has at least one known game). */
export function sideDone(side: GreenSide): boolean {
  if (side.toPlay === undefined || side.unknown === undefined) return false;
  return side.toPlay === 0 && side.unknown === 0;
}

/** Whether a game state is known for the side at all. */
export const knowsGames = (side: GreenSide): boolean => side.left !== undefined;

/**
 * What the C.E.O. needs from the starters still to play to win, once the opponent's side is done: the gap plus a tenth
 * (a tie is not a win). Null while the opponent still has players to come or any game state is unknown, and null when
 * the lead is already safe (use `locked`).
 */
export function needToWin(m: GreenMatchup | null): number | null {
  if (!m?.them || !sideDone(m.them)) return null;
  const gap = m.them.pts - m.me.pts;
  return gap >= 0 ? round1(gap + 0.1) : null;
}

/** The opponent's side is done and the C.E.O. is already ahead: it's won. */
export const locked = (m: GreenMatchup | null): boolean => !!m?.them && sideDone(m.them) && m.me.pts > m.them.pts;

/** "3 to play, 14.2 projected to come", "all done", or "" when no game state is known. */
export function stillWords(side: GreenSide): string {
  if (!knowsGames(side)) return "";
  if (sideDone(side)) return "done";
  const n = side.toPlay ?? 0;
  const bits = [`${n} still to play`, `${(side.left ?? 0).toFixed(1)} projected to come`];
  if (side.unknown) bits.push(`${side.unknown} unknown`);
  return bits.join(", ");
}

/**
 * The live line Talk and the Desk chat read (#551): who is still to play on each side with their projections, and what
 * the C.E.O. needs once the opponent is done. "" when no game state is known, so nothing is said that isn't known.
 */
export function stillLine(m: GreenMatchup | null): string {
  if (!m?.them || !m.live || (!knowsGames(m.me) && !knowsGames(m.them))) return "";
  const names = (side: GreenSide) => {
    const left = stillToPlay(side);
    const shown = left.slice(0, 5).map((s) => `${s.player!.name} ${(s.player!.fp ?? s.player!.proj ?? 0).toFixed(1)}${s.game === "playing" ? " (playing)" : ""}`);
    return shown.join(", ") + (left.length > shown.length ? `, and ${left.length - shown.length} more` : "");
  };
  const part = (side: GreenSide, who: string) => {
    if (!knowsGames(side)) return `${who}: games not known`;
    if (sideDone(side)) return `${who}: done`;
    return `${who}: ${side.toPlay} still to play, ${side.left!.toFixed(1)} projected to come${names(side) ? ` (${names(side)})` : ""}${side.unknown ? `; ${side.unknown} starter game(s) not known` : ""}`;
  };
  const need = needToWin(m);
  const tail = need !== null ? ` Need ${need.toFixed(1)} to win.` : locked(m) ? " Their side is done and the C.E.O. is ahead." : "";
  return `Still to play: ${part(m.me, "C.E.O.")}; ${part(m.them, "opponent")}.${tail}`;
}
