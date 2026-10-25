import { bez, clamp, lerp, Poly, smoothPts } from "../wvCanvas.ts";

/**
 * The flow kit's path maths (#428): what a page's particle lines run along, with no canvas and no DOM, so it is unit
 * tested (path.test.ts). Points are canvas pixels (CSS px, the canvas's own top left at 0,0).
 */

export type Pt = readonly [number, number];

/** What a line runs along. */
export type PathSpec =
  /** From one point to another, bowed sideways by `bend` times its length (+ bows to the left of travel). */
  | { from: Pt; to: Pt; bend?: number }
  /** Through these points: smoothed (Catmull-Rom) unless `smooth` is false. */
  | { via: readonly Pt[]; smooth?: boolean }
  /** A cubic bezier: start, two controls, end. */
  | { cubic: readonly [Pt, Pt, Pt, Pt] }
  /** Already sampled (what fan and converge return). */
  | { xs: readonly number[]; ys: readonly number[] };

/** About one sample every `step` px is plenty for particles and hit-testing. */
const STEP = 6;
const MIN_N = 8;
const MAX_N = 400;

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const nFor = (len: number, step: number) => clamp(Math.ceil(len / step) + 1, MIN_N, MAX_N);

/** Sample a path into points. */
export function samplePath(spec: PathSpec, step = STEP): [number[], number[]] {
  if ("xs" in spec) return [[...spec.xs], [...spec.ys]];
  if ("cubic" in spec) {
    const [a, b, c, d] = spec.cubic;
    const n = nFor(dist(a, b) + dist(b, c) + dist(c, d), step);
    const xs: number[] = [];
    const ys: number[] = [];
    bez(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1], n, xs, ys);
    return [xs, ys];
  }
  if ("via" in spec) {
    const px = spec.via.map((p) => p[0]);
    const py = spec.via.map((p) => p[1]);
    if (px.length < 2) return [px, py];
    if (spec.smooth === false) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < px.length - 1; i++) {
        const m = Math.max(1, Math.ceil(Math.hypot(px[i + 1]! - px[i]!, py[i + 1]! - py[i]!) / step));
        for (let k = 0; k < m; k++) {
          xs.push(lerp(px[i]!, px[i + 1]!, k / m));
          ys.push(lerp(py[i]!, py[i + 1]!, k / m));
        }
      }
      xs.push(px.at(-1)!);
      ys.push(py.at(-1)!);
      return [xs, ys];
    }
    let len = 0;
    for (let i = 1; i < px.length; i++) len += Math.hypot(px[i]! - px[i - 1]!, py[i]! - py[i - 1]!);
    return smoothPts(px, py, clamp(Math.ceil(len / (px.length - 1) / step), 2, 60));
  }
  const { from: a, to: b, bend = 0.18 } = spec;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // The bow's sideways direction: the left of travel, (dy, -dx) in screen space (y down).
  const ox = dy * bend;
  const oy = -dx * bend;
  return samplePath({ cubic: [a, [a[0] + dx / 3 + ox, a[1] + dy / 3 + oy], [a[0] + (2 * dx) / 3 + ox, a[1] + (2 * dy) / 3 + oy], b] }, step);
}

/** A path, sampled, as a polyline with arc-length lookup. */
export const polyOf = (spec: PathSpec, into = new Poly()) => {
  const [xs, ys] = samplePath(spec);
  return into.set(xs, ys);
};

export interface BranchOpts {
  /** How far along toward the targets' middle the shared trunk runs, 0..1 (default .4). */
  trunk?: number;
  /** How soon each branch turns toward its own end, 0..1 (default .5): lower turns sharper. */
  ease?: number;
}

/**
 * One source fanning out to several ends (a feed splitting into its kinds, a filter's keeps and drops): every path
 * runs the same trunk out of `from`, then bends away to its own end. Paths come back in the order of `tos`.
 */
export function fan(from: Pt, tos: readonly Pt[], o: BranchOpts = {}): PathSpec[] {
  if (!tos.length) return [];
  const trunk = clamp(o.trunk ?? 0.4, 0, 0.95);
  const ease = clamp(o.ease ?? 0.5, 0.05, 1);
  const cx = tos.reduce((a, p) => a + p[0], 0) / tos.length;
  const cy = tos.reduce((a, p) => a + p[1], 0) / tos.length;
  const m: Pt = [lerp(from[0], cx, trunk), lerp(from[1], cy, trunk)];
  const dx = m[0] - from[0];
  const dy = m[1] - from[1];
  const tl = Math.hypot(dx, dy) || 1;
  const [tx, ty] = samplePath({ via: [from, m], smooth: false });
  return tos.map((to) => {
    const reach = dist(m, to) * ease;
    // The branch leaves the trunk along its direction, so the join is smooth.
    const [bx, by] = samplePath({ cubic: [m, [m[0] + (dx / tl) * reach, m[1] + (dy / tl) * reach], [lerp(m[0], to[0], 0.6), lerp(m[1], to[1], 0.9)], to] });
    return trunk > 0 ? { xs: [...tx.slice(0, -1), ...bx], ys: [...ty.slice(0, -1), ...by] } : { xs: bx, ys: by };
  });
}

/** Several sources joining into one (rooms into Skippy, inboxes into one queue): `fan` run backwards. */
export function converge(froms: readonly Pt[], to: Pt, o: BranchOpts = {}): PathSpec[] {
  return fan(to, froms, o).map((p) => {
    const s = p as { xs: number[]; ys: number[] };
    return { xs: [...s.xs].reverse(), ys: [...s.ys].reverse() };
  });
}

/* ── counts and flow ── */

/** The most particles one line carries, and a whole field (a laptop stays smooth whatever the data says). */
export const LINE_MAX = 240;
export const FIELD_MAX = 2400;

/**
 * How many particles a line of this length carries at a density (0..1): about one every 6 px at full density, at
 * least 4 so a quiet line still shows it is alive, capped at LINE_MAX; a phone carries a bit over half.
 */
export function flowCount(len: number, density: number, phone = false): number {
  const n = Math.round((Math.max(0, len) / 6) * clamp(density, 0, 1) * (phone ? 0.55 : 1));
  return clamp(n, 4, LINE_MAX);
}

/** Counts scaled down together so the field stays under FIELD_MAX. */
export function capCounts(ns: readonly number[], max = FIELD_MAX): number[] {
  const sum = ns.reduce((a, b) => a + b, 0);
  if (sum <= max) return [...ns];
  const k = max / sum;
  return ns.map((n) => Math.max(2, Math.floor(n * k)));
}

/** Whether particle `i` passes a filter that keeps `keep` (0..1) of them: a fixed, even pick, the same every frame. */
export const passes = (i: number, keep: number) => ((i * 0.6180339887) % 1) < keep;

/** Where a pulse sent at `t0` along a line of length `len` is at `t` (0..1), or null once it has arrived. */
export function pulseU(t0: number, t: number, speed: number, len: number): number | null {
  const u = ((t - t0) * speed) / Math.max(1, len);
  return u < 0 || u > 1 ? null : u;
}

/** The line nearest a point within `tol` px, by id, or null. */
export function nearestLine(lines: Iterable<{ id: string; poly: Poly }>, x: number, y: number, tol = 10): { id: string; u: number; d: number } | null {
  let best: { id: string; u: number; d: number } | null = null;
  for (const L of lines) {
    if (L.poly.n < 2) continue;
    const r = L.poly.nearest(x, y);
    if (r.d <= tol && (!best || r.d < best.d)) best = { id: L.id, u: r.u, d: r.d };
  }
  return best;
}
