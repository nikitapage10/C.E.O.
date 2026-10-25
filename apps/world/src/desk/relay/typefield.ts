/**
 * Relay's particle type (#414): the page's numbers are set in dots. Each figure (Need you, FYI, Handled) is sampled
 * from Syne at the size of its box on the page and drawn as a few hundred to a couple of thousand glowing dots that
 * spring to their places. The Need you figure is split into one band of dots per mail that needs Nikita, oldest at
 * the top: a band burns white when Blasto has a draft ready, stays blue when not, and frays at its edges the longer
 * that mail has waited. A band lights when its row is pointed at, and when a mail is marked done its band flies out
 * of the figure into Handled and the figure re-forms with what is left. When a count changes, the dots re-flow into
 * the new figure, and the ones it needs more of come in from the right edge, the way new mail does.
 *
 * Performance (Nikita, 21:34Z, "the Desk is still laggy"): one requestAnimationFrame loop, only while the canvas is
 * on screen and the tab is showing; a hard cap on dots; no layout reads in the loop (boxes are read by `layout()`,
 * which the page calls on resize and on data changes); nothing in the loop touches React or the DOM. With reduced
 * motion the dots sit still in their places and the canvas is redrawn only when something changes.
 */

export type GlyphKey = "need" | "fyi" | "done";
export interface Share {
  /** Blasto has a draft ready for this mail. */
  drafted: boolean;
  /** 0 just in, 1 long overdue: how much the band frays. */
  fray: number;
}

const KEYS: GlyphKey[] = ["need", "fyi", "done"];
/** The field's backing-pixel budget (#417). */
const FIELD_PX = 1_600_000;
/** The most dots each figure may use at a box of 1,000,000 px²; scaled to the box, then capped. */
const CAP: Record<GlyphKey, number> = { need: 1700, fyi: 320, done: 320 };
const DENSITY: Record<GlyphKey, number> = { need: 0.0075, fyi: 0.0095, done: 0.0095 };
/** At least this many dots, so a phone-sized figure is still finely set. */
const FLOOR: Record<GlyphKey, number> = { need: 800, fyi: 170, done: 170 };
/** Tones: need, drafted, fyi, done, dust. */
const TONES = ["130,164,236", "238,244,255", "150,168,206", "128,136,156", "125,159,226"];
const T_NEED = 0;
const T_DRAFT = 1;
const T_FYI = 2;
const T_DONE = 3;
const T_DUST = 4;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  /** Seeded per dot: its jitter phase, and whether it strays when its band frays. */
  ph: number;
  h: number;
  /** Its band in the Need you figure, or -1. */
  s: number;
  /** Fades in from 0; dying dots fade out to 0. */
  a: number;
  /** Seconds until a flown dot fades (release), or 0. */
  ttl: number;
  /** Seconds a dot burns white after it arrives (release). */
  flash: number;
}

interface Glyph {
  key: GlyphKey;
  text: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  align: "left" | "center";
  xs: Float32Array;
  ys: Float32Array;
  parts: P[];
  step: number;
}

