import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CAPS, readDraftInput, readSortInput, type DraftInput, type SortInput } from "../../../api/_relay/models.ts";
import type { RequestResult, TextRequest, TextsView } from "../../../api/_relay/texts.ts";
import { REQUEST_MS, signRequest } from "../../../api/_relay/tokens.ts";
import type { BlueBubbles, Contact, Message } from "./bluebubbles.ts";
import { readWebhook } from "./bluebubbles.ts";
import { DEFAULT_CONFIG, HOST } from "./config.ts";
import { DRAFT_KEEP_MS, Engine, SEEN_KEEP_MS, SETTLE_MS, THREAD_KEEP_MS } from "./engine.ts";
import { line, memoryLogger } from "./log.ts";
import { Placeholders } from "./placeholders.ts";
import { settleByRule } from "./rules.ts";
import { handler, listen } from "./server.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";

/**
 * The Mac hub (#535, docs/RELAY-PRIVACY.md): placeholders, rules, the only send path (`act`), the logs, the local
 * server, the sweep. Every name, number and text here is made up (555 numbers, example.com).
 */

const NOW = Date.parse("2026-10-28T15:00:00Z");
const KEY = Buffer.alloc(32, 7);
const CHAT = "iMessage;-;+15555550123";
const HANDLE = "+15555550123";
const CONTACT: Contact = { names: ["Riley Test"], handles: [HANDLE] };
const UTC = () => 0;

class FakeBB implements BlueBubbles {
  sent: { chat: string; text: string }[] = [];
  history: Message[] = [];
  async ping() {
    return true;
  }
  async contacts() {
    return [CONTACT, { names: ["Jordan Sample"], handles: ["+15555550199"] }];
  }
  async messages() {
    return [...this.history].reverse();
  }
  async send(chat: string, text: string) {
    this.sent.push({ chat, text });
    return true;
  }
}

class FakeSite implements Site {
  sorts: SortInput[] = [];
  drafts: DraftInput[] = [];
  views: TextsView[] = [];
  waiting: unknown[] = [];
  reported: { rid: string; result: RequestResult }[] = [];
  sortAnswer: unknown = { needsReply: true, sort: "sooner", gist: "Contact asks if Person 1 can come" };
  draftAnswer: unknown = { draft: "Yes, Contact, see you at [code]" };
  async status() {
    return true;
  }
  async texts(v: TextsView) {
    this.views.push(v);
    return true;
  }
  async sort(input: SortInput) {
    this.sorts.push(input);
    return { answer: this.sortAnswer as never };
  }
  async draft(input: DraftInput) {
    this.drafts.push(input);
    return { answer: this.draftAnswer as never };
  }
  async requests() {
    const out = this.waiting;
    this.waiting = [];
    return out;
  }
  async results(r: { rid: string; result: RequestResult }[]) {
    this.reported.push(...r);
    return true;
  }
  async skipTerms() {
    return ["Private Person"];
  }
  async unpair() {
    return true;
  }
}

const setup = () => {
  let now = NOW;
  const bb = new FakeBB();
  const site = new FakeSite();
  const log = memoryLogger(() => now);
  const store = memoryStore();
  const engine = new Engine({ store, bb, site, log, config: DEFAULT_CONFIG, sendKey: KEY, now: () => now, offsetAt: UTC });
  return { bb, site, log, store, engine, at: (t: number) => (now = t), now: () => now };
};

const text = (t: string, at: number, fromMe = false): Message => ({ text: t, fromMe, at, handle: fromMe ? "" : HANDLE });

/** A thread owed with a draft ready, as after a real round of work. */
const owedWithDraft = async () => {
  const h = setup();
  await h.engine.refreshSkipTerms(true);
  h.bb.history = [text("Running late, call me", NOW - 120_000, true), text("Riley here. Can Jordan Sample come Saturday? My number is +1 555 555 0177", NOW - 60_000)];
  await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history[1]! });
  h.at(NOW + SETTLE_MS + 1);
  await h.engine.work();
  const t = h.store.load().threads[0]!;
  return { ...h, thread: t };
};

const req = (over: Partial<TextRequest> & Pick<TextRequest, "thread">, key = KEY, now = NOW + SETTLE_MS + 1): TextRequest => {
  const f = { rid: "a".repeat(24), kind: "send" as const, draftAt: 0, text: "On my way", until: now + REQUEST_MS, ...over };
  const sig = signRequest(key, { rid: f.rid, kind: f.kind, thread: f.thread, draftAt: f.draftAt, text: f.text, until: f.until });
  return { created: now, sig, ...f, ...("sig" in over ? { sig: over.sig! } : {}) };
};

