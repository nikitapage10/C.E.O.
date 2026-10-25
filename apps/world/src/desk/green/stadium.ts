import { bez, clamp, knot, Parts, Poly, reducedMotion, WHITE, weave, type Viz, type VizSpec } from "../wvCanvas.ts";

/**
 * The Green's stadium (#389): the week's matchup as the broadcast's field-view at night, drawn in the Desk's particle
 * lines. The field is hairlines on the dark (sidelines, goal lines, every ten yards dotted), the scoreboard sits over
 * it, and the light is the data: every starter, both teams, sends a stream of particles from his spot on the turf up
 * into his team's score, the way Today's rooms braid up into Skippy. A stream's thickness is his share of the week's
 * points (FantasyPros' projection, or what he has scored once that is more); its bright motes are the points he has
 * already scored, the dim ones what is still projected. The line of scrimmage runs across the field at the win
 * chance, a lime thread. When a poll brings new points, that player's spot flares for a moment.
 *
 * Smoothness (#401, Nikita 21:30Z "the desk is still kind of laggy"): drawn by the Desk's one shared loop (wvCanvas.ts:
 * about 40 frames a second, paused when the tab is hidden, the canvas is scrolled away or the page is gone; one still
 * frame under reduced motion). Every DOM position is read in `lay`, never in a frame; the field's lines are drawn once
 * into a layer per layout; motes are capped (about 320 on a desktop, 170 on a phone); the backing store is capped.
 */

export type Mode = "wide" | "tall";
export type TokState = "" | "sit" | "bye" | "out" | "empty";

export interface Tok {
  id: string;
  slot: string;
  pos: string;
  /** Points scored so far this week (0 before kickoff). */
  banked: number;
  /** Points FantasyPros projects for the week (or the board's projection). */
  proj: number;
  state: TokState;
}

export interface StadiumData {
  live: boolean;
  /** Win chance, 0..1; null when there is none (a bye, or nothing on the board). */
  win: number | null;
  mine: Tok[];
  theirs: Tok[];
}

/* ── geometry: one ground plane, two cameras ── */

/** Wide: the high sideline camera (length runs left to right). Tall, on a phone: the camera behind your end zone (length runs up). */
export const modeFor = (W: number): Mode => (W >= 640 ? "wide" : "tall");

interface Cam {
  top: number;
  bot: number;
  zFar: number;
  nearW: number;
}
const CAM: Record<Mode, Cam> = {
  wide: { top: 0.43, bot: 0.975, zFar: 1.62, nearW: 1.04 },
  tall: { top: 0.075, bot: 0.985, zFar: 1.55, nearW: 0.98 },
};

/** Length 0..1 runs from your end line to theirs; across 0..1 runs far sideline to near (wide) or left to right (tall). */
export interface Spot {
  /** Position as a share of the canvas's width and height. */
  x: number;
  y: number;
  /** Perspective scale: 1 at the near edge, smaller farther away. */
  s: number;
}

/** Where a spot on the ground lands on screen, as shares of the canvas (so DOM tokens and the canvas agree). */
export function place(mode: Mode, along: number, across: number): Spot {
  const k = CAM[mode];
  const C = (k.bot - k.top) / (1 - 1 / k.zFar);
  const yH = k.bot - C;
  if (mode === "wide") {
    const z = k.zFar + (1 - k.zFar) * across;
    return { x: 0.5 + ((along - 0.5) * k.nearW) / z, y: yH + C / z, s: 1 / z };
  }
  const z = 1 + (k.zFar - 1) * along;
  return { x: 0.5 + ((across - 0.5) * k.nearW) / z, y: yH + C / z, s: 1 / z };
}

/** A yard line (0 = your goal line, 100 = theirs) as a share of the field's length, end zones included. */
export const yardAt = (yd: number) => (10 + clamp(yd, 0, 100)) / 120;

/* ── the formation ── */

/** Which line a starter stands on: 0 at the line of scrimmage, 3 deepest. */
export function rank(pos: string, slot: string): number {
  if (pos === "WR" || pos === "TE") return 0;
  if (pos === "QB" || /FLEX/.test(slot)) return 1;
  if (pos === "RB") return 2;
  return 3;
}

