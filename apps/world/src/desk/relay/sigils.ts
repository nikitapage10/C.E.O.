import "./sigils.css";

/**
 * Sigils (#615): the living fragments of code and rune that Ilyr is built from, as a small canvas engine. Text forms
 * out of them and dissolves back into them: `form` pulls a swarm of glyphs ({ } < > / ; = λ ∴ ⌘, runes, alchemical
 * marks) into an element's letterforms, shrinking as they land while the real text fades in under them; `dissolve`
 * breaks an element's text back into glyphs that stream away; `burst` sprays a handful from a point.
 *
 * Kept fast for a laptop: every glyph is drawn once per colour into an atlas and stamped with drawImage; the live
 * count is capped (MAX_LIVE), the text is sampled coarsely, and the loop runs only while something moves or the
 * ambient drift is on and the tab is showing. Glyphs the fonts can't draw (a tofu box) are dropped from the set.
 * With prefers-reduced-motion there is no canvas at all: text simply appears and goes.
 *
 * The real text is always in the DOM (screen readers and Find read it); the glyphs are decoration over it.
 */

/** The glyph set: code, math, runes, alchemy. */
export const SIGILS = ["{", "}", "<", ">", "/", ";", "=", "λ", "∴", "⌘", "∆", "∇", "≡", "⊕", "⊗", "◊", "†", "§", "※", "ᚠ", "ᚱ", "ᚦ", "ᛉ", "ᛟ", "ᛝ", "☿", "♄", "♃", "☉", "☽", "🜂", "🜄", "🜁", "🜃"] as const;

/** Messenger blue, its light tint, and dim ink. */
export const SIGIL_INKS = { blue: "#0a7cff", light: "#8fb8ff", ink: "#565d72" } as const;
export type SigilInk = keyof typeof SIGIL_INKS;

/** The most glyphs alive at once, across every form, dissolve and burst. */
export const MAX_LIVE = 1600;
/** The most one `form` or `dissolve` samples. */
export const MAX_PER_TEXT = 700;
/** The class that hides an element's text while its glyphs are in flight. */
export const GHOST = "sg-ghost";

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

const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const ei = (t: number) => t * t * t;

interface Mote {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t0: number;
  du: number;
  g: number;
  ink: SigilInk;
  /** Size in flight and on arrival (px). */
  s0: number;
  s1: number;
  sw: number;
  sw2: number;
  /** Alpha while waiting to leave. */
  pre: number;
  /** 0 forms (eases out to the target), 1 dissolves (eases in, fades). */
  mode: 0 | 1;
  fade: number;
}

export interface FormOpts {
  /** Where each glyph starts: (index, target x, target y, box) → [x, y]. Default: above the text. */
  from?: (i: number, x: number, y: number, box: Box) => [number, number];
  ink?: SigilInk | ((i: number) => SigilInk);
  dur?: number;
  /** Left-to-right spread of start times (ms). */
  stagger?: number;
  jitter?: number;
  swirl?: number;
  /** Sample step (px): bigger is fewer glyphs. */
  gap?: number;
  max?: number;
  size?: number;
}

export interface DissolveOpts {
  to?: (i: number, x: number, y: number, box: Box) => [number, number];
  ink?: SigilInk | ((i: number) => SigilInk);
  dur?: number;
  stagger?: number;
  gap?: number;
  max?: number;
  size?: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Most messages are ink mixed with blue: two in five dim. */
const defaultInk = (r: () => number) => (): SigilInk => {
  const v = r();
  return v < 0.4 ? "ink" : v < 0.8 ? "light" : "blue";
};

/** Wraps each word of an element in a span (once), so the sampler can place each word where the browser laid it out. */
function prep(el: HTMLElement) {
  if (el.dataset.sg) return;
  const text = el.textContent ?? "";
  el.textContent = "";
  for (const tok of text.split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) el.appendChild(document.createTextNode(tok));
    else {
      const s = document.createElement("span");
      s.className = "sg-wd";
      s.textContent = tok;
      el.appendChild(s);
    }
  }
  el.dataset.sg = "1";
}

const CELL = 24;

