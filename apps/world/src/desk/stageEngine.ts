import { clamp, gauss, HOT, lerp, OK, RC, reducedMotion, RUN, spr, sprMix, sstep, TAU, WHITE, type Viz, type VizSpec } from "./wvCanvas.ts";

/**
 * The Foundry's loom, as the approved Weave draws it (desk-concepts round five, 83-engine.js): the crew's work as
 * threads of light on springs. Ideas come in on the left, warm; each job in flight runs to the checks; what shipped
 * braids out to the right, cool. Each real item is a knot on its thread; opening one re-weaves its thread into the left
 * margin beside the details. Everything drawn is from the live Foundry feed: no item, no thread.
 */

const M = 160;
const SEG = 12;

interface Pt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
}

interface ThreadOpts {
  item?: string | null;
  K: number;
  n: number;
  spread?: number;
  vmin?: number;
  vmax?: number;
  alpha?: number;
  k?: number;
  head?: boolean;
  grad?: boolean;
  rgb?: string;
  cy?: number;
}

export class Thread {
  item: string | null;
  K: number;
  pts: Pt[] = [];
  n: number;
  spread: number;
  rgb: string;
  hi = WHITE;
  grad: boolean;
  k: number;
  alpha = 0;
  alphaT: number;
  head: boolean;
  fadeIn = 0.06;
  R: number;
  raw: Float32Array;
  cl: Float32Array;
  s = new Float32Array(M * 2);
  len = 1;
  snapped = false;
  pu: Float32Array;
  po: Float32Array;
  pp: Float32Array;
  pv: Float32Array;
  pz: Float32Array;
  pc: Uint8Array;
  constructor(o: ThreadOpts) {
    this.item = o.item ?? null;
    this.K = o.K;
    for (let i = 0; i < o.K; i++) this.pts.push({ x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 });
    this.n = o.n;
    this.spread = o.spread ?? 2.6;
    this.rgb = o.rgb ?? WHITE;
    this.grad = Boolean(o.grad);
    this.k = o.k ?? 30;
    this.alphaT = o.alpha ?? 1;
    this.head = Boolean(o.head);
    this.R = (o.K - 1) * SEG + 1;
    this.raw = new Float32Array(this.R * 2);
    this.cl = new Float32Array(this.R);
    const n = o.n;
    this.pu = new Float32Array(n);
    this.po = new Float32Array(n);
    this.pp = new Float32Array(n);
    this.pv = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.pc = new Uint8Array(n);
    const vmin = o.vmin ?? 30;
    const vmax = o.vmax ?? 70;
    for (let i = 0; i < n; i++) {
      this.pu[i] = Math.random();
      this.po[i] = gauss();
      this.pp[i] = Math.random() * TAU;
      this.pv[i] = vmin + Math.random() * (vmax - vmin);
      const z = Math.random();
      this.pz[i] = z * z * z;
      this.pc[i] = Math.random() < (o.cy ?? 0) ? 1 : 0;
    }
  }
  target(i: number, x: number, y: number) {
    const p = this.pts[i]!;
    p.tx = x;
    p.ty = y;
  }
  step(dt: number, snap: boolean) {
    if (snap || !this.snapped) {
      for (const p of this.pts) {
        p.x = p.tx;
        p.y = p.ty;
        p.vx = p.vy = 0;
      }
      this.snapped = true;
      this.alpha = this.alphaT;
      return;
    }
    const k = this.k;
    const c = 2 * Math.sqrt(k) * 0.82;
    for (const p of this.pts) {
      p.vx += (k * (p.tx - p.x) - c * p.vx) * dt;
      p.vy += (k * (p.ty - p.y) - c * p.vy) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.alpha += (this.alphaT - this.alpha) * Math.min(1, dt * 3.2);
  }
  sample() {
    const P = this.pts;
    const K = this.K;
    const raw = this.raw;
    let n = 0;
    for (let i = 0; i < K - 1; i++) {
      const p0 = P[i > 0 ? i - 1 : 0]!;
      const p1 = P[i]!;
      const p2 = P[i + 1]!;
      const p3 = P[i + 2 < K ? i + 2 : K - 1]!;
      for (let s = 0; s < SEG; s++) {
        const u = s / SEG;
        const u2 = u * u;
        const u3 = u2 * u;
        raw[n++] = 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
        raw[n++] = 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3);
      }
    }
    raw[n++] = P[K - 1]!.x;
    raw[n] = P[K - 1]!.y;
    const R = this.R;
    const cl = this.cl;
    cl[0] = 0;
    for (let i = 1; i < R; i++) {
      const ex = raw[2 * i]! - raw[2 * i - 2]!;
      const ey = raw[2 * i + 1]! - raw[2 * i - 1]!;
      cl[i] = cl[i - 1]! + Math.sqrt(ex * ex + ey * ey);
    }
    const L = cl[R - 1] || 1;
    this.len = L;
    const S = this.s;
    let j = 0;
    for (let m = 0; m < M; m++) {
      const tg = (L * m) / (M - 1);
      while (j < R - 2 && cl[j + 1]! < tg) j++;
      const sl = cl[j + 1]! - cl[j]! || 1;
      const f = clamp((tg - cl[j]!) / sl, 0, 1);
      S[2 * m] = raw[2 * j]! + (raw[2 * j + 2]! - raw[2 * j]!) * f;
      S[2 * m + 1] = raw[2 * j + 1]! + (raw[2 * j + 3]! - raw[2 * j + 1]!) * f;
    }
  }
  at(u: number) {
    const S = this.s;
    const f = clamp(u, 0, 1) * (M - 1);
    const i = Math.min(M - 2, f | 0);
    const r = f - i;
    const x = S[2 * i]! + (S[2 * i + 2]! - S[2 * i]!) * r;
    const y = S[2 * i + 1]! + (S[2 * i + 3]! - S[2 * i + 1]!) * r;
    const tx = S[2 * i + 2]! - S[2 * i]!;
    const ty = S[2 * i + 3]! - S[2 * i + 1]!;
    const l = Math.sqrt(tx * tx + ty * ty) || 1;
    return { x, y, tx: tx / l, ty: ty / l };
  }
  nearest(x: number, y: number) {
    const S = this.s;
    let best = 1e9;
    let bi = 0;
    for (let m = 0; m < M; m++) {
      const dx = S[2 * m]! - x;
      const dy = S[2 * m + 1]! - y;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        bi = m;
      }
    }
    return { d: Math.sqrt(best), u: bi / (M - 1) };
  }
}

