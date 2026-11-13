import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { callTool, type ToolHost } from "../_skippy/agent/tools.ts";
import { classify, sayAdded, sayRemoved } from "./classify.ts";
import { CUSTOM_MAX, KitchenList, LISTS, listOf } from "./list.ts";
import { PhoneKeys } from "./phones.ts";
import { PhoneTodos } from "./todos.ts";
import { capture, havenGet, havenPost, type HavenDeps } from "./route.ts";

/**
 * Lists (#735): the Things to buy list next to the Kitchen list, the routing that sends "add a phone charger to my
 * Amazon list" there while groceries stay on the Kitchen list, and the Desk's Lists view routes. Every phrase, item and
 * key here is made up.
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-04T18:00:00Z");
const PEPPER = Buffer.alloc(32, 7);

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/octet-stream" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

function havenDeps(blob: BlobBackend, store = new MemoryAuthStore()): HavenDeps {
  return {
    desk: { deskKey: DESK, store, now: NOW },
    blob,
    pepper: async () => PEPPER,
    todos: (b) => new PhoneTodos(b),
    skippy: async () => ({ reply: "Ask me something harder, monkey.", handedOff: false }),
    voice: null,
    log: () => undefined,
    random: () => 0,
  };
}

const post = (key: string, text: string) => new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "Content-Type": "application/json", "x-ceo-phone-key": key }, body: JSON.stringify({ text }) });

/** Where a phrase goes: "buy: …", "kitchen: …" or the kind. */
function where(text: string, last: Parameters<typeof classify>[1] = null): string {
  const c = classify(text, last);
  if (c.kind === "shopping") return `${c.list === "buy" ? "buy" : "kitchen"}: ${c.items.join(" | ")}`;
  if (c.kind === "remove") return `remove ${c.list === "buy" ? "buy" : "kitchen"}: ${c.items.join(" | ")}`;
  return c.kind;
}

describe("routing between the lists (#735)", () => {
  it("sends the Amazon list and things to buy to Things to buy", () => {
    expect(where("add a phone charger to my Amazon list")).toBe("buy: phone charger");
    expect(where("Hey Skippy, put batteries and a desk lamp on the amazon list")).toBe("buy: batteries | desk lamp");
    expect(where("add a yoga mat to things to buy")).toBe("buy: yoga mat");
    expect(where("add hdmi cable to my to-buy list")).toBe("buy: hdmi cable");
    expect(where("order a bath mat from Amazon")).toBe("buy: bath mat");
    expect(where("add a notebook to Amazon")).toBe("buy: notebook");
    expect(where("put a phone case on my list of things I need")).toBe("buy: phone case");
    // Said for Amazon, even a food word goes there: the list was named.
    expect(where("add coffee filters to my amazon cart")).toBe("buy: coffee filters");
  });

  it("reads 'I need to buy …' as Things to buy, not a to-do, unless it's food", () => {
    expect(where("I need to buy a phone charger")).toBe("buy: phone charger");
    expect(where("we have to order new pillowcases")).toBe("buy: new pillowcases");
    expect(where("gotta buy light bulbs")).toBe("buy: light bulbs");
    expect(where("I need to buy something nice")).toBe("buy: something nice");
    // Groceries said the same way stay on the Kitchen list.
    expect(where("I need to buy eggs and milk")).toBe("kitchen: eggs | milk");
    // A reminder stays a reminder, and a long errand stays a to-do.
    expect(where("remind me to buy a phone charger")).toBe("todo");
    expect(where("I need to buy a birthday present for the neighbours")).toBe("todo");
  });

  it("sends plainly non-grocery things to Things to buy, and anything in doubt to the Kitchen list", () => {
    expect(where("buy a phone charger")).toBe("buy: phone charger");
    expect(where("we need light bulbs")).toBe("buy: light bulbs");
    expect(where("add a phone charger to the list")).toBe("buy: phone charger");
    // Mixed or unclear: groceries.
    expect(where("we need batteries and milk")).toBe("kitchen: batteries | milk");
    expect(where("add salt")).toBe("kitchen: salt");
    expect(where("garlic and lemons")).toBe("kitchen: garlic | lemons");
    expect(where("we're out of dish soap")).toBe("kitchen: dish soap");
    expect(where("add paper towels")).toBe("kitchen: paper towels");
    expect(where("we need cat food")).toBe("kitchen: cat food");
    // A grocery word always wins.
    expect(where("add batteries to my grocery list")).toBe("kitchen: batteries");
    expect(where("put a lamp on the shopping list")).toBe("kitchen: lamp");
  });

  it("follows on and takes things off the right list", () => {
    expect(where("and a usb cable too", "shopping")).toBe("buy: usb cable");
    expect(where("and milk too", "shopping")).toBe("kitchen: milk");
    expect(where("remove the phone charger from my amazon list")).toBe("remove buy: phone charger");
    expect(where("take batteries off things to buy")).toBe("remove buy: batteries");
    expect(where("remove garlic")).toBe("remove kitchen: garlic");
    expect(where("take milk off the list")).toBe("remove kitchen: milk");
  });

  it("leaves the other kinds alone", () => {
    expect(where("call the vet on Friday")).toBe("todo");
    expect(where("how's the Green looking?")).toBe("skippy");
    expect(where("send the week to King Soopers")).toBe("skippy");
    expect(where("vacuum, go clean the kitchen")).toBe("device");
  });

  it("says which list it went on", () => {
    expect(sayAdded(["phone charger"], [], "buy")).toBe("Added phone charger to Things to buy.");
    expect(sayAdded([], ["batteries"], "buy")).toBe("Batteries is already on Things to buy.");
    expect(sayAdded(["garlic"], [])).toBe("Added garlic to the list.");
    expect(sayRemoved({ removed: ["lamp"], missing: [], ambiguous: [] }, "buy")).toBe("Took lamp off Things to buy.");
  });
});

