/**
 * The Kitchen's Order tab, browser side (#1195, phase 1; api/_haven/doordash/order.ts). Every call is a passkey POST to
 * the server, which runs DoorDash's CLI; what comes back is read again here as untrusted data: whole cents, capped
 * strings, closed sets, and only https links and pictures on DoorDash's own hosts. The browser never holds the token,
 * a card's id or the full address; it names the card by its display name and the address by its label.
 */

const PATH = "/api/haven/doordash/order";

export type Fulfillment = "delivery" | "pickup";

export interface Store {
  id: string;
  name: string;
  eta: string | null;
  image: string | null;
  pickup: boolean | null;
  miles: number | null;
  rating: number | null;
}

export interface Item {
  id: string;
  name: string;
  desc: string | null;
  priceCents: number | null;
  image: string | null;
  orderable: "asap" | "later" | "no";
}

export interface Menu {
  storeId: string;
  storeName: string | null;
  menuId: string;
  sections: { name: string; items: Item[] }[];
  nextOpen: string | null;
  deals: { title: string; code: string | null }[];
}

export interface ChoiceGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; priceCents: number | null }[];
}

export interface ItemDetails extends Item {
  groups: ChoiceGroup[];
}

export interface CartLine {
  id: string | null;
  itemId: string | null;
  name: string;
  qty: number;
  unit: string | null;
  priceCents: number | null;
}

export interface Cart {
  storeId: string | null;
  storeName: string | null;
  lines: CartLine[];
  maybeSpent: boolean;
}

export interface PastOrder {
  id: string;
  store: string;
  storeId: string | null;
  when: string | null;
  items: string[];
  reorderable: boolean;
  totalCents: number | null;
  pickup: boolean;
  times?: number;
}

export interface Breakdown {
  label: string;
  cents: number;
  minus: boolean;
}

export interface Preview {
  id: string;
  until: string;
  storeName: string | null;
  lines: { name: string; qty: number; price: string | null }[];
  breakdown: Breakdown[];
  netCents: number;
  fulfillment: Fulfillment | null;
  pickup: boolean;
  eta: string | null;
  asap: boolean | null;
  pickupAsap: boolean | null;
  scheduledAvailable: boolean;
  windows: { label: string; day: string; at: string }[];
  scheduled: string | null;
  priority: boolean;
  priorityOffered: boolean;
  card: string | null;
  cardNote: string | null;
  address: string;
  tips: { label: string; cents: number }[];
  tipDefault: number | null;
  pretippable: boolean;
  pin: boolean;
  dashpass: boolean;
  creditsCents: number | null;
  dropped: string[];
  capCents: number;
}

export type PlacementStatus = "submitting" | "placed" | "failed" | "maybe";

export interface Placement {
  status: PlacementStatus;
  orderId: string | null;
  error: string | null;
  totalCents: number;
}

export const STATUS_WORDS: Record<string, string> = {
  pending: "Processing",
  action_required: "Needs a step in the DoorDash app",
  order_declined: "Didn't go through",
  placed: "Placed",
  scheduled: "Scheduled",
  store_confirmed: "The restaurant has it",
  ready_for_pickup: "Ready for pick-up",
  dasher_assigned: "A Dasher is on it",
  dasher_at_store: "Dasher at the restaurant",
  picked_up: "On the way",
  dasher_nearby: "Almost there",
  completed: "Delivered",
  cancelled: "Cancelled",
  not_found: "Not found",
  unknown: "Status unknown",
};

export interface OrderStatus {
  status: string;
  eta: string | null;
  link: string | null;
  final: boolean;
}

export interface Receipt {
  store: string | null;
  lines: { name: string; qty: number; price: string | null }[];
  breakdown: Breakdown[];
  totalCents: number | null;
  last4: string | null;
}

/* ── Untrusted-data readers ── */

type O = Record<string, unknown>;
const obj = (v: unknown): O => (v && typeof v === "object" && !Array.isArray(v) ? (v as O) : {});
const list = (v: unknown, max = 200): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
export const text = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : null);
export const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null);
const id = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const num = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
const time = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);

