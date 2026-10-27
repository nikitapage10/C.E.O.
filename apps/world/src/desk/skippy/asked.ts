import { create } from "zustand";
import { useDeskAuth } from "../signin.ts";

/**
 * "Asked Skippy" (#273), browser side: what Nikita asked Skippy on the Desk, kept by room. Skippy tags each answer with
 * the room it belongs with, and the function keeps the turn there (api/_skippy/log.ts); each room's Desk page reads its
 * own from GET /api/skippy-log?room=<room>, which answers only a signed-in Desk. Everything here is private: the panel
 * wraps it in <Private> for Hide mode, it is forgotten on sign-out, and none of it reaches the Lattice or a public page.
 */

/** "kernel" (#480) is Skippy, the Magnificent's own thread: builds, look-ups across rooms, real work. */
export type AskedRoom = "green" | "exchange" | "boiler" | "foundry" | "relay" | "kernel";

/** A submind's answer card (#341, api/_skippy/log.ts `AnswerCard`): the numbers side by side, the verdict, what decided it, the sources. */
export interface AskedCard {
  verdict: string;
  cols: string[];
  rows: { label: string; values: (number | null)[] }[];
  metrics: string[];
  sources: string[];
}

export interface AskedTurn {
  /** The turn's id (16 hex characters), for the chat to find its answer (#341). */
  id?: string;
  at: string;
  question: string;
  answer: string;
  model: string;
  /** Handed off (#312): who it went to, "skippy" or a submind's id. */
  needs?: string;
  /** The answer that came back for a hand-off. */
  followUp?: { from: string; text: string; at: string; card?: AskedCard; final?: false };
}

/** Who a hand-off went to, by name (api/_skippy/log.ts, ROOM_SUBMINDS). */
const HANDED_TO: Record<string, string> = { skippy: "Skippy", ember: "The Builder", ticker: "The Bookie", turf: "The Commentator", soot: "The Pessimist", static: "The Messenger" };
export const handedName = (id: string): string => HANDED_TO[id] ?? "Skippy";

/** "idle" before the first read; "signed-out" without the Desk session; "off" where the route doesn't exist (a local preview). */
export type AskedStatus = "idle" | "signed-out" | "off" | "live" | "failed";

const PATH = "/api/skippy-log";
const ROOMS: readonly AskedRoom[] = ["green", "exchange", "boiler", "foundry", "relay", "kernel"];
/** The most the panel keeps of what the function sends (it sends at most fifty). */
export const ASKED_MAX = 50;

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A card as the function sent it, checked again with the function's caps; null when it isn't one. */
export function readCard(v: unknown): AskedCard | null {
  const c = (v && typeof v === "object" && !Array.isArray(v) ? v : null) as Record<string, unknown> | null;
  const verdict = c ? clip(c.verdict, 200) : "";
  if (!c || !verdict) return null;
  const list = (x: unknown, max: number, each: number) => (Array.isArray(x) ? x : []).map((s) => clip(s, each)).filter(Boolean).slice(0, max);
  const cols = list(c.cols, 3, 24);
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  const rows = (Array.isArray(c.rows) ? c.rows : [])
    .map((r) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const label = clip(o.label, 48);
      return label ? { label, values: cols.map((_, i) => num(Array.isArray(o.values) ? o.values[i] : null)) } : null;
    })
    .filter((r): r is AskedCard["rows"][number] => r !== null)
    .slice(0, 6);
  return { verdict, cols: rows.length ? cols : [], rows: cols.length ? rows : [], metrics: list(c.metrics, 5, 140), sources: list(c.sources, 5, 80) };
}

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
    const needs = typeof r.needs === "string" && r.needs in HANDED_TO ? r.needs : undefined;
    const f = (r.followUp && typeof r.followUp === "object" ? r.followUp : null) as Record<string, unknown> | null;
    const fText = f ? clip(f.text, 700) : "";
    const fAt = f && typeof f.at === "string" && Number.isFinite(Date.parse(f.at)) ? f.at : "";
    const card = f ? readCard(f.card) : null;
    const followUp = f && fText && fAt && typeof f.from === "string" && f.from in HANDED_TO ? { from: f.from, text: fText, at: fAt, ...(card && { card }), ...(f.final === false && { final: false as const }) } : undefined;
    const id = typeof r.id === "string" && /^[0-9a-f]{16}$/.test(r.id) ? r.id : undefined;
    out.push({ ...(id && { id }), at, question, answer, model: clip(r.model, 40), ...(needs && { needs }), ...(followUp && { followUp }) });
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
