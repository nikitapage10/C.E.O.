import { create } from "zustand";
import type { PmPosition, PmPositions, PmTrade } from "../../../../../api/_exchange/types.ts";
import { useDeskAuth } from "../signin.ts";

/**
 * Nikita's own Polymarket US positions for the Exchange (#253), browser side: reads GET /api/exchange-positions, which
 * answers only a signed-in Desk (the passkey session), every two minutes while the Exchange is showing. Read-only:
 * nothing here, or on the server behind it, can trade. Dollar values, sizes and P&L are private: the board marks them
 * with <Private> (data-private) for the Desk's Hide mode (#251), and none of it ever reaches Today or any public page.
 * The Lattice's Exchange marquee reads this same store in the signed-in browser only, and masks it while Hide is on
 * (rooms/liveBoards.ts); it never reaches /api/world or the server-side Lattice.
 */

export type { PmPosition, PmPositions, PmTrade };

const PATH = "/api/exchange-positions";
const POLL_MS = 120_000;

/**
 * "idle" before the first answer; "signed-out" without the Desk session; "off" where the route doesn't exist (a
 * local preview); "waiting" until the Polymarket US key is set.
 */
export type PosStatus = "idle" | "signed-out" | "off" | "waiting" | "live" | "failed";

const isNum = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
const MONEY = 1e10;
const okUrl = (u: unknown) => u === null || (typeof u === "string" && /^https:\/\/polymarket\.us\/event\/[a-z0-9-]+$/.test(u));

function isPosition(v: unknown): v is PmPosition {
  const p = v as Partial<PmPosition> | null;
  return (
    !!p &&
    typeof p.market === "string" &&
    typeof p.outcome === "string" &&
    okUrl(p.url) &&
    typeof p.short === "boolean" &&
    isNum(p.contracts, 0, MONEY) &&
    (p.avgPrice === null || isNum(p.avgPrice, 0, 1)) &&
    isNum(p.value, -MONEY, MONEY) &&
    isNum(p.cost, -MONEY, MONEY) &&
    isNum(p.pnl, -MONEY, MONEY) &&
    (p.pnlPct === null || isNum(p.pnlPct, -1e6, 1e6)) &&
    isNum(p.realized, -MONEY, MONEY) &&
    typeof p.expired === "boolean"
  );
}

function isTrade(v: unknown): v is PmTrade {
  const t = v as Partial<PmTrade> | null;
  return !!t && typeof t.at === "string" && Number.isFinite(Date.parse(t.at)) && (t.kind === "trade" || t.kind === "settled" || t.kind === "voided") && typeof t.market === "string" && okUrl(t.url) && isNum(t.contracts, 0, MONEY) && (t.price === null || isNum(t.price, 0, 1));
}

/** The answer as the server sent it, with any row that doesn't fit the shape dropped; null when it isn't one. */
export function readPositions(v: unknown): PmPositions | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || b.ok !== true) return null;
  if (b.state === "waiting") return { ok: true, state: "waiting", reason: b.reason === "bad-key" ? "bad-key" : "no-key" };
  if (b.state !== "live" || typeof b.at !== "string" || !Array.isArray(b.positions) || !Array.isArray(b.activity)) return null;
  const t = b.totals as Record<string, unknown> | null;
  if (!t || !isNum(t.open, 0, 1e6) || !isNum(t.value, -MONEY, MONEY) || !isNum(t.cost, -MONEY, MONEY) || !isNum(t.pnl, -MONEY, MONEY)) return null;
  return {
    ok: true,
    state: "live",
    at: b.at,
    positions: b.positions.filter(isPosition),
    activity: b.activity.filter(isTrade),
    totals: { open: t.open as number, value: t.value as number, cost: t.cost as number, pnl: t.pnl as number },
    more: b.more === true,
    ...(b.stale === true && { stale: true }),
  };
}

/* ── how the money reads ── */

