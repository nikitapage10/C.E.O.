/**
 * DoorDash, phase 1: Order (#1195, docs/HOME-DEVICES.md, "DoorDash"). The Kitchen's Order tab finds a dinner, builds a
 * cart, prices it and places it through DoorDash's own CLI (./cli.ts), on Nikita's passkey session only. Azure only.
 *
 *   POST /api/haven/doordash/order   passkey session only (a phone key or bearer is refused); { action, … }:
 *     home                      the Usuals (from `order history`), the open cart and the address's label
 *     search   { query }        `search` from the default address → stores
 *     menu     { storeId }      `menu` → sections and items
 *     item     { storeId, menuId, itemId }   `restaurant-item-details` → choices
 *     add      { storeId, menuId, storeName, item:{id,name,qty,options[]}, open? }   `cart add-items`
 *     cart / remove { lineId } / clear / promo { code }   `cart show` / `cart remove-item` / `cart delete` / `promo apply`
 *     preview  { fulfillment?, at?, priority? }   `order preview` → the breakdown, the card's name, the ETA
 *     place    { previewId, key, tipCents, totalCents }   `order submit` (the rules below)
 *     orders / status { orderId } / receipt { orderId } / reorder { orderId, open? }
 *
 * Money rules. Placing takes a preview the server made in the last 5 minutes for the cart as it is now (any change to
 * the cart drops its previews), and the total Nikita saw (the preview's total before tip, plus his tip). The server
 * prices the cart again and refuses if the total or the card changed, refuses any total over $1,000, and takes a lease
 * so two taps can't run at once. Each placement has a one-time key from the browser: a second request with it gets the
 * first one's outcome, never a second order. The preview and the key are marked spent in the private store before
 * `order submit` runs, and submit gets the previewed card (`--card-id`, ASAP only), the same time, mode and Priority,
 * the tip in cents and `--yes`. When submit may or may not have gone through (exit 5, a timeout, a service error) it is
 * never retried: the server reads `order history` once, says what it found, and holds that cart until Start over.
 *
 * Privacy. The token, a card's id, the full address and the CLI's raw output never reach the browser (./parse.ts reads
 * every answer as untrusted data). The cart, previews, placements and a short cache of the history live sealed in the
 * private store (`haven/devices/doordash-order.json`); the public status says nothing about orders. Logs carry the
 * command's name and exit code only (./cli.ts).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import { requireSession, withCookie } from "../../_desk/session.js";
import { PHONE_KEY_HEADER } from "../links.js";
import type { DdResult } from "./cli.js";
import {
  cartOf,
  cartsOf,
  defaultAddressOf,
  defaultCardOf,
  failureOf,
  FINAL_STATUSES,
  historyOf,
  idOf,
  itemDetailsOf,
  itemErrorsOf,
  itemIdOf,
  menuOf,
  ORDER_CAP_CENTS,
  previewOf,
  promoOf,
  receiptOf,
  statusOf,
  storeIdOf,
  storesOf,
  str,
  submitOf,
  textOf,
  usualsOf,
  uuidOf,
  type DdCart,
  type DdPastOrder,
  type DdPreviewView,
  type Fulfillment,
} from "./parse.js";
import { doordashToken, stateOf, type DoorDashDeps, type StoredDoorDash } from "./route.js";

/** A preview counts for placing this long. */
export const PREVIEW_MS = 5 * 60_000;
/** How long one placement holds the lease (the re-preview and submit together stay well inside it). */
export const PLACE_LEASE_MS = 2 * 60_000;
/** The default address's id is read again after this. */
const ADDRESS_MS = 12 * 60 * 60_000;
/** The history cache (for Reorder's store and its dropped-item check). */
const HISTORY_MS = 60 * 60_000;
const BODY_MAX = 8 * 1024;
const TIP_MAX = 50_000;

/** Short, honest goals for DoorDash (`--intent`). */
export const INTENT = {
  browse: 'Summary: Nikita choosing a meal to order for himself from his home dashboard. user prompt/purpose: "Order dinner from the Kitchen"',
  cart: 'Summary: Nikita building his own DoorDash order on his home dashboard. user prompt/purpose: "Order dinner from the Kitchen"',
  checkout: 'Summary: Nikita checking out a DoorDash order he chose on his home dashboard, after seeing the price and card. user prompt/purpose: "Place my order"',
  orders: 'Summary: Nikita reviewing or repeating his own past DoorDash orders on his home dashboard. user prompt/purpose: "My DoorDash orders"',
  account: 'Summary: Nikita ordering delivery to his own default address from his home dashboard. user prompt/purpose: "Order dinner from the Kitchen"',
} as const;