describe("the phone and the lists (#735)", () => {
  it("adds to Things to buy quietly and keeps groceries on the Kitchen list", async () => {
    const blob = memoryBlob();
    const { key } = (await new PhoneKeys(blob, PEPPER).add("Test phone", NOW))!;
    const deps = havenDeps(blob);
    expect(await (await capture(post(key, "add a phone charger to my Amazon list"), deps)).json()).toEqual({ say: "Added phone charger to Things to buy.", quiet: true });
    expect(await (await capture(post(key, "I need to buy batteries"), deps)).json()).toEqual({ say: "Added batteries to Things to buy.", quiet: true });
    expect(await (await capture(post(key, "garlic and lemons"), deps)).json()).toEqual({ say: "Added garlic and lemons to the list.", quiet: true });
    expect((await listOf(blob, "buy").items(NOW)).map((i) => i.name)).toEqual(["phone charger", "batteries"]);
    expect((await new KitchenList(blob).items(NOW)).map((i) => i.name)).toEqual(["garlic", "lemons"]);
    expect(blob.files.has("haven/lists/buy.json")).toBe(true);
    expect(await (await capture(post(key, "take batteries off my amazon list"), deps)).json()).toEqual({ say: "Took batteries off Things to buy.", quiet: true });
    expect((await listOf(blob, "buy").items(NOW)).map((i) => i.name)).toEqual(["phone charger"]);
  });
});

describe("the Desk's Lists view (#735)", () => {
  it("shows counts signed out, and every list with its items, quick add, tick and clear signed in", async () => {
    const blob = memoryBlob();
    const store = new MemoryAuthStore();
    const deps = havenDeps(blob, store);
    await listOf(blob, "buy").add(["desk lamp"], NOW);
    await new KitchenList(blob).add(["oat milk"], NOW);

    const status = await (await havenGet(new Request(`${ORIGIN}/api/haven?view=status`), deps)).text();
    expect(JSON.parse(status).lists).toEqual([
      { id: "kitchen", name: "Groceries", open: 1, done: 0 },
      { id: "buy", name: "Things to buy", open: 1, done: 0 },
    ]);
    expect(status).not.toMatch(/lamp|oat/);
    expect((await havenGet(new Request(`${ORIGIN}/api/haven?view=lists`), deps)).status).toBe(401);

    const cookie = await signedInCookie(DESK, NOW, store);
    const send = (body: unknown, c = cookie) => havenPost(new Request(`${ORIGIN}/api/haven`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: c }, body: JSON.stringify(body) }), deps);
    expect((await send({ action: "list-add", list: "buy", text: "x" }, "")).status).toBe(401);
    expect((await send({ action: "list-add", list: "nope", text: "x" })).status).toBe(400);
    const added = (await (await send({ action: "list-add", list: "buy", text: "usb cable, desk lamp" })).json()) as { added: string[]; already: string[] };
    expect(added).toMatchObject({ added: ["usb cable"], already: ["desk lamp"] });

    const read = async () => ((await (await havenGet(new Request(`${ORIGIN}/api/haven?view=lists`, { headers: { Cookie: cookie } }), deps)).json()) as { lists: { id: string; name: string; items: { id: string; name: string; done: boolean }[] }[] }).lists;
    const lists = await read();
    expect(lists.map((l) => l.id)).toEqual(LISTS.map((l) => l.id));
    const buy = lists.find((l) => l.id === "buy")!;
    expect(buy.items.map((i) => i.name)).toEqual(["desk lamp", "usb cable"]);

    expect((await send({ action: "tick", list: "buy", id: buy.items[0]!.id, done: true })).status).toBe(200);
    // The Kitchen list is untouched, and an id from one list isn't found on the other.
    expect((await send({ action: "tick", id: buy.items[1]!.id, done: true })).status).toBe(404);
    expect(await listOf(blob, "buy").counts(NOW)).toEqual({ open: 1, done: 1 });
    expect(await (await send({ action: "clear-done", list: "buy" })).json()).toEqual({ ok: true, cleared: 1 });
    expect((await listOf(blob, "buy").items(NOW)).map((i) => i.name)).toEqual(["usb cable"]);
    expect((await send({ action: "remove", list: "buy", id: buy.items[1]!.id })).status).toBe(200);
    expect(await listOf(blob, "buy").counts(NOW)).toEqual({ open: 0, done: 0 });
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 1, done: 0 });
  });
});

