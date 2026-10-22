/**
 * Nikita's own positions on the Exchange (#253), from his Polymarket US account (polymarket.us, the CFTC-regulated
 * exchange): read-only, served only to a signed-in Desk. Like the board (route.ts), a route inside an existing
 * function: vercel.json rewrites /api/exchange-positions to /api/world?exchange=positions and api/world.ts hands it
 * here; on Azure it is its own endpoint (azure/src/index.ts), behind the same site gate.
 *
 * GET /api/exchange-positions → PmPositions. Needs the Desk passkey session on top of the site gate (requireSession),
 *                              because it carries dollar values, sizes and P&L. Never cached anywhere but this warm
 *                              instance (a minute): `Cache-Control: private, no-store`.
 *
 * The key: POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY, made at polymarket.us/developer and kept only in the
 * Function App's settings (Key Vault references on Azure). Without them the answer is { state: "waiting" } and
 * Polymarket isn't called. Nothing about the key is ever sent to the browser or logged.
 *
 * Polymarket US's Retail API (docs.polymarket.us, "Authentication" and "Portfolio API"):
 *   GET https://api.polymarket.us/v1/portfolio/positions    a map of market slug to position
 *   GET https://api.polymarket.us/v1/portfolio/activities   fills and settlements, newest first
 * Each request is signed: X-PM-Access-Key (the key id), X-PM-Timestamp (ms) and X-PM-Signature, the base64 Ed25519
 * signature of `timestamp + method + path` (the path without its query, as the official SDK signs it).
 *
 * READ-ONLY, BY CONSTRUCTION. Polymarket US's keys have no read-only scope: the same key could place orders. So the
 * only signer here (`signedGet`) signs GET requests to exactly the two paths above and refuses anything else, and
 * nothing in the repo calls the orders, account or WebSocket APIs. Deposits, withdrawals and balances are never read.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { SLUG, cleanText, type Fetcher } from "./polymarket.js";
import { PM_POS_MAX, PM_TRADES_MAX, type PmPosition, type PmPositions, type PmTrade } from "./types.js";

export const POSITIONS_PATH = "/api/exchange-positions";
export const US_API = "https://api.polymarket.us";
/** The only paths the key ever signs, and only for GET. */
export const READ_PATHS = ["/v1/portfolio/positions", "/v1/portfolio/activities"] as const;
export type ReadPath = (typeof READ_PATHS)[number];
/** How long a warm instance keeps a read. */
export const POS_FRESH_S = 60;
/** How long a last good read may stand in when Polymarket US doesn't answer. */
const STALE_MS = 30 * 60_000;
/** A position smaller than this many contracts is dust left after a sale: not shown. */
const DUST = 0.01;
/** Dollar amounts past this are not believed. */
const MONEY_MAX = 1e10;
const TIMEOUT_MS = 6000;
const MAX_BYTES = 2_000_000;

/** Polymarket US key ids are UUIDs. */
const KEY_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface UsKey {
  id: string;
  secret: KeyObject;
}

export interface PositionsDeps {
  fetcher: Fetcher;
  /** The key, or why there isn't one. */
  key: UsKey | { error: "no-key" | "bad-key" };
  desk: DeskDeps;
  now: number;
}

/** Reads the key from the settings; the secret is the base64 Ed25519 key (its 32-byte seed, or seed and public half). */
export function keyFrom(env: Record<string, string | undefined>): PositionsDeps["key"] {
  const id = (env.POLYMARKET_US_KEY_ID ?? "").trim();
  const secret = (env.POLYMARKET_US_SECRET_KEY ?? "").trim();
  if (!id && !secret) return { error: "no-key" };
  if (!KEY_ID.test(id) || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret)) return { error: "bad-key" };
  const bytes = Buffer.from(secret, "base64");
  if (bytes.length !== 32 && bytes.length !== 64) return { error: "bad-key" };
  try {
    // PKCS#8 wrapping of a raw Ed25519 seed (RFC 8410).
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), bytes.subarray(0, 32)]);
    return { id, secret: createPrivateKey({ key: der, format: "der", type: "pkcs8" }) };
  } catch {
    return { error: "bad-key" };
  }
}