/* ── What the private store keeps ── */

export interface StoredPreview {
  id: string;
  at: number;
  cartUuid: string;
  /** The flags it was priced with, passed again to the re-preview and to submit. */
  opts: { fulfillment: Fulfillment | null; at: string | null; priority: boolean };
  netCents: number;
  cardId: string | null;
  pickup: boolean;
  spent?: boolean;
}

export type PlacementStatus = "submitting" | "placed" | "failed" | "maybe";

export interface Placement {
  at: number;
  previewId: string;
  status: PlacementStatus;
  orderUuid?: string | null;
  /** A short reason for a failure, our own words or DoorDash's closed set. */
  error?: string;
  totalCents: number;
}

export interface StoredCart {
  uuid: string;
  storeId: string | null;
  storeName: string | null;
  menuId: string | null;
  /** From a reorder: the old order's item names, to spot what fell off. */
  expected?: string[];
  /** Submit may have gone through on this cart: no more placing from it until Start over. */
  maybeSpentAt?: number;
}

export interface OrderState {
  address?: { id: string; label: string | null; at: number } | null;
  cart?: StoredCart | null;
  previews?: StoredPreview[];
  placements?: Record<string, Placement>;
  history?: { at: number; orders: DdPastOrder[] };
  /** Orders placed from the Desk, newest first, so Orders can follow them. */
  placed?: { id: string; at: number }[];
}

/* ── Plumbing ── */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return null;
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return null;
  try {
    const got: unknown = JSON.parse(raw);
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** What a failed CLI call means to the Order tab, by the CLI's own exit codes. */
export function errorOf(r: DdResult): { error: string; status: number } {
  switch (r.kind) {
    case "auth":
      return { error: "expired", status: 401 };
    case "gated":
      return { error: "gated", status: 403 };
    case "temporary":
    case "timeout":
      return { error: "busy", status: 503 };
    case "rejected":
      return { error: "rejected", status: 422 };
    default:
      return { error: "vendor", status: 502 };
  }
}

const newId = () => randomBytes(8).toString("hex");

/** The idempotency key the browser makes for one placement. */
const KEY_SHAPE = /^[A-Za-z0-9-]{16,64}$/;

const isoAhead = (v: unknown, now: number): string | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  // A delivery window: from now to a week out, sent to the CLI in UTC with its Z.
  return Number.isFinite(t) && t > now - 60_000 && t < now + 8 * 86_400_000 ? new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
};

/** Keeps the store small: the last few previews, a day of placements, ten placed orders. */
export function pruned(s: OrderState, now: number): OrderState {
  const placements = Object.fromEntries(
    Object.entries(s.placements ?? {})
      .filter(([, p]) => now - p.at < 86_400_000)
      .slice(-30),
  );
  return { ...s, previews: (s.previews ?? []).filter((p) => now - p.at < 30 * 60_000).slice(-5), placements, placed: (s.placed ?? []).slice(0, 10) };
}

/* ── The route ── */

export interface OrderDeps extends DoorDashDeps {
  /** Waits between status reads after a maybe-placed submit (tests pass 0). */
  pauseMs?: number;
}

/** POST /api/haven/doordash/order: passkey session only. */
export async function doordashOrderPost(request: Request, deps: OrderDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ") || request.headers.has(PHONE_KEY_HEADER)) return json({ error: "unauthorized" }, 401);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const body = await bodyOf(request);
  if (!body || typeof body.action !== "string") return reply({ error: "bad-request" }, 400);
  if (!deps.blob || !deps.vault || !deps.cli.ready) return reply({ error: "not-set-up", state: "not-set-up" }, 503);
  const token = await doordashToken(deps);
  if (!token) {
    const got = await deps.vault.read<StoredDoorDash>("doordash").catch(() => null);
    return reply({ error: "signed-out", state: stateOf(true, got && typeof got.token === "string" ? got : null, deps.now) }, 401);
  }
  const o = new Orders(deps, token);
  try {
    return reply(...(await o.handle(body)));
  } catch {
    deps.log("doordash: order action failed");
    return reply({ error: "failed" }, 500);
  }
}

