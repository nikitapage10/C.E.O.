import { useBoot } from "../boot.ts";
import { useFoundry } from "../foundry.ts";

/**
 * The Desk's load beacon (#561): once per page load that opens on the Desk (not the Lattice, and not a trip back to the
 * Desk from it), the milliseconds from the page opening to the Desk's first paint and to its live data being ready
 * (the Foundry feed connected) go to /api/desk-timing (api/_boot/deskTiming.ts), so the Boiler Room can show how fast
 * the Desk opens. Two numbers only: no address, user agent, names or anything typed or read.
 *
 * The built site only, and never from a browser test (the local server has no /api), like bootBeacon.ts (#373).
 */
export const DESK_TIMING_PATH = "/api/desk-timing";

let started = false;

/** What the browser sends, or null for numbers that cannot be a load. */
export function deskLoadBody(firstPaint: number, dataReady: number): { firstPaint: number; dataReady: number } | null {
  if (![firstPaint, dataReady].every((n) => Number.isFinite(n) && n >= 0)) return null;
  return { firstPaint: Math.round(firstPaint), dataReady: Math.round(Math.max(firstPaint, dataReady)) };
}

export function sendDeskTiming(firstPaint: number, dataReady: number) {
  const body = deskLoadBody(firstPaint, dataReady);
  const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
  api.lastDeskLoad = body;
  if (!body || !import.meta.env.PROD || navigator.webdriver) return;
  void fetch(DESK_TIMING_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}

/** Called when the Desk mounts. Does nothing after the first call, or when the Lattice has been on screen. */
export function startDeskTiming() {
  if (started) return;
  started = true;
  if (useBoot.getState().visited) return;
  let paint: number | null = null;
  let ready: number | null = null;
  const done = () => {
    if (paint === null || ready === null) return;
    unsub();
    sendDeskTiming(paint, ready);
  };
  const unsub = useFoundry.subscribe((s) => {
    if (s.connected && ready === null) {
      ready = performance.now();
      done();
    }
  });
  if (useFoundry.getState().connected) ready = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      paint = performance.now();
      done();
    }),
  );
}
