import { ARC, CODE } from "@ceo/engine/sigils/sigils.ts";
import type { Viz, VizSpec } from "@ceo/engine/sigils/wvCanvas.ts";
import { lidAt, type IrisLayout } from "./layout.ts";
import { drawMark } from "./marks.ts";

/**
 * The Iris's nanites (#666; Nikita 2026-11-04: "include some of our nanites"): the sigil glyphs Ilyr is made of (code
 * fragments and runes from @ceo/engine/sigils, never dots), drawn on the Desk's one shared canvas loop. Two streams
 * trace the eye's lids round the Council, two rune rings turn round Skippy (the pupil), glyphs run the ring from can to
 * can, and each active submind's work flows inward to him, thicker the busier its room. Under Skippy, a faint etched
 * sigil. Every glyph's place is a function of time, so a still frame (reduced motion) is as full as a moving one.
 */

export interface EyeMember {
  id: string;
  /** "r,g,b". */
  rgb: string;
  alive: boolean;
  /** 0..1, how busy its room is (roomPulse.ts). */
  activity: number;
}

export interface EyeState {
  L: IrisLayout | null;
  members: EyeMember[];
  hot: string | null;
  /** The cans aren't drawn in 3D (yet, or at all): stand-in marks on the seats. */
  marks: boolean;
  /** Where the list ends, in the canvas's pixels: the eye fades behind it. */
  listEdge: number;
  /** The stage's offset inside the canvas (the canvas runs under the list on a wide screen). */
  ox: number;
  oy: number;
}

const MONO = '"Geist Mono Variable", ui-monospace, monospace';
const ARCANE = '"Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Runic", serif';
const GLYPHS: { t: string; f: string }[] = [...CODE.map((t) => ({ t, f: MONO })), ...ARC.map((t) => ({ t, f: ARCANE }))];
const N_CODE = CODE.length;
const CELL = 32;
const SILVER = "214,218,238";
const VIOLET = "178,164,244";
const TAU = Math.PI * 2;

const atlases = new Map<string, HTMLCanvasElement>();
let fontsAsked = false;

function atlas(rgb: string): HTMLCanvasElement | null {
  const got = atlases.get(rgb);
  if (got) return got;
  if (typeof document === "undefined") return null;
  const a = document.createElement("canvas");
  a.width = CELL * GLYPHS.length;
  a.height = CELL;
  const x = a.getContext("2d");
  if (!x) return null;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = `rgb(${rgb})`;
  x.shadowColor = `rgb(${rgb})`;
  x.shadowBlur = 5;
  GLYPHS.forEach((g, i) => {
    let fs = 21;
    x.font = `500 ${fs}px ${g.f}`;
    const w = x.measureText(g.t).width;
    if (w > 26) {
      fs = Math.floor((fs * 26) / w);
      x.font = `500 ${fs}px ${g.f}`;
    }
    x.fillText(g.t, i * CELL + CELL / 2, CELL / 2 + 1);
  });
  atlases.set(rgb, a);
  return a;
}

/** The runes come in on first use: ask for them once, then redraw the sheets. */
function fontsIn(again: () => void) {
  if (fontsAsked || typeof document === "undefined" || !document.fonts) return;
  fontsAsked = true;
  void Promise.all(["Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Runic"].map((f) => document.fonts.load(`16px "${f}"`, ARC.join("")).catch(() => undefined)))
    .then(() => document.fonts.load(`16px ${MONO}`, CODE.join("")).catch(() => undefined))
    .then(() => {
      atlases.clear();
      again();
    });
}

function stamp(c: CanvasRenderingContext2D, rgb: string, gi: number, x: number, y: number, s: number, a: number) {
  if (a <= 0.01) return;
  const A = atlas(rgb);
  if (!A) return;
  c.globalAlpha = Math.min(1, a);
  c.drawImage(A, (gi % GLYPHS.length) * CELL, 0, CELL, CELL, x - s / 2, y - s / 2, s, s);
}