type Out = [unknown, number?];

class Orders {
  private state: OrderState | null = null;
  private readonly vault;
  private readonly now: number;

  constructor(
    private readonly deps: OrderDeps,
    private readonly token: string,
  ) {
    this.vault = deps.vault!;
    this.now = deps.now;
  }

  private run(cmd: string[], intent: string, timeoutMs?: number) {
    return this.deps.cli.run(cmd, { token: this.token, intent, ...(timeoutMs ? { timeoutMs } : {}) });
  }

  private async load(): Promise<OrderState> {
    this.state ??= (await this.vault.read<OrderState>("doordash-order").catch(() => null)) ?? {};
    return this.state;
  }

  private async save(next: OrderState): Promise<void> {
    this.state = pruned(next, this.now);
    await this.vault.write("doordash-order", this.state);
  }

  /** A failed call's answer; exit 3 also marks the sign-in expired, so the Kitchen shows Sign in. */
  private async fail(r: DdResult, extra: Record<string, unknown> = {}): Promise<Out> {
    const e = errorOf(r);
    if (e.error === "expired") {
      const got = await this.vault.read<StoredDoorDash>("doordash").catch(() => null);
      if (got) await this.vault.write("doordash", { ...got, expiresAt: new Date(this.now).toISOString() } satisfies StoredDoorDash);
      return [{ error: "expired", state: "expired" }, 401];
    }
    const message = failureOf(r.json) ?? textOf(r.json, 300);
    return [{ error: e.error, ...(message ? { message } : {}), ...extra }, e.status];
  }

  async handle(b: Record<string, unknown>): Promise<Out> {
    switch (b.action) {
      case "home":
        return this.home();
      case "search":
        return this.search(b.query);
      case "menu":
        return this.menu(b.storeId);
      case "item":
        return this.item(b.storeId, b.menuId, b.itemId);
      case "add":
        return this.add(b);
      case "cart":
        return this.cart();
      case "remove":
        return this.remove(b.lineId);
      case "clear":
        return this.clear();
      case "promo":
        return this.promo(b.code);
      case "preview":
        return this.preview(b);
      case "place":
        return this.place(b);
      case "orders":
        return this.orders();
      case "status":
        return this.status(b.orderId);
      case "receipt":
        return this.receipt(b.orderId);
      case "reorder":
        return this.reorder(b.orderId, b.open);
      default:
        return [{ error: "bad-request" }, 400];
    }
  }

  /* ── Reads ── */

  /** The default address: its id for `search` (server only), its label for the screen. */
  private async address(): Promise<{ id: string; label: string | null } | null> {
    const s = await this.load();
    if (s.address && this.now - s.address.at < ADDRESS_MS) return s.address;
    const r = await this.run(["address", "list"], INTENT.account);
    const got = r.code === 0 ? defaultAddressOf(r.json) : null;
    if (got) await this.save({ ...s, address: { ...got, at: this.now } });
    return got;
  }

  private async history(fresh = false): Promise<{ orders: DdPastOrder[] } | DdResult> {
    const s = await this.load();
    if (!fresh && s.history && this.now - s.history.at < HISTORY_MS) return s.history;
    const r = await this.run(["order", "history", "--max", "40", "--days", "180"], INTENT.orders);
    if (r.code !== 0) return r;
    const orders = historyOf(r.json, 40);
    await this.save({ ...(await this.load()), history: { at: this.now, orders } });
    return { orders };
  }

  private cartView(c: StoredCart | null | undefined, live?: DdCart | null) {
    if (!c) return null;
    return { storeId: c.storeId, storeName: live?.storeName ?? c.storeName, lines: (live?.lines ?? []).map((l) => ({ ...l })), maybeSpent: Boolean(c.maybeSpentAt) };
  }

  private async home(): Promise<Out> {
    const [addr, h] = [await this.address(), await this.history()];
    const s = await this.load();
    const orders = "orders" in h ? h.orders : [];
    return [{ ok: true, address: addr ? { label: addr.label } : null, usuals: usualsOf(orders), recent: orders.slice(0, 5), cart: this.cartView(s.cart), ...("orders" in h ? {} : { historyError: errorOf(h).error }) }];
  }

