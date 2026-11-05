import { agoShort, initialOf, type Exchange, type Line } from "./thread.ts";

/**
 * Relay's rail (#765), the logic with no DOM: a compact timeline of every exchange in the Thread's queue, down the
 * left edge, that magnifies like the macOS Dock around the pointer.
 *
 *   dockScale    one item's scale from its distance to the pointer, in items: a bell curve (gaussian falloff).
 *   dockScales   every item's scale for a pointer at a fractional index (null: nobody hovering, all 1).
 *   dockOffsets  how far each item moves so the magnified ones push their neighbours apart, the pointer's item still.
 *   railOf       the rows, in the Thread's own order (the queue as it scrolls), with the current one marked.
 *   railStep     one move along the rail (keys), clamped to its ends.
 *   railAt       which item a pointer at y is over, as a fractional index.
 */

/** The hovered item's scale, and how wide the wave is (standard deviation, in items). */
export const DOCK_MAX = 1.8;
export const DOCK_SIGMA = 2.5;

/** scale = 1 + (max − 1) · exp(−d² / 2σ²). */
export function dockScale(d: number, max = DOCK_MAX, sigma = DOCK_SIGMA): number {
  if (!Number.isFinite(d) || sigma <= 0) return 1;
  return 1 + (max - 1) * Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** Every item's scale for a pointer at fractional index `at`; `amp` (0–1) eases the whole wave in and out. */
export function dockScales(n: number, at: number | null, amp = 1, max = DOCK_MAX, sigma = DOCK_SIGMA): number[] {
  const a = Math.max(0, Math.min(1, amp));
  return Array.from({ length: Math.max(0, n) }, (_, i) => (at === null || a === 0 ? 1 : 1 + a * (dockScale(i - at, max, sigma) - 1)));
}

/**
 * Each item's shift (in px, rows `h` tall) so the grown ones don't overlap: an item's centre moves by the extra height
 * of everything between it and the pointer, so the wave spreads out from the pointer and the item under it stays put.
 */
export function dockOffsets(scales: readonly number[], h: number, at: number | null): number[] {
  if (at === null || !scales.length) return scales.map(() => 0);
  // The extra height above each item's centre, measured from the top.
  const centre: number[] = [];
  let acc = 0;
  for (const s of scales) {
    const extra = (s - 1) * h;
    centre.push(acc + extra / 2);
    acc += extra;
  }
  // The same at the pointer, so its row (interpolated between neighbours) stays where it is.
  const i0 = Math.max(0, Math.min(scales.length - 1, Math.floor(at)));
  const i1 = Math.min(scales.length - 1, i0 + 1);
  const f = Math.max(0, Math.min(1, at - i0));
  const pin = centre[i0]! + (centre[i1]! - centre[i0]!) * f;
  return centre.map((c) => c - pin);
}

export interface RailRow {
  key: string;
  line: Line;
  who: string;
  initial: string;
  /** The one line the rail shows: an email's subject or gist, a text's gist. */
  preview: string;
  /** "4 min", "2 h", "3 d". */
  age: string;
  photo?: string;
  logo?: string;
  cur: boolean;
}

/** The rail's rows: exactly the queue's exchanges, in the order the Thread scrolls through them. */
export function railOf(queue: readonly Exchange[] | null, cur: string | null, now: number): RailRow[] {
  return (queue ?? []).map((x) => ({
    key: x.key,
    line: x.line,
    who: x.who,
    initial: initialOf(x.who),
    preview: (x.line === "email" ? x.subject || x.body : x.body || x.subject).replace(/\s+/g, " ").trim(),
    age: agoShort(Math.max(0, now - x.at)),
    ...(x.photo && { photo: x.photo }),
    ...(x.logo && { logo: x.logo }),
    cur: x.key === cur,
  }));
}

/** Where the current exchange sits on the rail; -1 when it isn't on it. */
export const railIndex = (rows: readonly { key: string }[], cur: string | null) => (cur === null ? -1 : rows.findIndex((r) => r.key === cur));

/** One step along the rail from `i` (−1 counts as before the first), clamped to its ends; null on an empty rail. */
export function railStep(i: number, delta: number, n: number): number | null {
  if (n <= 0) return null;
  if (i < 0) return delta > 0 ? 0 : n - 1;
  return Math.max(0, Math.min(n - 1, i + delta));
}

/** The fractional index under a pointer `y` px below the first row's top, rows `h` tall (centre of row i is i). */
export function railAt(y: number, h: number, n: number): number | null {
  if (n <= 0 || h <= 0) return null;
  return Math.max(0, Math.min(n - 1, y / h - 0.5));
}

/** How tall each row is so `n` fit in `space` px, between `min` and `max`. */
export const railRowH = (space: number, n: number, min = 10, max = 26) => (n <= 0 ? max : Math.max(min, Math.min(max, space / n)));
