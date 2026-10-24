import { create } from "zustand";
import { useDeskAuth } from "../signin.ts";

/**
 * The room feed (#281), browser side: short events the active subminds post from their project threads with the feed
 * key (api/_room/feed.ts). One read of GET /api/room-feed serves every room page: signed in to the Desk it carries each
 * event's detail ("full"); otherwise only the titles, scrubbed of money and links on the server ("public"). The
 * Lattice asks for ?view=public every time (useRoomFeedPublic), so a detail never reaches the 3D world.
 */

export type FeedRoom = "foundry" | "boiler" | "green" | "exchange";
export const FEED_ROOMS: readonly FeedRoom[] = ["foundry", "boiler", "green", "exchange"];

export interface FeedEvent {
  id: string;
  at: string;
  room: FeedRoom;
  title: string;
  detail?: string;
}

/** "off" where the route doesn't exist (a local preview, or Vercel: the feed is Azure only). */
export type FeedStatus = "idle" | "off" | "live" | "failed";

const PATH = "/api/room-feed";
export const FEED_MAX = 50;

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The function's answer, checked again: good events, newest first. `full: false` drops every detail. Null when it isn't one. */
export function readFeed(v: unknown, full: boolean): { full: boolean; events: FeedEvent[] } | null {
  const b = v as { view?: unknown; events?: unknown } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.events) || (b.view !== "full" && b.view !== "public")) return null;
  const keepDetail = full && b.view === "full";
  const out: FeedEvent[] = [];
  for (const e of b.events as unknown[]) {
    const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const at = typeof r.at === "string" && Number.isFinite(Date.parse(r.at)) ? r.at : "";
    const id = clip(r.id, 40);
    const title = clip(r.title, 120);
    const room = FEED_ROOMS.find((x) => x === r.room);
    if (!at || !id || !title || !room) continue;
    const detail = keepDetail ? clip(r.detail, 600) : "";
    out.push({ id, at, room, title, ...(detail && { detail }) });
  }
  return { full: keepDetail, events: out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, FEED_MAX) };
}

async function fetchFeed(doFetch: typeof fetch, view: "public" | "auto"): Promise<{ status: FeedStatus; full: boolean; events: FeedEvent[] }> {
  try {
    const res = await doFetch(view === "public" ? `${PATH}?view=public` : PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    const json = (res.headers.get("content-type") ?? "").includes("json");
    if (res.status === 404 || res.status === 503 || !json) return { status: "off", full: false, events: [] };
    const got = res.ok ? readFeed(await res.json(), view !== "public") : null;
    return got ? { status: "live", ...got } : { status: "failed", full: false, events: [] };
  } catch {
    return { status: "failed", full: false, events: [] };
  }
}

interface FeedStore {
  status: FeedStatus;
  /** Whether the events carry their detail (a signed-in Desk). */
  full: boolean;
  events: FeedEvent[];
  refresh: (doFetch?: typeof fetch) => Promise<void>;
}

/** The Desk's copy. Forgets the details on sign-out. */
export const useRoomFeed = create<FeedStore>((set, get) => ({
  status: "idle",
  full: false,
  events: [],
  refresh: async (doFetch = fetch) => {
    const auth = useDeskAuth.getState().auth.status;
    if (auth === "checking") return;
    const got = await fetchFeed(doFetch, auth === "in" ? "auto" : "public");
    if (got.status === "failed") {
      // Keep what is shown, unless it carries details and this browser is no longer signed in.
      const keep = auth === "in" || !get().full;
      return set({ status: "failed", full: keep && get().full, events: keep ? get().events : [] });
    }
    set(got);
  },
}));

/** The Lattice's read: always the public view. */
export function readPublicFeed(doFetch: typeof fetch = fetch) {
  return fetchFeed(doFetch, "public");
}

/** The events the Lattice hasn't said yet: unseen, posted since `since`, the newest one per room. Marks them all seen. */
export function newEvents(events: FeedEvent[], seen: Set<string>, since: number): FeedEvent[] {
  const out: FeedEvent[] = [];
  const rooms = new Set<string>();
  // Newest first from the function: one line per room per read, the newest.
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (Date.parse(e.at) < since || rooms.has(e.room)) continue;
    rooms.add(e.room);
    out.push(e);
  }
  return out;
}