let liveKey: { from: string; key: PositionsDeps["key"] } | null = null;
function envKey(): PositionsDeps["key"] {
  const from = `${process.env.POLYMARKET_US_KEY_ID ?? ""}\u0000${process.env.POLYMARKET_US_SECRET_KEY ?? ""}`;
  if (!liveKey || liveKey.from !== from) liveKey = { from, key: keyFrom(process.env) };
  return liveKey.key;
}

const live = (): PositionsDeps => ({
  fetcher: (url, init) => fetch(url, init),
  key: envKey(),
  desk: { deskKey: process.env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(), now: Date.now() },
  now: Date.now(),
});

/** Whether a request to the host function is for this route (by its own path, or the rewrite's query). */
export function isPositions(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === POSITIONS_PATH || url.searchParams.get("exchange") === "positions";
}

/** The three signed headers for one GET. */
export function authHeaders(key: UsKey, path: ReadPath, now: number): Record<string, string> {
  const ts = String(Math.floor(now));
  return { "X-PM-Access-Key": key.id, "X-PM-Timestamp": ts, "X-PM-Signature": sign(null, Buffer.from(`${ts}GET${path}`), key.secret).toString("base64") };
}

/**
 * The only signed call: a GET to one of READ_PATHS, with a timeout and a size cap. Anything else throws before a
 * signature is made, so the key can't be used to trade from here.
 */
export async function signedGet(fetcher: Fetcher, key: UsKey, path: string, query: URLSearchParams, now = Date.now()): Promise<unknown> {
  if (!(READ_PATHS as readonly string[]).includes(path)) throw new Error("not a read path");
  const qs = query.toString();
  const res = await fetcher(`${US_API}${path}${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders(key, path as ReadPath, now) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`polymarket us ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("polymarket us answer too big");
  return JSON.parse(text) as unknown;
}

/* ── shaping Polymarket US's rows ── */

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
/** An Amount ({ value: "12.34", currency: "USD" }), in dollars; null when it isn't one. */
const amount = (v: unknown): number | null => num(obj(v)?.value, -MONEY_MAX, MONEY_MAX);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

function urlOf(eventSlug: unknown): string | null {
  return typeof eventSlug === "string" && SLUG.test(eventSlug) ? `https://polymarket.us/event/${eventSlug}` : null;
}

/** "will-the-brewers-win" → "Will the brewers win": a fallback title when Polymarket sends none. */
function fromSlug(slug: string): string {
  const s = slug.replace(/-/g, " ").trim();
  return cleanText(s.charAt(0).toUpperCase() + s.slice(1));
}

/** One position, rebuilt with only the board's fields; null when it can't be read, has expired empty, or is dust. */
export function shapePosition(slug: string, raw: unknown): PmPosition | null {
  const r = obj(raw);
  if (!r || !SLUG.test(slug)) return null;
  const net = num(r.netPositionDecimal, -MONEY_MAX, MONEY_MAX) ?? num(r.netPosition, -MONEY_MAX, MONEY_MAX);
  if (net === null || Math.abs(net) < DUST) return null;
  const meta = obj(r.marketMetadata) ?? {};
  const contracts = Math.abs(net);
  const cost = amount(r.cost) ?? 0;
  const value = amount(r.cashValue) ?? 0;
  const pnl = value - cost;
  const avg = cost > 0 ? cost / contracts : null;
  return {
    market: cleanText(meta.title) || fromSlug(slug),
    outcome: cleanText(meta.outcome, 40) || "Yes",
    url: urlOf(meta.eventSlug),
    short: net < 0,
    contracts: round(contracts, 2),
    avgPrice: avg !== null && avg <= 1 ? round(avg, 4) : null,
    value: round(value, 2),
    cost: round(cost, 2),
    pnl: round(pnl, 2),
    pnlPct: cost > 0 ? round((pnl / cost) * 100, 1) : null,
    realized: round(amount(r.realized) ?? 0, 2),
    expired: r.expired === true,
  };
}

/** One line of activity: a fill or a settlement; null for anything else (deposits and the like are never kept). */
export function shapeTrade(raw: unknown, titles: Map<string, { market: string; url: string | null }>): PmTrade | null {
  const r = obj(raw);
  if (!r) return null;
  const trade = r.type === "ACTIVITY_TYPE_TRADE" ? obj(r.trade) : null;
  const res = r.type === "ACTIVITY_TYPE_POSITION_RESOLUTION" ? obj(r.positionResolution) : null;
  const row = trade ?? res;
  if (!row) return null;
  const slug = typeof row.marketSlug === "string" && SLUG.test(row.marketSlug) ? row.marketSlug : null;
  const when = [trade?.createTime, row.updateTime].find((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)));
  if (!slug || !when) return null;
  const known = titles.get(slug);
  const contracts = trade ? (num(trade.qtyDecimal, 0, MONEY_MAX) ?? num(trade.qty, 0, MONEY_MAX) ?? 0) : 0;
  const price = trade ? num(obj(trade.price)?.value, 0, 1) : null;
  return {
    at: new Date(Date.parse(when)).toISOString(),
    kind: res ? "settled" : trade?.state === "TRADE_STATE_BUSTED" ? "voided" : "trade",
    market: known?.market ?? fromSlug(slug),
    url: known?.url ?? null,
    contracts: round(contracts, 2),
    price: price === null ? null : round(price, 4),
  };
}