describe("placeholders", () => {
  it("swap the contact, other contacts and every number before a model call, and put names back after", () => {
    const ph = new Placeholders({ contact: { names: ["Riley Test"], handle: HANDLE }, others: ["Jordan Sample", "Jordan"] });
    const out = ph.swap("Riley Test here, is Jordan Sample free? Call +1 (555) 555-0177 or mail riley@example.com, code 482913");
    expect(out).not.toMatch(/Riley|Jordan|555|example\.com|482913/);
    expect(out).toContain("Contact");
    expect(out).toContain("Person 1");
    expect(out).toContain("[email]");
    expect(ph.restore("Hi Contact, ask Person 1")).toBe("Hi Riley, ask Jordan Sample");
  });
});

describe("rules settle on the Mac", () => {
  it("one-time codes, short codes, promos, money and the skip list never reach a model", () => {
    expect(settleByRule({ handle: "+15555550123", names: [], text: "Your verification code is 482913" }, [])).toBe("code");
    expect(settleByRule({ handle: "72345", names: [], text: "Alert" }, [])).toBe("short-code");
    expect(settleByRule({ handle: "+15555550123", names: [], text: "20% off today, reply STOP to opt out" }, [])).toBe("promo");
    expect(settleByRule({ handle: "+15555550123", names: ["Private Person"], text: "hey" }, ["private person"])).toBe("skip");
    expect(settleByRule({ handle: "+15555550123", names: [], text: "The court date for the settlement moved to Friday" }, [])).toBe("money");
    expect(settleByRule({ handle: "+15555550123", names: ["Riley Test"], text: "Dinner Saturday?" }, [])).toBeNull();
  });
});