interface Orb {
  a: number;
  w: number;
  r: number;
  tl: number;
  z: number;
}

interface Knot {
  item: string;
  t: Thread;
  u: number;
  uT: number;
  s: number;
  sT: number;
  hv: number;
  r: number;
  w: number;
  head: boolean;
  rgb: string;
  x: number;
  y: number;
  lx: number;
  ly: number;
  mw: number;
  orb: Orb[];
  anchorY: number | null;
}

function mkKnot(item: string, t: Thread, o: { u: number; s?: number; r?: number; w?: number; head?: boolean; rgb: string }): Knot {
  const orb: Orb[] = [];
  for (let i = 0; i < 30; i++) orb.push({ a: Math.random() * TAU, w: (0.6 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), r: 0.35 + Math.random() * 0.65, tl: -1.2 + Math.random() * 2.4, z: Math.random() });
  return { item, t, u: o.u, uT: o.u, s: 0, sT: o.s ?? 1, hv: 0, r: o.r ?? 9, w: o.w ?? 26, head: Boolean(o.head), rgb: o.rgb, x: 0, y: 0, lx: -1, ly: -1, mw: 0, orb, anchorY: null };
}

/** What the loom shows: which knots exist (from the live feed) and, for the crew and Suggest, the colour of the aux thread. */
export interface LoomItems {
  /** The jobs in flight, newest at the top, one strand each (at most {@link LOOM_STRANDS}). */
  flights: string[];
  /** The knot for the jobs past the strands ("+N more"), when there are any. */
  more: string | null;
  ideas: string[];
  shipped: string | null;
  /** Items without a knot of their own (the crew, the dock crew): their colour when opened. */
  aux: Record<string, string>;
}

