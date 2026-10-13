import { useSyncExternalStore } from "react";
import type { VisualQaFeed, VisualQaRun } from "../../../../../api/visual-qa-feed.ts";

/**
 * The latest Visual QA run (#91) for Systems > Foundry, read from api/visual-qa-feed.ts only while the page is open.
 * The last answer is kept on this device, so the panel shows it at once and refreshes behind it; polling runs only
 * while the tab is visible. Only real data: before the first run the panel says it is waiting for it.
 */

export type { VisualQaFeed, VisualQaRun };

export interface VisualQaState {
  feed: VisualQaFeed | null;
  /** `waiting`: nothing yet. `live`: the last read worked. `stale`: the last read failed, showing what we had. */
  status: "waiting" | "live" | "stale";
}

const KEY = "ceo.visualQaFeed";
const POLL_MS = 300_000;
const REVIEWS = ["reviewed", "partial", "skipped", "unavailable", "unknown"];
const RUNS = ["pass", "fail", "other"];
const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1000;

/** Just enough of a check that an answer has the feed's shape before the panel draws it. */
export function isVisualQaFeed(v: unknown): v is VisualQaFeed {
  const f = v as Partial<VisualQaFeed> | null;
  if (!f || typeof f !== "object" || typeof f.at !== "string" || !("latest" in f)) return false;
  if (f.latest === null) return true;
  const r = f.latest as Partial<VisualQaRun> | undefined;
  return (
    !!r &&
    typeof r.at === "string" &&
    typeof r.url === "string" &&
    /^https:\/\/github\.com\/nikitapage10\/C\.E\.O\.\/actions\/runs\/\d+$/.test(r.url) &&
    RUNS.includes(String(r.run)) &&
    REVIEWS.includes(String(r.review)) &&
    count(r.rooms) &&
    count(r.findings) &&
    count(r.blockers)
  );
}

function fromDevice(): VisualQaState {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (isVisualQaFeed(kept)) return { feed: kept, status: "stale" };
  } catch {
    // Private window or a broken entry: start empty.
  }
  return { feed: null, status: "waiting" };
}

let state: VisualQaState | null = null;
const listeners = new Set<() => void>();
const get = (): VisualQaState => (state ??= fromDevice());
const set = (next: VisualQaState) => {
  state = next;
  for (const fn of listeners) fn();
};

let flying = false;
async function refresh(): Promise<void> {
  if (flying) return;
  flying = true;
  try {
    const res = await fetch("/api/visual-qa-feed", { headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(String(res.status));
    const feed: unknown = await res.json();
    if (!isVisualQaFeed(feed)) throw new Error("shape");
    set({ feed, status: "live" });
    try {
      localStorage.setItem(KEY, JSON.stringify(feed));
    } catch {
      // Storage full or blocked: this visit still has it.
    }
  } catch {
    const cur = get();
    if (cur.status !== (cur.feed ? "stale" : "waiting")) set({ ...cur, status: cur.feed ? "stale" : "waiting" });
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

/** The latest run: what this device last had at once, then live. */
export function useVisualQa(): VisualQaState {
  return useSyncExternalStore(subscribe, get);
}

/** The panel's headline and pill for a run, in plain words. */
export function describeRun(run: VisualQaRun | null): { tone: "ok" | "slow" | "down" | "off"; pill: string; line: string } {
  if (!run) return { tone: "off", pill: "No run yet", line: "Waiting for the first run" };
  if (run.run === "fail") return { tone: "down", pill: "Tour failed", line: "The room tour didn't finish; nothing was reviewed" };
  const found = `${run.findings} ${run.findings === 1 ? "finding" : "findings"}`;
  switch (run.review) {
    case "reviewed":
    case "partial":
      if (run.blockers > 0) {
        return { tone: "down", pill: `${run.blockers} ${run.blockers === 1 ? "blocker" : "blockers"}`, line: `${found} in ${run.rooms} rooms; the blockers went to the fix lane` };
      }
      return {
        tone: run.review === "partial" ? "slow" : "ok",
        pill: run.findings ? "Notices only" : "All clear",
        line: `${run.rooms} rooms checked, ${found}${run.review === "partial" ? " (some rooms went unanswered)" : ""}`,
      };
    case "skipped":
      return { tone: "off", pill: "Not reviewed", line: "Clips recorded; Gemini's review was skipped (no key yet, or the day's cap)" };
    case "unavailable":
      return { tone: "slow", pill: "Gemini unavailable", line: "Clips recorded; Gemini didn't answer this time" };
    default:
      return { tone: "off", pill: "No headline", line: "The run finished without a headline" };
  }
}
