import { allModelUrls } from "./modelUrl.ts";

/**
 * Warms the Lattice's models on the Desk (#327), so the first "Enter the Lattice" reads them from this browser's
 * own cache instead of the network.
 *
 * - Only once the Desk has loaded, gone idle and had a quiet spell (WAIT_MS), and never on a phone or a metered
 *   or slow connection.
 * - One file at a time at the lowest priority, so it never stands in the way of the Desk's own calls.
 * - Only the models: public, content-hashed files under /assets/models that both hosts serve as immutable for a
 *   year, so the ordinary HTTP cache keeps them and a new version is simply a new address. Nothing from /api and
 *   nothing behind the site lock is ever fetched here, and there's nothing to clean up: a model that changed is
 *   fetched again under its new name, and the browser drops the old one in time.
 * The Lattice's code itself is prefetched by the page (vite.config.ts, prefetchLattice).
 */
const WAIT_MS = 4000;

let started = false;

type Connection = { saveData?: boolean; effectiveType?: string };

function allowed(): boolean {
  if (!import.meta.env.PROD) return false;
  const conn = (navigator as Navigator & { connection?: Connection }).connection;
  if (conn?.saveData || /(^|-)(2g|3g)$/.test(conn?.effectiveType ?? "")) return false;
  return !(window.matchMedia?.("(pointer: coarse)").matches ?? false);
}

async function warm(urls: string[]) {
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
  const go = () => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    const later = () => setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(() => void warm(allModelUrls()), { timeout: 10_000 }) : void warm(allModelUrls())), WAIT_MS);
    later();
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
