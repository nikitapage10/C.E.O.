import type { TalkReason } from "../skippy/talk.ts";

/**
 * The call connecting (#1053): from the tap until the call is live his projection comes through garbled (torn bands,
 * the colours split, rows dropping out, noise and flicker), and once it connects it glitches into clarity over
 * RESOLVE_MS. A call that fails glitches out instead of sinking. holoScene.ts draws the garble; this is its clock.
 */

/** How long he takes to glitch into clarity once the call connects, in ms. */
export const RESOLVE_MS = 800;

/**
 * The garble one frame on, 0 (clear) to 1 (barely there): it jumps to full while the call is connecting (or lost),
 * and once it isn't falls away evenly over RESOLVE_MS.
 */
export function garbleNext(was: number, dt: number, connecting: boolean): number {
  if (connecting) return 1;
  return Math.max(0, was - (dt * 1000) / RESOLVE_MS);
}

/** Eased for the eye: the last of the noise lingers a moment, then goes. */
export function garbleShape(g: number): number {
  const x = Math.min(1, Math.max(0, g));
  return x * x * (3 - 2 * x);
}

/** Whether a call that just ended dropped (it glitches out) rather than being hung up or timing out (it sinks). */
export function callLost(reason: TalkReason | null): boolean {
  return reason !== null && reason !== "silence";
}
