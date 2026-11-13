/**
 * Holding a room's name in the bar opens its tabs (#1113). Nikita, 2026-11-13: "if I hold the Haven button in the menu,
 * it kind of opens up the submenus, so I can quickly get to the room, like the kitchen." A press held still for HOLD_MS
 * opens the room's drop-down (DeskNav.tsx), and the click that follows the release is swallowed, so the hold doesn't
 * also go to the room. A quick tap still just goes to the room; a press that moves (a swipe along the bar) is let go.
 */

/** How long a press is held before the tabs open, under the phone's own long-press (about 500 ms). */
export const HOLD_MS = 380;
/** How far a press may wander (px) and still count as held. */
export const HOLD_SLOP = 10;

export interface Hold {
  down: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  up: () => void;
  /** True once, for the click after a hold that opened the tabs: that click is swallowed. */
  eatClick: () => boolean;
  /** Whether a press is held right now or just opened the tabs (the phone's own long-press menu is kept away then). */
  busy: () => boolean;
}

export function createHold(onHold: () => void, timers: { set: (f: () => void, ms: number) => number; clear: (id: number) => void } = { set: (f, ms) => window.setTimeout(f, ms), clear: (id) => window.clearTimeout(id) }): Hold {
  let timer = 0;
  let at: [number, number] | null = null;
  let fired = false;
  const stop = () => {
    if (timer) timers.clear(timer);
    timer = 0;
    at = null;
  };
  return {
    down(x, y) {
      stop();
      fired = false;
      at = [x, y];
      timer = timers.set(() => {
        timer = 0;
        at = null;
        fired = true;
        onHold();
      }, HOLD_MS);
    },
    move(x, y) {
      if (at && Math.hypot(x - at[0], y - at[1]) > HOLD_SLOP) stop();
    },
    up: stop,
    eatClick() {
      const was = fired;
      fired = false;
      return was;
    },
    busy: () => !!timer || fired,
  };
}
