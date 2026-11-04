/**
 * King Soopers through Kroger's public API (#664, docs/HOME-DEVICES.md, "King Soopers"): the Haven Kitchen list's
 * items matched to products at Nikita's home store, and the picks he confirms added to his King Soopers cart. Checkout
 * (pickup or delivery) stays in the King Soopers app or site: nothing is bought from here.
 *
 *   POST {API}/connect/oauth2/token        client credentials (scope product.compact) for Locations and Products;
 *                                          an authorization code, then its refresh token, for the cart
 *   GET  {API}/connect/oauth2/authorize    Connect King Soopers: scope cart.basic:write, sent back to
 *                                          /api/haven/kroger-callback on the host that started it
 *   GET  {API}/locations?filter.zipCode.near=…&filter.radiusInMiles=…&filter.limit=…
 *   GET  {API}/products?filter.term=…&filter.locationId=…&filter.limit=…   price and stock only with a locationId
 *   PUT  {API}/cart/add  { items: [{ upc, quantity }] } → 204
 *
 *   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET   the app registered at developer.kroger.com (Key Vault `kroger-client-id`,
 *                                            `kroger-client-secret`); without both the connection waits
 *
 * A Kroger answer is read as untrusted data: closed sets, capped strings, numbers checked. Nothing here logs a token,
 * a code, a store, an item or a price. Underscore folder: Vercel never serves it as a function.
 */

import { AZURE_HOST, isSiteHost } from "../../_site/hosts.js";
import type { Fetch } from "../devices/http.js";

export const KROGER_API = "https://api.kroger.com/v1";
export const AUTH_URL = `${KROGER_API}/connect/oauth2/authorize`;
export const TOKEN_URL = `${KROGER_API}/connect/oauth2/token`;
export const PRODUCT_SCOPE = "product.compact";
export const CART_SCOPE = "cart.basic:write";
export const CALLBACK_PATH = "/api/haven/kroger-callback";
export const DEFAULT_REDIRECT = `https://${AZURE_HOST}${CALLBACK_PATH}`;
/** Where the Desk sends Nikita after a send: his King Soopers cart, to check out there. */
export const CART_URL = "https://www.kingsoopers.com/cart";
/** How far the store picker looks, and how many stores it lists. */
export const STORE_RADIUS_MI = 10;
export const STORE_LIMIT = 10;

const TIMEOUT_MS = 10_000;

type Env = Record<string, string | undefined>;

export interface KrogerClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const okSecret = (v: string) => v.length > 0 && v.length <= 256 && !/\s/.test(v);

/** The app's id and secret from the settings, or null until both are set. */
export function krogerClientFrom(env: Env): KrogerClient | null {
  const clientId = (env.KROGER_CLIENT_ID ?? "").trim();
  const clientSecret = (env.KROGER_CLIENT_SECRET ?? "").trim();
  if (!okSecret(clientId) || !okSecret(clientSecret)) return null;
  return { clientId, clientSecret, redirectUri: DEFAULT_REDIRECT };
}

/** The callback on the host the connect started on (the state cookie is per host), when it is one of the site's. */
export function redirectFor(client: KrogerClient, request: Request): KrogerClient {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.port || !isSiteHost(url.hostname)) return client;
  return { ...client, redirectUri: `https://${url.hostname.toLowerCase()}${CALLBACK_PATH}` };
}

/** Kroger's sign-in page for Connect King Soopers (the cart scope only). */
export function authUrl(client: Pick<KrogerClient, "clientId" | "redirectUri">, state: string): string {
  const q = new URLSearchParams({ scope: CART_SCOPE, response_type: "code", client_id: client.clientId, redirect_uri: client.redirectUri, state });
  return `${AUTH_URL}?${q.toString()}`;
}

/** A Kroger call failed: the HTTP status (0 for the network), never the body. */
export class KrogerError extends Error {
  constructor(readonly status: number) {
    super(`kroger call failed (${status})`);
    this.name = "KrogerError";
  }
}

/** Kroger refused the refresh token (revoked or expired): Connect King Soopers again. */
export class KrogerRefusedError extends Error {
  constructor() {
    super("kroger grant refused");
    this.name = "KrogerRefusedError";
  }
}

const basic = (c: Pick<KrogerClient, "clientId" | "clientSecret">) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;

async function send(fetchFn: Fetch, url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch {
    throw new KrogerError(0);
  }
  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = text && text.length < 500_000 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body: body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
}

