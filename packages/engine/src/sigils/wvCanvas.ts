import { useEffect, useRef, useState } from "react";

/**
 * The Weave's threads (Nikita, 2026-10-22, the approved round-five design): every chart on the Desk is drawn as
 * threads of light, a polyline with particles riding it, knots where something happened. One shared loop draws every
 * canvas that is on screen, at about 40 frames a second; it stops when the tab is hidden, a canvas off screen is
 * skipped, and with reduced motion each canvas draws one still frame (redrawn only when its data changes).
 */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function sstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
export const frac = (x: number) => x - Math.floor(x);
export const eOut = (k: number) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
export const eInOut = (k: number) => {
  const x = clamp(k, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** The rooms' colours as "r,g,b" (the Desk's --room-* tokens), and the Weave's own lights. */
export const RC: Record<string, string> = {
  foundry: "228,152,94",
  spire: "214,188,114",
  exchange: "124,205,172",
  green: "172,200,114",
  relay: "125,159,226",
  archive: "168,144,226",
  breakroom: "226,143,182",
  boiler: "168,174,188",
  workshop: "98,196,192",
  studio: "232,112,111",
};
export const WHITE = "236,238,243";
export const HOT = "255,220,170";
export const OK = "134,212,180";
export const RUN = "143,180,240";
export const BAD = "240,122,143";

const rgbArr = (s: string) => s.split(",").map(Number);
export function mixRgb(a: string, b: string, f: number) {
  const A = rgbArr(a);
  const B = rgbArr(b);
  return `${Math.round(lerp(A[0]!, B[0]!, f))},${Math.round(lerp(A[1]!, B[1]!, f))},${Math.round(lerp(A[2]!, B[2]!, f))}`;
}

const SPR = new Map<string, HTMLCanvasElement>();
/** A soft glowing dot in a colour, cached. */
export function spr(rgb: string): HTMLCanvasElement {
  let s = SPR.get(rgb);
  if (s) return s;
  s = document.createElement("canvas");
  s.width = s.height = 32;
  const g = s.getContext("2d")!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.22, `rgba(${rgb},.62)`);
  gr.addColorStop(0.55, `rgba(${rgb},.13)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  SPR.set(rgb, s);
  return s;
}
/** A dot between two colours, quantised so the cache stays small. */
export function sprMix(a: string, b: string, f: number) {
  const q = Math.round(clamp(f, 0, 1) * 8) / 8;
  return spr(q <= 0 ? a : q >= 1 ? b : mixRgb(a, b, q));
}

/** A polyline with arc-length lookup. */
export class Poly {
  n = 0;
  x = new Float32Array(2);
  y = new Float32Array(2);
  c = new Float32Array(2);
  len = 1;
  set(xs: ArrayLike<number>, ys: ArrayLike<number>) {
    const n = xs.length;
    if (this.x.length !== n) {
      this.x = new Float32Array(n);
      this.y = new Float32Array(n);
      this.c = new Float32Array(n);
    }
    this.n = n;
    const c = this.c;
    c[0] = 0;
    for (let i = 0; i < n; i++) {
      this.x[i] = xs[i]!;
      this.y[i] = ys[i]!;
      if (i) {
        const dx = xs[i]! - xs[i - 1]!;
        const dy = ys[i]! - ys[i - 1]!;
        c[i] = c[i - 1]! + Math.sqrt(dx * dx + dy * dy);
      }
    }
    this.len = c[n - 1] || 1;
    return this;
  }
  /** The point and tangent at a fraction of the length (shared result object). */
  at(u: number) {
    const t = clamp(u, 0, 1) * this.len;
    const c = this.c;
    let lo = 0;
    let hi = this.n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m]! <= t) lo = m;
      else hi = m;
    }
    const sl = c[hi]! - c[lo]! || 1;
    const f = (t - c[lo]!) / sl;
    const dx = this.x[hi]! - this.x[lo]!;
    const dy = this.y[hi]! - this.y[lo]!;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    PA.x = this.x[lo]! + dx * f;
    PA.y = this.y[lo]! + dy * f;
    PA.tx = dx / l;
    PA.ty = dy / l;
    return PA;
  }
  stroke(c: CanvasRenderingContext2D, u1?: number) {
    const n = this.n;
    if (n < 2) return;
    c.beginPath();
    c.moveTo(this.x[0]!, this.y[0]!);
    if (u1 == null || u1 >= 1) for (let i = 1; i < n; i++) c.lineTo(this.x[i]!, this.y[i]!);
    else {
      const L = this.len * u1;
      for (let i = 1; i < n; i++) {
        if (this.c[i]! > L) {
          const p = this.at(u1);
          c.lineTo(p.x, p.y);
          break;
        }
        c.lineTo(this.x[i]!, this.y[i]!);
      }
    }
    c.stroke();
  }
  /** The distance from a point to the nearest sample, and that sample's fraction. */
  nearest(x: number, y: number) {
    let best = 1e9;
    let bi = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i]! - x;
      const dy = this.y[i]! - y;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { d: Math.sqrt(best), u: this.c[bi]! / this.len };
  }
}
const PA = { x: 0, y: 0, tx: 1, ty: 0 };

/** Catmull-Rom through points, `seg` samples per span. */
export function smoothPts(px: number[], py: number[], seg: number): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = px.length;
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(n - 1, i + 2);
    for (let s = 0; s < seg; s++) {
      const u = s / seg;
      const u2 = u * u;
      const u3 = u2 * u;
      xs.push(0.5 * (2 * px[i]! + (-px[i0]! + px[i + 1]!) * u + (2 * px[i0]! - 5 * px[i]! + 4 * px[i + 1]! - px[i3]!) * u2 + (-px[i0]! + 3 * px[i]! - 3 * px[i + 1]! + px[i3]!) * u3));
      ys.push(0.5 * (2 * py[i]! + (-py[i0]! + py[i + 1]!) * u + (2 * py[i0]! - 5 * py[i]! + 4 * py[i + 1]! - py[i3]!) * u2 + (-py[i0]! + 3 * py[i]! - 3 * py[i + 1]! + py[i3]!) * u3));
    }
  }
  xs.push(px[n - 1]!);
  ys.push(py[n - 1]!);
  return [xs, ys];
}

/** A cubic bezier sampled into `n` points. */
export function bez(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, n: number, xs: number[], ys: number[]) {
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const v = 1 - u;
    const a = v * v * v;
    const b = 3 * v * v * u;
    const c = 3 * v * u * u;
    const d = u * u * u;
    xs[i] = a * x0 + b * x1 + c * x2 + d * x3;
    ys[i] = a * y0 + b * y1 + c * y2 + d * y3;
  }
}

/** Particles riding a polyline: position, offset, depth, speed, phase, highlight. */
export class Parts {
  n: number;
  u: Float32Array;
  o: Float32Array;
  z: Float32Array;
  v: Float32Array;
  p: Float32Array;
  c: Uint8Array;
  constructor(n: number, hiF = 0) {
    this.n = n;
    this.u = new Float32Array(n);
    this.o = new Float32Array(n);
    this.z = new Float32Array(n);
    this.v = new Float32Array(n);
    this.p = new Float32Array(n);
    this.c = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.u[i] = (i + Math.random()) / n;
      this.o[i] = gauss();
      const z = Math.random();
      this.z[i] = z * z;
      this.v[i] = rnd(0.6, 1.4);
      this.p[i] = Math.random() * TAU;
      this.c[i] = Math.random() < hiF ? 1 : 0;
    }
  }
}

export interface WeaveOpts {
  /** Particle alpha, spread, size and speed (px/s). */
  a: number;
  sp: number;
  sz: number;
  v?: number;
  rgb?: string;
  /** The highlight colour some particles take. */
  rgb2?: string;
  /** The line under the particles: its alpha, width and dash. */
  line?: number;
  lw?: number;
  dash?: number[];
  /** Intensity along the thread, 0..1. */
  I?: (u: number) => number;
  /** Draw only up to here (0..1). */
  head?: number;
  nofade?: boolean;
  jit?: number;
  col?: (u: number, x: number, y: number) => HTMLCanvasElement;
}

/** Draw a thread: its line, then its particles moving along it. */
export function weave(c: CanvasRenderingContext2D, poly: Poly, P: Parts | null, o: WeaveOpts, t: number, dt: number) {
  if (poly.n < 2) return;
  const rgb = o.rgb ?? WHITE;
  if (o.line) {
    c.globalAlpha = 1;
    c.strokeStyle = `rgba(${rgb},${o.line})`;
    c.lineWidth = o.lw ?? 0.8;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (o.dash) c.setLineDash(o.dash);
    poly.stroke(c, o.head);
    if (o.dash) c.setLineDash([]);
  }
  if (!P) return;
  const n = P.n;
  const L = poly.len;
  const head = o.head ?? 1;
  const sp = spr(rgb);
  const sp2 = spr(o.rgb2 ?? HOT);
  for (let i = 0; i < n; i++) {
    let u = P.u[i]!;
    if (dt && o.v) {
      u += (P.v[i]! * o.v * dt) / L;
      if (u > 1) {
        u -= 1;
        P.o[i] = gauss();
      } else if (u < 0) {
        u += 1;
        P.o[i] = gauss();
      }
      P.u[i] = u;
    }
    if (u > head) continue;
    const I = o.I ? o.I(u) : 1;
    if (I < 0.02) continue;
    const p = poly.at(u);
    const px = p.x;
    const py = p.y;
    const tx = p.tx;
    const ty = p.ty;
    const off = P.o[i]! * o.sp * (0.35 + 0.65 * I) + (dt || o.jit ? Math.sin(t * 1.7 + P.p[i]! * 3) * (o.jit ?? 0.5) : 0);
    const x = px - ty * off;
    const y = py + tx * off;
    let fd = o.nofade ? 1 : sstep(0, 0.04, u) * sstep(1, 0.96, u);
    if (head < 1) fd *= 0.4 + 0.6 * sstep(head - 0.3, head, u);
    const al = o.a * (0.28 + 0.72 * P.z[i]!) * (0.3 + 0.7 * I) * fd;
    if (al < 0.02) continue;
    const sz = (0.8 + P.z[i]! * 2.1) * o.sz * (0.85 + 0.3 * I);
    c.globalAlpha = al > 1 ? 1 : al;
    c.drawImage(o.col ? o.col(u, x, y) : P.c[i] ? sp2 : sp, x - sz, y - sz, sz * 2, sz * 2);
  }
  c.globalAlpha = 1;
}

/** A knot: a glow with motes circling it, where something happened. */
export function knot(c: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, rgb = WHITE, a = 1) {
  const R = 14 * s;
  const g = c.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, `rgba(${rgb},${0.36 * a})`);
  g.addColorStop(0.45, `rgba(${rgb},${0.09 * a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.globalAlpha = 1;
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, R, 0, TAU);
  c.fill();
  const sp = spr(rgb);
  const sw = spr(WHITE);
  for (let i = 0; i < 12; i++) {
    const w = (0.7 + i * 0.11) * (i % 2 ? -1 : 1);
    const ang = t * w + i * 2.4;
    const rr = s * 5.5 * (0.45 + 0.55 * frac(i * 0.618));
    const tl = i * 0.9;
    const ca = Math.cos(ang) * rr;
    const sa = Math.sin(ang) * rr * 0.45;
    const ct = Math.cos(tl);
    const st = Math.sin(tl);
    const px = x + ca * ct - sa * st;
    const py = y + ca * st + sa * ct;
    const sz = 0.9 + frac(i * 0.37) * 1.6;
    c.globalAlpha = Math.min(1, (0.45 + 0.5 * frac(i * 0.29)) * a);
    c.drawImage(i % 3 ? sp : sw, px - sz, py - sz, sz * 2, sz * 2);
  }
  c.globalAlpha = Math.min(1, 0.95 * a);
  c.drawImage(sw, x - 3.5 * s, y - 3.5 * s, 7 * s, 7 * s);
  c.globalAlpha = 1;
}

export function ring(c: CanvasRenderingContext2D, x: number, y: number, r: number, rgb = WHITE, a = 1, dash?: number[]) {
  c.globalAlpha = 1;
  c.strokeStyle = `rgba(${rgb},${a})`;
  c.lineWidth = 1;
  if (dash) c.setLineDash(dash);
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.stroke();
  if (dash) c.setLineDash([]);
}

/** A dotted line: what hasn't happened yet. */
export function dots(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, gap: number, a: number, rgb = WHITE) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l < 1) return;
  const n = Math.floor(l / gap);
  c.globalAlpha = 1;
  c.fillStyle = `rgba(${rgb},${a})`;
  for (let i = 0; i <= n; i++) {
    const f = i / n || 0;
    c.fillRect(x0 + dx * f - 0.6, y0 + dy * f - 0.6, 1.2, 1.2);
  }
}