  private async search(q: unknown): Promise<Out> {
    const query = str(q, 60);
    if (!query) return [{ error: "bad-request" }, 400];
    const addr = await this.address();
    // Without an address the CLI falls back to a default location far away: refuse instead.
    if (!addr) return [{ error: "no-address" }, 409];
    const r = await this.run(["search", "-q", query, "--limit", "12", "--address-id", addr.id], INTENT.browse);
    if (r.code !== 0) return this.fail(r);
    const stores = storesOf(r.json, 12);
    return [{ ok: true, stores, ...(stores.length ? {} : { text: textOf(r.json) }) }];
  }

  private async menu(raw: unknown): Promise<Out> {
    const storeId = storeIdOf(raw);
    if (!storeId) return [{ error: "bad-request" }, 400];
    const r = await this.run(["menu", "--store-id", storeId], INTENT.browse);
    if (r.code !== 0) return this.fail(r);
    const menu = menuOf(r.json, storeId);
    return menu ? [{ ok: true, menu }] : [{ ok: true, menu: null, text: textOf(r.json) ?? "DoorDash sent a menu this page can't read." }];
  }

  private async item(rawStore: unknown, rawMenu: unknown, rawItem: unknown): Promise<Out> {
    const storeId = storeIdOf(rawStore);
    const menuId = idOf(rawMenu);
    const itemId = itemIdOf(rawItem);
    if (!storeId || !menuId || !itemId) return [{ error: "bad-request" }, 400];
    const r = await this.run(["restaurant-item-details", "--store-id", storeId, "--menu-id", menuId, "--item-id", itemId], INTENT.browse);
    if (r.code !== 0) return this.fail(r);
    const item = itemDetailsOf(r.json);
    return item ? [{ ok: true, item }] : [{ ok: true, item: null, text: textOf(r.json) ?? "DoorDash sent details this page can't read." }];
  }

  /* ── The cart ── */

  /** Items to add: one item, its quantity and its chosen options (ids from the item's details). */
  private itemsJson(raw: unknown): string | null {
    const i = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const id = itemIdOf(i.id);
    const name = str(i.name, 90);
    const qty = typeof i.qty === "number" && Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 20 ? i.qty : null;
    if (!id || !name || !qty) return null;
    const opts = Array.isArray(i.options) ? i.options.slice(0, 30) : [];
    const nested: { id: string; name: string; quantity: number }[] = [];
    for (const raw of opts) {
      const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const oid = idOf(o.id);
      const oname = str(o.name, 80);
      if (!oid || !oname) return null;
      nested.push({ id: oid, name: oname, quantity: 1 });
    }
    return JSON.stringify([{ item_id: id, item_name: name, quantity: qty, ...(nested.length ? { nested_options: nested } : {}) }]);
  }

  /**
   * One open cart per store at DoorDash: before the first add at a store, `cart list` checks for one Nikita may have
   * forgotten. `open: "use"` adds to it, `open: "fresh"` deletes it first; without either the answer asks.
   */
  private async openCartAt(storeId: string, open: unknown): Promise<{ uuid: string | null } | Out> {
    const r = await this.run(["cart", "list", "--store-id", storeId], INTENT.cart);
    if (r.code !== 0) return this.fail(r);
    const found = cartsOf(r.json).find((c) => !c.storeId || c.storeId === storeId);
    if (!found) return { uuid: null };
    if (open === "use") return { uuid: found.uuid };
    if (open === "fresh") {
      const d = await this.run(["cart", "delete", "--cart-uuid", found.uuid], INTENT.cart);
      if (d.code !== 0) return this.fail(d);
      return { uuid: null };
    }
    return [{ error: "open-cart", count: found.count }, 409];
  }

