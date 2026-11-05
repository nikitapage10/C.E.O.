/**
 * Where a pop-over card goes next to the thing it explains (issue #80): below it when there's room, above it when
 * there's more room there, and shifted sideways so it never leaves the viewport. Pure, so it's tested on its own.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  side: "below" | "above";
  /** Where the little pointer sits along the card's top or bottom edge, in px from its left. */
  arrow: number;
}

export function placePopover(anchor: Box, pop: { width: number; height: number }, view: { width: number; height: number }, margin = 12, gap = 8): Placement {
  const below = view.height - (anchor.top + anchor.height) - gap - margin;
  const above = anchor.top - gap - margin;
  const side = below >= pop.height || below >= above ? "below" : "above";
  const rawTop = side === "below" ? anchor.top + anchor.height + gap : anchor.top - gap - pop.height;
  const top = clamp(rawTop, margin, Math.max(margin, view.height - pop.height - margin));
  const centre = anchor.left + anchor.width / 2;
  const left = clamp(centre - pop.width / 2, margin, Math.max(margin, view.width - pop.width - margin));
  const arrow = clamp(centre - left, 14, Math.max(14, pop.width - 14));
  return { left, top, side, arrow };
}

/**
 * The box a card is placed around when it follows the mouse (issue #94): a little taller than the cursor's arrow, so
 * a card below sits clear of the arrow and one above sits just over the hotspot.
 */
export function pointerBox(x: number, y: number): Box {
  return { left: x - 8, top: y - 10, width: 16, height: 32 };
}

/** What feeds a part and what it feeds, from a diagram's wires (issue #94), in the wires' order. */
export function routesOf<Id extends string>(wires: readonly { from: Id; to: Id }[], id: Id): { from: Id[]; to: Id[] } {
  return {
    from: wires.filter((w) => w.to === id).map((w) => w.from),
    to: wires.filter((w) => w.from === id).map((w) => w.to),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
