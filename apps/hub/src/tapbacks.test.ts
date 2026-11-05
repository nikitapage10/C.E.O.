import { describe, expect, it } from "vitest";
import { readTextsView, type Tapback, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import { REQUEST_MS, signRequest } from "../../../api/_relay/tokens.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { blueBubbles, BlueBubblesError, readMessage, type BlueBubbles, type ChatInfo, type Contact, type Message, type Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine, SETTLE_MS } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";

/**
 * #888: tapbacks from the Desk. A shown line carries an opaque ref; the message guid stays on the Mac. A tapback is a
 * signed, single-use, 10-minute request that goes through BlueBubbles' react route only on Nikita's tap, settles
 * nothing, and is refused (with the Desk told) while the Private API is off. Every name, number, guid and text here
 * is made up (555 numbers).
 */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const KEY = Buffer.alloc(32, 9);
const A = "+15555550111";
const CHAT = `iMessage;-;${A}`;
const PEOPLE: Contact[] = [{ names: ["Casey Sample"], handles: [A] }];
const msg = (text: string, at: number, guid: string, fromMe = false): Message => ({ text, fromMe, at, handle: fromMe ? "" : A, read: false, guid });

class FakeBB implements BlueBubbles {
  byChat = new Map<string, Message[]>();
  reacted: { chat: string; guid: string; tapback: Tapback }[] = [];
  on: boolean | null = true;
  reactError: Error | null = null;
  async ping() {
    return true;
  }
  async contacts() {
    return PEOPLE;
  }
  async messages(c: string, limit: number) {
    return [...(this.byChat.get(c) ?? [])].sort((a, b) => b.at - a.at).slice(0, limit);
  }
  async send(): Promise<boolean> {
    throw new Error("a tapback never sends a text");
  }
  async react(chat: string, guid: string, tapback: Tapback) {
    if (this.reactError) throw this.reactError;
    this.reacted.push({ chat, guid, tapback });
    return true;
  }
  async privateApi() {
    return this.on;
  }
  async chats() {
    return [];
  }
  async contactPhotos() {
    return [];
  }
  async since(): Promise<Polled[]> {
    return [];
  }
  async chatList(): Promise<ChatInfo[]> {
    return [];
  }
}

class FakeSite implements Site {
  waiting: unknown[] = [];
  reported: { rid: string; result: string; reason?: string }[] = [];
  async status() {
    return true;
  }
  async texts(_: TextsView) {
    return true;
  }
  async sort(_: SortInput) {
    return { answer: { needsReply: true, sort: "normal" as const, gist: "Asks about the plan" } };
  }
  async draft(_: DraftInput) {
    return { answer: { draft: "sounds good" } };
  }
  async compose(_: ComposeInput) {
    return { answer: null };
  }
  async learn(_: LearnInput) {
    return { answer: null, usd: 0 };
  }
  async requests() {
    const out = this.waiting;
    this.waiting = [];
    return out;
  }
  async results(r: { rid: string; result: string }[]) {
    this.reported.push(...r);
    return true;
  }
  async skipTerms() {
    return [];
  }
  async unpair() {
    return true;
  }
  async photoKey() {
    return null;
  }
  async photo() {
    return true;
  }
  async photos() {
    return [];
  }
}

const tapback = (rid: string, thread: string, text: string, now: number, key = KEY) => {
  const f = { rid, kind: "react" as const, thread, draftAt: 0, text, until: now + REQUEST_MS };
  return { ...f, created: now, sig: signRequest(key, f) };
};

/** One owed thread whose shown lines carry refs: two of theirs around one of Nikita's. */
const owed = async () => {
  let now = NOW;
  const bb = new FakeBB();
  const site = new FakeSite();
  const store = memoryStore();
  const engine = new Engine({ store, bb, site, log: memoryLogger(() => now), config: DEFAULT_CONFIG, sendKey: KEY, now: () => now, offsetAt: () => 0 });
  const texts = [msg("Are we still on for the hike?", NOW - 3_000, "guid-fake-1"), msg("Yes!", NOW - 2_000, "guid-fake-2", true), msg("Great, I'll bring snacks", NOW - 1_000, "guid-fake-3")];
  bb.byChat.set(CHAT, texts);
  await engine.onMessage({ chat: CHAT, group: false, groupName: "", message: texts[2]! });
  now = NOW + SETTLE_MS;
  for (let i = 0; i < 10 && engine.pending(); i++) await engine.work();
  await engine.checkTapbacks();
  const view = readTextsView(engine.texts(), now)!;
  const item = view.items[0]!;
  return { bb, site, store, engine, view, item, now };
};

describe("tapbacks on the Mac (#888)", () => {
  it("gives their shown lines an opaque ref, never Nikita's own, and never the guid to the site", async () => {
    const { engine, item, view } = await owed();
    expect(view.tapbacks).toBe("on");
    const refs = item.messages!.map((m) => m.ref);
    expect(refs[0]).toMatch(/^[0-9a-f]{8}$/);
    expect(refs[1]).toBeUndefined();
    expect(refs[2]).toMatch(/^[0-9a-f]{8}$/);
    expect(refs[0]).not.toBe(refs[2]);
    expect(JSON.stringify(engine.texts())).not.toContain("guid-fake");
  });

  it("round trip: the signed tap goes through BlueBubbles' react route on that very message, and settles nothing", async () => {
    const { bb, site, store, engine, item, now } = await owed();
    const before = store.load().threads[0]!;
    site.waiting = [tapback("1".repeat(24), item.id, `love:${item.messages![2]!.ref}`, now)];
    await engine.act();
    expect(bb.reacted).toEqual([{ chat: CHAT, guid: "guid-fake-3", tapback: "love" }]);
    expect(site.reported).toEqual([{ rid: "1".repeat(24), result: "sent" }]);
    const after = store.load().threads[0]!;
    expect(after.state).toBe("owed");
    expect(after.draft).toEqual(before.draft);
    expect(after.sentHere).toBeUndefined();
    // An earlier line of theirs, by its own ref.
    site.waiting = [tapback("2".repeat(24), item.id, `question:${item.messages![0]!.ref}`, now)];
    await engine.act();
    expect(bb.reacted.at(-1)).toEqual({ chat: CHAT, guid: "guid-fake-1", tapback: "question" });
  });

  it("refuses a replay, a changed request, a ref it never gave and Nikita's own line", async () => {
    const { bb, site, engine, item, now } = await owed();
    const once = tapback("3".repeat(24), item.id, `like:${item.messages![2]!.ref}`, now);
    site.waiting = [once];
    await engine.act();
    site.waiting = [once];
    await engine.act();
    expect(bb.reacted).toHaveLength(1);
    expect(site.reported.at(-1)).toMatchObject({ rid: once.rid, result: "refused", reason: "replay" });
    site.waiting = [{ ...tapback("4".repeat(24), item.id, `like:${item.messages![2]!.ref}`, now), text: `dislike:${item.messages![2]!.ref}` }];
    await engine.act();
    expect(site.reported.at(-1)).toMatchObject({ result: "refused", reason: "signature" });
    site.waiting = [tapback("5".repeat(24), item.id, "laugh:0badc0de", now)];
    await engine.act();
    expect(site.reported.at(-1)).toMatchObject({ result: "refused", reason: "no-line" });
    site.waiting = [tapback("6".repeat(24), item.id, "laugh:zzzz", now)];
    await engine.act();
    expect(site.reported.at(-1)).toMatchObject({ result: "refused", reason: "unreadable" });
    site.waiting = [tapback("7".repeat(24), item.id, `laugh:${item.messages![0]!.ref}`, now + REQUEST_MS + 60_000)];
    await engine.act();
    expect(bb.reacted).toHaveLength(1);
  });

  it("with the Private API off: the list says so, and a tapback is refused without calling BlueBubbles", async () => {
    const { bb, site, engine, item, now } = await owed();
    bb.on = false;
    await engine.checkTapbacks();
    expect(readTextsView(engine.texts(), now)!.tapbacks).toBe("off");
    site.waiting = [tapback("8".repeat(24), item.id, `love:${item.messages![2]!.ref}`, now)];
    await engine.act();
    expect(bb.reacted).toEqual([]);
    expect(site.reported.at(-1)).toMatchObject({ result: "refused", reason: "tapbacks-off" });
    // A check that can't be read leaves the last answer standing.
    bb.on = null;
    await engine.checkTapbacks();
    expect(readTextsView(engine.texts(), now)!.tapbacks).toBe("off");
  });

  it("turns the Private API off when BlueBubbles' react route says it is, and reports other failures by reason", async () => {
    const { bb, site, engine, item, now } = await owed();
    bb.reactError = new BlueBubblesError("http", 500, "iMessage Private API Helper is not connected!");
    site.waiting = [tapback("9".repeat(24), item.id, `love:${item.messages![2]!.ref}`, now)];
    await engine.act();
    expect(site.reported.at(-1)).toMatchObject({ result: "refused", reason: "tapbacks-off" });
    expect(readTextsView(engine.texts(), now)!.tapbacks).toBe("off");
    bb.on = true;
    await engine.checkTapbacks();
    bb.reactError = new BlueBubblesError("timeout");
    site.waiting = [tapback("a".repeat(24), item.id, `love:${item.messages![2]!.ref}`, now)];
    await engine.act();
    expect(site.reported.at(-1)).toMatchObject({ result: "failed", reason: "bb-timeout" });
  });
});

describe("BlueBubbles' react route and server info (#888)", () => {
  const PW = "fake-bb-password";
  const calls: { url: string; body: unknown }[] = [];
  const fetcher = (answer: unknown, status = 200) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

  it("posts chatGuid, selectedMessageGuid and the reaction to /api/v1/message/react", async () => {
    calls.length = 0;
    await blueBubbles(PW, fetcher({ status: 200, data: {} }), "http://127.0.0.1:1234").react(CHAT, "guid-fake-3", "laugh");
    expect(calls[0]!.url).toMatch(/^http:\/\/127\.0\.0\.1:1234\/api\/v1\/message\/react\?password=/);
    expect(calls[0]!.body).toEqual({ chatGuid: CHAT, selectedMessageGuid: "guid-fake-3", reaction: "laugh", partIndex: 0 });
  });

  it("reads the Private API as on only with its helper connected", async () => {
    const bb = (data: unknown, status = 200) => blueBubbles(PW, fetcher({ status, data }, status), "http://127.0.0.1:1234");
    expect(await bb({ private_api: true, helper_connected: true }).privateApi()).toBe(true);
    expect(await bb({ private_api: true, helper_connected: false }).privateApi()).toBe(false);
    expect(await bb({ private_api: false, helper_connected: false }).privateApi()).toBe(false);
    expect(await bb(null, 500).privateApi()).toBeNull();
  });

  it("keeps a message's guid in memory for a tapback", () => {
    expect(readMessage({ guid: "guid-fake-9", text: "hi", isFromMe: false, dateCreated: NOW, handle: { address: A } })?.guid).toBe("guid-fake-9");
  });
});
