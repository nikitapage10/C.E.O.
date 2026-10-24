import { bez, HOT, knot, mixRgb, Parts, Poly, RC, ring, TAU, weave, WHITE, BAD, reducedMotion, sprMix, frac, type Viz, type VizSpec } from "../wvCanvas.ts";

/**
 * The astrolabe (#385, Nikita 2026-10-24 04:58Z: "be more unique"): Today as the bridge of Skippy's ship over Ilyr.
 * Skippy is the sun at the centre; the subminds orbit him in three shells (rooms running real work on the inner one,
 * rooms waiting on something in the middle, rooms not set up yet on the outside), and every room's strand runs out of
 * the sun to its submind, light riding it as particles. How busy a room is sets how many ride and how fast, and a busy
 * strand carries a brighter pulse now and then, like a signal going out; the day's real events sit on it as knots,
 * placed by when they happened (morning at the sun, now at the submind). The rim is a 24-hour sundial of Ilyr's day on
 * the Mountain clock: the hours so far lit, the quiet hours shaded, the gnomon on now, and the crew's next twelve hours
 * dotted along the inner track. The shells turn slowly and stop while a pointer is over the chart; with reduced
 * motion everything holds still. The daily opening (Opening.tsx) gathers its particles onto these same strands.
 */

export type OrbState = "busy" | "active" | "wait" | "down" | "off";
export interface OrbItem {
  id: string;
  st: OrbState;
  /** 0..1, how much is happening. */
  lvl: number;
  /** The day's real events on the strand, as fractions along it (0 at the sun, 1 at the submind). */
  ev: number[];
  /** Which shell it orbits on, 0 (inner) to 2 (outer), and its place among that shell's planets. */
  shell: number;
  k: number;
  n: number;
}

/** The bridge's one accent (#385, the Desk's lanes): gold-white starlight. */
const STAR = mixRgb(HOT, WHITE, 0.35);

/** The chart's proportions, as fractions of its side. */
export const GEO = {
  sun: 0.068,
  shells: [0.2, 0.287, 0.362] as const,
  track: 0.408,
  rim: 0.44,
  numerals: 0.474,
};
/** How long each shell takes to come round, in seconds: the inner one quickest. */
const PERIOD = [720, 1100, 1800];
/** Where each shell's first planet starts, so the shells don't line up. */
const PHASE = [-Math.PI / 2 + 0.35, -Math.PI / 2 - 0.55, -Math.PI / 2 + 1.25];

/** Where an hour of the Mountain day sits on the rim: midnight at the foot, noon at the top, the morning on the left. */
export const dialAngle = (h: number) => Math.PI / 2 + (h / 24) * TAU;

/** Which shell a room orbits on: real work inside, waiting on something in the middle, not set up yet outside. */
export const shellOf = (p: { real: boolean; state: string }) => (p.state === "sim" || !p.real ? 2 : p.state === "waiting" ? 1 : 0);

/** A planet's angle on its shell at a turn of `rot` seconds. */
export const planetAngle = (shell: number, k: number, n: number, rot: number) => PHASE[shell]! + (k / Math.max(1, n)) * TAU + (rot / PERIOD[shell]!) * TAU;

/** Shared with the opening and the page: how far drawn in (0..1), the lit room, the live canvas, the items. */
export const ORB: { am: number; hot: string | null; hold: boolean; V: Viz | null; items: OrbItem[]; rot: number } = {
  am: 1,
  hot: null,
  hold: false,
  V: null,
  items: [],
  // The shells' turn follows the wall clock, so the chart looks the same on every open.
  rot: typeof Date !== "undefined" ? (Date.now() / 1000) % (PERIOD[0]! * PERIOD[1]! * PERIOD[2]!) : 0,
};

interface Strand {
  id: string;
  poly: Poly;
  P: Parts;
  xs: number[];
  ys: number[];
}
const STRANDS = new Map<string, Strand>();
const N = 44;

interface Lay {
  S: number;
  cx: number;
  cy: number;
  small: boolean;
  st: Strand[];
  els: (HTMLElement | null)[];
  sizes: number[];
  orbits: { poly: Poly; P: Parts }[];
  day: { poly: Poly; P: Parts };
  /** The turn's speed, 0 (held) to 1. */
  sp: number;
}

