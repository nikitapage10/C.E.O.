import { mixRgb, reducedMotion, spr } from "../wvCanvas.ts";

/**
 * Words that rise and fall as sand (#413, Nikita 2026-10-24 21:30Z: "anytime they talk, anytime something happens,
 * there'd be little text that goes up in the air and fizzles out into sand"). A submind's short line rises off the top
 * of its figure, holds a moment, then crumbles left to right into grains that fall and fade. Lines come only from real
 * events (desk/confluence/rise.ts says which), and the field keeps them lively but never noisy: one new line every
 * 1.4 s at most, one per figure every 6 s, four in the air at once, eight waiting. Drawn on Today's one canvas; with
 * reduced motion nothing rises.
 */

export interface RiseLine {
  /** The figure it rises from: a room id, or "kernel" for Skippy. */
  room: string;
  text: string;
  /** "r,g,b". */
  rgb: string;
}

interface Live extends RiseLine {
  t0: number;
  w: number;
  h: number;
  /** The grains: home offset in the line (gx, gy), then where each one is once it falls. */
  gx: Float32Array;
  gy: Float32Array;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  rel: Float32Array;
  n: number;
  fill: string;
  sand: string;
  /** Where it set out from, fixed at the start so a re-layout doesn't jerk it. */
  ox: number;
  oy: number;
  lift: number;
}

const GAP = 1.4;
const PER_ROOM = 6;
const MAX_AIR = 4;
const MAX_WAIT = 8;
const RISE = 2.2;
const SWEEP = 0.9;
const FALL = 1.5;
const MAX_GRAINS = 650;
export const RISE_FONT = '500 16px "Jost Variable", Jost, Futura, system-ui, sans-serif';

let scratch: HTMLCanvasElement | null = null;

/** The line's pixels, as grains. */
function grains(text: string): { w: number; h: number; gx: Float32Array; gy: Float32Array; n: number } {
  scratch ??= document.createElement("canvas");
  const g = scratch.getContext("2d", { willReadFrequently: true });
  const h = 24;
  if (!g) return { w: 0, h, gx: new Float32Array(0), gy: new Float32Array(0), n: 0 };
  g.font = RISE_FONT;
  const w = Math.ceil(g.measureText(text).width) + 4;
  scratch.width = w;
  scratch.height = h;
  g.font = RISE_FONT;
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(text, 2, h / 2);
  const px = g.getImageData(0, 0, w, h).data;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]! > 120) {
    xs.push(x);
    ys.push(y);
  }
  // Too many for a long line: keep an even sample.
  const keep = Math.min(MAX_GRAINS, xs.length);
  const step = xs.length / Math.max(1, keep);
  const gx = new Float32Array(keep);
  const gy = new Float32Array(keep);
  for (let i = 0; i < keep; i++) {
    const k = Math.floor(i * step);
    gx[i] = xs[k]!;
    gy[i] = ys[k]!;
  }
  return { w, h, gx, gy, n: keep };
}

export class RiseField {
  private wait: RiseLine[] = [];
  private air: Live[] = [];
  private last = -1e9;
  private lastBy = new Map<string, number>();
  /** Called when a line sets off, so the page can light that figure for a moment. */
  onStart: ((room: string) => void) | null = null;

  push(line: RiseLine) {
    if (reducedMotion() || !line.text.trim()) return;
    // The same words already waiting for the same figure are said once.
    if (this.wait.some((w) => w.room === line.room && w.text === line.text)) return;
    this.wait.push(line);
    if (this.wait.length > MAX_WAIT) this.wait.shift();
  }

  get busy() {
    return this.air.length > 0 || this.wait.length > 0;
  }

