/**
 * DoorDash, phase 4: Skippy orders by voice or chat (#1195, docs/HOME-DEVICES.md, "DoorDash"). Nikita, 2026-11-17:
 * "hey Skippy, order my usual from whatever… Please respond to confirm… I'll confirm." Skippy's tools
 * (rooms/haven/tools.ts, api/_skippy/agent/tools.ts) reach this file; the cart, the preview and the placement are the
 * Order tab's own (./order.ts), so a spoken order passes every rule a tapped one does.
 *
 *   Reads      doordash_search, doordash_usuals, doordash_status, doordash_recent: words for Skippy, never an id,
 *              a card's id or the address.
 *   Prepare    doordash_prepare_order builds the cart (his usual from a store: the newest order there, repeated; named
 *              items at a store; or the DoorDash tab's open cart), prices it fresh (ASAP), and keeps ONE pending
 *              confirmation sealed in the private store (`haven/devices/doordash-voice.json`). The read-back (store,
 *              items, the total with fees and tip, the card's last 4 or "your default card", the ETA) is what Skippy
 *              says, word for word: the chat's turn puts it in as the reply itself (api/skippy.ts).
 *   Confirm    doordash_confirm_order places it through `Orders.placeCore`, the Order tab's one placement path.
 *
 * The confirm rules, in code here, never in the prompt:
 *   - the pending confirmation is bound to its preview id and total, and to the principal (the passkey, or the phone)
 *     and channel (the Desk's chat, a room's mic, the phone) that prepared it;
 *   - it counts only once its read-back went out (`heard`, from the end of that turn), and for CONFIRM_MS after;
 *   - only the very next turn on that principal and channel may confirm, and only when Nikita's words are an explicit
 *     confirm (`confirmWords`: "confirm", "yes, place it"…); any other words drop it (`turnStarted`);
 *   - prepare and confirm never run in one turn (the turn's id is kept with the pending confirmation);
 *   - it is taken before the placement runs, with its own one-time key: single use, and a repeat gets the first outcome;
 *   - placing prices the cart again and refuses if the total or the card changed: Skippy then reads the new total back
 *     and asks again (a new pending confirmation, heard at the end of that turn); the $1,000 cap and the lease apply,
 *     and an unclear submit is never retried.
 * Anything else, or anything unclear, places nothing. A Talk call isn't a channel for ordering yet: its quick answer has
 * a few seconds, which a fresh price and a submit don't fit in, so it says to use the phone or the Desk.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import { ordersFor, type OrderDeps, type Orders, type Out, type PreviewOut } from "./order.js";
import { ORDER_CAP_CENTS, usualsOf, type DdItemDetails, type DdMenu, type DdOrderStatus, type DdPastOrder, type DdStore } from "./parse.js";

/** How long a read-back can be confirmed after it went out. */
export const CONFIRM_MS = 2 * 60_000;
/** The longest read-back: the phone and a room's voice say two sentences of at most 240 characters. */
export const READBACK_MAX = 240;
/** The most items one spoken order names. */
export const ITEMS_MAX = 8;

/** Who is talking, where, and which turn this is: set by the chat's turn (api/skippy.ts), never by the model. */
export interface TurnWho {
  /** The passkey's id, or "phone:<id>" for the phone's key. */
  principal: string;
  channel: "desk" | "room" | "phone" | "call";
  /** This turn's random id: a new one for every message Nikita sends. */
  turn: string;
  /** Nikita's own words this turn (already through the privacy check). */
  said: string;
  /** Set by prepare (or a confirm that found a new price): the read-back the turn must say, and its pending id. */
  prepared?: { id: string; readback: string };
  /** Set by confirm: what happened, said as the turn's reply so nothing claims more than the tool did. */
  outcome?: string;
}

export const newTurn = (): string => randomBytes(8).toString("hex");

/** The one order waiting on a spoken confirm. */
export interface VoicePending {
  id: string;
  /** The placement's one-time key (the Order tab's key shape). */
  key: string;
  previewId: string;
  totalCents: number;
  tipCents: number;
  principal: string;
  channel: string;
  /** The turn that prepared it. */
  turn: string;
  at: number;
  /** When its read-back went out; nothing confirms before. */
  heardAt?: number;
  /** The next turn, claimed when Nikita's words there were an explicit confirm. */
  confirmTurn?: string;
  store: string;
  eta: string | null;
  pickup: boolean;
}