/** Strand i at turn `rot`: out of the sun, bending back against the turn like a spiral arm, to its planet's edge. */
function strandPts(L: Lay, it: OrbItem, size: number, rot: number, t: number, n: number, xs: number[], ys: number[]) {
  const a = planetAngle(it.shell, it.k, it.n, rot);
  const r0 = GEO.sun * L.S;
  const r1 = GEO.shells[it.shell]! * L.S - size / 2 - 2;
  const P = (r: number, ang: number): [number, number] => [L.cx + Math.cos(ang) * r, L.cy + Math.sin(ang) * r];
  const [x0, y0] = P(r0, a - 0.9);
  const [x1, y1] = P(r0 + (r1 - r0) * 0.45, a - 0.75);
  const [x2, y2] = P(r0 + (r1 - r0) * 0.8, a - 0.22);
  const [x3, y3] = P(r1, a);
  bez(x0, y0, x1, y1, x2, y2, x3, y3, n, xs, ys);
  if (reducedMotion()) return;
  // A slow shimmer, never at the ends.
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const w = Math.sin(u * TAU * 1.4 + t * 0.8 + it.k * 1.9 + it.shell) * 2.2 * Math.sin(Math.PI * u);
    xs[k] = xs[k]! + Math.cos(a + Math.PI / 2) * w;
    ys[k] = ys[k]! + Math.sin(a + Math.PI / 2) * w;
  }
}

/** The strands in page (client) coordinates, for the opening to land its particles on. */
export function orbPaths(t: number, n = 40): { x: number[]; y: number[] }[] | null {
  const V = ORB.V;
  const L = V?.s.orb as Lay | undefined;
  if (!V || !V.ok || !L) return null;
  const r = V.cv.getBoundingClientRect();
  return ORB.items.map((it, i) => {
    const x = new Array<number>(n);
    const y = new Array<number>(n);
    strandPts(L, it, L.sizes[i] ?? 40, ORB.rot, t, n, x, y);
    for (let k = 0; k < n; k++) {
      x[k] = x[k]! + r.left;
      y[k] = y[k]! + r.top;
    }
    return { x, y };
  });
}

/** A circle as a polyline, starting at angle a0 and running `span` radians clockwise. */
function arc(cx: number, cy: number, r: number, a0: number, span: number, n = 96, poly = new Poly()) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * span;
    xs.push(cx + Math.cos(a) * r);
    ys.push(cy + Math.sin(a) * r);
  }
  return poly.set(xs, ys);
}

export interface DialMarks {
  /** Ilyr's hour now, 0..24. */
  h: number;
  /** The quiet hours as [from, to] hours (to may pass 24). */
  quiet: [number, number];
  /** Later times the runs come round inside the next twelve hours, as hours of the dial, in their room's colour. */
  dots: { h: number; room: string }[];
}

/**
 * The chart for these rooms. The canvas's parent holds one `.td-pl` per item in the same order (its submind's planet,
 * positioned from here every frame), and the dial's marks.
 */