/** What the page tells the loom each frame: what is open, and which knot the pointer is over. */
export interface LoomCtl {
  focus: string | null;
  level: 0 | 1 | 2;
  hover: string | null;
  /** The stage element, for the knots, column heads and details. */
  host: HTMLElement | null;
  open: (id: string) => void;
}

const COLS = [HOT, RC.foundry!, RUN, OK];

/** At most this many jobs in flight get a strand of their own: the dock crew's limit of four at once (docs/FOUNDRY.md). */
export const LOOM_STRANDS = 4;

/** The loom's stage lines and resting paths; phone stacks the stages top to bottom. */
export const loomGeo = (phone: boolean) =>
  phone
    ? { st: [0.17, 0.36, 0.55, 0.74], bc: 0.3, A: 0.085, tideB: 0.66, ideaB: [0.56, 0.56], ideaA: [0.11, 0.25], freq: 1.5, shipB: 0.4 }
    : { st: [0.12, 0.37, 0.62, 0.86], bc: 0.47, A: 0.075, tideB: 0.25, ideaB: [0.6, 0.71], ideaA: [0.14, 0.17], freq: 1.7, shipB: 0.47 };

/** The rows in flight sit this far apart at most; a row's label is about 36 px tall and its knot's button 40 px. */
export const ROW_GAP = 56;
/** The least room a row's label gets beside its knot on the desktop loom. */
const ROW_LABEL_MIN = 180;
/** A row's label starts this far right of its knot (wv.css, `.wv-knot.is-row`). */
export const ROW_LABEL_X = 20;

/** The shipped knot's label width on the desktop loom beside rows in flight: centred under it and kept on the stage. */
export function shipLabelWidth(W: number): number {
  const ship = loomGeo(false).st[3]! * W;
  return 2 * Math.round(Math.min(125, Math.max(60, W - ship - 16)));
}

/** Where a strand in flight ends (its knot), in pixels. */
export interface FlightEnd {
  x: number;
  y: number;
}

/**
 * The knots in flight. One job keeps the loom's old place, on the checks line. Several stack in a column in the
 * Building stage, labels to the right, a row apart: below the column heads, above the ideas' labels (so the two never
 * share a line), and far enough left that each label ends before the shipped knot's. On a phone they stack down the
 * Building stage, between the ideas and the ships. n counts the strands and the "+N more" knot together.
 */
export function flightEnds(n: number, W: number, H: number, phone: boolean): FlightEnd[] {
  const g = loomGeo(phone);
  if (n <= 0) return [];
  if (n === 1) return [phone ? { x: g.tideB * W, y: g.st[2]! * H } : { x: g.st[2]! * W, y: g.tideB * H }];
  const top = phone ? g.st[1]! * H : 0.19 * H;
  const bottom = phone ? 0.66 * H : Math.min(0.62 * H, g.ideaB[0]! * H - 44);
  const gap = Math.min(ROW_GAP, (bottom - top) / (n - 1));
  const x = phone ? 0.42 * W : Math.max(g.st[1]! * W, Math.min(0.5 * W, shipLeft(W) - 12 - ROW_LABEL_X - ROW_LABEL_MIN));
  return Array.from({ length: n }, (_, i) => ({ x, y: top + i * gap }));
}

/** Where the shipped knot's label starts on the desktop loom. */
const shipLeft = (W: number) => loomGeo(false).st[3]! * W - shipLabelWidth(W) / 2;

/** How wide a row's label may run on the desktop loom: up to the shipped knot's label, with a little air. */
export function rowLabelWidth(x: number, W: number): number {
  return Math.floor(clamp(shipLeft(W) - 12 - (x + ROW_LABEL_X), 100, 250) / 4) * 4;
}