describe("Desk Skippy's buy_add (#735)", () => {
  it("puts things on Things to buy through the tool", async () => {
    const blob = memoryBlob();
    const host: ToolHost = {
      read: async () => "",
      memory: null,
      kitchenAdd: null,
      buyAdd: (items) => listOf(blob, "buy").add(items, NOW),
      homeAct: null,
      fileIssue: null,
      skipTerms: [],
      now: NOW,
    };
    const out = await callTool("buy_add", { items: ["phone charger"] }, host, { surface: "desk" } as never);
    expect(JSON.stringify(out)).toContain("Things to buy");
    expect((await listOf(blob, "buy").items(NOW)).map((i) => i.name)).toEqual(["phone charger"]);
  });
});

describe("Clear list and New list (#1091)", () => {
  it("clears a whole list with an Undo, makes new lists that keep their names private, and deletes only those", async () => {
    const blob = memoryBlob();
    const store = new MemoryAuthStore();
    const deps = havenDeps(blob, store);
    const cookie = await signedInCookie(DESK, NOW, store);
    const send = async (body: unknown) => {
      const res = await havenPost(new Request(`${ORIGIN}/api/haven`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) }), deps);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    await new KitchenList(blob).add(["oat milk", "lemons"], NOW);

    // Clear list: everything off, then Undo brings back exactly what it took.
    const cleared = await send({ action: "clear-list" });
    expect(cleared.body).toMatchObject({ ok: true, cleared: 2 });
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 0, done: 0 });
    expect((await send({ action: "undo-clear", at: cleared.body.at })).body).toEqual({ ok: true, back: 2 });
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 2, done: 0 });
    expect((await send({ action: "undo-clear", at: "2020-01-01T00:00:00.000Z" })).body).toEqual({ ok: true, back: 0 });

    // New list: an empty list with its name; a taken or empty name is turned down.
    const made = await send({ action: "list-new", name: "  Test   hardware run " });
    expect(made.status).toBe(200);
    const list = made.body.list as { id: string; name: string; custom: boolean; items: unknown[] };
    expect(list).toMatchObject({ name: "Test hardware run", custom: true, items: [] });
    expect(list.id).toMatch(/^l-[a-z0-9]{8}$/);
    expect((await send({ action: "list-new", name: "test HARDWARE run" })).status).toBe(409);
    expect((await send({ action: "list-new", name: "groceries" })).status).toBe(409);
    expect((await send({ action: "list-new", name: "  " })).status).toBe(400);

    // It takes items like any list, and the lists view shows it after the built-in ones.
    expect((await send({ action: "list-add", list: list.id, text: "test hinges" })).status).toBe(200);
    const lists = ((await (await havenGet(new Request(`${ORIGIN}/api/haven?view=lists`, { headers: { Cookie: cookie } }), deps)).json()) as { lists: { id: string; name: string; custom?: boolean; items: { name: string }[] }[] }).lists;
    expect(lists.map((l) => l.id)).toEqual(["kitchen", "buy", list.id]);
    expect(lists[2]).toMatchObject({ name: "Test hardware run", custom: true, items: [{ name: "test hinges" }] });

    // Signed out, a made list is counted under "Other lists", never named.
    const status = await (await havenGet(new Request(`${ORIGIN}/api/haven?view=status`), deps)).text();
    expect(JSON.parse(status).lists).toContainEqual({ id: "other", name: "Other lists", open: 1, done: 0 });
    expect(status).not.toMatch(/hardware|hinges/);

    // Delete list: a made list goes with its file; the built-in ones can't be deleted; an unknown id is a bad request.
    expect((await send({ action: "list-delete", list: "kitchen" })).status).toBe(404);
    expect((await send({ action: "list-delete", list: list.id })).body).toEqual({ ok: true });
    expect(blob.files.has(`haven/lists/${list.id}.json`)).toBe(false);
    expect((await send({ action: "list-add", list: list.id, text: "x" })).status).toBe(400);
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 2, done: 0 });

    // At most CUSTOM_MAX made lists.
    for (let i = 0; i < CUSTOM_MAX; i++) expect((await send({ action: "list-new", name: `Test list ${i}` })).status).toBe(200);
    expect((await send({ action: "list-new", name: "One too many" })).body.error).toBe("too-many");
  });
});
