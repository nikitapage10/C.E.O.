import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.ts";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { privateParts } from "../../_privacy.ts";
import { callTool, type ToolHost } from "../../_skippy/agent/tools.ts";
import { HomeVault, homeKey } from "../devices/vault.ts";
import { commandName, resultOf, type DdCall, type DdResult, type DdRunner, type Spawned } from "./cli.ts";
import { ordersFor, type OrderDeps } from "./order.ts";
import { CONFIRM_MS, DoorDashVoice, claimsDoorDash, usualStore, READBACK_MAX, cardWords, confirmWords, readbackOf, type TurnWho, type VoicePending } from "./voice.ts";

/**
 * DoorDash, phase 4 (#1195): Skippy orders by voice or chat. Every confirm rule is the server's, so each one is tested
 * here against the Order tab's own placement path with the CLI faked. Every id, card and store is made up.
 */

const NOW = Date.parse("2026-11-17T18:00:00Z");
const SEAL = homeKey("a-test-home-token-key-that-is-long-enough-0123", "seal")!;
const TOKEN = "test-dd-access-token-0000000000000000";
const CART = "0a1b2c3d-1111-2222-3333-444455556666";
const ORDER = "9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff";
const PAST = "aaaaaaaa-0000-1111-2222-333333333333";
const CARD_ID = "pmf_v1_test_card_secret";

const ok = (json: unknown, over: Partial<Spawned> = {}): DdResult => resultOf({ code: 0, stdout: JSON.stringify(json), stderr: "", killed: false, spawnError: false, ...over });
const exit = (code: number | null, over: Partial<Spawned> = {}): DdResult => resultOf({ code, stdout: "", stderr: "", killed: code === null, spawnError: false, ...over });

const preview = (net = 3820, card: string | null = CARD_ID) => ({
  ...(card ? { payment_method: { display_name: "Visa ending in 4242", card_id: card } } : {}),
  quote: {
    net_total_before_tip: { unit_amount: net },
    line_items: [{ label: "Subtotal", final_money: { unit_amount: 3100 } }],
    delivery_availability: { asap_available: true, asap_minutes_range_string: "25-35 min" },
    store_order_cart: { fulfillment_type: "DELIVERY", orders: [{ order_items: [{ item: { name: "Tonkotsu" }, quantity: 2 }, { item: { name: "Gyoza" }, quantity: 1 }] }] },
    tips_suggestion_details: [{ default_index: 1, percentage_values: [15, 20, 25], percentage_to_amount_monetary_values: [{ unit_amount: 465 }, { unit_amount: 620 }, { unit_amount: 775 }] }],
    is_pre_tippable: true,
  },
});
const HISTORY = {
  orders: [
    { order_uuid: PAST, store_id: 928163, store_name: "Ramen Bar", items: [{ name: "Tonkotsu", quantity: 2 }, { name: "Gyoza", quantity: 1 }], is_reorderable: true, created_at: "2026-11-10T02:00:00Z" },
    { order_uuid: "bbbbbbbb-0000-1111-2222-333333333333", store_id: 928163, store_name: "Ramen Bar", items: [], is_reorderable: true, created_at: "2026-11-03T02:00:00Z" },
  ],
};

type Answer = DdResult | ((cmd: readonly string[]) => DdResult);
const BASE: Record<string, Answer> = {
  "address list": ok({ addresses: [{ address_id: "addr-test-1", label: "Home", is_default: true }] }),
  "cart list": ok({ carts: [] }),
  "order preview": ok(preview()),
  "order submit": ok({ order_uuid: ORDER }),
  "order history": ok(HISTORY),
  "order reorder": ok({ success: true, cart_uuid: CART, cart: { store_name: "Ramen Bar", store_id: 928163, items: [{ id: "l1", name: "Tonkotsu", quantity: 2 }] } }),
  "order status": ok({ result: { status: "dasher_nearby" } }),
  "payment-method list": ok({ payment_methods: [{ card_id: CARD_ID, display_name: "Visa ending in 4242", is_default: true }] }),
};

