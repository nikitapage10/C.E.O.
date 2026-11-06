/**
 * Which Desk rooms stay mounted (#759, #934). The Senate (Today), the Haven and Relay are always loaded (Nikita,
 * 2026-11-06 01:05Z: "those three should always kind of be loaded in the background at all times"): once the Desk is
 * idle after its first paint they mount, hidden and paused, beside the room on screen, and stay. A hidden room is out
 * of the layout, so its scene draws nothing (each scene's IntersectionObserver), and coming back shows it as it was,
 * with nothing to build or compile again. A kept room's keys stay quiet out of sight: the Senate's and Relay's
 * hold-to-talk take Space only on screen, and Relay's keys (Y to send, WASD) listen only while it is shown
 * (`useRoomShown`, @ceo/engine/web/roomReady.ts). Any other room unmounts once it is left, as before: its code is
 * already fetched, so it opens at once. On a machine that reports little memory (the same test as the kept Lattice,
 * latticeWarm.ts) nothing is kept.
 */

/** The rooms always kept loaded, in the bar's order (#934). */
export const ALWAYS_KEPT = ["today", "haven", "relay"] as const;
/** The rooms whose 3D scene holds the room loader's cover until its first frame. */
export const SCENE_ROOMS: ReadonlySet<string> = new Set(["today", "haven"]);
/** The most rooms mounted at once: the one on screen and the three always kept. */
export const KEEP = ALWAYS_KEPT.length + 1;

/**
 * The rooms to keep mounted once `route` is on screen, the one on screen first. Before the Desk has gone idle after
 * its first paint (`warm` false) only the always-kept rooms already visited stay, so the first load is unchanged;
 * once warm, all three are mounted. With `keep` false (little memory), only the room on screen.
 */
export function keptAfter<T extends string>(kept: readonly T[], route: T, keep = true, warm = true): T[] {
  if (!keep) return [route];
  const rest = (ALWAYS_KEPT as readonly string[]).filter((r) => r !== route && (warm || kept.includes(r as T))) as T[];
  return [route, ...rest];
}