export class SigilStage {
  readonly reduced: boolean;
  private host: { getBoundingClientRect(): DOMRect; clientWidth: number; clientHeight: number; appendChild?: (n: Node) => unknown };
  private cv: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private atlas: HTMLCanvasElement | null = null;
  private glyphs = 0;
  private motes: Mote[] = [];
  private drift: { x: number; y: number; v: number; g: number; s: number }[] = [];
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private rnd = rng(11);
  private ink = defaultInk(rng(23));
  private dead = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(host: HTMLElement, opts: { ambient?: number; reduced?: boolean } = {}) {
    this.host = host;
    this.reduced = opts.reduced ?? reducedMotion();
    if (this.reduced || typeof document === "undefined") return;
    const cv = document.createElement("canvas");
    cv.className = "sg-cv";
    cv.setAttribute("aria-hidden", "true");
    host.appendChild(cv);
    this.cv = cv;
    this.ctx = cv.getContext("2d");
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.buildAtlas();
    for (let i = 0; i < (opts.ambient ?? 0); i++) this.drift.push({ x: this.rnd(), y: this.rnd(), v: 0.008 + this.rnd() * 0.016, g: Math.floor(this.rnd() * this.glyphs), s: 5 + this.rnd() * 4 });
    document.addEventListener("visibilitychange", this.wake);
    this.wake();
  }

  /** Live glyphs (for tests and the e2e). */
  get live(): number {
    return this.motes.length;
  }

  /** One row of every glyph per ink, tofu dropped. */
  private buildAtlas() {
    const fonts = '"IBM Plex Mono", ui-monospace, "Segoe UI Symbol", "Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Runic", system-ui, sans-serif';
    const px = CELL * this.dpr;
    const probe = document.createElement("canvas");
    probe.width = probe.height = px;
    const pg = probe.getContext("2d", { willReadFrequently: true });
    if (!pg) return;
    pg.font = `${Math.round(px * 0.72)}px ${fonts}`;
    pg.textAlign = "center";
    pg.textBaseline = "middle";
    const shot = (ch: string) => {
      pg.clearRect(0, 0, px, px);
      pg.fillStyle = "#fff";
      pg.fillText(ch, px / 2, px / 2);
      return pg.getImageData(0, 0, px, px).data;
    };
    const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.every((v, i) => v === b[i]);
    const tofu = shot("\u{10FFFD}");
    const ok = SIGILS.filter((ch) => {
      const d = shot(ch);
      return d.some((v, i) => i % 4 === 3 && v > 40) && !same(d, tofu);
    });
    const set = ok.length >= 8 ? ok : SIGILS.slice(0, 19);
    this.glyphs = set.length;
    const inks = Object.keys(SIGIL_INKS) as SigilInk[];
    const a = document.createElement("canvas");
    a.width = px * set.length;
    a.height = px * inks.length;
    const g = a.getContext("2d");
    if (!g) return;
    g.font = pg.font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    inks.forEach((ink, row) => {
      g.fillStyle = SIGIL_INKS[ink];
      set.forEach((ch, col) => g.fillText(ch, col * px + px / 2, row * px + px / 2));
    });
    this.atlas = a;
  }