const tokenCall = (fetchFn: Fetch, client: Pick<KrogerClient, "clientId" | "clientSecret">, form: Record<string, string>) =>
  send(fetchFn, TOKEN_URL, { method: "POST", headers: { Authorization: basic(client), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(form).toString() });

/** Access tokens kept in this instance (the app's, and the cart's by its refresh token's last few characters). */
const kept = new Map<string, { token: string; until: number }>();

const lifeOf = (body: Record<string, unknown>) => (typeof body.expires_in === "number" && body.expires_in > 120 ? body.expires_in : 600);

/** The app's own token (client credentials, product.compact), cached until a minute before it ends. */
export async function appToken(fetchFn: Fetch, client: Pick<KrogerClient, "clientId" | "clientSecret">, now: number): Promise<string> {
  const slot = `app:${client.clientId.slice(-12)}`;
  const hit = kept.get(slot);
  if (hit && hit.until > now) return hit.token;
  const { status, body } = await tokenCall(fetchFn, client, { grant_type: "client_credentials", scope: PRODUCT_SCOPE });
  if (status !== 200 || typeof body.access_token !== "string" || !body.access_token) throw new KrogerError(status);
  kept.set(slot, { token: body.access_token, until: now + (lifeOf(body) - 60) * 1000 });
  return body.access_token;
}

/** Trades the callback's code for a refresh token (the cart grant). */
export async function exchangeCode(fetchFn: Fetch, client: KrogerClient, code: string): Promise<string> {
  const { status, body } = await tokenCall(fetchFn, client, { grant_type: "authorization_code", code, redirect_uri: client.redirectUri });
  if (status !== 200 || typeof body.refresh_token !== "string" || !body.refresh_token || body.refresh_token.length > 4096) throw new KrogerError(status);
  return body.refresh_token;
}

/**
 * A cart access token from the refresh token. Kroger may hand back a new refresh token with it: `refresh` is then the
 * one to keep from now on.
 */
export async function cartToken(fetchFn: Fetch, client: Pick<KrogerClient, "clientId" | "clientSecret">, refresh: string, now: number): Promise<{ token: string; refresh: string }> {
  const slot = `cart:${refresh.slice(-12)}`;
  const hit = kept.get(slot);
  if (hit && hit.until > now) return { token: hit.token, refresh };
  const { status, body } = await tokenCall(fetchFn, client, { grant_type: "refresh_token", refresh_token: refresh });
  if ((status === 400 || status === 401) && (body.error === "invalid_grant" || body.error === "unauthorized_client" || body.error === "invalid_token")) throw new KrogerRefusedError();
  if (status !== 200 || typeof body.access_token !== "string" || !body.access_token) throw new KrogerError(status);
  const next = typeof body.refresh_token === "string" && body.refresh_token && body.refresh_token.length <= 4096 ? body.refresh_token : refresh;
  kept.set(`cart:${next.slice(-12)}`, { token: body.access_token, until: now + (lifeOf(body) - 60) * 1000 });
  return { token: body.access_token, refresh: next };
}

/** Forgets every cached access token (tests, and a disconnect). */
export function forgetKrogerTokens(): void {
  kept.clear();
}

/* ── Reading Kroger's answers ── */

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** One plain line, capped. */
export const line = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\p{Cc}<>]/gu, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
const ID = /^[A-Za-z0-9-]{1,32}$/;
const UPC = /^\d{8,14}$/;

/** A store, as the picker shows it. */
export interface StoreRow {
  id: string;
  name: string;
  line: string;
  city: string;
  state: string;
  zip: string;
}

/** Kroger's chain code for King Soopers (the Locations API's `filter.chain`). */
export const KING_SOOPERS_CHAIN = "KINGSOOPERS";

/** True when a Locations row belongs to King Soopers (other Kroger banners are dropped). */
export const isKingSoopers = (v: unknown): boolean => String(o(v).chain ?? "").replace(/[^a-z]/gi, "").toUpperCase() === KING_SOOPERS_CHAIN;

export function readStore(v: unknown): StoreRow | null {
  const s = o(v);
  const a = o(s.address);
  const id = typeof s.locationId === "string" ? s.locationId : typeof s.id === "string" ? s.id : "";
  if (!ID.test(id)) return null;
  const name = line(s.name, 80) || line(s.chain, 40);
  if (!name) return null;
  return { id, name, line: line(a.addressLine1 ?? s.line, 80), city: line(a.city ?? s.city, 40), state: line(a.state ?? s.state, 4), zip: line(a.zipCode ?? s.zip, 10) };
}

export type Stock = "high" | "low" | "out";

/** A product at the chosen store: prices in cents. */
export interface Product {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  price: number;
  /** The sale price, when there is one below the regular price. */
  promo: number | null;
  stock: Stock | null;
  /** The product's photo on Kroger's image host (the featured or front view), or null. */
  image: string | null;
}

/** A photo URL only when it's https on Kroger's own image host (kroger.com or a subdomain): anything else is dropped. */
export function krogerImage(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.port || u.username || u.password || !(host === "kroger.com" || host.endsWith(".kroger.com"))) return null;
  return u.toString();
}

const SIZES = ["medium", "small", "large", "thumbnail", "xlarge"];