const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A soft dot in a tone at an exact device-pixel size with its alpha baked in, so drawing it needs no scaling or alpha state. */
function sprite(rgb: string, px: number, alpha: number): HTMLCanvasElement {
  const s = document.createElement("canvas");
  s.width = s.height = px;
  const g = s.getContext("2d")!;
  const r = px / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, `rgba(${rgb},${alpha})`);
  gr.addColorStop(0.26, `rgba(${rgb},${alpha * 0.78})`);
  gr.addColorStop(0.5, `rgba(${rgb},${alpha * 0.16})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, px, px);
  return s;
}
/** Alpha is drawn in this many steps. */
const AB = 12;
/** At rest (nothing moving in, no pointer, no flights) the field draws at this rate; while anything moves, every frame. */
const REST_FPS = 12;
const CALM_S = 2.5;

let scratch: HTMLCanvasElement | null = null;
export const FACE = '"Syne Variable", Syne, system-ui, sans-serif';

/** The dots of `text` set in Syne ExtraBold to fill a w×h box, as y-ordered points, at most `max` of them. */
export function sampleText(text: string, w: number, h: number, align: "left" | "center", max: number): { xs: Float32Array; ys: Float32Array; step: number } {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  scratch ??= document.createElement("canvas");
  scratch.width = W;
  scratch.height = H;
  const c = scratch.getContext("2d", { willReadFrequently: true });
  if (!c) return { xs: new Float32Array(0), ys: new Float32Array(0), step: 8 };
  c.clearRect(0, 0, W, H);
  c.font = `800 100px ${FACE}`;
  const m = c.measureText(text);
  const asc = m.actualBoundingBoxAscent || 72;
  const desc = m.actualBoundingBoxDescent || 0;
  const left = m.actualBoundingBoxLeft || 0;
  const wid = (m.actualBoundingBoxRight || m.width) + left;
  const k = Math.min((H * 0.98) / (asc + desc), (W * 0.98) / Math.max(1, wid));
  c.font = `800 ${100 * k}px ${FACE}`;
  c.fillStyle = "#fff";
  const x0 = align === "left" ? left * k : (W - wid * k) / 2 + left * k;
  const y0 = (H - (asc + desc) * k) / 2 + asc * k;
  c.fillText(text, x0, y0);
  const img = c.getImageData(0, 0, W, H).data;
  let filled = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (img[(y * W + x) * 4 + 3]! > 128) filled++;
  const area = filled * 4;
  const step = Math.max(3, Math.sqrt(area / Math.max(1, max)));
  const xs: number[] = [];
  const ys: number[] = [];
  let row = 0;
  for (let y = step / 2; y < H; y += step * 0.88, row++) {
    for (let x = (row % 2 ? step : step / 2) / 1; x < W; x += step) {
      const ix = x | 0;
      const iy = y | 0;
      if (img[(iy * W + ix) * 4 + 3]! > 128) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), step };
}

export interface FieldEvents {
  /** The band under the pointer in the Need you figure changed (index, or null). */
  hover?: (share: number | null) => void;
  /** A click on a band of the Need you figure. */
  pick?: (share: number) => void;
}

export class TypeField {
  private cv: HTMLCanvasElement;
  private host: HTMLElement;
  private ctx: CanvasRenderingContext2D | null;
  private glyphs: Glyph[];
  private loose: P[] = [];
  private shares: Share[] = [];
  private level: number[] = [];
  private lit: number | null = null;
  private sel: number | null = null;
  private sprites = new Map<number, HTMLCanvasElement>();
  /** Until this time (s) the field draws every frame. */
  private calmAt = CALM_S;
  private acc = 0;
  /** The rest layer: the dots that hold still, drawn once. */
  private layer: HTMLCanvasElement | null = null;
  private layerOk = false;
  /** How many dots keep moving at rest; none, and an idle Relay draws nothing at all. */
  private movers = 1;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private t = 0;
  private visible = true;
  private onScreen = true;
  private still: boolean;
  private laidOut = false;
  private intro = true;
  private ptr = { x: -1e4, y: -1e4, on: false };
  private hoverShare: number | null = null;
  private io: IntersectionObserver | null = null;
  private seed = 0;
  private texts: Record<GlyphKey, string | null> = { need: null, fyi: null, done: null };
  private dead = false;

  constructor(
    cv: HTMLCanvasElement,
    host: HTMLElement,
    private ev: FieldEvents = {},
  ) {
    this.cv = cv;
    this.host = host;
    this.ctx = cv.getContext("2d");
    this.still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.glyphs = KEYS.map((key) => ({ key, text: null, x: 0, y: 0, w: 0, h: 0, align: "left", xs: new Float32Array(0), ys: new Float32Array(0), parts: [], step: 8 }));
    document.addEventListener("visibilitychange", this.onVis);
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerleave", this.onLeave);
    host.addEventListener("click", this.onClick);
    if (typeof IntersectionObserver === "function") {
      this.io = new IntersectionObserver((e) => {
        this.onScreen = e.some((x) => x.isIntersecting);
        this.kick();
      });
      this.io.observe(cv);
    }
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.onVis);
    this.host.removeEventListener("pointermove", this.onMove);
    this.host.removeEventListener("pointerleave", this.onLeave);
    this.host.removeEventListener("click", this.onClick);
    this.io?.disconnect();
  }

  /** The figures' text: a count, or null for loose dust while there is no count to show. */
  setTexts(t: Record<GlyphKey, string | null>) {
    const changed = KEYS.some((k) => this.texts[k] !== t[k]);
    this.texts = { ...t };
    if (changed && this.laidOut) this.resample();
  }

  /** The Need you figure's bands, oldest first. */
  setShares(s: Share[]) {
    this.shares = s.map((x) => ({ drafted: x.drafted, fray: clamp(x.fray, 0, 1) }));
    while (this.level.length < s.length) this.level.push(1);
    this.level.length = s.length;
    this.assignShares();
    this.layerOk = false;
    this.paintStill();
  }

  light(i: number | null) {
    this.lit = i;
    this.paintStill();
    this.calmAt = this.t + CALM_S;
  }
  select(i: number | null) {
    this.sel = i;
    this.paintStill();
    this.calmAt = this.t + CALM_S;
  }

  /** A mail marked done: its band leaves the Need you figure for Handled, flashes there and fades. */
  release(i: number) {
    const need = this.glyphs[0]!;
    const done = this.glyphs[2]!;
    if (this.still || !done.xs.length) return;
    const keep: P[] = [];
    let k = 0;
    for (const p of need.parts) {
      if (p.s !== i) {
        keep.push(p);
        continue;
      }
      const j = Math.floor(hash(++this.seed) * done.xs.length);
      p.tx = done.x + done.xs[j]!;
      p.ty = done.y + done.ys[j]!;
      p.vx += (hash(k) - 0.5) * 300;
      p.vy -= 120 + hash(k + 7) * 220;
      p.ttl = 1.2 + hash(k++ + 3) * 0.6;
      p.flash = 0;
      p.s = -1;
      this.loose.push(p);
    }
    need.parts = keep;
    this.kick();
  }

  /** Read the figures' boxes from the page. Called on resize and when the data changes, never from the loop. */
  layout() {
    if (this.dead) return;
    const r = this.cv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    // Soft dots over a big stage: at most FIELD_PX backing pixels, scaled up by the browser (#417). On a Retina laptop
    // the full-resolution field made each redraw a long task; the dots read the same.
    this.dpr = Math.min(2, window.devicePixelRatio || 1, Math.max(1, Math.sqrt(FIELD_PX / Math.max(1, r.width * r.height))));
    this.w = r.width;
    this.h = r.height;
    const W = Math.round(r.width * this.dpr);
    const H = Math.round(r.height * this.dpr);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
    }
    for (const g of this.glyphs) {
      const el = this.host.querySelector<HTMLElement>(`[data-glyph="${g.key}"]`);
      const b = el?.getBoundingClientRect();
      if (!b || b.width < 2) {
        g.w = g.h = 0;
        continue;
      }
      g.x = b.left - r.left;
      g.y = b.top - r.top;
      g.w = b.width;
      g.h = b.height;
    }
    this.laidOut = true;
    this.resample();
  }

  private resample() {
    for (const g of this.glyphs) {
      g.text = this.texts[g.key];
      const max = Math.min(CAP[g.key], Math.max(FLOOR[g.key], Math.round(g.w * g.h * DENSITY[g.key])));
      let pts: { xs: Float32Array; ys: Float32Array; step: number };
      if (!g.w || !g.h) pts = { xs: new Float32Array(0), ys: new Float32Array(0), step: 8 };
      else if (g.text !== null) pts = sampleText(g.text, g.w, g.h, g.align, max);
      else {
        // No count to show: a loose drift of dust in the figure's box, sparse.
        const n = Math.round(max * (g.key === "need" ? 0.16 : 0.2));
        const xs = new Float32Array(n);
        const ys = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          xs[i] = hash(i * 3 + 1 + g.key.length) * g.w;
          ys[i] = hash(i * 7 + 2 + g.key.length) * g.h;
        }
        const o = [...xs.keys()].sort((a, b) => ys[a]! - ys[b]!);
        pts = { xs: Float32Array.from(o.map((i) => xs[i]!)), ys: Float32Array.from(o.map((i) => ys[i]!)), step: 12 };
      }
      g.xs = pts.xs;
      g.ys = pts.ys;
      g.step = pts.step;
      this.reconcile(g);
    }
    this.assignShares();
    this.intro = false;
    this.paintStill();
    this.kick();
  }

  /** Match the figure's dots to its new points (both in y order) so it re-forms; spare dots die, missing ones come in. */
  private reconcile(g: Glyph) {
    const n = g.xs.length;
    g.parts.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
    const keep = g.parts.slice(0, n);
    for (const p of g.parts.slice(n)) {
      p.ttl = 0.01;
      p.s = -1;
      this.loose.push(p);
    }
    for (let i = keep.length; i < n; i++) {
      const id = ++this.seed;
      const fromEdge = !this.intro && !this.still;
      const x = fromEdge ? this.w + 10 + hash(id) * 60 : g.x + g.xs[i]! + (hash(id) - 0.5) * g.w * 1.4;
      const y = fromEdge ? g.y + hash(id + 1) * g.h : g.y + g.ys[i]! + (hash(id + 2) - 0.5) * g.h * 1.2;
      keep.push({ x, y, vx: fromEdge ? -380 - hash(id + 3) * 300 : 0, vy: 0, tx: 0, ty: 0, ph: hash(id + 4) * 6.283, h: hash(id + 5), s: -1, a: this.still ? 1 : 0, ttl: 0, flash: 0 });
    }
    for (let i = 0; i < n; i++) {
      const p = keep[i]!;
      p.tx = g.x + g.xs[i]!;
      p.ty = g.y + g.ys[i]!;
      if (this.still) {
        p.x = p.tx;
        p.y = p.ty;
        p.a = 1;
      }
    }
    g.parts = keep;
  }

  /** Bands of the Need you figure: contiguous runs of its y-ordered dots, oldest mail at the top. */
  private assignShares() {
    const g = this.glyphs[0]!;
    const n = this.texts.need === null ? 0 : this.shares.length;
    const len = g.parts.length;
    for (let i = 0; i < len; i++) g.parts[i]!.s = n ? Math.min(n - 1, Math.floor((i * n) / len)) : -1;
  }

  private onVis = () => {
    this.visible = document.visibilityState !== "hidden";
    this.kick();
  };
  private local(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private shareAt(x: number, y: number): number | null {
    const g = this.glyphs[0]!;
    if (!this.shares.length || x < g.x - 12 || x > g.x + g.w + 12 || y < g.y - 12 || y > g.y + g.h + 12) return null;
    let best = (g.step * 1.6) ** 2;
    let s: number | null = null;
    for (const p of g.parts) {
      const dx = p.tx - x;
      const dy = p.ty - y;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        s = p.s >= 0 ? p.s : null;
      }
    }
    return s;
  }
  private onMove = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    this.ptr.x = x;
    this.ptr.y = y;
    this.ptr.on = e.pointerType !== "touch";
    this.calmAt = this.t + CALM_S;
    const s = e.pointerType === "touch" ? null : this.shareAt(x, y);
    if (s !== this.hoverShare) {
      this.hoverShare = s;
      this.ev.hover?.(s);
    }
  };
  private onLeave = () => {
    this.ptr.on = false;
    if (this.hoverShare !== null) {
      this.hoverShare = null;
      this.ev.hover?.(null);
    }
  };
  private onClick = (e: MouseEvent) => {
    const { x, y } = this.local(e as PointerEvent);
    const s = this.shareAt(x, y);
    if (s !== null) this.ev.pick?.(s);
  };

  private kick() {
    if (this.dead) return;
    this.calmAt = this.t + CALM_S;
    if (this.still) {
      this.paintStill();
      return;
    }
    const run = this.visible && this.onScreen && this.laidOut;
    if (run && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private paintStill() {
    if (this.still && this.laidOut) this.draw(0);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.dead || !this.visible || !this.onScreen) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.acc += dt;
    const busy = this.t < this.calmAt || this.loose.length > 0 || this.ptr.on;
    if (busy || (this.acc >= 1 / REST_FPS && (this.movers > 0 || !this.layerOk))) {
      this.step(Math.min(0.05, this.acc));
      this.acc = 0;
      this.draw(dt, !busy);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private step(dt: number) {
    const t = this.t;
    const K = 46;
    const damp = Math.exp(-8.5 * dt);
    const px = this.ptr.x;
    const py = this.ptr.y;
    const pon = this.ptr.on;
    const R = 54;
    for (let gi = 0; gi < 3; gi++) {
      const g = this.glyphs[gi]!;
      const dust = g.text === null;
      for (const p of g.parts) {
        const sh = p.s >= 0 ? this.shares[p.s] : undefined;
        const fray = sh ? sh.fray : 0;
        // Each dot breathes about its place; a band that has waited long frays, and a few of its dots stray wide.
        const stray = sh && p.h < fray * 0.24;
        const amp = dust ? 14 : stray ? 4 + fray * 11 : 0.4 + fray * 1.4;
        const sp = dust ? 0.25 : stray ? 0.6 : 1.4;
        const jx = Math.sin(t * sp + p.ph) * amp;
        const jy = Math.cos(t * sp * 0.83 + p.ph * 1.3) * amp;
        let ax = (p.tx + jx - p.x) * K;
        let ay = (p.ty + jy - p.y) * K;
        if (pon) {
          const dx = p.x - px;
          const dy = p.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < R * R && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = (1 - d / R) * 2600;
            ax += (dx / d) * f;
            ay += (dy / d) * f;
          }
        }
        p.vx = (p.vx + ax * dt) * damp;
        p.vy = (p.vy + ay * dt) * damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.a < 1) p.a = Math.min(1, p.a + dt * 1.6);
      }
    }
    // Flown and spare dots: flown ones reach Handled, flash and fade; spare ones drift off.
    const kept: P[] = [];
    for (const p of this.loose) {
      if (p.ttl > 0.05) {
        p.vx = (p.vx + (p.tx - p.x) * 30 * dt) * Math.exp(-5 * dt);
        p.vy = (p.vy + (p.ty - p.y) * 30 * dt) * Math.exp(-5 * dt);
        p.ttl -= dt;
        if (Math.abs(p.tx - p.x) < 8 && Math.abs(p.ty - p.y) < 8) p.flash = Math.min(1, p.flash + dt * 4);
      } else {
        p.vy -= 14 * dt;
        p.a -= dt * 1.4;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.a > 0) kept.push(p);
    }
    this.loose = kept;
    // Bands ease toward lit or dimmed.
    const k = 1 - Math.exp(-10 * dt);
    for (let i = 0; i < this.level.length; i++) {
      const want = this.lit === null && this.sel === null ? 1 : i === this.lit || i === this.sel ? 1.25 : 0.3;
      this.level[i] = this.level[i]! + (want - this.level[i]!) * k;
    }
  }

  private spr(tone: number, px: number, a: number): HTMLCanvasElement {
    const ab = Math.max(1, Math.min(AB, Math.round(a * AB)));
    const key = (tone * 64 + px) * 16 + ab;
    let c = this.sprites.get(key);
    if (!c) {
      c = sprite(TONES[tone]!, px, ab / AB);
      this.sprites.set(key, c);
    }
    return c;
  }

  /** Whether a dot keeps moving at rest: loose dust, a stray of a frayed band, or the selected band's pulse. */
  private moves(gi: number, p: P, dust: boolean): boolean {
    if (dust) return true;
    if (gi !== 0 || p.s < 0) return false;
    if (p.s === this.sel) return true;
    const sh = this.shares[p.s];
    return !!sh && p.h < sh.fray * 0.24;
  }

  /**
   * Busy, every dot is drawn every frame. At rest the dots that hold still are drawn once into a layer that is reused,
   * and only the few that keep moving are drawn over it, so an idle Relay costs one blit and a few dozen dots a frame.
   */
  private draw(_dt: number, rest = false) {
    const c = this.ctx;
    if (!c) return;
    if (this.still) {
      for (let i = 0; i < this.level.length; i++) this.level[i] = this.lit === null && this.sel === null ? 1 : i === this.lit || i === this.sel ? 1.25 : 0.3;
    }
    const W = this.cv.width;
    const H = this.cv.height;
    if (rest && !this.layerOk) {
      this.layer ??= document.createElement("canvas");
      if (this.layer.width !== W || this.layer.height !== H) {
        this.layer.width = W;
        this.layer.height = H;
      }
      const l = this.layer.getContext("2d");
      if (l) {
        l.setTransform(1, 0, 0, 1, 0, 0);
        l.clearRect(0, 0, W, H);
        this.paint(l, 1);
        this.layerOk = true;
        let m = 0;
        for (let gi = 0; gi < 3; gi++) for (const p of this.glyphs[gi]!.parts) if (this.moves(gi, p, this.glyphs[gi]!.text === null)) m++;
        this.movers = m;
      }
    }
    if (!rest) this.layerOk = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, W, H);
    if (rest && this.layerOk && this.layer) {
      c.drawImage(this.layer, 0, 0);
      this.paint(c, 2);
    } else this.paint(c, 0);
  }

  /** Paint the dots: 0 all, 1 only those that hold still at rest, 2 only those that move at rest. */
  private paint(c: CanvasRenderingContext2D, only: 0 | 1 | 2) {
    const d = this.dpr;
    const t = this.t;
    for (let gi = 0; gi < 3; gi++) {
      const g = this.glyphs[gi]!;
      const dust = g.text === null;
      const px = Math.max(4, Math.round(clamp(g.step * (gi === 0 ? 1.3 : 1.4), 3.5, 13) * d));
      const big = Math.round(px * 1.22);
      const base = dust ? 0.32 : gi === 0 ? 0.95 : gi === 1 ? 0.72 : 0.52;
      const tone0 = dust ? T_DUST : gi === 0 ? T_NEED : gi === 1 ? T_FYI : T_DONE;
      for (const p of g.parts) {
        if (only && this.moves(gi, p, dust) !== (only === 2)) continue;
        let tone = tone0;
        let a = base * p.a;
        let s = px;
        if (gi === 0 && p.s >= 0) {
          if (this.shares[p.s]?.drafted) tone = T_DRAFT;
          const lv = this.level[p.s] ?? 1;
          a *= Math.min(1, lv);
          if (lv > 1.1) s = big;
          if (p.s === this.sel && !this.still) a *= 0.8 + 0.2 * Math.sin(t * 3 + p.ph);
        }
        if (a < 0.04) continue;
        // A dot that holds still is drawn at its place, so the layer is clean.
        const x = only === 1 ? p.tx : p.x;
        const y = only === 1 ? p.ty : p.y;
        c.drawImage(this.spr(tone, s, a), (x * d - s / 2) | 0, (y * d - s / 2) | 0);
      }
    }
    if (only === 1) return;
    for (const p of this.loose) {
      const s = Math.round((7 + p.flash * 5) * d);
      const a = clamp(p.a, 0, 1) * 0.9;
      if (a < 0.04) continue;
      c.drawImage(this.spr(p.flash > 0.2 || p.ttl > 0.05 ? T_DRAFT : T_DUST, s, a), (p.x * d - s / 2) | 0, (p.y * d - s / 2) | 0);
    }
  }
}
