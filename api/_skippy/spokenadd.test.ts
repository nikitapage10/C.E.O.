import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { classify } from "../_haven/classify.ts";
import { HomeVault, homeKey } from "../_haven/devices/vault.ts";
import { commandName, resultOf, type DdResult, type DdRunner, type Spawned } from "../_haven/doordash/cli.ts";
import { ordersFor, type OrderDeps } from "../_haven/doordash/order.ts";
import { DoorDashVoice, closestHad, pendsDoorDash, waitingLine } from "../_haven/doordash/voice.ts";
import { listOf } from "../_haven/list.ts";
import { PhoneKeys } from "../_haven/phones.ts";
import { capture, type HavenDeps } from "../_haven/route.ts";
import { PhoneTodos } from "../_haven/todos.ts";
import { MemoryStoryStore } from "../_world/story.ts";
import { chat, phoneAnswer, roomAnswer, type Ask, type ChatDeps } from "../skippy.ts";
import { FAST_MODEL, TALK_MODEL, runAgent, type CallModel } from "./agent/loop.ts";
import { MemoryPending } from "./agent/pending.ts";
import type { ToolHost } from "./agent/tools.ts";
import { doordashAddAsk, spokenAdd, undouble } from "./agent/words.ts";
import { MemoryChatLedger } from "./budget.ts";
import { BlobChatLog } from "./chatlog.ts";
import { deskContext } from "./context.ts";
import { MemoryRoomLog } from "./log.ts";
import { roomVoicePost, type RoomRouteDeps } from "./roomroute.ts";

/**
 * Spoken DoorDash adds (#1210). By the Haven's mic, after #1209, Nikita asked to re-order the empanadas they'd had
 * recently (the transcript came through twice over); Skippy answered with a waiting line ("let me see what your usual
 * spot has in the cart…") and nothing reached the cart. A misheard try ("bananas") went toward the Kitchen list. These
 * replay those turns, paraphrased, through the real routes and the real turn on every surface, with the model scripted
 * the way the logs read and DoorDash's CLI faked under the DoorDash tab's own cart. Every store, item and price is made up.
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-18T08:28:00Z");
const SEAL = homeKey("a-test-home-token-key-that-is-long-enough-0123", "seal")!;
const CART = "0a1b2c3d-1111-2222-3333-444455556666";
const LA = 555001;
const RAMEN = 928163;

/** Paraphrased in the logs' shape: the doubled re-order, the first ask, and the misheard one. */
const REORDER = "I kinda wanna re-order those empanadas we had recently I kinda wanna re-order those empanadas we had recently";
const USUAL = "hey can we order some of the usual empanadas we get from that one spot";
const MISHEARD = "what if we re-order some of those bananas we had recently";

const ok = (json: unknown, over: Partial<Spawned> = {}): DdResult => resultOf({ code: 0, stdout: JSON.stringify(json), stderr: "", killed: false, spawnError: false, ...over });
const exit = (code: number | null): DdResult => resultOf({ code, stdout: "", stderr: "", killed: code === null, spawnError: false });

