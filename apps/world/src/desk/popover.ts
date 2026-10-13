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

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
