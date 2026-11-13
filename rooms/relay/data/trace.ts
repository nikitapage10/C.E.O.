/**
 * The accent that runs round a message card as it opens (#1162, Nikita: "the text itself should be the first thing I
 * can see"). The words are on screen at once; sigils leave the spine at the card's top corner and trace its border,
 * clockwise (along the top, down the far side, back along the foot), fading as they go. Pure geometry, no DOM.
 */

export interface Pt {
  x: number;
  y: number;
}

/** The border's path from the spine's top corner: along the top, down the far edge, back along the foot to the spine. */
export function outline(x: number, y: number, w: number, h: number, inset = 6): Pt[] {
  const l = x + inset;
  const r = x + w - inset;
  const t = y + inset;
  const b = y + h - inset;
  return [
    { x: l, y: t },
    { x: Math.max(l, r), y: t },
    { x: Math.max(l, r), y: Math.max(t, b) },
    { x: l, y: Math.max(t, b) },
  ];
}

/** The path's length. */
export function lengthOf(pts: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return n;
}

/** The point `d` px along the path, clamped to its ends. */
export function pointAlong(pts: readonly Pt[], d: number): Pt {
  const first = pts[0] ?? { x: 0, y: 0 };
  if (d <= 0 || pts.length < 2) return first;
  let left = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg) return seg === 0 ? a : { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return pts[pts.length - 1]!;
}

/** How many sigils the trace uses for a path of `len` px: a sparse run, never many. */
export function traceCount(len: number, cap = 56): number {
  return Math.max(0, Math.min(cap, Math.round(len / 16)));
}

/** The traced sigils' fates: each runs from the start to its own distance along the path, spread over the whole of it. */
export function traceStops(len: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (len * (i + 1)) / n);
}

/** The accent's longest run, ms: the last sigil's flight plus its start delay. */
export const TRACE_MS = 520;
