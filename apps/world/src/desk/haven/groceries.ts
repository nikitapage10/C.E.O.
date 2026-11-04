/**
 * Send to King Soopers, browser side (#664; api/_haven/kroger/route.ts). Signed in, the Kitchen page reads the home
 * store, each open item's pick (product, price, stock) and the total, and sends the picks it shows to the King Soopers
 * cart on Nikita's tap; checkout stays in the King Soopers app. Everything the server sends is read again here as
 * untrusted data (closed sets, capped strings, whole cents), so a bad answer can't put anything odd on the page.
 */

export type LinkState = "waiting" | "live" | "down";
export type Stock = "high" | "low" | "out";

export interface GProduct {
  productId: string;
  description: string;
  brand: string;
  size: string;
  /** Cents. */
  price: number;
  promo: number | null;
  stock: Stock | null;
}

export interface GStore {
  id: string;
  name: string;
  line: string;
  city: string;
  state: string;
  zip: string;
}

export interface GLine {
  id: string;
  name: string;
  key: string;
  pick: { product: GProduct | null; alts: GProduct[]; chosen: boolean; skip: boolean; at: string } | null;
}

export interface Groceries {
  ready: boolean;
  state: LinkState;
  connected: boolean;
  refused: boolean;
  zip: string;
  found: GStore[];
  store: GStore | null;
  lines: GLine[];
  total: number;
  count: number;
  sent: { at: string; items: number; ok: boolean } | null;
}

const PATH = "/api/haven/kroger";
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const cents = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : null);
const state = (v: unknown): LinkState => (v === "live" || v === "down" ? v : "waiting");

function product(v: unknown): GProduct | null {
  const p = o(v);
  const price = cents(p.price);
  const productId = s(p.productId, 32);
  if (price === null || !productId) return null;
  return { productId, description: s(p.description, 120), brand: s(p.brand, 60), size: s(p.size, 40), price, promo: cents(p.promo), stock: p.stock === "high" || p.stock === "low" || p.stock === "out" ? p.stock : null };
}

function store(v: unknown): GStore | null {
  const x = o(v);
  const id = s(x.id, 32);
  return id ? { id, name: s(x.name, 80), line: s(x.line, 80), city: s(x.city, 40), state: s(x.state, 4), zip: s(x.zip, 10) } : null;
}

/** The signed-in view, checked; null when it isn't one. */
export function readGroceries(v: unknown): Groceries | null {
  const b = o(v);
  if (typeof b.ready !== "boolean" || !Array.isArray(b.lines)) return null;
  const sent = o(b.sent);
  return {
    ready: b.ready,
    state: state(b.state),
    connected: b.connected === true,
    refused: b.refused === true,
    zip: /^\d{5}$/.test(s(b.zip, 5)) ? s(b.zip, 5) : "",
    found: (Array.isArray(b.found) ? b.found : []).map(store).filter((x): x is GStore => x !== null).slice(0, 10),
    store: b.store ? store(b.store) : null,
    lines: b.lines.slice(0, 100).map((raw): GLine => {
      const l = o(raw);
      const p = l.pick ? o(l.pick) : null;
      return {
        id: s(l.id, 32),
        name: s(l.name, 60),
        key: s(l.key, 60),
        pick: p ? { product: p.product ? product(p.product) : null, alts: (Array.isArray(p.alts) ? p.alts : []).map(product).filter((x): x is GProduct => x !== null).slice(0, 8), chosen: p.chosen === true, skip: p.skip === true, at: s(p.at, 32) } : null,
      };
    }),
    total: cents(b.total) ?? 0,
    count: cents(b.count) ?? 0,
    sent: typeof sent.at === "string" && typeof sent.ok === "boolean" ? { at: s(sent.at, 32), items: cents(sent.items) ?? 0, ok: sent.ok } : null,
  };
}

/** How much one pick costs now (the sale price when there is one). */
export const costOf = (p: GProduct) => p.promo ?? p.price;
/** Whether a line goes in the send: a product, in stock, not left out. */
export const goes = (l: GLine) => Boolean(l.pick?.product && !l.pick.skip && l.pick.product.stock !== "out");
export const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export type GLoad = { state: "ready"; view: Groceries } | { state: "off" } | { state: "out" } | { state: "failed" };

export async function loadGroceries(f: typeof fetch = fetch): Promise<GLoad> {
  try {
    const res = await f(PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || !(res.headers.get("content-type") ?? "").includes("json")) return { state: "off" };
    const view = res.ok ? readGroceries(await res.json().catch(() => null)) : null;
    return view ? { state: "ready", view } : { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

export type GAction =
  | { action: "set-zip"; zip: string }
  | { action: "find-stores" }
  | { action: "pick-store"; id: string }
  | { action: "match" }
  | { action: "search"; key: string; term: string }
  | { action: "choose"; key: string; productId: string }
  | { action: "skip"; key: string; skip: boolean }
  | { action: "connect" }
  | { action: "disconnect" }
  | { action: "send"; picks: { key: string; productId: string }[] };

/** One action; the fresh view comes back with it (and `url`: Kroger's sign-in for a connect, the cart after a send). */
export async function groceryAction(body: GAction, f: typeof fetch = fetch): Promise<{ ok: boolean; status: number; error: string | null; view: Groceries | null; url: string | null; items: number }> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const got = o(await res.json().catch(() => ({})));
    const url = typeof got.url === "string" && (isKrogerSignIn(got.url) || isCartLink(got.url)) ? got.url : null;
    return { ok: res.ok, status: res.status, error: res.ok ? null : s(got.error, 20) || "failed", view: readGroceries(got), url, items: cents(got.items) ?? 0 };
  } catch {
    return { ok: false, status: 0, error: "failed", view: null, url: null, items: 0 };
  }
}

/** Only Kroger's own sign-in page, and the King Soopers cart, are ever opened. */
export const isKrogerSignIn = (url: string) => /^https:\/\/api\.kroger\.com\/v1\/connect\/oauth2\/authorize\?/.test(url);
export const isCartLink = (url: string) => url === "https://www.kingsoopers.com/cart";

/** What the Kitchen page says when an action didn't work. */
export const GROCERY_NOTE: Record<string, string> = {
  "not-set-up": "King Soopers isn't set up yet: the Kroger app's keys go in the Key Vault (docs/HOME-DEVICES.md).",
  "bad-zip": "That isn't a five-digit ZIP.",
  "no-zip": "Set the ZIP first.",
  "no-store": "Pick the store first.",
  "not-connected": "Connect King Soopers first, so the picks can go in your cart.",
  refused: "King Soopers let go of the connection. Connect it again.",
  changed: "The list changed since you looked. Check the picks and send again.",
  empty: "Nothing to send.",
  vendor: "King Soopers didn't answer. Try again in a bit.",
  "signed-out": "Your session ended. Sign in again.",
  failed: "That didn't go through. Try again.",
};

/** What Controls says after Kroger sends the browser back (/boiler/controls?kroger=…). */
export const CONNECT_NOTE: Record<string, string> = {
  connected: "King Soopers is connected. The picks can go in your cart now.",
  cancelled: "Connecting King Soopers was cancelled.",
  failed: "Connecting King Soopers didn't work. Try again.",
  refused: "That connect link had run out. Try again from here.",
};
