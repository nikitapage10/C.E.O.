import { useSyncExternalStore } from "react";
import type { SecurityFeed } from "../../../../../api/security-feed.ts";

/**
 * The live half of Systems > Security: the posture feed (api/security-feed.ts), read only while the page is open.
 * The last answer is kept on this device, so the page shows it at once and refreshes behind it; polling runs only
 * while the tab is visible, and stops when the page closes.
 */

export type { SecurityFeed };

export interface FeedState {
  feed: SecurityFeed | null;
  /** When this device last got an answer (ms), or null before the first. */
  fetchedAt: number | null;
  /** `waiting`: nothing yet. `live`: the last read worked. `stale`: the last read failed, showing what we had. */
  status: "waiting" | "live" | "stale";
}

const KEY = "ceo.securityFeed";
const POLL_MS = 120_000;

function fromDevice(): FeedState {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as { feed?: unknown; fetchedAt?: unknown } | null;
    if (kept && isFeed(kept.feed) && typeof kept.fetchedAt === "number") return { feed: kept.feed, fetchedAt: kept.fetchedAt, status: "stale" };
  } catch {
    // Private window or a broken entry: start empty.
  }
  return { feed: null, fetchedAt: null, status: "waiting" };
}

/** Just enough of a check that an answer has the feed's shape before the page draws it. */
export function isFeed(v: unknown): v is SecurityFeed {
  const f = v as Partial<SecurityFeed> | null;
  return !!f && typeof f === "object" && typeof f.at === "string" && Array.isArray(f.workflows) && Array.isArray(f.features) && !!f.alerts && typeof f.alerts === "object";
}

let state: FeedState | null = null;
const listeners = new Set<() => void>();
const get = (): FeedState => (state ??= fromDevice());
const set = (next: FeedState) => {
  state = next;
  for (const fn of listeners) fn();
};

let flying = false;
async function refresh(): Promise<void> {
  if (flying) return;
  flying = true;
  try {
    const res = await fetch("/api/security-feed", { headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(String(res.status));
    const feed: unknown = await res.json();
    if (!isFeed(feed)) throw new Error("shape");
    const next: FeedState = { feed, fetchedAt: Date.now(), status: "live" };
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ feed, fetchedAt: next.fetchedAt }));
    } catch {
      // Storage full or blocked: this visit still has it.
    }
  } catch {
    const cur = get();
    if (cur.status !== "stale") set({ ...cur, status: cur.feed ? "stale" : "waiting" });
  } finally {
    flying = false;
  }
}

let timer: number | null = null;
const onVisible = () => {
  if (document.visibilityState === "visible") void refresh();
};

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1 && !new URLSearchParams(window.location.search).has("offline")) {
    void refresh();
    timer = window.setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** The posture feed: what this device last had at once, then live. */
export function useSecurityFeed(): FeedState {
  return useSyncExternalStore(subscribe, get);
}