  private async add(b: Record<string, unknown>): Promise<Out> {
    const storeId = storeIdOf(b.storeId);
    const menuId = idOf(b.menuId);
    const items = this.itemsJson(b.item);
    if (!storeId || !menuId || !items) return [{ error: "bad-request" }, 400];
    const s = await this.load();
    let uuid = s.cart && s.cart.storeId === storeId && !s.cart.maybeSpentAt ? s.cart.uuid : null;
    if (!uuid) {
      const got = await this.openCartAt(storeId, b.open);
      if (Array.isArray(got)) return got;
      uuid = got.uuid;
    }
    const cmd = ["cart", "add-items", "--store-id", storeId, "--menu-id", menuId, "--items-json", items, ...(uuid ? ["--cart-uuid", uuid] : [])];
    const r = await this.run(cmd, INTENT.cart);
    const errors = r.json ? itemErrorsOf(r.json) : [];
    if (r.code !== 0) return this.fail(r, errors.length ? { errors } : {});
    const cart = cartOf(r.json);
    const nextUuid = cart?.uuid ?? uuid;
    if (!nextUuid) return [{ error: errors.length ? "rejected" : "vendor", errors, message: failureOf(r.json) ?? textOf(r.json, 300) }, errors.length ? 422 : 502];
    const stored: StoredCart = { uuid: nextUuid, storeId, storeName: cart?.storeName ?? str(b.storeName, 80) ?? s.cart?.storeName ?? null, menuId };
    await this.save({ ...s, cart: stored, previews: [] });
    return [{ ok: !errors.length, errors, cart: this.cartView(stored, cart) }];
  }

  private async cart(): Promise<Out> {
    const s = await this.load();
    if (!s.cart) return [{ ok: true, cart: null }];
    const r = await this.run(["cart", "show", "--cart-uuid", s.cart.uuid], INTENT.cart);
    if (r.code !== 0) {
      // A cart DoorDash no longer has (submitted elsewhere, or abandoned) is let go.
      if (r.kind === "rejected") {
        await this.save({ ...s, cart: null, previews: [] });
        return [{ ok: true, cart: null, note: "gone" }];
      }
      return this.fail(r);
    }
    return [{ ok: true, cart: this.cartView(s.cart, cartOf(r.json)) }];
  }

  private async remove(raw: unknown): Promise<Out> {
    const lineId = idOf(raw);
    const s = await this.load();
    if (!lineId || !s.cart) return [{ error: "bad-request" }, 400];
    const r = await this.run(["cart", "remove-item", "--cart-uuid", s.cart.uuid, "--cart-item-id", lineId], INTENT.cart);
    if (r.code !== 0) return this.fail(r);
    await this.save({ ...s, previews: [] });
    return [{ ok: true, cart: this.cartView(s.cart, cartOf(r.json)) }];
  }

  /** Start over: the cart is deleted at DoorDash (unless it may already be an order) and forgotten here. */
  private async clear(): Promise<Out> {
    const s = await this.load();
    if (s.cart && !s.cart.maybeSpentAt) {
      const r = await this.run(["cart", "delete", "--cart-uuid", s.cart.uuid], INTENT.cart);
      if (r.code !== 0 && r.kind !== "rejected") return this.fail(r);
    }
    await this.save({ ...s, cart: null, previews: [] });
    return [{ ok: true, cart: null }];
  }

  private async promo(raw: unknown): Promise<Out> {
    const code = typeof raw === "string" && /^[A-Za-z0-9_-]{2,30}$/.test(raw.trim()) ? raw.trim() : null;
    const s = await this.load();
    if (!code || !s.cart) return [{ error: "bad-request" }, 400];
    const r = await this.run(["promo", "apply", "--cart-uuid", s.cart.uuid, "--promo-code", code], INTENT.cart);
    if (r.code !== 0 && !r.json) return this.fail(r);
    const p = promoOf(r.json);
    await this.save({ ...s, previews: [] });
    return [{ ok: p.ok, discountCents: p.discountCents, message: p.message ?? (p.ok ? null : "DoorDash didn't take that code.") }];
  }

  /* ── Preview and place ── */

  private previewArgs(uuid: string, opts: StoredPreview["opts"], cardId?: string | null): string[] {
    return ["order", "preview", "--cart-uuid", uuid, ...(opts.fulfillment ? ["--fulfillment", opts.fulfillment] : []), ...(opts.at ? ["--scheduled-time", opts.at] : []), ...(opts.priority ? ["--priority"] : []), ...(cardId && !opts.at ? ["--card-id", cardId] : [])];
  }

