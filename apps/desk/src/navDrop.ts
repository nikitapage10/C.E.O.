/**
 * When the bar's room drop-downs (#871, DeskNav.tsx) close, as pure rules so they are unit tested (navDrop.test.ts).
 * A drop-down belongs to the page it was opened on: it never shows on another one (#901, a Haven menu was left open
 * over the Boiler Room), and it closes on a move, a tap or click elsewhere, Escape, the window losing focus, and the
 * mouse leaving it and its room's name.
 */

/** An open drop-down: the room it lists, and the address it was opened on. */
export interface DropAt {
  id: string;
  path: string;
}

/** The drop-down to draw at `pathname`: only one opened on this very page. */
export function shownDrop<D extends DropAt>(drop: D | null, pathname: string): D | null {
  return drop && drop.path === pathname ? drop : null;
}

/** Something that happened while a drop-down was open; `inside` is whether it was on the drop-down or its room's name. */
export type DropEvent =
  | { kind: "pointerdown"; inside: boolean }
  | { kind: "pointermove"; inside: boolean; pointerType: string }
  | { kind: "key"; key: string }
  | { kind: "blur" | "hidden" | "resize" | "scroll" | "navigate" | "leave-window" };

/** What the drop-down does: shut at once, shut after a moment (so the mouse can cross the gap to it), or stay. */
export function onDropEvent(drop: DropAt | null, e: DropEvent): "close" | "soon" | "stay" {
  if (!drop) return "stay";
  switch (e.kind) {
    case "pointerdown":
      return e.inside ? "stay" : "close";
    case "pointermove":
      // Only a mouse hovers; a pen or a finger moving is a drag or a scroll, which the tap rule covers.
      return e.pointerType === "mouse" && !e.inside ? "soon" : "stay";
    case "key":
      return e.key === "Escape" ? "close" : "stay";
    default:
      return "close";
  }
}

/** Whether an element sits in the open drop-down or in the bar entry of its room. */
export function insideDrop(target: { closest?: (s: string) => unknown } | null | undefined, id: string): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return !!target.closest(".wv-drop") || !!target.closest(`[data-drop="${id}"]`);
}