/* ── The canvases and the one loop ── */

// One query, kept (#417): the canvases ask every frame, and matchMedia builds a new query list on each call. Its
// `matches` follows the setting live.
let motionQuery: MediaQueryList | null = null;
export const reducedMotion = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  motionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionQuery.matches;
};

export interface Viz {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  dpr: number;
  ok: boolean;
  inview: boolean;
  /** Scratch space for the spec's layout; cleared when the spec changes. */
  s: Record<string, unknown>;
  spec: VizSpec;
  /** A box's position relative to the canvas. */
  rel: (el: Element) => { x: number; y: number; w: number; h: number };
  /** Ask for a fresh layout on the next frame (after the DOM settles). */
  relayout: () => void;
}

export interface VizSpec {
  /** Measure and build the threads; called on mount, resize and whenever the spec changes. */
  lay: (V: Viz) => void;
  draw: (V: Viz, c: CanvasRenderingContext2D, t: number, dt: number) => void;
  /** Blend mode for the draw: "lighter" (default) makes overlapping light add up. */
  blend?: GlobalCompositeOperation;
  /**
   * The canvas's backing scale for its size (default: the screen's, capped at 2). A big full-bleed canvas of soft
   * light can draw at a lower resolution and still look the same, for far less work a frame (Today, #413).
   */
  scale?: (W: number, H: number, dpr: number) => number;
  /** The canvas paints its own background, so the page under it need not be drawn or blended (read once, on mount). */
  opaque?: boolean;
}