  /** The card a preview will charge, by name only: the previewed card (ASAP), else the default card. */
  private async cardName(view: DdPreviewView, opts: StoredPreview["opts"]): Promise<string | null> {
    if (view.card && !opts.at) return view.card;
    const r = await this.run(["payment-method", "list"], INTENT.checkout);
    return r.code === 0 ? defaultCardOf(r.json) : null;
  }

  private async preview(b: Record<string, unknown>): Promise<Out> {
    const s = await this.load();
    if (!s.cart) return [{ error: "no-cart" }, 409];
    if (s.cart.maybeSpentAt) return [{ error: "maybe-placed" }, 409];
    const fulfillment: Fulfillment | null = b.fulfillment === "delivery" || b.fulfillment === "pickup" ? b.fulfillment : null;
    const at = b.at === undefined || b.at === null || b.at === "asap" ? null : isoAhead(b.at, this.now);
    if (b.at && b.at !== "asap" && !at) return [{ error: "bad-time" }, 400];
    // Priority is ASAP delivery only.
    const priority = b.priority === true && !at && fulfillment !== "pickup";
    const opts = { fulfillment, at, priority };
    const r = await this.run(this.previewArgs(s.cart.uuid, opts), INTENT.checkout);
    if (r.code !== 0) return this.fail(r);
    const parsed = previewOf(r.json);
    if (!parsed) return [{ ok: false, error: "unreadable", text: failureOf(r.json) ?? textOf(r.json) ?? "DoorDash didn't price this cart." }];
    const card = await this.cardName(parsed.view, opts);
    // The address's label for the screen (its id stays here); read once, then kept half a day.
    await this.address();
    const pickup = (parsed.view.fulfillment ?? fulfillment) === "pickup";
    const stored: StoredPreview = { id: newId(), at: this.now, cartUuid: s.cart.uuid, opts, netCents: parsed.view.netCents, cardId: at ? null : parsed.cardId, pickup };
    const fresh = await this.load();
    await this.save({ ...fresh, previews: [...(fresh.previews ?? []), stored] });
    return [{ ok: true, preview: this.previewOut(stored, parsed.view, card, await this.load()) }];
  }

  private previewOut(p: StoredPreview, view: DdPreviewView, card: string | null, s: OrderState) {
    const have = new Set(view.lines.map((l) => l.name.toLowerCase()));
    const dropped = (s.cart?.expected ?? []).filter((n) => !have.has(n.replace(/^\d+(\.\d+)?× /, "").toLowerCase())).slice(0, 20);
    return {
      id: p.id,
      until: new Date(p.at + PREVIEW_MS).toISOString(),
      ...view,
      card,
      cardNote: card ? null : "DoorDash will charge your default payment method on file.",
      address: s.address ? (s.address.label ?? "your default address") : "your default address",
      storeName: s.cart?.storeName ?? null,
      scheduled: p.opts.at,
      priority: p.opts.priority,
      pickup: p.pickup,
      dropped,
      capCents: ORDER_CAP_CENTS,
    };
  }

