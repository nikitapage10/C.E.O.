/**
 * The Lattice's boot timings (#373): what the beacon sends from a real browser after each arrival in the Lattice, and
 * what the Boiler Room shows. Timings and counts only: no address, no user agent, no names, nothing typed or read.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** How the Lattice was reached: opened on it, the first trip from the Desk (cold or warmed behind it), or a return. */
export const TRIP_KINDS = ["direct", "first", "warmed", "return"] as const;
export type TripKind = (typeof TRIP_KINDS)[number];

/** What the browser sends. Times in ms from the click (or the page opening, for "direct"). */
export interface TimingIn {
  kind: TripKind;
  /** Which trip into the Lattice this page made (1 for the first). */
  trip: number;
  /** To the first frame drawn on screen. */
  firstFrame: number;
  /** To the loading screen lifting (the first frame, when it had lifted out of sight already). */
  curtain: number;
  /** Frames per second over the 5 s after the curtain. */
  fps: number;
  /** The slowest of those frames, ms. */
  worstFrame: number;
  /** Draw calls, triangles and shader programs of the last frame of that window. */
  draws: number;
  triangles: number;
  programs: number;
}

/** One kept timing: what came in, and when the server took it (never the browser's own clock). */
export interface Timing extends TimingIn {
  at: string;
}

export interface TimingsView {
  ok: true;
  /** Newest first. */
  timings: Timing[];
}