type Live = Extract<PmPositions, { state: "live" }>;

/** Reads the open positions and recent fills. Activity failing alone leaves it empty. */
export async function readPositions(fetcher: Fetcher, key: UsKey, now: number): Promise<Live> {
  const pq = new URLSearchParams({ limit: String(PM_POS_MAX) });
  const aq = new URLSearchParams({ limit: String(PM_TRADES_MAX), sortOrder: "SORT_ORDER_DESCENDING" });
  aq.append("types", "ACTIVITY_TYPE_TRADE");
  aq.append("types", "ACTIVITY_TYPE_POSITION_RESOLUTION");
  const [pos, act] = await Promise.all([signedGet(fetcher, key, READ_PATHS[0], pq, now), signedGet(fetcher, key, READ_PATHS[1], aq, now).catch(() => null)]);
  const body = obj(pos);
  const map = obj(body?.positions);
  if (!body || (body.positions !== undefined && !map)) throw new Error("polymarket us: not a positions answer");
  const positions = Object.entries(map ?? {})
    .map(([slug, raw]) => shapePosition(slug, raw))
    .filter((x): x is PmPosition => x !== null)
    .slice(0, PM_POS_MAX);
  positions.sort((a, b) => b.value - a.value);
  const titles = new Map<string, { market: string; url: string | null }>();
  for (const [slug, raw] of Object.entries(map ?? {})) {
    const p = shapePosition(slug, { ...obj(raw), netPositionDecimal: "1" });
    if (p) titles.set(slug, { market: p.market, url: p.url });
  }
  const list = Array.isArray(obj(act)?.activities) ? (obj(act)!.activities as unknown[]) : [];
  const activity = list
    .map((a) => shapeTrade(a, titles))
    .filter((x): x is PmTrade => x !== null)
    .slice(0, PM_TRADES_MAX);
  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const open = positions.filter((p) => !p.expired);
  const sum = (k: "value" | "cost" | "pnl") => round(open.reduce((s, x) => s + x[k], 0), 2);
  return { ok: true, state: "live", at: new Date(now).toISOString(), positions, activity, totals: { open: open.length, value: sum("value"), cost: sum("cost"), pnl: sum("pnl") }, more: body.eof === false };
}

/* ── one read of Polymarket US per minute per warm instance ── */

let kept: { id: string; at: number; value: Live } | null = null;

/** For tests: forget what this instance read. */
export function forgetPositions(): void {
  kept = null;
}

function json(body: unknown, status = 200): Response {
  // Private money: never cached by the edge or the browser.
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, deps: PositionsDeps = live()): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const url = new URL(request.url);
  const extra = [...url.searchParams.keys()].some((k) => k !== "exchange") || url.searchParams.getAll("exchange").length > 1;
  if (extra) return withCookie(json({ error: "bad-request" }, 400), signed);
  const key = deps.key;
  if ("error" in key) return withCookie(json({ ok: true, state: "waiting", reason: key.error } satisfies PmPositions), signed);
  const mine = kept && kept.id === key.id ? kept : null;
  if (mine && deps.now - mine.at < POS_FRESH_S * 1000) return withCookie(json(mine.value), signed);
  try {
    const value = await readPositions(deps.fetcher, key, deps.now);
    kept = { id: key.id, at: deps.now, value };
    return withCookie(json(value), signed);
  } catch {
    if (mine && deps.now - mine.at < STALE_MS) return withCookie(json({ ...mine.value, stale: true }), signed);
    return withCookie(json({ error: "upstream" }, 502), signed);
  }
}
