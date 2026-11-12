import { useSyncExternalStore } from "react";
import "./phone.css";

/**
 * The phone layout (#1045): one rule for when the Desk is on a phone, shared by the shell and every room, so a room
 * never guesses its own breakpoint. On a phone the Desk is its own app, not the desktop page made small: a fixed bar
 * at the top (the room's name, its tabs behind a tap), a fixed bar of the main rooms at the bottom, neither of which
 * scrolls or drifts under a held finger, and each room's controls in front with its scene laid behind them, dimmed and
 * still to the touch unless it is opened on purpose (phone.css, `ph-scene`).
 *
 * The width matches what the rooms already used (`(max-width: 760px)`, the Studio's stage, Relay's field, the
 * Rotunda's warm-up). The CSS side is phone.css, under the same query.
 */

/** The widest a phone is, in CSS pixels. */
export const PHONE_MAX = 760;
/** The media query for a phone. CSS uses the same width: `@media (max-width: 760px)`. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;

const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null);

/** Whether the Desk is on a phone right now. */
export const isPhone = (): boolean => media()?.matches ?? false;

function subscribe(change: () => void) {
  const m = media();
  if (!m) return () => {};
  m.addEventListener?.("change", change);
  return () => m.removeEventListener?.("change", change);
}

/** Whether the Desk is on a phone, kept in step as the window turns or resizes. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}

/**
 * The pixel ratio a room's canvas draws at: on a phone, at most `phone` (1.5 by default: a phone's 3x screen at 3x
 * costs four times the pixels for a scene that sits dimmed behind the controls), elsewhere at most `desktop`.
 */
export function sceneDpr(desktop = 2, phone = 1.5): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, isPhone() ? phone : desktop);
}