/** His usual spot by count is the ramen place; the empanadas came from the other one, most recently. */
const HISTORY = {
  orders: [
    { order_uuid: "cccccccc-0000-1111-2222-333333333333", store_id: LA, store_name: "La Esquina", items: [{ name: "Beef Empanadas", quantity: 3 }], is_reorderable: true, created_at: "2026-11-16T02:00:00Z" },
    { order_uuid: "aaaaaaaa-0000-1111-2222-333333333333", store_id: RAMEN, store_name: "Ramen Bar", items: [{ name: "Tonkotsu", quantity: 2 }], is_reorderable: true, created_at: "2026-11-14T02:00:00Z" },
    { order_uuid: "aaaaaaaa-0000-1111-2222-444444444444", store_id: RAMEN, store_name: "Ramen Bar", items: [{ name: "Tonkotsu", quantity: 1 }], is_reorderable: true, created_at: "2026-11-10T02:00:00Z" },
    { order_uuid: "aaaaaaaa-0000-1111-2222-555555555555", store_id: RAMEN, store_name: "Ramen Bar", items: [{ name: "Gyoza", quantity: 1 }], is_reorderable: true, created_at: "2026-11-03T02:00:00Z" },
  ],
};
const MENUS: Record<string, unknown> = {
  [LA]: {
    menu_id: "7001",
    store_name: "La Esquina",
    items: [
      { item_id: "e_1", name: "Beef Empanada", price: 4.5, category: "Empanadas", orderability: ["asap"] },
      { item_id: "e_2", name: "Chicken Empanada", price: 4.5, category: "Empanadas", orderability: ["asap"] },
    ],
  },
  [RAMEN]: { menu_id: "8001", store_name: "Ramen Bar", items: [{ item_id: "r_1", name: "Tonkotsu", price: 15, category: "Ramen", orderability: ["asap"] }] },
};
const LA_CART = { success: true, cart_uuid: CART, cart: { store_name: "La Esquina", store_id: LA, items: [{ id: "line_1", item_id: "e_1", name: "Beef Empanada", quantity: 1, price: 4.5 }] } };
const ANSWERS: Record<string, DdResult | ((cmd: readonly string[]) => DdResult)> = {
  "address list": ok({ addresses: [{ address_id: "addr-test-1", label: "Home", is_default: true }] }),
  "cart list": ok({ carts: [] }),
  "order history": ok(HISTORY),
  menu: (cmd) => ok(MENUS[cmd[cmd.indexOf("--store-id") + 1]!] ?? null),
  "restaurant-item-details": (cmd) => ok({ item: { item_id: cmd[cmd.indexOf("--item-id") + 1], name: "Beef Empanada", price: 4.5, extras: [] } }),
  "cart add-items": ok(LA_CART),
  "cart show": ok(LA_CART),
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
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Step = (p: Params) => { content: unknown[]; stop: "end_turn" | "tool_use" };
/** The quick pass's answer: a reply and how deep to go. */
const fast = (reply: string, deeper: string): Step => () => ({ content: [{ type: "text", text: JSON.stringify({ reply, actions: [], room: "haven", needs: "none", deeper }) }], stop: "end_turn" });
/** The deeper tier's answer. */
const answer = (reply: string): Step => () => ({ content: [{ type: "text", text: JSON.stringify({ reply, actions: [], room: "haven", needs: "none" }) }], stop: "end_turn" });
const uses = (name: string, input: Record<string, unknown>): Step => () => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop: "tool_use" });

/** A whole C.E.O. for one test: the DoorDash tab's own cart under a faked CLI, a scripted model, and the routes. */
async function world(steps: Step[]) {
  const blob = memoryBlob();
  const vault = new HomeVault(blob, SEAL);
  await vault.write("doordash", { token: "test-dd-access-token-0000000000000000", expiresAt: "2026-11-20T18:00:00Z", signedInAt: "2026-11-17T17:00:00Z" });
  const ran: string[][] = [];
  const cli: DdRunner = {
    ready: true,
    async run(cmd) {
      ran.push([...cmd]);
      const a = ANSWERS[commandName(cmd)];
      if (!a) return exit(2);
      return typeof a === "function" ? a(cmd) : a;
    },
  };
  const store = new MemoryAuthStore();
  const orderDeps: OrderDeps = { desk: { deskKey: DESK, store, now: NOW }, blob, vault, cli, now: NOW, log: () => undefined };
  const calls: Params[] = [];
  const script = [...steps];
  const call: CallModel = async (p) => {
    calls.push(structuredClone(p));
    const step = script.shift();
    if (!step) throw new Error("no model call was scripted for this");
    const { content, stop } = step(p);
    return { id: "m", type: "message", role: "assistant", model: p.model, content, stop_reason: stop, usage: { input_tokens: 900, output_tokens: 60 } } as unknown as Anthropic.Beta.Messages.BetaMessage;
  };
  const ask: Ask = async (system, input, ctx) => {
    if (!ctx) throw new Error("every surface brings the tools");
    return runAgent(call, system, input, ctx);
  };
  const kitchen = listOf(blob, "kitchen");
  const host = (): ToolHost => ({
    read: async () => "",
    memory: null,
    kitchenAdd: (items) => kitchen.add(items, NOW),
    homeAct: null,
    fileIssue: null,
    skipTerms: [],
    now: NOW,
    doordash: new DoorDashVoice(orderDeps),
  });
  const log = new MemoryRoomLog();
  const chats = new BlobChatLog(blob);
  const chatDeps: ChatDeps = { deskKey: DESK, store, ledger: new MemoryChatLedger(), ask, host, pending: new MemoryPending(), log, chats, world: async () => null, desk: async () => deskContext([], [], null, null), now: NOW, env: {} };
  const room: RoomRouteDeps = {
    desk: { deskKey: DESK, store, now: NOW },
    blob,
    eleven: null,
    ledger: new MemoryStoryStore(),
    skippy: (text, history, passkey, turn) => roomAnswer(text, history, passkey, turn, chatDeps),
    todos: (b) => new PhoneTodos(b),
    fetcher: fetch,
    log: () => undefined,
  };
  const cookie = await signedInCookie(DESK, NOW, store);
  /** What the DoorDash tab shows the moment it opens (`home`): the cart's store and lines. */
  const tabCart = async () => {
    const o = (await ordersFor(orderDeps))!;
    const [home] = (await o.handle({ action: "home" })) as [{ cart: { storeName?: string; lines: { name: string; qty: number }[] } | null }];
    return home.cart;
  };
  const adds = () => ran.filter((c) => commandName(c) === "cart add-items");
  const spent = () => ran.filter((c) => /^order (?:preview|submit)$/.test(commandName(c)));
  return { blob, chatDeps, room, cookie, calls, ran, log, chats, kitchen, tabCart, adds, spent, models: () => calls.map((c) => c.model) };
}
type World = Awaited<ReturnType<typeof world>>;