export function orrerySpec(items: OrbItem[], dial: DialMarks): VizSpec {
  return {
    lay(V) {
      ORB.V = V;
      ORB.items = items;
      const S = Math.min(V.W, V.H);
      const cx = V.W / 2;
      const cy = V.H / 2;
      const small = S < 480;
      const host = V.cv.parentElement;
      const els = items.map((it) => host?.querySelector<HTMLElement>(`.td-pl[data-room="${it.id}"]`) ?? null);
      const sizes = els.map((el) => (el?.querySelector(".td-pl-pf") as HTMLElement | null)?.offsetWidth || 40);
      // Strands are kept across data refreshes (the spec is rebuilt each minute), so the particles never jump.
      const st = items.map((it) => {
        const key = `${it.id}:${it.st}`;
        let s = STRANDS.get(key);
        if (!s) {
          const many = it.st === "off" ? 6 : it.st === "wait" ? 9 : Math.round((small ? 16 : 26) + it.lvl * (small ? 60 : 150));
          s = { id: it.id, poly: new Poly(), P: new Parts(many, 0.1), xs: new Array<number>(N), ys: new Array<number>(N) };
          STRANDS.set(key, s);
        }
        return s;
      });
      const orbits = GEO.shells.map((r, i) => ({ poly: arc(cx, cy, r * S, 0, TAU, 128), P: new Parts(i === 0 ? (small ? 40 : 90) : small ? 14 : 30, 0.05) }));
      const a0 = dialAngle(0);
      const day = { poly: arc(cx, cy, GEO.rim * S, a0, Math.max(0.01, (dial.h / 24) * TAU), 120), P: new Parts(small ? 50 : 110, 0.35) };
      V.s.orb = { S, cx, cy, small, st, els, sizes, orbits, day, sp: ORB.hold ? 0 : 1 } satisfies Lay;
    },
    draw(V, c, t, dt) {
      const L = V.s.orb as Lay | undefined;
      if (!L) return;
      const am = ORB.am;
      // The turn: eases to a stop while the pointer is over the chart, and back.
      const rm = reducedMotion();
      if (!rm && dt) {
        const target = ORB.hold ? 0 : 1;
        L.sp += (target - L.sp) * Math.min(1, dt * 3);
        ORB.rot += dt * L.sp;
      }
      const { S, cx, cy } = L;
      const rot = ORB.rot;

      // The sundial: the rim, its hours, the quiet hours, the day so far, and the gnomon on now.
      const R = GEO.rim * S;
      c.globalAlpha = am;
      c.lineWidth = 1;
      c.strokeStyle = `rgba(${WHITE},.16)`;
      c.beginPath();
      c.arc(cx, cy, R, 0, TAU);
      c.stroke();
      c.strokeStyle = `rgba(${WHITE},.06)`;
      c.beginPath();
      c.arc(cx, cy, R + (L.small ? 5 : 8), 0, TAU);
      c.stroke();
      const [q0, q1] = dial.quiet;
      c.strokeStyle = `rgba(${WHITE},.06)`;
      c.setLineDash([2, 4]);
      c.lineWidth = L.small ? 4 : 6;
      c.beginPath();
      c.arc(cx, cy, R - (L.small ? 3 : 4), dialAngle(q0), dialAngle(q1));
      c.stroke();
      c.setLineDash([]);
      for (let q = 0; q < 96; q++) {
        const a = dialAngle(q / 4);
        const major = q % 12 === 0;
        const hour = q % 4 === 0;
        if (L.small && !hour) continue;
        const len = major ? (L.small ? 7 : 11) : hour ? (L.small ? 4 : 6) : 2.5;
        const lit = q / 4 <= dial.h;
        c.globalAlpha = (major ? 0.6 : hour ? 0.34 : 0.16) * (lit ? 1.25 : 0.8) * am;
        c.strokeStyle = `rgba(${lit ? HOT : WHITE},1)`;
        c.lineWidth = major ? 1.3 : 1;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        c.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len));
        c.stroke();
      }
      // The numerals: the Mountain hours every three (six on a phone), in the chart's spaced sans.
      c.globalCompositeOperation = "source-over";
      c.font = `500 ${L.small ? 9 : 10.5}px "Jost Variable", Jost, Futura, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      for (let hh = 0; hh < 24; hh += L.small ? 6 : 3) {
        const a = dialAngle(hh);
        const rr = GEO.numerals * S;
        c.globalAlpha = (hh === 0 || hh === 12 ? 0.62 : 0.4) * am;
        c.fillStyle = `rgba(${WHITE},1)`;
        c.fillText(hh === 0 ? "24" : String(hh).padStart(2, "0"), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      c.globalCompositeOperation = "lighter";
      // The day so far: light running round the rim from midnight to now.
      weave(c, L.day.poly, L.day.P, { a: 0.85 * am, sp: 1.3, sz: 0.6, v: 14, line: 0.22 * am, lw: 1.2, rgb: WHITE, rgb2: HOT, col: (u) => sprMix(WHITE, HOT, u) }, t, dt);
      // The gnomon's shadow: a soft wedge trailing now, a sundial's hand.
      const an = dialAngle(dial.h);
      for (let k = 0; k < 10; k++) {
        c.globalAlpha = 0.022 * (1 - k / 10) * am;
        c.fillStyle = `rgba(${HOT},1)`;
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, R, an - 0.04 - k * 0.045, an);
        c.closePath();
        c.fill();
      }
      const g = c.createLinearGradient(cx, cy, cx + Math.cos(an) * R, cy + Math.sin(an) * R);
      g.addColorStop(0, `rgba(${HOT},0)`);
      g.addColorStop(0.3, `rgba(${HOT},.14)`);
      g.addColorStop(1, `rgba(${HOT},.6)`);
      c.globalAlpha = am;
      c.strokeStyle = g;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx + Math.cos(an) * GEO.sun * S, cy + Math.sin(an) * GEO.sun * S);
      c.lineTo(cx + Math.cos(an) * (R + 12), cy + Math.sin(an) * (R + 12));
      c.stroke();
      knot(c, cx + Math.cos(an) * R, cy + Math.sin(an) * R, L.small ? 0.55 : 0.72, t, HOT, am);
      // The next twelve hours on the inner track: a dotted way ahead, and each later run a mote in its room's colour.
      const T = GEO.track * S;
      for (let k = 1; k <= 72; k++) {
        const a = an + (k / 72) * Math.PI;
        c.globalAlpha = 0.28 * (1 - k / 90) * am;
        c.fillStyle = `rgba(${WHITE},1)`;
        c.fillRect(cx + Math.cos(a) * T - 0.6, cy + Math.sin(a) * T - 0.6, 1.2, 1.2);
      }
      for (const d of dial.dots) {
        const a = dialAngle(d.h);
        c.globalAlpha = 0.7 * am;
        c.fillStyle = `rgba(${d.room === "next" ? HOT : WHITE},.8)`;
        c.beginPath();
        c.arc(cx + Math.cos(a) * T, cy + Math.sin(a) * T, 1.5, 0, TAU);
        c.fill();
      }

      // The orbits: faint circles, the inner one carrying a slow drift of light.
      L.orbits.forEach((o, i) => {
        const used = items.some((it) => it.shell === i);
        if (i === 2) {
          c.globalAlpha = am;
          c.strokeStyle = `rgba(${WHITE},${used ? 0.07 : 0.035})`;
          c.lineWidth = 1;
          c.setLineDash([1.5, 6]);
          o.poly.stroke(c);
          c.setLineDash([]);
          return;
        }
        weave(c, o.poly, used ? o.P : null, { a: (i === 0 ? 0.32 : 0.18) * am, sp: 1.4, sz: 0.5, v: i === 0 ? 9 : 5, rgb: WHITE, rgb2: HOT, line: (used ? (i === 0 ? 0.1 : 0.07) : 0.035) * am, nofade: true }, t, dt);
      });

      // The strands and the planets on their ends.
      items.forEach((it, i) => {
        const s = L.st[i]!;
        const size = L.sizes[i] ?? 40;
        strandPts(L, it, size, rot, t, N, s.xs, s.ys);
        s.poly.set(s.xs, s.ys);
        const a = planetAngle(it.shell, it.k, it.n, rot);
        const pr = GEO.shells[it.shell]! * S;
        const px = cx + Math.cos(a) * pr;
        const py = cy + Math.sin(a) * pr;
        const el = L.els[i];
        if (el) {
          el.style.left = `${((px / V.W) * 100).toFixed(3)}%`;
          el.style.top = `${((py / V.H) * 100).toFixed(3)}%`;
          const side = Math.cos(a) >= 0 ? "r" : "l";
          if (el.dataset.side !== side) el.dataset.side = side;
        }
        // Restrained: a room's colour only tints its own light, softened toward white, and comes up when it is lit.
        const hot = ORB.hot === it.id ? 1 : 0;
        const rgb = hot && it.st !== "off" ? mixRgb(RC[it.id] ?? WHITE, WHITE, 0.25) : it.st === "off" || it.st === "wait" ? WHITE : STAR;
        const dim = ORB.hot && !hot ? 0.35 : 1;
        const knots = (sz: number, al: number) => {
          for (const u of it.ev) {
            const p = s.poly.at(u);
            knot(c, p.x, p.y, sz, t, rgb, al * am * dim);
          }
        };
        // A halo behind each live planet, brighter the busier it is.
        if (it.st !== "off") {
          const hr = size * (0.9 + 0.5 * it.lvl + 0.3 * hot);
          const hg = c.createRadialGradient(px, py, size * 0.3, px, py, hr);
          hg.addColorStop(0, `rgba(${rgb},${(0.16 + 0.22 * it.lvl + 0.15 * hot) * am * dim})`);
          hg.addColorStop(1, `rgba(${rgb},0)`);
          c.globalAlpha = 1;
          c.fillStyle = hg;
          c.beginPath();
          c.arc(px, py, hr, 0, TAU);
          c.fill();
        }
        if (it.st === "wait") {
          weave(c, s.poly, s.P, { a: 0.45 * am * dim, sp: 0.8, sz: 0.7, v: 0, rgb, line: (0.26 + 0.35 * hot) * am * dim, dash: [3, 5], nofade: true }, t, 0);
          knots(0.3, 0.6);
          ring(c, px, py, size / 2 + 5, rgb, 0.55 * am * dim, [2, 3]);
          return;
        }
        if (it.st === "off") {
          c.globalAlpha = 1;
          c.strokeStyle = `rgba(${rgb},${(0.08 + 0.3 * hot) * am})`;
          c.lineWidth = 0.8;
          c.setLineDash([1.5, 5]);
          s.poly.stroke(c);
          c.setLineDash([]);
          weave(c, s.poly, s.P, { a: (0.28 * dim + 0.45 * hot) * am, sp: 0.6, sz: 0.55, v: 5, rgb }, t, dt);
          knots(0.28, 0.45);
          return;
        }
        const lvl = it.lvl;
        // A signal going out: a brighter pulse rides a live strand, more often the busier the room.
        const hd = rm ? 0.62 : frac(t * (0.12 + 0.32 * lvl) + it.k * 0.37 + it.shell * 0.21);
        const I = (u: number) => 0.45 + 0.55 * Math.exp(-(((u - hd) / 0.09) ** 2));
        weave(c, s.poly, s.P, { a: (0.55 + 0.6 * lvl + 0.4 * hot) * am * dim, sp: 1 + 1.9 * lvl, sz: 0.72 + 0.42 * lvl, v: 18 + 70 * lvl, rgb, rgb2: HOT, line: (0.1 + 0.2 * lvl + 0.25 * hot) * am * dim, lw: 0.8 + 0.7 * lvl, jit: 0.3, I }, t, dt);
        const hp = s.poly.at(hd);
        if (lvl > 0.15) knot(c, hp.x, hp.y, 0.3 + 0.25 * lvl, t, rgb, (0.5 + 0.5 * lvl) * am * dim);
        knots(0.4, 0.9);
        if (it.st === "down") ring(c, px, py, size / 2 + 6 + Math.sin(t * 3) * 1.5, BAD, 0.9 * am);
      });

      // The sun: Skippy's glow, under his portrait.
      const sr = GEO.sun * S;
      const sg = c.createRadialGradient(cx, cy, sr * 0.6, cx, cy, sr * 3.2);
      sg.addColorStop(0, `rgba(${HOT},${0.34 * am})`);
      sg.addColorStop(0.35, `rgba(255,180,110,${0.1 * am})`);
      sg.addColorStop(1, "rgba(255,180,110,0)");
      c.globalAlpha = 1;
      c.fillStyle = sg;
      c.beginPath();
      c.arc(cx, cy, sr * 3.2, 0, TAU);
      c.fill();
      ring(c, cx, cy, sr + 6 + (rm ? 0 : Math.sin(t * 1.6) * 1.2), HOT, 0.32 * am);
      ring(c, cx, cy, sr + 14, HOT, 0.1 * am, [1, 4]);
    },
  };
}
