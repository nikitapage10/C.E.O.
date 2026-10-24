/**
 * The Exchange's Polymarket board (#240), as routes inside an existing function: the Hobby plan's twelve functions are
 * all taken, so vercel.json rewrites /api/exchange-markets to /api/world?exchange=markets and api/world.ts hands it
 * here. On Azure it is its own endpoint (azure/src/index.ts), behind the same site gate.
 *
 * GET  /api/exchange-markets                  → PmBoard: the busiest open markets, the world-moving ones for the
 *                                               Bookie's asides (#345, no sports) and the pinned ones. Cached at the
 *                                               edge for a minute, and each warm instance reads Polymarket at most
 *                                               once a minute; any query string is sent back to the bare address.
 * POST /api/exchange-markets { action, … }    → signed in with the Desk passkey (requireSession): "pin" with `ref`
 *                                               (a market id, slug or polymarket.com link) or "unpin" with `id`.
 *                                               Answers the fresh board, never cached.
 *
 * Read-only on Polymarket's side: public market data, no key, no wallet, no trading (api/_exchange/polymarket.ts).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { ID, readTop, readWatch, readWorld, resolveRef, type Fetcher } from "./polymarket.js";
import { PM_WATCH_MAX, type PmBoard, type PmMarket, type PmWorld } from "./types.js";
import { pickWatchStore, type WatchStore } from "./watchlist.js";

export const PATH = "/api/exchange-markets";
/** How long the edge and a warm instance keep an answer. */
export const FRESH_S = 60;
/** How long a last good read may stand in when Polymarket doesn't answer. */
const STALE_MS = 30 * 60_000;

export interface ExchangeDeps {
  fetcher: Fetcher;
  watch: WatchStore | null;
  desk: DeskDeps;
  now: number;
}

const live = (): ExchangeDeps => ({ fetcher: (url, init) => fetch(url, init), watch: pickWatchStore(), desk: { deskKey: process.env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(), now: Date.now() }, now: Date.now() });

/** Whether a request to the host function is for this route (by its own path, or the rewrite's query). */
export function isExchange(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === PATH || url.searchParams.get("exchange") === "markets";
}

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

/* ── one read of Polymarket per minute per warm instance ── */

interface Kept<T> {
  at: number;
  value: T;
}
let topKept: Kept<PmMarket[]> | null = null;
let worldKept: Kept<PmWorld[]> | null = null;
const watchKept = new Map<string, Kept<PmMarket[]>>();

/** For tests: forget what this instance read. */
export function forgetKept(): void {
  topKept = null;
  worldKept = null;
  watchKept.clear();
}

async function topNow(deps: ExchangeDeps): Promise<{ value: PmMarket[]; stale: boolean }> {
  if (topKept && deps.now - topKept.at < FRESH_S * 1000) return { value: topKept.value, stale: false };
  try {
    topKept = { at: deps.now, value: await readTop(deps.fetcher, deps.now) };
    return { value: topKept.value, stale: false };
  } catch (e) {
    if (topKept && deps.now - topKept.at < STALE_MS) return { value: topKept.value, stale: true };
    throw e;
  }
}

/** The asides' markets; a failed read keeps the last good one for a while, else none (the asides say they're waiting). */
async function worldNow(deps: ExchangeDeps): Promise<{ value: PmWorld[]; stale: boolean }> {
  if (worldKept && deps.now - worldKept.at < FRESH_S * 1000) return { value: worldKept.value, stale: false };
  try {
    worldKept = { at: deps.now, value: await readWorld(deps.fetcher, deps.now) };
    return { value: worldKept.value, stale: false };
  } catch {
    if (worldKept && deps.now - worldKept.at < STALE_MS) return { value: worldKept.value, stale: true };
    return { value: [], stale: false };
  }
}

async function watchNow(deps: ExchangeDeps, ids: string[], force = false): Promise<{ value: PmMarket[]; stale: boolean }> {
  if (!ids.length) return { value: [], stale: false };
  const key = ids.join(",");
  const kept = watchKept.get(key);
  if (!force && kept && deps.now - kept.at < FRESH_S * 1000) return { value: kept.value, stale: false };
  try {
    const value = await readWatch(deps.fetcher, ids);
    if (watchKept.size >= 16) watchKept.clear();
    watchKept.set(key, { at: deps.now, value });
    return { value, stale: false };
  } catch (e) {
    if (kept && deps.now - kept.at < STALE_MS) return { value: kept.value, stale: true };
    throw e;
  }
}

async function board(deps: ExchangeDeps, ids: string[], force = false): Promise<PmBoard> {
  const [top, world, watch] = await Promise.all([topNow(deps), worldNow(deps), watchNow(deps, ids, force).catch(() => ({ value: [] as PmMarket[], stale: true }))]);
  return { ok: true, at: new Date(deps.now).toISOString(), top: top.value, world: world.value, watch: watch.value, watchlist: ids, canPin: deps.watch !== null, ...((top.stale || world.stale || watch.stale) && { stale: true }) };
}

export async function GET(request: Request, deps: ExchangeDeps = live()): Promise<Response> {
  const url = new URL(request.url);
  // The board takes no parameters: a made-up query would miss the edge cache and cost Polymarket reads.
  const extra = [...url.searchParams.keys()].some((k) => k !== "exchange") || url.searchParams.getAll("exchange").length > 1;
  if (extra) return new Response(null, { status: 308, headers: { Location: PATH, "Cache-Control": "public, s-maxage=3600" } });
  const ids = deps.watch ? await deps.watch.read().catch(() => []) : [];
  try {
    const b = await board(deps, ids);
    return json(b, 200, b.stale ? "no-store" : `public, s-maxage=${FRESH_S}, stale-while-revalidate=${FRESH_S}`);
  } catch {
    return json({ error: "upstream" }, 502);
  }
}

export async function POST(request: Request, deps: ExchangeDeps = live()): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if (!deps.watch) return withCookie(json({ error: "not-set-up" }, 503), signed);
  const text = await request.text().catch(() => "");
  if (text.length > 2000) return withCookie(json({ error: "too-big" }, 413), signed);
  let body: { action?: unknown; ref?: unknown; id?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return withCookie(json({ error: "bad-request" }, 400), signed);
  }
  const ids = await deps.watch.read();
  let next: string[];
  if (body.action === "pin") {
    let id: string | null;
    try {
      id = await resolveRef(deps.fetcher, body.ref);
    } catch {
      return withCookie(json({ error: "upstream" }, 502), signed);
    }
    if (!id) return withCookie(json({ error: "not-found" }, 404), signed);
    if (ids.includes(id)) next = ids;
    else if (ids.length >= PM_WATCH_MAX) return withCookie(json({ error: "full", max: PM_WATCH_MAX }, 409), signed);
    else next = [...ids, id];
  } else if (body.action === "unpin" && typeof body.id === "string" && ID.test(body.id)) {
    next = ids.filter((x) => x !== body.id);
  } else {
    return withCookie(json({ error: "bad-request" }, 400), signed);
  }
  if (next !== ids) await deps.watch.write(next);
  try {
    return withCookie(json(await board(deps, next, true)), signed);
  } catch {
    return withCookie(json({ error: "upstream" }, 502), signed);
  }
}
