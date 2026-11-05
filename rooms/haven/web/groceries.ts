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
  /** The product's photo on Kroger's image host, or null. */
  image: string | null;
  /** Where it is in the store ("Aisle 12"), or null (#737). */
  aisle: string | null;
  /** Its departments as Kroger names them, at most three (#737). */
  categories: string[];
}

export interface GStore {
  id: string;
  name: string;
  line: string;
  city: string;
  state: string;
  zip: string;
}

export type Verdict = "covered" | "short" | "over" | "wrong" | "unsure";

/** A pick's quantity check (#761): how many cover the list line, and whether it's short, way over or the wrong thing. */
export interface GReview {
  productId: string;
  qty: number;
  verdict: Verdict;
  reason: string;
  /** A better match among the pick's others, by product id. */
  better: string | null;
  by: "ai" | "rules";
}

export interface GLine {
  id: string;
  name: string;
  key: string;
  pick: { product: GProduct | null; alts: GProduct[]; chosen: boolean; skip: boolean; at: string; term: string; review: GReview | null } | null;
  /** This pick already went to the King Soopers cart from here (#737): a send skips it. */
  inCart: boolean;
  /** How many go in the cart (#761): his own count, else the check's, else one. */
  qty: number;
  /** The plan changed since it was finalized and no longer asks for this line (#761). */
  stale: boolean;
}

/** The most of one product the stepper allows (api/_haven/kroger/review.ts QTY_MAX). */
export const QTY_MAX = 24;
const VERDICT_SET: Verdict[] = ["covered", "short", "over", "wrong", "unsure"];

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
  /** The plan changed since it was finalized (#761): weeks changed, matches that no longer fit, lines not on the list yet. */
  plan: { changed: number; stale: number; fresh: number };
}

const PATH = "/api/haven/kroger";
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const cents = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : null);
const state = (v: unknown): LinkState => (v === "live" || v === "down" ? v : "waiting");

/** Only an https photo on Kroger's own image host (kroger.com or a subdomain) is ever shown. */
export function krogerImage(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.port && !u.username && !u.password && (host === "kroger.com" || host.endsWith(".kroger.com")) ? u.toString() : null;
  } catch {
    return null;
  }
}

function product(v: unknown): GProduct | null {
  const p = o(v);
  const price = cents(p.price);
  const productId = s(p.productId, 32);
  if (price === null || !productId) return null;
  return { productId, description: s(p.description, 120), brand: s(p.brand, 60), size: s(p.size, 40), price, promo: cents(p.promo), stock: p.stock === "high" || p.stock === "low" || p.stock === "out" ? p.stock : null, image: krogerImage(p.image), aisle: s(p.aisle, 40) || null, categories: (Array.isArray(p.categories) ? p.categories : []).slice(0, 3).map((c) => s(c, 40)).filter(Boolean) };
}

function review(v: unknown): GReview | null {
  const r = o(v);
  const qty = cents(r.qty);
  const verdict = VERDICT_SET.find((x) => x === r.verdict);
  const productId = s(r.productId, 32);
  if (!productId || qty === null || qty < 1 || qty > QTY_MAX || !verdict) return null;
  return { productId, qty, verdict, reason: s(r.reason, 80), better: typeof r.better === "string" ? s(r.better, 32) || null : null, by: r.by === "ai" ? "ai" : "rules" };
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
      const qty = cents(l.qty);
      return {
        id: s(l.id, 32),
        name: s(l.name, 60),
        key: s(l.key, 60),
        pick: p
          ? { product: p.product ? product(p.product) : null, alts: (Array.isArray(p.alts) ? p.alts : []).map(product).filter((x): x is GProduct => x !== null).slice(0, 8), chosen: p.chosen === true, skip: p.skip === true, at: s(p.at, 32), term: s(p.term, 60), review: p.review ? review(p.review) : null }
          : null,
        inCart: l.inCart === true,
        qty: qty !== null && qty >= 1 && qty <= QTY_MAX ? qty : 1,
        stale: l.stale === true,
      };
    }),
    total: cents(b.total) ?? 0,
    count: cents(b.count) ?? 0,
    sent: typeof sent.at === "string" && typeof sent.ok === "boolean" ? { at: s(sent.at, 32), items: cents(sent.items) ?? 0, ok: sent.ok } : null,
    plan: { changed: cents(o(b.plan).changed) ?? 0, stale: cents(o(b.plan).stale) ?? 0, fresh: cents(o(b.plan).fresh) ?? 0 },
  };
}

/** A pick's check, only while the pick is still the product it checked (#761). */
export const reviewOf = (l: GLine): GReview | null => (l.pick?.review && l.pick.product && l.pick.review.productId === l.pick.product.productId ? l.pick.review : null);
/** The badge a check earns, or null when it's covered. */
export const VERDICT_BADGE: Record<Verdict, string | null> = { covered: null, short: "short", over: "way over", wrong: "wrong product", unsure: "check size" };

/** How much one pick costs now (the sale price when there is one). */
export const costOf = (p: GProduct) => p.promo ?? p.price;
/** Whether a line goes in the send: a product, in stock, not left out. */
export const goes = (l: GLine) => Boolean(l.pick?.product && !l.pick.skip && l.pick.product.stock !== "out");
/** Whether a send would add it now: it goes, and it isn't in the cart from an earlier send (#737). */
export const adds = (l: GLine) => goes(l) && !l.inCart;
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
  | { action: "rematch"; key: string }
  | { action: "clear" }
  | { action: "search"; key: string; term: string }
  | { action: "choose"; key: string; productId: string }
  | { action: "skip"; key: string; skip: boolean }
  | { action: "connect" }
  | { action: "disconnect" }
  | { action: "review" }
  | { action: "qty"; key: string; qty: number }
  | { action: "clear-list" }
  | { action: "send"; picks: { key: string; productId: string; qty: number }[] };

