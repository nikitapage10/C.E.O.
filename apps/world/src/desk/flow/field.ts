import { clamp, gauss, Parts, Poly, reducedMotion, spr, TAU, vizTime, WHITE, type Viz, type VizSpec } from "../wvCanvas.ts";
import { knotAt, stream } from "./draw.ts";
import { capCounts, flowCount, nearestLine, polyOf, pulseU, type PathSpec, type Pt } from "./path.ts";
import { RiseField } from "./rise.ts";

/**
 * The flow field (#428): one canvas of particle lines a page describes as data. The page hands over a layout function
 * (`FlowLayoutFn`); the field calls it only on mount, on resize and when the page asks (`relayout`), never in a frame,
 * so DOM positions are read there and nowhere else. Each frame then reads only the field's own numbers: no layout
 * reads, no React. The Desk's one shared loop draws it (wvCanvas.ts: about 40 frames a second, paused when the tab is
 * hidden, skipped off screen, gone on unmount, devicePixelRatio capped at 2, one still frame under reduced motion).
 * The lines' beds (and the ground, when the field paints its own night) are drawn once into a cached layer and laid
 * down each frame; only the particles, pulses, bursts and rising words are drawn live. Counts are capped per line and
 * for the whole field (path.ts).
 */

export interface FlowLine {
  /** Stable id: what hover and pick report, what `pulse`, `burst` and `rise` aim at. */
  id: string;
  path: PathSpec;
  /** "r,g,b"; the field's accent when left out. */
  rgb?: string;
  /** Speed along the line, px/s (default 40). Tie it to the real rate: a busy feed runs faster. */
  rate?: number;
  /** How many particles it carries, 0..1 (default .5): the real volume. */
  density?: number;
  /** How bright, 0..1 (default .85). */
  bright?: number;
  /** Half-width of the scatter about the line, px (default 2). */
  spread?: number;
  /** How much wider it opens toward its end (Today's river: 3; default 0). */
  widen?: number;
  /** Waiting (not connected, nothing yet): a dashed bed and a few slow, faint motes. Never fake flow. */
  waiting?: boolean;
  /** Real moments on the line, 0..1 along it (Today's knots). */
  knots?: readonly number[];
  /** Filtering: past `at` (0..1) only `keep` (0..1) of the particles go on. */
  thin?: { at: number; keep: number };
  /** Travel from the path's end back to its start. */
  reverse?: boolean;
  /** The bed line's alpha (default .07). */
  bed?: number;
}

export interface FlowBox {
  W: number;
  H: number;
  /** Narrower than 760 px: a phone carries fewer particles. */
  phone: boolean;
  /** An element's box relative to the canvas (read here, in the layout, never in a frame). */
  rel: (el: Element) => { x: number; y: number; w: number; h: number };
}

export interface FlowLayout {
  lines: FlowLine[];
  /** Named points words can rise from (`rise(text, { at })`), besides the lines' own ends. */
  anchors?: Record<string, Pt>;
}

export type FlowLayoutFn = (box: FlowBox) => FlowLayout;

export interface FlowOpts {
  /** The page's accent, "r,g,b" (default Today's gold). */
  accent?: string;
  /**
   * Paint the field's own night (the Desk's dark, the accent's light spilling from the top, a still dust of stars),
   * so the page under it is neither drawn nor blended: for an edge-to-edge stage. Off: the canvas is transparent.
   */
  ground?: boolean;
  /** The most backing pixels to draw into (a big soft stage can draw smaller and let the browser scale it up). */
  backing?: number;
}

export interface PulseOpts {
  rgb?: string;
  /** px/s (default three times the line's rate, at least 140). */
  speed?: number;
  /** Glow radius, px (default 9). */
  size?: number;
}

export interface FlowField {
  spec: VizSpec;
  /** The page's layout; the hook (useFlow) keeps it current. */
  layout: FlowLayoutFn;
  /** The line in focus (others dim; set it with setFocus), and the one pointed at (useFlow sets it). */
  focus: string | null;
  hot: string | null;
  setFocus: (id: string | null) => void;
  /** A bright packet that runs a line once: one real event arriving. */
  pulse: (id: string, o?: PulseOpts) => void;
  /** A spray of grains off a point on a line (0..1, default its end): something landed, failed, was filed. */
  burst: (id: string, o?: { u?: number; n?: number; rgb?: string }) => void;
  /** Words that rise off a line's end (or an anchor) and fall as sand. */
  rise: (text: string, o: { at: string; rgb?: string }) => void;
  /** The line within `tol` px of a canvas point, or null. */
  hit: (x: number, y: number, tol?: number) => { id: string; u: number } | null;
  /** A line's polyline (to place DOM labels after a layout), or null. */
  line: (id: string) => Poly | null;
  /** Ask for a fresh layout (also redraws a still frame under reduced motion). */
  relayout: () => void;
  /** Frames drawn so far (the browser test checks the loop pauses). */
  frames: number;
  rises: RiseField;
}

