import type { RoomPulse } from "../roomPulse.ts";
import { clamp, frac, gauss, lerp, Parts, Poly, RC, reducedMotion, smoothPts, spr, sstep, TAU, weave, WHITE, type Viz, type VizSpec } from "../wvCanvas.ts";
import { Being } from "./beings.ts";
import { RISES } from "./sand.ts";
import { Motes, NEAR } from "./batch.ts";

const MOTES = new Motes();

/**
 * Today's stage (#413, round 9's Confluence, Nikita's pick): one canvas under the whole top of the page. The Council
 * stands along the bottom, each submind a figure of its own threads; its room's real work leaves it as a stream that
 * climbs, merges with its neighbours' and braids into one current running up into Skippy. Today's real moments ride
 * each stream as knots, older ones further up. Whatever waits on Nikita circles in an eddy beside its stream, a dotted
 * lead running out to its line in "Held for you". Around Skippy, faint as a chart's rings, Ilyr's day: 24 ticks and
 * the hour now. Rooms not set up yet keep a thin dashed stream with a few motes and no knots.
 *
 * Performance (Nikita 21:34Z, "the Desk is still laggy"): the Desk's one shared loop draws it (wvCanvas.ts, about 40
 * frames a second, paused when the tab is hidden or the page is gone, devicePixelRatio capped at 2, one still frame
 * under reduced motion). Every DOM position is read in `lay` (on resize or when the page asks), never in a frame;
 * the frame reads only this module's own numbers, and nothing in it touches React. Particle counts are capped.
 */

export const GOLD = "232,207,156";
const HOTC = "242,201,143";

export interface StageState {
  pulses: RoomPulse[];
  /** Rooms with something held for Nikita. */
  needs: Set<string>;
  /** The open figure ("kernel" for Skippy), and the one pointed at. */
  sel: string | null;
  hot: string | null;
  now: number;
  /** Where the streams' knots start: the day's strip. */
  since: number;
  /** Mountain hour now, 0..24. */
  hour: number;
}

interface Stream {
  id: string;
  rgb: string;
  real: boolean;
  poly: Poly;
  P: Parts;
  v: number;
  sp: number;
  knots: number[];
}
interface Eddy {
  id: string;
  rgb: string;
  cx: number;
  cy: number;
  poly: Poly;
  P: Parts;
  lead: Poly;
  LP: Parts;
}

const G1 = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]];
const G2 = [[0, 1], [2, 3, 4]];
/** Caps, so a laptop stays smooth whatever the day brings. */
const STREAM_MAX = 300;
const STREAM_MIN = 26;
/**
 * The most backing pixels the stage draws into a frame. It is a soft field of light over the whole top of the page, so
 * it draws at up to this many pixels and lets the browser scale it up (on a laptop a little under its own size; on a
 * Retina screen not double, which would quadruple the work).
 */
const BACKING_PX = 900_000;

/** The Desk's dark (wv.css --wv-bg, a shade deeper), and a fixed scatter of faint stars: x, y (0..1), alpha. */
const BG = "#0a0b0f";
const STARS = Array.from({ length: 140 * 3 }, (_, i) => (i % 3 === 2 ? 0.15 + 0.45 * Math.random() ** 2 : Math.random()));