/** A seeded 0..1 stream, so the field is the same every layout. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface P {
  u: number;
  sp: number;
  lane: number;
  g: number;
  s: number;
  a: number;
  rgb: string;
}

interface Field {
  lids: P[][];
  rings: P[][];
  orbit: P[];
  flows: Map<string, P[]>;
}

const frac = (x: number) => x - Math.floor(x);
const runeIdx = (r: () => number) => N_CODE + Math.floor(r() * ARC.length);
const anyIdx = (r: () => number) => Math.floor(r() * GLYPHS.length);

function build(S: EyeState): Field | null {
  const L = S.L;
  if (!L) return null;
  const r = rng(616);
  const k = L.phone ? 0.5 : 1;
  const sz = L.phone ? 0.72 : 1;
  const lid = (dir: number) =>
    Array.from({ length: Math.round(240 * k) }, () => ({ u: r(), sp: dir * (0.008 + r() * 0.014), lane: (r() + r() - 1) * 9 * sz, g: anyIdx(r), s: (8 + r() * 6) * sz, a: 0.2 + r() * 0.5, rgb: r() < 0.25 ? VIOLET : SILVER }));
  const ring = (rad: number, dir: number) => {
    const n = Math.round((TAU * rad) / (L.phone ? 13 : 15));
    return Array.from({ length: n }, (_, i) => ({ u: i / n, sp: dir * 0.006, lane: rad, g: runeIdx(r), s: (9 + r() * 3) * sz, a: 0.22 + r() * 0.3, rgb: r() < 0.5 ? VIOLET : SILVER }));
  };
  const orbit = Array.from({ length: Math.round((TAU * L.r) / (L.phone ? 16 : 13)) }, () => ({ u: r(), sp: 0.01 + r() * 0.012, lane: (r() + r() - 1) * 5 * sz, g: anyIdx(r), s: (7 + r() * 5) * sz, a: 0.25 + r() * 0.4, rgb: SILVER }));
  const flows = new Map<string, P[]>();
  for (const m of S.members) {
    if (!m.alive) continue;
    const n = Math.round((5 + 16 * Math.min(1, m.activity)) * k) + 2;
    flows.set(
      m.id,
      Array.from({ length: n }, () => ({ u: r(), sp: 0.05 + r() * 0.07 + m.activity * 0.05, lane: (r() + r() - 1) * 0.12, g: anyIdx(r), s: (7 + r() * 5) * sz, a: 0.35 + r() * 0.45, rgb: m.rgb })),
    );
  }
  return { lids: [lid(1), lid(-1)], rings: [ring(L.r * 0.6, 1), ring(L.r * 0.68, -1)], orbit, flows };
}

/** The colour on the ring at angle a: the two nearest members' colours, mixed. */
function ringRgb(S: EyeState, a: number): string {
  const n = S.members.length;
  if (!n) return SILVER;
  const f = ((a / TAU) * n + n) % n;
  const i = Math.floor(f);
  const A = S.members[i]!;
  const B = S.members[(i + 1) % n]!;
  const t = f - i;
  const pa = A.rgb.split(",").map(Number);
  const pb = B.rgb.split(",").map(Number);
  return pa.map((v, j) => Math.round(v + (pb[j]! - v) * t)).join(",");
}

/** The faint sigil etched under Skippy: a ring, a triangle, an almond eye, ticks. */
function etched(c: CanvasRenderingContext2D, x: number, y: number, R: number) {
  c.save();
  c.globalAlpha = 1;
  c.strokeStyle = "rgba(196,190,255,.075)";
  c.lineWidth = 1;
  c.beginPath();
  c.arc(x, y, R, 0, TAU);
  c.stroke();
  c.beginPath();
  c.arc(x, y, R * 0.94, 0, TAU);
  c.stroke();
  c.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 3;
    const px = x + Math.cos(a) * R * 0.94;
    const py = y + Math.sin(a) * R * 0.94;
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
  c.stroke();
  c.beginPath();
  c.moveTo(x - R * 0.5, y + R * 0.12);
  c.quadraticCurveTo(x, y - R * 0.32, x + R * 0.5, y + R * 0.12);
  c.quadraticCurveTo(x, y + R * 0.52, x - R * 0.5, y + R * 0.12);
  c.stroke();
  c.beginPath();
  c.arc(x, y + R * 0.12, R * 0.13, 0, TAU);
  c.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i * TAU) / 24;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * R * 0.94, y + Math.sin(a) * R * 0.94);
    c.lineTo(x + Math.cos(a) * R * (i % 2 ? 0.98 : 1.03), y + Math.sin(a) * R * (i % 2 ? 0.98 : 1.03));
    c.stroke();
  }
  c.restore();
}

