import { agoShort, initialOf, type Exchange, type Line } from "./thread.ts";

/**
 * Relay's queue on the line (#803, reshaped in #869), the logic with no DOM. Nikita, 2026-11-05: every owed thread's
 * circle sits on the line itself, in the queue's order, its name a small label beside it; hovering or scrolling
 * magnifies them like a dock, the nearest largest and its neighbours scaled along a bell curve, through a warped
 * magnifying glass: the rows on its rim squash and lean away, as through a convex lens. Scrolling moves the list along the line; the ones scrolled past compress toward the end of the line and fade,
 * but never leave it.
 *
 *   waveRows     every row of the queue (a window of WAVE_MAX around the one in focus on a very long queue), each
 *                with its place (k: 0 the one in focus, 1 the next, −1 the one before).
 *   lineOffset   where place d (fractional, from the scroll) sits along the line from the centre, compressed with
 *                distance so the whole queue fits `half` px each side.
 *   bell         the magnifier's bell curve.
 *   lineLayout   each row's offset, scale, alpha and label alpha for a scroll place and a magnifier point.
 *   scrollPlace  the fractional place a scroll position stands at, from the entries' tops.
 */

export interface WaveRow {
  key: string;
  k: number;
  line: Line;
  who: string;
  initial: string;
  /** One short line: a text's gist or newest words, an email's subject. */
  gist: string;
  /** "4 min", "2 h", "3 d". */
  age: string;
  photo?: string;
  logo?: string;
  /** Needs no reply (#869): drawn quieter. */
  settled?: boolean;
}

/** At most this many rows on the line (a window around the one in focus); the owed list is far shorter in practice. */
export const WAVE_MAX = 80;

/** The rows on the line, around the one in focus (the first when none is). */
export function waveRows(queue: readonly Exchange[] | null, cur: string | null, now: number, max = WAVE_MAX): WaveRow[] {
  const q = queue ?? [];
  if (!q.length) return [];
  const at = Math.max(0, q.findIndex((x) => x.key === cur));
  const lo = Math.max(0, Math.min(at - Math.floor(max / 2), q.length - max));
  const out: WaveRow[] = [];
  for (let i = lo; i < Math.min(q.length, lo + max); i++) {
    const x = q[i]!;
    const said = x.messages?.at(-1)?.text ?? "";
    out.push({
      key: x.key,
      k: i - at,
      line: x.line,
      who: x.who,
      initial: initialOf(x.who),
      gist: (x.line === "email" ? x.subject || x.body : x.body || said).replace(/\s+/g, " ").trim(),
      age: agoShort(Math.max(0, now - x.at)),
      ...(x.photo && { photo: x.photo }),
      ...(x.logo && { logo: x.logo }),
      ...(x.settled && { settled: true }),
    });
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Place d's offset from the centre: about `gap` px a step near the centre, closing up with distance so it never passes
 * `half` px (the ones far off sit packed at the line's ends, still there).
 */
export function lineOffset(d: number, gap: number, half: number): number {
  if (half <= 0) return 0;
  return Math.sign(d) * half * (1 - Math.exp((-Math.abs(d) * gap) / half));
}

/** The spacing between neighbours at place d (the slope of lineOffset): how much room a label has there. */
export function lineStep(d: number, gap: number, half: number): number {
  if (half <= 0) return 0;
  return gap * Math.exp((-Math.abs(d) * gap) / half);
}

/** The bell curve: 1 at the magnifier, falling smoothly with distance (px) over sigma. */
export const bell = (dist: number, sigma: number) => Math.exp(-(dist * dist) / (2 * sigma * sigma));

export interface LineOpts {
  /** Px between neighbours near the centre. */
  gap: number;
  /** Px from the centre to the line's end, each way. */
  half: number;
  /** How much the nearest one grows (1 doubles it). */
  mag: number;
  /** The bell's width, px. */
  sigma: number;
  /** How far the magnified ones push their neighbours apart, px each way (the dock's spread). */
  spread: number;
  /** How hard the glass warps the rows on its rim: they squash along the line and tilt away (0 is a flat zoom). */
  warp: number;
}

export const LINE: LineOpts = { gap: 46, half: 260, mag: 0.9, sigma: 44, spread: 16, warp: 1 };

export interface Placed {
  /** Offset from the centre along the line, px (down on a desktop, right on a phone). */
  at: number;
  scale: number;
  alpha: number;
  /** The label's alpha: shown where there is room for it, always on the magnified ones. */
  label: number;
  /** 0 to 1: how close to the magnifier. */
  lens: number;
  /** The scale along the line: under the rim of the glass a row squashes, as through a convex lens. */
  squash: number;
  /** Degrees the row tilts away on the rim, signed by its side of the glass (0 at its middle and far off). */
  tilt: number;
}

/**
 * Every row's place for scroll place p (fractional: 2.4 is 40% of the way from the third entry to the fourth) and the
 * magnifier at `focus` px from the centre (0, the centre, when nothing hovers). The spread follows the bell's integral
 * (tanh as its shape), so it pushes neighbours apart without ever reordering them.
 */
export function lineLayout(n: number, p: number, focus: number, o: LineOpts = LINE): Placed[] {
  const out: Placed[] = [];
  const half = Math.max(0, o.half - o.spread);
  for (let i = 0; i < n; i++) {
    const d = i - p;
    const b = lineOffset(d, o.gap, half);
    const lens = bell(b - focus, o.sigma);
    const at = b + o.spread * Math.tanh((b - focus) / o.sigma);
    const fade = d < 0 ? Math.max(0.3, 1 - 0.14 * -d) : Math.max(0.42, 1 - 0.07 * d);
    const alpha = Math.min(1, fade + 0.6 * lens);
    const room = clamp01((lineStep(d, o.gap, half) - 24) / 12);
    // The warped magnifying glass (Nikita 2026-11-05, in place of a frosted pill): strongest on the rim, where the bell
    // falls fastest, nothing at its middle or far off; the rim rows squash along the line and lean away from the centre.
    const rim = 4 * lens * (1 - lens) * o.warp;
    const scale = 1 + o.mag * lens;
    out.push({ at, scale, alpha, label: Math.max(room * (d < 0 ? 0.75 : 1), clamp01(lens * 1.6)) * alpha, lens, squash: scale * (1 - 0.3 * rim), tilt: Math.sign(b - focus) * 38 * rim });
  }
  return out;
}

/** The fractional place a scroll position stands at, from the entries' tops in order: 0 before the first, the last past its top. */
export function scrollPlace(scroll: number, tops: readonly number[]): number {
  if (!tops.length) return 0;
  if (scroll <= tops[0]!) return 0;
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i]!;
    const b = tops[i + 1]!;
    if (scroll < b) return i + (b > a ? (scroll - a) / (b - a) : 0);
  }
  return tops.length - 1;
}

/** Eases a value toward its target at `rate` per second (frame time dt), settling exactly once close. */
export function ease(v: number, to: number, dt: number, rate = 7, eps = 0.0005): number {
  const next = v + (to - v) * Math.min(1, dt * rate);
  return Math.abs(next - to) < eps ? to : next;
}
