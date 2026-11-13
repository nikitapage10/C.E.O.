/**
 * Which Desk rooms stay mounted (#759, #934). The Senate (Today), the Haven and Relay are always loaded (Nikita,
 * 2026-11-06 01:05Z: "those three should always kind of be loaded in the background at all times"): once the Desk is
 * idle after its first paint they mount one at a time, each in idle time of its own (a mount is a few hundred
 * milliseconds of work, so never all three in one go), the Haven and Relay only once the Senate's chamber is built
 * (#973, `onSenateBuilt`), hidden and paused, beside the room on screen, and stay. A hidden room is out
 * of the layout, so its scene draws nothing (each scene's IntersectionObserver), and coming back shows it as it was,
 * with nothing to build or compile again. A kept room's keys stay quiet out of sight: the Senate's and Relay's
 * hold-to-talk take Space only on screen, and Relay's keys (Y to send, WASD) listen only while it is shown
 * (`useRoomShown`, @ceo/engine/web/roomReady.ts). Any other room unmounts once it is left, as before: its code is
 * already fetched, so it opens at once. On a machine that reports little memory (the same test as the kept Lattice,
 * latticeWarm.ts) nothing is kept.
 */

/**
 * The Senate first (#973). Nikita, 2026-11-06: the Senate loaded slower once the warm-up mounted the Haven and Relay
 * promptly (#958), both building beside the chamber while it was still building. So the rooms after the Senate wait
 * until its chamber reports built (its first frame, or its flat fallback without WebGL), or SENATE_WAIT_MS at most,
 * so a chamber that never reports never holds them for good.
 */
export const SENATE_WAIT_MS = 30_000;
let senateUp = false;
const senateWaiting = new Set<() => void>();
/** The Senate's chamber is built (Rotunda.tsx): the warm-up may go on. */
export function senateBuilt(): void {
  if (senateUp) return;
  senateUp = true;
  for (const f of [...senateWaiting]) f();
  senateWaiting.clear();
}
/** Calls `f` once the Senate's chamber is built (at once if it is); returns how to stop waiting. */
export function onSenateBuilt(f: () => void): () => void {
  if (senateUp) {
    f();
    return () => {};
  }
  senateWaiting.add(f);
  return () => senateWaiting.delete(f);
}
/** Whether the room the warm-up mounts next waits on the Senate's chamber: every one after the Senate itself. */
export const waitsOnSenate = (room: string | undefined): boolean => room !== undefined && room !== "today";

/** The rooms always kept loaded, in the bar's order (#934). */
export const ALWAYS_KEPT = ["today", "haven", "relay"] as const;
/** The most rooms mounted at once: the one on screen and the three always kept. */
export const KEEP = ALWAYS_KEPT.length + 1;

/**
 * The rooms to keep mounted once `route` is on screen, the one on screen first. `warmed` is how many of the
 * always-kept rooms the Desk's idle time has mounted so far, in ALWAYS_KEPT's order (none before its first paint, so
 * the first load is unchanged); one already visited stays regardless. With `keep` false (little memory), only the
 * room on screen.
 */
export function keptAfter<T extends string>(kept: readonly T[], route: T, keep = true, warmed: number = ALWAYS_KEPT.length): T[] {
  if (!keep) return [route];
  const rest = (ALWAYS_KEPT as readonly string[]).filter((r, i) => r !== route && (i < warmed || kept.includes(r as T))) as T[];
  return [route, ...rest];
}

/** What `settleShown` needs of a page's element: the DOM's own `getAnimations` and dataset. */
type Shown = Pick<HTMLElement, "dataset"> & { getAnimations?: (opts?: GetAnimationsOptions) => Animation[] };

/**
 * A kept room coming back on screen shows as it was left (Nikita, 2026-11-06, #958). A hidden room is `display: none`,
 * and the browser starts every CSS animation under it again when it shows, so each entrance (the page's rise, its
 * stage's gold rule, an open sheet sliding in) used to replay on every visit. The first time a room is shown it is
 * marked `data-seen` and plays them; each time after, before the frame paints, its one-shot CSS animations are
 * finished. Looping ones (a breathing lamp, drifting motes) and script-made Web Animations carry on as they are.
 * Returns how many it finished.
 */
export function settleShown(el: Shown): number {
  if (el.dataset.seen === undefined) {
    el.dataset.seen = "";
    return 0;
  }
  let n = 0;
  for (const a of el.getAnimations?.({ subtree: true }) ?? []) {
    if (!("animationName" in a)) continue; // a CSSAnimation, not a script's own
    if (a.effect?.getComputedTiming().iterations === Infinity) continue;
    a.finish();
    n++;
  }
  return n;
}
