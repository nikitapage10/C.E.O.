import { usePolymarket, type PmBoard } from "./polymarket.ts";

/** The Exchange's lines for Skippy's page block (#341, desk/skippy/page.ts): the public odds board only. */

/** A plain rounded percentage, as the page block has always written it (no "<1%" or ">99%"). */
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** The Exchange's public odds board: the top few markets and their probabilities. Never positions or amounts. */
export function exchangeLines(board: PmBoard | null): string[] {
  if (!board) return [];
  const top = [...board.watch, ...board.top].filter((m) => !m.closed).slice(0, 4);
  if (!top.length) return [];
  return [`Exchange odds board (Polymarket): ${top.map((m) => `${m.question} ${m.outcome} ${pct(m.prob)}`).join("; ")}.`];
}

/** The lines for the board on hand now. */
export const pageLines = (): string[] => exchangeLines(usePolymarket.getState().board);