/** The featured photo (else the front, else the first), at medium size or the nearest one; null without a good one. */
export function imageOf(images: unknown): string | null {
  const list = (Array.isArray(images) ? images : []).slice(0, 20).map(o);
  const pick = list.find((i) => i.featured === true) ?? list.find((i) => i.perspective === "front") ?? list[0];
  if (!pick) return null;
  const sizes = (Array.isArray(pick.sizes) ? pick.sizes : []).slice(0, 10).map(o);
  for (const size of SIZES) {
    const url = krogerImage(sizes.find((s) => s.size === size)?.url);
    if (url) return url;
  }
  return null;
}

const cents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 10_000 ? Math.round(v * 100) : null);
const STOCK: Record<string, Stock> = { HIGH: "high", LOW: "low", TEMPORARILY_OUT_OF_STOCK: "out" };

/** A product from Kroger's answer; null without a price at this store (not sold there) or a usable UPC. */
export function readProduct(v: unknown): Product | null {
  const p = o(v);
  const productId = typeof p.productId === "string" && ID.test(p.productId) ? p.productId : "";
  const upc = typeof p.upc === "string" && UPC.test(p.upc) ? p.upc : "";
  const description = line(p.description, 120);
  if (!productId || !upc || !description) return null;
  const item = o(Array.isArray(p.items) ? p.items[0] : null);
  const price = o(item.price);
  const regular = cents(price.regular);
  if (regular === null) return null;
  const promo = cents(price.promo);
  const stock = STOCK[String(o(item.inventory).stockLevel ?? "")] ?? null;
  return { productId, upc, description, brand: line(p.brand, 60), size: line(item.size, 40), price: regular, promo: promo !== null && promo < regular ? promo : null, stock, image: imageOf(p.images) };
}

/** The same check for a product read back from the private store. */
export function readStoredProduct(v: unknown): Product | null {
  const p = o(v);
  const price = typeof p.price === "number" && Number.isInteger(p.price) && p.price > 0 && p.price < 1_000_000 ? p.price : null;
  if (typeof p.productId !== "string" || !ID.test(p.productId) || typeof p.upc !== "string" || !UPC.test(p.upc) || price === null) return null;
  const description = line(p.description, 120);
  if (!description) return null;
  const promo = typeof p.promo === "number" && Number.isInteger(p.promo) && p.promo > 0 && p.promo < price ? p.promo : null;
  const stock = p.stock === "high" || p.stock === "low" || p.stock === "out" ? p.stock : null;
  return { productId: p.productId, upc: p.upc, description, brand: line(p.brand, 60), size: line(p.size, 40), price, promo, stock, image: krogerImage(p.image) };
}

/** What one pick costs now: the sale price when there is one. */
export const costOf = (p: Product): number => p.promo ?? p.price;

/* ── The calls ── */

const get = async (fetchFn: Fetch, path: string, token: string) => {
  const { status, body } = await send(fetchFn, `${KROGER_API}${path}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (status !== 200) throw new KrogerError(status);
  return Array.isArray(body.data) ? (body.data as unknown[]) : [];
};

/** The King Soopers stores near a ZIP, nearest first, as Kroger lists them. */
export async function findStores(fetchFn: Fetch, token: string, zip: string): Promise<StoreRow[]> {
  const q = new URLSearchParams({ "filter.zipCode.near": zip, "filter.radiusInMiles": String(STORE_RADIUS_MI), "filter.limit": String(STORE_LIMIT), "filter.chain": KING_SOOPERS_CHAIN });
  const rows = await get(fetchFn, `/locations?${q.toString()}`, token);
  return rows.filter(isKingSoopers).map(readStore).filter((s): s is StoreRow => s !== null).slice(0, STORE_LIMIT);
}

/** The search term Kroger takes for a list item: 3 characters at least, 8 words at most; "" when there's none. */
export function termOf(name: string): string {
  const t = line(name, 60).replace(/[^\p{L}\p{N}' -]/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  return t.length >= 3 ? t : "";
}

/** Products at the store for a term, in Kroger's order, only those with a price there. */
export async function searchProducts(fetchFn: Fetch, token: string, term: string, locationId: string, limit: number): Promise<Product[]> {
  const q = new URLSearchParams({ "filter.term": term, "filter.locationId": locationId, "filter.limit": String(Math.max(1, Math.min(50, limit))) });
  const rows = await get(fetchFn, `/products?${q.toString()}`, token);
  return rows.map(readProduct).filter((p): p is Product => p !== null);
}

/** Adds the items to the signed-in customer's cart (quantity 1 each unless given). */
export async function addToCart(fetchFn: Fetch, token: string, items: { upc: string; quantity: number }[]): Promise<void> {
  const { status } = await send(fetchFn, `${KROGER_API}/cart/add`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ items: items.map((i) => ({ upc: i.upc, quantity: i.quantity })) }),
  });
  if (status === 401) throw new KrogerRefusedError();
  if (status !== 204 && status !== 200) throw new KrogerError(status);
}