interface VoiceState {
  pending?: VoicePending | null;
}

export interface PrepareInput {
  store?: string;
  items?: string[];
  cart?: boolean;
  open_cart?: "use" | "fresh";
  tip_dollars?: number;
}

export interface VoiceOut {
  ok: boolean;
  text: string;
  did?: string;
}

/** What Skippy's tools reach (api/_skippy/agent/host.ts builds the live one). */
export interface DoorDashTools {
  search(query: string): Promise<string>;
  usuals(): Promise<string>;
  status(): Promise<string>;
  recent(): Promise<string>;
  prepare(input: PrepareInput, who: TurnWho | undefined): Promise<VoiceOut>;
  confirm(who: TurnWho | undefined): Promise<VoiceOut>;
  /** At the start of every turn: drops a pending confirmation unless these words are the explicit confirm right after. */
  turnStarted(who: TurnWho): Promise<void>;
  /** At the end of the turn that said a read-back: it went out, so the next turn may confirm it. */
  heard(who: TurnWho, id: string): Promise<void>;
}

/* ── Words ── */

const CONFIRM = /^(?:(?:hey |ok |okay )?skippy,? )?(?:(?:yes|yeah|yep),? )?(?:confirm(?:ed)?(?: it| the order| my order| order)?|(?:go ahead and )?place (?:it|the order|my order))(?:,? please)?$/;

/**
 * Whether Nikita's words are an explicit confirm and nothing else: "confirm", "confirm it", "yes, confirm", "yes,
 * place it", "place the order", with "Skippy" before or "please" after. A bare "yes", a question ("confirm?"), a
 * "but…", a "don't" or anything longer is not.
 */
