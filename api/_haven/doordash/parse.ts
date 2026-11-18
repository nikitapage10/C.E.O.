/**
 * DoorDash's CLI output, read as untrusted data (#1195, docs/HOME-DEVICES.md, "DoorDash"). Every parser here is
 * tolerant: the exact JSON shapes come from the CLI's own `--help` (its "Fields surfaced" and "Schema reference"
 * notes, printed by the probe on chat/1195-doordash-probe), not from a real account, so each field is looked for under
 * the names the help gives and a few near ones, and anything missing is null rather than an error. What comes out is
 * what the browser may see: closed sets, capped strings, whole cents, https links only on DoorDash's own hosts, ids of a
 * fixed shape. `widget_type`, `assistant_instructions` and any field not named here are never read. A card's id, a
 * full address and the raw output never leave the server: the parsers that need them (the preview's card id, the
 * default address's id) hand them back in a separate `secret` part the route keeps.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

type O = Record<string, unknown>;

/* ── Small readers ── */

const isObj = (v: unknown): v is O => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): O => (isObj(v) ? v : {});
const arr = (v: unknown, max = 200): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** The first of `keys` that `o` has (not null or undefined). */
function pick(o: unknown, ...keys: string[]): unknown {
  const r = obj(o);
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k];
  return undefined;
}

/** Control characters (C0, DEL, C1) as spaces; newlines too unless `keepLines`. */
function uncontrolled(t: string, keepLines = false): string {
  let out = "";
  for (const c of t) {
    const n = c.charCodeAt(0);
    out += (n < 0x20 && !(keepLines && n === 0x0a)) || (n >= 0x7f && n <= 0x9f) ? " " : c;
  }
  return out;
}

