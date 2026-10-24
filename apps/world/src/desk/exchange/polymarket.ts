import { create } from "zustand";
import type { PmBoard, PmMarket, PmWorld, PmWorldKind } from "../../../../../api/_exchange/types.ts";
import { PM_WATCH_MAX, PM_WORLD_KINDS } from "../../../../../api/_exchange/types.ts";
import { useSystems, type LinkState } from "../../systems.ts";
import { ensureSignedIn, useDeskAuth } from "../signin.ts";

/**
 * Polymarket's odds for the Exchange (#240), browser side: reads GET /api/exchange-markets (public market data the
 * server trims and caches for a minute) every minute while the tab is showing, and pins or unpins a market with the
 * Desk passkey session. Feeds the Exchange's board, its tape, and the Polymarket link on Systems and in the Boiler
 * Room. Read-only: there is no trading anywhere in it.
 */

export type { PmBoard, PmMarket, PmWorld, PmWorldKind };
export { PM_WATCH_MAX };

const PATH = "/api/exchange-markets";
const POLL_MS = 60_000;
/** After a pin, the edge may still hand out the minute-old board; the pin's own answer wins for this long. */
const HOLD_MS = 75_000;

/** "idle" before the first answer; "off" where the route doesn't exist (a local preview). */
export type PmStatus = "idle" | "ready" | "off" | "failed";

const isNum = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

/** Just enough of a check that a market has the board's shape before it is drawn; anything else is dropped. */
export function isPmMarket(v: unknown): v is PmMarket {
  const m = v as Partial<PmMarket> | null;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.id === "string" &&
    /^\d{1,12}$/.test(m.id) &&
    typeof m.question === "string" &&
    typeof m.outcome === "string" &&
    isNum(m.prob, 0, 1) &&
    (m.change24h === null || isNum(m.change24h, -1, 1)) &&
    isNum(m.volume24h, 0, 1e13) &&
    isNum(m.volume, 0, 1e13) &&
    (m.url === null || (typeof m.url === "string" && /^https:\/\/polymarket\.com\/event\/[a-z0-9-]+$/.test(m.url))) &&
    Array.isArray(m.spark) &&
    m.spark.every((p) => isNum(p, 0, 1))
  );
}

/** A world-moving market for the Bookie's asides (#345): a board market with a known topic. */
export function isPmWorld(v: unknown): v is PmWorld {
  return isPmMarket(v) && (PM_WORLD_KINDS as readonly unknown[]).includes((v as Partial<PmWorld>).kind);
}

/** The board as the server sent it, with any market that doesn't fit the shape dropped; null when it isn't a board. */
export function readBoard(v: unknown): PmBoard | null {
  const b = v as Partial<PmBoard> | null;
  if (!b || typeof b !== "object" || b.ok !== true || typeof b.at !== "string" || !Array.isArray(b.top) || !Array.isArray(b.watch)) return null;
  return {
    ok: true,
    at: b.at,
    top: b.top.filter(isPmMarket),
    world: Array.isArray(b.world) ? b.world.filter(isPmWorld) : [],
    watch: b.watch.filter(isPmMarket),
    watchlist: Array.isArray(b.watchlist) ? b.watchlist.filter((x): x is string => typeof x === "string" && /^\d{1,12}$/.test(x)) : [],
    canPin: b.canPin === true,
    ...(b.stale === true && { stale: true }),
  };
}

/* ── how the numbers read ── */