function memoryBlob(): BlobBackend {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

async function setup(answers: Record<string, Answer> = {}) {
  const blob = memoryBlob();
  const vault = new HomeVault(blob, SEAL);
  await vault.write("doordash", { token: TOKEN, expiresAt: "2026-11-20T18:00:00Z", signedInAt: "2026-11-17T17:00:00Z" });
  const calls: { cmd: readonly string[]; call: DdCall }[] = [];
  const all = { ...BASE, ...answers };
  const cli: DdRunner = {
    ready: true,
    async run(cmd, call = {}) {
      calls.push({ cmd, call });
      const a = all[commandName(cmd)];
      if (!a) return exit(2);
      return typeof a === "function" ? a(cmd) : a;
    },
  };
  const deps = (now: number): OrderDeps => ({ desk: { deskKey: "k", store: new MemoryAuthStore(), now }, blob, vault, cli, now, log: () => undefined });
  /** The tools as they stand at a moment. */
  const at = (now = NOW) => new DoorDashVoice(deps(now));
  const pending = async () => ((await vault.read<{ pending?: VoicePending | null }>("doordash-voice")) ?? {}).pending ?? null;
  const submits = () => calls.filter((c) => commandName(c.cmd) === "order submit");
  return { at, vault, all, calls, pending, submits, deps };
}

const turn = (id: string, said: string, over: Partial<TurnWho> = {}): TurnWho => ({ principal: "passkey-1", channel: "phone", turn: id, said, ...over });

/** One turn as the chat runs it: turnStarted first, the tool, then heard when it said a read-back. */
async function say(t: Awaited<ReturnType<typeof setup>>, who: TurnWho, now: number, tool: (v: DoorDashVoice) => Promise<unknown>) {
  const v = t.at(now);
  await v.turnStarted(who);
  const out = (await tool(v)) as { ok: boolean; text: string };
  if (who.prepared) await t.at(now).heard(who, who.prepared.id);
  return out;
}

/** "Order my usual from Ramen Bar", read back and heard. */
async function readBack(answers: Record<string, Answer> = {}) {
  const t = await setup(answers);
  const a = turn("turn-a", "order my usual from ramen bar");
  const out = await say(t, a, NOW, (v) => v.prepare({ store: "ramen bar" }, a));
  return { ...t, a, out };
}

describe("Skippy's DoorDash words (#1195)", () => {
  it("takes only an explicit confirm", () => {
    for (const yes of ["confirm", "Confirm.", "confirm it", "Yes, place it", "yes place it", "yes, confirm", "Skippy, confirm the order please", "place the order", "Confirmed!"]) expect(confirmWords(yes), yes).toBe(true);
    for (const no of ["yes", "yeah", "ok", "sure", "confirm?", "don't confirm", "confirm, actually wait", "no", "place it later", "what did it cost", "confirm the order and add a soda"]) expect(confirmWords(no), no).toBe(false);
  });

  it("reads back the store, items, total with fees and tip, card and ETA in two short sentences, nothing private", () => {
    const r = readbackOf({ store: "Ramen Bar", lines: [{ name: "Tonkotsu", qty: 2 }, { name: "Gyoza", qty: 1 }], totalCents: 4440, tipCents: 620, card: "Visa ending in 4242", eta: "25-35 min", pickup: false });
    expect(r).toBe("Ramen Bar, 2 Tonkotsu, Gyoza: $44.40 with fees and a $6.20 tip, on the card ending 4242, here in about 25 to 35 minutes. Say confirm to place it.");
    expect(privateParts(r)).toEqual([]);
    expect(r.split(/(?<=[.!?…])\s+/)).toHaveLength(2);
    const long = readbackOf({ store: "St. Louis Bread Co.", lines: Array.from({ length: 12 }, (_, i) => ({ name: `A very long menu item number ${i}. Extra`, qty: 1 })), totalCents: 100_000, tipCents: 0, card: null, eta: null, pickup: false });
    expect(long.length).toBeLessThanOrEqual(READBACK_MAX);
    expect(long).toContain("your default card");
    expect(long.split(/(?<=[.!?…])\s+/)).toHaveLength(2);
    expect(cardWords("Visa ending in 4242")).toBe("the card ending 4242");
    expect(cardWords(null)).toBe("your default card");
  });
});

describe("Skippy's DoorDash confirm rules (#1195)", () => {
  it("prepare repeats the usual, prices it fresh and keeps one pending confirmation; nothing is placed", async () => {
    const t = await readBack();
    expect(t.out.ok).toBe(true);
    expect(t.a.prepared?.readback).toMatch(/^Ramen Bar, 2 Tonkotsu, Gyoza: \$44\.40 with fees and a \$6\.20 tip, on the card ending 4242, here in about 25 to 35 minutes\. Say confirm to place it\.$/);
    const p = (await t.pending())!;
    expect(p).toMatchObject({ totalCents: 4440, tipCents: 620, principal: "passkey-1", channel: "phone", turn: "turn-a", heardAt: NOW });
    expect(t.submits()).toHaveLength(0);
    expect(t.calls.find((c) => commandName(c.cmd) === "order reorder")!.cmd).toContain(PAST);
  });

  it("places on his own confirm in the very next turn, through the Order tab's path, once", async () => {
    const t = await readBack();
    const b = turn("turn-b", "Confirm.");
    const out = await say(t, b, NOW + 30_000, (v) => v.confirm(b));
    expect(out).toMatchObject({ ok: true, text: "Placed: Ramen Bar, $44.40. Here in about 25 to 35 minutes; it's tracking in the DoorDash tab." });
    expect(b.outcome).toBe(out.text);
    expect(t.submits()).toHaveLength(1);
    expect(t.submits()[0]!.cmd).toEqual(["order", "submit", "--cart-uuid", CART, "--tip-cents", "620", "--card-id", CARD_ID, "--yes"]);
    // Priced again just before the submit.
    expect(commandName(t.calls.at(-2)!.cmd)).toBe("order preview");
    // Reuse: single use, never a second order.
    const c = turn("turn-c", "confirm");
    expect((await say(t, c, NOW + 40_000, (v) => v.confirm(c))).text).toMatch(/^Not placed: nothing is waiting/);
    expect(t.submits()).toHaveLength(1);
  });

  it("refuses a confirm in the same turn as the prepare (one model turn), and keeps it for the read-back", async () => {
    const t = await setup();
    const a = turn("turn-a", "order my usual from ramen bar and confirm");
    const v = t.at(NOW);
    await v.prepare({ store: "Ramen Bar" }, a);
    const out = await v.confirm(a);
    expect(out.text).toMatch(/same turn/);
    expect(t.submits()).toHaveLength(0);
    expect(await t.pending()).not.toBeNull();
    // Through Skippy's tool path too: prepare and confirm in one model turn place nothing.
    const host = { doordash: v, who: turn("turn-x", "confirm") } as unknown as ToolHost;
    await callTool("doordash_prepare_order", { store: "Ramen Bar" }, host, { pending: null, surface: "spoken", said: "confirm" });
    expect(await callTool("doordash_confirm_order", {}, host, { pending: null, surface: "spoken", said: "confirm" })).toMatchObject({ ok: false });
    expect(t.submits()).toHaveLength(0);
  });

  it("refuses before the read-back went out", async () => {
    const t = await setup();
    const a = turn("turn-a", "order my usual from ramen bar");
    await t.at(NOW).prepare({ store: "Ramen Bar" }, a); // never heard
    const b = turn("turn-b", "confirm");
    expect((await say(t, b, NOW + 5_000, (v) => v.confirm(b))).ok).toBe(false);
    expect(t.submits()).toHaveLength(0);
  });

  it("expires two minutes after the read-back", async () => {
    const t = await readBack();
    const b = turn("turn-b", "confirm");
    const out = await say(t, b, NOW + CONFIRM_MS + 1, (v) => v.confirm(b));
    expect(out.ok).toBe(false);
    expect(t.submits()).toHaveLength(0);
    expect(await t.pending()).toBeNull();
  });

  it("refuses from another channel or principal, and drops it", async () => {
    const t = await readBack();
    const desk = turn("turn-b", "confirm", { channel: "desk" });
    expect((await say(t, desk, NOW + 5_000, (v) => v.confirm(desk))).text).toMatch(/read back somewhere else/);
    expect(t.submits()).toHaveLength(0);
    const u = await readBack();
    const other = turn("turn-b", "confirm", { principal: "phone:another" });
    expect((await say(u, other, NOW + 5_000, (v) => v.confirm(other))).ok).toBe(false);
    expect(u.submits()).toHaveLength(0);
    // And the right channel can't pick it up afterwards.
    const late = turn("turn-c", "confirm");
    expect((await say(u, late, NOW + 6_000, (v) => v.confirm(late))).ok).toBe(false);
    expect(u.submits()).toHaveLength(0);
  });

  it("only the turn right after, and only on confirm words: anything else drops it", async () => {
    const t = await readBack();
    const b = turn("turn-b", "what's the weather tomorrow");
    await say(t, b, NOW + 5_000, async () => null);
    expect(await t.pending()).toBeNull();
    const c = turn("turn-c", "confirm");
    expect((await say(t, c, NOW + 10_000, (v) => v.confirm(c))).ok).toBe(false);
    const u = await readBack();
    const vague = turn("turn-b", "yes");
    expect((await say(u, vague, NOW + 5_000, (v) => v.confirm(vague))).ok).toBe(false);
    expect(u.submits()).toHaveLength(0);
  });

  it("a changed total places nothing, reads the new total back, and asks again", async () => {
    const t = await readBack();
    t.all["order preview"] = ok(preview(4100));
    const b = turn("turn-b", "confirm");
    const out = await say(t, b, NOW + 5_000, (v) => v.confirm(b));
    expect(out.ok).toBe(false);
    expect(t.submits()).toHaveLength(0);
    expect(b.prepared?.readback).toMatch(/^The total changed: Ramen Bar, .*: \$47\.20 with fees and a \$6\.20 tip/);
    const p = (await t.pending())!;
    expect(p).toMatchObject({ totalCents: 4720, turn: "turn-b", heardAt: NOW + 5_000 });
    // It can't be confirmed in that same turn; the next turn's confirm places it at the new total.
    expect((await t.at(NOW + 6_000).confirm(b)).ok).toBe(false);
    const c = turn("turn-c", "yes, place it");
    expect(await say(t, c, NOW + 20_000, (v) => v.confirm(c))).toMatchObject({ ok: true });
    expect(t.submits()).toHaveLength(1);
  });

  it("a different card at the re-price is a change too", async () => {
    const t = await readBack();
    t.all["order preview"] = ok(preview(3820, "pmf_v1_other_card"));
    const b = turn("turn-b", "confirm");
    expect((await say(t, b, NOW + 5_000, (v) => v.confirm(b))).ok).toBe(false);
    expect(t.submits()).toHaveLength(0);
    expect(b.prepared?.readback).toMatch(/^The total changed/);
  });

  it("refuses over the $1,000 cap: no pending confirmation, nothing placed", async () => {
    const t = await setup({ "order preview": ok(preview(99_950)) });
    const a = turn("turn-a", "order my usual from ramen bar");
    const out = await say(t, a, NOW, (v) => v.prepare({ store: "Ramen Bar" }, a));
    expect(out).toMatchObject({ ok: false, text: expect.stringMatching(/over the \$1,000\.00 cap/) });
    expect(await t.pending()).toBeNull();
    expect(a.prepared).toBeUndefined();
    const b = turn("turn-b", "confirm");
    expect((await say(t, b, NOW + 5_000, (v) => v.confirm(b))).ok).toBe(false);
    expect(t.submits()).toHaveLength(0);
  });

  it("never retries a submit that may have gone through, and never says placed", async () => {
    const t = await readBack({ "order submit": exit(5, { stderr: '{"error":{"code":"timeout","message":"m"}}' }) });
    t.all["order history"] = ok({ orders: [] });
    const b = turn("turn-b", "confirm");
    const out = await say(t, b, NOW + 5_000, (v) => v.confirm(b));
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/can't tell whether that went through/);
    expect(out.text).not.toMatch(/^Placed/);
    expect(t.submits()).toHaveLength(1);
  });

  it("isn't on a Talk call, and never runs without Nikita's own turn or from a voice hook", async () => {
    const t = await setup();
    const call = turn("turn-a", "order my usual from ramen bar", { channel: "call" });
    expect((await t.at(NOW).prepare({ store: "Ramen Bar" }, call)).text).toMatch(/Talk calls/);
    expect((await t.at(NOW).prepare({ store: "Ramen Bar" }, undefined)).ok).toBe(false);
    const host = { doordash: t.at(NOW), who: turn("t", "confirm") } as unknown as ToolHost;
    expect(await callTool("doordash_confirm_order", {}, host, { pending: null, surface: "desk", direct: true })).toMatchObject({ ok: false });
    expect(await callTool("doordash_confirm_order", {}, host, { pending: null, surface: "desk", tainted: true })).toMatchObject({ ok: false });
    expect(await callTool("doordash_prepare_order", { store: "Ramen Bar" }, host, { pending: null, surface: "desk", tainted: true })).toMatchObject({ ok: false });
    expect(t.calls).toHaveLength(0);
  });

  it("reads: usuals, status of the Desk's last order, recent orders, in words with no ids", async () => {
    const t = await readBack();
    const usuals = await t.at(NOW).usuals();
    expect(usuals).toMatch(/Ramen Bar/);
    expect(usuals).not.toContain(PAST);
    const b = turn("turn-b", "confirm");
    await say(t, b, NOW + 5_000, (v) => v.confirm(b));
    expect(await t.at(NOW + 20 * 60_000).status()).toMatch(/is nearly there/);
    expect(await t.at(NOW).recent()).toMatch(/^Recent DoorDash orders: Ramen Bar/);
  });
});

/* ── Adding to the cart (#1207) ── */

const LA = 555001;
const ADD_HISTORY = {
  orders: [
    { order_uuid: "cccccccc-0000-1111-2222-333333333333", store_id: LA, store_name: "La Esquina", items: [{ name: "Beef Empanadas", quantity: 3 }], is_reorderable: true, created_at: "2026-11-15T02:00:00Z" },
    { order_uuid: PAST, store_id: 928163, store_name: "Ramen Bar", items: [{ name: "Tonkotsu", quantity: 2 }], is_reorderable: true, created_at: "2026-11-12T02:00:00Z" },
    { order_uuid: "dddddddd-0000-1111-2222-333333333333", store_id: LA, store_name: "La Esquina", items: [{ name: "Beef Empanadas", quantity: 2 }], is_reorderable: true, created_at: "2026-11-08T02:00:00Z" },
  ],
};
const LA_MENU = {
  menu_id: "7001",
  store_name: "La Esquina",
  items: [
    { item_id: "e_1", name: "Beef Empanada", price: 4.5, category: "Empanadas", orderability: ["asap"] },
    { item_id: "e_2", name: "Chicken Empanada", price: 4.5, category: "Empanadas", orderability: ["asap"] },
    { item_id: "e_3", name: "Combo Plate", price: 14, category: "Plates", orderability: ["asap"] },
  ],
};
const LA_CART = { success: true, cart_uuid: CART, cart: { store_name: "La Esquina", store_id: LA, items: [{ id: "line_1", item_id: "e_1", name: "Beef Empanada", quantity: 2, price: 4.5 }] } };
const ADDING: Record<string, Answer> = {
  "order history": ok(ADD_HISTORY),
  menu: ok(LA_MENU),
  "restaurant-item-details": (cmd) => ok({ item: { item_id: cmd[cmd.indexOf("--item-id") + 1], name: cmd.includes("e_3") ? "Combo Plate" : "Beef Empanada", price: 4.5, extras: cmd.includes("e_3") ? [{ extra_id: "x1", name: "Filling", min_num_options: 1, max_num_options: 1, options: [{ option_id: "o1", name: "Beef" }] }] : [] } }),
  "cart add-items": ok(LA_CART),
  "cart show": ok(LA_CART),
  "order reorder": ok({ success: true, cart_uuid: CART, cart: { store_name: "La Esquina", store_id: LA, items: [{ id: "line_1", name: "Beef Empanada", quantity: 3, price: 4.5 }] } }),
};
const names = (t: Awaited<ReturnType<typeof setup>>) => t.calls.map((c) => commandName(c.cmd));

describe("Skippy adds to the DoorDash cart (#1207)", () => {
  it("adds the empanadas from the usual spot to the DoorDash tab's own cart, says the total so far, prices and places nothing", async () => {
    const t = await setup(ADDING);
    const who = turn("turn-add", "add the empanadas from the usual spot", { channel: "desk" });
    const out = await t.at().addToCart({ store: "the usual spot", items: ["2 empanadas"] }, who);
    expect(out).toMatchObject({ ok: true, did: "Added to the DoorDash cart" });
    // The usual spot is the place he orders from most (La Esquina, twice), and "empanadas" is the one he had there.
    expect(out.text).toBe("Added 2 Beef Empanada from La Esquina to your DoorDash cart: $9.00 so far before fees (2 items). It's in your DoorDash cart in the Kitchen; nothing is ordered until you check out there or ask me to order it.");
    expect(who.outcome).toBe(out.text);
    const add = t.calls.find((c) => commandName(c.cmd) === "cart add-items")!;
    expect(add.cmd).toContain(String(LA));
    expect(names(t)).not.toContain("search");
    expect(names(t)).not.toContain("order preview");
    expect(t.submits()).toHaveLength(0);
    expect(await t.pending()).toBeNull();
    // The DoorDash tab reads the very same cart, lines and all, the moment it opens (`home`) and in its drawer (`cart`).
    const o = (await ordersFor(t.deps(NOW)))!;
    const [home] = (await o.handle({ action: "home" })) as [{ cart: { storeName: string; lines: { name: string; qty: number }[] } }];
    expect(home.cart).toMatchObject({ storeName: "La Esquina", lines: [{ name: "Beef Empanada", qty: 2 }] });
    expect(await t.at().cart()).toBe("His DoorDash cart in the Kitchen, at La Esquina: 2 Beef Empanada, $9.00 before fees. Nothing is ordered.");
    expect(privateParts(out.text)).toEqual([]);
  });

  it("says plainly when an item needs choices picked, and adds nothing", async () => {
    const t = await setup(ADDING);
    const who = turn("turn-add", "add a combo plate from la esquina", { channel: "desk" });
    const out = await t.at().addToCart({ items: ["combo plate"] }, who);
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/^Nothing was added\. Combo Plate needs choices picked \(Filling\), so it isn't in the cart/);
    expect(names(t)).not.toContain("cart add-items");
    expect(who.outcome).toBeUndefined();
    expect(claimsDoorDash(out.text)).toBe(false);
  });

  it("repeats his last order at the usual spot into the cart without pricing it, and asks about an open cart first", async () => {
    const t = await setup(ADDING);
    const out = await t.at().addToCart({}, turn("turn-add", "add my usual", { channel: "desk" }));
    expect(out.text).toMatch(/^Added your last order \(3× Beef Empanadas\) from La Esquina to your DoorDash cart: \$13\.50 so far before fees \(3 items\)\./);
    expect(t.calls.find((c) => commandName(c.cmd) === "order reorder")!.cmd).toContain("cccccccc-0000-1111-2222-333333333333");
    expect(names(t)).not.toContain("order preview");

    const open = await setup({ ...ADDING, "cart list": ok({ carts: [{ cart_uuid: CART, store_id: LA, items_count: 2 }] }) });
    const asked = await open.at().addToCart({ items: ["beef empanada"] }, turn("turn-add", "add a beef empanada", { channel: "desk" }));
    expect(asked).toMatchObject({ ok: false });
    expect(asked.text).toMatch(/already an open DoorDash cart at that store with 2 items/);
    expect(names(open)).not.toContain("cart add-items");
  });

  it("refuses on a Talk call, and knows the usual spot from a store's name", async () => {
    const t = await setup(ADDING);
    const out = await t.at().addToCart({ items: ["beef empanada"] }, turn("turn-add", "add a beef empanada", { channel: "call" }));
    expect(out).toMatchObject({ ok: false });
    expect(out.text).toMatch(/Nothing was added/);
    expect(t.calls).toHaveLength(0);
    for (const u of [undefined, "", "my usual spot", "the usual place", "usual", "my regular", "my go-to"]) expect(usualStore(u), String(u)).toBe(true);
    for (const n of ["La Esquina", "Usual Suspects Pizza"]) expect(usualStore(n), n).toBe(false);
  });
});
