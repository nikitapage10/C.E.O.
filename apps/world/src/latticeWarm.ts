/**
 * Getting the Lattice ready on the Desk (#327, #373), so "Enter the Lattice" is quick the first time and instant after.
 *
 * - Kept: once the Lattice has been on screen it stays mounted behind the Desk (main.tsx), hidden, not drawing, its
 *   simulator, HUD and sound paused. Coming back shows it as it was: nothing to fetch, build or compile again.
 *   Machines that report little memory (navigator.deviceMemory under 4 GB) drop it on the way out instead, as before.
 * - Let go (#406): after LET_GO_MS back on the Desk, the kept Lattice is unmounted, which frees its memory and GPU
 *   through the usual unmount path. A short hop back stays instant; after that it loads fresh, like a first visit.
 * - Fetched ahead: since #332 "Enter the Lattice" opens on the 2D map, which needs no models, no three.js and no
 *   shaders, so nothing heavy is fetched for it here any more (the models went ahead of time before #332, ~30 MB of
 *   them for a view that now loads one room's worth when a room is picked). The map's own code is the build's
 *   `<link rel="prefetch">` (vite.config.ts, prefetchLattice), fetched by the browser at idle, lowest priority. The
 *   warm-up only marks when the Desk went quiet, on a desktop with a fast connection (never on a phone, with Data
 *   Saver on, on 2G/3G, or in a tab that isn't on screen). The Lattice itself does not mount behind the Desk before
 *   its first visit (#401): building and compiling the scene out of sight made the Desk and the Lattice lag.
 *
 * It also counts the trips (#373, the boot-timing beacon): when the Lattice was last asked for and how many times, so
 * the Lattice can time each arrival from the click, not from when its code ran.
 */
const WAIT_MS = 4000;
/** How long the Desk can have been back on screen before the kept Lattice is let go. */
export const LET_GO_MS = 10 * 60 * 1000;

type Connection = { saveData?: boolean; effectiveType?: string };
type Nav = Navigator & { connection?: Connection; deviceMemory?: number };

let started = false;

/** Whether this machine keeps the Lattice mounted behind the Desk once it has been on screen. */
export function keepLattice(): boolean {
  if (typeof navigator === "undefined") return true;
  const memory = (navigator as Nav).deviceMemory;
  return !(memory !== undefined && memory < 4);
}

/** Whether the Desk may load anything for the Lattice ahead of time on this connection and device. */
function allowed(): boolean {
  if (!import.meta.env.PROD) return false;
  const nav = navigator as Nav;
  // Browser tests get the Desk on its own, unless they ask for the warm-up (scripts/lattice-timing.mjs, boot-check).
  if (nav.webdriver && !(window as Window & { __ceoWarm?: boolean }).__ceoWarm) return false;
  const conn = nav.connection;
  if (conn?.saveData || /(^|-)(2g|3g)$/.test(conn?.effectiveType ?? "")) return false;
  return !(window.matchMedia?.("(pointer: coarse)").matches ?? false);
}

/** Called by the Desk once it has mounted. Runs at most once per page. */
export function warmLattice() {
  if (started || typeof window === "undefined" || !allowed()) return;
  started = true;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  const idle = (fn: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 10_000 }) : setTimeout(fn, 200));
  const run = () => {
    // Not while the tab is in the background: wait until it's looked at again.
    if (document.visibilityState === "hidden") {
      document.addEventListener("visibilitychange", () => idle(run), { once: true });
      return;
    }
    // For the boot check and the console: the warm-up ran. The map needs nothing more than its prefetched code.
    (window as Window & { __ceoWarmed?: string }).__ceoWarmed = "map";
  };
  const go = () => setTimeout(() => idle(run), WAIT_MS);
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/**
 * The trips into the Lattice (#373): `asked` is when the last one was asked for (performance.now(); 0 when the page
 * opened on the Lattice), `count` how many there have been, `warmed` whether the first found it warmed behind the Desk (never since #401; kept for the timing beacon's kinds).
 */
export const trips = { asked: 0, count: 0, warmed: false };

/** main.tsx, as the route turns to the Lattice: `at` is when the click (or the back button) happened. */
export function askedForLattice(at: number) {
  trips.count += 1;
  trips.asked = at;
}

/**
 * Starts the let-go timer (#406): after `ms` calls `letGo` and forgets the trips so the next arrival counts as a
 * first one, not a return. Returns a function that cancels it (the route went back to the Lattice).
 */
export function startLetGo(letGo: () => void, ms = LET_GO_MS): () => void {
  const timer = setTimeout(() => {
    trips.count = 0;
    letGo();
  }, ms);
  return () => clearTimeout(timer);
}