const VZ = new Set<Viz & { dirty: boolean; still: number }>();
let running = false;
let lastT = 0;
let lastDraw = 0;
let TIME = 0;
/** The loop's frame budget: about 40 a second is plenty for drifting light. */
const FRAME_MS = 24;

function resize(V: Viz & { dirty: boolean; still: number }) {
  const r = V.cv.getBoundingClientRect();
  const W = Math.round(r.width);
  const H = Math.round(r.height);
  if (!W || !H) {
    V.ok = false;
    return;
  }
  const screen = Math.min(2, window.devicePixelRatio || 1);
  const dpr = V.spec.scale ? Math.max(0.25, Math.min(screen, V.spec.scale(W, H, screen))) : screen;
  if (W !== V.W || H !== V.H || dpr !== V.dpr) {
    V.W = W;
    V.H = H;
    V.dpr = dpr;
    V.cv.width = Math.round(W * dpr);
    V.cv.height = Math.round(H * dpr);
  }
  V.ok = true;
  V.spec.lay(V);
  V.still = 2;
}

function drawOne(V: Viz, t: number, dt: number) {
  if (!V.ok) return;
  const c = V.ctx;
  c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.clearRect(0, 0, V.W, V.H);
  c.globalCompositeOperation = V.spec.blend ?? "lighter";
  V.spec.draw(V, c, t, dt);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
}

