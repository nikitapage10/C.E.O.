import { bez, HOT, knot, Parts, Poly, RC, ring, TAU, weave, WHITE, isPhone, BAD, type Viz, type VizSpec } from "../wvCanvas.ts";

/**
 * Today's fan (the approved Weave, 82-viz.js "fan"): the rooms reporting in to Skippy. Fine streams of particles leave
 * one knot on the left and fan out to the room names on the right; how busy a room is sets how many particles ride its
 * thread and how fast. A room waiting on something is a dashed thread ending in a ring; a room not set up is a dotted
 * one with a few stray motes. The daily opening (Opening.tsx) gathers its particles onto these same paths.
 */

export type FanState = "busy" | "active" | "wait" | "down" | "off";
export interface FanItem {
  id: string;
  st: FanState;
  /** 0..1, how much is happening. */
  lvl: number;
}

/** Shared with the opening: how far the fan is drawn in (0..1), which room is hovered, and the live canvas. */
export const FAN: { am: number; hot: string | null; V: Viz | null; items: FanItem[] } = { am: 1, hot: null, V: null, items: [] };

interface Thread {
  id: string;
  st: FanState;
  lvl: number;
  poly: Poly;
  P: Parts;
  xs: number[];
  ys: number[];
  rx: number[];
  ry: number[];
}
const THREADS = new Map<string, Thread>();
interface FanLayout {
  cx: number;
  cy: number;
  xe: number;
  ys: number[];
  th: Thread[];
}

/** Thread i from Skippy's knot (left) to its room (right), in the canvas's own coordinates, with a slow sway. */
function fanPts(L: FanLayout, i: number, t: number, n: number, xs: number[], ys: number[]) {
  const { cx, cy, xe } = L;
  const ye = L.ys[i]!;
  bez(cx, cy, cx + (xe - cx) * 0.42, cy, cx + (xe - cx) * 0.55, ye, xe, ye, n, xs, ys);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    ys[k] = ys[k]! + Math.sin(u * TAU * 1.3 + t * 0.7 + i * 1.7) * 3.2 * Math.sin(Math.PI * u);
  }
}

/** The fan's threads in page (client) coordinates, for the opening to land its particles on. */
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

/** The fan for these rooms; `labels` holds one positioned element per room, in the same order. */
export function fanSpec(items: FanItem[], labels: React.RefObject<HTMLUListElement | null>): VizSpec {
  return {
    lay(V) {
      FAN.V = V;
      FAN.items = items;
      const lis = Array.from(labels.current?.children ?? []) as HTMLElement[];
      let mw = 0;
      for (const li of lis) mw = Math.max(mw, (li.firstElementChild ?? li).getBoundingClientRect().width);
      const ph = isPhone(V.cv);
      const pad = ph ? 12 : 18;
      const ys = items.map((_, i) => pad + (i * (V.H - 2 * pad)) / Math.max(1, items.length - 1));
      lis.forEach((li, i) => (li.style.top = `${ys[i]}px`));
      // Threads are kept across data refreshes (the spec is rebuilt each minute), so the particles never jump.
      const th = items.map((r) => {
        const key = `${r.id}:${r.st}`;
        let x = THREADS.get(key);
        if (!x) {
          x = { id: r.id, st: r.st, lvl: r.lvl, poly: new Poly(), P: new Parts(r.st === "off" ? 8 : r.st === "wait" ? 10 : Math.round(26 + r.lvl * 120), 0.08), xs: new Array<number>(40), ys: new Array<number>(40), rx: new Array<number>(40), ry: new Array<number>(40) };
          THREADS.set(key, x);
        }
        return x;
      });
      th.forEach((x, i) => (x.lvl = items[i]!.lvl));
      V.s.fan = { cx: ph ? 14 : 6, cy: V.H / 2, xe: V.W - mw - 14, ys, th } satisfies FanLayout;
    },
    draw(V, c, t, dt) {
      const L = V.s.fan as FanLayout | undefined;
      if (!L) return;
      const am = FAN.am;
      if (am <= 0.001) return;
      L.th.forEach((th, i) => {
        fanPts(L, i, t, 40, th.xs, th.ys);
        for (let k = 0; k < 40; k++) {
          th.rx[k] = th.xs[39 - k]!;
          th.ry[k] = th.ys[39 - k]!;
        }
        th.poly.set(th.rx, th.ry);
        const rgb = RC[th.id] ?? WHITE;
        const hot = FAN.hot === th.id ? 1 : 0;
        const dim = FAN.hot && !hot ? 0.45 : 1;
        if (th.st === "wait") {
          weave(c, th.poly, th.P, { a: 0.45 * am * dim, sp: 0.8, sz: 0.7, v: 0, rgb, line: (0.32 + 0.3 * hot) * am, dash: [3, 5], nofade: true }, t, 0);
          ring(c, th.poly.x[0]!, th.poly.y[0]!, 3.5, rgb, 0.8 * am);
          return;
        }
        if (th.st === "off") {
          c.globalAlpha = 1;
          c.strokeStyle = `rgba(${rgb},${(0.1 + 0.25 * hot) * am})`;
          c.lineWidth = 0.8;
          c.setLineDash([1.5, 5]);
          th.poly.stroke(c);
          c.setLineDash([]);
          weave(c, th.poly, th.P, { a: 0.35 * am * dim + 0.4 * hot, sp: 0.6, sz: 0.6, v: 6, rgb }, t, dt);
          return;
        }
        const lvl = th.lvl;
        weave(c, th.poly, th.P, { a: (0.55 + 0.55 * lvl + 0.4 * hot) * am * dim, sp: 1.1 + 1.6 * lvl, sz: 0.75 + 0.35 * lvl, v: 16 + 56 * lvl, rgb, rgb2: WHITE, line: (0.1 + 0.18 * lvl + 0.2 * hot) * am, jit: 0.3 }, t, dt);
        if (th.st === "busy") knot(c, th.poly.x[0]!, th.poly.y[0]!, 0.5, t, rgb, am);
        if (th.st === "down") ring(c, th.poly.x[0]!, th.poly.y[0]!, 4, BAD, 0.9 * am);
      });
      knot(c, L.cx, L.cy, 0.85 + 0.08 * Math.sin(t * 2.2), t, HOT, am);
    },
  };
}
