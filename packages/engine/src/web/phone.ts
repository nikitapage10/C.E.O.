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

/** The rungs a phone's scenes draw at (#1070): sharp at 2x, then lighter while frames run slow. */
export const PHONE_DPR_STEPS = [2, 1.5, 1.25] as const;
/** Frames averaging slower than this for `SLOW_HOLD_MS` step a phone's scenes down a rung. */
export const SLOW_FRAME_MS = 22;
export const SLOW_HOLD_MS = 2000;

// The rung this page view is on: it only goes down, and a scene built later starts there (#1070).
let rung: number = PHONE_DPR_STEPS[0];

/**
 * The pixel ratio a room's canvas draws at: on a phone, at most `phone` (2x by default, #1070: a phone's screen is 3x,
 * and the old 1.25 upscaled every scene until it looked soft) and never above the rung `dprGuard` has stepped down to;
 * elsewhere at most `desktop` (1.75).
 */
export function sceneDpr(desktop = 1.75, phone = 2): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, isPhone() ? Math.min(phone, rung) : desktop);
}

/**
 * Keeps a phone's scene smooth at the sharper ratio (#1070). Call `frame(now)` from the scene's animation frame, every
 * frame and before any frame-rate throttle. When frames average over `SLOW_FRAME_MS` for `SLOW_HOLD_MS`, it steps the
 * page view down a rung (2x, 1.5x, 1.25x) and hands `apply` the scene's new `sceneDpr(desktop, phone)`; it never steps
 * back up. A gap over a quarter second (a hidden tab, a stall while loading) starts the count again. Off a phone it
 * does nothing.
 */
export function dprGuard(apply: (dpr: number) => void, desktop?: number, phone?: number): { frame: (now: number) => void } {
  const on = isPhone();
  let last = 0;
  let avg = 0;
  let slow = 0;
  return {
    frame(now) {
      if (!on) return;
      const dt = last ? now - last : 0;
      last = now;
      if (!(dt > 0) || dt > 250) {
        avg = slow = 0;
        return;
      }
      avg = avg ? avg * 0.9 + dt * 0.1 : dt;
      slow = avg > SLOW_FRAME_MS ? slow + dt : 0;
      if (slow < SLOW_HOLD_MS) return;
      avg = slow = 0;
      const was = sceneDpr(desktop, phone);
      rung = PHONE_DPR_STEPS.find((s) => s < rung) ?? rung;
      const next = sceneDpr(desktop, phone);
      if (next !== was) apply(next);
    },
  };
}

/** For tests: a fresh page view, back on the top rung. */
export function resetDprRung(): void {
  rung = PHONE_DPR_STEPS[0];
}