/** Only https on DoorDash's own hosts (its sites and its image CDN). */
export function ddLink(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1024) return null;
  try {
    const u = new URL(v);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
    return ["doordash.com", "cdn4dd.com"].some((d) => h === d || h.endsWith(`.${d}`)) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function readStore(v: unknown): Store | null {
  const s = obj(v);
  const i = id(s.id);
  const name = text(s.name, 80);
  return i && name ? { id: i, name, eta: text(s.eta, 30), image: ddLink(s.image), pickup: bool(s.pickup), miles: num(s.miles, 1000), rating: num(s.rating, 5) } : null;
}

const readItem = (v: unknown): Item | null => {
  const i = obj(v);
  const iid = id(i.id);
  const name = text(i.name, 90);
  const orderable = i.orderable === "later" || i.orderable === "no" ? i.orderable : "asap";
  return iid && name ? { id: iid, name, desc: text(i.desc, 240), priceCents: cents(i.priceCents), image: ddLink(i.image), orderable } : null;
};

export function readMenu(v: unknown): Menu | null {
  const m = obj(v);
  const storeId = id(m.storeId);
  const menuId = id(m.menuId);
  if (!storeId || !menuId) return null;
  return {
    storeId,
    menuId,
    storeName: text(m.storeName, 80),
    nextOpen: time(m.nextOpen),
    sections: list(m.sections, 40)
      .map((s) => ({ name: text(obj(s).name, 60) ?? "Menu", items: list(obj(s).items, 400).map(readItem).filter((x): x is Item => x !== null) }))
      .filter((s) => s.items.length),
    deals: list(m.deals, 10)
      .map((d) => ({ title: text(obj(d).title, 120), code: text(obj(d).code, 30) }))
      .filter((d): d is { title: string; code: string | null } => Boolean(d.title)),
  };
}

export function readDetails(v: unknown): ItemDetails | null {
  const base = readItem(v);
  if (!base) return null;
  const groups = list(obj(v).groups, 30)
    .map((g): ChoiceGroup | null => {
      const o = obj(g);
      const gid = id(o.id);
      const name = text(o.name, 60);
      const options = list(o.options, 60)
        .map((c) => {
          const co = obj(c);
          const cid = id(co.id);
          const cn = text(co.name, 80);
          return cid && cn ? { id: cid, name: cn, priceCents: cents(co.priceCents) } : null;
        })
        .filter((c): c is ChoiceGroup["options"][number] => c !== null);
      const min = num(o.min, 50) ?? 0;
      const max = Math.max(min, num(o.max, 50) ?? options.length);
      return gid && name && options.length ? { id: gid, name, min, max, options } : null;
    })
    .filter((g): g is ChoiceGroup => g !== null);
  return { ...base, groups };
}

export function readCart(v: unknown): Cart | null {
  if (!v || typeof v !== "object") return null;
  const c = obj(v);
  return {
    storeId: id(c.storeId),
    storeName: text(c.storeName, 80),
    maybeSpent: c.maybeSpent === true,
    lines: list(c.lines, 100)
      .map((l): CartLine | null => {
        const o = obj(l);
        const name = text(o.name, 90);
        const qty = num(o.qty, 999);
        return name && qty ? { id: id(o.id), itemId: id(o.itemId), name, qty, unit: text(o.unit, 8), priceCents: cents(o.priceCents) } : null;
      })
      .filter((l): l is CartLine => l !== null),
  };
}

export function readOrder(v: unknown): PastOrder | null {
  const o = obj(v);
  const oid = id(o.id);
  const store = text(o.store, 80);
  if (!oid || !store) return null;
  return {
    id: oid,
    store,
    storeId: id(o.storeId),
    when: time(o.when),
    items: list(o.items, 30)
      .map((i) => text(i, 60))
      .filter((i): i is string => i !== null),
    reorderable: o.reorderable !== false,
    totalCents: cents(o.totalCents),
    pickup: o.pickup === true,
    ...(typeof o.times === "number" ? { times: Math.min(99, Math.max(1, Math.round(o.times))) } : {}),
  };
}

const readBreakdown = (v: unknown): Breakdown[] =>
  list(v, 20)
    .map((b) => {
      const o = obj(b);
      const label = text(o.label, 40);
      const c = cents(o.cents);
      return label && c !== null ? { label, cents: c, minus: o.minus === true } : null;
    })
    .filter((b): b is Breakdown => b !== null);

const readLines = (v: unknown) =>
  list(v, 100)
    .map((l) => {
      const o = obj(l);
      const name = text(o.name, 90);
      const qty = num(o.qty, 999);
      return name && qty ? { name, qty, price: text(o.price, 20) } : null;
    })
    .filter((l): l is Preview["lines"][number] => l !== null);

export function readPreview(v: unknown): Preview | null {
  const p = obj(v);
  const pid = typeof p.id === "string" && /^[0-9a-f]{16}$/.test(p.id) ? p.id : null;
  const net = cents(p.netCents);
  const until = time(p.until);
  if (!pid || net === null || !until) return null;
  return {
    id: pid,
    until,
    storeName: text(p.storeName, 80),
    lines: readLines(p.lines),
    breakdown: readBreakdown(p.breakdown),
    netCents: net,
    fulfillment: p.fulfillment === "pickup" || p.fulfillment === "delivery" ? p.fulfillment : null,
    pickup: p.pickup === true,
    eta: text(p.eta, 30),
    asap: bool(p.asap),
    pickupAsap: bool(p.pickupAsap),
    scheduledAvailable: p.scheduledAvailable === true,
    windows: list(p.windows, 48)
      .map((w) => {
        const o = obj(w);
        const label = text(o.label, 40);
        const at = time(o.at);
        return label && at ? { label, day: text(o.day, 20) ?? "", at } : null;
      })
      .filter((w): w is Preview["windows"][number] => w !== null),
    scheduled: time(p.scheduled),
    priority: p.priority === true,
    priorityOffered: p.priorityOffered === true,
    card: text(p.card, 48),
    cardNote: text(p.cardNote, 120),
    address: text(p.address, 40) ?? "your default address",
    tips: list(p.tips, 8)
      .map((t) => {
        const o = obj(t);
        const label = text(o.label, 12);
        const c = cents(o.cents);
        return label && c !== null && c <= 50_000 ? { label, cents: c } : null;
      })
      .filter((t): t is { label: string; cents: number } => t !== null),
    tipDefault: cents(p.tipDefault),
    pretippable: p.pretippable !== false,
    pin: p.pin === true,
    dashpass: p.dashpass === true,
    creditsCents: cents(p.creditsCents),
    dropped: list(p.dropped, 20)
      .map((d) => text(d, 60))
      .filter((d): d is string => d !== null),
    capCents: cents(p.capCents) ?? 100_000,
  };
}

export function readPlacement(v: unknown): Placement | null {
  const p = obj(v);
  const status = (["submitting", "placed", "failed", "maybe"] as const).find((s) => s === p.status);
  return status ? { status, orderId: id(p.orderId), error: text(p.error, 30), totalCents: cents(p.totalCents) ?? 0 } : null;
}

export function readStatus(v: unknown): OrderStatus | null {
  const s = obj(v);
  const status = typeof s.status === "string" && s.status in STATUS_WORDS ? s.status : null;
  return status ? { status, eta: text(s.eta, 60), link: ddLink(s.link), final: s.final === true } : null;
}

export function readReceipt(v: unknown): Receipt | null {
  if (!v || typeof v !== "object") return null;
  const r = obj(v);
  return { store: text(r.store, 80), lines: readLines(r.lines), breakdown: readBreakdown(r.breakdown), totalCents: cents(r.totalCents), last4: typeof r.last4 === "string" && /^\d{4}$/.test(r.last4) ? r.last4 : null };
}

/* ── The call ── */

export interface OrderReply {
  ok: boolean;
  status: number;
  error: string | null;
  message: string | null;
  /** The CLI's plain-text answer, when its JSON couldn't be read. */
  text: string | null;
  data: O;
}

export async function orderCall(body: Record<string, unknown>, f: typeof fetch = fetch): Promise<OrderReply> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (res.status === 404 || res.status === 405) return { ok: false, status: res.status, error: "off", message: null, text: null, data: {} };
    const got = obj(await res.json().catch(() => ({})));
    const error = res.ok && got.ok !== false ? null : (text(got.error, 30) ?? (res.ok ? null : "failed"));
    return { ok: res.ok && got.ok !== false, status: res.status, error, message: text(got.message, 300), text: text(got.text, 1200), data: got };
  } catch {
    return { ok: false, status: 0, error: "failed", message: null, text: null, data: {} };
  }
}

