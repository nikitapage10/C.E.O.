import { create } from "zustand";
import { useDeskAuth } from "../signin.ts";

/**
 * "Asked Skippy" (#273), browser side: what Nikita asked Skippy on the Desk, kept by room. Skippy tags each answer with
 * the room it belongs with, and the function keeps the turn there (api/_skippy/log.ts); each room's Desk page reads its
 * own from GET /api/skippy-log?room=<room>, which answers only a signed-in Desk. Everything here is private: the panel
 * wraps it in <Private> for Hide mode, it is forgotten on sign-out, and none of it reaches the Lattice or a public page.
 */

export type AskedRoom = "green" | "exchange" | "boiler" | "foundry" | "relay";

export interface AskedTurn {
  at: string;
  question: string;
  answer: string;
  model: string;
}

/** "idle" before the first read; "signed-out" without the Desk session; "off" where the route doesn't exist (a local preview). */
export type AskedStatus = "idle" | "signed-out" | "off" | "live" | "failed";

const PATH = "/api/skippy-log";
const ROOMS: readonly AskedRoom[] = ["green", "exchange", "boiler", "foundry", "relay"];
/** The most the panel keeps of what the function sends (it sends at most fifty). */
export const ASKED_MAX = 50;

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The function's answer, checked again: the turns that fit the shape, newest first. Null when it isn't one. */
export function readAsked(v: unknown, room: AskedRoom): AskedTurn[] | null {
  const b = v as { room?: unknown; turns?: unknown } | null;
  if (!b || typeof b !== "object" || b.room !== room || !Array.isArray(b.turns)) return null;
  const out: AskedTurn[] = [];
  for (const t of b.turns as unknown[]) {
    const r = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const at = typeof r.at === "string" && Number.isFinite(Date.parse(r.at)) ? r.at : "";
    const question = clip(r.question, 600);
    const answer = clip(r.answer, 700);
    if (!at || !question || !answer) continue;
    out.push({ at, question, answer, model: clip(r.model, 40) });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, ASKED_MAX);
}

/** "Opus" or "Sonnet" from a model id; the id itself otherwise. */
export function modelName(id: string): string {
  const m = /claude-(opus|sonnet|haiku)/i.exec(id);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase() : id;
}

/** "just now", "12 min ago", "3 h ago", "Oct 14". */
export function whenAsked(at: string, now: number): string {
  const t = Date.parse(at);
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface RoomView {
  status: AskedStatus;
  turns: AskedTurn[];
}

interface AskedStore {
  rooms: Partial<Record<AskedRoom, RoomView>>;
  refresh: (room: AskedRoom, doFetch?: typeof fetch) => Promise<void>;
}

export const useAsked = create<AskedStore>((set) => {
  const put = (room: AskedRoom, view: RoomView) => set((s) => ({ rooms: { ...s.rooms, [room]: view } }));
  return {
    rooms: {},
    refresh: async (room, doFetch = fetch) => {
      if (!ROOMS.includes(room)) return;
      const auth = useDeskAuth.getState().auth.status;
      if (auth === "checking") return;
      if (auth === "off") return put(room, { status: "off", turns: [] });
      // Signed out: forget what was shown, so nothing private lingers on the page.
      if (auth !== "in") return put(room, { status: "signed-out", turns: [] });
      try {
        const res = await doFetch(`${PATH}?room=${room}`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
        const json = (res.headers.get("content-type") ?? "").includes("json");
        if (res.status === 401) {
          useDeskAuth.getState().lost();
          return put(room, { status: "signed-out", turns: [] });
        }
        if (res.status === 404 || res.status === 503 || !json) return put(room, { status: "off", turns: [] });
        const got = res.ok ? readAsked(await res.json(), room) : null;
        if (!got) return set((s) => ({ rooms: { ...s.rooms, [room]: { status: "failed", turns: s.rooms[room]?.turns ?? [] } } }));
        put(room, { status: "live", turns: got });
      } catch {
        set((s) => ({ rooms: { ...s.rooms, [room]: { status: "failed", turns: s.rooms[room]?.turns ?? [] } } }));
      }
    },
  };
});
