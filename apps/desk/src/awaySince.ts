import { useEffect, useState } from "react";

/**
 * "While you were away" needs to know when Nikita was last on the Desk. The browser remembers: the Desk stamps
 * `desk.lastSeen` every minute while the tab is visible and when it hides or closes. On load the previous stamp is read
 * once and held fixed for the visit as `awaySince`.
 */

const KEY = "desk.lastSeen";
const MINUTE = 60_000;
/** Without a stamp (first visit, storage blocked) "away" means the last twelve hours. */
export const FIRST_VISIT_MS = 12 * 3_600_000;
/** A tab hidden longer than this counts as being away; coming back moves `awaySince` forward to when it was hidden. */
export const HIDDEN_AWAY_MS = 10 * MINUTE;

export function readLastSeen(): number | null {
  try {
    const n = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastSeen(at: number) {
  try {
    window.localStorage.setItem(KEY, String(at));
  } catch {
    /* storage blocked: the 12-hour fallback applies next time */
  }
}

/** The stored stamp when it is a sane time in the past, else the last twelve hours. */
export function initialAwaySince(stored: number | null, now: number): number {
  return stored !== null && stored <= now ? stored : now - FIRST_VISIT_MS;
}

/** When Nikita left, as far as this visit knows: the moment the tab was hidden if it stayed hidden long enough, else the current value. */
export function awaySinceOnReturn(current: number, hiddenAt: number | null, now: number): number {
  return hiddenAt !== null && now - hiddenAt > HIDDEN_AWAY_MS ? Math.max(current, hiddenAt) : current;
}

export function useAwaySince(): number {
  const [awaySince, setAwaySince] = useState(() => initialAwaySince(readLastSeen(), Date.now()));

  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const stamp = () => writeLastSeen(Date.now());
    if (hiddenAt === null) stamp();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") stamp();
    }, MINUTE);
    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        hiddenAt = now;
        writeLastSeen(now);
      } else {
        setAwaySince((cur) => awaySinceOnReturn(cur, hiddenAt, now));
        hiddenAt = null;
        writeLastSeen(now);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stamp);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stamp);
    };
  }, []);

  return awaySince;
}
