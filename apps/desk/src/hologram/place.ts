/** Where the hologram call stands (#538): over the chat box, his words beside it or above it. */

/**
 * Where he stands: the chat box he takes over (`pl`, `pt`, `pw`, `ph`), the figure's canvas size inside it (`w`,
 * `h`), and his words, beside the dock's left (right-aligned to `ux + uw`, bottom `ub` up from the window's
 * foot) or stacked above it.
 */
export type Place = { kind: "dock" | "stack" | "phone"; w: number; h: number; pl: number; pt: number; pw: number; ph: number; ux: number; uw: number; ub: number };

export const PHONE = "(max-width: 640px)";

/** Where he stands: over the open dock, or where the dock would sit when it's closed. */
export function placeFor(vw: number, vh: number, dock: { left: number; top: number; width: number; height: number } | null, phone: boolean): Place {
  const open = !!dock && dock.width > 0 && dock.height > 0;
  const pw = open ? dock!.width : phone ? vw : Math.min(420, vw - 32);
  const ph = open ? dock!.height : phone ? Math.min(vh * 0.82, 640) : Math.min(600, vh - 48);
  const pl = open ? dock!.left : vw - (phone ? 0 : 24) - pw;
  const pt = open ? dock!.top : vh - (phone ? 0 : 24) - ph;
  // He fills the box from its foot: as tall as it allows, never wider than it.
  const h = Math.round(Math.max(140, Math.min(ph - 20, (pw * 0.98) / 0.84)));
  const w = Math.round(h * 0.84);
  const roomBeside = pl - 24;
  if (!phone && roomBeside >= 280) {
    const uw = Math.round(Math.min(380, roomBeside - 8));
    return { kind: "dock", w, h, pl, pt, pw, ph, ux: Math.round(pl - 16 - uw), uw, ub: Math.round(vh - (pt + ph)) };
  }
  // No room beside the dock (a phone, a narrow window): his words go above it.
  const uw = Math.round(Math.min(pw, vw - 24));
  return { kind: phone ? "phone" : "stack", w, h, pl, pt, pw, ph, ux: Math.round(pl + pw / 2 - uw / 2), uw, ub: Math.round(vh - pt + 8) };
}