function frame(now: number) {
  if (document.visibilityState === "hidden" || !VZ.size) {
    running = false;
    return;
  }
  const rm = reducedMotion();
  if (!rm && now - lastDraw < FRAME_MS) {
    requestAnimationFrame(frame);
    return;
  }
  lastDraw = now;
  const rdt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  const dt = rm ? 0 : rdt;
  if (!rm) TIME += rdt;
  let busy = false;
  for (const V of VZ) {
    if (V.dirty) {
      V.dirty = false;
      resize(V);
    }
    if (!V.ok || !V.inview) continue;
    if (rm) {
      if (V.still > 0) {
        V.still--;
        drawOne(V, TIME + 4, 0);
        busy = true;
      }
    } else drawOne(V, TIME, dt);
  }
  if (rm && !busy) {
    running = false;
    return;
  }
  requestAnimationFrame(frame);
}

/** The shared loop's clock (seconds), so an overlay can draw the same moment of a thread as its canvas. */
export const vizTime = () => TIME;

export function kick() {
  if (running || typeof window === "undefined" || document.visibilityState === "hidden") return;
  running = true;
  lastT = performance.now();
  requestAnimationFrame(frame);
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());

/**
 * Draw a canvas with the shared loop. The spec is re-laid whenever it changes (pass a memoised one), whenever the
 * canvas resizes, and on `relayout()`.
 */
