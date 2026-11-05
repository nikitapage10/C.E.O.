import { pct, pts, useGreen, type GreenBoard, type GreenPlayer } from "./league.ts";

/**
 * The Green's lines for Skippy's page block (#341, desk/skippy/page.ts): the start/sit calls first (FantasyPros
 * decides, Sleeper beside it), then the lineup. From the board the Desk already loaded, no extra reads.
 */

const who = (p: GreenPlayer) => {
  const bits = [p.pos, p.inj ? `${p.inj}` : "", `FP ${pts(p.fp ?? p.proj)}`, p.sl !== undefined ? `Sleeper ${pts(p.sl)}` : "", p.wk ? `${p.pos}${p.wk} this week` : ""].filter(Boolean);
  return `${p.name} (${bits.join(", ")})`;
};

/** The Green's start/sit calls and lineup, calls first. Empty without a board. */
export function greenLines(board: GreenBoard | null): string[] {
  if (!board) return [];
  const out: string[] = [];
  const m = board.matchup;
  const head = `Green, week ${board.week}, ${board.league.scoring}${m?.win != null ? `: win chance ${pct(m.win)}` : ""}${m?.them ? `, projected ${pts(m.me.proj)} to ${pts(m.them.proj)}` : ""}. Start/sit: ${board.sources.calls === "fp" ? "FantasyPros decides" : "form decides while FantasyPros waits"}, Sleeper beside it.`;
  out.push(head);
  for (const c of board.calls ?? []) {
    const verb = c.change ? "start" : "keep";
    const sl = c.sleeper === "unknown" ? "Sleeper has no projection" : `Sleeper ${c.sleeper}`;
    out.push(`Call ${c.slot}: ${verb} ${who(c.start)} over ${who(c.sit)}; FP edge ${pts(Math.abs(c.edge))}; ${sl}${c.split ? "; split decision" : ""}${c.tiebreak ? "; settled by the tiebreak" : ""}.`);
    if (c.tiebreak) out.push(`${c.slot} ${c.tiebreak}`);
    if (c.lateRisk) out.push(`${c.slot} ${c.lateRisk}`);
  }
  if (!board.calls?.length) out.push("No close start/sit calls this week.");
  const starters = board.roster.starters.filter((s) => s.player).map((s) => `${s.slot} ${s.player!.name} FP ${pts(s.player!.fp ?? s.player!.proj)}${s.player!.sl !== undefined ? ` / SLP ${pts(s.player!.sl)}` : ""}${s.player!.inj ? ` ${s.player!.inj}` : ""}`);
  if (starters.length) out.push(`Starters: ${starters.join("; ")}.`);
  const bench = board.roster.bench.slice(0, 6).map((p) => `${p.name} ${p.pos} FP ${pts(p.fp ?? p.proj)}${p.sl !== undefined ? ` / SLP ${pts(p.sl)}` : ""}`);
  if (bench.length) out.push(`Bench: ${bench.join("; ")}.`);
  if (board.byes.length) out.push(`On bye this week: ${board.byes.join(", ")}.`);
  return out;
}

/** The lines for the board on hand now. */
export const pageLines = (): string[] => greenLines(useGreen.getState().board);
