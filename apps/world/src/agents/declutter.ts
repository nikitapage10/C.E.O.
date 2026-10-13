/**
 * The pure half of keeping the Lattice's labels off each other (Nameplate.tsx and scene/Callouts.tsx apply it):
 * which name plates keep their task line, which step back, and whether a room's callout is under a speech bubble.
 * Screen boxes only, no DOM or three.js, so it is all testable.
 */

/** A box on screen, in CSS pixels. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A name plate on screen: its name, its task line (null while the line is faded out) and how far it is from the camera. */
export interface PlateBox {
  id: string;
  depth: number;
  name: Rect;
  line: Rect | null;
  /** Its task card is open: it keeps everything, whatever it overlaps. */
  pinned?: boolean;
}

/**
 * How much of a plate shows:
 *  - "full": name and task line;
 *  - "name": the name only, its line hidden because it would sit on a nearer label;
 *  - "dim": even the name would cover a nearer label, so the plate fades right back (hover the agent for its tag).
 */
export type PlateLevel = "full" | "name" | "dim";

/** Whether two boxes overlap by more than `slack` pixels each way (touching edges don't count). */
export function intersects(a: Rect, b: Rect, slack = 0): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > slack && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > slack;
}

/**
 * Keep name plates readable when agents bunch up. Speech bubbles (`obstacles`) come first, then plates from the
 * nearest to the camera outwards: a plate whose task line would land on a label already placed shows its name only,
 * and one whose name would too fades back (`slack` -3: labels keep 3px of air). Pinned plates (an open task card)
 * are placed first and always show.
 */
export function declutterPlates(plates: readonly PlateBox[], obstacles: readonly Rect[] = [], slack = -3): Record<string, PlateLevel> {
  const order = [...plates].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Rect[] = [...obstacles];
  const hits = (r: Rect) => placed.some((p) => intersects(r, p, slack));
  const out: Record<string, PlateLevel> = {};
  for (const p of order) {
    if (!p.pinned && hits(p.name)) {
      out[p.id] = "dim";
      continue;
    }
    if (p.line && !p.pinned && hits(p.line)) {
      out[p.id] = "name";
      placed.push(p.name);
      continue;
    }
    out[p.id] = "full";
    placed.push(p.name);
    if (p.line) placed.push(p.line);
  }
  return out;
}

const RANK: Record<PlateLevel, number> = { full: 0, name: 1, dim: 2 };

/** Whether going from `shown` to `want` shows more of the plate (dim → name → full). */
export function stepsForward(shown: PlateLevel, want: PlateLevel): boolean {
  return RANK[want] < RANK[shown];
}

/**
 * Settle a level against flicker: stepping back (full → name → dim) happens at once, so labels never sit on each
 * other, but stepping forward waits until the plate has had clear air for `holdMs` (`crowdedAt`: the last time it
 * didn't).
 */
export function settleLevel(shown: PlateLevel, want: PlateLevel, crowdedAt: number, now: number, holdMs: number): PlateLevel {
  if (!stepsForward(shown, want)) return want;
  return now - crowdedAt >= holdMs ? want : shown;
}
