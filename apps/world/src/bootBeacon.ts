import type { TimingIn } from "../../../api/_boot/types.ts";

export type { TripKind } from "../../../api/_boot/types.ts";

/**
 * The boot-timing beacon (#373): after each arrival in the Lattice (scene/Backstage.tsx, TripTimer) the timings and
 * counts go to /api/lattice-timing (api/_boot/timing.ts), so the Boiler Room can show how the Lattice loads on the
 * real machine, before and after a change. Nothing but those numbers is sent: no address, no names, nothing typed.
 *
 * The built site only, and never from a browser test (the local server has no /api). The last one is also on
 * window.__ceo.lastTrip, for the console and scripts/lattice-timing.mjs.
 */
export const TIMING_PATH = "/api/lattice-timing";

export function sendTiming(t: TimingIn) {
  const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
  api.lastTrip = t;
  if (!import.meta.env.PROD || navigator.webdriver) return;
  void fetch(TIMING_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(t),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}