/** "42%", "<1%", ">99%". */
export function pct(p: number): string {
  if (p > 0 && p < 0.01) return "<1%";
  if (p < 1 && p > 0.99) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** The 24-hour move in percentage points: "+3.2", "−0.4", "0.0"; a dash when unknown. */
export function move(c: number | null): string {
  if (c === null) return "–";
  const pts = Math.round(c * 1000) / 10;
  if (pts === 0) return "0.0";
  return `${pts > 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)}`;
}

export const moveTone = (c: number | null): "up" | "down" | "flat" => (c === null || Math.abs(c) < 0.0005 ? "flat" : c > 0 ? "up" : "down");

/** "$1.4M", "$820K", "$950". */
export function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** The sparkline's path in a w×h box, the price axis from 0 to 1 widened to the day's range. */
export function sparkPath(ps: number[], w: number, h: number): string {
  if (ps.length < 2) return "";
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  const pad = Math.max(0.01, (hi - lo) * 0.15);
  const a = Math.max(0, lo - pad);
  const b = Math.min(1, hi + pad);
  return ps.map((p, i) => `${i ? "L" : "M"}${((i / (ps.length - 1)) * w).toFixed(1)} ${(h - ((p - a) / (b - a || 1)) * h).toFixed(1)}`).join("");
}

/** The link's state for Systems and the Boiler Room's pipe. */
export function pmLinkState(status: PmStatus, board: PmBoard | null): LinkState {
  if (status === "failed") return "down";
  if (status !== "ready" || !board) return "off";
  return board.stale ? "slow" : "ok";
}

/** The tape's MARKET DATA line. */
export function tapeLine(status: PmStatus, board: PmBoard | null): string {
  if (status === "ready" && board) return board.stale ? "Polymarket, last good read" : `Polymarket live · ${board.top.length} ${board.top.length === 1 ? "market" : "markets"}`;
  if (status === "failed") return "Polymarket not answering";
  if (status === "idle") return "Polymarket, reading…";
  return "not connected";
}

/* ── the store ── */

export type PinError = "signed-out" | "not-found" | "full" | "not-set-up" | "failed";

export const PIN_ERROR: Record<PinError, string> = {
  "signed-out": "Pins need your passkey. Sign in and try again.",
  "not-found": "Polymarket doesn't list that market. Paste its link or its id.",
  full: `The watchlist holds ${PM_WATCH_MAX}. Unpin one first.`,
  "not-set-up": "Pins need the private store, which isn't connected here.",
  failed: "That didn't go through. Try again in a moment.",
};

interface PmStore {
  status: PmStatus;
  board: PmBoard | null;
  checkedAt: number | null;
  /** The id (or ref) being pinned or unpinned right now. */
  busy: string | null;
  error: PinError | null;
  heldUntil: number;
  refresh: () => Promise<void>;
  pin: (ref: string) => Promise<boolean>;
  unpin: (id: string) => Promise<boolean>;
}

function syncLink(): void {
  const { status, board } = usePolymarket.getState();
  const state = pmLinkState(status, board);
  useSystems.getState().setLink("polymarket", { state, load: board ? Math.min(1, 0.3 + board.top.length / 15) : 0, lastSeen: board ? Date.parse(board.at) : null, note: state === "ok" ? "LIVE ODDS" : undefined });
}

async function write(body: unknown): Promise<{ board: PmBoard } | { error: PinError }> {
  if ((await ensureSignedIn()) !== "ok") return { error: "signed-out" };
  try {
    const res = await fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    if (res.status === 401) {
      useDeskAuth.getState().lost();
      return { error: "signed-out" };
    }
    if (res.status === 404) return { error: "not-found" };
    if (res.status === 409) return { error: "full" };
    if (res.status === 503) return { error: "not-set-up" };
    const board = res.ok ? readBoard(await res.json()) : null;
    return board ? { board } : { error: "failed" };
  } catch {
    return { error: "failed" };
  }
}

export const usePolymarket = create<PmStore>((set, get) => ({
  status: "idle",
  board: null,
  checkedAt: null,
  busy: null,
  error: null,
  heldUntil: 0,
  refresh: async () => {
    try {
      const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const json = (res.headers.get("content-type") ?? "").includes("json");
      // A local preview serves the app's HTML for /api/…
      if (res.status === 404 || !json) set({ status: "off", checkedAt: Date.now() });
      else if (!res.ok) set({ status: "failed", checkedAt: Date.now() });
      else {
        const got = readBoard(await res.json());
        if (!got) set({ status: "failed", checkedAt: Date.now() });
        else {
          const { board, heldUntil } = get();
          // Just pinned: keep the pin's own watchlist over a minute-old copy from the edge.
          const next = board && Date.now() < heldUntil ? { ...got, watch: board.watch, watchlist: board.watchlist } : got;
          set({ status: "ready", board: next, checkedAt: Date.now() });
        }
      }
    } catch {
      set({ status: "failed", checkedAt: Date.now() });
    }
    syncLink();
  },
  pin: async (ref) => {
    const r = ref.trim();
    if (!r || get().busy) return false;
    set({ busy: r, error: null });
    const got = await write({ action: "pin", ref: r });
    if ("error" in got) set({ busy: null, error: got.error });
    else set({ busy: null, board: got.board, status: "ready", heldUntil: Date.now() + HOLD_MS, checkedAt: Date.now() });
    syncLink();
    return !("error" in got);
  },
  unpin: async (id) => {
    if (get().busy) return false;
    set({ busy: id, error: null });
    const got = await write({ action: "unpin", id });
    if ("error" in got) set({ busy: null, error: got.error });
    else set({ busy: null, board: got.board, status: "ready", heldUntil: Date.now() + HOLD_MS, checkedAt: Date.now() });
    return !("error" in got);
  },
}));

let started = false;

/** Start reading the odds (once per page): every minute while the tab is showing, and straight away on return. */
export function startPolymarket(): void {
  if (started || typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo") || q.get("boiler") === "demo") return;
  started = true;
  void usePolymarket.getState().refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") void usePolymarket.getState().refresh();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    const { checkedAt } = usePolymarket.getState();
    if (document.visibilityState === "visible" && (!checkedAt || Date.now() - checkedAt > POLL_MS / 2)) void usePolymarket.getState().refresh();
  });
}