describe("the engine", () => {
  it("sends only placeholdered, trimmed snippets to the site", async () => {
    const h = await owedWithDraft();
    const sent = JSON.stringify([h.site.sorts, h.site.drafts]);
    expect(sent).not.toMatch(/Riley|Jordan|555|\+1/);
    expect(h.site.sorts[0]!.lines.every((l) => l.from === "them" || l.from === "me")).toBe(true);
    // The draft has names back, for the Desk only; numbers stay as placeholders.
    expect(h.thread.draft?.text).toBe("Yes, Riley, see you at [code]");
    expect(h.thread.gist).toBe("Riley asks if Jordan Sample can come");
  });

  it("settles a skip-list contact before any model sees it", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [text("hello", NOW)];
    await h.engine.onMessage({ chat: "iMessage;-;+15555550111", group: false, groupName: "", message: { text: "Private Person here", fromMe: false, at: NOW, handle: "+15555550111" } });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.site.sorts).toEqual([]);
  });

  it("refuses a hostile model answer", async () => {
    const h = setup();
    h.site.sortAnswer = { needsReply: true, sort: "sooner", gist: "ok", send: "now" };
    h.bb.history = [text("Saturday?", NOW)];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history[0]! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.store.load().threads[0]!.draft).toBeNull();
    expect(h.bb.sent).toEqual([]);
  });

  it("never sends on its own: no request, no send", async () => {
    const h = await owedWithDraft();
    await h.engine.act();
    await h.engine.report(true);
    expect(h.bb.sent).toEqual([]);
  });

  it("sends a good request once, then refuses the replay", async () => {
    const h = await owedWithDraft();
    const r = req({ thread: h.thread.id, draftAt: h.thread.draft!.at });
    h.site.waiting = [r];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: CHAT, text: "On my way" }]);
    expect(h.site.reported).toEqual([{ rid: r.rid, result: "sent" }]);
    h.site.waiting = [r];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);
    expect(h.site.reported[1]).toEqual({ rid: r.rid, result: "refused" });
  });

  it("refuses an expired, tampered, foreign-key, draft-changed or group request", async () => {
    const h = await owedWithDraft();
    const at = h.thread.draft!.at;
    const id = h.thread.id;
    const good = req({ thread: id, draftAt: at });
    h.site.waiting = [
      req({ rid: "b".repeat(24), thread: id, draftAt: at, until: h.now() - 1 }),
      { ...req({ rid: "c".repeat(24), thread: id, draftAt: at }), text: "Send money to [account]" },
      req({ rid: "d".repeat(24), thread: id, draftAt: at }, Buffer.alloc(32, 9)),
      req({ rid: "e".repeat(24), thread: id, draftAt: at - 1 }),
      req({ rid: "f".repeat(24), thread: "0123456789abcdef", draftAt: at }),
    ];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    expect(h.site.reported.map((r) => r.result)).toEqual(["refused", "refused", "refused", "refused", "refused"]);
    // The good one still works: nothing above spent it.
    h.site.waiting = [good];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);
  });

  it("refuses everything while paused", async () => {
    const h = await owedWithDraft();
    h.engine.pause();
    h.site.waiting = [req({ thread: h.thread.id, draftAt: h.thread.draft!.at })];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
  });

  it("puts names, gists and drafts in the list, never a message body", async () => {
    const h = await owedWithDraft();
    await h.engine.report(true);
    const v = h.site.views.at(-1)!;
    expect(v.items[0]!.name).toBe("Riley Test");
    expect(JSON.stringify(v)).not.toMatch(/Can Jordan Sample come|555|iMessage;-;/);
  });

  it("logs only kinds and numbers over a whole day", async () => {
    const h = await owedWithDraft();
    h.site.waiting = [req({ thread: h.thread.id, draftAt: h.thread.draft!.at })];
    await h.engine.act();
    await h.engine.report(true);
    h.engine.sweep();
    const all = h.log.lines.join("\n");
    expect(all).not.toMatch(/Riley|Jordan|555|Saturday|On my way|iMessage|[0-9a-f]{16}/);
    for (const l of h.log.lines) for (const [k, v] of Object.entries(JSON.parse(l) as Record<string, unknown>)) if (k !== "at" && k !== "kind" && k !== "error") expect(typeof v).toBe("number");
    expect(line(NOW, "sent", { name: "Riley" as never })).toBe(JSON.stringify({ at: new Date(NOW).toISOString(), kind: "sent" }));
    expect(line(NOW, "anything" as never)).toBeNull();
  });

  it("sweeps drafts, old threads and seen ids by their deadlines", async () => {
    const h = await owedWithDraft();
    h.site.waiting = [req({ thread: h.thread.id, draftAt: h.thread.draft!.at })];
    await h.engine.act();
    expect(h.store.load().seen).toHaveLength(1);
    h.at(NOW + Math.max(SEEN_KEEP_MS, DRAFT_KEEP_MS, THREAD_KEEP_MS) + 60_000);
    h.engine.sweep();
    const s = h.store.load();
    expect(s.seen).toEqual([]);
    expect(s.threads).toEqual([]);
  });
});