  private async place(b: Record<string, unknown>): Promise<Out> {
    const key = typeof b.key === "string" && KEY_SHAPE.test(b.key) ? b.key : null;
    const previewId = typeof b.previewId === "string" && /^[0-9a-f]{16}$/.test(b.previewId) ? b.previewId : null;
    const tip = typeof b.tipCents === "number" && Number.isInteger(b.tipCents) && b.tipCents >= 0 && b.tipCents <= TIP_MAX ? b.tipCents : null;
    const total = typeof b.totalCents === "number" && Number.isInteger(b.totalCents) && b.totalCents > 0 ? b.totalCents : null;
    if (!key || !previewId || tip === null || total === null) return [{ error: "bad-request" }, 400];

    // The same key again: the first outcome, never a second order.
    const before = await this.load();
    const had = before.placements?.[key];
    if (had) return [this.placementOut(had), had.status === "placed" ? 200 : 409];

    if (!(await this.vault.lease("doordash-place", PLACE_LEASE_MS, this.now))) return [{ error: "placing" }, 409];
    try {
      const s = await this.load();
      if (s.placements?.[key]) return [this.placementOut(s.placements[key]!), 409];
      if (s.cart?.maybeSpentAt) return [{ error: "maybe-placed" }, 409];
      const p = (s.previews ?? []).find((x) => x.id === previewId);
      if (!s.cart || !p || p.cartUuid !== s.cart.uuid) return [{ error: "stale" }, 409];
      if (p.spent) return [{ error: "spent" }, 409];
      if (this.now - p.at > PREVIEW_MS || p.at > this.now + 60_000) return [{ error: "stale" }, 409];
      if (p.pickup && tip !== 0) return [{ error: "bad-request" }, 400];
      if (p.netCents + tip !== total) return [{ error: "total-mismatch" }, 409];
      if (total > ORDER_CAP_CENTS) return [{ error: "over-cap", capCents: ORDER_CAP_CENTS }, 422];

      // Priced again, now: the same flags and card, or nothing is placed.
      const again = await this.run(this.previewArgs(s.cart.uuid, p.opts, p.cardId), INTENT.checkout);
      if (again.code !== 0) return this.fail(again);
      const parsed = previewOf(again.json);
      if (!parsed) return [{ error: "unreadable", text: failureOf(again.json) ?? textOf(again.json) ?? "DoorDash didn't price this cart." }, 502];
      const cardNow = p.opts.at ? null : parsed.cardId;
      if (parsed.view.netCents !== p.netCents || (p.cardId && cardNow !== p.cardId)) {
        const fresh: StoredPreview = { id: newId(), at: this.now, cartUuid: s.cart.uuid, opts: p.opts, netCents: parsed.view.netCents, cardId: cardNow, pickup: p.pickup };
        await this.save({ ...s, previews: [...(s.previews ?? []).map((x) => (x.id === p.id ? { ...x, spent: true } : x)), fresh] });
        const card = await this.cardName(parsed.view, p.opts);
        return [{ error: "changed", preview: this.previewOut(fresh, parsed.view, card, s) }, 409];
      }
      if (parsed.view.netCents + tip > ORDER_CAP_CENTS) return [{ error: "over-cap", capCents: ORDER_CAP_CENTS }, 422];

      // Spent before submit runs: a retry of any kind finds this, not a fresh chance to order.
      const placing: Placement = { at: this.now, previewId: p.id, status: "submitting", totalCents: total };
      await this.save({ ...s, previews: (s.previews ?? []).map((x) => (x.id === p.id ? { ...x, spent: true } : x)), placements: { ...s.placements, [key]: placing } });

      const cmd = [
        "order",
        "submit",
        "--cart-uuid",
        s.cart.uuid,
        "--tip-cents",
        String(tip),
        ...(p.opts.fulfillment ? ["--fulfillment", p.opts.fulfillment] : []),
        ...(p.opts.at ? ["--scheduled-time", p.opts.at] : []),
        ...(p.opts.priority ? ["--priority"] : []),
        ...(p.cardId && !p.opts.at ? ["--card-id", p.cardId] : []),
        "--yes",
      ];
      const r = await this.run(cmd, INTENT.checkout, 45_000);
      return this.settle(key, placing, r);
    } finally {
      await this.vault.release("doordash-place");
    }
  }

  /** What submit's exit means: placed, refused (nothing ordered), or maybe placed (never retried). */
  private async settle(key: string, placing: Placement, r: DdResult): Promise<Out> {
    const s = await this.load();
    const sub = r.json ? submitOf(r.json) : { orderUuid: null, restricted: false, failure: null };
    const definite = r.kind === "spawn" || r.kind === "usage" || r.kind === "auth" || r.kind === "gated" || r.kind === "rejected";
    let done: Placement;
    let next: OrderState = s;
    if (r.code === 0 && sub.orderUuid && !sub.failure) {
      done = { ...placing, status: "placed", orderUuid: sub.orderUuid };
      next = { ...s, cart: null, previews: [], placed: [{ id: sub.orderUuid, at: this.now }, ...(s.placed ?? [])] };
    } else if ((r.code === 0 && sub.failure) || definite) {
      done = { ...placing, status: "failed", error: sub.restricted ? "restricted" : r.kind === "auth" ? "expired" : r.kind === "gated" ? "gated" : "refused" };
    } else {
      // Exit 5, a timeout, a service error, or a success with no order id: it may have gone through. Look once.
      const found = await this.recentOrderAt(s.cart?.storeId ?? null, placing.at);
      done = { ...placing, status: found ? "placed" : "maybe", orderUuid: found };
      next = found ? { ...s, cart: null, previews: [], placed: [{ id: found, at: this.now }, ...(s.placed ?? [])] } : { ...s, cart: s.cart ? { ...s.cart, maybeSpentAt: this.now } : null, previews: [] };
    }
    await this.save({ ...next, placements: { ...next.placements, [key]: done } });
    this.deps.log(`doordash: placement ${done.status}`);
    const message = done.status === "failed" ? (sub.failure ?? null) : null;
    return [{ ...this.placementOut(done), ...(message ? { message } : {}) }, done.status === "placed" ? 200 : done.status === "maybe" ? 202 : 422];
  }

