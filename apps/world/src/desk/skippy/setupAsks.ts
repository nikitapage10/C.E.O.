import { create } from "zustand";
import { useDeskAuth } from "../signin.ts";

/**
 * Setup asks (#324), browser side: what a submind's thread wants set up and is waiting on Nikita's OK for
 * (api/_room/setup.ts). One read of GET /api/setup-asks serves every room page; it answers only a signed-in Desk, so
 * nothing here is ever fetched signed out, and it is forgotten on sign-out. Approve and Decline go back to the same
 * path in the passkey session. The Lattice never reads it.
 */

export type SetupRoom = "foundry" | "boiler" | "green" | "exchange";
const ROOMS: readonly SetupRoom[] = ["foundry", "boiler", "green", "exchange"];

export type SetupRoute = "managed-identity" | "oidc" | "key-vault-flow" | "browser";
export type SetupState = "open" | "approved" | "declined" | "done" | "dropped";
const ROUTES: readonly SetupRoute[] = ["managed-identity", "oidc", "key-vault-flow", "browser"];
const STATES: readonly SetupState[] = ["open", "approved", "declined", "done", "dropped"];

export interface SetupAsk {
  id: string;
  at: string;
  room: SetupRoom;
  title: string;
  where: string;
  service: string;
  changes: string;
  why: string;
  cost: string;
  reversible: boolean;
  route: SetupRoute;
  state: SetupState;
  decidedAt?: string;
  closedAt?: string;
  trail?: string;
}

/** How each route does it, in a few words for the box. The first two need no key at all. */
export const ROUTE_LABEL: Record<SetupRoute, string> = {
  "managed-identity": "Managed identity: no key anywhere",
  oidc: "OIDC federation: no key anywhere",
  "key-vault-flow": "Machine to machine: the key lands straight in the Key Vault",
  browser: "In your browser: it stops at every sign-in and passkey",
};

/** The Trail line's step for a closed ask. */
export const TRAIL_STEP: Partial<Record<SetupState, string>> = { done: "Done", declined: "Declined", dropped: "Dropped" };

/** "off" where the route doesn't exist (a local preview, or Vercel: setup asks are Azure only). */
export type SetupStatus = "idle" | "signed-out" | "off" | "live" | "failed";

const PATH = "/api/setup-asks";
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : "");

/** One ask from the function, checked again: null when it isn't one. */
export function readSetupAsk(v: unknown): SetupAsk | null {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const room = ROOMS.find((x) => x === r.room);
  const route = ROUTES.find((x) => x === r.route);
  const state = STATES.find((x) => x === r.state);
  const id = typeof r.id === "string" && /^[a-z0-9-]{8,40}$/.test(r.id) ? r.id : "";
  const at = iso(r.at);
  const parts = { title: clip(r.title, 120), where: clip(r.where, 60), service: clip(r.service, 60), changes: clip(r.changes, 200), why: clip(r.why, 200), cost: clip(r.cost, 120) };
  if (!room || !route || !state || !id || !at || typeof r.reversible !== "boolean" || Object.values(parts).some((p) => !p)) return null;
  const decidedAt = iso(r.decidedAt);
  const closedAt = iso(r.closedAt);
  const trail = clip(r.trail, 200);
  return { id, at, room, ...parts, reversible: r.reversible, route, state, ...(decidedAt && { decidedAt }), ...(closedAt && { closedAt }), ...(trail && { trail }) };
}

/** The function's answer: the asks that fit the shape, in its order. Null when it isn't one. */
export function readSetupAsks(v: unknown): SetupAsk[] | null {
  const b = v as { asks?: unknown } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.asks)) return null;
  return (b.asks as unknown[]).map(readSetupAsk).filter((a): a is SetupAsk => a !== null).slice(0, 50);
}

/** Still waiting: on Nikita (open) or on the thread (approved). */
export const waiting = (a: Pick<SetupAsk, "state">) => a.state === "open" || a.state === "approved";

export type Decision = "approve" | "decline";
export type DecideResult = "ok" | "signed-out" | "decided" | "failed";

interface SetupStore {
  status: SetupStatus;
  asks: SetupAsk[];
  /** The ask a tap is being sent for. */
  busy: string | null;
  refresh: (doFetch?: typeof fetch) => Promise<void>;
  decide: (id: string, decision: Decision, doFetch?: typeof fetch) => Promise<DecideResult>;
}

export const useSetupAsks = create<SetupStore>((set, get) => ({
  status: "idle",
  asks: [],
  busy: null,
  refresh: async (doFetch = fetch) => {
    const auth = useDeskAuth.getState().auth.status;
    if (auth === "checking") return;
    if (auth === "off") return set({ status: "off", asks: [] });
    // Signed out: never asked, and anything shown is forgotten.
    if (auth !== "in") return set({ status: "signed-out", asks: [] });
    try {
      const res = await doFetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      const json = (res.headers.get("content-type") ?? "").includes("json");
      if (res.status === 401) {
        useDeskAuth.getState().lost();
        return set({ status: "signed-out", asks: [] });
      }
      if (res.status === 404 || res.status === 503 || !json) return set({ status: "off", asks: [] });
      const got = res.ok ? readSetupAsks(await res.json()) : null;
      if (!got) return set({ status: "failed" });
      set({ status: "live", asks: got });
    } catch {
      set({ status: "failed" });
    }
  },
  decide: async (id, decision, doFetch = fetch) => {
    if (get().busy) return "failed";
    set({ busy: id });
    try {
      const res = await doFetch(PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ id, decision }),
      });
      if (res.status === 401) {
        useDeskAuth.getState().lost();
        set({ status: "signed-out", asks: [] });
        return "signed-out";
      }
      const ask = res.ok ? readSetupAsk(((await res.json().catch(() => null)) as { ask?: unknown } | null)?.ask) : null;
      if (ask) set((s) => ({ asks: s.asks.map((a) => (a.id === id ? ask : a)) }));
      else await get().refresh(doFetch);
      return ask ? "ok" : res.status === 409 ? "decided" : "failed";
    } catch {
      return "failed";
    } finally {
      set({ busy: null });
    }
  },
}));
