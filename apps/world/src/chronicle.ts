import { useEffect } from "react";
import { create } from "zustand";
import type { DayPage, HistoryEntry, Remark, RoomId, WorldFeed } from "../../../api/_world/types.ts";

/**
 * The living Lattice as the browser sees it (docs/WORLD.md): the saved world from api/world.ts. The Lattice loads it
 * on open, so the agents pick up where they left off; the Desk reads it for the Chronicle, the Usage panel and the
 * builders' remarks on the Changelog. Kept free of the Lattice's own code: the Desk imports this.
 */

export type { DayPage, HistoryEntry, Remark, RoomId, WorldFeed };

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