  /** After an unclear submit: an order at the same store in `order history`, started no earlier than the tap. */
  private async recentOrderAt(storeId: string | null, since: number): Promise<string | null> {
    const r = await this.run(["order", "history", "--max", "5", "--days", "1"], INTENT.orders);
    if (r.code !== 0) return null;
    const hit = historyOf(r.json, 5).find((o) => (!storeId || o.storeId === storeId) && o.when && Date.parse(o.when) >= since - 2 * 60_000);
    return hit?.id ?? null;
  }

  private placementOut(p: Placement) {
    return { ok: p.status === "placed", placement: { status: p.status, orderId: p.orderUuid ?? null, error: p.error ?? null, totalCents: p.totalCents } };
  }

  /* ── Orders ── */

  private async orders(): Promise<Out> {
    const h = await this.history(true);
    if (!("orders" in h)) return this.fail(h);
    const s = await this.load();
    return [{ ok: true, orders: h.orders.slice(0, 25), placed: (s.placed ?? []).map((p) => p.id) }];
  }

  private async status(raw: unknown): Promise<Out> {
    const id = uuidOf(raw);
    if (!id) return [{ error: "bad-request" }, 400];
    const r = await this.run(["order", "status", "--order-uuid", id], INTENT.orders);
    if (r.code !== 0) return this.fail(r);
    const st = statusOf(r.json);
    return [{ ok: true, status: { ...st, final: FINAL_STATUSES.includes(st.status) } }];
  }

  private async receipt(raw: unknown): Promise<Out> {
    const id = uuidOf(raw);
    if (!id) return [{ error: "bad-request" }, 400];
    const r = await this.run(["order", "receipt", "--order-uuid", id], INTENT.orders);
    if (r.code !== 0) return this.fail(r);
    const receipt = receiptOf(r.json);
    return [{ ok: true, receipt, ...(receipt ? {} : { text: textOf(r.json) ?? "DoorDash sent a receipt this page can't read." }) }];
  }

  /** One tap: the old order's cart again (asking first about an open cart at that store), then its preview. */
  private async reorder(raw: unknown, open: unknown): Promise<Out> {
    const id = uuidOf(raw);
    if (!id) return [{ error: "bad-request" }, 400];
    const h = await this.history();
    const past = "orders" in h ? h.orders.find((o) => o.id === id) : undefined;
    if (past?.storeId) {
      const got = await this.openCartAt(past.storeId, open === "fresh" ? "fresh" : open === "use" ? "use" : undefined);
      if (Array.isArray(got)) return got;
      if (got.uuid) {
        // Keep the open cart instead of reordering.
        const s = await this.load();
        const kept: StoredCart = { uuid: got.uuid, storeId: past.storeId, storeName: past.store, menuId: null };
        await this.save({ ...s, cart: kept, previews: [] });
        return this.preview({});
      }
    }
    const r = await this.run(["order", "reorder", "--order-uuid", id], INTENT.orders);
    if (r.code !== 0) return this.fail(r);
    const failure = failureOf(r.json);
    const cart = cartOf(r.json);
    if (failure || !cart?.uuid) return [{ error: "rejected", message: failure ?? textOf(r.json, 300) ?? "That order can't be repeated." }, 422];
    const s = await this.load();
    const stored: StoredCart = { uuid: cart.uuid, storeId: cart.storeId ?? past?.storeId ?? null, storeName: cart.storeName ?? past?.store ?? null, menuId: null, expected: past?.items.slice(0, 30) };
    await this.save({ ...s, cart: stored, previews: [] });
    return this.preview({});
  }
}
