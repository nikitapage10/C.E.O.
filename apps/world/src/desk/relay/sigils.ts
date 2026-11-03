import "@fontsource/noto-sans-symbols/400.css";
import "@fontsource/noto-sans-symbols-2/400.css";
import "@fontsource/noto-sans-runic/400.css";
import "./sigils.css";

/**
 * Sigils (#615): the living fragments of code and rune that Ilyr is built from, as a small canvas engine (the Codex
 * look Nikita picked, ported from its mockup). Text forms out of them and dissolves back into them:
 *
 *   form       a swarm of glyphs ({ } => λ 0x ∴, runes, alchemical marks) is written into an element's letterforms,
 *              left to right, flickering until each one locks in place; the real text shows through as they land.
 *              `path` bends the flight (`quill` writes them out from a point on the spine).
 *   dissolve   the text breaks back into glyphs that stream to `to` (down the spine, up and out the top).
 *   burst      a spray of glyphs from a point (the seal on a yes).
 *   field      a hook drawn under the glyphs every frame (the spine's lit stretch, the slow fall, the ear's wick).
 *
 * Glyph size follows the text's font size. Kept fast for a laptop: each colour's glyphs are drawn once into an atlas
 * (plain and glowing) and stamped with drawImage; the live count is capped (MAX_LIVE); the text is sampled coarsely;
 * the loop sleeps while the tab is hidden. An element's newer form or dissolve cancels its older one, so a fast flick
 * through the codex never piles up. With prefers-reduced-motion there is no canvas at all: text simply appears and goes.
 *
 * The real text is always in the DOM (screen readers and Find read it); the glyphs are decoration over it. The engine
 * never changes an element's children (React owns them): it reads word boxes with Ranges and hides text with an
 * attribute, GHOST.
 */

/** Code fragments, some of them two characters. */
export const CODE = ["{", "}", "<", ">", "/", ";", "=", "=>", "λ", "0x", "∴", "::", "[]", "#", "%", "*", "|", "~", "!=", "->", "()", "01", "&", "$"] as const;
/** Arcana: planets, alchemy, runes, a little math. */
export const ARC = ["☿", "♄", "☉", "☽", "♃", "🜁", "🜂", "🜃", "🜄", "🜍", "🜔", "ᚠ", "ᚱ", "ᛟ", "ᛉ", "ᚦ", "ᛃ", "ᛞ", "ᚷ", "ᛒ", "ᛗ", "△", "▽", "◇", "⊕", "⊗", "∅", "∞", "ϟ", "Ψ", "∇", "∂"] as const;
export const SIGILS: readonly string[] = [...CODE, ...ARC];

const MONO = '"Geist Mono Variable", ui-monospace, monospace';
const ARCANE = '"Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Runic", serif';
/** Of the 40 glyphs in play, this share is code; the rest arcana. */
const MIX = 0.45;
const COUNT = 40;

/** The Codex's inks. */
export const INK = { hi: "#86b6ff", you: "#a8caff", blue: "#0a7cff", white: "#ffffff", sink: "#5c6480" } as const;

/** The most glyphs alive at once, across every form, dissolve and burst. */
export const MAX_LIVE = 1600;
/** The most one `form` or `dissolve` samples. */
export const MAX_PER_TEXT = 640;
/** The attribute that hides an element's text while its glyphs are in flight. */
export const GHOST = "data-sg-ghost";

export const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How many glyphs a batch may add now, under the live cap. */
export const room = (live: number, want: number, cap = MAX_LIVE) => Math.max(0, Math.min(want, cap - live));

