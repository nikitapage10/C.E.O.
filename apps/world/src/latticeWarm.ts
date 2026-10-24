import { allModelUrls } from "./modelUrl.ts";

/**
 * Getting the Lattice ready on the Desk (#327, #373), so "Enter the Lattice" is quick the first time and instant after.
 *
 * - Kept: once the Lattice has been on screen it stays mounted behind the Desk (main.tsx), hidden, not drawing, its
 *   simulator, HUD and sound paused. Coming back shows it as it was: nothing to fetch, build or compile again.
 *   Machines that report little memory (navigator.deviceMemory under 4 GB) drop it on the way out instead, as before.
 * - Fetched ahead: on a desktop with a fast connection, once the Desk has loaded, gone idle and had a quiet spell
 *   (WAIT_MS), the models are read into this browser's cache at the lowest priority, one at a time: public,
 *   content-hashed files under /assets/models, immutable for a year on both hosts. Nothing from /api and nothing
 *   behind the site lock is fetched here. Never on a phone, with Data Saver on, on a 2G/3G connection, or in a tab
 *   that isn't on screen. The Lattice itself no longer mounts behind the Desk before its first visit (#401): building
 *   and compiling the whole scene out of sight made the Desk and the Lattice lag.
 *
 * It also counts the trips (#373, the boot-timing beacon): when the Lattice was last asked for and how many times, so
 * the Lattice can time each arrival from the click, not from when its code ran.
 */
const WAIT_MS = 4000;

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

async function fetchModels(urls: string[]) {
  for (const url of urls) {
    // The Lattice was entered in the meantime: it fetches what it needs itself.
    if (window.location.pathname.startsWith("/lattice")) return;
    try {
      const res = await fetch(url, { priority: "low", credentials: "same-origin" } as RequestInit);
      await res.arrayBuffer();
    } catch {
      return;
    }
  }
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
    // For the boot check and the console: the warm-up ran.
    (window as Window & { __ceoWarmed?: string }).__ceoWarmed = "fetched";
    void fetchModels(allModelUrls());
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