/** A plain, one-line string: control characters gone, spaces folded, capped; null when empty or not a string. */
export function str(v: unknown, max = 120): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = uncontrolled(String(v))
    .replace(/[\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** An id the CLI hands back (store, menu, item, cart line, order): letters, digits and a few marks, 1 to 80 long. */
export function idOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(t) ? t : null;
}

/** A numeric store id (the CLI's `--store-id INTEGER` on some commands). */
export const storeIdOf = (v: unknown): string | null => {
  const id = idOf(v);
  return id && /^\d{1,20}$/.test(id) ? id : null;
};

/** A cart's or an order's UUID. */
export const uuidOf = (v: unknown): string | null => {
  const id = idOf(v);
  return id && /^[0-9a-fA-F-]{8,64}$/.test(id) ? id : null;
};

/** The most an order may cost, in cents: Nikita's one per-order cap ($1,000). */
export const ORDER_CAP_CENTS = 100_000;
/** No single figure on DoorDash runs past this; anything bigger is a misread. */
const CENTS_MAX = 10_000_000;

const okCents = (n: number): number | null => (Number.isFinite(n) && n >= 0 && n <= CENTS_MAX ? Math.round(n) : null);

/** "$12.34", "-$3.00", "12.34", "$1,299.00" as whole cents (sign dropped; the caller knows if it's a discount). */
export function centsFromText(v: unknown): number | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const m = /^[^\d-]*-?\s*[^\d]*?([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(v.trim());
  if (!m) return null;
  const whole = Number(m[1]!.replace(/,/g, ""));
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return okCents(whole * 100 + frac);
}

/**
 * A money object as whole cents: `unit_amount` (cents, per the CLI's help) first, else `display_string`. Unsigned:
 * the CLI says `unit_amount` is unsigned even for credits.
 */
export function centsOfMoney(v: unknown): number | null {
  if (typeof v === "string") return centsFromText(v);
  if (!isObj(v)) return null;
  const unit = v.unit_amount ?? v.unitAmount ?? v.amount;
  if (typeof unit === "number" && Number.isInteger(unit)) return okCents(Math.abs(unit));
  return centsFromText(v.display_string ?? v.displayString);
}

/** A price the CLI gives in dollars (`price — current price (USD)`): a number of dollars, "$4.99", or a money object. */
export function centsOfPrice(v: unknown): number | null {
  if (typeof v === "number") return okCents(v * 100);
  if (typeof v === "string") return centsFromText(v);
  return centsOfMoney(v);
}

/** An explicit cents field (`*_cents`): a whole number. */
export function centsField(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? okCents(v) : null;
}

/** DoorDash's own hosts: its sites and its image CDN. */
const DD_HOSTS = ["doordash.com", "cdn4dd.com"];

/** A link or picture only when it is https on DoorDash's own hosts, with no port or credentials. */
export function ddUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1024) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    return DD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** DoorDash's image bucket on S3, where some store and menu pictures still live (an exact host, nothing else there). */
const DD_IMAGE_HOSTS = ["doordash-static.s3.amazonaws.com"];

/**
 * A picture (#1195, the DoorDash tab): https on DoorDash's own hosts (or its image bucket), as a string or an object
 * holding one (`{ url }`, `{ uri }`, `{ src }`). Anything else is null.
 */
export function ddImage(v: unknown): string | null {
  const raw = typeof v === "string" ? v : isObj(v) ? (v.url ?? v.uri ?? v.src ?? v.image_url) : null;
  const ok = ddUrl(raw);
  if (ok) return ok;
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && !u.port && !u.username && !u.password && DD_IMAGE_HOSTS.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The first of `keys` on `o` that holds a picture `ddImage` takes (the CLI's field names vary by command). */
export function imageOf(o: unknown, ...keys: string[]): string | null {
  const r = obj(o);
  for (const k of keys) {
    const v = r[k];
    const got = Array.isArray(v) ? ddImage(v[0]) : ddImage(v);
    if (got) return got;
  }
  return null;
}

/** Where a store's picture may be: its cover or header first, then any plain image field. */
const STORE_IMAGE = ["cover_image_url", "cover_img_url", "header_image_url", "header_img_url", "hero_image_url", "banner_image_url", "cover_square_img_url", "image_url", "store_image_url", "image", "cover_image", "header_image", "images"];
/** Where a store's logo may be. */
const STORE_LOGO = ["logo_url", "logo_image_url", "business_logo_url", "store_logo_url", "logo", "logo_image"];
/** Where a menu item's photo may be. */
const ITEM_IMAGE = ["image_url", "img_url", "image", "photo_url", "item_image_url", "thumbnail_url", "images", "photo"];

/** A delivery fee as a few words ("$1.99 delivery", "Free delivery"), from DoorDash's display string or its money. */
function feeOf(s: O): string | null {
  const shown = str(pick(s, "delivery_fee_display_string", "display_delivery_fee", "delivery_fee_string", "delivery_fee_text"), 30);
  if (shown) return shown;
  const raw = pick(s, "delivery_fee", "delivery_fee_monetary_fields");
  const cents = typeof raw === "string" ? centsFromText(raw) : isObj(raw) ? centsOfMoney(raw) : centsField(pick(s, "delivery_fee_cents"));
  if (cents === null) return null;
  return cents === 0 ? "Free delivery" : `$${(cents / 100).toFixed(2)} delivery`;
}

/** An ISO time, or epoch seconds or milliseconds, as ISO; null otherwise. */
export function timeOf(v: unknown): string | null {
  let ms = NaN;
  if (typeof v === "number") ms = v < 1e12 ? v * 1000 : v;
  else if (typeof v === "string" && v.length <= 40) ms = /^\d{9,13}$/.test(v) ? Number(v) * (v.length <= 10 ? 1000 : 1) : Date.parse(v);
  return Number.isFinite(ms) && ms > 0 && ms < 4e12 ? new Date(ms).toISOString() : null;
}

/** A plain-text answer's words (`{"content":[{"type":"text","text":...}]}`), capped, with any card id masked. */
export function textOf(json: unknown, max = 1200): string | null {
  const first = arr(obj(json).content, 5).find((c) => isObj(c) && typeof c.text === "string") as O | undefined;
  if (!first) return null;
  const t = uncontrolled(String(first.text), true)
    .replace(/\bpmf_[A-Za-z0-9_-]+/g, "[card]")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** `success: false` and its `message`/`fail_reason`, read as one short line. */
export function failureOf(json: unknown): string | null {
  const o = obj(json);
  if (o.success !== false) return null;
  return str(o.message ?? o.fail_reason ?? o.error_message ?? o.error, 200) ?? "DoorDash said no.";
}

/* ── Stores (search, find-nearby-stores) ── */

export interface DdStore {
  id: string;
  name: string;
  /** "25-35 min", as DoorDash wrote it. */
  eta: string | null;
  image: string | null;
  /** Pickup offered: true, false, or null when unknown. */
  pickup: boolean | null;
  /** Miles away, when DoorDash said (find-nearby-stores gives meters). */
  miles: number | null;
  rating: number | null;
  /** The store's logo, when DoorDash gave one apart from its cover picture. */
  logo: string | null;
  /** The delivery fee in a few words, when DoorDash said. */
  fee: string | null;
  /** Its cuisine or kind of food, when DoorDash said ("Ramen", "Pizza"). */
  cuisine: string | null;
}

function storeOf(raw: unknown): DdStore | null {
  const s = obj(raw);
  const id = storeIdOf(pick(s, "store_id", "storeId", "id"));
  const name = str(pick(s, "store_name", "name", "business_name", "title"), 80);
  if (!id || !name) return null;
  const meters = pick(s, "distance_meters", "distance");
  const rating = pick(s, "average_rating", "rating", "star_rating");
  const eta = pick(s, "delivery_time", "eta", "display_delivery_time", "asap_time");
  return {
    id,
    name,
    eta: typeof eta === "number" ? `${Math.round(eta)} min` : str(eta, 30),
    image: imageOf(s, ...STORE_IMAGE),
    pickup: typeof s.offers_pickup === "boolean" ? s.offers_pickup : null,
    miles: typeof meters === "number" && meters >= 0 && meters < 1e6 ? Math.round((meters / 1609) * 10) / 10 : null,
    rating: typeof rating === "number" && rating >= 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    logo: imageOf(s, ...STORE_LOGO),
    fee: feeOf(s),
    cuisine: str(pick(s, "cuisine", "cuisine_type", "primary_cuisine", "category") ?? arr(pick(s, "cuisines", "tags"), 1)[0], 40),
  };
}

/** `search` / `find-nearby-stores`: `stores[]`. */
export function storesOf(json: unknown, max = 20): DdStore[] {
  const o = obj(json);
  const list = arr(pick(o, "stores", "results", "restaurants"), 60);
  const seen = new Set<string>();
  const out: DdStore[] = [];
  for (const raw of list) {
    const s = storeOf(raw);
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
    if (out.length >= max) break;
  }
  return out;
}

/* ── Menus and items ── */

export type Orderable = "asap" | "later" | "no";

export interface DdItem {
  /** The menu item id, without the `i_` prefix `menu` may give it. */
  id: string;
  name: string;
  desc: string | null;
  priceCents: number | null;
  image: string | null;
  orderable: Orderable;
}

export interface DdMenu {
  storeId: string;
  storeName: string | null;
  menuId: string;
  sections: { name: string; items: DdItem[] }[];
  /** When a closed store opens again, if it is closed. */
  nextOpen: string | null;
  /** Deals this store runs, by their title and code (the code is what Nikita would type). */
  deals: { title: string; code: string | null }[];
  /** The store's header picture and logo, when the menu carries them (#1195, the DoorDash tab's store page). */
  image: string | null;
  logo: string | null;
}

/** `menu` items[].orderability: a list of "asap" / "schedule_ahead" / "unavailable" (or the old `is_orderable`). */
function orderableOf(i: O): Orderable {
  const list = arr(i.orderability, 5).filter((x): x is string => typeof x === "string");
  if (list.includes("asap")) return "asap";
  if (list.includes("schedule_ahead")) return "later";
  if (list.length) return "no";
  if (i.is_orderable === false) return "no";
  return "asap";
}

export const itemIdOf = (v: unknown): string | null => {
  const id = idOf(v);
  return id ? id.replace(/^i_/, "") || null : null;
};

function itemOf(raw: unknown): DdItem | null {
  const i = obj(raw);
  const id = itemIdOf(pick(i, "item_id", "id"));
  const name = str(pick(i, "name", "item_name", "title"), 90);
  if (!id || !name) return null;
  return {
    id,
    name,
    desc: str(pick(i, "description", "desc"), 240),
    priceCents: centsOfPrice(pick(i, "price", "display_price", "price_monetary_fields", "unit_price")),
    image: imageOf(i, ...ITEM_IMAGE),
    orderable: orderableOf(i),
  };
}

const SECTION_MAX = 40;
const ITEMS_MAX = 400;

/** `menu`: `menu_id`, `items[]` (each maybe with a category), or `categories[]`/`sections[]` holding items. */
export function menuOf(json: unknown, storeId: string): DdMenu | null {
  const o = obj(json);
  const menu = isObj(o.menu) ? o.menu : o;
  const menuId = idOf(pick(menu, "menu_id", "menuId") ?? pick(o, "menu_id"));
  if (!menuId) return null;
  const sections = new Map<string, DdItem[]>();
  let count = 0;
  const add = (section: string, raw: unknown) => {
    if (count >= ITEMS_MAX) return;
    const item = itemOf(raw);
    if (!item) return;
    if (!sections.has(section)) {
      if (sections.size >= SECTION_MAX) return;
      sections.set(section, []);
    }
    sections.get(section)!.push(item);
    count++;
  };
  const groups = arr(pick(menu, "categories", "sections", "menu_categories"), SECTION_MAX);
  for (const g of groups) {
    const name = str(pick(g, "name", "title", "category_name"), 60) ?? "Menu";
    for (const raw of arr(pick(g, "items", "menu_items"), ITEMS_MAX)) add(name, raw);
  }
  for (const raw of arr(pick(menu, "items", "menu_items"), ITEMS_MAX)) {
    const i = obj(raw);
    add(str(pick(i, "category", "category_name", "section", "menu_category", "section_name"), 60) ?? "Menu", raw);
  }
  const deals = arr(o.promotions ?? menu.promotions, 10)
    .map((p) => ({ title: str(pick(p, "title", "description"), 120), code: str(pick(p, "code"), 30) }))
    .filter((p): p is { title: string; code: string | null } => Boolean(p.title));
  return {
    storeId,
    storeName: str(pick(o, "store_name", "name") ?? pick(menu, "store_name"), 80),
    menuId,
    sections: [...sections].map(([name, items]) => ({ name, items })),
    nextOpen: timeOf(pick(o, "store_next_open_time") ?? pick(menu, "store_next_open_time")),
    deals,
    image: imageOf(o, ...STORE_IMAGE) ?? imageOf(menu, ...STORE_IMAGE) ?? imageOf(o.store, ...STORE_IMAGE),
    logo: imageOf(o, ...STORE_LOGO) ?? imageOf(menu, ...STORE_LOGO) ?? imageOf(o.store, ...STORE_LOGO),
  };
}

export interface DdChoice {
  id: string;
  name: string;
  priceCents: number | null;
}

export interface DdChoiceGroup {
  id: string;
  name: string;
  /** How many must be picked (0 = optional) and how many may be. */
  min: number;
  max: number;
  options: DdChoice[];
}

export interface DdItemDetails extends DdItem {
  groups: DdChoiceGroup[];
}

const countOf = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 50 ? v : dflt);

/** `restaurant-item-details` (or `item-details`): `item` with `extras[]`, each a group of `options[]`. */
export function itemDetailsOf(json: unknown): DdItemDetails | null {
  const o = obj(json);
  const raw = isObj(o.item) ? o.item : o;
  const item = itemOf(raw);
  if (!item) return null;
  const groups: DdChoiceGroup[] = [];
  for (const g of arr(pick(raw, "extras", "option_groups", "options_groups") ?? o.extras, 30)) {
    const name = str(pick(g, "name", "title"), 60);
    const options = arr(pick(g, "options", "choices"), 60)
      .map((c): DdChoice | null => {
        const id = idOf(pick(c, "option_id", "id"));
        const n = str(pick(c, "name", "title"), 80);
        return id && n ? { id, name: n, priceCents: centsOfPrice(pick(c, "price", "display_price", "price_monetary_fields")) } : null;
      })
      .filter((c): c is DdChoice => c !== null);
    if (!name || !options.length) continue;
    const min = countOf(pick(g, "min_num_options", "min_options", "min_selection", "min"), 0);
    const max = Math.max(min, countOf(pick(g, "max_num_options", "max_options", "max_selection", "max"), options.length)) || options.length;
    groups.push({ id: idOf(pick(g, "extra_id", "id")) ?? `g${groups.length}`, name, min, max, options });
  }
  return { ...item, groups };
}

/* ── Carts ── */

export interface DdCartLine {
  /** The cart-line id (`cart remove-item --cart-item-id`), not the menu item id. */
  id: string | null;
  itemId: string | null;
  name: string;
  qty: number;
  /** Weight-priced: the unit ("lb"); null for a count. */
  unit: string | null;
  priceCents: number | null;
}

export interface DdCart {
  uuid: string | null;
  storeId: string | null;
  storeName: string | null;
  lines: DdCartLine[];
}

const qtyOf = (v: unknown): number | null => (typeof v === "number" && v > 0 && v <= 999 ? Math.round(v * 100) / 100 : typeof v === "string" && /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? Number(v) : null);

function lineOf(raw: unknown): DdCartLine | null {
  const l = obj(raw);
  const name = str(pick(l, "name", "item_name") ?? pick(l.item, "name"), 90);
  const qty = qtyOf(pick(l, "quantity", "qty"));
  if (!name || qty === null) return null;
  const measured = l.purchase_type === "PURCHASE_TYPE_MEASUREMENT";
  return {
    id: idOf(pick(l, "id", "cart_item_id")),
    itemId: itemIdOf(pick(l, "item_id")),
    name,
    qty,
    unit: measured ? str(l.measurement_unit, 8) : null,
    priceCents: centsOfPrice(pick(l, "price", "unit_price", "price_monetary_fields")),
  };
}

/** `cart add-items` / `cart show` / `cart remove-item` / `order reorder`: `cart_uuid` and `cart{…, items[]}`. */
export function cartOf(json: unknown): DdCart | null {
  const o = obj(json);
  const c = isObj(o.cart) ? o.cart : o;
  const lines = arr(pick(c, "items", "order_items", "line_items"), 100)
    .map(lineOf)
    .filter((l): l is DdCartLine => l !== null);
  const uuid = uuidOf(pick(o, "cart_uuid", "cart_id") ?? pick(c, "cart_uuid", "id", "cart_id"));
  if (!uuid && !lines.length) return null;
  return { uuid, storeId: storeIdOf(pick(c, "store_id") ?? o.store_id), storeName: str(pick(c, "store_name") ?? o.store_name, 80), lines };
}

/** `cart list`: `carts[]` with `cart_uuid`, `store_id`, `items_count`. */
export function cartsOf(json: unknown): { uuid: string; storeId: string | null; count: number }[] {
  return arr(obj(json).carts, 50)
    .map((raw) => {
      const c = obj(raw);
      const uuid = uuidOf(pick(c, "cart_uuid", "id"));
      const count = typeof c.items_count === "number" ? c.items_count : arr(c.items).length;
      return uuid ? { uuid, storeId: storeIdOf(c.store_id), count: Math.max(0, Math.min(999, Math.round(count))) } : null;
    })
    .filter((c): c is { uuid: string; storeId: string | null; count: number } => c !== null);
}

/** What `cart add-items` could not add: each item's name and why (and the choices a required option needs). */
export function itemErrorsOf(json: unknown): { name: string; why: string }[] {
  return arr(obj(json).item_errors, 30)
    .map((raw) => {
      const e = obj(raw);
      const name = str(pick(e, "item_name", "name"), 90) ?? "An item";
      const needs = arr(e.required_options, 5)
        .map((r) => str(pick(r, "name"), 40))
        .filter(Boolean);
      const why = needs.length ? `needs a choice: ${needs.join(", ")}` : (str(pick(e, "error_message", "message"), 140) ?? "couldn't be added");
      return { name, why };
    })
    .slice(0, 30);
}

/* ── The preview ── */

export type Fulfillment = "delivery" | "pickup";

export interface DdBreakdown {
  label: string;
  cents: number;
  /** A discount or credit: shown as minus. */
  minus: boolean;
}

export interface DdWindow {
  /** "9:20 PM-9:40 PM" */
  label: string;
  /** "Tue, Nov 17" */
  day: string;
  /** The window's midpoint, ISO UTC: what --scheduled-time takes. */
  at: string;
}

export interface DdPreviewView {
  lines: { name: string; qty: number; price: string | null }[];
  breakdown: DdBreakdown[];
  /** The authoritative total before the tip (`net_total_before_tip`), whole cents. */
  netCents: number;
  fulfillment: Fulfillment | null;
  /** ETA words for ASAP ("25-35 min"), when DoorDash said. */
  eta: string | null;
  asap: boolean | null;
  pickupAsap: boolean | null;
  scheduledAvailable: boolean;
  windows: DdWindow[];
  priorityOffered: boolean;
  /** The card's display name ("Visa ending in 4242"), never its id. */
  card: string | null;
  /** Tip presets in cents, the suggested one first marked. */
  tips: { label: string; cents: number }[];
  tipDefault: number | null;
  pretippable: boolean;
  /** A PIN handoff is required at drop-off. */
  pin: boolean;
  dashpass: boolean;
  creditsCents: number | null;
}

export interface DdPreviewParsed {
  view: DdPreviewView;
  /** The card the quote priced on, kept server side for `order submit --card-id`. */
  cardId: string | null;
}

/** A card's display name, kept only when it reads like one ("Visa ending in 4242") and carries no long number. */
export function cardNameOf(v: unknown): string | null {
  const t = str(v, 48);
  if (!t || /\d{5,}/.test(t) || /pmf_/i.test(t)) return null;
  return t;
}

const MINUS = /credit|discount|promo|saving|off\b/i;

function windowsOf(avail: O): DdWindow[] {
  const out: DdWindow[] = [];
  for (const d of arr(avail.available_days, 7)) {
    const ts = obj(obj(d).day_timestamp);
    const day = typeof ts.year === "number" && typeof ts.month === "number" && typeof ts.day === "number" ? new Date(Date.UTC(ts.year, ts.month - 1, ts.day, 12)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : null;
    for (const w of arr(obj(d).time_windows, 24)) {
      const at = timeOf(pick(w, "midpoint_timestamp", "range_min"));
      const label = str(pick(w, "display_string"), 40);
      if (at && label) out.push({ label, day: day ?? at.slice(0, 10), at });
      if (out.length >= 48) return out;
    }
  }
  return out;
}

/**
 * `order preview`: `payment_method{display_name, card_id}` and `quote{…}` (the CLI's "Schema reference"). Null when
 * no total can be read: the route then shows the CLI's text instead, and nothing can be placed from it.
 */
export function previewOf(json: unknown): DdPreviewParsed | null {
  const o = obj(json);
  if (o.success === false) return null;
  const q = isObj(o.quote) ? o.quote : o;
  const netCents = centsOfMoney(pick(q, "net_total_before_tip", "net_total", "total"));
  if (netCents === null) return null;
  const pm = obj(pick(o, "payment_method") ?? q.payment_method);
  const cardIdRaw = pick(pm, "card_id", "id");
  const cardId = typeof cardIdRaw === "string" && cardIdRaw.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(cardIdRaw) ? cardIdRaw : null;
  const soc = obj(q.store_order_cart);
  const lines: DdPreviewView["lines"] = [];
  for (const order of arr(soc.orders, 5))
    for (const it of arr(obj(order).order_items, 100)) {
      const name = str(pick(obj(it).item, "name") ?? pick(it, "name"), 90);
      const qty = qtyOf(pick(it, "quantity"));
      if (name && qty !== null) lines.push({ name, qty, price: str(pick(obj(it).unit_price_monetary_fields, "display_string"), 20) });
    }
  const breakdown: DdBreakdown[] = [];
  for (const li of arr(q.line_items, 20)) {
    const label = str(pick(li, "label", "title"), 40);
    const money = pick(li, "final_money", "money", "amount");
    const cents = centsOfMoney(money);
    if (!label || cents === null) continue;
    const display = str(pick(money, "display_string"), 30) ?? "";
    const charge = str(pick(li, "charge_id"), 40) ?? "";
    breakdown.push({ label, cents, minus: display.trim().startsWith("-") || /CREDIT|DISCOUNT/.test(charge) || (MINUS.test(label) && cents > 0 && !/fee/i.test(label)) });
  }
  const ft = str(soc.fulfillment_type, 20)?.toUpperCase();
  const avail = obj(q.delivery_availability);
  const options = arr(avail.delivery_options, 10);
  const tipsGroup = obj(arr(q.tips_suggestion_details, 3)[0]);
  const amounts = arr(tipsGroup.percentage_to_amount_monetary_values, 8).map(centsOfMoney);
  const percents = arr(tipsGroup.percentage_values, 8);
  const tips = amounts
    .map((cents, i) => (cents === null ? null : { label: typeof percents[i] === "number" ? `${percents[i] as number}%` : `$${(cents / 100).toFixed(2)}`, cents }))
    .filter((t): t is { label: string; cents: number } => t !== null && t.cents <= 50_000);
  const di = tipsGroup.default_index;
  const tipDefault = typeof di === "number" && Number.isInteger(di) && amounts[di] != null ? amounts[di]! : null;
  const etaRaw = pick(avail, "asap_minutes_range_string", "asap_delivery_minutes_range_string", "delivery_minutes_range_string", "asap_pickup_minutes_range_string");
  return {
    cardId,
    view: {
      lines: lines.slice(0, 100),
      breakdown,
      netCents,
      fulfillment: ft === "PICKUP" || soc.is_consumer_pickup === true ? "pickup" : ft === "DELIVERY" ? "delivery" : null,
      eta: str(etaRaw, 30),
      asap: typeof avail.asap_available === "boolean" ? avail.asap_available : null,
      pickupAsap: typeof avail.asap_pickup_available === "boolean" ? avail.asap_pickup_available : null,
      scheduledAvailable: avail.scheduled_delivery_available === true,
      windows: windowsOf(avail),
      priorityOffered: options.some((d) => obj(d).delivery_option_type === "PRIORITY"),
      card: cardNameOf(pm.display_name),
      tips,
      tipDefault,
      pretippable: q.is_pre_tippable !== false,
      pin: arr(q.dropoff_options, 10).some((d) => obj(d).proof_of_delivery_type === "PIN_CODE"),
      dashpass: q.is_dashpass_applied === true,
      creditsCents: centsOfMoney(obj(q.credit_details).total_credits_applied),
    },
  };
}

/* ── Submit, status, history, receipts ── */

/** `order submit`: the `order_uuid`, and a restricted-item refusal when there is one. */
export function submitOf(json: unknown): { orderUuid: string | null; restricted: boolean; failure: string | null } {
  const o = obj(json);
  const reason = str(pick(o, "error_reason"), 80) ?? "";
  return {
    orderUuid: uuidOf(pick(o, "order_uuid", "orderUuid") ?? pick(o.order, "order_uuid", "uuid", "id")),
    restricted: /RESTRICTED/i.test(reason) || /age-restricted/i.test(str(o.message, 300) ?? ""),
    failure: failureOf(json),
  };
}

export const STATUSES = ["pending", "action_required", "order_declined", "placed", "scheduled", "store_confirmed", "ready_for_pickup", "dasher_assigned", "dasher_at_store", "picked_up", "dasher_nearby", "completed", "cancelled", "not_found", "unknown"] as const;
export type DdStatus = (typeof STATUSES)[number];
/** Statuses after which nothing changes. */
export const FINAL_STATUSES: readonly DdStatus[] = ["action_required", "order_declined", "completed", "cancelled", "not_found"];

export interface DdOrderStatus {
  status: DdStatus;
  /** "Arriving 7:42 PM" or similar, as DoorDash put it. */
  eta: string | null;
  /** DoorDash's own page for the order (the live map), when the CLI gave one. */
  link: string | null;
}

/** `order status`: `status` (maybe under `result`), an ETA, and a tracking link if there is one. */
export function statusOf(json: unknown): DdOrderStatus {
  const o = obj(json);
  const r = isObj(o.result) ? o.result : o;
  const raw = (str(pick(r, "status", "order_status") ?? pick(o, "status"), 40) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const status = (STATUSES as readonly string[]).includes(raw) ? (raw as DdStatus) : raw ? "unknown" : "not_found";
  const link = ddUrl(pick(r, "tracking_url", "order_tracking_url", "tracking_link", "url", "link") ?? pick(o, "tracking_url", "url"));
  return { status, eta: str(pick(r, "eta", "estimated_delivery_time", "eta_display_string", "status_message"), 60), link };
}

export interface DdPastOrder {
  id: string;
  store: string;
  storeId: string | null;
  when: string | null;
  items: string[];
  reorderable: boolean;
  totalCents: number | null;
  pickup: boolean;
  grocery: boolean;
  /** The store's picture, when the history carries one (#1195, the DoorDash tab's Usuals). */
  image: string | null;
}

/** `order history`: `orders[]`. */
export function historyOf(json: unknown, max = 50): DdPastOrder[] {
  return arr(obj(json).orders, 100)
    .map((raw): DdPastOrder | null => {
      const o = obj(raw);
      const id = uuidOf(pick(o, "order_uuid", "uuid", "id"));
      const store = str(pick(o, "store_name") ?? pick(o.store, "name"), 80);
      if (!id || !store) return null;
      const items = arr(pick(o, "items", "order_items"), 30)
        .map((i) => {
          const n = str(typeof i === "string" ? i : (pick(i, "name", "item_name") ?? pick(obj(i).item, "name")), 60);
          const q = qtyOf(pick(i, "quantity"));
          return n ? (q && q !== 1 ? `${q}× ${n}` : n) : null;
        })
        .filter((n): n is string => n !== null);
      return {
        id,
        store,
        storeId: storeIdOf(pick(o, "store_id") ?? pick(o.store, "id")),
        when: timeOf(pick(o, "created_at", "submitted_at", "ordered_at", "delivered_at", "created_at_ms")),
        items,
        reorderable: o.is_reorderable !== false,
        totalCents: centsOfPrice(pick(o, "total", "grand_total", "total_charged", "order_total")),
        pickup: /PICKUP/i.test(str(o.fulfillment_type, 40) ?? ""),
        grocery: /GROCERY/i.test(str(o.order_target, 40) ?? ""),
        image: imageOf(o, "store_image_url", "store_cover_image_url", "store_header_image_url", "store_logo_url") ?? imageOf(o.store, ...STORE_IMAGE, ...STORE_LOGO),
      };
    })
    .filter((o): o is DdPastOrder => o !== null)
    .slice(0, max);
}

/**
 * The Usuals: places ordered from more than once (or the last few), newest order of each, reorderable ones only, best
 * first by how often.
 */
export function usualsOf(orders: DdPastOrder[], max = 6): (DdPastOrder & { times: number })[] {
  const by = new Map<string, { o: DdPastOrder; times: number }>();
  for (const o of orders) {
    if (!o.reorderable || o.grocery) continue;
    const key = o.storeId ?? o.store.toLowerCase();
    const had = by.get(key);
    if (had) had.times++;
    else by.set(key, { o, times: 1 });
  }
  return [...by.values()]
    .sort((a, b) => b.times - a.times || Date.parse(b.o.when ?? "") - Date.parse(a.o.when ?? "") || 0)
    .slice(0, max)
    .map(({ o, times }) => ({ ...o, times }));
}

export interface DdReceipt {
  store: string | null;
  lines: { name: string; qty: number; price: string | null }[];
  breakdown: DdBreakdown[];
  totalCents: number | null;
  /** The card's last four digits, as DoorDash gives them. */
  last4: string | null;
}

/** `order receipt`: the store, items, line items (subtotal, fees, tax, tip, total) and the card's last 4. */
export function receiptOf(json: unknown): DdReceipt | null {
  const o = obj(json);
  const r = isObj(o.receipt) ? o.receipt : o;
  const lines = arr(pick(r, "items", "order_items"), 100)
    .map((i) => {
      const name = str(pick(i, "name", "item_name") ?? pick(obj(i).item, "name"), 90);
      const qty = qtyOf(pick(i, "quantity")) ?? 1;
      const price = pick(i, "price", "total", "unit_price");
      return name ? { name, qty, price: typeof price === "string" ? str(price, 20) : centsOfPrice(price) !== null ? `$${(centsOfPrice(price)! / 100).toFixed(2)}` : null } : null;
    })
    .filter((l): l is DdReceipt["lines"][number] => l !== null);
  const breakdown: DdBreakdown[] = [];
  let totalCents: number | null = null;
  for (const li of arr(pick(r, "line_items", "charges", "breakdown"), 20)) {
    const label = str(pick(li, "label", "name", "title"), 40);
    const v = pick(li, "final_money", "amount", "money", "value", "price");
    const cents = typeof v === "number" ? centsOfPrice(v) : centsOfMoney(v);
    if (!label || cents === null) continue;
    if (/^total$/i.test(label)) totalCents = cents;
    else breakdown.push({ label, cents, minus: MINUS.test(label) && !/fee/i.test(label) });
  }
  totalCents ??= centsOfPrice(pick(r, "total", "grand_total", "total_charged"));
  const last4Raw = str(pick(r, "card_last4", "last4", "card_last_four") ?? pick(r.payment_method, "last4", "last_four"), 8);
  if (!lines.length && !breakdown.length && totalCents === null) return null;
  return { store: str(pick(r, "store_name") ?? pick(r.store, "name"), 80), lines, breakdown, totalCents, last4: last4Raw && /^\d{4}$/.test(last4Raw) ? last4Raw : null };
}

/* ── The account's own (server side only) ── */

/** `address list`: the default address's id (server only) and its label (the browser may see the label alone). */
export function defaultAddressOf(json: unknown): { id: string; label: string | null } | null {
  const list = arr(obj(json).addresses, 100).map(obj);
  const chosen = list.find((a) => a.is_default === true) ?? (list.length === 1 ? list[0] : undefined);
  const id = chosen ? idOf(chosen.address_id ?? chosen.id) : null;
  return id ? { id, label: str(chosen!.label, 30) } : null;
}

/** `payment-method list`: the default card's display name (for a scheduled order, which names no card). */
export function defaultCardOf(json: unknown): string | null {
  const c = arr(obj(json).payment_methods, 30)
    .map(obj)
    .find((p) => p.is_default === true && p.is_expired !== true);
  return c ? cardNameOf(c.display_name) : null;
}

/** `promo apply`: whether it took, the discount and DoorDash's short reason. */
export function promoOf(json: unknown): { ok: boolean; discountCents: number | null; message: string | null } {
  const o = obj(json);
  return { ok: o.success === true, discountCents: centsField(o.discount_cents), message: str(o.message, 160) };
}

/* ── Groceries (phase 3: DoorDash in the Kitchen's Shop step) ── */

export interface DdGroceryLine {
  /** The item id for `cart add-items` (`items[].id`). */
  id: string;
  name: string;
  /** The Kitchen list's words it was found for, when DoorDash said. */
  forName: string | null;
  qty: number;
  /** Weight-priced: the unit ("lb"); null for a count. */
  unit: string | null;
  priceCents: number | null;
  out: boolean;
  /** DoorDash's suggested swaps when it's out of stock. */
  subs: { id: string; name: string; priceCents: number | null }[];
}

export interface DdGroceryList {
  storeId: string | null;
  storeName: string | null;
  menuId: string | null;
  lines: DdGroceryLine[];
  /** What it couldn't find, from its `message` ("couldn't find: bananas, kale"). */
  missing: string[];
  message: string | null;
}

/** "couldn't find: bananas, kale" (and near wordings) as a list of the names. */
export function missingOf(message: string | null): string[] {
  if (!message) return [];
  const m = /(?:couldn['’]?t|could not|unable to|did not|didn['’]?t)\s+(?:find|match)[^:]*:\s*(.+)$/i.exec(message);
  if (!m) return [];
  return m[1]!
    .split(/,|;|\band\b/)
    .map((s) => str(s.replace(/[."]+$/g, ""), 60))
    .filter((s): s is string => s !== null)
    .slice(0, 60);
}

type Found = { id: string; name: string; priceCents: number | null; image: string | null };

const foundOf = (raw: unknown): Found | null => {
  const s = obj(raw);
  const id = itemIdOf(pick(s, "item_id", "id"));
  const name = str(pick(s, "name", "item_name"), 90);
  return id && name ? { id, name, priceCents: centsOfPrice(pick(s, "price")), image: ddUrl(pick(s, "image_url", "image")) } : null;
};

/** `build-grocery-list`: `items[]`, `menu_id`, `store_name`, `message`; the store's id from `items[].store_id`. */
export function groceryListOf(json: unknown): DdGroceryList | null {
  const o = obj(json);
  const lines: DdGroceryLine[] = [];
  let storeId: string | null = null;
  for (const raw of arr(o.items, 120)) {
    const i = obj(raw);
    const id = itemIdOf(pick(i, "id", "item_id"));
    const name = str(pick(i, "name", "item_name"), 90);
    if (!id || !name) continue;
    storeId ??= storeIdOf(i.store_id);
    const stock = str(pick(i, "stock_status", "availability", "stock_level"), 30) ?? "";
    lines.push({
      id,
      name,
      forName: str(pick(i, "query", "search_term", "requested_name", "input_name", "original_name", "input"), 60),
      qty: qtyOf(pick(i, "quantity")) ?? 1,
      unit: i.purchase_type === "PURCHASE_TYPE_MEASUREMENT" ? str(i.measurement_unit, 8) : null,
      priceCents: centsOfPrice(pick(i, "price")),
      out: i.is_available === false || i.out_of_stock === true || /out|unavailable/i.test(stock),
      subs: arr(i.substitutions, 5)
        .map(foundOf)
        .filter((s): s is Found => s !== null)
        .map(({ id: sid, name: sname, priceCents }) => ({ id: sid, name: sname, priceCents })),
    });
  }
  const message = str(o.message, 400);
  if (!lines.length && !message) return null;
  return { storeId, storeName: str(o.store_name, 80), menuId: idOf(o.menu_id), lines, missing: missingOf(message), message };
}

/** `find-items`: `results` keyed by each query (or a plain list): the items it found for `query`. */
export function foundItemsOf(json: unknown, query: string, max = 8): Found[] {
  const o = obj(json);
  const results = o.results ?? o.items;
  let list: unknown = results;
  if (!Array.isArray(results)) {
    const keyed = obj(results);
    list = Array.isArray(keyed[query]) ? keyed[query] : Object.values(keyed).find(Array.isArray);
  }
  return arr(list, 30)
    .map(foundOf)
    .filter((x): x is Found => x !== null)
    .slice(0, max);
}

/** `item-details`: its top-level `menu_id` (the fallback when `build-grocery-list` gives none). */
export const menuIdOf = (json: unknown): string | null => idOf(obj(json).menu_id ?? obj(obj(json).item).menu_id);