/** The Haven's mic, or hold Space on its page: POST /api/skippy-room. */
async function roomMic(w: World, text: string) {
  const res = await roomVoicePost(new Request(`${ORIGIN}/api/skippy-room`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: w.cookie }, body: JSON.stringify({ room: "haven", text }) }), w.room);
  return (await res.json()) as { say?: string; kind?: string; wrote?: string[] };
}

/** The iPhone's "Skippy" shortcut: POST /api/capture with the phone's key. */
async function phone(w: World, text: string) {
  const pepper = Buffer.alloc(32, 7);
  const made = (await new PhoneKeys(w.blob, pepper).add("Sample phone", NOW))!.key;
  const deps: HavenDeps = { desk: { deskKey: DESK, store: w.chatDeps.store, now: NOW }, blob: w.blob, pepper: async () => pepper, todos: (b) => new PhoneTodos(b), skippy: (t, id, h) => phoneAnswer(t, id, h, w.chatDeps), voice: null, log: () => undefined, random: () => 0 };
  const res = await capture(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "Content-Type": "application/json", "x-ceo-phone-key": made }, body: JSON.stringify({ text }) }), deps);
  return (await res.json()) as { say?: string };
}

/** Skippy's chat on the Desk, typed. */
async function typed(w: World, message: string) {
  const res = await chat(new Request(`${ORIGIN}/api/skippy`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: w.cookie }, body: JSON.stringify({ message, history: [] }) }), w.chatDeps);
  return (await res.json()) as { reply?: string; wrote?: string[] };
}

/** The cart really has the empanadas from the place they came from, and nothing was priced or placed. */
async function landed(w: World) {
  expect(w.adds()).toHaveLength(1);
  expect(w.adds()[0]).toContain(String(LA));
  expect(await w.tabCart()).toMatchObject({ storeName: "La Esquina", lines: [{ name: "Beef Empanada", qty: 1 }] });
  expect(w.spent()).toEqual([]);
}

const ADDED = /^Added Beef Empanada from La Esquina to your DoorDash cart: \$4\.50 so far before fees \(1 item\)\./;
const WAITING = "Right, the empanadas. Let me see what your usual spot has in the cart, and I'll put them in if the order is clear.";