export function confirmWords(said: string): boolean {
  const t = said.normalize("NFKC").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
  return t.length <= 60 && CONFIRM.test(t);
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A name as it is said: one line, no sentence breaks (the phone says the first two sentences only). */
const said = (v: string, max = 60) =>
  v
    .replace(/[.!?…]+(?=\s|$)/g, "")
    .replace(/[<>{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const norm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const nameMatch = (have: string, want: string) => {
  const a = norm(have);
  const b = norm(want);
  return Boolean(b) && (a === b || (b.length >= 3 && a.includes(b)) || (a.length >= 3 && b.includes(a)));
};

/** "25-35 min" as said: "25 to 35 minutes". */
function etaWords(eta: string | null): string | null {
  if (!eta) return null;
  const t = said(eta, 30).replace(/(\d)\s*-\s*(\d)/, "$1 to $2").replace(/\bmins?\b/i, "minutes");
  return t || null;
}

/** The card as said: its last 4 when its display name ends in them, else the default card. */
export function cardWords(card: string | null): string {
  const last4 = card ? /(?<!\d)(\d{4})\s*$/.exec(card)?.[1] : null;
  return last4 ? `the card ending ${last4}` : "your default card";
}

/**
 * The read-back: one sentence with the store, the items, the total with fees and tip, the card and the ETA, then "Say
 * confirm to place it." The items shorten ("and 3 more") until it fits the spoken limit.
 */
export function readbackOf(r: { store: string; lines: { name: string; qty: number }[]; dropped?: string[]; totalCents: number; tipCents: number; card: string | null; eta: string | null; pickup: boolean; changed?: boolean }): string {
  const tip = r.pickup ? "with fees, for pickup" : r.tipCents > 0 ? `with fees and a ${usd(r.tipCents)} tip` : "with fees and no tip";
  const eta = etaWords(r.eta);
  const when = eta ? (r.pickup ? `, ready in about ${eta}` : `, here in about ${eta}`) : "";
  const missing = r.dropped?.length ? ` (not available now: ${r.dropped.slice(0, 2).map((d) => said(d, 30)).join(", ")})` : "";
  const lines = r.lines.map((l) => `${l.qty > 1 ? `${Math.round(l.qty * 100) / 100} ` : ""}${said(l.name, 40)}`).filter(Boolean);
  const tail = " Say confirm to place it.";
  const build = (n: number) => {
    const shown = lines.slice(0, n);
    const more = lines.length - shown.length;
    const items = shown.length ? `${shown.join(", ")}${more ? ` and ${more} more` : ""}` : `${lines.length} items`;
    return `${r.changed ? "The total changed: " : ""}${said(r.store, 40)}, ${items}${missing}: ${usd(r.totalCents)} ${tip}, on ${cardWords(r.card)}${when}.${tail}`;
  };
  for (let n = Math.min(lines.length, 6); n >= 0; n--) {
    const t = build(n);
    if (t.length <= READBACK_MAX) return t;
  }
  return build(0).slice(0, READBACK_MAX);
}

const STATUS_WORDS: Record<string, string> = {
  pending: "is waiting on the store",
  action_required: "needs something from him in the DoorDash app",
  order_declined: "was declined",
  placed: "is placed",
  scheduled: "is scheduled",
  store_confirmed: "is confirmed by the store",
  ready_for_pickup: "is ready for pickup",
  dasher_assigned: "has a Dasher assigned",
  dasher_at_store: "has its Dasher at the store",
  picked_up: "is picked up and on its way",
  dasher_nearby: "is nearly there",
  completed: "was delivered",
  cancelled: "was cancelled",
  not_found: "isn't found at DoorDash",
  unknown: "is in a state DoorDash didn't name",
};

/** What a refused Order action means, said for Skippy. */
function whyOf(body: Record<string, unknown>): string {
  const msg = typeof body.message === "string" ? ` DoorDash said: ${said(body.message, 160)}.` : "";
  switch (body.error) {
    case "expired":
    case "signed-out":
      return "DoorDash's sign-in has run out: he signs in again from the DoorDash tab. Nothing was ordered.";
    case "open-cart":
      return `There's already an open DoorDash cart at that store${typeof body.count === "number" ? ` with ${body.count} item${body.count === 1 ? "" : "s"}` : ""}. Ask whether to add to it or start fresh, then call again with open_cart "use" or "fresh".`;
    case "no-address":
      return "DoorDash has no default address set, so nothing can be priced. He sets one in the DoorDash app.";
    case "maybe-placed":
      return "An earlier order from this cart may have gone through. He checks the DoorDash tab (and Start over there) before ordering again; nothing new was placed.";
    case "rejected":
      return `DoorDash wouldn't take that.${msg}`;
    case "busy":
      return "DoorDash is busy right now; nothing was placed. Try again in a minute.";
    case "gated":
      return "DoorDash refused this account for ordering this way; nothing was placed.";
    case "placing":
      return "Another placement is running right now; nothing new was placed. Check the DoorDash tab.";
    case "stale":
    case "spent":
      return "That price ran out, so nothing was placed. Ask for the order again for a fresh price.";
    case "over-cap":
      return `That's over the ${usd(ORDER_CAP_CENTS)} cap per order, so nothing was placed.`;
    case "no-cart":
      return "There's no open cart in the DoorDash tab.";
    default:
      return `That didn't go through, and nothing was placed.${msg || (typeof body.text === "string" ? ` ${said(body.text, 160)}.` : "")}`;
  }
}

/* ── The tools ── */

export class DoorDashVoice implements DoorDashTools {
  constructor(private readonly deps: OrderDeps) {}

  private async orders(): Promise<Orders | null> {
    return ordersFor(this.deps);
  }

  private async state(): Promise<VoiceState> {
    return (await this.deps.vault?.read<VoiceState>("doordash-voice").catch(() => null)) ?? {};
  }

  private async keep(pending: VoicePending | null): Promise<void> {
    if (!this.deps.vault) return;
    await this.deps.vault.write("doordash-voice", { pending } satisfies VoiceState);
  }

  private static readonly SIGN_IN = "DoorDash isn't signed in on the Desk: he signs in from the DoorDash tab first.";

  async search(query: string): Promise<string> {
    const o = await this.orders();
    if (!o) return DoorDashVoice.SIGN_IN;
    const [body, status] = (await o.handle({ action: "search", query })) as [Record<string, unknown>, number?];
    if ((status ?? 200) >= 400) return whyOf(body);
    const stores = (body.stores as DdStore[] | undefined) ?? [];
    if (!stores.length) return `No stores came back for ${said(query)}.`;
    return `Stores near home: ${stores
      .slice(0, 6)
      .map((s) => `${said(s.name, 50)}${s.eta ? ` (${said(s.eta, 20)}` : ""}${s.rating ? `${s.eta ? ", " : " ("}${s.rating} stars)` : s.eta ? ")" : ""}`)
      .join("; ")}. To order, call doordash_prepare_order with the store and the items.`;
  }

  async usuals(): Promise<string> {
    const o = await this.orders();
    if (!o) return DoorDashVoice.SIGN_IN;
    const [body, status] = (await o.handle({ action: "home" })) as [Record<string, unknown>, number?];
    if ((status ?? 200) >= 400) return whyOf(body);
    const usuals = (body.usuals as (DdPastOrder & { times: number })[] | undefined) ?? [];
    const recent = ((body.recent as DdPastOrder[] | undefined) ?? []).filter((r) => r.reorderable && !r.grocery);
    if (!usuals.length && !recent.length) return "No past DoorDash orders to repeat yet.";
    const one = (o: DdPastOrder) => `${said(o.store, 50)}${o.items.length ? ` (last time: ${o.items.slice(0, 3).map((i) => said(i, 40)).join(", ")}${o.items.length > 3 ? "…" : ""})` : ""}`;
    return [
      usuals.length ? `His usuals: ${usuals.map((u) => `${one(u)}, ordered ${u.times} time${u.times === 1 ? "" : "s"}`).join("; ")}.` : "",
      recent.length ? `Recent orders he can repeat: ${recent.slice(0, 4).map(one).join("; ")}.` : "",
      "\"My usual from <store>\" repeats the newest order there: doordash_prepare_order with that store.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  async status(): Promise<string> {
    const o = await this.orders();
    if (!o) return DoorDashVoice.SIGN_IN;
    const s = await o.snapshot();
    const last = (s.placed ?? []).find((p) => this.deps.now - p.at < 36 * 3_600_000);
    if (!last) return "No DoorDash order placed from the Desk in the last day and a half.";
    const [body, code] = (await o.handle({ action: "status", orderId: last.id })) as [Record<string, unknown>, number?];
    if ((code ?? 200) >= 400) return whyOf(body);
    const st = body.status as DdOrderStatus & { final: boolean };
    const mins = Math.max(1, Math.round((this.deps.now - last.at) / 60_000));
    return `The order placed ${mins < 90 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`} ago ${STATUS_WORDS[st.status] ?? STATUS_WORDS.unknown}${st.eta ? `; DoorDash says ${said(st.eta, 50)}` : ""}. The DoorDash tab tracks it.`;
  }

  async recent(): Promise<string> {
    const o = await this.orders();
    if (!o) return DoorDashVoice.SIGN_IN;
    const [body, code] = (await o.handle({ action: "orders" })) as [Record<string, unknown>, number?];
    if ((code ?? 200) >= 400) return whyOf(body);
    const orders = (body.orders as DdPastOrder[] | undefined) ?? [];
    if (!orders.length) return "No DoorDash orders in the last six months.";
    const day = (w: string | null) => (w ? new Date(w).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Denver" }) : "some time back");
    return `Recent DoorDash orders: ${orders
      .slice(0, 5)
      .map((r) => `${said(r.store, 50)} on ${day(r.when)}${r.items.length ? ` (${r.items.slice(0, 3).map((i) => said(i, 40)).join(", ")})` : ""}`)
      .join("; ")}.`;
  }

  /** Why a turn can't order at all, or null when it can. */
  private static refuseWho(who: TurnWho | undefined): string | null {
    if (!who) return "Ordering only runs from Nikita's own turn in the Desk's chat, a room's mic or Hey Skippy on the phone; nothing was set up.";
    if (who.channel === "call") return "Ordering isn't on Talk calls yet (a fresh price and the placement take longer than a call's quick answer): say it to Hey Skippy on the phone or type it in the Desk's chat. Nothing was set up.";
    return null;
  }

  async prepare(input: PrepareInput, who: TurnWho | undefined): Promise<VoiceOut> {
    const no = DoorDashVoice.refuseWho(who);
    if (no || !who) return { ok: false, text: no ?? "" };
    const o = await this.orders();
    if (!o) return { ok: false, text: DoorDashVoice.SIGN_IN };
    const s = await o.snapshot();
    if (s.cart?.maybeSpentAt) return { ok: false, text: whyOf({ error: "maybe-placed" }) };
    const open = input.open_cart === "use" || input.open_cart === "fresh" ? input.open_cart : undefined;
    let out: Out;
    if (input.cart === true) {
      if (!s.cart) return { ok: false, text: whyOf({ error: "no-cart" }) };
      out = await o.handle({ action: "preview" });
    } else if (input.store && input.items?.length) {
      const built = await this.itemsAt(o, input.store, input.items, open);
      if (typeof built === "string") return { ok: false, text: built };
      out = built;
    } else if (input.store) {
      const built = await this.usualAt(o, input.store, open);
      if (typeof built === "string") return { ok: false, text: built };
      out = built;
    } else {
      return { ok: false, text: "Say which store (his usual from where, or items at a store), or price the DoorDash tab's cart with cart true." };
    }
    const [body, code] = out as [Record<string, unknown>, number?];
    const pv = body.preview as PreviewOut | undefined;
    if ((code ?? 200) >= 400 || body.ok !== true || !pv) return { ok: false, text: whyOf(body) };
    return this.offer(pv, s.cart?.storeName ?? null, input.tip_dollars, who, false);
  }

  /** A fresh preview into the one pending confirmation and its read-back (or why not). */
  private async offer(pv: PreviewOut, storeName: string | null, tipDollars: number | undefined, who: TurnWho, changed: boolean, keepTip?: number): Promise<VoiceOut> {
    if (!pv.pickup && pv.asap === false) return { ok: false, text: "DoorDash can't deliver that as soon as possible right now (the store may be closed); schedule it from the DoorDash tab instead. Nothing was set up." };
    const tip = pv.pickup || !pv.pretippable ? 0 : keepTip !== undefined ? keepTip : typeof tipDollars === "number" && Number.isInteger(tipDollars) && tipDollars >= 0 && tipDollars <= 100 ? tipDollars * 100 : (pv.tipDefault ?? 0);
    const total = pv.netCents + tip;
    if (total > ORDER_CAP_CENTS) {
      await this.keep(null);
      return { ok: false, text: `That comes to ${usd(total)}, over the ${usd(ORDER_CAP_CENTS)} cap per order, so it isn't set up and can't be placed.` };
    }
    const store = pv.storeName ?? storeName ?? "DoorDash";
    const readback = readbackOf({ store, lines: pv.lines, dropped: pv.dropped, totalCents: total, tipCents: tip, card: pv.card, eta: pv.eta, pickup: pv.pickup, changed });
    const pending: VoicePending = {
      id: randomBytes(8).toString("hex"),
      key: `voice-${randomBytes(12).toString("hex")}`,
      previewId: pv.id,
      totalCents: total,
      tipCents: tip,
      principal: who.principal,
      channel: who.channel,
      turn: who.turn,
      at: this.deps.now,
      store: said(store, 60),
      eta: pv.eta,
      pickup: pv.pickup,
    };
    await this.keep(pending);
    who.prepared = { id: pending.id, readback };
    return { ok: true, text: `Not placed. Say exactly this to Nikita, then stop and wait for his answer (doordash_confirm_order only on his own "confirm" next turn): ${readback}` };
  }

  /** His usual from a store: the newest order there he can repeat, reordered (asking first about an open cart). */
  private async usualAt(o: Orders, store: string, open: "use" | "fresh" | undefined): Promise<Out | string> {
    const [body, code] = (await o.handle({ action: "orders" })) as [Record<string, unknown>, number?];
    if ((code ?? 200) >= 400) return whyOf(body);
    const orders = ((body.orders as DdPastOrder[] | undefined) ?? []).filter((r) => r.reorderable && !r.grocery);
    const hits = orders.filter((r) => nameMatch(r.store, store));
    if (!hits.length) {
      const usual = usualsOf(orders, 4).map((u) => said(u.store, 40));
      return `No past order from ${said(store, 40)} to repeat.${usual.length ? ` His usuals: ${usual.join(", ")}.` : ""} For something new, call with the store and the items.`;
    }
    const names = [...new Set(hits.map((h) => h.store))];
    const exact = names.find((n) => norm(n) === norm(store));
    if (names.length > 1 && !exact) return `More than one place matches ${said(store, 40)}: ${names.slice(0, 4).map((n) => said(n, 40)).join(", ")}. Ask which.`;
    const pick = hits.find((h) => !exact || h.store === exact)!;
    return o.handle({ action: "reorder", orderId: pick.id, ...(open && { open }) });
  }

  /** Named items at a store: each matched to one menu item with no required choices, added, then priced. */
  private async itemsAt(o: Orders, store: string, items: string[], open: "use" | "fresh" | undefined): Promise<Out | string> {
    if (items.length > ITEMS_MAX) return `At most ${ITEMS_MAX} items by voice; build bigger orders in the DoorDash tab.`;
    const [sb, sc] = (await o.handle({ action: "search", query: store.slice(0, 60) })) as [Record<string, unknown>, number?];
    if ((sc ?? 200) >= 400) return whyOf(sb);
    const stores = ((sb.stores as DdStore[] | undefined) ?? []).filter((s) => nameMatch(s.name, store));
    const at = stores.find((s) => norm(s.name) === norm(store)) ?? (stores.length === 1 ? stores[0] : undefined);
    if (!at) return stores.length ? `More than one store matches ${said(store, 40)}: ${stores.slice(0, 4).map((s) => said(s.name, 40)).join(", ")}. Ask which.` : `No store called ${said(store, 40)} came up near home.`;
    const [mb, mc] = (await o.handle({ action: "menu", storeId: at.id })) as [Record<string, unknown>, number?];
    if ((mc ?? 200) >= 400) return whyOf(mb);
    const menu = mb.menu as DdMenu | null;
    if (!menu) return `${said(at.name, 40)}'s menu didn't come through; try the DoorDash tab.`;
    const all = menu.sections.flatMap((x) => x.items);
    const picked: { id: string; name: string; qty: number }[] = [];
    for (const raw of items) {
      const m = /^(\d{1,2})\s*(?:x|×)?\s+(.+)$/i.exec(raw.trim());
      const qty = m ? Number(m[1]) : 1;
      const want = (m ? m[2]! : raw).trim();
      if (qty < 1 || qty > 20) return `${said(want, 40)}: at most 20 of one item.`;
      const exact = all.filter((i) => norm(i.name) === norm(want));
      const close = exact.length ? exact : all.filter((i) => nameMatch(i.name, want));
      const names = [...new Set(close.map((i) => i.name))];
      if (!close.length) return `${said(at.name, 40)} has nothing called ${said(want, 40)} on its menu.`;
      if (names.length > 1) return `${said(want, 40)} could be ${names.slice(0, 4).map((n) => said(n, 40)).join(", ")}. Ask which.`;
      const item = close[0]!;
      if (item.orderable !== "asap") return `${said(item.name, 40)} can't be ordered right now.`;
      const [db, dc] = (await o.handle({ action: "item", storeId: at.id, menuId: menu.menuId, itemId: item.id })) as [Record<string, unknown>, number?];
      if ((dc ?? 200) >= 400) return whyOf(db);
      const details = db.item as DdItemDetails | null;
      if (!details) return `${said(item.name, 40)}'s details didn't come through; pick it in the DoorDash tab.`;
      if (details.groups.some((g) => g.min > 0)) return `${said(item.name, 40)} needs choices picked (${details.groups.filter((g) => g.min > 0).map((g) => said(g.name, 30)).slice(0, 3).join(", ")}): pick it in the DoorDash tab, then ask me to price that cart.`;
      picked.push({ id: item.id, name: item.name, qty });
    }
    for (const [n, item] of picked.entries()) {
      const [ab, ac] = (await o.handle({ action: "add", storeId: at.id, menuId: menu.menuId, storeName: at.name, item: { ...item, options: [] }, ...(n === 0 && open && { open }) })) as [Record<string, unknown>, number?];
      if ((ac ?? 200) >= 400 || ab.ok === false) return whyOf(ab);
    }
    return o.handle({ action: "preview" });
  }

  async confirm(who: TurnWho | undefined): Promise<VoiceOut> {
    const no = DoorDashVoice.refuseWho(who);
    if (no || !who) return this.said(who, { ok: false, text: no ?? "" });
    const st = await this.state();
    const p = st.pending;
    const refuse = async (text: string, drop = true) => {
      if (drop && p) await this.keep(null);
      return this.said(who, { ok: false, text: `Not placed: ${text}` });
    };
    if (!p) return refuse("nothing is waiting on a confirm. Ask for the order first and I'll read it back.", false);
    if (p.principal !== who.principal || p.channel !== who.channel) return refuse("that order was read back somewhere else, so it was dropped. Ask for it again here.");
    // Never in the turn that prepared it: the read-back has to reach him first.
    if (p.turn === who.turn) return this.said(who, { ok: false, text: "Not placed: it can't be confirmed in the same turn it was set up. Read it back and wait for Nikita's own \"confirm\"." });
    if (!p.heardAt) return refuse("its read-back never went out, so it was dropped. Ask for the order again.");
    if (this.deps.now - p.heardAt > CONFIRM_MS || p.heardAt > this.deps.now + 60_000) return refuse("the read-back is more than two minutes old, so it ran out. Ask for the order again for a fresh price.");
    if (p.confirmTurn !== who.turn || !confirmWords(who.said)) return refuse("only Nikita's own \"confirm\" (or \"yes, place it\"), right after the read-back, places it. It was dropped; ask for the order again.");
    // Single use: taken before anything runs.
    await this.keep(null);
    const o = await this.orders();
    if (!o) return this.said(who, { ok: false, text: `Not placed: ${DoorDashVoice.SIGN_IN}` });
    const got = await o.placeCore({ key: p.key, previewId: p.previewId, tipCents: p.tipCents, totalCents: p.totalCents });
    if (got.kind === "changed") {
      const again = await this.offer(got.preview, p.store, undefined, who, true, p.pickup ? 0 : p.tipCents);
      return again.ok ? { ok: false, text: `Not placed: the price changed since the read-back. ${again.text}` } : this.said(who, { ok: false, text: `Not placed: the price changed since the read-back. ${again.text}` });
    }
    if (got.kind === "refused") return this.said(who, { ok: false, text: `Not placed: ${whyOf(got.out[0] as Record<string, unknown>)}` });
    const pl = got.placement;
    if (pl.status === "placed" && pl.orderUuid) {
      const eta = etaWords(p.eta);
      return this.said(who, { ok: true, text: `Placed: ${p.store}, ${usd(pl.totalCents)}.${eta ? ` ${p.pickup ? "Ready" : "Here"} in about ${eta};` : ""} it's tracking in the DoorDash tab.`, did: "Placed a DoorDash order" });
    }
    if (pl.status === "maybe" || pl.status === "submitting") return this.said(who, { ok: false, text: "I can't tell whether that went through, so I won't try again. Check the DoorDash tab before ordering anything else." });
    return this.said(who, { ok: false, text: `Not placed: DoorDash refused it${got.kind === "placement" && got.message ? ` (${said(got.message, 120)})` : pl.error === "restricted" ? " (an age-restricted item)" : ""}. Nothing was ordered.` });
  }

  /** A confirm's outcome is the turn's reply, word for word. */
  private said(who: TurnWho | undefined, out: VoiceOut): VoiceOut {
    if (who) who.outcome = out.text;
    return out;
  }

  async turnStarted(who: TurnWho): Promise<void> {
    const p = (await this.state()).pending;
    if (!p || p.principal !== who.principal || p.channel !== who.channel || p.turn === who.turn) return;
    const fresh = p.heardAt !== undefined && this.deps.now - p.heardAt <= CONFIRM_MS;
    if (fresh && !p.confirmTurn && confirmWords(who.said)) {
      await this.keep({ ...p, confirmTurn: who.turn });
      return;
    }
    // Anything but the explicit confirm right after the read-back: the order is dropped, never placed later.
    await this.keep(null);
  }

  async heard(who: TurnWho, id: string): Promise<void> {
    const p = (await this.state()).pending;
    if (!p || p.id !== id || p.principal !== who.principal || p.channel !== who.channel || p.turn !== who.turn || p.heardAt) return;
    await this.keep({ ...p, heardAt: this.deps.now });
  }
}