export function makeStage(root: () => HTMLElement | null, S: StageState): { spec: VizSpec; beings: Map<string, Being> } {
  const beings = new Map<string, Being>();
  let streams: Stream[] = [];
  let eddies: Eddy[] = [];
  let sk: Being | null = null;
  let order: Being[] = [];
  let built = "";
  let phone = false;
  let W = 0;
  let H = 0;
  let laid = 0;
  let stillKey = "";
  let layer: HTMLCanvasElement | null = null;
  // Each figure's alpha, eased toward its target in the frame (no React).
  const fade = new Map<string, number>();

  const build = () => {
    const key = `${S.pulses.map((p) => `${p.id}:${p.real ? 1 : 0}:${Math.round(p.activity * 10)}`).join("|")}|${phone ? 1 : 0}`;
    if (key === built) return;
    built = key;
    const dens = phone ? 0.45 : 0.62;
    const keep = new Map(beings);
    beings.clear();
    const mk = (id: string, rgb: string, act: number, i: number) => {
      const old = keep.get(id);
      const b = new Being(id, rgb, act, dens, frac(i * 0.381 + 0.17));
      if (old) {
        b.m = old.m;
        b.want = old.want;
        b.hold = old.hold;
      }
      beings.set(id, b);
      return b;
    };
    sk = mk("kernel", GOLD, 1, 0);
    order = S.pulses.map((p, i) => mk(p.id, RC[p.id] ?? WHITE, p.real ? p.activity : 0.08, i + 1));
    streams = S.pulses.map((p) => {
      const n = p.real ? Math.round(clamp(60 + p.activity * 300, STREAM_MIN, STREAM_MAX) * (phone ? 0.5 : 1)) : 18;
      return { id: p.id, rgb: RC[p.id] ?? WHITE, real: p.real, poly: new Poly(), P: new Parts(n, 0.07), v: p.real ? 34 + p.activity * 70 : 16, sp: p.real ? 2 + p.activity * 3 : 1.2, knots: [] };
    });
  };

  const lay = (V: Viz) => {
    const el = root();
    if (!el) return;
    laid++;
    W = V.W;
    H = V.H;
    phone = V.W < 760;
    build();
    if (V.s.open === undefined) V.s.open = reducedMotion() ? 1 : 0;
    // Skippy, at his anchor.
    const ska = el.querySelector("[data-cf-sk]");
    if (sk && ska) {
      const r = V.rel(ska);
      sk.x = r.x + r.w / 2;
      sk.y = r.y + r.h / 2;
      sk.r = Math.min(r.w, r.h) * 0.42;
    }
    // The Council, at their marks.
    for (const b of order) {
      const m = el.querySelector(`[data-cf-mark="${b.id}"]`);
      if (!m) continue;
      const r = V.rel(m);
      b.x = r.x + r.w / 2;
      b.y = r.y + r.h / 2;
      const p = S.pulses.find((x) => x.id === b.id);
      const base = Math.min(r.w, r.h) * 0.42;
      b.r = base * (0.72 + 0.28 * (p?.real ? clamp(p.activity, 0, 1) : 0));
    }
    if (!sk) return;
    const skX = sk.x;
    const skY = sk.y + sk.r * 0.9;
    const baseY = order.length ? Math.min(...order.map((b) => b.y)) : V.H;
    const span = baseY - skY;
    const l1 = baseY - span * 0.26;
    const l2 = baseY - span * 0.55;
    const jY = skY + span * 0.2;
    const xs = order.map((b) => b.x);
    const n1 = G1.map((g) => {
      const x = g.reduce((a, i) => a + (xs[i] ?? skX), 0) / g.length;
      return [x, l1] as const;
    });
    const n2 = G2.map((g) => [lerp(g.reduce((a, i) => a + n1[i]![0], 0) / g.length, skX, 0.35), l2] as const);
    streams.forEach((T, i) => {
      const b = order[i];
      if (!b) return;
      const g1 = G1.findIndex((g) => g.includes(i));
      const g2 = G2.findIndex((g) => g.includes(g1));
      const px = [b.x, n1[g1]![0], n2[g2]![0], skX, skX];
      const py = [b.y - b.r * 0.6, n1[g1]![1], n2[g2]![1], jY, skY];
      const [sx, sy] = smoothPts(px, py, 26);
      T.poly.set(sx, sy);
      const p = S.pulses[i]!;
      const strip = Math.max(1, S.now - S.since);
      T.knots = p.real ? p.events.filter((t) => t >= S.since && t <= S.now).slice(-6).map((t) => 0.06 + 0.86 * ((S.now - t) / strip)) : [];
    });
    // Eddies, for what waits on Nikita, each with its lead out to its line in Held for you.
    const held = el.querySelector("[data-cf-held]");
    const rows = held ? [...held.querySelectorAll<HTMLElement>("li.td-ni[data-room]:not(.is-fyi)")] : [];
    const prev = new Map(eddies.map((e) => [e.id, e]));
    eddies = [];
    const done = new Set<string>();
    for (const row of rows) {
      const id = row.dataset.room!;
      const k = S.pulses.findIndex((p) => p.id === id);
      if (k < 0 || done.has(id)) continue;
      done.add(id);
      const T = streams[k]!;
      const at = T.poly.at(0.24);
      const side = at.x < skX ? -1 : 1;
      const cx = at.x + side * (phone ? 20 : 32);
      const cy = at.y;
      const rx = phone ? 13 : 22;
      const ry = phone ? 7 : 12;
      const ex: number[] = [];
      const ey: number[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU;
        ex.push(cx + rx * Math.cos(a));
        ey.push(cy + ry * Math.sin(a));
      }
      const old = prev.get(id);
      const E: Eddy = { id, rgb: T.rgb, cx, cy, poly: new Poly().set(ex, ey), P: old?.P ?? new Parts(phone ? 50 : 80, 0.25), lead: new Poly(), LP: old?.LP ?? new Parts(phone ? 0 : 28) };
      if (!phone) {
        const r = V.rel(row);
        const tx = r.x - 6;
        const ty = r.y + Math.min(r.h, 72) / 2;
        const lx: number[] = [];
        const ly: number[] = [];
        for (let i = 0; i < 40; i++) {
          const u = i / 39;
          const v = 1 - u;
          const mx = lerp(cx, tx, 0.5);
          lx.push(v * v * v * cx + 3 * v * v * u * mx + 3 * v * u * u * mx + u * u * u * tx);
          ly.push(v * v * v * cy + 3 * v * v * u * cy + 3 * v * u * u * ty + u * u * u * ty);
        }
        E.lead.set(lx, ly);
      }
      eddies.push(E);
    }
  };

  const ease = (id: string, target: number, dt: number) => {
    const v = fade.get(id) ?? target;
    const nv = dt ? v + (target - v) * (1 - Math.exp(-dt * 5)) : target;
    fade.set(id, nv);
    return nv;
  };

  /** The lines that only move when the layout or the focus does. */
  const still = (c: CanvasRenderingContext2D, grow: number, on: (id: string) => boolean) => {
    if (!sk) return;
    // The stage's own night (it is opaque, so the sky under it is neither drawn nor blended here): the Desk's dark,
    // Skippy's light spilling down from the top, and a still dust of stars.
    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(sk.x, 0, 0, sk.x, 0, Math.max(W, H) * 0.6);
    g.addColorStop(0, `rgba(${GOLD},.075)`);
    g.addColorStop(1, `rgba(${GOLD},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(236,238,243,.5)";
    for (let i = 0; i < STARS.length; i += 3) {
      c.globalAlpha = STARS[i + 2]!;
      c.fillRect(STARS[i]! * W, STARS[i + 1]! * H, 1, 1);
    }
    c.globalAlpha = 1;
    const R = sk.r * (phone ? 1.75 : 1.95);
    c.lineWidth = 1;
    c.strokeStyle = `rgba(${GOLD},.07)`;
    c.beginPath();
    c.arc(sk.x, sk.y, R, 0, TAU);
    c.stroke();
    c.strokeStyle = `rgba(${GOLD},.05)`;
    c.beginPath();
    c.arc(sk.x, sk.y, R * 1.32, 0, TAU);
    c.stroke();
    const a0 = -Math.PI / 2;
    c.strokeStyle = `rgba(${GOLD},.16)`;
    c.beginPath();
    for (let h = 0; h < 24; h++) {
      const a = a0 + (h / 24) * TAU;
      const k = h % 6 === 0 ? 7 : 3;
      c.moveTo(sk.x + Math.cos(a) * R, sk.y + Math.sin(a) * R);
      c.lineTo(sk.x + Math.cos(a) * (R + k), sk.y + Math.sin(a) * (R + k));
    }
    c.stroke();
    // The day so far, lit along the inner ring.
    c.strokeStyle = `rgba(${GOLD},.22)`;
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(sk.x, sk.y, R, a0, a0 + (S.hour / 24) * TAU);
    c.stroke();
    c.lineWidth = 0.8;
    for (const T of streams) {
      if (T.poly.n < 2) continue;
      c.strokeStyle = `rgba(${T.rgb},${(T.real ? 0.07 : 0.05) + (on(T.id) ? 0.08 : 0.008)})`;
      if (!T.real) c.setLineDash([2, 6]);
      T.poly.stroke(c, Math.min(1, grow * 1.4));
      if (!T.real) c.setLineDash([]);
    }
  };

  const draw = (V: Viz, c: CanvasRenderingContext2D, t: number, dt: number) => {
    if (!sk) return;
    const sel = S.sel;
    const focus = sel ?? S.hot;
    const on = (id: string) => !focus || focus === id || focus === "kernel";

    // The still lines (Ilyr's day around Skippy, the streams' beds): drawn once into a layer and laid down each frame,
    // redrawn only when the layout or the focus changes. While the streams are still growing in, drawn live.
    const open = V.s.open as number | undefined;
    const grow = open === undefined ? 1 : open;
    if (open !== undefined && open < 1 && dt) V.s.open = Math.min(1, open + dt / 2.2);
    c.globalCompositeOperation = "source-over";
    if (grow < 1) still(c, grow, on);
    else {
      const key = `${laid}|${focus ?? ""}|${V.cv.width}x${V.cv.height}`;
      if (key !== stillKey) {
        stillKey = key;
        layer ??= document.createElement("canvas");
        layer.width = V.cv.width;
        layer.height = V.cv.height;
        const g = layer.getContext("2d");
        if (g) {
          g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
          g.clearRect(0, 0, V.W, V.H);
          still(g, 1, on);
        }
      }
      c.drawImage(layer!, 0, 0, V.W, V.H);
    }
    c.globalCompositeOperation = "lighter";
    {
      const R = sk.r * (phone ? 1.75 : 1.95);
      const a0 = -Math.PI / 2;
      const ah = a0 + (S.hour / 24) * TAU;
      c.globalAlpha = 0.9;
      c.drawImage(spr(GOLD), sk.x + Math.cos(ah) * R - 7, sk.y + Math.sin(ah) * R - 7, 14, 14);
      c.drawImage(spr(WHITE), sk.x + Math.cos(ah) * R - 2.5, sk.y + Math.sin(ah) * R - 2.5, 5, 5);
      c.globalAlpha = 1;
    }

    // The streams.
    for (const T of streams) {
      const fa = ease(`s:${T.id}`, on(T.id) ? 1 : 0.1, dt);
      const P = T.P;
      const poly = T.poly;
      if (poly.n < 2) continue;
      const L = poly.len;
      const sp = spr(T.rgb);
      const sw = spr(WHITE);
      for (let k = 0; k < P.n; k++) {
        let u = P.u[k]!;
        if (dt) {
          u += (P.v[k]! * T.v * dt) / L;
          if (u > 1) {
            u -= 1;
            P.o[k] = gauss();
          }
          P.u[k] = u;
        }
        if (u > grow * 1.4) continue;
        const z = P.z[k]!;
        const edge = sstep(0, 0.05, u) * (1 - 0.55 * sstep(0.9, 1, u));
        const al = fa * (0.25 + 0.75 * z) * edge * (T.real ? 1 : 0.5);
        if (al < 0.03) continue;
        const p = poly.at(u);
        const w = T.sp * (1 + 3 * sstep(0.5, 0.85, u)) * (0.5 + 0.5 * z);
        const off = P.o[k]! * w + Math.sin(t * 1.6 + P.p[k]! * 5) * 1.2;
        const sz = (0.8 + z * 2) * (1 + 0.35 * sstep(0.5, 0.9, u));
        const x = p.x - p.ty * off;
        const y = p.y + p.tx * off;
        if (z < NEAR && !P.c[k]) {
          if (edge > 0.5) MOTES.add(x, y, sz, z > 0.2);
          continue;
        }
        c.globalAlpha = al;
        c.drawImage(P.c[k] ? sw : sp, x - sz, y - sz, sz * 2, sz * 2);
      }
      MOTES.flush(c, T.rgb, fa * (T.real ? 1 : 0.5));
      // Today's real moments, riding the stream.
      for (const u of T.knots) {
        const q = poly.at(u);
        const big = sel === T.id;
        c.globalAlpha = (big ? 0.9 : 0.5) * fa;
        const r = big ? 13 : 8;
        c.drawImage(sp, q.x - r, q.y - r, r * 2, r * 2);
        c.globalAlpha = Math.min(1, (big ? 1 : 0.7) * fa);
        c.drawImage(sw, q.x - 2.2, q.y - 2.2, 4.4, 4.4);
      }
    }
    c.globalAlpha = 1;

    // The eddies, and their leads out to Held for you.
    for (const E of eddies) {
      const fa = ease(`e:${E.id}`, on(E.id) ? 1 : 0.12, dt);
      weave(c, E.poly, E.P, { a: 0.95 * fa, sp: 2.4, sz: 0.85, v: 38, rgb: E.rgb, rgb2: HOTC, line: 0.25 * fa, nofade: true, jit: 0.8 }, t, dt);
      if (E.lead.n > 1 && !sel) {
        c.strokeStyle = `rgba(${HOTC},${0.14 * fa})`;
        c.setLineDash([2, 4]);
        c.lineWidth = 0.8;
        E.lead.stroke(c);
        c.setLineDash([]);
        weave(c, E.lead, E.LP, { a: 0.75 * fa, sp: 0.6, sz: 0.6, v: 30, rgb: HOTC }, t, dt);
      }
      c.globalAlpha = 0.5 * fa;
      c.drawImage(spr(HOTC), E.cx - 16, E.cy - 16, 32, 32);
      c.globalAlpha = 1;
    }

    // The Council, and Skippy at the river's end.
    sk.a = ease("b:kernel", 1, dt);
    sk.hl = sel === "kernel" ? 0.6 : S.hot === "kernel" ? 0.3 : 0;
    sk.draw(c, t, dt);
    for (const b of order) {
      b.a = ease(`b:${b.id}`, on(b.id) ? 1 : 0.22, dt);
      b.hl = sel === b.id ? 0.6 : S.hot === b.id ? 0.3 : 0;
      b.draw(c, t, dt);
      if (S.needs.has(b.id)) b.need(c, t, HOTC);
    }

    // Words rising off whoever spoke, crumbling into sand.
    RISES.draw(c, t, dt, (room) => {
      const b = room === "kernel" ? sk : beings.get(room);
      return b ? { x: b.x, y: b.top(), W } : null;
    });
  };

  return {
    spec: { lay, draw, blend: "lighter", scale: (w, h, dpr) => Math.min(dpr, Math.sqrt(BACKING_PX / Math.max(1, w * h))), opaque: true },
    beings,
  };
}
