/**
 * Which Desk rooms stay mounted (#759). A room with a costly 3D scene (Today's Rotunda, the Haven's house) stays
 * mounted after a visit, hidden and paused: its canvas is out of the layout, so its loop draws nothing (each scene's
 * IntersectionObserver), and coming back shows it as it was, with nothing to build or compile again. The oldest goes
 * beyond the cap, and on a machine that reports little memory (the same test as the kept Lattice, latticeWarm.ts)
 * nothing is kept. Pages without a scene unmount as before: their code is already fetched, so they open at once, and
 * none of their key handlers (Relay's Y to send) stays listening out of sight.
 */

/** The rooms whose scene is worth keeping. */
export const SCENE_ROOMS: ReadonlySet<string> = new Set(["today", "haven"]);
/** The most rooms mounted at once: the one on screen and the last scene rooms visited. */
export const KEEP = 3;

/** The rooms to keep mounted once `route` is on screen, most recent first. */
export function keptAfter<T extends string>(kept: readonly T[], route: T, keep = true): T[] {
  if (!keep) return [route];
  return [route, ...kept.filter((r) => r !== route && SCENE_ROOMS.has(r))].slice(0, KEEP);
}