export function loomSpec(items: LoomItems, ctl: { current: LoomCtl }): VizSpec {
  let threads: Thread[] = [];
  let ships: Thread[] = [];
  let ideas: Thread[] = [];
  let tides: Thread[] = [];
  let more: Thread | null = null;
  let aux: Thread;
  let knots: Knot[] = [];
  let phone = false;
  let gx = 300;
  let time = 0;
  let first = true;
  let hoverT: Thread | null = null;
  let bound: HTMLCanvasElement | null = null;
  let size = "";
  /** The re-weave: when a thread is opened or let go, a bright wave runs along it while it flows to its new path. */
  let wave = 9;
  let waveT: Thread | null = null;
  let lastFoc: string | null = null;

  const geo = () => loomGeo(phone);
  const flights = items.flights.slice(0, LOOM_STRANDS);
  /** Strands in flight, the "+N more" one included. */
  const rows = flights.length + (items.more ? 1 : 0);
  const multi = rows > 1;

  const build = () => {
    threads = [];
    knots = [];
    const mk = (o: ThreadOpts) => {
      const t = new Thread(o);
      threads.push(t);
      return t;
    };
    ships = [0, 1, 2].map((j) => mk({ item: items.shipped, K: 9, n: 230, spread: 1.8, vmin: 30, vmax: 58, alpha: 0.5, head: j === 1, grad: true }));
    ideas = items.ideas.slice(0, 2).map((id) => mk({ item: id, K: 6, n: 120, spread: 1.6, vmin: 12, vmax: 26, alpha: 0.5, head: true, rgb: HOT }));
    // One job keeps its whole strand of motes; several share the same budget, so the loom draws no more than it did.
    const n = flights.length > 1 ? Math.round(620 / flights.length) : 620;
    tides = flights.map((id) => mk({ item: id, K: 9, n, spread: multi ? 1.9 : 2.4, vmin: 44, vmax: 90, alpha: 1, head: true, grad: true }));
    more = items.more ? mk({ item: items.more, K: 9, n: 70, spread: 1.4, vmin: 30, vmax: 60, alpha: 0.55, head: true, grad: true }) : null;
    aux = mk({ K: 9, n: 520, spread: 2.2, vmin: 30, vmax: 60, alpha: 0, cy: 0.15 });
    tides.forEach((t, j) => knots.push(mkKnot(flights[j]!, t, { u: 0.99, head: true, r: 8, w: 22, rgb: RC.foundry! })));
    if (more && items.more) knots.push(mkKnot(items.more, more, { u: 0.99, s: 0.6, r: 7, w: 18, rgb: RC.foundry! }));
    ideas.forEach((t, j) => knots.push(mkKnot(items.ideas[j]!, t, { u: 0.985, s: 0.55, head: true, r: 7, w: 18, rgb: HOT })));
    if (items.shipped) knots.push(mkKnot(items.shipped, ships[1]!, { u: 0.99, s: 0.9, r: 9, w: 24, rgb: OK }));
    knots.push(mkKnot("aux", aux, { u: 0.5, s: 0, rgb: HOT }));
    aux.hi = WHITE;
  };
  build();

  const stageSpr = (V: Viz, x: number, y: number) => {
    const st = geo().st;
    const f = phone ? y / V.H : x / V.W;
    if (f <= st[0]!) return spr(COLS[0]!);
    if (f >= st[3]!) return spr(COLS[3]!);
    for (let i = 0; i < 3; i++) if (f < st[i + 1]!) return sprMix(COLS[i]!, COLS[i + 1]!, (f - st[i]!) / (st[i + 1]! - st[i]!));
    return spr(COLS[3]!);
  };

  const gxNow = () => (ctl.current.level === 2 && !phone ? Math.max(60, gx - 130) : gx);

  /** The followed thread's path: in from the bottom left, up the margin beside the details. */
  const focusPts = (t: Thread, W: number, H: number) => {
    const g = gxNow();
    const K = t.K;
    const ax = -0.08 * W;
    const ay = phone ? 1.02 * H : 0.96 * H;
    const cx = g;
    const cy = ay;
    const bx = g;
    const by = phone ? 0.86 * H : 0.66 * H;
    const ey = -0.08 * H;
    const L1 = Math.hypot(cx - ax, cy - ay) * 0.6 + Math.hypot(bx - cx, by - cy) * 0.6;
    const L2 = by - ey;
    const Lt = L1 + L2;
    for (let i = 0; i < K; i++) {
      const s = (i / (K - 1)) * Lt;
      let x: number;
      let y: number;
      if (s < L1) {
        const q = s / L1;
        const a = (1 - q) * (1 - q);
        const b = 2 * (1 - q) * q;
        const c = q * q;
        x = a * ax + b * cx + c * bx;
        y = a * ay + b * cy + c * by;
      } else {
        x = g;
        y = by - (s - L1);
      }
      t.target(i, x, y);
    }
  };

  const threadOf = (id: string | null): Thread | null => {
    if (!id) return null;
    const fx = flights.indexOf(id);
    if (fx >= 0) return tides[fx]!;
    if (id === items.more) return more;
    const ix = items.ideas.indexOf(id);
    if (ix >= 0 && ix < ideas.length) return ideas[ix]!;
    if (id === items.shipped) return ships[1]!;
    return items.aux[id] ? aux : null;
  };

  const layout = (V: Viz) => {
    const { W, H } = V;
    const g = geo();
    const st = g.st;
    const P = (t: Thread, i: number, a: number, b: number) => (phone ? t.target(i, b * W, a * H) : t.target(i, a * W, b * H));
    const braid = (a: number, phi: number) => g.bc + g.A * Math.sin(a * TAU * g.freq + phi + time * 0.16);
    const c = ctl.current;
    const foc = c.level > 0 ? c.focus : null;
    const followed = threadOf(foc);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 9; i++) {
        const a = lerp(-0.06, st[3]!, i / 8);
        let b = braid(a, (j * TAU) / 3);
        b = lerp(b, g.shipB, sstep(st[3]! - 0.22, st[3]!, a));
        P(ships[j]!, i, a, b);
      }
    }
    const ends = flightEnds(rows, W, H, phone);
    [...tides, ...(more ? [more] : [])].forEach((t, j) => {
      const e = ends[j]!;
      const endA = phone ? e.y / H : e.x / W;
      const endB = phone ? e.x / W : e.y / H;
      const from = multi ? endA - 0.3 : st[1]! - 0.1;
      for (let i = 0; i < 9; i++) {
        const a = lerp(-0.06, endA, i / 8);
        let b = braid(a, TAU / 6 + j * 1.3);
        b = lerp(b, endB, sstep(from, endA, a));
        P(t, i, a, b);
      }
    });
    ideas.forEach((t, j) => {
      for (let i = 0; i < 6; i++) {
        const a = lerp(-0.06, g.ideaA[j]!, i / 5);
        let b = braid(a, Math.PI + j * 2.1);
        b = lerp(b, g.ideaB[j]!, Math.pow(sstep(-0.06, g.ideaA[j]!, a), 0.8));
        P(t, i, a, b);
      }
    });
    for (let i = 0; i < 9; i++) aux.target(i, -0.3 * W, lerp(-0.1, 1.1, i / 8) * H);
    for (const t of threads) {
      const base = tides.includes(t) ? 1 : t === more ? 0.55 : t === aux ? 0 : ships.includes(t) ? 0.5 : 0.42;
      t.alphaT = followed ? (t === followed ? 1 : 0.03) : base * (hoverT && hoverT.item === t.item && t.item ? 1.6 : 1);
      t.k = followed === t ? 11 : followed ? 30 : 16;
    }
    if (followed) focusPts(followed, W, H);
    if (followed === aux && foc) {
      aux.rgb = items.aux[foc] ?? HOT;
      knots.at(-1)!.rgb = aux.rgb;
    }
    for (const k of knots) {
      const mine = followed && k.t === followed && (k.item === foc || k.item === "aux");
      if (mine) k.sT = 1.2;
      else {
        k.anchorY = null;
        k.sT = k.item === "aux" ? 0 : tides.includes(k.t) ? 1 : k.t === more ? 0.6 : k.item === items.shipped ? 0.9 : 0.55;
        k.uT = k.item === "aux" ? 0.5 : k.t === ideas[0] || k.t === ideas[1] ? 0.985 : 0.99;
      }
    }
    // Column heads sit over their stage lines.
    c.host?.querySelectorAll<HTMLElement>(".wv-col").forEach((el, ix) => {
      const v = st[ix]!;
      if (phone) {
        el.style.left = "16px";
        el.style.top = `${v * H - 30}px`;
      } else {
        el.style.left = `${v * W}px`;
        el.style.top = "30px";
      }
    });
  };

  const drawThread = (V: Viz, c: CanvasRenderingContext2D, t: Thread, dt: number, rm: boolean) => {
    const a = t.alpha;
    if (a < 0.01) return;
    const S = t.s;
    const hot = hoverT === t ? 1 : 0;
    c.globalAlpha = 1;
    c.beginPath();
    c.moveTo(S[0]!, S[1]!);
    for (let m = 1; m < M; m++) c.lineTo(S[2 * m]!, S[2 * m + 1]!);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = `rgba(${t.rgb},${0.065 * a * (1 + hot)})`;
    c.lineWidth = 8;
    c.stroke();
    c.strokeStyle = `rgba(${t.rgb},${0.2 * a * (1 + hot * 0.8)})`;
    c.lineWidth = 0.8;
    c.stroke();
    const kn = knots.filter((k) => k.t === t && k.s > 0.02);
    const L = t.len;
    // The re-weave wave: a bright front running the thread's length over 1.4 s, quickening the motes it passes.
    const wv = waveT === t && wave < 1.6 ? wave / 1.4 : -1;
    if (wv >= 0) {
      const S2 = t.s;
      const m0 = Math.max(0, Math.floor((wv - 0.18) * (M - 1)));
      const m1 = Math.min(M - 1, Math.floor(wv * (M - 1)));
      if (m1 > m0) {
        c.globalAlpha = 1;
        c.beginPath();
        c.moveTo(S2[2 * m0]!, S2[2 * m0 + 1]!);
        for (let m = m0 + 1; m <= m1; m++) c.lineTo(S2[2 * m]!, S2[2 * m + 1]!);
        c.strokeStyle = `rgba(${t.rgb},${0.55 * a * (1 - Math.max(0, wv - 1) * 2.5)})`;
        c.lineWidth = 1.6;
        c.stroke();
      }
    }
    const sp1 = spr(t.rgb);
    const sprC = spr(t.hi);
    for (let i = 0; i < t.n; i++) {
      let u = t.pu[i]!;
      let offT = 0;
      let offN = 0;
      let boost = 0;
      let slow = 1;
      for (const kk of kn) {
        const wpx = kk.w * kk.s;
        const dp = (u - kk.u) * L;
        if (dp > -wpx && dp < wpx) {
          const f = 1 - Math.abs(dp) / wpx;
          slow = Math.min(slow, 1 - 0.78 * f);
          const ang = (dp / wpx) * Math.PI * 3 + time * 1.5 + t.pp[i]!;
          const rr = kk.r * kk.s * Math.pow(f, 0.55) * (1 + 0.25 * kk.hv);
          offT += Math.cos(ang) * rr * 0.75;
          offN += Math.sin(ang) * rr;
          boost = Math.max(boost, f);
        }
      }
      if (wv >= 0) {
        const dw = wv - u;
        if (dw > 0 && dw < 0.18) boost = Math.max(boost, 1 - dw / 0.18);
      }
      if (!rm) {
        u += (t.pv[i]! * slow * (1 + boost * 1.6) * dt) / L;
        if (u > 1) {
          u -= 1;
          t.po[i] = gauss();
        }
        t.pu[i] = u;
      }
      const p = t.at(u);
      const nx = -p.ty;
      const ny = p.tx;
      const jit = rm ? 0 : Math.sin(time * 1.7 + t.pp[i]! * 3) * 1.1;
      const off = t.po[i]! * t.spread * (1 - boost * 0.6) + jit * (1 - boost);
      const x = p.x + nx * (off + offN) + p.tx * offT;
      const y = p.y + ny * (off + offN) + p.ty * offT;
      const fade = sstep(0, t.fadeIn, u) * (t.head ? (u > 0.97 ? ((1 - u) / 0.03) * 0.6 + 0.4 : 1) : sstep(1, 0.94, u));
      const al = a * (0.28 + 0.72 * t.pz[i]!) * fade * (1 + boost * 0.5) * (1 + hot * 0.35);
      if (al < 0.02) continue;
      const sz = (1.5 + t.pz[i]! * 3) * (1 + boost * 0.4);
      c.globalAlpha = al > 1 ? 1 : al;
      c.drawImage(t.grad ? stageSpr(V, x, y) : t.pc[i] ? sprC : sp1, x - sz, y - sz, sz * 2, sz * 2);
    }
  };

  const drawKnot = (c: CanvasRenderingContext2D, k: Knot, dt: number) => {
    if (k.s < 0.03 || k.t.alpha < 0.05) return;
    const a = k.t.alpha;
    const s = k.s;
    const pulse = k.head ? 1 + 0.12 * Math.sin(time * 2.2) : 1;
    const R = (30 + 12 * k.hv) * s * pulse;
    const g = c.createRadialGradient(k.x, k.y, 0, k.x, k.y, R);
    g.addColorStop(0, `rgba(${k.rgb},${(0.3 + 0.2 * k.hv) * a})`);
    g.addColorStop(0.4, `rgba(${k.rgb},${(0.09 + 0.06 * k.hv) * a})`);
    g.addColorStop(1, `rgba(${k.rgb},0)`);
    c.globalAlpha = 1;
    c.fillStyle = g;
    c.beginPath();
    c.arc(k.x, k.y, R, 0, TAU);
    c.fill();
    for (const o of k.orb) {
      o.a += o.w * dt * (1 + k.hv);
      const rr = k.r * 1.25 * s * o.r * (1 + 0.3 * k.hv);
      const ca = Math.cos(o.a) * rr;
      const sa = Math.sin(o.a) * rr * 0.45;
      const ct = Math.cos(o.tl);
      const stl = Math.sin(o.tl);
      const x = k.x + ca * ct - sa * stl;
      const y = k.y + ca * stl + sa * ct;
      const sz = 1.2 + o.z * 2.2;
      c.globalAlpha = Math.min(1, (0.35 + 0.6 * o.z) * a);
      c.drawImage(o.z > 0.45 ? spr(k.rgb) : spr(WHITE), x - sz, y - sz, sz * 2, sz * 2);
    }
    c.globalAlpha = Math.min(1, 0.95 * a);
    c.drawImage(spr(WHITE), k.x - 4 * s, k.y - 4 * s, 8 * s, 8 * s);
  };

  /** Hover a thread for its item; a click on one opens it. */
  const bind = (V: Viz) => {
    if (bound === V.cv) return;
    bound = V.cv;
    const near = (x: number, y: number, lim: number) => {
      let best: Thread | null = null;
      let bd = lim;
      for (const t of threads) {
        if (t.alpha < 0.2 || !t.item) continue;
        const n = t.nearest(x, y);
        if (n.d < bd) {
          bd = n.d;
          best = t;
        }
      }
      return best;
    };
    const pos = (e: PointerEvent) => {
      const r = V.cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    V.cv.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const p = pos(e);
      const t = ctl.current.level === 0 ? near(p.x, p.y, 16) : null;
      if (t !== hoverT) {
        hoverT = t;
        ctl.current.host?.classList.toggle("is-hot", Boolean(t));
      }
    });
    V.cv.addEventListener("pointerleave", () => {
      hoverT = null;
      ctl.current.host?.classList.remove("is-hot");
    });
    V.cv.addEventListener("click", (e) => {
      if (ctl.current.level !== 0) return;
      const p = { x: e.clientX - V.cv.getBoundingClientRect().left, y: e.clientY - V.cv.getBoundingClientRect().top };
      const t = near(p.x, p.y, 18);
      if (t?.item) ctl.current.open(t.item);
    });
  };

  return {
    lay(V) {
      phone = V.W < 640;
      gx = phone ? 22 : Math.round(clamp(V.W * 0.27, 200, 380));
      ctl.current.host?.style.setProperty("--wv-gx", `${gx}px`);
      // Snap only when the stage itself changes size; opening a knot re-lays the stage and the threads flow there.
      const sz = `${V.W}x${V.H}`;
      if (sz !== size) first = true;
      size = sz;
      bind(V);
    },
    draw(V, c, _t, dt0) {
      const rm = reducedMotion();
      const dt = rm ? 0 : Math.min(0.05, dt0);
      if (!rm) time += dt;
      const snap = first || rm;
      layout(V);
      const cur = ctl.current;
      const fNow = cur.level > 0 ? cur.focus : null;
      if (fNow !== lastFoc) {
        waveT = threadOf(fNow ?? lastFoc);
        wave = snap ? 9 : 0;
        lastFoc = fNow;
      }
      wave += dt;
      const host = cur.host;
      // The open knot sits beside the details' title.
      if (cur.focus && host) {
        const tt = host.querySelector<HTMLElement>(`.wv-detail.is-open .wv-ttl`);
        const fk = knots.find((k) => k.t === threadOf(cur.focus) && (k.item === cur.focus || k.item === "aux"));
        if (tt && fk) {
          const r = V.rel(tt);
          fk.anchorY = r.y + Math.min(r.h / 2, 26);
          const n = fk.t.nearest(gxNow(), fk.anchorY);
          fk.uT = n.u;
        }
      }
      for (const t of threads) {
        t.step(dt, snap);
        t.sample();
      }
      for (const k of knots) {
        const f = snap ? 1 : Math.min(1, dt * 4);
        k.u += (k.uT - k.u) * f;
        const hov = cur.hover === k.item ? 1 : 0;
        k.s += (k.sT * (1 + 0.25 * hov) - k.s) * (snap ? 1 : Math.min(1, dt * 5));
        k.hv += (hov - k.hv) * (snap ? 1 : Math.min(1, dt * 6));
        const p = k.t.at(k.u);
        k.x = p.x;
        k.y = p.y;
        if (k.item === "aux" || !host) continue;
        const el = host.querySelector<HTMLElement>(`.wv-knot[data-item="${CSS.escape(k.item)}"]`);
        if (!el) continue;
        el.classList.toggle("is-gone", !(k.s > 0.06 && k.t.alpha > 0.15));
        const row = multi && (tides.includes(k.t) || k.t === more);
        const side = phone ? (k.t === tides[0] && !multi ? "below" : "right") : k.item === items.shipped ? "below" : "right";
        if (el.dataset.side !== side) el.dataset.side = side;
        if (side === "right" || (multi && !phone)) {
          const mw = side === "below" ? shipLabelWidth(V.W) : row && !phone ? rowLabelWidth(k.x, V.W) : Math.round(Math.max(120, Math.min(250, V.W - k.x - 38)) / 4) * 4;
          if (mw !== k.mw) {
            k.mw = mw;
            const lb = el.querySelector<HTMLElement>(".wv-kl");
            if (lb) lb.style.maxWidth = `${mw}px`;
          }
        }
        if (Math.abs(k.x - k.lx) > 0.25 || Math.abs(k.y - k.ly) > 0.25) {
          el.style.transform = `translate3d(${k.x.toFixed(1)}px,${k.y.toFixed(1)}px,0)`;
          k.lx = k.x;
          k.ly = k.y;
        }
      }
      first = false;
      // Under the threads: the four stage lines, dashed.
      const g = geo();
      const fade = cur.level > 0 ? 0.25 : 1;
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      c.lineWidth = 1;
      c.setLineDash([2, 6]);
      for (let i = 0; i < 4; i++) {
        c.strokeStyle = `rgba(${COLS[i]},${0.16 * fade})`;
        c.beginPath();
        if (phone) {
          const y = Math.round(g.st[i]! * V.H) + 0.5;
          c.moveTo(16, y);
          c.lineTo(V.W - 16, y);
        } else {
          const x = Math.round(g.st[i]! * V.W) + 0.5;
          c.moveTo(x, 96);
          c.lineTo(x, V.H - 150);
        }
        c.stroke();
      }
      c.setLineDash([]);
      c.globalCompositeOperation = "lighter";
      for (const t of threads) drawThread(V, c, t, dt, rm);
      for (const k of knots) drawKnot(c, k, dt);
      c.globalAlpha = 1;
    },
    blend: "source-over",
  };
}