/** Dollars and cents, "$12.34". */
export const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A one-time key for one placement: the server answers a second tap with the first one's outcome. */
export function placeKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** What the tab says when something didn't work. */
export const ORDER_NOTE: Record<string, string> = {
  expired: "Your DoorDash sign-in ran out. Sign in again below.",
  "signed-out": "Sign in to DoorDash first.",
  gated: "DoorDash hasn't turned this on for the account.",
  busy: "DoorDash is busy or slow right now. Try again in a minute.",
  rejected: "DoorDash turned that down.",
  vendor: "DoorDash didn't answer properly. Try again.",
  "no-address": "DoorDash has no default delivery address for the account. Set one in the DoorDash app.",
  "no-cart": "The cart is empty.",
  "maybe-placed": "The last order may have gone through. Check Orders, then Start over.",
  stale: "That price ran out (it holds 5 minutes). Price it again.",
  spent: "That price was already used. Price it again.",
  "total-mismatch": "The total didn't match. Price it again.",
  "over-cap": "That's over the $1,000 per-order limit.",
  placing: "An order is already being placed.",
  changed: "The price changed. Check the new total and place again.",
  unreadable: "DoorDash's answer couldn't be read.",
  "bad-time": "Pick one of the delivery windows.",
  "not-set-up": "DoorDash isn't set up on the server yet.",
  off: "Ordering isn't on this server.",
  "no-store": "Pick a DoorDash grocery store first.",
  "empty-list": "The Kitchen list has nothing open to shop for.",
  "bad-request": "That didn't look right. Build the list again.",
  failed: "That didn't go through. Try again.",
};

