import type { Cart, PastOrder, Store } from "./order.ts";

/**
 * The DoorDash tab's small rules (#1195; DoorDashTab.tsx): the cuisine chips, the picture stand-ins, a store's facts
 * line, the deep link's store, which order the Active strip follows, and how far along it is. Pure, so they're tested.
 */

/** The hero's cuisine chips: each runs a search for its word. */
export const CUISINES: { label: string; query: string; glyph: string }[] = [
  { label: "Pizza", query: "pizza", glyph: "🍕" },
  { label: "Sushi", query: "sushi", glyph: "🍣" },
  { label: "Thai", query: "thai", glyph: "🍜" },
  { label: "Burgers", query: "burgers", glyph: "🍔" },
  { label: "Mexican", query: "mexican", glyph: "🌮" },
  { label: "Chinese", query: "chinese", glyph: "🥡" },
  { label: "Indian", query: "indian", glyph: "🍛" },
  { label: "Ramen", query: "ramen", glyph: "🍥" },
  { label: "Wings", query: "wings", glyph: "🍗" },
  { label: "Breakfast", query: "breakfast", glyph: "🥞" },
  { label: "Healthy", query: "salad", glyph: "🥗" },
  { label: "Dessert", query: "dessert", glyph: "🍰" },
];

/** A stand-in's letter: the name's first letter or digit, upper case. */
export function initialOf(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toLocaleUpperCase("en-US") : "?";
}

/** One of five warm tints for a stand-in, the same for the same name. */
export function toneOf(name: string): number {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}

/** The cuisine glyph a stand-in shows when the name or cuisine says one ("Sakura Sushi" → 🍣), else null. */
export function glyphOf(...words: (string | null | undefined)[]): string | null {
  const said = words.filter(Boolean).join(" ").toLowerCase();
  if (!said) return null;
  const hit = CUISINES.find((c) => said.includes(c.query) || said.includes(c.label.toLowerCase()));
  if (hit) return hit.glyph;
  if (/taco|burrito|taqueria/.test(said)) return "🌮";
  if (/burger/.test(said)) return "🍔";
  if (/pho|noodle|udon/.test(said)) return "🍜";
  if (/curry|tandoor/.test(said)) return "🍛";
  if (/coffee|cafe|café/.test(said)) return "☕";
  return null;
}

/** A store's facts in one line: rating, ETA, fee, distance. */
export function storeFacts(s: Pick<Store, "rating" | "eta" | "fee" | "miles">): string[] {
  return [s.rating !== null ? `★ ${s.rating.toFixed(1)}` : null, s.eta, s.fee, s.miles !== null ? `${s.miles} mi` : null].filter((x): x is string => Boolean(x));
}

/** The store a deep link opens (`/haven/kitchen/doordash?store=<id>`): DoorDash's numeric store id, else null. */
export function storeParam(search: string): string | null {
  const v = new URLSearchParams(search).get("store");
  return v && /^\d{1,20}$/.test(v) ? v : null;
}

/** The address with `?store=` set to `id` (or taken off), other parameters kept. */
export function withStore(pathname: string, search: string, id: string | null): string {
  const q = new URLSearchParams(search);
  if (id) q.set("store", id);
  else q.delete("store");
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/** The meal plan's days and courses, as its order-in links name them (api/_haven/mealShape.ts DAYS and COURSES). */
const SLOT_DAYS: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const SLOT_COURSES = ["dinner", "lunch"];

export interface Slot {
  day: string;
  course: string;
  /** "Saturday dinner" */
  words: string;
}

/**
 * The meal an order is for, from the meal plan's order-in link (`?slot=sat-dinner&week=<Monday>`, #1195 phase 2): its
 * day and course, or null when there's none or it doesn't read as one.
 */
export function slotParam(search: string): Slot | null {
  const m = /^([a-z]{3})-([a-z]+)$/.exec(new URLSearchParams(search).get("slot") ?? "");
  if (!m || !SLOT_DAYS[m[1]!] || !SLOT_COURSES.includes(m[2]!)) return null;
  return { day: m[1]!, course: m[2]!, words: `${SLOT_DAYS[m[1]!]} ${m[2]}` };
}

/**
 * Remembers a store for that meal (or forgets it, `store` null) in the meal plan: the planner's `order-store` edit. A
 * refusal (the planner without that edit yet answers 400) is reported, never thrown.
 */
export async function rememberStore(slot: Pick<Slot, "day" | "course">, store: { id: string; name: string } | null, f: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await f("/api/haven-meals", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "edit", edit: { op: "order-store", day: slot.day, course: slot.course, store } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** An order counts as possibly on its way for this long after it was placed. */
export const RECENT_MS = 2 * 60 * 60_000;

/**
 * The order the Active strip follows: the newest placed from the Desk in the last 3 hours (the server's `active`),
 * else the newest in the history from the last 2 hours. Null when there's none.
 */
export function activeOrderOf(active: string[], recent: Pick<PastOrder, "id" | "when">[], now: number): string | null {
  if (active[0]) return active[0];
  const hit = recent.find((o) => o.when && now - Date.parse(o.when) >= 0 && now - Date.parse(o.when) < RECENT_MS);
  return hit?.id ?? null;
}

/** The Active strip's four steps, and which one a status has reached (-1 for one that isn't on the way). */
export const ACTIVE_STEPS = ["Placed", "Preparing", "On the way", "Delivered"] as const;
export function stepOf(status: string): number {
  switch (status) {
    case "pending":
    case "placed":
    case "scheduled":
      return 0;
    case "store_confirmed":
    case "dasher_assigned":
    case "dasher_at_store":
    case "ready_for_pickup":
      return 1;
    case "picked_up":
    case "dasher_nearby":
      return 2;
    case "completed":
      return 3;
    default:
      return -1;
  }
}

/** How many things are in the cart (a weighed line counts once). */
export const cartCount = (c: Cart | null): number => c?.lines.reduce((n, l) => n + (l.unit ? 1 : l.qty), 0) ?? 0;

/** About what the cart costs before fees, or null when a line has no price. */
export function cartCents(c: Cart | null): number | null {
  if (!c?.lines.length) return null;
  let sum = 0;
  for (const l of c.lines) {
    if (l.priceCents === null) return null;
    sum += Math.round(l.priceCents * (l.unit ? 1 : l.qty));
  }
  return sum;
}

/**
 * A Usual or a past order with what a store list knows of the same place (its picture, rating, ETA and fee), so the
 * Usuals show them when Nearby or a search has read that store.
 */
export function withStoreInfo(o: PastOrder, known: ReadonlyMap<string, Store>): { image: string | null; facts: string[]; cuisine: string | null } {
  const s = o.storeId ? known.get(o.storeId) : undefined;
  return { image: o.image ?? s?.image ?? s?.logo ?? null, facts: s ? storeFacts(s) : [], cuisine: s?.cuisine ?? null };
}
