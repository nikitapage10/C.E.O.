import { agoShort, initialOf, type Exchange, type Line } from "./thread.ts";

/**
 * Relay's queue wave (#803), the logic with no DOM. Left of the line, what comes next rides a slow wave toward it: the
 * one in focus sits on the line, the next ones further out along the wave, the furthest smallest and faintest. On a
 * phone the wave lies flat above the entry and runs toward the line from the right. It replaces the rail (#765).
 *
 *   waveRows   the window of the queue the wave shows: a couple already past (they slip off the line), the one in
 *              focus, and the next ones; each with its place (k: 0 is the one in focus, 1 the next, −1 the one before).
 *   waveU      where along the wave a place sits: 0 on the line, 1 the far end; past ones just over the line.
 *   wavePoint  the point at u (and time t, in seconds) inside the wave's box, in the box's own coordinates' frame.
 *   waveLook   how big and how bright a row is at u.
 *   waveSpan   how many upcoming rows fit the box.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
}

/** Rows already past the one in focus that stay drawn while they slip off the line. */
export const WAVE_PAST = 2;

/** How many upcoming rows fit: about one per 64 px of wave (desktop) or 58 px (phone), 3 to 9. */
export function waveSpan(len: number, narrow: boolean): number {
  return Math.max(3, Math.min(9, Math.floor(len / (narrow ? 58 : 64))));
}

/** The window of the queue on the wave, around the one in focus (the first when none is). */
export function waveRows(queue: readonly Exchange[] | null, cur: string | null, now: number, span: number): WaveRow[] {
  const q = queue ?? [];
  if (!q.length) return [];
  const at = Math.max(0, q.findIndex((x) => x.key === cur));
  const out: WaveRow[] = [];
  for (let i = Math.max(0, at - WAVE_PAST); i < Math.min(q.length, at + span + 1); i++) {
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
    });
  }
  return out;
}

/** Where place k sits along the wave: 0 on the line, the next from 0.16 out to 1 at the far end; past ones over the line. */
export function waveU(k: number, span: number): number {
  if (k <= 0) return k * 0.09;
  if (span <= 1) return 1;
  return 0.16 + ((k - 1) / (span - 1)) * 0.84;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The point at u along the wave, at time t (seconds; 0 holds it still). Desktop: the line is the box's right edge, the
 * wave runs left across the box (leaving `room` px for the far rows' words) and swells with distance from the line,
 * so the one in focus arrives level. Phone: the line is the box's left edge and the wave runs right, flatter.
 */
export function wavePoint(u: number, t: number, box: Box, narrow: boolean, room = 190): [number, number] {
  const swell = clamp01(u * 1.7);
  if (narrow) {
    const run = Math.max(40, box.w - 44);
    const amp = Math.min(box.h * 0.2, 14);
    return [box.x + Math.max(0, u) * run + Math.min(0, u) * 40, box.y + box.h * 0.42 + amp * Math.sin(u * 6.4 - t * 0.8) * swell];
  }
  const run = Math.max(80, box.w - room - 20);
  const amp = Math.min(box.h * 0.24, 130);
  return [box.x + box.w - Math.max(0, u) * run - Math.min(0, u) * 60, box.y + box.h / 2 + amp * Math.sin(u * 5.3 - t * 0.55) * swell];
}

/** A row's scale and alpha at u: full on the line, smaller and fainter out along the wave, gone just past either end. */
export function waveLook(u: number): { scale: number; alpha: number } {
  const scale = 1 - 0.32 * clamp01(u);
  const alpha = u < 0 ? clamp01(1 + u * 11) : u > 1 ? clamp01(1 - (u - 1) * 8) : 1 - 0.5 * u;
  return { scale, alpha };
}

/** Eases a value toward its target at `rate` per second (frame time dt), settling exactly once close. */
export function ease(v: number, to: number, dt: number, rate = 7): number {
  const next = v + (to - v) * Math.min(1, dt * rate);
  return Math.abs(next - to) < 0.0005 ? to : next;
}