/** Each starter's spot on his own half: lines from the line of scrimmage back, spread evenly across the field. */
export function formation(toks: readonly Pick<Tok, "pos" | "slot">[], side: "mine" | "theirs"): { along: number; across: number }[] {
  const lines = new Map<number, number[]>();
  toks.forEach((t, i) => {
    const r = rank(t.pos, t.slot);
    lines.set(r, [...(lines.get(r) ?? []), i]);
  });
  const used = [...lines.keys()].sort((a, b) => a - b);
  const out: { along: number; across: number }[] = toks.map(() => ({ along: 0, across: 0 }));
  const gap = used.length > 1 ? Math.min(0.13, 0.36 / (used.length - 1)) : 0;
  used.forEach((r, li) => {
    const at = 0.43 - li * gap;
    const members = lines.get(r)!;
    members.forEach((idx, j) => {
      const across = 0.14 + ((j + 0.5) / members.length) * 0.74;
      // Stagger every other man a touch so a crowded line doesn't read as a ruler.
      const along = at - (members.length > 2 && j % 2 ? 0.026 : 0);
      out[idx] = { along: side === "mine" ? along : 1 - along, across };
    });
  });
  return out;
}

/** A light budget split by value with largest remainders: never more than `cap` in all, and zero for zero. */
export function share(values: readonly number[], cap: number): number[] {
  const tot = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (tot <= 0 || cap <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / tot) * cap);
  const base = raw.map(Math.floor);
  let left = cap - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    base[i]! += 1;
    left--;
  }
  return base;
}

/** How many motes a week's points earn: about four per point, capped for the screen. */
export const budget = (points: number, mode: Mode) => Math.min(mode === "wide" ? 320 : 170, Math.round(Math.max(0, points) * 4));

/* ── the stage ── */

const LIME = "201,242,107";
const LIME_D = "150,180,92";
const COOL = "176,186,204";
/** The most backing pixels a frame draws: soft light, so the browser can scale it up (as Today does, #413). */
const BACKING_PX = 320_000;

export interface StadiumState {
  data: StadiumData | null;
}

interface Stream {
  mine: boolean;
  poly: Poly;
  P: Parts;
  v: number;
  ax: number;
  ay: number;
  s: number;
  id: string;
}

/**
 * The stadium's canvas spec for useViz. `root` is the stage: the pitch is `[data-gd-pitch]` inside it, the scores
 * `[data-gd-score="me"]` and `[data-gd-score="them"]`. Swap `S.data` and call relayout when the data changes.
 */