interface Live {
  L: FlowLine;
  poly: Poly;
  P: Parts;
  rgb: string;
  fade: number;
}
interface Pulse {
  id: string;
  t0: number;
  speed: number;
  rgb: string;
  size: number;
}

const GOLD = "232,207,156";
const BG = "#0a0b0f";
const PULSE_MAX = 32;
const GRAIN_MAX = 480;
const GROW_S = 1.8;
const STARS = Array.from({ length: 140 * 3 }, (_, i) => (i % 3 === 2 ? 0.15 + 0.45 * Math.random() ** 2 : Math.random()));

export function makeFlowField(layout: FlowLayoutFn, o: FlowOpts = {}): FlowField {
  const accent = o.accent ?? GOLD;
  let lines: Live[] = [];
  const byId = new Map<string, Live>();
  let anchors: Record<string, Pt> = {};
  let pulses: Pulse[] = [];
  // Bursts: x, y, vx, vy, t0 per grain, and its colour.
  const gr = new Float32Array(GRAIN_MAX * 5);
  const grc: string[] = new Array<string>(GRAIN_MAX).fill(WHITE);
  for (let i = 0; i < GRAIN_MAX; i++) gr[i * 5 + 4] = -1e9;
  let gn = 0;
  let gHead = 0;
  let W = 0;
  let H = 0;
  let laid = 0;
  let layerKey = "";
  let layer: HTMLCanvasElement | null = null;
  let view: Viz | null = null;

  const on = (id: string) => {
    const f = F.focus ?? F.hot;
    return !f || f === id;
  };

  const lay = (V: Viz) => {
    view = V;
    W = V.W;
    H = V.H;
    laid++;
    const phone = W < 760;
    if (V.s.open === undefined) V.s.open = reducedMotion() ? 1 : 0;
    const out = F.layout({ W, H, phone, rel: V.rel });
    anchors = out.anchors ?? {};
    const polys = out.lines.map((L) => polyOf(L.path));
    const want = capCounts(out.lines.map((L, i) => (L.waiting ? Math.min(12, flowCount(polys[i]!.len, 0.2, phone)) : flowCount(polys[i]!.len, L.density ?? 0.5, phone))));
    const next: Live[] = [];
    byId.clear();
    out.lines.forEach((L, i) => {
      const old = lines.find((x) => x.L.id === L.id);
      const n = want[i]!;
      const live: Live = { L, poly: polys[i]!, P: old && old.P.n === n ? old.P : new Parts(n, L.waiting ? 0 : 0.07), rgb: L.rgb ?? accent, fade: old?.fade ?? 1 };
      next.push(live);
      byId.set(L.id, live);
    });
    lines = next;
  };

  /** What only moves when the layout or the focus does. */
  const still = (c: CanvasRenderingContext2D, grow: number) => {
    if (o.ground) {
      c.fillStyle = BG;
      c.fillRect(0, 0, W, H);
      const g = c.createRadialGradient(W / 2, 0, 0, W / 2, 0, Math.max(W, H) * 0.6);
      g.addColorStop(0, `rgba(${accent},.075)`);
      g.addColorStop(1, `rgba(${accent},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      c.fillStyle = `rgba(${WHITE},.5)`;
      for (let i = 0; i < STARS.length; i += 3) {
        c.globalAlpha = STARS[i + 2]!;
        c.fillRect(STARS[i]! * W, STARS[i + 1]! * H, 1, 1);
      }
      c.globalAlpha = 1;
    }
    c.lineWidth = 0.8;
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const X of lines) {
      const L = X.L;
      if (X.poly.n < 2) continue;
      const base = L.bed ?? (L.waiting ? 0.05 : 0.07);
      c.strokeStyle = `rgba(${X.rgb},${base + (on(L.id) ? 0.08 : 0.008)})`;
      if (L.waiting) c.setLineDash([2, 6]);
      X.poly.stroke(c, Math.min(1, grow * 1.4));
      if (L.waiting) c.setLineDash([]);
    }
  };

  const draw = (V: Viz, c: CanvasRenderingContext2D, t: number, dt: number) => {
    F.frames++;
    const open = V.s.open as number | undefined;
    const grow = open === undefined ? 1 : open;
    if (open !== undefined && open < 1 && dt) V.s.open = Math.min(1, open + dt / GROW_S);
    c.globalCompositeOperation = "source-over";
    if (grow < 1) still(c, grow);
    else {
      const key = `${laid}|${F.focus ?? ""}|${F.hot ?? ""}|${V.cv.width}x${V.cv.height}`;
      if (key !== layerKey) {
        layerKey = key;
        layer ??= document.createElement("canvas");
        layer.width = V.cv.width;
        layer.height = V.cv.height;
        const g = layer.getContext("2d");
        if (g) {
          g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
          g.clearRect(0, 0, W, H);
          still(g, 1);
        }
      }
      c.drawImage(layer!, 0, 0, W, H);
    }
    c.globalCompositeOperation = "lighter";

    // The lines.
    const k = dt ? 1 - Math.exp(-dt * 5) : 1;
    for (const X of lines) {
      const L = X.L;
      X.fade += ((on(L.id) ? 1 : 0.15) - X.fade) * k;
      const a = X.fade * (L.bright ?? 0.85) * (L.waiting ? 0.5 : 1);
      stream(c, X.poly, X.P, { rgb: X.rgb, a, v: L.waiting ? 16 : (L.rate ?? 40), sp: L.spread ?? 2, widen: L.widen, swell: L.widen ? 0.35 : 0, head: grow * 1.4, thin: L.thin, reverse: L.reverse }, t, dt);
      if (L.knots) for (const u of L.knots) {
        const q = X.poly.at(L.reverse ? 1 - u : u);
        knotAt(c, q.x, q.y, X.rgb, X.fade, F.focus === L.id);
      }
    }

    // Pulses: one bright packet with a short tail.
    if (pulses.length) {
      pulses = pulses.filter((p) => {
        const X = byId.get(p.id);
        if (!X) return false;
        const u = pulseU(p.t0, t, p.speed, X.poly.len);
        if (u === null) return t < p.t0;
        const s = spr(p.rgb);
        for (let j = 4; j >= 0; j--) {
          const uj = u - (j * 10) / X.poly.len;
          if (uj < 0) continue;
          const q = X.poly.at(X.L.reverse ? 1 - uj : uj);
          const r = p.size * (1 - j * 0.16);
          c.globalAlpha = (j ? 0.5 - j * 0.09 : 0.95) * X.fade;
          c.drawImage(s, q.x - r, q.y - r, r * 2, r * 2);
        }
        const q = X.poly.at(X.L.reverse ? 1 - u : u);
        c.globalAlpha = X.fade;
        c.drawImage(spr(WHITE), q.x - 2.5, q.y - 2.5, 5, 5);
        return true;
      });
      c.globalAlpha = 1;
    }

    // Bursts.
    if (gn && dt) {
      let alive = 0;
      for (let i = 0; i < GRAIN_MAX; i++) {
        const b = i * 5;
        const age = t - gr[b + 4]!;
        if (age < 0 || age > 1) continue;
        alive++;
        gr[b + 2]! *= 0.96;
        gr[b + 3]! = gr[b + 3]! * 0.96 + 30 * dt;
        gr[b]! += gr[b + 2]! * dt;
        gr[b + 1]! += gr[b + 3]! * dt;
        c.globalAlpha = 0.9 * (1 - age);
        c.fillStyle = `rgb(${grc[i]})`;
        c.fillRect(gr[b]!, gr[b + 1]!, 1.4, 1.4);
      }
      gn = alive;
      c.globalAlpha = 1;
    }

    // Words rising, falling as sand.
    F.rises.draw(c, t, dt, (at) => {
      const p = anchors[at];
      if (p) return { x: p[0], y: p[1], W };
      const X = byId.get(at);
      if (!X || X.poly.n < 2) return null;
      const q = X.poly.at(X.L.reverse ? 0 : 1);
      return { x: q.x, y: q.y, W };
    });
  };

  const F: FlowField = {
    spec: { lay, draw, blend: "lighter", opaque: !!o.ground, ...(o.backing ? { scale: (w: number, h: number, dpr: number) => Math.min(dpr, Math.sqrt(o.backing! / Math.max(1, w * h))) } : {}) },
    layout,
    focus: null,
    hot: null,
    frames: 0,
    rises: new RiseField(),
    pulse(id, p = {}) {
      const X = byId.get(id);
      if (!X || reducedMotion()) return;
      if (pulses.length >= PULSE_MAX) pulses.shift();
      pulses.push({ id, t0: vizTime(), speed: p.speed ?? Math.max(140, (X.L.rate ?? 40) * 3), rgb: p.rgb ?? X.rgb, size: p.size ?? 9 });
    },
    burst(id, b = {}) {
      const X = byId.get(id);
      if (!X || reducedMotion()) return;
      const q = X.poly.at(clamp(b.u ?? 1, 0, 1));
      const x = q.x;
      const y = q.y;
      const t0 = vizTime();
      const n = Math.min(b.n ?? 28, 80);
      for (let j = 0; j < n; j++) {
        const i = gHead;
        gHead = (gHead + 1) % GRAIN_MAX;
        const a = Math.random() * TAU;
        const v = 20 + Math.abs(gauss()) * 50;
        gr.set([x, y, Math.cos(a) * v, Math.sin(a) * v - 12, t0], i * 5);
        grc[i] = b.rgb ?? X.rgb;
      }
      gn += n;
    },
    rise(text, r) {
      const X = byId.get(r.at);
      F.rises.push({ room: r.at, text, rgb: r.rgb ?? X?.rgb ?? accent });
    },
    hit(x, y, tol = 10) {
      const r = nearestLine(
        lines.map((X) => ({ id: X.L.id, poly: X.poly })),
        x,
        y,
        tol,
      );
      return r ? { id: r.id, u: r.u } : null;
    },
    setFocus(id) {
      F.focus = id;
      if (reducedMotion()) F.relayout();
    },
    line: (id) => byId.get(id)?.poly ?? null,
    relayout: () => view?.relayout(),
  };
  return F;
}
