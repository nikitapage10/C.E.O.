/**
 * The live watch's look at the API (#704), for scripts/boot-check.mjs --url. On Nov 4, 2026 (#695) every /api route on
 * the live site answered 404 for hours while the pages still loaded, and the watch stayed green. Now, in live mode, it
 * asks a couple of real read-only routes (azure/src/index.ts registers them; there is no /api/health) and counts:
 *   - 404 (the route is gone) and 5xx (the functions are down) as down, and so is no answer at all;
 *   - any other answer as up: 200, a 401 or 403 that wants a key or a session, a 405 or a 429 all mean a function ran.
 * The local build has no functions, so the PR's boot check never asks.
 */

/** Read-only GETs the Lattice and the Desk already make: the world's state and the Foundry's feed. */
export const API_PROBES = ["/api/world", "/api/foundry-feed"];

/** Whether one answer means the API is there. `status` is the HTTP status, or undefined when nothing came back. */
export function apiDown(status) {
  if (typeof status !== "number" || !Number.isFinite(status)) return true;
  return status === 404 || status >= 500;
}

/** One line per probe that found the API down, empty when all are up. `get(url)` resolves to a status (or rejects). */
export async function probeApi(base, get) {
  const misses = [];
  for (const path of API_PROBES) {
    let status;
    let why = "";
    try {
      status = await get(`${base}${path}`);
    } catch (e) {
      why = String(e?.message ?? e).split("\n")[0];
    }
    if (apiDown(status)) misses.push(`${path} answered ${status ?? `nothing (${why || "no response"})`}`);
  }
  return misses;
}