/** The eye as a VizSpec for useViz. `get` returns the live state (read every frame, never a React render). */
export function eyeSpec(get: () => EyeState): VizSpec {
  return {
    // Soft glyphs: a phone draws at a little under its screen's scale.
    scale: (W, _H, dpr) => (W < 640 ? Math.min(dpr, 1.5) : Math.min(dpr, 1.5)),
    blend: "lighter",
    lay(V: Viz) {
      fontsIn(() => V.relayout());
      V.s.field = build(get());
    },
    draw(V: Viz, c: CanvasRenderingContext2D, t: number) {
      const S = get();
      const L = S.L;
      let F = V.s.field as Field | null | undefined;
      // The members or the layout changed under it: rebuild.
      if (L && (!F || V.s.key !== `${L.w}x${L.h}:${S.members.map((m) => `${m.id}${m.alive ? 1 : 0}${m.activity.toFixed(1)}`).join()}`)) {
        F = build(S);
        V.s.field = F;
        V.s.key = `${L.w}x${L.h}:${S.members.map((m) => `${m.id}${m.alive ? 1 : 0}${m.activity.toFixed(1)}`).join()}`;
      }
      if (!L || !F) return;
      c.save();
      c.translate(S.ox, S.oy);
      const edge = S.listEdge - S.ox;
      const p: [number, number] = [0, 0];

      etched(c, L.cx, L.cy, L.r * 0.52);
      c.globalCompositeOperation = "source-over";
      // The rune rings' hairlines.
      c.strokeStyle = "rgba(190,182,255,.06)";
      c.lineWidth = 1;
      for (const rad of [0.56, 0.64, 0.72]) {
        c.beginPath();
        c.arc(L.cx, L.cy, L.r * rad, 0, TAU);
        c.stroke();
      }
      c.globalCompositeOperation = "lighter";

      // The lids.
      F.lids.forEach((lid, li) => {
        for (const q of lid) {
          const u = frac(q.u + t * q.sp);
          lidAt(L, u, li === 0, p);
          const x = p[0];
          const y = p[1] + q.lane * (li === 0 ? -1 : 1);
          let a = q.a * Math.pow(Math.sin(Math.PI * u), 0.6);
          if (x < edge) a *= 0.28;
          stamp(c, q.rgb, q.g + Math.floor(t * 0.7 + q.u * 9) * (q.u > 0.85 ? 1 : 0), x, y, q.s, a);
        }
      });

      // The rune rings round the pupil.
      for (const ring of F.rings) {
        for (const q of ring) {
          const a = (q.u + t * q.sp) * TAU;
          stamp(c, q.rgb, q.g, L.cx + Math.sin(a) * q.lane, L.cy - Math.cos(a) * q.lane, q.s, q.a);
        }
      }

      // From can to can round the ring, in the colours between them.
      const n = S.members.length || 1;
      const seatGap = (L.member * 0.42) / L.r;
      for (const q of F.orbit) {
        const a = frac(q.u + t * q.sp * 0.5) * TAU;
        const near = Math.abs(((a / TAU) * n) % 1 - 0.5) * 2; // 1 at a seat, 0 halfway
        const off = (1 - near) * TAU / n;
        const fade = Math.min(1, Math.max(0, (off - seatGap * 0.5) / (seatGap * 0.6)));
        const rad = L.r + q.lane;
        stamp(c, ringRgb(S, a), q.g, L.cx + Math.sin(a) * rad, L.cy - Math.cos(a) * rad, q.s, q.a * fade * 0.8);
      }

      // Each room's work flowing in to Skippy.
      for (const s of L.seats) {
        const flow = F.flows.get(s.id);
        if (!flow) continue;
        const lit = S.hot === s.id ? 1.8 : 1;
        const sx = s.x + (L.cx - s.x) * 0.24;
        const sy = s.y + (L.cy - s.y) * 0.24;
        const ex = L.cx + (s.x - L.cx) * 0.3;
        const ey = L.cy + (s.y - L.cy) * 0.3;
        for (const q of flow) {
          const u = frac(q.u + t * q.sp);
          // A gentle curve: the control point turned off the straight line.
          const bend = q.lane * L.r;
          const mx = (sx + ex) / 2 + Math.cos(s.a) * bend;
          const my = (sy + ey) / 2 + Math.sin(s.a) * bend;
          const iu = 1 - u;
          const x = iu * iu * sx + 2 * iu * u * mx + u * u * ex;
          const y = iu * iu * sy + 2 * iu * u * my + u * u * ey;
          const a = q.a * Math.min(1, u * 5) * Math.min(1, (1 - u) * 3) * lit;
          stamp(c, q.rgb, q.g, x, y, q.s, a);
        }
      }

      // Stand-ins for the cans, until (or unless) they draw in 3D.
      if (S.marks) {
        c.globalAlpha = 1;
        for (const s of L.seats) {
          const m = S.members.find((x) => x.id === s.id);
          if (m) drawMark(c, s.id, s.x, s.y, L.member * 0.26, m.rgb, m.alive ? 0.85 : 0.3, 1.4);
        }
      }
      c.restore();
    },
  };
}
