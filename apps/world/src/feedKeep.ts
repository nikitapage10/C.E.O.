/**
 * The last real answer of a public feed, kept on this device so the Desk can paint it at once and refresh behind it
 * (#513). Same idea as the Security and Visual QA feeds. Only the Foundry's public GitHub feeds go through here;
 * nothing private (the Relay, the Exchange) is ever kept. Every read and write falls back silently.
 */

/** A kept copy older than this is dropped, never painted. */
export const KEEP_MAX_MS = 24 * 3_600_000;

export interface Kept<T> {
  value: T;
  /** When this device fetched it (ms). */
  at: number;
}

/** Keep `value` as the answer fetched at `at`. Storage full, blocked or missing: this visit still has it. */
export function keepFeed(key: string, value: unknown, at = Date.now()): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, at }));
  } catch {
    // Private window, quota or no storage: nothing kept.
  }
}

/** The kept answer, or null when there is none, it is over a day old (or from the future), or `isShape` doesn't accept it. */
export function readKept<T>(key: string, isShape: (v: unknown) => v is T, now = Date.now()): Kept<T> | null {
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? "null") as { value?: unknown; at?: unknown } | null;
    if (!kept || typeof kept.at !== "number" || !Number.isFinite(kept.at)) return null;
    if (kept.at > now + 60_000 || now - kept.at > KEEP_MAX_MS) return null;
    return isShape(kept.value) ? { value: kept.value, at: kept.at } : null;
  } catch {
    return null;
  }
}
