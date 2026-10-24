import { bez, HOT, knot, Parts, Poly, RC, ring, TAU, weave, WHITE, isPhone, BAD, reducedMotion, type Viz, type VizSpec } from "../wvCanvas.ts";

/**
 * Today's picture (#336, Nikita 2026-10-23: "I like the little dots flowing… let's keep that the most"): the rooms'
 * strands. Fine streams of particles leave Skippy's knot on the left and run out to each room's submind on the right.
 * How busy a room is sets how many particles ride its strand and how fast; the day's real events sit on it as knots,
 * placed by when they happened (Skippy's end is the morning, the submind's end is now). A room waiting on something is
 * a dashed strand ending in a ring; a room not set up is a dotted one with a few stray motes. The daily opening
 * (Opening.tsx) gathers its particles onto these same paths.
 */

export type FanState = "busy" | "active" | "wait" | "down" | "off";
export interface FanItem {
  id: string;
  st: FanState;
  /** 0..1, how much is happening. */
  lvl: number;
  /** The day's real events on the strand, as fractions along it (0 at Skippy's knot, 1 at the room). */
  ev: number[];
}

/** Shared with the opening: how far the strands are drawn in (0..1), which room is hovered, and the live canvas. */
export const FAN: { am: number; hot: string | null; V: Viz | null; items: FanItem[] } = { am: 1, hot: null, V: null, items: [] };

interface Thread {
  id: string;
  st: FanState;
  lvl: number;
  poly: Poly;
  P: Parts;
  xs: number[];
  ys: number[];
}
const THREADS = new Map<string, Thread>();
const N = 48;
interface FanLayout {
  cx: number;
  cy: number;
  xe: number[];
  ys: number[];
  th: Thread[];
}

/** Strand i from Skippy's knot (left) to its room (right), in the canvas's own coordinates, with a slow sway. */
function fanPts(L: FanLayout, i: number, t: number, n: number, xs: number[], ys: number[]) {
  const { cx, cy } = L;
  const xe = L.xe[i]!;
  const ye = L.ys[i]!;
  bez(cx, cy, cx + (xe - cx) * 0.38, cy, cx + (xe - cx) * 0.52, ye, xe, ye, n, xs, ys);
  if (reducedMotion()) return;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    ys[k] = ys[k]! + Math.sin(u * TAU * 1.3 + t * 0.7 + i * 1.7) * 3.4 * Math.sin(Math.PI * u);
  }
}

/** The strands in page (client) coordinates, for the opening to land its particles on. */
export function fanPaths(t: number, n = 40): { x: number[]; y: number[] }[] | null {
  const V = FAN.V;
  const L = V?.s.fan as FanLayout | undefined;
  if (!V || !V.ok || !L) return null;
  const r = V.cv.getBoundingClientRect();
  return L.th.map((_, i) => {
    const x = new Array<number>(n);
    const y = new Array<number>(n);
    fanPts(L, i, t, n, x, y);
    for (let k = 0; k < n; k++) {
      x[k] = x[k]! + r.left;
      y[k] = y[k]! + r.top;
    }
    return { x, y };
  });
}

/**
 * The strands for these rooms. The canvas's parent holds `.wv-loom-knot` (Skippy, where every strand starts) and one
 * `.wv-loom-pf` per room in the same order (its submind, where its strand ends); the layout is read from them.
 */
export function fanSpec(items: FanItem[]): VizSpec {
  return {
    lay(V) {
      FAN.V = V;
      FAN.items = items;
      const host = V.cv.parentElement;
      const ends = Array.from(host?.querySelectorAll(".wv-loom-pf") ?? []);
      const k = host?.querySelector(".wv-loom-knot");
      if (!k || ends.length !== items.length) {
        V.s.fan = undefined;
        return;
      }
      const kr = V.rel(k);
      const ph = isPhone(V.cv);
      const xe: number[] = [];
      const ys: number[] = [];
      for (const el of ends) {
        const r = V.rel(el);
        xe.push(r.x - (ph ? 4 : 8));
        ys.push(r.y + r.h / 2);
      }
      // Strands are kept across data refreshes (the spec is rebuilt each minute), so the particles never jump.
      const th = items.map((r) => {
        const key = `${r.id}:${r.st}`;
        let x = THREADS.get(key);
        if (!x) {
          const many = r.st === "off" ? 7 : r.st === "wait" ? 10 : Math.round((ph ? 18 : 30) + r.lvl * (ph ? 60 : 140));
          x = { id: r.id, st: r.st, lvl: r.lvl, poly: new Poly(), P: new Parts(many, 0.08), xs: new Array<number>(N), ys: new Array<number>(N) };
          THREADS.set(key, x);
        }
        x.lvl = r.lvl;
        return x;
      });
      V.s.fan = { cx: kr.x + kr.w / 2, cy: kr.y + kr.h / 2, xe, ys, th } satisfies FanLayout;
    },
    draw(V, c, t, dt) {
      const L = V.s.fan as FanLayout | undefined;
      if (!L) return;
      const am = FAN.am;
      if (am <= 0.001) return;
      L.th.forEach((th, i) => {
        fanPts(L, i, t, N, th.xs, th.ys);
        th.poly.set(th.xs, th.ys);
        const rgb = RC[th.id] ?? WHITE;
        const hot = FAN.hot === th.id ? 1 : 0;
        const dim = FAN.hot && !hot ? 0.4 : 1;
        const ev = items[i]?.ev ?? [];
        const ex = th.xs[N - 1]!;
        const ey = th.ys[N - 1]!;
        const knots = (s: number, a: number) => {
          for (const u of ev) {
            const p = th.poly.at(u);
            knot(c, p.x, p.y, s, t, rgb, a * am * dim);
          }
        };
        if (th.st === "wait") {
          weave(c, th.poly, th.P, { a: 0.45 * am * dim, sp: 0.8, sz: 0.7, v: 0, rgb, line: (0.3 + 0.35 * hot) * am * dim, dash: [3, 5], nofade: true }, t, 0);
          knots(0.32, 0.6);
          ring(c, ex, ey, 3.5, rgb, 0.8 * am);
          return;
        }
        if (th.st === "off") {
          c.globalAlpha = 1;
          c.strokeStyle = `rgba(${rgb},${(0.1 + 0.25 * hot) * am})`;
          c.lineWidth = 0.8;
          c.setLineDash([1.5, 5]);
          th.poly.stroke(c);
          c.setLineDash([]);
          weave(c, th.poly, th.P, { a: (0.32 * dim + 0.4 * hot) * am, sp: 0.6, sz: 0.6, v: 6, rgb }, t, dt);
          knots(0.3, 0.5);
          return;
        }
        const lvl = th.lvl;
        weave(c, th.poly, th.P, { a: (0.55 + 0.6 * lvl + 0.4 * hot) * am * dim, sp: 1.1 + 1.8 * lvl, sz: 0.75 + 0.4 * lvl, v: 16 + 60 * lvl, rgb, rgb2: WHITE, line: (0.1 + 0.18 * lvl + 0.22 * hot) * am * dim, lw: 0.8 + 0.5 * lvl, jit: 0.3 }, t, dt);
        knots(0.42, 0.9);
        if (th.st === "busy") knot(c, ex, ey, 0.6, t, rgb, am);
        if (th.st === "down") ring(c, ex, ey, 4.5, BAD, 0.9 * am);
      });
      knot(c, L.cx, L.cy, 1.05 + 0.08 * Math.sin(t * 2.2), t, HOT, am);
    },
  };
}