export function useViz(ref: React.RefObject<HTMLCanvasElement | null>, spec: VizSpec) {
  const vref = useRef<(Viz & { dirty: boolean; still: number }) | null>(null);
  // The canvas can mount after its component does (a list that arrives with a feed): follow the element itself.
  const [cv, setCv] = useState<HTMLCanvasElement | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void (ref.current !== cv && setCv(ref.current)));
  useEffect(() => {
    if (!cv) return;
    const ctx = cv.getContext("2d", spec.opaque ? { alpha: false } : undefined);
    if (!ctx) return;
    const V: Viz & { dirty: boolean; still: number } = {
      cv,
      ctx,
      W: 0,
      H: 0,
      dpr: 1,
      ok: false,
      inview: true,
      s: {},
      spec,
      dirty: true,
      still: 2,
      rel(el) {
        const a = el.getBoundingClientRect();
        const b = cv.getBoundingClientRect();
        return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
      },
      relayout() {
        V.dirty = true;
        kick();
      },
    };
    vref.current = V;
    VZ.add(V);
    const ro = new ResizeObserver(() => V.relayout());
    ro.observe(cv);
    const host = cv.parentElement;
    if (host) ro.observe(host);
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (en) => {
          V.inview = en[en.length - 1]!.isIntersecting;
          if (V.inview) {
            V.still = 2;
            kick();
          }
        },
        { rootMargin: "80px" },
      );
      io.observe(cv);
    }
    kick();
    return () => {
      VZ.delete(V);
      ro.disconnect();
      io?.disconnect();
      vref.current = null;
    };
    // The spec is swapped in by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv]);
  useEffect(() => {
    const V = vref.current;
    if (!V) return;
    if (V.spec !== spec) {
      V.spec = spec;
      V.s = {};
    }
    V.relayout();
  }, [spec]);
  return vref;
}

/** Whether the viewer is on a phone-width screen. */
export const isPhone = (el?: Element | null) => (el ? el.getBoundingClientRect().width < 640 : typeof window !== "undefined" && window.innerWidth < 640);