export interface GReply {
  ok: boolean;
  status: number;
  error: string | null;
  view: Groceries | null;
  url: string | null;
  /** Added by a send. */
  items: number;
  /** Skipped by a send: already in the cart from here (#737). */
  already: number;
  /** Matched by this Match call, and how many still wait for the next (#737). */
  matched: number;
  left: number;
  /** A review's (#761): by the model or the rules, and what the call cost in dollars. */
  by: "ai" | "rules" | null;
  usd: number;
}

/**
 * Match every open item in one press (#737): the server matches up to 25 a call, a few at a time, and says how many are
 * left; this asks again until none are, telling `progress` how far it got. It stops on a failure or a call that matched
 * nothing (so a stuck store can't loop), and never asks more than `max` times.
 */
export async function matchAll(progress: (done: number, of: number) => void, act: (b: GAction) => Promise<GReply> = groceryAction, max = 12): Promise<GReply> {
  let done = 0;
  let r: GReply = await act({ action: "match" });
  for (let n = 1; ; n++) {
    done += r.matched;
    progress(done, done + r.left);
    if (!r.ok || r.left === 0 || r.matched === 0 || n >= max) return r;
    r = await act({ action: "match" });
  }
}

/** The shelf an item sits on, for the List tab (#737): Kroger's department once matched, else a guess from its words. */
export const SHELVES = ["Produce", "Meat & seafood", "Dairy & eggs", "Bakery", "Frozen", "Pantry", "Drinks", "Household", "Other"] as const;
const SHELF_WORDS: [(typeof SHELVES)[number], RegExp][] = [
  // Jarred and boxed first, so chicken stock and tomato paste don't land with the meat and the vegetables.
  ["Pantry", /\b(stock|broth|paste|sauce|peanut butter|canned|powder|dried|ground (?:cumin|cinnamon|ginger|coriander))\b/i],
  ["Meat & seafood", /\b(beef|steak|chicken|pork|bacon|sausage|turkey|lamb|salmon|shrimp|fish|tuna|cod|ham|chorizo|meatballs?|thighs?|breasts?)\b/i],
  ["Dairy & eggs", /\b(milk|cream|butter|cheese|cheddar|parmesan|mozzarella|feta|yogurt|yoghurt|eggs?|sour cream|cottage)\b/i],
  [
    "Produce",
    /\b(lemons?|limes?|apples?|bananas?|berries|onions?|garlic|ginger|potatoes?|tomatoes|lettuce|spinach|kale|basil|cilantro|parsley|herbs?|peppers?|carrots?|celery|cucumbers?|avocados?|peas|bean sprouts|broccoli|zucchini|mushrooms?|scallions?|shallots?|cabbage|greens|fruit)\b/i,
  ],
  ["Bakery", /\b(bread|buns?|rolls?|tortillas?|bagels?|pita|naan|baguette)\b/i],
  ["Frozen", /\b(frozen|ice cream)\b/i],
  ["Drinks", /\b(coffee|tea|juice|soda|water|wine|beer|kombucha)\b/i],
  ["Household", /\b(paper|towels?|soap|detergent|foil|wrap|bags|sponges?|litter|trash)\b/i],
  ["Pantry", /\b(rice|pasta|noodles|flour|sugar|oil|vinegar|sauce|paste|stock|broth|beans|lentils|oats|panko|spices?|salt|pepper|honey|syrup|canned|cans?|cereal|nuts|peanut|soy|tahini|mustard|ketchup|mayo)\b/i],
];
export function shelfOf(name: string, product?: GProduct | null): string {
  const dept = product?.categories[0];
  if (dept) return dept;
  for (const [shelf, re] of SHELF_WORDS) if (re.test(name)) return shelf;
  return "Other";
}

/** One action; the fresh view comes back with it (and `url`: Kroger's sign-in for a connect, the cart after a send). */
export async function groceryAction(body: GAction, f: typeof fetch = fetch): Promise<GReply> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const got = o(await res.json().catch(() => ({})));
    const url = typeof got.url === "string" && (isKrogerSignIn(got.url) || isCartLink(got.url)) ? got.url : null;
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? null : s(got.error, 20) || "failed",
      view: readGroceries(got),
      url,
      items: cents(got.items) ?? 0,
      already: cents(got.already) ?? 0,
      matched: cents(got.matched) ?? 0,
      left: cents(got.left) ?? 0,
      by: got.by === "ai" || got.by === "rules" ? got.by : null,
      usd: typeof got.usd === "number" && Number.isFinite(got.usd) && got.usd >= 0 ? got.usd : 0,
    };
  } catch {
    return { ok: false, status: 0, error: "failed", view: null, url: null, items: 0, already: 0, matched: 0, left: 0, by: null, usd: 0 };
  }
}

/**
 * The Shopping card's Clear list (#761) tells the meal planner, which reopens the week (Finalize opens again) and goes
 * back to Plan. A listener per mounted planner; the returned function stops listening.
 */
const cleared = new Set<() => void>();
export const onListCleared = (fn: () => void): (() => void) => (cleared.add(fn), () => void cleared.delete(fn));
export const listCleared = () => cleared.forEach((fn) => fn());

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
  "not-found": "That item isn't on the list any more.",
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
