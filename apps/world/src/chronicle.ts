import { useEffect } from "react";
import { create } from "zustand";
import type { DayPage, DayStoryView, HistoryEntry, Remark, RoomId, WeekStoryView, WorldFeed } from "../../../api/_world/types.ts";

/**
 * The living Lattice as the browser sees it (docs/WORLD.md): the saved world from api/world.ts. The Lattice loads it
 * on open, so the agents pick up where they left off; the Desk reads it for the Chronicle, the Usage panel and the
 * builders' remarks on the Changelog. Kept free of the Lattice's own code: the Desk imports this.
 */

export type { DayPage, DayStoryView, HistoryEntry, Remark, RoomId, WorldFeed };

/** "off": the world isn't saving yet (no store connected, or a local preview without the functions). */
export type ChronicleStatus = "idle" | "loading" | "ready" | "off" | "failed";

interface ChronicleStore {
  status: ChronicleStatus;
  feed: WorldFeed | null;
  /** Chronicle pages read so far, by day. */
  pages: Record<string, DayPage | "loading" | "failed">;
  load: () => Promise<WorldFeed | null>;
  loadDay: (day: string) => Promise<void>;
}

const offline = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("offline");

async function getJson<T>(url: string): Promise<T | "off"> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  // A local preview serves the app's HTML for /api/…; a store that isn't connected answers 503.
  if (res.status === 503 || res.status === 404 || !(res.headers.get("content-type") ?? "").includes("json")) return "off";
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

let inflight: Promise<WorldFeed | null> | null = null;