  private start(t: number, at: (room: string) => { x: number; y: number; W: number } | null) {
    if (t - this.last < GAP || this.air.length >= MAX_AIR) return;
    const k = this.wait.findIndex((l) => t - (this.lastBy.get(l.room) ?? -1e9) >= PER_ROOM && at(l.room));
    if (k < 0) return;
    const line = this.wait.splice(k, 1)[0]!;
    const pos = at(line.room)!;
    const g = grains(line.text);
    if (!g.n) return;
    const n = g.n;
    const live: Live = {
      ...line,
      t0: t,
      ...g,
      x: new Float32Array(n),
      y: new Float32Array(n),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      rel: new Float32Array(n),
      fill: `rgba(${mixRgb(line.rgb, "255,246,230", 0.55)},1)`,
      sand: `rgb(${mixRgb(line.rgb, "255,214,160", 0.5)})`,
      ox: Math.max(8 + g.w / 2, Math.min(pos.W - 8 - g.w / 2, pos.x)),
      oy: pos.y,
      // A second line over the same figure rises past the first.
      lift: this.air.filter((a) => a.room === line.room).length * 26,
    };
    for (let i = 0; i < n; i++) {
      live.rel[i] = RISE + (g.gx[i]! / g.w) * SWEEP + Math.random() * 0.25;
      live.vx[i] = (Math.random() - 0.35) * 22;
      live.vy[i] = -8 - Math.random() * 18;
    }
    this.air.push(live);
    this.last = t;
    this.lastBy.set(line.room, t);
    this.onStart?.(line.room);
  }

  /** Draw what is in the air; `at` says where a figure's words rise from (null when it isn't on the page). */
  draw(c: CanvasRenderingContext2D, t: number, dt: number, at: (room: string) => { x: number; y: number; W: number } | null) {
    if (!dt) return;
    this.start(t, at);
    if (!this.air.length) return;
    c.globalCompositeOperation = "source-over";
    for (let k = this.air.length - 1; k >= 0; k--) {
      const L = this.air[k]!;
      const age = t - L.t0;
      if (age > RISE + SWEEP + 0.25 + FALL) {
        this.air.splice(k, 1);
        continue;
      }
      // Rising: eased up about 64 px, fading in.
      const up = 64 * (1 - Math.pow(1 - Math.min(1, age / (RISE + SWEEP)), 3)) + L.lift;
      const left = L.ox - L.w / 2;
      const top = L.oy - 20 - up - L.h / 2;
      if (age < RISE) {
        c.globalAlpha = Math.min(1, age / 0.35);
        c.font = RISE_FONT;
        c.textBaseline = "middle";
        c.textAlign = "left";
        // A soft halo in the speaker's colour behind the words (a sprite: canvas shadows cost far more a frame).
        c.globalCompositeOperation = "lighter";
        c.globalAlpha *= 0.35;
        c.drawImage(spr(L.rgb), left - 14, top - 10, L.w + 28, L.h + 20);
        c.globalAlpha = Math.min(1, age / 0.35);
        c.globalCompositeOperation = "source-over";
        c.fillStyle = L.fill;
        c.fillText(L.text, left + 2, top + L.h / 2);
        continue;
      }
      c.fillStyle = L.sand;
      for (let i = 0; i < L.n; i++) {
        const since = age - L.rel[i]!;
        let x: number;
        let y: number;
        let a: number;
        if (since <= 0) {
          // Not yet loose: the grain still holds its place in the word.
          x = left + L.gx[i]!;
          y = top + L.gy[i]!;
          L.x[i] = x;
          L.y[i] = y;
          a = 0.95;
        } else {
          L.vy[i]! += 120 * dt;
          L.x[i]! += L.vx[i]! * dt;
          L.y[i]! += L.vy[i]! * dt;
          x = L.x[i]!;
          y = L.y[i]!;
          a = Math.max(0, 1 - since / FALL);
        }
        if (a < 0.03) continue;
        c.globalAlpha = a;
        c.fillRect(x, y, 1.3, 1.3);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "lighter";
  }
}

/** Today's one field. */
export const RISES = new RiseField();