/** Seeded so a run looks the same twice (and tests can count on it). */
export function rng(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const ei = (t: number) => t * t * t;
export const eio = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const ghost = (el: Element, on: boolean) => (on ? el.setAttribute(GHOST, "") : el.removeAttribute(GHOST));
export const ghosted = (el: Element) => el.hasAttribute(GHOST);

export interface Mote {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t0: number;
  du: number;
  /** Glyph index, when it last changed, how often it flickers. */
  g: number;
  gt: number;
  gi: number;
  c: string;
  s0: number;
  s1: number;
  sw: number;
  sw2: number;
  /** Alpha while waiting to leave. */
  pre: number;
  glow: boolean;
  /** 0 forms (lands and locks), 1 dissolves (fades as it goes). */
  mode: 0 | 1;
  /** A burst: eases out, not in. */
  out?: boolean;
  path?: Path;
  lock: boolean;
  fade: number;
  owner?: Element;
}

/** Bends a flight: (mote, eased progress, sin(πk)) → [x, y]. */
export type Path = (p: Mote, e: number, b: number) => [number, number];

/** A quill: glyphs leave a point on the spine and are written into the letters, left to right. */
export const quill =
  (px: number): Path =>
  (p, e, b) => {
    const k = Math.min(1, e * 1.25);
    return [px + (p.tx - px) * eo(k) + Math.sin(e * 6 + p.sw) * (1 - e) * 10, p.sy + (p.ty - p.sy) * eo(Math.min(1, e * 1.6)) + b * p.sw2 * 0.3];
  };

/** Out the top: a short spread, then a climb that speeds up (the seal on a yes). */
export const rise: Path = (p, e) => {
  const ex = Math.min(1, e / 0.35);
  return [p.sx + (p.tx - p.sx) * eo(ex), p.sy + (p.ty - p.sy) * Math.pow(Math.max(0, (e - 0.15) / 0.85), 1.6)];
};

/** Down and away (a filtered sender). */
export const sink: Path = (p, e) => {
  const ex = Math.min(1, e / 0.4);
  return [p.sx + (p.tx - p.sx) * eo(ex), p.sy + (p.ty - p.sy) * Math.pow(Math.max(0, (e - 0.2) / 0.8), 1.5)];
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface FormOpts {
  /** Where each glyph starts: (index, target x, target y, box) → [x, y]. Default: above the text. */
  from?: (i: number, x: number, y: number, box: Box) => [number, number];
  path?: Path;
  /** Default: the element's own text colour. */
  color?: string;
  dur?: number;
  /** Left-to-right spread of start times (ms). */
  stagger?: number;
  jitter?: number;
  swirl?: number;
  /** false: start times at random, not left to right. */
  ltr?: boolean;
  /** Sample step (px); default an eighth of the font size. */
  gap?: number;
  max?: number;
  /** Size on arrival; default from the gap. */
  size?: number;
  pre?: number;
  /** Share that glow. */
  glow?: number;
}

export interface DissolveOpts {
  to?: (i: number, x: number, y: number, box: Box) => [number, number];
  path?: Path;
  color?: string;
  dur?: number;
  stagger?: number;
  /** Start times right to left. */
  rtl?: boolean;
  gap?: number;
  max?: number;
  swirl?: number;
}

export interface BurstOpts {
  n?: number;
  ang?: number;
  spread?: number;
  dist?: number;
  /** Spread the start over a box this size around (x, y). */
  w?: number;
  h?: number;
  to?: (i: number, x: number, y: number) => [number, number];
  path?: Path;
  color?: string;
  dur?: number;
  stagger?: number;
  size?: number;
}

/** Drawn under the glyphs every frame: (context, seconds, frame seconds, stage). */
export type Field = (c: CanvasRenderingContext2D, t: number, dt: number, s: SigilStage) => void;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CELL = 32;

export class SigilStage {
  readonly reduced: boolean;
  private host: HTMLElement;
  private cv: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private glyphs: { t: string; f: string }[] = [];
  private atlases = new Map<string, HTMLCanvasElement>();
  private motes: Mote[] = [];
  private fields: Field[] = [];
  private gens = new WeakMap<Element, number>();
  private raf = 0;
  private last = 0;
  w = 0;
  h = 0;
  private dpr = 1;
  private rnd = rng(11);
  private dead = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(host: HTMLElement, opts: { reduced?: boolean } = {}) {
    this.host = host;
    this.reduced = opts.reduced ?? reducedMotion();
    const nC = Math.round(COUNT * MIX);
    this.glyphs = [...Array.from({ length: nC }, (_, i) => ({ t: CODE[i % CODE.length]!, f: MONO })), ...Array.from({ length: COUNT - nC }, (_, j) => ({ t: ARC[j % ARC.length]!, f: ARCANE }))];
    if (this.reduced || typeof document === "undefined") return;
    const cv = document.createElement("canvas");
    cv.className = "sg-cv";
    cv.setAttribute("aria-hidden", "true");
    host.appendChild(cv);
    this.cv = cv;
    this.ctx = cv.getContext("2d");
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    // The arcane fonts come in on first use; redraw the atlases once they have.
    void this.fontsIn();
    document.addEventListener("visibilitychange", this.wake);
    this.wake();
  }

  /** Live glyphs (for tests and the e2e). */
  get live(): number {
    return this.motes.length;
  }

  private async fontsIn() {
    if (!document.fonts) return;
    try {
      await Promise.all(["Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Runic"].map((f) => document.fonts.load(`16px "${f}"`, ARC.join("")).catch(() => undefined)));
      await document.fonts.load(`16px ${MONO}`, CODE.join("")).catch(() => undefined);
    } catch {
      /* the fallbacks draw */
    }
    this.atlases.clear();
  }

  /** One sheet per colour: every glyph, plain on row 0 and glowing on row 1. */
  private atlas(col: string): HTMLCanvasElement | null {
    const got = this.atlases.get(col);
    if (got) return got;
    const a = document.createElement("canvas");
    a.width = CELL * this.glyphs.length;
    a.height = CELL * 2;
    const x = a.getContext("2d");
    if (!x) return null;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = col;
    x.shadowColor = col;
    this.glyphs.forEach((g, i) => {
      let fs = 22;
      x.font = `500 ${fs}px ${g.f}`;
      const w = x.measureText(g.t).width;
      if (w > 26) {
        fs = Math.floor((fs * 26) / w);
        x.font = `500 ${fs}px ${g.f}`;
      }
      for (let v = 0; v < 2; v++) {
        x.shadowBlur = v ? 8 : 0;
        x.fillText(g.t, i * CELL + CELL / 2, v * CELL + CELL / 2 + 1);
      }
    });
    this.atlases.set(col, a);
    return a;
  }

  /** Stamps glyph `gi` in colour `col` centred on (x, y), `s` px, alpha `a`. For fields. */
  glyph(c: CanvasRenderingContext2D, col: string, gi: number, x: number, y: number, s: number, a: number, glow = false) {
    if (a <= 0.01) return;
    const A = this.atlas(col);
    if (!A) return;
    c.globalAlpha = Math.min(1, a);
    c.drawImage(A, (gi % this.glyphs.length) * CELL, glow ? CELL : 0, CELL, CELL, x - s / 2, y - s / 2, s, s);
  }

  /** A random glyph's first character (the undo line's countdown). */
  randGlyph(): string {
    return [...this.glyphs[Math.floor(this.rnd() * this.glyphs.length)]!.t][0]!;
  }

  /** Draws `fn` under the glyphs every frame; returns its remover. */
  field(fn: Field): () => void {
    this.fields.push(fn);
    this.wake();
    return () => {
      this.fields = this.fields.filter((f) => f !== fn);
    };
  }

  rel(el: Element): Box {
    const a = this.host.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height, cx: b.left - a.left + b.width / 2, cy: b.top - a.top + b.height / 2 };
  }

  /** Whether any of the element is inside the stage. */
  private onStage(el: Element) {
    const r = this.rel(el);
    return r.w > 0 && r.h > 0 && r.y + r.h > 0 && r.y < this.host.clientHeight && r.x + r.w > 0 && r.x < this.host.clientWidth;
  }

  /** The step between samples: an eighth of the font size, at least 3 px. */
  private gapOf(el: HTMLElement, gap?: number) {
    if (gap) return gap;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 20;
    return Math.max(3, fs / 8);
  }

  /**
   * Points inside an element's letterforms, `gap` px apart, at most `max`. Each word is drawn where the browser laid
   * it out, read through a Range: the element's children are never touched.
   */
  private sample(el: HTMLElement, gap: number, max: number): { pts: [number, number][]; box: Box } {
    const er = el.getBoundingClientRect();
    const box = this.rel(el);
    const W = Math.ceil(er.width) + 8;
    const H = Math.ceil(er.height) + 8;
    if (W < 9 || H < 9 || max <= 0) return { pts: [], box };
    const oc = document.createElement("canvas");
    oc.width = W;
    oc.height = H;
    const g = oc.getContext("2d", { willReadFrequently: true });
    if (!g) return { pts: [], box };
    g.fillStyle = "#fff";
    g.textBaseline = "alphabetic";
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const node = n as Text;
      const parent = node.parentElement;
      if (!parent) continue;
      const cs = getComputedStyle(parent);
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      (g as unknown as { letterSpacing: string }).letterSpacing = cs.letterSpacing && cs.letterSpacing !== "normal" ? cs.letterSpacing : "0px";
      const fs = parseFloat(cs.fontSize);
      for (const m of node.data.matchAll(/\S+/g)) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const r = range.getClientRects()[0];
        if (!r) continue;
        const tm = g.measureText(m[0]);
        const asc = tm.fontBoundingBoxAscent || fs * 0.8;
        const desc = tm.fontBoundingBoxDescent || fs * 0.2;
        g.fillText(m[0], r.left - er.left, r.top - er.top + (r.height - asc - desc) / 2 + asc);
      }
    }
    const d = g.getImageData(0, 0, W, H).data;
    const pts: [number, number][] = [];
    const step = Math.max(1, Math.round(gap));
    for (let y = 0; y < H; y += step) for (let x = ((y / step) % 2) * (step >> 1); x < W; x += step) if (d[(y * W + x) * 4 + 3]! > 100) pts.push([box.x + x, box.y + y]);
    if (pts.length > max) {
      for (let i = pts.length - 1; i > 0; i--) {
        const j = Math.floor(this.rnd() * (i + 1));
        [pts[i], pts[j]] = [pts[j]!, pts[i]!];
      }
      pts.length = max;
    }
    return { pts, box };
  }

  private after(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) fn();
    }, ms);
    this.timers.add(t);
  }

  /** A new form or dissolve on `el`: the older one's glyphs fade and its timers stand down. */
  private claim(el: Element): number {
    const gen = (this.gens.get(el) ?? 0) + 1;
    this.gens.set(el, gen);
    this.fadeOwned(el);
    return gen;
  }

  private fadeOwned(el: Element) {
    const t = performance.now();
    for (const m of this.motes) if (m.owner === el && !m.fade) m.fade = t;
  }

  /** The element's colour with its text showing. */
  private colorOf(el: HTMLElement) {
    if (!ghosted(el)) return getComputedStyle(el).color;
    ghost(el, false);
    const c = getComputedStyle(el).color;
    ghost(el, true);
    return c;
  }

  private mote(extra: Omit<Mote, "g" | "gt" | "gi" | "lock" | "fade">): Mote {
    return { g: Math.floor(this.rnd() * this.glyphs.length), gt: 0, gi: 60 + this.rnd() * 160, lock: false, fade: 0, ...extra };
  }

  /** The element's text is written in out of sigils. Resolves when it has formed (or a newer call took over). */
  async form(el: HTMLElement, o: FormOpts = {}): Promise<void> {
    if (this.reduced || !this.ctx) {
      ghost(el, false);
      return;
    }
    const gen = this.claim(el);
    const col = o.color ?? this.colorOf(el);
    ghost(el, true);
    const gap = this.gapOf(el, o.gap);
    const s = this.onStage(el) ? this.sample(el, gap, room(this.motes.length, o.max ?? MAX_PER_TEXT)) : null;
    if (!s?.pts.length) {
      ghost(el, false);
      return;
    }
    const now = performance.now();
    const dur = o.dur ?? 1100;
    const stg = o.stagger ?? 650;
    const sw = o.swirl ?? 40;
    const s1 = o.size ?? Math.max(6, gap * 1.9);
    const s0 = s1 * 1.9;
    const from = o.from ?? ((_i: number, _x: number, _y: number, b: Box) => [b.x + this.rnd() * b.w, b.y - 60 - this.rnd() * 120] as [number, number]);
    let end = 0;
    s.pts.forEach((p, i) => {
      const f = from(i, p[0], p[1], s.box);
      const d = o.ltr === false ? this.rnd() * stg : stg * ((p[0] - s.box.x) / (s.box.w || 1)) + this.rnd() * (o.jitter ?? 220);
      const du = dur * (0.7 + this.rnd() * 0.6);
      end = Math.max(end, d + du);
      this.motes.push(this.mote({ sx: f[0], sy: f[1], tx: p[0], ty: p[1], t0: now + d, du, c: col, s0, s1, sw: (this.rnd() - 0.5) * sw, sw2: (this.rnd() - 0.5) * sw, pre: o.pre ?? 0.3, glow: this.rnd() < (o.glow ?? 0.08), mode: 0, path: o.path, owner: el }));
    });
    this.wake();
    // The real text shows through as the swarm lands, then the glyphs fade off it.
    this.after(end * 0.85, () => this.gens.get(el) === gen && ghost(el, false));
    this.after(end + 80, () => this.gens.get(el) === gen && this.fadeOwned(el));
    await sleep(end + 60);
  }

  /** The element's text breaks back into sigils that stream to `to`. Resolves when they're gone. */
  async dissolve(el: HTMLElement, o: DissolveOpts = {}): Promise<void> {
    if (this.reduced || !this.ctx) {
      ghost(el, true);
      return;
    }
    this.claim(el);
    if (ghosted(el) || !this.onStage(el)) {
      ghost(el, true);
      return;
    }
    const col = o.color ?? getComputedStyle(el).color;
    const gap = this.gapOf(el, o.gap);
    const s = this.sample(el, gap, room(this.motes.length, o.max ?? MAX_PER_TEXT));
    ghost(el, true);
    const now = performance.now();
    const dur = o.dur ?? 900;
    const stg = o.stagger ?? 350;
    const s1 = Math.max(6, gap * 1.9);
    const to = o.to ?? ((_i: number, x: number, y: number) => [x + 200, y - 80] as [number, number]);
    let end = 0;
    s.pts.forEach((p, i) => {
      const t = to(i, p[0], p[1], s.box);
      const d = this.rnd() * stg + (o.rtl ? stg * (1 - (p[0] - s.box.x) / (s.box.w || 1)) : 0);
      const du = dur * (0.7 + this.rnd() * 0.6);
      end = Math.max(end, d + du);
      this.motes.push(this.mote({ sx: p[0], sy: p[1], tx: t[0], ty: t[1], t0: now + d, du, c: col, s0: s1, s1: s1 * 1.5, sw: (this.rnd() - 0.5) * (o.swirl ?? 50), sw2: (this.rnd() - 0.5) * (o.swirl ?? 50), pre: 1, glow: this.rnd() < 0.1, mode: 1, path: o.path }));
    });
    this.wake();
    await sleep(end);
  }

  /** A spray of sigils from (x, y): along `ang` (radians), or to `to`. */
  burst(x: number, y: number, o: BurstOpts = {}) {
    if (this.reduced || !this.ctx) return;
    const now = performance.now();
    const n = room(this.motes.length, o.n ?? 60);
    const size = o.size ?? 7;
    for (let i = 0; i < n; i++) {
      const a = (o.ang ?? -Math.PI / 2) + (this.rnd() - 0.5) * (o.spread ?? 1.2);
      const r = (o.dist ?? 160) * (0.3 + this.rnd() * 0.9);
      const sx = x + (this.rnd() - 0.5) * (o.w ?? 0);
      const sy = y + (this.rnd() - 0.5) * (o.h ?? 0);
      const t = o.to ? o.to(i, sx, sy) : ([sx + Math.cos(a) * r, sy + Math.sin(a) * r] as [number, number]);
      this.motes.push(this.mote({ sx, sy, tx: t[0], ty: t[1], t0: now + this.rnd() * (o.stagger ?? 200), du: (o.dur ?? 900) * (0.6 + this.rnd() * 0.8), c: o.color ?? INK.hi, s0: size, s1: size * 1.2, sw: (this.rnd() - 0.5) * 30, sw2: (this.rnd() - 0.5) * 30, pre: 0, glow: this.rnd() < 0.15, mode: 1, out: true, path: o.path }));
    }
    this.wake();
  }

  private wake = () => {
    if (this.dead || this.raf || !this.ctx) return;
    if (document.visibilityState === "hidden") return;
    if (!this.motes.length && !this.fields.length) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  };

  private size() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!this.cv || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const c = this.ctx;
    if (!c || this.dead) return;
    this.size();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    for (const f of this.fields) f(c, now / 1000, dt, this);
    const keep: Mote[] = [];
    const G = this.glyphs.length;
    for (let i = 0; i < this.motes.length; i++) {
      const p = this.motes[i]!;
      const k = (now - p.t0) / p.du;
      let x: number;
      let y: number;
      let a: number;
      let s: number;
      if (k < 0) {
        x = p.sx + Math.sin(now / 600 + i) * 2.5;
        y = p.sy + Math.cos(now / 700 + i) * 2.5;
        a = p.pre;
        s = p.s0;
      } else {
        const kk = Math.min(1, k);
        const e = p.mode && !p.out ? ei(kk) : p.path ? eio(kk) : eo(kk);
        const b = Math.sin(kk * Math.PI);
        if (p.path) [x, y] = p.path(p, e, b);
        else {
          x = p.sx + (p.tx - p.sx) * e + b * p.sw;
          y = p.sy + (p.ty - p.sy) * e + b * p.sw2;
        }
        a = p.mode ? 1 - kk * kk : p.pre + (1 - p.pre) * Math.min(1, kk * 1.6);
        if (p.mode && k >= 1) continue;
        s = p.s0 + (p.s1 - p.s0) * e;
        if (!p.mode && kk >= 1) p.lock = true;
      }
      if (p.fade) {
        const fk = (now - p.fade) / 420;
        if (fk >= 1) continue;
        if (fk > 0) a *= 1 - fk;
      }
      keep.push(p);
      // Living code: a glyph flickers to another until it locks into its letter.
      if (!p.lock && now - p.gt > p.gi) {
        p.g = Math.floor(this.rnd() * G);
        p.gt = now;
      }
      this.glyph(c, p.c, p.g, x, y, s, a, p.glow);
    }
    c.globalAlpha = 1;
    this.motes = keep;
    this.wake();
  };

  destroy() {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    for (const t of this.timers) clearTimeout(t);
    if (this.cv) document.removeEventListener("visibilitychange", this.wake);
    this.cv?.remove();
    this.motes = [];
    this.fields = [];
  }
}