export const useChronicle = create<ChronicleStore>((set, get) => ({
  status: "idle",
  feed: null,
  pages: {},
  load: () => {
    if (offline()) {
      set({ status: "off" });
      return Promise.resolve(null);
    }
    inflight ??= (async () => {
      if (!get().feed) set({ status: "loading" });
      try {
        const got = await getJson<WorldFeed>("/api/world");
        if (got === "off") {
          set({ status: "off" });
          return null;
        }
        set({ status: "ready", feed: got });
        return got;
      } catch {
        set({ status: get().feed ? "ready" : "failed" });
        return get().feed;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
  loadDay: async (day) => {
    const have = get().pages[day];
    if (have && have !== "failed") return;
    set({ pages: { ...get().pages, [day]: "loading" } });
    try {
      const got = await getJson<DayPage>(`/api/world?day=${encodeURIComponent(day)}`);
      set({ pages: { ...get().pages, [day]: got === "off" ? { day, entries: [], recap: null } : got } });
    } catch {
      set({ pages: { ...get().pages, [day]: "failed" } });
    }
  },
}));

/* ── The day's story (issue #95): the Historian reading the day aloud ── */

/** A day's story as the Desk holds it: the answer, or where its read stands. */
export type StoryState = DayStoryView | "loading" | "failed" | "off";

interface StoryStore {
  stories: Record<string, StoryState>;
  loadStory: (day: string) => Promise<void>;
  /** The Desk's "Make it now" (in its sign-in session, #132): says why not, when it wasn't made. */
  makeStory: (day: string) => Promise<{ made: boolean; reason?: string; error?: string }>;
}

export const useDayStory = create<StoryStore>((set, get) => ({
  stories: {},
  loadStory: async (day) => {
    const have = get().stories[day];
    if (have && have !== "failed") return;
    set({ stories: { ...get().stories, [day]: "loading" } });
    try {
      const got = await getJson<DayStoryView>(`/api/day-story?day=${encodeURIComponent(day)}`);
      set({ stories: { ...get().stories, [day]: got } });
    } catch {
      set({ stories: { ...get().stories, [day]: "failed" } });
    }
  },
  makeStory: async (day) => {
    try {
      const res = await fetch("/api/day-story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day }), credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as { made?: boolean; reason?: string; error?: string; story?: DayStoryView | null };
      if (!res.ok) return { made: false, error: body.error ?? `${res.status}` };
      if (body.story) set({ stories: { ...get().stories, [day]: body.story } });
      return { made: Boolean(body.made), reason: body.reason };
    } catch {
      return { made: false, error: "network" };
    }
  },
}));

/* ── The week in Ilyr (#211): Sunday evening's story, kept by the week's Monday ── */

interface WeekStoreShape {
  weeks: Record<string, WeekStoryView | "loading" | "failed">;
  loadWeek: (week: string) => Promise<void>;
}

export const useWeekStory = create<WeekStoreShape>((set, get) => ({
  weeks: {},
  loadWeek: async (week) => {
    const have = get().weeks[week];
    if (have && have !== "failed") return;
    set({ weeks: { ...get().weeks, [week]: "loading" } });
    try {
      const got = await getJson<WeekStoryView>(`/api/day-story?week=${encodeURIComponent(week)}`);
      set({ weeks: { ...get().weeks, [week]: got === "off" ? { week, ready: false } : got } });
    } catch {
      set({ weeks: { ...get().weeks, [week]: "failed" } });
    }
  },
}));

/** "1:42": a story's length. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The world feed, loaded once and refreshed every ten minutes while the page is showing (the world moves hourly). */
export function useWorldFeed(): { status: ChronicleStatus; feed: WorldFeed | null } {
  const status = useChronicle((s) => s.status);
  const feed = useChronicle((s) => s.feed);
  useEffect(() => {
    void useChronicle.getState().load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void useChronicle.getState().load();
    }, 10 * 60_000);
    return () => clearInterval(timer);
  }, []);
  return { status, feed };
}

/* ── Plain helpers (tested) ── */

const MT = "America/Denver";

/** Today's page in the Chronicle: the Mountain-time day, as the step files it. */
export function chronicleDay(at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** "Today", "Yesterday", or "Sunday 11 October". */
export function dayTitle(day: string, now: number): string {
  if (day === chronicleDay(now)) return "Today";
  if (day === chronicleDay(now - 86_400_000)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
}

/** "3 pm", in Mountain time like the day pages, so an hour never sits under the wrong day. */
export function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: MT, hour: "numeric", minute: "2-digit" }).replace(":00", "").toLowerCase();
}

/** The hours written since Nikita was last here, newest first. */
export function sinceAway(recent: HistoryEntry[], awaySince: number): HistoryEntry[] {
  return recent.filter((e) => Date.parse(e.at) > awaySince).reverse();
}

/** Each builder's latest remark, by issue: what the Changelog shows next to a shipped job. */
export function remarksByIssue(remarks: (Remark & { at: string })[]): Map<number, Remark & { at: string }> {
  const out = new Map<number, Remark & { at: string }>();
  for (const r of remarks) if (!out.has(r.issue)) out.set(r.issue, r);
  return out;
}

/** One line for the Lattice to play: who says what, and to whom (the other speaker in the scene). */
export interface Playback {
  who: string;
  to: string | null;
  text: string;
  room: RoomId;
}

/**
 * What the Lattice plays when it opens, so the agents carry on where they left off: the latest hour's scenes (the
 * room in view first), then its builders' remarks. Only agents the Lattice has are used.
 */
export function playbackOf(entry: HistoryEntry | null | undefined, has: (id: string) => boolean, focus: RoomId | null, max = 10): Playback[] {
  if (!entry) return [];
  const scenes = [...entry.scenes].sort((a, b) => Number(b.room === focus) - Number(a.room === focus));
  const out: Playback[] = [];
  for (const s of scenes) {
    const speakers = [...new Set(s.lines.map((l) => l.who))];
    for (const l of s.lines) {
      if (!has(l.who)) continue;
      out.push({ who: l.who, to: speakers.find((w) => w !== l.who && has(w)) ?? null, text: l.text, room: s.room });
    }
  }
  for (const r of entry.remarks) if (has(r.who)) out.push({ who: r.who, to: null, text: r.text, room: "foundry" });
  return out.slice(0, max);
}