export const noteOf = (r: Pick<OrderReply, "error" | "message">) => r.message ?? ORDER_NOTE[r.error ?? "failed"] ?? ORDER_NOTE.failed!;

/** Whether a set of picks meets every group's minimum and maximum. */
export function picksOk(groups: ChoiceGroup[], picks: Record<string, string[]>): boolean {
  return groups.every((g) => {
    const n = picks[g.id]?.length ?? 0;
    return n >= g.min && n <= g.max;
  });
}

/** The tip choices: DoorDash's suggestions, the default first picked, and no tip. */
export function tipChoices(p: Pick<Preview, "tips" | "tipDefault" | "pickup" | "pretippable">): { label: string; cents: number }[] {
  if (p.pickup || !p.pretippable) return [];
  const seen = new Set<number>();
  const out = p.tips.filter((t) => (seen.has(t.cents) ? false : (seen.add(t.cents), true)));
  if (!out.length) out.push(...[300, 500, 800].map((c) => ({ label: money(c), cents: c })));
  if (!seen.has(0)) out.push({ label: "No tip", cents: 0 });
  return out;
}

/* ── Groceries: the Shop step's DoorDash tab (phase 3) ── */

export interface Found {
  id: string;
  name: string;
  priceCents: number | null;
  image: string | null;
}

/** One row of the review: what DoorDash matched (or Nikita found), kept or dropped. */
export interface GroceryRow {
  key: string;
  id: string;
  name: string;
  /** The Kitchen list's words it stands for. */
  forName: string | null;
  qty: number;
  unit: string | null;
  priceCents: number | null;
  out: boolean;
  subs: Found[];
  drop: boolean;
}

export interface GroceryBuild {
  store: { id: string; name: string };
  asked: string[];
  rows: GroceryRow[];
  /** The list's words DoorDash couldn't find: find each by hand or skip it. */
  missing: string[];
  message: string | null;
}

export const readFound = (v: unknown): Found | null => {
  const f = obj(v);
  const fid = id(f.id);
  const name = text(f.name, 90);
  return fid && name ? { id: fid, name, priceCents: cents(f.priceCents), image: ddLink(f.image) } : null;
};

const names = (v: unknown, max = 60): string[] => list(v, max).map((x) => text(x, 60)).filter((x): x is string => x !== null);

export function readGroceryBuild(d: Record<string, unknown>): GroceryBuild | null {
  const st = obj(d.store);
  const sid = id(st.id);
  const sname = text(st.name, 80);
  if (!sid || !sname) return null;
  const rows: GroceryRow[] = [];
  list(d.lines, 120).forEach((raw, i) => {
    const l = obj(raw);
    const lid = id(l.id);
    const name = text(l.name, 90);
    if (!lid || !name) return;
    const out = l.out === true;
    rows.push({
      key: `b${i}`,
      id: lid,
      name,
      forName: text(l.forName, 60),
      qty: num(l.qty, 99) || 1,
      unit: text(l.unit, 8),
      priceCents: cents(l.priceCents),
      out,
      subs: list(l.subs, 5)
        .map(readFound)
        .filter((x): x is Found => x !== null),
      drop: out,
    });
  });
  return { store: { id: sid, name: sname }, asked: names(d.asked), rows, missing: names(d.missing), message: text(d.message, 400) };
}

/** What goes to the cart: the kept, in-stock rows, one line per item (quantities added, at most 99). */
export function addLinesOf(rows: GroceryRow[]): { id: string; name: string; qty: number }[] {
  const by = new Map<string, { id: string; name: string; qty: number }>();
  for (const r of rows) {
    if (r.drop || r.out || !(r.qty > 0)) continue;
    const had = by.get(r.id);
    if (had) had.qty = Math.min(99, Math.round((had.qty + r.qty) * 100) / 100);
    else by.set(r.id, { id: r.id, name: r.name, qty: Math.min(99, Math.round(r.qty * 100) / 100) });
  }
  return [...by.values()].slice(0, 60);
}

/** About what the kept rows cost before fees (null when a price is missing). */
export function rowsCents(rows: GroceryRow[]): number | null {
  let sum = 0;
  for (const r of rows) {
    if (r.drop || r.out) continue;
    if (r.priceCents === null) return null;
    sum += Math.round(r.priceCents * r.qty);
  }
  return sum;
}

/** The week a store is remembered for: the planner's week start when it's shown, else this week's Monday (local). */
export function weekKey(start: string | null, now = new Date()): string {
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