describe("the rules reach every model call (#541 review)", () => {
  const GROUP = "iMessage;+;chat000000000000000001";
  const inGroup = (text: string, handle: string, at: number) => ({ chat: GROUP, group: true, groupName: "Test group", message: { text, fromMe: false, at, handle } });

  it("a group with a money or legal text gets no call", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [{ text: "Who's driving Sunday?", fromMe: false, at: NOW - 2_000, handle: HANDLE }, { text: "The court date for the settlement moved", fromMe: false, at: NOW - 1_000, handle: "+15555550199" }];
    await h.engine.onMessage(inGroup(h.bb.history[1]!.text, "+15555550199", NOW - 1_000));
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.site.sorts).toEqual([]);
  });

  it("a group with a skip-listed member gets no call", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.contacts = async () => [CONTACT, { names: ["Private Person"], handles: ["+15555550111"] }];
    h.bb.history = [{ text: "See you all Sunday", fromMe: false, at: NOW - 1_000, handle: "+15555550111" }];
    await h.engine.onMessage(inGroup("See you all Sunday", "+15555550111", NOW - 1_000));
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.site.sorts).toEqual([]);
  });

  it("an owed thread that then gets a money text is settled, with no call and no draft", async () => {
    const h = await owedWithDraft();
    const calls = h.site.sorts.length + h.site.drafts.length;
    const money = text("Also the court settlement papers came", h.now() + 1_000);
    h.bb.history.push(money);
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: money });
    h.at(h.now() + SETTLE_MS + 2_000);
    await h.engine.work();
    const t = h.store.load().threads[0]!;
    expect(t.state).toBe("settled");
    expect(t.draft).toBeNull();
    expect(h.site.sorts.length + h.site.drafts.length).toBe(calls);
  });

  it("a long thread is trimmed on the Mac to what the site accepts", async () => {
    const h = setup();
    h.bb.history = [text("ok", NOW - 100 * 60_000, true), ...Array.from({ length: 40 }, (_, i) => text(`Message ${i} `.repeat(30), NOW - (40 - i) * 60_000))];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history.at(-1)! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    const sort = h.site.sorts[0]!;
    const draft = h.site.drafts[0]!;
    expect(sort.lines.length).toBeLessThanOrEqual(CAPS.sortMessages);
    expect(sort.lines.reduce((a, l) => a + l.text.length, 0)).toBeLessThanOrEqual(CAPS.sortChars);
    expect(draft.lines.length).toBeLessThanOrEqual(CAPS.draftEarlier + CAPS.sortMessages);
    expect(draft.lines.reduce((a, l) => a + l.text.length, 0)).toBeLessThanOrEqual(CAPS.draftChars);
    expect(readSortInput(JSON.parse(JSON.stringify(sort)))).not.toBeNull();
    expect(readDraftInput(JSON.parse(JSON.stringify(draft)))).not.toBeNull();
    expect(h.store.load().threads[0]!.draft).not.toBeNull();
  });

  it("a busy group is trimmed too", async () => {
    const h = setup();
    const GROUPCHAT = "iMessage;+;chat000000000000000002";
    h.bb.history = Array.from({ length: 60 }, (_, i) => ({ text: `Plan ${i} `.repeat(20), fromMe: false, at: NOW - (60 - i) * 60_000, handle: i % 2 ? HANDLE : "+15555550199" }));
    h.site.sortAnswer = { summary: "Planning a trip.", asked: false };
    await h.engine.onMessage({ chat: GROUPCHAT, group: true, groupName: "Test group", message: h.bb.history.at(-1)! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    const sort = h.site.sorts[0]!;
    expect(sort.lines.length).toBeLessThanOrEqual(CAPS.groupMessages);
    expect(readSortInput(JSON.parse(JSON.stringify(sort)))).not.toBeNull();
  });

  it("after a send that timed out but went, a resend is refused", async () => {
    const h = await owedWithDraft();
    h.bb.send = async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    };
    const first = req({ thread: h.thread.id, draftAt: h.thread.draft!.at });
    h.site.waiting = [first];
    await h.engine.act();
    expect(h.site.reported.at(-1)!.result).toBe("failed");
    // It did go: Messages shows Nikita's reply, newer than the last message in.
    h.bb.history.push(text("On my way", h.now() + 500, true));
    h.bb.send = async (chat, body) => {
      h.bb.sent.push({ chat, text: body });
      return true;
    };
    h.site.waiting = [req({ rid: "9".repeat(24), thread: h.thread.id, draftAt: h.thread.draft!.at })];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    expect(h.site.reported.at(-1)!.result).toBe("refused");
    expect(h.store.load().threads[0]!.state).toBe("replied");
  });
});

describe("the local server", () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  const call = (port: number, path: string, headers: Record<string, string> = {}, body = "{}") =>
    new Promise<number>((resolve) => {
      const r = httpRequest({ host: HOST, port, path, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      r.end(body);
    });

  it("binds 127.0.0.1 only and refuses a missing key or any Origin", async () => {
    const got: unknown[] = [];
    const log = memoryLogger();
    server = await listen({ localKey: "local-test-key", log, onMessage: async (m) => void got.push(m), control: async () => undefined }, 0);
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    expect(await call(addr.port, "/bluebubbles")).toBe(401);
    expect(await call(addr.port, "/bluebubbles?k=wrong")).toBe(401);
    expect(await call(addr.port, "/bluebubbles?k=local-test-key", { origin: "https://example.com" })).toBe(401);
    expect(await call(addr.port, "/send?k=local-test-key")).toBe(404);
    const hook = JSON.stringify({ type: "new-message", data: { text: "hi", isFromMe: false, dateCreated: NOW, handle: { address: HANDLE }, chats: [{ guid: CHAT }] } });
    expect(await call(addr.port, "/bluebubbles?k=local-test-key", {}, hook)).toBe(204);
    expect(got.length).toBe(readWebhook(JSON.parse(hook)) ? 1 : 0);
    expect(typeof handler).toBe("function");
  });
});
