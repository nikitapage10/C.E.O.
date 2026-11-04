import { describe, expect, it, vi } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { MemoryChatLedger } from "../_skippy/budget.ts";
import { deskContext } from "../_skippy/context.ts";
import { MemoryRoomLog } from "../_skippy/log.ts";
import { MemoryStoryStore, addStorySpend } from "../_world/story.ts";
import { phoneAnswer, type Ask, type ChatDeps } from "../skippy.ts";
import { decide, type GateContext } from "../_site/gate.ts";
import { audioIdOf, signAudio, speakForPhone } from "./audio.ts";
import { classify, sayAdded, sayRemoved, sayTodo, spokenOf } from "./classify.ts";
import { KitchenList, addTo, sameKey } from "./list.ts";
import { KEY_SHAPE, PHONE_RATE, PhoneKeys, keyHash } from "./phones.ts";
import { PhoneTodos } from "./todos.ts";
import type { Home } from "./devices/home.ts";
import { keepState, TODO_STORE_PATH } from "../_today/todos.ts";
import { CONVO_IDLE_MS, CONVO_TURNS, PhoneConvo, convoPath } from "./convo.ts";
import { capture, captureAudio, havenGet, havenPost, type HavenDeps } from "./route.ts";

/**
 * Hey Skippy from the iPhone (#627): the phone keys, the pace, the classifier, the Kitchen list's dedupe, the spoken
 * line, the audio link, the gate and the Desk's routes. Every key, item and line here is made up.
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

function havenDeps(blob: BlobBackend, over: Partial<HavenDeps> = {}, store = new MemoryAuthStore()): HavenDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    desk: { deskKey: DESK, store, now: NOW },
    blob,
    pepper: async () => PEPPER,
    todos: (b) => new PhoneTodos(b),
    skippy: async () => ({ reply: "Ilyr is fine. Go to bed, monkey.", handedOff: false }),
    voice: null,
    log: (line) => lines.push(line),
    random: () => 0,
    lines,
    ...over,
  };
}

const post = (key: string | null, body: unknown, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "Content-Type": "application/json", ...(key !== null && { "x-ceo-phone-key": key }), ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function withPhone() {
  const blob = memoryBlob();
  const phones = new PhoneKeys(blob, PEPPER);
  const made = (await phones.add("Test phone", NOW))!;
  return { blob, phones, key: made.key, phone: made.phone };
}

describe("phone keys (#627)", () => {
  it("mints a random 32-byte key once and keeps only its peppered hash", async () => {
    const { blob, key } = await withPhone();
    expect(key).toMatch(KEY_SHAPE);
    const stored = new TextDecoder().decode(blob.files.get("haven/phones.json"));
    expect(stored).not.toContain(key);
    expect(stored).not.toContain(key.slice(4));
    expect(stored).toContain(keyHash(PEPPER, key));
    // A different pepper (another Desk key) doesn't match.
    expect(keyHash(Buffer.alloc(32, 8), key)).not.toBe(keyHash(PEPPER, key));
  });

  it("refuses a missing, malformed, unknown or revoked key with a bare 401", async () => {
    const { blob, phones, key, phone } = await withPhone();
    const deps = havenDeps(blob);
    const other = `skp_${"A".repeat(43)}`;
    for (const k of [null, "", "nope", key.slice(0, -1), other, `${key} `.repeat(2)]) {
      const res = await capture(post(k, { text: "garlic and lemons" }), deps);
      expect(res.status, String(k)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    // A bearer works too (the Function App's own address; the Static Web App replaces Authorization on the site's).
    expect((await capture(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ text: "add salt" }) }), deps)).status).toBe(200);
    // Basic auth or the key in the body doesn't count.
    expect((await capture(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { Authorization: `Basic ${key}` }, body: JSON.stringify({ text: "milk and eggs", key }) }), deps)).status).toBe(401);
    expect((await capture(post(key, { text: "garlic and lemons" }), deps)).status).toBe(200);
    expect(await phones.revoke(phone.id, NOW)).toBe(true);
    const res = await capture(post(key, { text: "garlic and lemons" }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // Nothing was added by a refused capture.
    expect((await new KitchenList(blob).items(NOW)).map((i) => i.name)).toEqual(["salt", "garlic", "lemons"]);
  });

  it("marks a key used, and the Desk sees label and times only", async () => {
    const { blob, phones, key } = await withPhone();
    await capture(post(key, { text: "add milk" }), havenDeps(blob));
    const [p] = await phones.list();
    expect(p).toEqual({ id: expect.any(String), label: "Test phone", created: new Date(NOW).toISOString(), lastUsed: new Date(NOW).toISOString(), revoked: null });
  });

  it("paces each key: 30 an hour, then 429 with Retry-After, and fine again an hour on", async () => {
    const { blob, key } = await withPhone();
    const deps = havenDeps(blob);
    for (let i = 0; i < PHONE_RATE.max; i++) expect((await capture(post(key, { text: `add thing${i}` }), deps)).status).toBe(200);
    const res = await capture(post(key, { text: "add one more" }), deps);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as { say: string }).say).toBeTruthy();
    const later = havenDeps(blob, { desk: { deskKey: DESK, store: new MemoryAuthStore(), now: NOW + PHONE_RATE.ms + 1 } });
    expect((await capture(post(key, { text: "add one more" }), later)).status).toBe(200);
  });

  it("caps the text at 300 characters and never logs what was said", async () => {
    const { blob, key } = await withPhone();
    const deps = havenDeps(blob);
    const long = await capture(post(key, { text: "a".repeat(301) }), deps);
    expect(long.status).toBe(400);
    expect((await capture(post(key, { text: "" }), deps)).status).toBe(400);
    expect((await capture(post(key, "not json"), deps)).status).toBe(400);
    await capture(post(key, { text: "remind me to call the dermatologist tomorrow" }), deps);
    await capture(post(key, { text: "garlic and lemons" }), deps);
    await capture(post(key, { text: "what's happening in Ilyr" }), deps);
    expect(deps.lines).toEqual(["capture: todo", "capture: shopping", "capture: skippy"]);
    expect(deps.lines.join(" ")).not.toMatch(/dermatologist|garlic|Ilyr/);
  });
});

describe("the classifier (#627)", () => {
  const shop = (text: string) => {
    const c = classify(text);
    return c.kind === "shopping" ? c.items : c.kind;
  };
  it("finds shopping items in add/need/buy/out of, and in a bare list", () => {
    expect(shop("garlic and lemons")).toEqual(["garlic", "lemons"]);
    expect(shop("Add garlic, lemons and oat milk.")).toEqual(["garlic", "lemons", "oat milk"]);
    expect(shop("we need milk, eggs and bread")).toEqual(["milk", "eggs", "bread"]);
    expect(shop("We're out of coffee")).toEqual(["coffee"]);
    expect(shop("buy some paper towels")).toEqual(["paper towels"]);
    expect(shop("put bananas on the shopping list")).toEqual(["bananas"]);
    expect(shop("Hey Skippy, add tortillas & salsa to the list")).toEqual(["tortillas", "salsa"]);
    expect(shop("running low on dish soap")).toEqual(["dish soap"]);
  });
  it("finds to-dos in remind/to-do/call/email and anything with a when", () => {
    expect(classify("remind me to call the dermatologist tomorrow")).toEqual({ kind: "todo", text: "Call the dermatologist tomorrow" });
    expect(classify("to-do: renew the passport")).toEqual({ kind: "todo", text: "Renew the passport" });
    expect(classify("call the vet on Friday").kind).toBe("todo");
    expect(classify("email Sam tomorrow").kind).toBe("todo");
    expect(classify("I need to book a haircut").kind).toBe("todo");
    expect(classify("pick up the dry cleaning tonight").kind).toBe("todo");
    expect(classify("get the car washed tomorrow").kind).toBe("todo");
  });
  it("leaves questions, small talk and a single bare word to Skippy", () => {
    for (const t of ["what's the weather tomorrow", "how's the Green doing?", "tell me a joke", "hello", "thanks", "milk", "Is Rusty building anything", ""]) expect(classify(t).kind, t).toBe("skippy");
  });
});

describe("the Kitchen list (#627)", () => {
  it("dedupes case-insensitively against open items and within a batch", () => {
    let id = 0;
    const first = addTo([], ["Garlic", "lemons", "garlic"], NOW, () => `i${id++}`);
    expect(first.result).toEqual({ added: ["Garlic", "lemons"], already: [] });
    const second = addTo(first.items, ["GARLIC", "Lemon", "milk"], NOW, () => `i${id++}`);
    expect(second.result).toEqual({ added: ["milk"], already: ["GARLIC", "Lemon"] });
    expect(second.items.map((i) => ({ name: i.name, source: i.source, done: i.done }))).toEqual([
      { name: "Garlic", source: "phone", done: false },
      { name: "lemons", source: "phone", done: false },
      { name: "milk", source: "phone", done: false },
    ]);
    expect(sameKey("Tomatoes")).toBe(sameKey("tomato"));
  });

  it("adds a ticked-off item again, and clears ticked items after a day", async () => {
    const blob = memoryBlob();
    const list = new KitchenList(blob);
    await list.add(["garlic"], NOW);
    const [g] = await list.items(NOW);
    expect(g).toMatchObject({ name: "garlic", source: "phone", done: false, addedAt: new Date(NOW).toISOString(), id: expect.any(String) });
    expect(await list.tick(g!.id, true, NOW)).toBe(true);
    expect(await list.add(["Garlic"], NOW)).toEqual({ added: ["Garlic"], already: [] });
    expect(await list.counts(NOW)).toEqual({ open: 1, done: 1 });
    expect(await list.counts(NOW + 25 * 3_600_000)).toEqual({ open: 1, done: 0 });
  });
});

describe("what the shortcut says (#627)", () => {
  it("is short and natural", () => {
    expect(sayAdded(["garlic", "lemons"], [])).toBe("Added garlic and lemons to the list.");
    expect(sayAdded(["garlic", "lemons", "oat milk"], [])).toBe("Added garlic, lemons and oat milk to the list.");
    expect(sayAdded(["milk"], ["garlic"])).toBe("Added milk to the list. Garlic was already on it.");
    expect(sayAdded([], ["garlic", "lemons"])).toBe("Garlic and lemons are already on the list.");
    expect(sayAdded([], ["garlic"])).toBe("Garlic is already on the list.");
    expect(sayTodo("Call the dermatologist")).toBe("On your to-dos: Call the dermatologist.");
    expect(sayTodo("Call the dermatologist", new Date(NOW + 86_400_000).toISOString(), NOW)).toMatch(/^On your to-dos: Call the dermatologist, .+\.$/);
  });
  it("cuts Skippy's reply to two spoken sentences, and a hand-off to the quick take and the Desk", () => {
    expect(spokenOf("One. Two. Three.", false)).toBe("One. Two.");
    expect(spokenOf("Tre Tucker, probably. Handed to The Commentator; the answer will show on the Desk.", true)).toBe("Tre Tucker, probably. I'll put the rest on the Desk.");
    expect(spokenOf("x".repeat(400), false).length).toBeLessThanOrEqual(240);
  });
  it("answers a capture with { say } in each lane", async () => {
    const { blob, key } = await withPhone();
    const deps = havenDeps(blob);
    expect(await (await capture(post(key, { text: "garlic and lemons" }), deps)).json()).toEqual({ say: "Added garlic and lemons to the list.", quiet: true });
    expect(await (await capture(post(key, { text: "add Garlic" }), deps)).json()).toEqual({ say: "Garlic is already on the list.", quiet: true });
    const said = (await (await capture(post(key, { text: "remind me to call the dermatologist tomorrow" }), deps)).json()) as { say: string };
    expect(said.say).toMatch(/^On your to-dos: Call the dermatologist, tomorrow 9:00 am\.$/);
    expect(await new PhoneTodos(blob).openCount(NOW)).toBe(1);
    expect(await (await capture(post(key, { text: "how is Ilyr" }), deps)).json()).toEqual({ say: "Ilyr is fine. Go to bed, monkey.", quiet: false });
  });
});

describe("phone to-dos land in Today's store (#627, #622)", () => {
  it("puts a capture in desk/today/todos.json with its due time, like a Today to-do", async () => {
    const blob = memoryBlob();
    const got = await new PhoneTodos(blob).addTodo("Call the dermatologist tomorrow", NOW);
    expect(got.text).toBe("Call the dermatologist");
    expect(got.due).toBeTruthy();
    const state = keepState(JSON.parse(new TextDecoder().decode(blob.files.get(TODO_STORE_PATH))), NOW);
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0]).toMatchObject({ text: "Call the dermatologist", due: got.due });
    expect(blob.files.has("haven/phone-todos.json")).toBe(false);
  });
  it("migrates open items from the old file once, drops done ones, and removes the file", async () => {
    const blob = memoryBlob();
    const old = [
      { id: "aaa111", text: "Renew the passport", addedAt: new Date(NOW - 1000).toISOString(), source: "phone", done: false },
      { id: "bbb222", text: "Old thing", addedAt: new Date(NOW - 2000).toISOString(), source: "phone", done: true },
    ];
    await blob.put("haven/phone-todos.json", JSON.stringify(old), { contentType: "application/json", addRandomSuffix: false });
    const todos = new PhoneTodos(blob);
    expect(await todos.openCount(NOW)).toBe(1);
    expect(blob.files.has("haven/phone-todos.json")).toBe(false);
    await todos.addTodo("buy stamps", NOW);
    expect(await todos.openCount(NOW)).toBe(2);
    const state = keepState(JSON.parse(new TextDecoder().decode(blob.files.get(TODO_STORE_PATH))), NOW);
    expect(state.todos.map((t) => t.text).sort()).toEqual(["Buy stamps", "Renew the passport"]);
  });
  it("takes back the latest phone to-do for \"not as a task\" (#641), only a recent one", async () => {
    const blob = memoryBlob();
    const todos = new PhoneTodos(blob);
    await todos.addTodo("Garlic", NOW - 20 * 60_000);
    await todos.addTodo("Oat milk", NOW - 60_000);
    expect(await todos.takeBackLast(NOW)).toBe("Oat milk");
    expect(await todos.takeBackLast(NOW)).toBeNull();
    expect(await todos.openCount(NOW)).toBe(1);
  });
});

describe("Skippy from the phone (#627): the Desk's own chat, marked phone", () => {
  async function chatDeps(answer: unknown) {
    const store = new MemoryAuthStore();
    const log = new MemoryRoomLog();
    const asked: string[] = [];
    const ask: Ask = async (system) => (asked.push(system), { answer, usage: { input_tokens: 10, output_tokens: 5 }, model: "claude-sonnet-5-5" });
    const deps: ChatDeps = { deskKey: DESK, store, ledger: new MemoryChatLedger(), ask, log, world: async () => null, desk: async () => deskContext([], [], null, null), now: NOW, env: {} };
    return { deps, log, asked };
  }
  it("tells the model it's the phone, logs the turn as via phone, and passes a hand-off on", async () => {
    const { deps, log, asked } = await chatDeps({ reply: "The Commentator says start Tucker.", actions: [], room: "green", needs: "submind" });
    const turn = await phoneAnswer("who do I start at flex", "abc123", [], deps);
    expect(turn.handedOff).toBe(true);
    expect(asked[0]).toContain("iPhone");
    const [kept] = await log.list("green", NOW);
    expect(kept).toMatchObject({ via: "phone", needs: "turf", question: "who do I start at flex" });
    expect(spokenOf(turn.reply, turn.handedOff)).toMatch(/I'll put the rest on the Desk\.$/);
  });
  it("holds back private-looking text before the model sees it", async () => {
    const { deps, asked } = await chatDeps({ reply: "x", actions: [], room: "none" });
    expect((await phoneAnswer("my card is 4111 1111 1111 1111", "abc123", [], deps)).error).toBe("private");
    expect(asked).toEqual([]);
  });
});

describe("Skippy's voice on the phone (#627)", () => {
  const eleven = { key: "test-eleven", voice: "onwK4e9ZLuTAKqWW03F9", budget: 10 };
  const pcm = new Uint8Array(4800).fill(1);
  const fetcher = vi.fn(async () => new Response(pcm, { status: 200, headers: { "Content-Type": "audio/pcm" } })) as unknown as typeof fetch;

  it("returns say and a signed, single-use, five-minute audio link that never carries the key", async () => {
    const { blob, key } = await withPhone();
    const ledger = new MemoryStoryStore();
    const deps = havenDeps(blob, { voice: { eleven, ledger, deskKey: DESK, fetcher } });
    const body = (await (await capture(post(key, { text: "how is Ilyr", voice: true }), deps)).json()) as { say: string; quiet: boolean; audio: string };
    expect(body.say).toBe("Ilyr is fine. Go to bed, monkey.");
    expect(body.quiet).toBe(false);
    expect(body.audio).toMatch(/^https:\/\/ceo\.test\/api\/capture\?a=pa1\./);
    expect(body.audio).not.toContain(key.slice(4));
    expect((await ledger.loadSpend())["2026-11"]?.elevenChars).toBe(body.say.length);
    const get = () => captureAudio(new Request(body.audio), deps);
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("audio/wav");
    expect((await get()).status).toBe(404);
    const token = new URL(body.audio).searchParams.get("a")!;
    expect(audioIdOf(token, DESK, NOW + 5 * 60_000 + 1)).toBeNull();
    expect(audioIdOf(token, "another desk key entirely", NOW)).toBeNull();
    expect(audioIdOf(`${token.slice(0, -2)}xx`, DESK, NOW)).toBeNull();
  });

  it("leaves audio out (and still says it) when the voice cap is spent", async () => {
    const { blob, key } = await withPhone();
    const ledger = new MemoryStoryStore();
    ledger.spend = addStorySpend({}, NOW, { elevenUsd: 10 });
    const deps = havenDeps(blob, { voice: { eleven, ledger, deskKey: DESK, fetcher } });
    const res = await capture(post(key, { text: "how is Ilyr", voice: true }), deps);
    expect(await res.json()).toEqual({ say: "Ilyr is fine. Go to bed, monkey.", quiet: false });
    expect(await speakForPhone("hi", { blob, eleven: null, ledger, deskKey: DESK }, NOW)).toBeNull();
  });

  it("keeps a finished action quiet: a notification line, no audio link, no ElevenLabs call (#652)", async () => {
    const { blob, key } = await withPhone();
    const ledger = new MemoryStoryStore();
    const spoken = vi.fn(async () => new Response(pcm, { status: 200, headers: { "Content-Type": "audio/pcm" } })) as unknown as typeof fetch;
    const done = { ok: true, say: "The vacuum is cleaning the kitchen." };
    const home = (act: (req: unknown) => Promise<unknown>) => (() => ({ act }) as unknown as Home) as HavenDeps["devices"];
    const deps = havenDeps(blob, { voice: { eleven, ledger, deskKey: DESK, fetcher: spoken }, devices: home(async () => done) });
    const ask = async (text: string, d = deps) => (await (await capture(post(key, { text, voice: true }), d)).json()) as Record<string, unknown>;
    expect(await ask("add oat milk")).toEqual({ say: "Added oat milk to the list.", quiet: true });
    expect(await ask("remind me to water the ferns tomorrow")).toMatchObject({ quiet: true });
    expect(await ask("vacuum, go clean the kitchen")).toEqual({ say: done.say, quiet: true });
    expect(spoken).not.toHaveBeenCalled();
    expect((await ledger.loadSpend())["2026-11"]).toBeUndefined();
  });

  it("speaks a question, a refusal, a failure and a warning (#652)", async () => {
    const { blob, key } = await withPhone();
    const ledger = new MemoryStoryStore();
    const home = (r: unknown) => (() => ({ act: async () => r }) as unknown as Home) as HavenDeps["devices"];
    const ask = async (text: string, devices: HavenDeps["devices"]) => {
      const deps = havenDeps(blob, { voice: { eleven, ledger, deskKey: DESK, fetcher }, devices });
      return (await (await capture(post(key, { text, voice: true }), deps)).json()) as { quiet: boolean; audio?: string };
    };
    const question = await ask("how is Ilyr", home({ ok: true, say: "x" }));
    expect(question.quiet).toBe(false);
    expect(question.audio).toBeTruthy();
    const refused = await ask("feed the cat a portion", home({ ok: false, code: "cap", say: "That's the lot for today." }));
    expect(refused).toMatchObject({ quiet: false });
    expect(refused.audio).toBeTruthy();
    const warned = await ask("give the cat wet food", home({ ok: true, warned: true, say: "The wet food feeder's lid is open. Heads up: the bowl in front is wet." }));
    expect(warned).toMatchObject({ quiet: false });
    expect(warned.audio).toBeTruthy();
    const tray = await ask("what's in the wet food feeder", home({ ok: true, say: "Bowl 2 is in front." }));
    expect(tray.quiet).toBe(false);
    // #713: an opening says when it closes, so it is spoken too.
    const opened = await ask("open the wet food tray", home({ ok: true, say: "The wet food feeder's lid is open. It closes at 1pm." }));
    expect(opened.quiet).toBe(false);
    const down = await ask("clean the litter box", (() => null) as HavenDeps["devices"]);
    expect(down.quiet).toBe(false);
    const broke = await ask("feed the cat", (() => { throw new Error("boom"); }) as HavenDeps["devices"]);
    expect(broke.audio).toBeUndefined();
  });
});

describe("the site gate lets the phone through only with a key-shaped bearer or a signed link (#627)", () => {
  const ctx: GateContext = { state: { on: true, v: 1, sv: 1 } as unknown as GateContext["state"], keys: null, env: { FOUNDRY_DESK_KEY: DESK }, now: NOW };
  const allow = (r: Request) => decide(r, ctx).allow;
  it("passes POST /api/capture with a phone-shaped key, and nothing else there", () => {
    const key = `skp_${"b".repeat(43)}`;
    expect(allow(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { Authorization: `Bearer ${key}` } }))).toBe(true);
    expect(allow(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "x-ceo-phone-key": key } }))).toBe(true);
    expect(allow(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "x-ceo-phone-key": "short" } }))).toBe(false);
    expect(allow(new Request(`${ORIGIN}/api/capture`, { method: "POST" }))).toBe(false);
    expect(allow(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { Authorization: "Bearer short" } }))).toBe(false);
    expect(allow(new Request(`${ORIGIN}/api/capture?x=1`, { method: "POST", headers: { Authorization: `Bearer ${key}` } }))).toBe(false);
    expect(allow(new Request(`${ORIGIN}/api/haven?view=list`, { headers: { Authorization: `Bearer ${key}` } }))).toBe(false);
  });
  it("passes an answer's audio only on a good signed link, and the greeting clips", () => {
    const token = signAudio(DESK, "AAAAAAAAAAAAAAAA", NOW + 60_000)!;
    expect(allow(new Request(`${ORIGIN}/api/capture?a=${token}`))).toBe(true);
    expect(allow(new Request(`${ORIGIN}/api/capture?a=${token}&b=1`))).toBe(false);
    expect(allow(new Request(`${ORIGIN}/api/capture?a=${signAudio("someone else's desk key", "AAAAAAAAAAAAAAAA", NOW + 60_000)}`))).toBe(false);
    expect(allow(new Request(`${ORIGIN}/api/hey-skippy`))).toBe(true);
    expect(allow(new Request(`${ORIGIN}/hey-skippy/hello.mp3`))).toBe(true);
    expect(allow(new Request(`${ORIGIN}/api/hey-skippy`, { method: "POST" }))).toBe(false);
  });
});

describe("the Desk's haven routes (#627)", () => {
  it("gives the public counts only, and the list and phones only to a passkey session", async () => {
    const { blob, key } = await withPhone();
    const store = new MemoryAuthStore();
    const deps = havenDeps(blob, {}, store);
    await capture(post(key, { text: "garlic and lemons" }), deps);
    const status = await havenGet(new Request(`${ORIGIN}/api/haven?view=status`), deps);
    const text = await status.text();
    expect(JSON.parse(text)).toEqual({ kitchen: { open: 2, done: 0 }, todos: 0, gym: { perWeek: 2, doneThisWeek: 0 }, meals: null, lists: [{ id: "kitchen", name: "Groceries", open: 2, done: 0 }, { id: "buy", name: "Things to buy", open: 0, done: 0 }], ready: true });
    expect(text).not.toContain("garlic");
    expect((await havenGet(new Request(`${ORIGIN}/api/haven?view=list`), deps)).status).toBe(401);
    expect((await havenGet(new Request(`${ORIGIN}/api/haven?view=phones`), deps)).status).toBe(401);
    const cookie = await signedInCookie(DESK, NOW, store);
    const list = (await (await havenGet(new Request(`${ORIGIN}/api/haven?view=list`, { headers: { Cookie: cookie } }), deps)).json()) as { items: { id: string; name: string }[] };
    expect(list.items.map((i) => i.name)).toEqual(["garlic", "lemons"]);
    const phones = await (await havenGet(new Request(`${ORIGIN}/api/haven?view=phones`, { headers: { Cookie: cookie } }), deps)).text();
    expect(phones).toContain("Test phone");
    expect(phones).not.toMatch(/hash|skp_/);
  });

  it("adds a phone (key shown once), revokes it, and ticks items, signed in only", async () => {
    const blob = memoryBlob();
    const store = new MemoryAuthStore();
    const deps = havenDeps(blob, {}, store);
    const cookie = await signedInCookie(DESK, NOW, store);
    const send = (body: unknown, c = cookie) => havenPost(new Request(`${ORIGIN}/api/haven`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: c }, body: JSON.stringify(body) }), deps);
    expect((await send({ action: "add-phone", label: "x" }, "")).status).toBe(401);
    const made = (await (await send({ action: "add-phone", label: "iPhone 17" })).json()) as { phone: { id: string; label: string }; key: string };
    expect(made.key).toMatch(KEY_SHAPE);
    expect(made.phone.label).toBe("iPhone 17");
    expect(deps.lines.join(" ")).not.toContain(made.key);
    expect((await capture(post(made.key, { text: "milk and eggs" }), deps)).status).toBe(200);
    const listed = await (await havenGet(new Request(`${ORIGIN}/api/haven?view=phones`, { headers: { Cookie: cookie } }), deps)).text();
    expect(listed).not.toContain(made.key);
    const items = (await new KitchenList(blob).items(NOW)).map((i) => i.id);
    expect((await send({ action: "tick", id: items[0], done: true })).status).toBe(200);
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 1, done: 1 });
    expect((await send({ action: "revoke-phone", id: made.phone.id })).status).toBe(200);
    expect((await capture(post(made.key, { text: "milk" }), deps)).status).toBe(401);
  });
});

describe("a short memory per phone (#627)", () => {
  it("follows on: 'and milk too' after shopping adds milk, and Skippy sees the last turns", async () => {
    const { blob, key, phone } = await withPhone();
    const seen: { who: string; text: string }[][] = [];
    const deps = havenDeps(blob, { skippy: async (_t, _id, history) => (seen.push(history), { reply: "Godwin sits, monkey.", handedOff: false }) });
    expect(await (await capture(post(key, { text: "garlic and lemons" }), deps)).json()).toEqual({ say: "Added garlic and lemons to the list.", quiet: true });
    expect(await (await capture(post(key, { text: "and milk too" }), deps)).json()).toEqual({ say: "Added milk to the list.", quiet: true });
    await capture(post(key, { text: "what about Godwin?" }), deps);
    expect(seen[0]).toEqual([
      { who: "nikita", text: "garlic and lemons" },
      { who: "skippy", text: "Added garlic and lemons to the list." },
      { who: "nikita", text: "and milk too" },
      { who: "skippy", text: "Added milk to the list." },
    ]);
    const kept = await new PhoneConvo(blob).read(phone.id, NOW);
    expect(kept.turns).toHaveLength(CONVO_TURNS);
    expect(kept.turns.at(-1)).toEqual({ who: "skippy", text: "Godwin sits, monkey." });
    expect(kept.last).toBe("skippy");
    // Without a shopping turn before it, "and milk too" isn't shopping.
    expect(classify("and milk too").kind).toBe("skippy");
    expect(classify("and milk too", "shopping")).toEqual({ kind: "shopping", items: ["milk"] });
  });

  it("forgets after ten quiet minutes, and when the phone is revoked", async () => {
    const { blob, key, phone } = await withPhone();
    const seen: number[] = [];
    const at = (now: number) => havenDeps(blob, { desk: { deskKey: DESK, store: new MemoryAuthStore(), now }, skippy: async (_t, _id, history) => (seen.push(history.length), { reply: "Fine.", handedOff: false }) });
    await capture(post(key, { text: "garlic and lemons" }), at(NOW));
    await capture(post(key, { text: "and milk too" }), at(NOW + CONVO_IDLE_MS + 1));
    expect((await new KitchenList(blob).items(NOW)).map((i) => i.name)).toEqual(["garlic", "lemons"]);
    await capture(post(key, { text: "how's it going" }), at(NOW + CONVO_IDLE_MS + 2));
    // The stale "and milk too" went to Skippy with no history; the next ask sees that one exchange.
    expect(seen).toEqual([0, 2]);
    expect((await new PhoneConvo(blob).read(phone.id, NOW + 3 * CONVO_IDLE_MS)).turns).toEqual([]);
    await new PhoneKeys(blob, PEPPER).revoke(phone.id, NOW);
    await new PhoneConvo(blob).forget(phone.id);
    expect(blob.files.has(convoPath(phone.id))).toBe(false);
  });
});

describe("removing from the Kitchen list (#657)", () => {
  it("hears 'remove garlic', 'take milk off the list', 'cross off eggs' as removals", () => {
    expect(classify("remove garlic")).toEqual({ kind: "remove", items: ["garlic"] });
    expect(classify("Remove garlic from the list.")).toEqual({ kind: "remove", items: ["garlic"] });
    expect(classify("take milk off the list")).toEqual({ kind: "remove", items: ["milk"] });
    expect(classify("take milk and bread off my shopping list")).toEqual({ kind: "remove", items: ["milk", "bread"] });
    expect(classify("cross off eggs")).toEqual({ kind: "remove", items: ["eggs"] });
    expect(classify("cross eggs off the grocery list")).toEqual({ kind: "remove", items: ["eggs"] });
    expect(classify("delete oat milk from my list")).toEqual({ kind: "remove", items: ["oat milk"] });
    expect(classify("please get rid of lemons")).toEqual({ kind: "remove", items: ["lemons"] });
  });

  it("leaves adds, to-dos and questions alone", () => {
    expect(classify("add garlic to the list").kind).toBe("shopping");
    expect(classify("remind me to remove the paint tomorrow").kind).toBe("todo");
    expect(classify("how do I remove a wine stain").kind).toBe("skippy");
  });

  it("removes an item, hides it at once, and Undo brings it back for ten minutes", async () => {
    const list = new KitchenList(memoryBlob());
    await list.add(["garlic", "lemons"], NOW);
    const [g] = await list.items(NOW);
    expect(await list.remove(g!.id, NOW)).toBe(true);
    expect((await list.items(NOW)).map((i) => i.name)).toEqual(["lemons"]);
    expect(await list.counts(NOW)).toEqual({ open: 1, done: 0 });
    // A removed name can be added again at once.
    expect(await list.add(["garlic"], NOW)).toEqual({ added: ["garlic"], already: [] });
    expect(await list.remove("nope", NOW)).toBe(false);
    const other = new KitchenList(memoryBlob());
    await other.add(["milk"], NOW);
    const [m] = await other.items(NOW);
    await other.remove(m!.id, NOW);
    expect(await other.restore(m!.id, NOW + 60_000)).toBe(true);
    expect((await other.items(NOW + 60_000)).map((i) => i.name)).toEqual(["milk"]);
    await other.remove(m!.id, NOW);
    expect(await other.restore(m!.id, NOW + 11 * 60_000)).toBe(false);
    expect(await other.items(NOW + 11 * 60_000)).toEqual([]);
  });

  it("matches by name: exact, then the one item with those words, else missing or ambiguous", async () => {
    const list = new KitchenList(memoryBlob());
    await list.add(["milk", "oat milk", "garlic", "red onions", "red peppers"], NOW);
    expect(await list.removeByName(["Milk"], NOW)).toEqual({ removed: ["milk"], missing: [], ambiguous: [] });
    expect(await list.removeByName(["onion", "bread"], NOW)).toEqual({ removed: ["red onions"], missing: ["bread"], ambiguous: [] });
    await list.add(["red onions"], NOW);
    expect(await list.removeByName(["red"], NOW)).toEqual({ removed: [], missing: [], ambiguous: [{ said: "red", could: ["red peppers", "red onions"] }] });
    expect((await list.items(NOW)).map((i) => i.name)).toEqual(["oat milk", "garlic", "red peppers", "red onions"]);
  });

  it("says what happened, and answers quiet only when everything went", async () => {
    expect(sayRemoved({ removed: ["milk"], missing: [], ambiguous: [] })).toBe("Took milk off the list.");
    expect(sayRemoved({ removed: [], missing: ["bread"], ambiguous: [] })).toBe("I couldn't find bread on the list.");
    expect(sayRemoved({ removed: [], missing: [], ambiguous: [{ said: "milk", could: ["oat milk", "whole milk"] }] })).toBe("Which milk: oat milk and whole milk?");
    const { blob, key } = await withPhone();
    const deps = havenDeps(blob);
    await capture(post(key, { text: "whole milk, eggs and oat milk" }), deps);
    const quietly = await (await capture(post(key, { text: "cross off eggs" }), deps)).json();
    expect(quietly).toEqual({ say: "Took eggs off the list.", quiet: true });
    const gone = await (await capture(post(key, { text: "remove bread" }), deps)).json();
    expect(gone).toEqual({ say: "I couldn't find bread on the list.", quiet: false });
    const which = await (await capture(post(key, { text: "take milk off the list" }), deps)).json() as { quiet: boolean };
    expect(which.quiet).toBe(false);
    expect((await new KitchenList(blob).items(NOW)).map((i) => i.name)).toEqual(["whole milk", "oat milk"]);
  });

  it("removes and undoes over the Desk route, passkey session only", async () => {
    const blob = memoryBlob();
    const store = new MemoryAuthStore();
    const deps = havenDeps(blob, {}, store);
    const cookie = await signedInCookie(DESK, NOW, store);
    const send = (body: unknown, c = cookie) => havenPost(new Request(`${ORIGIN}/api/haven`, { method: "POST", headers: { "Content-Type": "application/json", ...(c && { Cookie: c }) }, body: JSON.stringify(body) }), deps);
    await new KitchenList(blob).add(["garlic"], NOW);
    const [g] = await new KitchenList(blob).items(NOW);
    expect((await send({ action: "remove", id: g!.id }, "")).status).toBe(401);
    expect((await send({ action: "remove", id: g!.id })).status).toBe(200);
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 0, done: 0 });
    expect((await send({ action: "remove", id: g!.id })).status).toBe(404);
    expect((await send({ action: "undo-remove", id: g!.id })).status).toBe(200);
    expect(await new KitchenList(blob).counts(NOW)).toEqual({ open: 1, done: 0 });
    expect((await send({ action: "undo-remove", id: "nope" })).status).toBe(404);
  });
});