export function makeStadium(root: () => HTMLElement | null, S: StadiumState): VizSpec {
  let streams: Stream[] = [];
  let los: Poly | null = null;
  let losP: Parts | null = null;
  let last: Map<string, number> | null = null;
  const flares = new Map<string, { x: number; y: number; s: number; at: number; k: number }>();
  let clock = 0;

  // The field's lines go on their own still canvas under the moving one, drawn only when laid out.
  const paintField = (L: HTMLCanvasElement, V: Viz, mode: Mode, rx: number, ry: number, rw: number, rh: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    L.width = Math.max(1, Math.round(V.W * dpr));
    L.height = Math.max(1, Math.round(V.H * dpr));
    const c = L.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, V.W, V.H);
    const at = (u: number, v: number) => {
      const p = place(mode, u, v);
      return [rx + p.x * rw, ry + p.y * rh] as const;
    };
    const seg = (u0: number, v0: number, u1: number, v1: number) => {
      const [x0, y0] = at(u0, v0);
      const [x1, y1] = at(u1, v1);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    };
    // Your end zone: the faintest wash of the accent.
    const [a0, b0] = at(0, 0);
    const [a1, b1] = at(yardAt(0), 0);
    const [a2, b2] = at(yardAt(0), 1);
    const [a3, b3] = at(0, 1);
    c.fillStyle = `rgba(${LIME},.045)`;
    c.beginPath();
    c.moveTo(a0, b0);
    c.lineTo(a1, b1);
    c.lineTo(a2, b2);
    c.lineTo(a3, b3);
    c.closePath();
    c.fill();
    c.lineWidth = 1;
    // Every ten yards a dotted hairline, the way Today draws what hasn't happened yet.
    c.setLineDash([1.2, 4]);
    for (let yd = 10; yd < 100; yd += 10) {
      c.strokeStyle = `rgba(${WHITE},${yd === 50 ? 0.3 : 0.17})`;
      seg(yardAt(yd), 0, yardAt(yd), 1);
    }
    c.setLineDash([]);
    // Goal lines and the field's edge as solid hairlines.
    c.strokeStyle = `rgba(${WHITE},.2)`;
    seg(yardAt(0), 0, yardAt(0), 1);
    seg(yardAt(100), 0, yardAt(100), 1);
    c.strokeStyle = `rgba(${WHITE},.14)`;
    seg(0, 0, 1, 0);
    seg(0, 1, 1, 1);
    seg(0, 0, 0, 1);
    seg(1, 0, 1, 1);
    // Yard numbers along the near side, small and quiet.
    c.fillStyle = `rgba(${WHITE},.16)`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let yd = 10; yd < 100; yd += 10) {
      const n = yd <= 50 ? yd : 100 - yd;
      const p = place(mode, yardAt(yd), mode === "wide" ? 0.94 : 0.06);
      const size = Math.round((mode === "wide" ? 15 : 11) * p.s);
      c.font = `400 ${size}px "Jost Variable", Jost, sans-serif`;
      c.save();
      c.translate(rx + p.x * rw, ry + p.y * rh);
      if (mode === "tall") c.rotate(-Math.PI / 2);
      c.fillText(String(n), 0, 0);
      c.restore();
    }
  };

  return {
    scale: (W, H, dpr) => Math.min(dpr, Math.sqrt(BACKING_PX / Math.max(1, W * H))),
    lay(V) {
      const el = root();
      const pitch = el?.querySelector("[data-gd-pitch]");
      if (!el || !pitch) return;
      const mode = modeFor(V.W);
      const r = V.rel(pitch);
      const d = S.data;
      const field = el.querySelector<HTMLCanvasElement>("canvas[data-gd-field]");
      if (field) paintField(field, V, mode, r.x, r.y, r.w, r.h);
      streams = [];
      los = null;
      losP = null;
      if (!d) return;
      const target = (who: "me" | "them") => {
        const t = el.querySelector(`[data-gd-score="${who}"]`);
        if (!t) return null;
        const q = V.rel(t);
        return { x: q.x + q.w / 2, y: q.y + q.h * 0.92, w: q.w };
      };
      const tMe = target("me");
      const tThem = target("them");
      const toks = [...d.mine, ...d.theirs];
      const spots = [...formation(d.mine, "mine"), ...formation(d.theirs, "theirs")];
      const off = (t: Tok) => t.state === "bye" || t.state === "out" || t.state === "empty";
      const vals = toks.map((t) => (off(t) ? 0 : Math.max(t.proj, t.banked)));
      const counts = share(vals, budget(vals.reduce((a, b) => a + b, 0), mode));
      const now = new Map<string, number>();
      toks.forEach((t, i) => {
        const mine = i < d.mine.length;
        const p = place(mode, spots[i]!.along, spots[i]!.across);
        const ax = r.x + p.x * r.w;
        const ay = r.y + p.y * r.h;
        now.set(t.id, t.banked);
        const was = last?.get(t.id);
        if (was !== undefined && t.banked - was > 0.05) flares.set(t.id, { x: ax, y: ay, s: p.s, at: clock, k: Math.min(1, 0.4 + (t.banked - was) / 10) });
        const tg = mine ? tMe : tThem;
        const n = counts[i]!;
        if (!tg || n < 1) return;
        // A curve up from the man to his team's score: rising off the turf, then bending in under the number.
        const tx = tg.x + ((i % 5) - 2) * tg.w * 0.06;
        const ty = tg.y;
        const xs: number[] = [];
        const ys: number[] = [];
        const lift = Math.max(40, (ay - ty) * 0.5);
        bez(ax, ay - 6 * p.s, ax + (tx - ax) * 0.08, ay - lift, tx + (ax - tx) * 0.25, ty + Math.max(30, (ay - ty) * 0.35), tx, ty, 28, xs, ys);
        const hi = t.banked > 0 ? clamp(t.banked / Math.max(t.proj, t.banked), 0, 1) : 0;
        streams.push({ mine, poly: new Poly().set(xs, ys), P: new Parts(n, hi), v: mine ? 30 : 22, ax, ay, s: p.s, id: t.id });
      });
      last = now;
      if (d.win !== null) {
        const u = yardAt(d.win * 100);
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k <= 16; k++) {
          const p = place(mode, u, k / 16);
          xs.push(r.x + p.x * r.w);
          ys.push(r.y + p.y * r.h);
        }
        los = new Poly().set(xs, ys);
        losP = new Parts(mode === "wide" ? 46 : 28, 0.3);
      }
    },
    draw(V, c, t, dt) {
      clock = t;
      if (los && losP) {
        weave(c, los, losP, { a: 0.85, sp: 1.2, sz: 0.9, v: 18, rgb: LIME, rgb2: "236,250,210", line: 0.55, lw: 1.2, nofade: true }, t, dt);
      }
      for (const s of streams) {
        weave(
          c,
          s.poly,
          s.P,
          s.mine
            ? { a: 1, sp: 2.4, sz: 1.1, v: s.v, rgb: LIME_D, rgb2: LIME, line: 0.16, lw: 0.8 }
            : { a: 0.65, sp: 2, sz: 0.9, v: s.v, rgb: COOL, rgb2: WHITE, line: 0.09, lw: 0.7 },
          t,
          dt,
        );
      }
      for (const [id, f] of flares) {
        const age = t - f.at;
        if (age > 2.6 || reducedMotion()) {
          flares.delete(id);
          continue;
        }
        knot(c, f.x, f.y, 1.4 * f.s, t, LIME, f.k * (1 - age / 2.6));
      }
    },
  };
}