  rel(el: Element): Box {
    const a = this.host.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height, cx: b.left - a.left + b.width / 2, cy: b.top - a.top + b.height / 2 };
  }

  /** Points inside an element's letterforms, sampled `gap` px apart, at most `max`. */
  private sample(el: HTMLElement, gap: number, max: number): { pts: [number, number][]; box: Box } {
    prep(el);
    const er = el.getBoundingClientRect();
    const box = this.rel(el);
    const S = 1;
    const W = Math.ceil(er.width) + 8;
    const H = Math.ceil(er.height) + 8;
    const oc = document.createElement("canvas");
    oc.width = W * S;
    oc.height = H * S;
    const g = oc.getContext("2d", { willReadFrequently: true });
    if (!g) return { pts: [], box };
    g.fillStyle = "#fff";
    g.textBaseline = "alphabetic";
    el.querySelectorAll<HTMLElement>(".sg-wd").forEach((sp) => {
      const cs = getComputedStyle(sp);
      const r = sp.getBoundingClientRect();
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = g.measureText(sp.textContent ?? "");
      const fs = parseFloat(cs.fontSize);
      const asc = m.fontBoundingBoxAscent || fs * 0.8;
      const desc = m.fontBoundingBoxDescent || fs * 0.2;
      g.fillText(sp.textContent ?? "", r.left - er.left, r.top - er.top + (r.height - asc - desc) / 2 + asc);
    });
    const d = g.getImageData(0, 0, oc.width, oc.height).data;
    const pts: [number, number][] = [];
    const step = Math.max(1, Math.round(gap * S));
    for (let y = 0; y < oc.height; y += step) for (let x = 0; x < oc.width; x += step) if (d[(y * oc.width + x) * 4 + 3]! > 110) pts.push([box.x + x / S, box.y + y / S]);
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

  private inkOf(o: SigilInk | ((i: number) => SigilInk) | undefined, i: number): SigilInk {
    return typeof o === "function" ? o(i) : (o ?? this.ink());
  }

  /** The element's text condenses out of sigils. Resolves when it has formed. */
  async form(el: HTMLElement, o: FormOpts = {}): Promise<void> {
    if (this.reduced || !this.ctx || !this.atlas) {
      el.classList.remove(GHOST);
      return;
    }
    el.classList.add(GHOST);
    const s = this.sample(el, o.gap ?? 3, Math.min(o.max ?? MAX_PER_TEXT, room(this.motes.length, o.max ?? MAX_PER_TEXT)));
    if (!s.pts.length) {
      el.classList.remove(GHOST);
      return;
    }
    const now = performance.now();
    const dur = o.dur ?? 900;
    const stg = o.stagger ?? 520;
    const sw = o.swirl ?? 36;
    const size = o.size ?? 9;
    const from = o.from ?? ((_i: number, _x: number, _y: number, b: Box) => [b.x + this.rnd() * b.w, b.y - 50 - this.rnd() * 110] as [number, number]);
    let end = 0;
    s.pts.forEach((p, i) => {
      const f = from(i, p[0], p[1], s.box);
      const d = stg * ((p[0] - s.box.x) / (s.box.w || 1)) + this.rnd() * (o.jitter ?? 180);
      const du = dur * (0.7 + this.rnd() * 0.6);
      end = Math.max(end, d + du);
      this.motes.push({ sx: f[0], sy: f[1], tx: p[0], ty: p[1], t0: now + d, du, g: Math.floor(this.rnd() * this.glyphs), ink: this.inkOf(o.ink, i), s0: size, s1: 2.6, sw: (this.rnd() - 0.5) * sw, sw2: (this.rnd() - 0.5) * sw, pre: 0.3, mode: 0, fade: 0 });
    });
    const batch = this.motes.slice(-s.pts.length);
    this.wake();
    // The real text shows through as the swarm lands, then the glyphs fade off it.
    this.after(end * 0.78, () => el.classList.remove(GHOST));
    this.after(end + 80, () => {
      const t = performance.now();
      for (const m of batch) m.fade = t;
    });
    await sleep(end + 40);
  }

  /** The element's text breaks back into sigils that stream to `to`. Resolves when they're gone. */
  async dissolve(el: HTMLElement, o: DissolveOpts = {}): Promise<void> {
    if (this.reduced || !this.ctx || !this.atlas) {
      el.classList.add(GHOST);
      return;
    }
    const s = this.sample(el, o.gap ?? 3.2, Math.min(o.max ?? MAX_PER_TEXT, room(this.motes.length, o.max ?? MAX_PER_TEXT)));
    el.classList.add(GHOST);
    const now = performance.now();
    const dur = o.dur ?? 850;
    const stg = o.stagger ?? 320;
    const size = o.size ?? 8;
    const to = o.to ?? ((_i: number, x: number, y: number) => [x + 180, y - 70] as [number, number]);
    let end = 0;
    s.pts.forEach((p, i) => {
      const t = to(i, p[0], p[1], s.box);
      const d = this.rnd() * stg;
      const du = dur * (0.7 + this.rnd() * 0.6);
      end = Math.max(end, d + du);
      this.motes.push({ sx: p[0], sy: p[1], tx: t[0], ty: t[1], t0: now + d, du, g: Math.floor(this.rnd() * this.glyphs), ink: this.inkOf(o.ink, i), s0: 3, s1: size, sw: (this.rnd() - 0.5) * 46, sw2: (this.rnd() - 0.5) * 46, pre: 1, mode: 1, fade: 0 });
    });
    this.wake();
    await sleep(end);
  }

  /** A spray of sigils from (x, y) along `ang` (radians). */
  burst(x: number, y: number, o: { n?: number; ang?: number; spread?: number; dist?: number; ink?: SigilInk; dur?: number } = {}) {
    if (this.reduced || !this.ctx || !this.atlas) return;
    const now = performance.now();
    const n = room(this.motes.length, o.n ?? 60);
    for (let i = 0; i < n; i++) {
      const a = (o.ang ?? -Math.PI / 2) + (this.rnd() - 0.5) * (o.spread ?? 1.2);
      const r = (o.dist ?? 160) * (0.3 + this.rnd() * 0.9);
      this.motes.push({ sx: x, sy: y, tx: x + Math.cos(a) * r, ty: y + Math.sin(a) * r, t0: now + this.rnd() * 160, du: (o.dur ?? 850) * (0.6 + this.rnd() * 0.8), g: Math.floor(this.rnd() * this.glyphs), ink: o.ink ?? this.ink(), s0: 4, s1: 9, sw: (this.rnd() - 0.5) * 30, sw2: (this.rnd() - 0.5) * 30, pre: 0, mode: 1, fade: 0 });
    }
    this.wake();
  }

  private wake = () => {
    if (this.dead || this.raf || !this.ctx) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!this.motes.length && !this.drift.length) return;
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

  private stamp(g: number, ink: SigilInk, x: number, y: number, s: number) {
    const px = CELL * this.dpr;
    const row = ink === "blue" ? 0 : ink === "light" ? 1 : 2;
    this.ctx!.drawImage(this.atlas!, g * px, row * px, px, px, x - s / 2, y - s / 2, s, s);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const c = this.ctx;
    if (!c || this.dead) return;
    this.size();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const t = now / 1000;
    for (const m of this.drift) {
      m.y -= m.v / 60;
      if (m.y < 0) {
        m.y = 1;
        m.x = this.rnd();
      }
      c.globalAlpha = 0.16 * Math.sin(m.y * Math.PI);
      this.stamp(m.g, "light", m.x * this.w + Math.sin(t + m.x * 9) * 8, m.y * this.h, m.s);
    }
    const keep: Mote[] = [];
    for (let i = 0; i < this.motes.length; i++) {
      const p = this.motes[i]!;
      const k = (now - p.t0) / p.du;
      let x: number;
      let y: number;
      let a: number;
      let s: number;
      if (k < 0) {
        x = p.sx + Math.sin(now / 600 + i) * 3;
        y = p.sy + Math.cos(now / 700 + i) * 3;
        a = p.pre;
        s = p.s0;
      } else {
        const kk = Math.min(1, k);
        const e = p.mode ? ei(kk) : eo(kk);
        const b = Math.sin(kk * Math.PI);
        x = p.sx + (p.tx - p.sx) * e + b * p.sw;
        y = p.sy + (p.ty - p.sy) * e + b * p.sw2;
        a = p.mode ? 1 - kk * kk : p.pre + (1 - p.pre) * Math.min(1, kk * 1.6);
        s = p.s0 + (p.s1 - p.s0) * e;
        if (p.mode && k >= 1) continue;
      }
      if (p.fade) {
        const fk = (now - p.fade) / 360;
        if (fk >= 1) continue;
        a *= 1 - fk;
      }
      keep.push(p);
      // A sigil flickers to another now and then: living code, not confetti.
      if (this.rnd() < 0.02) p.g = Math.floor(this.rnd() * this.glyphs);
      if (a <= 0.01) continue;
      c.globalAlpha = a;
      this.stamp(p.g, p.ink, x, y, s);
    }
    c.globalAlpha = 1;
    this.motes = keep;
    if (this.motes.length || this.drift.length) this.wake();
  };

  destroy() {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    for (const t of this.timers) clearTimeout(t);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.wake);
    this.cv?.remove();
    this.motes = [];
  }
}