/** "$1,240.50", "−$12.00". */
export function usd(n: number): string {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}$${s}`;
}

/** "+$3.20", "−$2.00", "$0.00". */
export function signedUsd(n: number): string {
  return Math.abs(n) < 0.005 ? "$0.00" : `${n > 0 ? "+" : "−"}${usd(Math.abs(n))}`;
}

/** "+14.5%", "−33.3%"; a dash when unknown. */
export function signedPct(p: number | null): string {
  if (p === null) return "–";
  return Math.abs(p) < 0.05 ? "0.0%" : `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
}

export const pnlTone = (n: number): "up" | "down" | "flat" => (Math.abs(n) < 0.005 ? "flat" : n > 0 ? "up" : "down");

/** "40", "12.5". */
export function contracts(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "55¢"; a dash when unknown. */
export const cents = (p: number | null): string => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);

/** The tape's POLYMARKET US and POSITIONS lines: the book's state in words, never a figure. */
export function bookLine(status: PosStatus): [string, string] {
  switch (status) {
    case "live":
      return ["connected, read-only", "on the board"];
    case "waiting":
      return ["waiting for the key", "–"];
    case "signed-out":
      return ["behind the passkey", "behind the passkey"];
    case "failed":
      return ["not answering", "last good read"];
    case "off":
      return ["not connected here", "–"];
    default:
      return ["reading…", "reading…"];
  }
}

/* ── the store ── */

interface PosStore {
  status: PosStatus;
  data: Extract<PmPositions, { state: "live" }> | null;
  reason: "no-key" | "bad-key" | null;
  checkedAt: number | null;
  refresh: () => Promise<void>;
}

export const usePositions = create<PosStore>((set) => ({
  status: "idle",
  data: null,
  reason: null,
  checkedAt: null,
  refresh: async () => {
    const auth = useDeskAuth.getState().auth.status;
    // Still finding out: the subscription in startPositions reads again once sign-in has answered.
    if (auth === "checking") return;
    if (auth === "off") {
      set({ status: "off", data: null, checkedAt: Date.now() });
      return;
    }
    if (auth !== "in") {
      // Signed out: forget what was shown, so money never lingers on a signed-out page.
      set({ status: "signed-out", data: null, checkedAt: Date.now() });
      return;
    }
    try {
      const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      const json = (res.headers.get("content-type") ?? "").includes("json");
      if (res.status === 401) {
        useDeskAuth.getState().lost();
        set({ status: "signed-out", data: null, checkedAt: Date.now() });
      } else if (res.status === 404 || !json) set({ status: "off", checkedAt: Date.now() });
      else if (!res.ok) set((s) => ({ status: "failed", checkedAt: Date.now(), data: s.data }));
      else {
        const got = readPositions(await res.json());
        if (!got) set({ status: "failed", checkedAt: Date.now() });
        else if (got.state === "waiting") set({ status: "waiting", reason: got.reason, data: null, checkedAt: Date.now() });
        else set({ status: "live", data: got, reason: null, checkedAt: Date.now() });
      }
    } catch {
      set({ status: "failed", checkedAt: Date.now() });
    }
  },
}));

let starters = 0;
let teardown: (() => void) | null = null;

/**
 * Start reading the positions: every two minutes while the tab is showing, and on sign-in or out. Starters are counted
 * (the Desk board and the Lattice marquee can both ask): the first begins the poll and the sign-in subscription, and
 * the returned stop ends them once the last starter has left, so nothing keeps polling after the page is gone (#451).
 * The positions already read stay in the store.
 */
export function startPositions(): () => void {
  if (typeof window === "undefined") return () => {};
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo")) return () => {};
  starters += 1;
  if (starters === 1) {
    const refresh = () => void usePositions.getState().refresh();
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    let was = useDeskAuth.getState().auth.status;
    const unsub = useDeskAuth.subscribe((s) => {
      if (s.auth.status !== was) {
        was = s.auth.status;
        refresh();
      }
    });
    teardown = () => {
      window.clearInterval(timer);
      unsub();
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    starters -= 1;
    if (starters === 0) {
      teardown?.();
      teardown = null;
    }
  };
}
