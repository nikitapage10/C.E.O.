import type { Fitting, GState, PipeRow } from "../systemsGraph.ts";

/**
 * The Boiler Room's rack as particle lines (#390): pure geometry and the line each real connection becomes. Every room
 * is one straight line, left to right, with a valve for each connection in the order the data flows (pipeRows): what
 * feeds the room sits before its keeper, right-aligned so every keeper stands in one column, and what the room feeds
 * is spread after it. Positions are fractions of the track's width, so the DOM (valves, labels) and the canvas (the
 * lines) read the same numbers. Each stretch between two valves carries the state of its own connection:
 * flowing (steady), under load (thins out), waiting (a dashed bed) or broken (stops dead, a red knot at its valve).
 */

export interface RackCols {
  /** Most feeds before a keeper, and most fed after it, across every row. */
  ins: number;
  outs: number;
}

export const rackCols = (rows: PipeRow[]): RackCols => ({ ins: Math.max(1, ...rows.map((r) => r.ins.length)), outs: Math.max(1, ...rows.map((r) => r.outs.length)) });

export interface RowGeo {
  /** 0..1 across the track. */
  ins: number[];
  hub: number;
  outs: number[];
}

/** Where the valves and the keeper sit on one row, as fractions of the track. */
export function rowGeo(r: PipeRow, cols: RackCols): RowGeo {
  const cw = 1 / (cols.ins + 1 + cols.outs);
  const hub = (cols.ins + 0.5) * cw;
  const ins = r.ins.map((_, i) => (cols.ins - r.ins.length + i + 0.5) * cw);
  const end = 1 - 0.5 * cw;
  const n = r.outs.length;
  const outs = r.outs.map((_, i) => hub + ((end - hub) * (i + 1)) / n);
  return { ins, hub, outs };
}

export interface Seg {
  /** Stable line id: row, side and fitting. */
  id: string;
  fit: Fitting;
  /** Its stretch, 0..1 across the track. */
  a: number;
  b: number;
  /** Where its valve sits along the stretch (0 at a, 1 at b): a feed's valve starts it, a fed part's ends it. */
  valveU: number;
  state: GState;
}

export const segId = (row: string, f: Fitting) => `${row}|${f.side}|${f.id}`;

/** Every stretch of one row: a feed runs from its valve to the next one (or the keeper), a fed part from the one before. */
export function segsOf(r: PipeRow, g: RowGeo): Seg[] {
  const out: Seg[] = [];
  r.ins.forEach((f, i) => out.push({ id: segId(r.id, f), fit: f, a: g.ins[i]!, b: i + 1 < r.ins.length ? g.ins[i + 1]! : g.hub, valveU: 0, state: f.state }));
  r.outs.forEach((f, i) => out.push({ id: segId(r.id, f), fit: f, a: i ? g.outs[i - 1]! : g.hub, b: g.outs[i]!, valveU: 1, state: f.state }));
  return out;
}

export interface LineLook {
  density: number;
  rate: number;
  waiting?: boolean;
  thin?: { at: number; keep: number };
  knots?: number[];
  bright: number;
  /** Broken lines turn the warning red. */
  red?: boolean;
  bed?: number;
}

/**
 * How a connection's state looks as a line: flowing runs steady and full; under load (busy or slow) thins out past
 * its middle and slows; waiting is the kit's dashed bed; broken stands still, dim, with a red knot at its valve.
 */
export function lookOf(s: GState, valveU: number): LineLook {
  if (s === "ok") return { density: 1, rate: 46, bright: 1, bed: 0.2 };
  if (s === "run") return { density: 0.85, rate: 24, bright: 0.95, thin: { at: 0.35, keep: 0.3 }, bed: 0.13 };
  if (s === "bad") return { density: 0.1, rate: 0, bright: 0.45, knots: [valveU], red: true, bed: 0.22 };
  return { density: 0, rate: 0, bright: 0.5, waiting: true };
}

export const STATE_WORD: Record<GState, string> = { ok: "Flowing", run: "Under load", wait: "Waiting", bad: "Broken" };
export const STATE_LONG: Record<GState, string> = { ok: "flowing", run: "under load, busy or slow", wait: "waiting, not connected yet", bad: "broken, down" };

/** What changed between two readings of the rack, for the live events (a pulse, a red burst, a rising word). */
export function changesOf(prev: Map<string, GState>, rows: PipeRow[]): { id: string; fit: Fitting; from: GState; to: GState }[] {
  const out: { id: string; fit: Fitting; from: GState; to: GState }[] = [];
  for (const r of rows)
    for (const f of [...r.ins, ...r.outs]) {
      const id = segId(r.id, f);
      const was = prev.get(id);
      if (was !== undefined && was !== f.state) out.push({ id, fit: f, from: was, to: f.state });
    }
  return out;
}
