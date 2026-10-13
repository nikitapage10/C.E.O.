import { create } from "zustand";
import type { WorldClock } from "../../../api/_world/types.ts";
import { useSystems, type LinkState } from "./systems.ts";

/**
 * The world clock (issue #53): whether the living Lattice took its hourly step (docs/WORLD.md). Polls
 * GET /api/world-step (never cached) and feeds the Desk's Systems page and the Boiler Room's "World clock" pipe, so a
 * stalled hour shows at a glance instead of four hours later. Imports nothing from the 3D world; the Desk loads it.
 *
 * Working while the last step is under 70 minutes old (the step runs at :05, and may land a few minutes late), slow
 * once an hour is overdue, down past three hours or when the endpoint doesn't answer.
 */

export type { WorldClock };

/** Past this, an hour is overdue: the pipe coughs and the card goes amber. */
export const CLOCK_SLOW_MS = 70 * 60_000;
/** Past this, the clock has stopped: the pipe bursts. */
export const CLOCK_DOWN_MS = 3 * 60 * 60_000;
/** How often the Desk and the Lattice ask. */
const POLL_MS = 60_000;

/** "idle" before the first answer; "off" when the world isn't saving here (a local preview, or no store). */
export type ClockStatus = "idle" | "ready" | "off" | "failed";

/** The clock's state from its last reading: the same four states as every other link. */
export function clockState(reading: Pick<WorldClock, "at"> | null, status: ClockStatus, now: number): LinkState {
  if (status === "failed") return "down";
  if (status !== "ready" || !reading?.at) return "off";
  const age = now - Date.parse(reading.at);
  if (!Number.isFinite(age)) return "off";
  if (age < CLOCK_SLOW_MS) return "ok";
  if (age < CLOCK_DOWN_MS) return "slow";
  return "down";
}

/** "5 min", "1 h 05 min", "3 h". Never negative. */
export function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, "0")} min` : `${h} h`;
}

/** "2:05 pm", in Mountain time like the Chronicle. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" }).toLowerCase();
}

/** The clock's one-line reading: the headline on the card and the plaque on the pipe. */
export function clockHeadline(reading: Pick<WorldClock, "at"> | null, status: ClockStatus, now: number): string {
  const state = clockState(reading, status, now);
  if (status === "failed") return "The clock isn't answering";
  if (state === "off") return status === "ready" ? "No hour taken yet" : status === "idle" ? "Reading the clock…" : "Not running here";
  const age = now - Date.parse(reading!.at!);
  if (state === "ok") return "On time";
  if (state === "slow") return `An hour is overdue: ${span(age)} since the last`;
  return `Stalled: ${span(age)} since the last hour`;
}

/** When the next hour is due, said plainly: "in 32 min", "any minute now", "overdue by 25 min". */
export function nextLine(reading: Pick<WorldClock, "at" | "nextAt"> | null, now: number): string {
  if (!reading?.nextAt || !reading.at) return "After the first step";
  const left = Date.parse(reading.nextAt) - now;
  if (left > 0) return `in ${span(left)}`;
  return now - Date.parse(reading.at) < CLOCK_SLOW_MS ? "any minute now" : `overdue by ${span(-left)}`;
}

/** How far through its hour the clock is, 0..1: the pipe's gauge, which fills toward overdue. */
export function clockLoad(reading: Pick<WorldClock, "at"> | null, now: number): number {
  if (!reading?.at) return 0;
  return Math.min(1, Math.max(0.05, (now - Date.parse(reading.at)) / CLOCK_SLOW_MS));
}

interface ClockStore {
  status: ClockStatus;
  reading: WorldClock | null;
  /** Date.now() of the last answer, good or bad. */
  checkedAt: number | null;
  set: (patch: Partial<Omit<ClockStore, "set">>) => void;
}

export const useWorldClock = create<ClockStore>((set) => ({ status: "idle", reading: null, checkedAt: null, set: (patch) => set(patch) }));

/** The Boiler Room's pipe and the Systems card both read this link. */
function syncLink(now = Date.now()): void {
  const { reading, status } = useWorldClock.getState();
  const state = clockState(reading, status, now);
  const src = reading?.source === "claude" ? "CLAUDE" : reading?.source === "scripted" ? "SCRIPTED" : null;
  const note = reading?.at && status !== "failed" ? `LAST ${clockTime(reading.at).toUpperCase()}${src ? ` · ${src}` : ""}` : undefined;
  useSystems.getState().setLink("world", { state, load: clockLoad(reading, now), lastSeen: reading?.at ? Date.parse(reading.at) : null, note });
}

export async function refreshWorldClock(): Promise<void> {
  const { set } = useWorldClock.getState();
  try {
    const res = await fetch("/api/world-step", { headers: { Accept: "application/json" } });
    const json = (res.headers.get("content-type") ?? "").includes("json");
    // A local preview serves the app's HTML for /api/…; a world with no store connected answers 503.
    if (res.status === 404 || res.status === 503 || !json) set({ status: "off", checkedAt: Date.now() });
    else if (!res.ok) set({ status: "failed", checkedAt: Date.now() });
    else set({ status: "ready", reading: (await res.json()) as WorldClock, checkedAt: Date.now() });
  } catch {
    set({ status: "failed", checkedAt: Date.now() });
  }
  syncLink();
}

let started = false;

/** Start reading the clock (once per page): every minute while the tab is showing, and straight away on return. */
export function startWorldClock(): void {
  if (started || typeof window === "undefined" || new URLSearchParams(window.location.search).has("offline")) return;
  // Preview mode cycles every pipe through its states (systems.ts); the clock leaves it alone.
  const q = new URLSearchParams(window.location.search);
  if (q.has("demo") || q.get("boiler") === "demo") return;
  started = true;
  void refreshWorldClock();
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshWorldClock();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshWorldClock();
  });
}
