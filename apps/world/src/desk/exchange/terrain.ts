/**
 * The book as terrain (#387): each open position is a landform on one cross-section of sea and land. Its footprint is
 * its share of what the book is worth; its summit stands against sea level, which is what was paid for it, so a
 * position in profit breaks the surface as an island and one at a loss stays under water as a seamount. Pure and
 * figure-free (shares and a -1..1 rise only), so the drawing never carries a dollar amount.
 */

export interface LandIn {
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number | null;
}

export interface Landform {
  /** Centre along the section, 0..1. */
  cx: number;
  /** Half the footprint, 0..1 of the section's width. */
  w: number;
  /** Summit against sea level: 1 is the highest island, 0 sits on the waterline, -1 the deepest seamount. */
  rise: number;
}

/** The section's edges are kept clear, so the first and last landforms don't touch the frame. */
const EDGE = 0.035;
/** Returns smaller than this (in percent) still read on the same scale as this, so a quiet book stays low. */
const FLOOR_PCT = 20;

/** A position's return in percent: Polymarket's figure when it sent one, else P&L over cost. */
export function returnPct(p: LandIn): number {
  if (p.pnlPct !== null && Number.isFinite(p.pnlPct)) return p.pnlPct;
  return Math.abs(p.cost) > 0 ? (p.pnl / Math.abs(p.cost)) * 100 : 0;
}

/**
 * The landforms in book order, left to right. Footprints share the section by value (a floor keeps a small position
 * visible); summits are the return, square-rooted so a modest gain still clears the water, scaled to the book's largest.
 */
export function landforms(ps: readonly LandIn[]): Landform[] {
  if (!ps.length) return [];
  const span = 1 - EDGE * 2;
  const vals = ps.map((p) => Math.abs(p.value));
  const total = vals.reduce((s, v) => s + v, 0);
  const minShare = Math.min(0.06, 0.5 / ps.length);
  const raw = vals.map((v) => Math.max(minShare, total > 0 ? v / total : 1 / ps.length));
  const sum = raw.reduce((s, v) => s + v, 0);
  const shares = raw.map((v) => v / sum);
  const rets = ps.map(returnPct);
  const scale = Math.max(FLOOR_PCT, ...rets.map((r) => Math.abs(r)));
  let at = EDGE;
  return ps.map((_, i) => {
    const s = shares[i]! * span;
    const cx = at + s / 2;
    at += s;
    const r = Math.max(-1, Math.min(1, rets[i]! / scale));
    return { cx, w: Math.max(0.018, s * 0.62), rise: Math.sign(r) * Math.sqrt(Math.abs(r)) };
  });
}

/** How many are above water (in profit), under it (at a loss) and on it (flat). */
export function waterline(ps: readonly Pick<LandIn, "pnl">[]): { above: number; under: number; flat: number } {
  let above = 0;
  let under = 0;
  for (const p of ps) {
    if (p.pnl >= 0.005) above++;
    else if (p.pnl <= -0.005) under++;
  }
  return { above, under, flat: ps.length - above - under };
}

/** A small steady hash of a market's name, 0..1, so its ridges keep their shape between reads. */
export function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * The land's height at x (0..1) for one landform, 0..1 of its summit: a bell with a couple of ridges worked into its
 * flanks, so it reads as ground rather than a curve.
 */
export function bell(x: number, f: Landform, sd: number): number {
  const u = (x - f.cx) / f.w;
  if (u < -2.4 || u > 2.4) return 0;
  const b = Math.exp(-u * u * 1.7);
  // Ridges on the flanks only, so the summit stays exactly where the return puts it.
  const ridge = 1 + (1 - b) * (0.16 * Math.sin(u * 7.3 + sd * 40) + 0.08 * Math.sin(u * 17.1 + sd * 90));
  return Math.min(1, Math.max(0, b * ridge));
}