describe("Spoken DoorDash adds land in the cart (#1210)", () => {
  it("the doubled re-order by the Haven's mic: the quick pass answers with a waiting line, and the add still runs", async () => {
    // As the logs read: the quick pass gives a waiting line as its answer. It now hands up; the deeper self answers with
    // the same kind of line; the chat's own add puts the empanadas in.
    const w = await world([fast(WAITING, "no"), answer(WAITING)]);
    const out = await roomMic(w, REORDER);
    expect(out.kind).toBe("skippy");
    expect(out.say).toMatch(ADDED);
    expect(out.wrote).toContain("doordash_add_to_cart");
    expect(w.models()).toEqual([FAST_MODEL, TALK_MODEL]);
    await landed(w);
    // Kept like any turn, in words with no money or store.
    const kept = await w.log.list("haven", NOW);
    expect(kept.map((t) => t.answer)).toEqual(["Added Beef Empanada to your DoorDash cart; nothing is ordered."]);
    expect(kept[0]).toMatchObject({ via: "room" });
    const chats = await w.chats.read(0, NOW);
    expect(chats).toHaveLength(1);
    expect(chats[0]!.a).not.toMatch(/\$|La Esquina/);
  });

  it("a hand-up from the quick pass: the deeper run's add is applied, said and kept", async () => {
    const w = await world([fast(WAITING, "talk"), uses("doordash_add_to_cart", { items: ["empanadas"], store: "that one spot" }), answer("Done, monkey.")]);
    const out = await roomMic(w, USUAL);
    expect(out.say).toMatch(ADDED);
    expect(w.models()).toEqual([FAST_MODEL, TALK_MODEL, TALK_MODEL]);
    await landed(w);
    expect((await w.log.list("haven", NOW)).map((t) => t.answer)).toEqual(["Added Beef Empanada to your DoorDash cart; nothing is ordered."]);
  });

  it("the first ask, the usual empanadas from that one spot, on the phone's shortcut", async () => {
    const w = await world([uses("doordash_usuals", {}), fast("Your usual empanada spot is in the DoorDash usuals, so I'll price it fresh and read it back before anything is placed.", "no"), answer(WAITING)]);
    const out = await phone(w, USUAL);
    expect(out.say).toMatch(ADDED);
    await landed(w);
  });

  it("typed in the Desk's chat, the same re-order adds and says exactly what was added", async () => {
    const w = await world([fast(WAITING, "no"), answer(WAITING)]);
    const out = await typed(w, "re-order those empanadas we had recently");
    expect(out.reply).toMatch(ADDED);
    expect(out.wrote).toContain("doordash_add_to_cart");
    await landed(w);
  });

  it("a model that already added is never added again", async () => {
    const w = await world([uses("doordash_add_to_cart", { items: ["empanadas"] }), fast("Added.", "no")]);
    const out = await roomMic(w, REORDER);
    expect(out.say).toMatch(ADDED);
    expect(w.adds()).toHaveLength(1);
  });

  it("a misheard item: never the Kitchen list, and it asks about the close match from his recent orders", async () => {
    const w = await world([fast("Bananas going back on the Kitchen list, monkey. Let me check what's already there first.", "no")]);
    const out = await roomMic(w, MISHEARD);
    expect(out.say).toMatch(/^Nothing was added: Ramen Bar has nothing called bananas on its menu, and none of your recent DoorDash orders had it\. Did you mean the Beef Empanadas from La Esquina\?/);
    expect(w.adds()).toEqual([]);
    expect(w.spent()).toEqual([]);
    expect(await w.kitchen.items(NOW)).toEqual([]);
  });
});

describe("Reading a spoken add (#1210)", () => {
  it("reads one copy of a doubled transcript, and the re-order passes the words check", () => {
    expect(undouble(REORDER)).toBe("I kinda wanna re-order those empanadas we had recently");
    expect(undouble("add milk")).toBe("add milk");
    for (const yes of [REORDER, USUAL, "re-order the empanadas", "reorder those empanadas", "order the empanadas from the usual spot"]) expect(spokenAdd(yes), yes).toBe(true);
  });

  it("finds the item and the store in his own words, and leaves the rest to the model", () => {
    expect(doordashAddAsk(REORDER)).toEqual({ items: ["empanadas"] });
    expect(doordashAddAsk(USUAL)).toEqual({ items: ["empanadas"] });
    expect(doordashAddAsk("add the empanadas from the usual spot")).toEqual({ items: ["empanadas"] });
    expect(doordashAddAsk("get my usual from La Esquina")).toEqual({ store: "La Esquina" });
    expect(doordashAddAsk("reorder what we had last time")).toEqual({});
    for (const no of ["add milk to the list", "what did we order last time?", "order the empanadas from the usual spot now", "don't re-order the empanadas", "add eggs", "remind me to re-order the empanadas"]) expect(doordashAddAsk(no), no).toBeNull();
  });

  it("sends DoorDash words to Skippy before the Haven's list and to-do rules", () => {
    for (const t of [REORDER, USUAL, MISHEARD, "order the empanadas from the usual spot", "re-order the empanadas"]) expect(classify(t).kind, t).toBe("skippy");
    expect(classify("add milk").kind).toBe("shopping");
    expect(classify("remind me to re-order the empanadas tomorrow").kind).toBe("todo");
  });

  it("knows a waiting line from an answer", () => {
    expect(waitingLine(WAITING)).toBe(true);
    expect(pendsDoorDash(WAITING)).toBe(true);
    expect(pendsDoorDash("Your usual empanada spot is in the DoorDash usuals, so I'll price it fresh and read it back.")).toBe(true);
    for (const plain of ["Your DoorDash cart has 2 Beef Empanadas.", "Nothing was added, and I won't add anything.", "Want me to add them to your DoorDash cart?", "Garlic's on the Kitchen list."]) expect(pendsDoorDash(plain), plain).toBe(false);
  });

  it("asks about a close match only when it is close", () => {
    const past = HISTORY.orders.map((o) => ({ id: o.order_uuid, store: o.store_name, storeId: String(o.store_id), when: o.created_at, items: o.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)), reorderable: true, totalCents: null, pickup: false, grocery: false, image: null }));
    expect(closestHad(past, ["bananas"])).toEqual({ item: "Beef Empanadas", store: "La Esquina" });
    expect(closestHad(past, ["burritos"])).toBeNull();
  });
});
