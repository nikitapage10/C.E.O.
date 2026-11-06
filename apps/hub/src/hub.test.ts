import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CAPS, readComposeInput, readDraftInput, readSortInput, type ComposeInput, type DraftInput, type SortInput } from "../../../api/_relay/models.ts";
import { CARD_KEEP_MS, OWED_WINDOW_MS, readTextsView, type Reason, type RequestResult, type TextRequest, type TextsView } from "../../../api/_relay/texts.ts";
import { mintPairing, REQUEST_MS, signRequest } from "../../../api/_relay/tokens.ts";
import type { BlueBubbles, ChatInfo, Contact, ContactPhoto, Message, Polled } from "./bluebubbles.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { BlueBubblesError, contactHandles, readContact, readPolled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG, HOST } from "./config.ts";
import { CATCH_UP_MS, DRAFT_KEEP_MS, Engine, POLL_OVERLAP_MS, SEEN_KEEP_MS, SETTLE_MS, THREAD_KEEP_MS, chatHandle } from "./engine.ts";
import { line, memoryLogger } from "./log.ts";
import { Placeholders } from "./placeholders.ts";
import { settleByRule } from "./rules.ts";
import { handler, listen } from "./server.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";
import { createHash } from "node:crypto";
import { MemoryAuthStore } from "../../../api/_desk/store.ts";
import { photoEmailKey, readPhotoIndex } from "../../../api/_relay/photos.ts";
import { GET as routeGET, POST as routePOST, type RelayRouteDeps } from "../../../api/_relay/route.ts";
import { MemoryRelayStore } from "../../../api/_relay/store.ts";
import { decide } from "../../../api/_site/gate.ts";
import { siteKeys, stateOf } from "../../../api/_site/state.ts";
import { photoSyncLine, statusOf } from "./photos.ts";
import { siteClient } from "./site.ts";

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
  people: Contact[] = [CONTACT, { names: ["Jordan Sample"], handles: ["+15555550199"] }];
  async ping() {
    return true;
  }
  async contacts() {
    return this.people;
  }
  async messages() {
    return [...this.history].reverse();
  }
  async send(chat: string, text: string) {
    this.sent.push({ chat, text });
    return true;
  }
  /** Messages' one-to-one chats (#536). */
  known: string[] = [CHAT];
  async chats() {
    return this.known;
  }
  /** Contact pictures (#642): made-up bytes. */
  pictures: ContactPhoto[] = [];
  async react(): Promise<boolean> {
    return true;
  }
  async privateApi(): Promise<boolean | null> {
    return true;
  }
  async contactPhotos() {
    return this.pictures;
  }
  /** What BlueBubbles' message query holds (#749), and each `after` asked for. */
  inbox: Polled[] = [];
  asked: number[] = [];
  failPoll = false;
  async since(after: number, limit: number) {
    this.asked.push(after);
    if (this.failPoll) throw Object.assign(new Error("bluebubbles"), { name: "TimeoutError" });
    return this.inbox.filter((p) => p.at >= after).sort((a, b) => a.at - b.at).slice(0, limit);
  }
  /** Every chat with its last message (#758). */
  chatsList: ChatInfo[] = [];
  async chatList(offset: number, limit: number) {
    return this.chatsList.slice(offset, offset + limit);
  }
}

class FakeSite implements Site {
  sorts: SortInput[] = [];
  drafts: DraftInput[] = [];
  views: TextsView[] = [];
  waiting: unknown[] = [];
  reported: { rid: string; result: RequestResult; reason?: Reason }[] = [];
  composes: ComposeInput[] = [];
  sortAnswer: unknown = { needsReply: true, sort: "sooner", gist: "Contact asks if Person 1 can come" };
  draftAnswer: unknown = { draft: "Yes, Contact, see you at [code]" };
  composeAnswer: unknown = { draft: "Running 10 late Contact, Person 1 too" };
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
  async compose(input: ComposeInput) {
    this.composes.push(input);
    return { answer: this.composeAnswer as never };
  }
  learns: LearnInput[] = [];
  learnAnswer: unknown = null;
  async learn(input: LearnInput) {
    this.learns.push(input);
    return { answer: this.learnAnswer, usd: 0.04 };
  }
  async requests() {
    const out = this.waiting;
    this.waiting = [];
    return out;
  }
  async results(r: { rid: string; result: RequestResult; reason?: Reason }[]) {
    this.reported.push(...r);
    return true;
  }
  async skipTerms() {
    return ["Private Person"];
  }
  async unpair() {
    return true;
  }
  photoKeyValue: Buffer | null = Buffer.alloc(32, 7);
  uploaded: { id: string; png: Uint8Array }[] = [];
  lists: { keep: string[]; emails: [string, string][] }[] = [];
  async photoKey() {
    return this.photoKeyValue;
  }
  async photo(id: string, png: Uint8Array) {
    this.uploaded.push({ id, png });
    return true;
  }
  async photos(keep: string[], emails: [string, string][]) {
    this.lists.push({ keep, emails });
    return keep;
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

/** A thread owed with a draft ready, as after a real round of work and Nikita's "Write for me" (#923). */
const owedWithDraft = async () => {
  const h = setup();
  await h.engine.refreshSkipTerms(true);
  h.bb.history = [text("Running late, call me", NOW - 120_000, true), text("Riley here. Can Jordan Sample come Saturday? My number is +1 555 555 0177", NOW - 60_000)];
  await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history[1]! });
  h.at(NOW + SETTLE_MS + 1);
  await h.engine.work();
  await askDraft(h, h.store.load().threads[0]!.id);
  const t = h.store.load().threads[0]!;
  return { ...h, thread: t };
};

/** Nikita's "Write for me" (#923): a signed "draft" request, taken, then the round of work that drafts. */
const askDraft = async (h: ReturnType<typeof setup>, thread: string, rid = "e".repeat(24)) => {
  h.site.waiting = [req({ rid, kind: "draft", thread, draftAt: 0, text: "" }, KEY, h.now())];
  await h.engine.act();
  h.site.reported.length = 0;
  await h.engine.work();
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
    // #950 audit: everyday texts between people are no longer money by the email line's subject words.
    for (const text of ["I paid for the tickets, we're square", "rent's done, thanks for the transfer", "meet at the basketball court at 6", "did your order come yet", "my balance on the beam was terrible lol"]) expect(settleByRule({ handle: "+15555550123", names: ["Riley Test"], text }, []), text).toBeNull();
    for (const text of ["Your rent payment of $1,450 is past due", "I owe you $20 for pizza", "Your card ending 4321 was charged", "my lawyer says the contract is fine"]) expect(settleByRule({ handle: "+15555550123", names: ["Riley Test"], text }, []), text).toBe("money");
    // A bank's address is money whatever it says.
    expect(settleByRule({ handle: "alerts@chase.com", names: [], text: "hello" }, [])).toBe("money");
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
    expect(h.site.reported[1]).toEqual({ rid: r.rid, result: "refused", reason: "replay" });
  });

  it("refuses an expired, tampered, foreign-key or unknown-thread request, and says why", async () => {
    const h = await owedWithDraft();
    const at = h.thread.draft!.at;
    const id = h.thread.id;
    const good = req({ thread: id, draftAt: at });
    h.site.waiting = [
      req({ rid: "b".repeat(24), thread: id, draftAt: at, until: h.now() - 1 }),
      { ...req({ rid: "c".repeat(24), thread: id, draftAt: at }), text: "Send money to [account]" },
      req({ rid: "d".repeat(24), thread: id, draftAt: at }, Buffer.alloc(32, 9)),
      req({ rid: "f".repeat(24), thread: "0123456789abcdef", draftAt: at }),
    ];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    expect(h.site.reported.map((r) => r.result)).toEqual(["refused", "refused", "refused", "refused"]);
    expect(h.site.reported.map((r) => r.reason)).toEqual(["expired", "signature", "signature", "gone"]);
    // The good one still works: nothing above spent it.
    h.site.waiting = [good];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);
  });

  it("sends the reply Nikita typed while Blasto's draft landed (#767): no spurious refusal", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [text("Running late, call me", NOW - 120_000, true), text("Can you come Saturday?", NOW - 60_000)];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history[1]! });
    const id = h.store.load().threads[0]!.id;
    // The Desk showed no draft yet ("write your own"), so the request carries draftAt 0; then Blasto's draft lands.
    const mine = req({ thread: id, draftAt: 0, text: "Yes, see you then" }, KEY, NOW);
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    await askDraft(h, id);
    expect(h.store.load().threads[0]!.draft).not.toBeNull();
    h.site.waiting = [mine];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: CHAT, text: "Yes, see you then" }]);
    expect(h.site.reported).toEqual([{ rid: mine.rid, result: "sent" }]);
  });

  it("sends the text on screen when Blasto redrafted with nothing new in, and refuses with a reason when they wrote again", async () => {
    const h = await owedWithDraft();
    const seen = h.thread.draft!.at;
    // A restyle replaced the draft after the Desk loaded it: the text Nikita saw still goes.
    h.store.save({ ...h.store.load(), threads: h.store.load().threads.map((t) => ({ ...t, draft: { ...t.draft!, at: seen + 5_000 } })) });
    h.site.waiting = [req({ thread: h.thread.id, draftAt: seen, text: "On my way" })];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);

    const g = await owedWithDraft();
    const shown = g.thread.draft!.at;
    g.at(shown + 30_000);
    g.bb.history.push(text("Actually make it Sunday", shown + 30_000));
    await g.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: g.bb.history.at(-1)! });
    g.site.waiting = [req({ thread: g.thread.id, draftAt: shown }, KEY, shown + 31_000)];
    await g.engine.act();
    expect(g.bb.sent).toEqual([]);
    expect(g.site.reported).toEqual([{ rid: "a".repeat(24), result: "refused", reason: "new-message" }]);
  });

  it("says why BlueBubbles didn't send: macOS kept it from controlling Messages (#767)", async () => {
    const h = await owedWithDraft();
    h.bb.send = async () => {
      throw new BlueBubblesError("http", 500, "execution error: Not authorized to send Apple events to Messages. (-1743)");
    };
    h.site.waiting = [req({ thread: h.thread.id, draftAt: h.thread.draft!.at })];
    await h.engine.act();
    expect(h.site.reported).toEqual([{ rid: "a".repeat(24), result: "failed", reason: "mac-permission" }]);
    expect(h.log.lines.some((l) => l.includes('"kind":"mac permission"'))).toBe(true);
    // The thread stays owed with its draft, for Resend once it's allowed.
    expect(h.store.load().threads[0]!.state).toBe("owed");
    expect(h.log.lines.join("\n")).not.toMatch(/Apple events|On my way/);
  });

  it("answers every request it took: one it can't read, or one that throws, never sits as Sending… (#767)", async () => {
    const h = await owedWithDraft();
    const good = req({ rid: "b".repeat(24), thread: h.thread.id, draftAt: h.thread.draft!.at });
    h.site.waiting = [{ rid: "c".repeat(24), kind: "send", future: true }, good];
    const store = h.store;
    const save = store.save.bind(store);
    let n = 0;
    store.save = (s) => {
      // Recording the request as seen fails, as a full disk would: an error mid-request.
      if (++n === 1) throw Object.assign(new Error("disk"), { name: "StoreError" });
      save(s);
    };
    await h.engine.act();
    expect(h.site.reported).toEqual([
      { rid: "c".repeat(24), result: "refused", reason: "unreadable" },
      { rid: "b".repeat(24), result: "failed", reason: "hub-error" },
    ]);
  });

  it("refuses everything while paused", async () => {
    const h = await owedWithDraft();
    h.engine.pause();
    h.site.waiting = [req({ thread: h.thread.id, draftAt: h.thread.draft!.at })];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
  });

  it("puts names, gists and drafts in the list, and the real text only in the item's last messages (#758)", async () => {
    const h = await owedWithDraft();
    await h.engine.report(true);
    const v = h.site.views.at(-1)!;
    expect(v.items[0]!.name).toBe("Riley Test");
    // The Desk shows the real words (sealed, passkey-only): the recent turns, Nikita's own marked `me` (#870), never a chat id.
    expect(v.items[0]!.messages?.map((m) => m.text)).toEqual(["Running late, call me", "Riley here. Can Jordan Sample come Saturday? My number is +1 555 555 0177"]);
    expect(v.items[0]!.messages?.map((m) => m.me === true)).toEqual([true, false]);
    expect(v.items[0]!.messages?.[1]?.from).toBeUndefined();
    const rest = JSON.stringify({ ...v, items: v.items.map(({ messages: _m, ...i }) => i) });
    // The phone number as written, not a bare "555": ids and timestamps in the view can contain those digits by chance.
    expect(rest).not.toMatch(/Can Jordan Sample come|555 555 0177|Running late|iMessage;-;/);
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
    // The send and the "Write for me" before it (#923).
    expect(h.store.load().seen).toHaveLength(2);
    h.at(NOW + Math.max(SEEN_KEEP_MS, DRAFT_KEEP_MS, THREAD_KEEP_MS, OWED_WINDOW_MS) + 60_000);
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

  it("a money text before Nikita's reply keeps the thread from the model when a harmless text follows", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [
      text("The court date for the settlement moved", NOW - 180_000),
      text("Thanks, noted", NOW - 120_000, true),
      text("See you Saturday?", NOW - 60_000),
    ];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history[2]! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.site.sorts).toEqual([]);
    expect(h.site.drafts).toEqual([]);
    expect(JSON.stringify(h.site.drafts)).not.toContain("settlement");
    const t = h.store.load().threads[0]!;
    expect(t.state).toBe("settled");
    expect(t.draft).toBeNull();
  });

  it("an old reply of Nikita's that trips a rule is left out of the style examples, and drafting goes on", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [
      text("Sent the settlement papers to court", NOW - 60 * 60_000, true),
      ...Array.from({ length: 6 }, (_, i) => text(`Sounds good ${i}`, NOW - (50 - i) * 60_000, i % 2 === 0)),
      text("Lunch tomorrow?", NOW - 60_000),
    ];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history.at(-1)! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    await askDraft(h, h.store.load().threads[0]!.id);
    expect(h.site.drafts.length).toBe(1);
    expect(JSON.stringify(h.site.drafts[0])).not.toContain("settlement");
    expect(JSON.stringify(h.site.sorts)).not.toContain("settlement");
  });

  it("a long thread is trimmed on the Mac to what the site accepts", async () => {
    const h = setup();
    h.bb.history = [text("ok", NOW - 100 * 60_000, true), ...Array.from({ length: 40 }, (_, i) => text(`Message ${i} `.repeat(30), NOW - (40 - i) * 60_000))];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history.at(-1)! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    await askDraft(h, h.store.load().threads[0]!.id);
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

  it("a listed group takes Nikita's own typed words (#805), never a draft-bound send, and never once a rule cleared it", async () => {
    const h = setup();
    const GROUPCHAT = "iMessage;+;chat000000000000000003";
    h.bb.history = [{ text: "Who's in for Sunday?", fromMe: false, at: NOW - 60_000, handle: HANDLE }];
    h.site.sortAnswer = { summary: "Member 1 asks who is in for Sunday.", asked: false };
    await h.engine.onMessage({ chat: GROUPCHAT, group: true, groupName: "Test group", message: h.bb.history[0]! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    const g = h.store.load().threads[0]!;
    // Unread in Messages, it waits (#950), held as a group's set-aside until it is read.
    expect(g).toMatchObject({ group: true, state: "owed", held: "group" });
    expect(g.summary).not.toBeNull();
    // Bound to a draft: refused (a group never has one).
    h.site.waiting = [req({ rid: "1".repeat(24), thread: g.id, draftAt: NOW })];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    expect(h.site.reported.at(-1)).toEqual({ rid: "1".repeat(24), result: "refused", reason: "not-owed" });
    // A newer text in the group doesn't stop typed words; they go exactly as typed, once.
    const busy = { text: "Bringing snacks", fromMe: false, at: h.now() + 500, handle: "+15555550199" };
    h.bb.history.push(busy);
    await h.engine.onMessage({ chat: GROUPCHAT, group: true, groupName: "Test group", message: busy });
    h.at(h.now() + 1_000);
    h.site.waiting = [req({ rid: "2".repeat(24), thread: g.id, text: "Count me in 🙌" }, KEY, h.now())];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: GROUPCHAT, text: "Count me in 🙌" }]);
    expect(h.site.reported.at(-1)).toEqual({ rid: "2".repeat(24), result: "sent" });
    // Multi-send (#870): the group stays on the Desk after a send, even once Messages shows the reply, and takes
    // another; the same request id never acts twice.
    await h.engine.onMessage({ chat: GROUPCHAT, group: true, groupName: "Test group", message: { text: "Count me in 🙌", fromMe: true, at: h.now() + 10, handle: "" } });
    expect(h.store.load().threads[0]!.summary).not.toBeNull();
    const again = req({ rid: "3".repeat(24), thread: g.id, text: "Again" }, KEY, h.now());
    h.site.waiting = [again];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(2);
    h.site.waiting = [again];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(2);
    expect(h.site.reported.at(-1)).toEqual({ rid: "3".repeat(24), result: "refused", reason: "replay" });
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
    expect(h.site.reported.at(-1)).toMatchObject({ result: "refused", reason: "answered" });
    // A different text to the same thread still goes (#870, multi-send).
    h.site.waiting = [req({ rid: "8".repeat(24), thread: h.thread.id, text: "Actually, 10 min late" })];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: CHAT, text: "Actually, 10 min late" }]);
  });
});

describe("texts Skippy asks for (#536)", () => {
  const CARD = "aaaabbbbccccdddd";
  const ask = (who: string, gist: string, rid = "1".repeat(24), thread = CARD): TextRequest => {
    const f = { rid, kind: "compose" as const, thread, draftAt: 0, text: gist, who, until: NOW + REQUEST_MS };
    return { ...f, created: NOW, sig: signRequest(KEY, f) };
  };
  const composed = async (who = "Riley", gist = "running 10 min late, Jordan Sample too") => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [text("Where are you?", NOW - 3_600_000), text("omw Riley!", NOW - 3_500_000, true), text("see you soon", NOW - 600_000, true)];
    h.site.waiting = [ask(who, gist)];
    await h.engine.act();
    await h.engine.report(true);
    return { ...h, card: h.store.load().cards.find((c) => c.id === CARD), listed: h.site.views.at(-1)! };
  };

  it("finds the contact on the Mac and has Blasto write it from the placeholdered ask and Nikita's own texts only", async () => {
    const h = await composed();
    expect(h.site.composes).toHaveLength(1);
    const sent = JSON.stringify(h.site.composes);
    expect(sent).not.toMatch(/Riley|Jordan|555|\+1|Where are you/);
    expect(h.site.composes[0]!.examples).toEqual(["omw Contact!", "see you soon"]);
    expect(readComposeInput(JSON.parse(sent)[0])).not.toBeNull();
    expect(h.card).toMatchObject({ state: "ready", name: "Riley Test", draft: { text: "Running 10 late Riley, Jordan Sample too" } });
    expect(h.site.reported).toEqual([{ rid: "1".repeat(24), result: "done" }]);
    // Nothing sends on a compose.
    expect(h.bb.sent).toEqual([]);
  });

  it("puts the card in the list with the name, the last 4 digits and the text, never the number or chat id", async () => {
    const h = await composed();
    expect(readTextsView(h.listed, NOW)).not.toBeNull();
    expect(h.listed.cards).toEqual([{ id: CARD, state: "ready", name: "Riley Test", mask: "ending 0123", channel: "iMessage", draft: { text: "Running 10 late Riley, Jordan Sample too", at: NOW }, choices: [], at: NOW }]);
    expect(JSON.stringify(h.listed)).not.toMatch(/555555|\+1555|iMessage;-;/);
  });

  it("shows the choices when the name fits several, never a guess, and drafts for the one picked", async () => {
    const h = setup();
    h.bb.people = [CONTACT, { names: ["Riley Sample"], handles: ["+15555550188", "riley.s@example.com"] }];
    h.site.waiting = [ask("Riley", "running late")];
    await h.engine.act();
    await h.engine.report(true);
    expect(h.site.composes).toEqual([]);
    const c = h.site.views.at(-1)!.cards![0]!;
    expect(c.state).toBe("choices");
    expect(c.choices.map((x) => `${x.name} ${x.mask}`)).toEqual(["Riley Test ending 0123", "Riley Sample ending 0188", "Riley Sample r•••@e•••.com"]);
    expect(JSON.stringify(c)).not.toMatch(/example\.com|\+1555/);
    h.site.waiting = [ask(`pick:${c.choices[1]!.pick}`, "running late", "2".repeat(24))];
    await h.engine.act();
    const card = h.store.load().cards[0]!;
    expect(card).toMatchObject({ state: "ready", name: "Riley Sample" });
    expect(card.target!.chat).toBe("iMessage;-;+15555550188");
    // A pick that isn't one of this card's choices does nothing.
    h.site.waiting = [ask("pick:0000ffff", "running late", "3".repeat(24))];
    await h.engine.act();
    expect(h.site.reported.at(-1)!.result).toBe("refused");
  });

  it("says so when no contact has that name, with no model call", async () => {
    const h = await composed("Nobody Known", "hi");
    expect(h.card).toMatchObject({ state: "none", name: "Nobody Known", target: null });
    expect(h.site.composes).toEqual([]);
  });

  it("keeps money, legal, codes and the skip list from the model, and leaves rule-tripping past texts out of the examples", async () => {
    for (const gist of ["can you cover the rent invoice", "the lawsuit settlement is signed", "the code is 482913"]) {
      const h = await composed("Riley", gist);
      expect(h.card?.state, gist).toBe("off");
      expect(h.site.composes, gist).toEqual([]);
    }
    const skip = setup();
    await skip.engine.refreshSkipTerms(true);
    skip.bb.people = [CONTACT, { names: ["Private Person"], handles: ["+15555550111"] }];
    skip.site.waiting = [ask("Private Person", "hi there")];
    await skip.engine.act();
    expect(skip.store.load().cards[0]!.state).toBe("off");
    expect(skip.site.composes).toEqual([]);
    const h = setup();
    h.bb.history = [text("I paid the invoice, here is the receipt", NOW - 60_000, true), text("see you soon", NOW - 30_000, true)];
    h.site.waiting = [ask("Riley", "running late")];
    await h.engine.act();
    expect(h.site.composes[0]!.examples).toEqual(["see you soon"]);
  });

  it("sends a card once, through act, with the text on screen; a changed version, a replay or a second send is refused", async () => {
    const h = await composed();
    const at = h.card!.draft!.at;
    const send = (rid: string, over: Partial<TextRequest> = {}) => req({ rid, thread: CARD, draftAt: at, text: "Running 15 late, sorry (edited)", ...over }, KEY, NOW);
    h.site.waiting = [send("4".repeat(24), { draftAt: at - 1 }), { ...send("5".repeat(24)), text: "something else" }];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    const good = send("6".repeat(24));
    h.site.waiting = [good];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: CHAT, text: "Running 15 late, sorry (edited)" }]);
    expect(h.site.reported.at(-1)).toEqual({ rid: good.rid, result: "sent" });
    expect(h.store.load().cards[0]).toMatchObject({ state: "sent", draft: null });
    h.site.waiting = [good, send("7".repeat(24))];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);
  });

  it("refuses a resend once Messages shows the text went", async () => {
    const h = await composed();
    const at = h.card!.draft!.at;
    h.bb.send = async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    };
    h.site.waiting = [req({ rid: "8".repeat(24), thread: CARD, draftAt: at, text: "Running late!" }, KEY, NOW)];
    await h.engine.act();
    expect(h.site.reported.at(-1)!.result).toBe("failed");
    h.bb.history.push(text("Running late!", NOW + 1_000, true));
    h.bb.send = async (chat, body) => {
      h.bb.sent.push({ chat, text: body });
      return true;
    };
    h.site.waiting = [req({ rid: "9".repeat(24), thread: CARD, draftAt: at, text: "Running late!" }, KEY, NOW)];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    expect(h.store.load().cards[0]!.state).toBe("sent");
  });

  it("never invents a country code: a bare number with no chat in Messages isn't texted, and Nikita is told to text it himself", async () => {
    expect(chatHandle("(555) 555-0177")).toBe("5555550177");
    expect(chatHandle("+91 55555 50177")).toBe("+915555550177");
    const h = setup();
    h.bb.people = [{ names: ["Casey Example"], handles: ["(555) 555-0177"] }];
    h.bb.known = [CHAT];
    h.site.waiting = [ask("Casey", "running late")];
    await h.engine.act();
    await h.engine.report(true);
    expect(h.store.load().cards[0]).toMatchObject({ state: "nochat", target: null, draft: null });
    expect(h.site.composes).toEqual([]);
    expect(h.site.views.at(-1)!.cards![0]).toMatchObject({ state: "nochat", mask: null, draft: null });
    expect(readTextsView(h.site.views.at(-1), NOW)).not.toBeNull();
    // No card to send, and nothing in any chat, let alone a +1 one.
    h.site.waiting = [req({ rid: "d".repeat(24), thread: CARD, draftAt: NOW, text: "Running late!" }, KEY, NOW)];
    await h.engine.act();
    expect(h.bb.sent).toEqual([]);
    // The same, when BlueBubbles can't list its chats.
    const down = setup();
    down.bb.people = h.bb.people;
    down.bb.chats = async () => {
      throw new Error("down");
    };
    down.site.waiting = [ask("Casey", "running late")];
    await down.engine.act();
    expect(down.store.load().cards[0]!.state).toBe("nochat");
  });

  it("finds the chat Messages already has for a number saved without its country code (+91 here), and sends there", async () => {
    const h = setup();
    const INDIA = "iMessage;-;+915555550177";
    h.bb.people = [{ names: ["Casey Example"], handles: ["55555 50177"] }];
    h.bb.known = [CHAT, "SMS;-;+915555550177", INDIA]; // iMessage first
    h.site.waiting = [ask("Casey", "running late")];
    await h.engine.act();
    const card = h.store.load().cards[0]!;
    expect(card).toMatchObject({ state: "ready", target: { chat: INDIA, channel: "iMessage" } });
    h.site.waiting = [req({ rid: "e".repeat(24), thread: CARD, draftAt: card.draft!.at, text: "Running late!" }, KEY, NOW)];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: INDIA, text: "Running late!" }]);
  });

  it("refuses to send once Nikita texted them since the card was made, and the card says why", async () => {
    const h = await composed();
    const at = h.card!.draft!.at;
    h.bb.history.push(text("actually here already", at + 1_000, true));
    h.site.waiting = [req({ rid: "f".repeat(24), thread: CARD, draftAt: at, text: "Running late!" }, KEY, NOW)];
    await h.engine.act();
    await h.engine.report(true);
    expect(h.bb.sent).toEqual([]);
    expect(h.site.reported.at(-1)!.result).toBe("refused");
    expect(h.store.load().cards[0]).toMatchObject({ state: "moved", draft: null });
    expect(h.site.views.at(-1)!.cards![0]).toMatchObject({ state: "moved", mask: null, draft: null });
    expect(readTextsView(h.site.views.at(-1), NOW)).not.toBeNull();
  });

  it("drops a card on done and by the sweep, and logs nothing of it", async () => {
    const h = await composed();
    expect(h.log.lines.join("\n")).not.toMatch(/Riley|Jordan|555|late|iMessage|[0-9a-f]{16}/);
    h.at(NOW + CARD_KEEP_MS + 1);
    h.engine.sweep();
    expect(h.store.load().cards).toEqual([]);
    const d = await composed();
    h.site.waiting = [];
    d.site.waiting = [req({ rid: "c".repeat(24), kind: "done", thread: CARD, text: "" }, KEY, NOW)];
    await d.engine.act();
    expect(d.store.load().cards).toEqual([]);
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

  it("binds 127.0.0.1 only, takes only /control, and refuses a missing key or any Origin", async () => {
    const got: string[] = [];
    const log = memoryLogger();
    server = await listen({ localKey: "local-test-key", log, control: async (what) => void got.push(what) }, 0);
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    expect(await call(addr.port, "/control")).toBe(401);
    expect(await call(addr.port, "/control?k=wrong")).toBe(401);
    expect(await call(addr.port, "/control?k=local-test-key", { origin: "https://example.com" })).toBe(401);
    expect(await call(addr.port, "/send?k=local-test-key")).toBe(404);
    // The old webhook path is gone (#749): the hub polls BlueBubbles instead.
    expect(await call(addr.port, "/bluebubbles?k=local-test-key", {}, JSON.stringify({ type: "new-message", data: {} }))).toBe(404);
    expect(await call(addr.port, "/control?k=local-test-key", {}, JSON.stringify({ do: "pause" }))).toBe(204);
    expect(got).toEqual(["pause"]);
    expect(typeof handler).toBe("function");
  });
});

describe("new messages, polled from BlueBubbles (#749)", () => {
  const polled = (guid: string, at: number, t = "Dinner Saturday?", over: Partial<Message> = {}): Polled => ({ guid, at, inbound: { chat: CHAT, group: false, groupName: "", message: { text: t, fromMe: false, at, handle: HANDLE, ...over } } });

  it("starts from now on the first poll, then takes each new message in once", async () => {
    const h = setup();
    h.bb.inbox = [polled("old-guid", NOW - 60_000)];
    expect(await h.engine.poll()).toBe(0);
    expect(h.store.load().inbox?.at).toBe(NOW);
    expect(h.store.load().threads).toEqual([]);
    h.bb.inbox.push(polled("new-guid", NOW + 1_000));
    h.at(NOW + 5_000);
    expect(await h.engine.poll()).toBe(1);
    expect(h.store.load().threads[0]!.state).toBe("owed");
    // The overlap reads the same message again; it is taken in once.
    h.at(NOW + 10_000);
    expect(await h.engine.poll()).toBe(0);
    expect(h.bb.asked.at(-1)).toBe(NOW + 1_000 - POLL_OVERLAP_MS);
    // Reactions move the cursor but are not messages.
    h.bb.inbox.push({ guid: "tapback", at: NOW + 11_000, inbound: null });
    h.at(NOW + 15_000);
    expect(await h.engine.poll()).toBe(0);
    expect(h.store.load().inbox?.at).toBe(NOW + 11_000);
  });

  it("keeps hashes and times only in the state file, never a guid, a chat id or a text", async () => {
    const h = setup();
    await h.engine.poll();
    h.bb.inbox = [polled("8F1C2D3E-guid-secret", NOW + 1_000, "Running late")];
    h.at(NOW + 5_000);
    await h.engine.poll();
    const inbox = JSON.stringify(h.store.load().inbox);
    expect(inbox).not.toMatch(/guid|iMessage|555|Running/);
    expect(h.store.load().inbox?.recent[0]?.h).toMatch(/^[0-9a-f]{16}$/);
    expect(h.log.lines.join("\n")).not.toMatch(/guid|iMessage|555|Running/);
  });

  it("catches up after the hub was off, a day back at most, and Nikita's own reply settles the thread", async () => {
    const h = setup();
    await h.engine.poll();
    h.bb.inbox = [polled("a", NOW + 1_000), polled("b", NOW + 2_000, "", { fromMe: true, handle: "" })];
    h.at(NOW + 3 * CATCH_UP_MS);
    expect(await h.engine.poll()).toBe(0);
    expect(h.bb.asked.at(-1)).toBe(NOW + 2 * CATCH_UP_MS);
    const g = setup();
    await g.engine.poll();
    g.bb.inbox = [polled("a", NOW + 1_000), polled("b", NOW + 2_000, "", { fromMe: true, handle: "" })];
    g.at(NOW + 60_000);
    expect(await g.engine.poll()).toBe(2);
    expect(g.store.load().threads[0]!.state).not.toBe("owed");
  });

  it("takes nothing in while paused, and a failed poll keeps the cursor", async () => {
    const h = setup();
    await h.engine.poll();
    h.engine.pause();
    h.bb.inbox = [polled("a", NOW + 1_000)];
    h.at(NOW + 5_000);
    expect(await h.engine.poll()).toBe(0);
    expect(h.store.load().threads).toEqual([]);
    expect(h.store.load().inbox?.at).toBe(NOW + 5_000);
    h.engine.resume();
    h.bb.failPoll = true;
    h.at(NOW + 10_000);
    await expect(h.engine.poll()).rejects.toThrow();
    expect(h.store.load().inbox?.at).toBe(NOW + 5_000);
  });

  it("reads BlueBubbles' message query rows: a message with its chat, a reaction as no message", () => {
    const row = { guid: "g1", dateCreated: NOW, text: "hi", isFromMe: false, handle: { address: HANDLE }, chats: [{ guid: CHAT, displayName: "" }] };
    expect(readPolled(row)).toEqual({ guid: "g1", at: NOW, inbound: { chat: CHAT, group: false, groupName: "", message: { text: "hi", fromMe: false, at: NOW, handle: HANDLE, read: false, guid: "g1" } } });
    expect(readPolled({ ...row, dateRead: NOW + 60_000 })?.inbound?.message.read).toBe(true);
    expect(readPolled({ ...row, associatedMessageGuid: "p:0/x" })?.inbound).toBeNull();
    expect(readPolled({ ...row, guid: undefined })).toBeNull();
  });
});

/* ── #642: closing intent and contact photos on the Mac ── */

/** A tiny made-up PNG with a text chunk that must not leave the Mac. */
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 96);
  new DataView(ihdr.buffer).setUint32(4, 96);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("tEXt", new TextEncoder().encode("Author\0Riley Test")), chunk("IDAT", new Uint8Array(30).fill(3)), chunk("IEND", new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}

describe("closing intent on the Mac (#642)", () => {
  it("after Nikita's closing reply, a thanks owes nothing: settled with no model call and no draft", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    // Read on the phone (#924: kept unread, it would stay owed).
    h.bb.history = [text("Can you send the photos?", NOW - 300_000), text("no worries, already did it", NOW - 120_000, true), { ...text("thanks!", NOW - 60_000), read: true }];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history[2]! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.site.sorts).toHaveLength(0);
    expect(h.site.drafts).toHaveLength(0);
    expect(h.store.load().threads[0]).toMatchObject({ state: "settled", why: "closing", draft: null });
  });

  it("closes an owed thread when Nikita's own message is now the newest in Messages", async () => {
    const { bb, engine, store, at, site } = await owedWithDraft();
    expect(store.load().threads[0]!.state).toBe("owed");
    bb.history.push(text("yep, see you Saturday", NOW + SETTLE_MS + 30_000, true));
    at(NOW + SETTLE_MS + 60_000);
    const drafts = site.drafts.length;
    await engine.recheck();
    const t = store.load().threads[0]!;
    expect(t.state).not.toBe("owed");
    expect(site.drafts).toHaveLength(drafts);
    // It comes back only when they write again.
    bb.history.push(text("Also, bring chairs?", NOW + SETTLE_MS + 120_000));
    await engine.onMessage({ chat: CHAT, group: false, groupName: "", message: bb.history.at(-1)! });
    expect(store.load().threads[0]!.state).toBe("owed");
  });
});

describe("contact photos (#642)", () => {
  const withPhotos = () => {
    const h = setup();
    const resized: number[] = [];
    const engine = new Engine({ store: h.store, bb: h.bb, site: h.site, log: h.log, config: DEFAULT_CONFIG, sendKey: KEY, now: h.now, offsetAt: UTC, photoKey: Buffer.alloc(32, 9), resize: async (img) => (resized.push(img.length), tinyPng()) });
    h.bb.pictures = [
      { handles: [HANDLE, "riley@example.com"], image: new Uint8Array(500).fill(1) },
      { handles: ["+15555550199"], image: new Uint8Array(400).fill(2) },
    ];
    return { ...h, engine, resized };
  };

  it("sends small cleaned photos under opaque ids, emails only as keyed hashes, and nothing about who", async () => {
    const h = withPhotos();
    await h.engine.syncPhotos();
    expect(h.site.uploaded).toHaveLength(2);
    for (const u of h.site.uploaded) {
      expect(u.id).toMatch(/^[0-9a-f]{32}$/);
      expect(Buffer.from(u.png).includes(Buffer.from("Riley"))).toBe(false);
    }
    const sent = JSON.stringify(h.site.lists);
    for (const secret of ["5555550123", "5555550199", "riley@example.com", "Riley", "Jordan"]) expect(sent, secret).not.toContain(secret);
    expect(h.site.lists[0]!.emails).toHaveLength(1);
    expect(h.site.lists[0]!.emails[0]![1]).toBe(h.site.uploaded[0]!.id);
    expect(Object.keys(h.store.load().photos)).toHaveLength(2);
    // The next day, unchanged photos aren't sent again.
    await h.engine.syncPhotos();
    expect(h.site.uploaded).toHaveLength(2);
    // The list in the log is counts only.
    expect(h.log.lines.join("\n")).not.toContain("Riley");
  });

  it("does nothing without the Mac's photo key", async () => {
    const h = setup();
    h.bb.pictures = [{ handles: [HANDLE], image: new Uint8Array(10) }];
    await h.engine.syncPhotos();
    expect(h.site.uploaded).toHaveLength(0);
  });
});

describe("contact photos: failures counted, the status kept (#891)", () => {
  const withPhotos = (n = 3) => {
    const h = setup();
    const engine = new Engine({ store: h.store, bb: h.bb, site: h.site, log: h.log, config: DEFAULT_CONFIG, sendKey: KEY, now: h.now, offsetAt: UTC, photoKey: Buffer.alloc(32, 9), resize: async (img) => (img[0] === 0 ? null : tinyPng()) });
    h.bb.pictures = Array.from({ length: n }, (_, i) => ({ handles: [`+1555555${String(1000 + i)}`], image: new Uint8Array(50).fill(i + 1) }));
    return { ...h, engine };
  };
  const lines = (h: { log: { lines: string[] } }) => h.log.lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  it("counts photos the site refused and logs the last status as a number, with nothing about who", async () => {
    const h = withPhotos(3);
    h.bb.pictures.push({ handles: ["+15555559999"], image: new Uint8Array(50) });
    let calls = 0;
    h.site.photo = async (id: string, png: Uint8Array) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("site"), { name: "HttpError", status: 413 });
      h.site.uploaded.push({ id, png });
      return true;
    };
    await h.engine.syncPhotos();
    const synced = lines(h).find((l) => l.kind === "photos synced")!;
    expect(synced).toMatchObject({ count: 2, failed: 1, unreadable: 1, status: 413 });
    expect(h.store.load().photosFail).toMatchObject({ status: 413, failed: 1 });
    expect(h.store.load().photosRun).toBeNull();
    expect(photoSyncLine(h.store.load(), h.now() + 120_000)).toBe("Relay: the last photo sync, 2 minutes ago, sent the list but 1 photos weren't taken (the site answered 413).");
    expect(h.log.lines.join("\n")).not.toMatch(/5555|Riley/);
  });

  it("logs the list call's HTTP status on photos failed, and keeps it for relay check", async () => {
    const h = withPhotos(2);
    h.site.photos = async () => {
      throw Object.assign(new Error("site"), { name: "HttpError", status: 401 });
    };
    await h.engine.syncPhotos();
    expect(lines(h).find((l) => l.kind === "photos failed")).toMatchObject({ error: "HttpError", status: 401 });
    expect(h.store.load().photosFail).toMatchObject({ status: 401, failed: 0 });
    expect(photoSyncLine(h.store.load(), h.now())).toBe("Relay: the last photo sync failed 0 minutes ago (the site answered 401).");
    // A clean sync clears it.
    h.site.photos = async (keep: string[]) => keep;
    await h.engine.syncPhotos();
    expect(h.store.load().photosFail).toBeNull();
    expect(photoSyncLine(h.store.load(), h.now())).toBeNull();
  });

  it("says a sync is running while it runs", async () => {
    const h = withPhotos(1);
    let seen: string | null = null;
    h.site.photos = async (keep: string[]) => {
      seen = photoSyncLine(h.store.load(), h.now() + 180_000);
      return keep;
    };
    await h.engine.syncPhotos();
    expect(seen).toBe("Relay: a photo sync started 3 minutes ago and hasn't finished (it shrinks each picture first).");
    expect(h.store.load().photosRun).toBeNull();
    expect(statusOf(Object.assign(new Error("x"), { status: 502 }))).toBe(502);
    expect(statusOf(new TypeError("fetch failed"))).toBe(0);
    expect(statusOf({ status: "401" })).toBe(0);
  });

  it("reaches the Desk through a locked site's gate and the real route (#891: the gate refused every photo call)", async () => {
    const DESK = "a made-up desk key for the photo test";
    const pairing = mintPairing(DESK)!;
    const relay = new MemoryRelayStore(() => NOW);
    relay.hubRec = { pairId: pairing.pairId, tokenHash: createHash("sha256").update(pairing.token).digest("hex"), pairedAt: NOW, lastSeen: null };
    const deps: RelayRouteDeps = { desk: { deskKey: DESK, store: new MemoryAuthStore(), now: NOW }, store: relay, spend: null, claude: null, budget: 0, skipTerms: [], ping: async () => 0, now: NOW, photoKey: photoEmailKey("e".repeat(43)) };
    const gate = { state: stateOf({ v: 1, passkey: true, locked: "2026-10-22T00:00:00.000Z", sv: "version-one" }, {}), keys: (await siteKeys({ FOUNDRY_DESK_KEY: DESK }))!, env: { FOUNDRY_DESK_KEY: DESK }, now: NOW };
    const statuses: number[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const d = decide(req, gate);
      const res = !d.allow ? d.response : req.method === "GET" ? await routeGET(req, deps) : await routePOST(req, deps);
      statuses.push(res.status);
      return res;
    }) as typeof fetch;
    const site = siteClient(pairing.token, fetcher, "https://ceo.test");
    const h = setup();
    const engine = new Engine({ store: h.store, bb: h.bb, site, log: h.log, config: DEFAULT_CONFIG, sendKey: KEY, now: h.now, offsetAt: UTC, photoKey: Buffer.alloc(32, 9), resize: async () => tinyPng() });
    h.bb.pictures = Array.from({ length: 217 }, (_, i) => ({ handles: [`+1555556${String(1000 + i)}`, ...(i % 3 ? [] : [`made.up.${i}@example.org`])], image: new Uint8Array(50).fill(1) }));
    await engine.syncPhotos();
    expect(statuses.every((s) => s === 200), `statuses ${[...new Set(statuses)].join(",")}`).toBe(true);
    expect(lines(h).find((l) => l.kind === "photos synced")).toMatchObject({ count: 217, failed: 0 });
    expect(Object.keys(h.store.load().photos)).toHaveLength(217);
    expect(relay.photos.size).toBe(217);
    expect(Object.keys(readPhotoIndex(await relay.photoIndex()).emails)).toHaveLength(73);
  });
});

describe("the full text and groups on the Desk (#758)", () => {
  const GROUP = "iMessage;+;chat000000000000000003";
  const OTHER = "+15555550199";
  const groupRound = async (texts: string[], asked: boolean) => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = texts.map((t, i) => ({ text: t, fromMe: false, at: NOW - (texts.length - i) * 1_000, handle: i % 2 ? OTHER : HANDLE }));
    h.site.sortAnswer = { summary: "Planning Sunday.", asked };
    await h.engine.onMessage({ chat: GROUP, group: true, groupName: "Test group", message: h.bb.history.at(-1)! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    await h.engine.report(true);
    return h;
  };

  it("a group that asks Nikita something is owed, its lines with who sent each", async () => {
    const h = await groupRound(["Sunday at noon?", "Can you bring chairs?"], true);
    expect(h.store.load().threads[0]!.state).toBe("owed");
    const item = h.site.views.at(-1)!.items.find((i) => i.group)!;
    expect(item.messages?.map((m) => m.text)).toEqual(["Sunday at noon?", "Can you bring chairs?"]);
    expect(item.messages?.every((m) => typeof m.from === "string" && m.from.length > 0)).toBe(true);
    expect(JSON.stringify(item)).not.toMatch(/5550199|iMessage;/);
  });

  it("a group that names Nikita is owed even when the model says nobody asked", async () => {
    const h = await groupRound(["Sunday at noon?", "Nikita has the keys I think"], false);
    expect(h.store.load().threads[0]!.state).toBe("owed");
  });

  it("a group that neither asks nor names Nikita waits while unread (#950), then stays summary-only once read", async () => {
    const h = await groupRound(["Sunday at noon?", "Works for me"], false);
    expect(h.store.load().threads[0]!).toMatchObject({ state: "owed", held: "group" });
    expect(h.site.views.at(-1)!.items.find((i) => i.group)?.summary?.text).toBe("Planning Sunday.");
    // Read on the Mac: the read check lets it go back to the shelf, summary and all.
    h.bb.history = h.bb.history.map((m) => ({ ...m, read: true }));
    await h.engine.recheck();
    expect(h.store.load().threads[0]!).toMatchObject({ state: "settled", why: "group" });
    await h.engine.report(true);
    expect(h.site.views.at(-1)!.items.find((i) => i.group)?.summary?.text).toBe("Planning Sunday.");
  });

  it("a group asked something keeps waiting once read (#950)", async () => {
    const h = await groupRound(["Sunday at noon?", "Can you bring chairs?"], true);
    expect(h.store.load().threads[0]!.held).toBeUndefined();
    h.bb.history = h.bb.history.map((m) => ({ ...m, read: true }));
    await h.engine.recheck();
    expect(h.store.load().threads[0]!.state).toBe("owed");
  });

  it("a thread a rule settles never shows its text, not even on the Desk", async () => {
    const h = await owedWithDraft();
    const money = text("Also the court settlement papers came", h.now() + 1_000);
    h.bb.history.push(money);
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: money });
    h.at(h.now() + SETTLE_MS + 2_000);
    await h.engine.work();
    await h.engine.report(true);
    const v = h.site.views.at(-1)!;
    expect(v.items.every((i) => !i.messages)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/court|settlement|Jordan Sample/);
  });

  it("caps the shown text at 5 messages and 1,000 characters, and the site refuses more", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    h.bb.history = [text("Running late", NOW - 60 * 60_000, true), ...Array.from({ length: 8 }, (_, i) => text(`Question ${i} `.repeat(120), NOW - (8 - i) * 60_000))];
    await h.engine.onMessage({ chat: CHAT, group: false, groupName: "", message: h.bb.history.at(-1)! });
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    await h.engine.report(true);
    const v = h.site.views.at(-1)!;
    const shown = v.items[0]!.messages!;
    expect(shown.length).toBeLessThanOrEqual(5);
    expect(shown.every((m) => m.text.length <= 1_000)).toBe(true);
    expect(shown.at(-1)!.text.startsWith("Question 7")).toBe(true);
    expect(readTextsView(JSON.parse(JSON.stringify(v)), h.now())).not.toBeNull();
    const tooMany = { ...v, items: [{ ...v.items[0]!, messages: Array.from({ length: 6 }, () => ({ text: "hi", at: NOW })) }] };
    expect(readTextsView(JSON.parse(JSON.stringify(tooMany)), h.now())).toBeNull();
  });
});

describe("names and gists on the Desk (#861)", () => {
  const owe = async (h: ReturnType<typeof setup>, chat = CHAT, handle = HANDLE, at = NOW) => {
    h.bb.history = [{ text: "Are we still on for Saturday?", fromMe: false, at, handle }];
    await h.engine.onMessage({ chat, group: false, groupName: "", message: h.bb.history[0]! });
  };

  it("reports how many contacts BlueBubbles lets it read, 0 when macOS keeps Contacts from it", async () => {
    const h = setup();
    expect(h.engine.status()!.contacts).toBeUndefined();
    h.bb.people = [];
    await h.engine.checkMessages();
    expect(h.engine.status()!.contacts).toBe(0);
    // Contacts allowed: asked again while there are none, and the names come back.
    h.bb.people = [CONTACT];
    await h.engine.checkMessages();
    expect(h.engine.status()!.contacts).toBe(1);
    await owe(h);
    expect(readTextsView(h.engine.texts(), NOW)!.items[0]!.name).toBe("Riley Test");
  });

  it("names someone not in the contacts by the last 4 digits, never the number", async () => {
    const h = setup();
    h.bb.people = [];
    await owe(h);
    expect(h.engine.texts().items[0]!.name).toBe("Unknown (ending 0123)");
    expect(JSON.stringify(h.engine.texts())).not.toMatch(/5555550123/);
  });

  it("says a new thread is waiting in line, then that the model call failed, and tries again after a backoff", async () => {
    const h = setup();
    await owe(h);
    expect(h.engine.texts().items[0]!.wait).toBe("queued");
    const sort = h.site.sort.bind(h.site);
    h.site.sort = async () => {
      throw Object.assign(new Error("site"), { name: "HttpError", status: 502 });
    };
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(readTextsView(h.engine.texts(), h.now())!.items[0]!.wait).toBe("model");
    // Not again straight away.
    h.site.sort = sort;
    h.at(NOW + SETTLE_MS + 60_000);
    await h.engine.work();
    expect(h.site.sorts).toHaveLength(0);
    // After the backoff it sorts, and the wait goes with the gist.
    h.at(NOW + SETTLE_MS + 3 * 60_000);
    await h.engine.work();
    expect(h.site.sorts).toHaveLength(1);
    const item = h.engine.texts().items[0]!;
    expect(item.gist).not.toBe("");
    expect(item.wait).toBeUndefined();
  });

  it("says the site couldn't be reached, and that the monthly cap is reached", async () => {
    const h = setup();
    await owe(h);
    h.site.sort = async () => {
      throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
    };
    h.at(NOW + SETTLE_MS + 1);
    await h.engine.work();
    expect(h.engine.texts().items[0]!.wait).toBe("site");
    (h.site as Site).sort = async () => ({ paused: true as const });
    h.at(NOW + SETTLE_MS + 10 * 60_000);
    await h.engine.work();
    expect(h.engine.texts().items[0]!.wait).toBe("cap");
  });

  it("puts every owed thread without a gist in line, newest first, a few a round", async () => {
    const h = setup();
    for (let i = 0; i < 9; i++) await owe(h, `iMessage;-;+1555555020${i}`, `+1555555020${i}`, NOW - (9 - i) * 60_000);
    // A restart forgets the line; the threads are still owed without a gist.
    const fresh = new Engine({ store: h.store, bb: h.bb, site: h.site, log: h.log, config: DEFAULT_CONFIG, sendKey: KEY, now: h.now, offsetAt: UTC });
    h.at(NOW + SETTLE_MS + 1);
    await fresh.work();
    expect(h.site.sorts).toHaveLength(6);
    await fresh.work();
    expect(h.site.sorts).toHaveLength(9);
    expect(fresh.texts().items.every((i) => i.gist && !i.wait)).toBe(true);
  });

  it("lists an owed thread whose first unanswered text is over 30 days old while their latest is recent", async () => {
    const h = setup();
    await owe(h);
    const s = h.store.load();
    s.threads[0]!.since = NOW - 40 * 24 * 60 * 60_000;
    h.store.save(s);
    expect(h.engine.status()!.owed).toBe(1);
    expect(h.engine.texts().items).toHaveLength(1);
  });
});

describe("BlueBubbles' contacts (#861)", () => {
  it("reads numbers and addresses as objects or bare strings, and the whole name first", () => {
    expect(contactHandles({ phoneNumbers: [{ address: "+1 555 555 0123" }, "(555) 555-0199"], emails: ["riley@example.com", { address: "" }] })).toEqual(["+1 555 555 0123", "(555) 555-0199", "riley@example.com"]);
    expect(readContact({ firstName: "Riley", lastName: "Test", phoneNumbers: [] }).names).toEqual(["Riley Test", "Riley", "Test"]);
    expect(readContact({ displayName: "Riley Test", firstName: "Riley", lastName: "Test", nickname: "Ri" }).names).toEqual(["Riley Test", "Riley", "Test", "Ri"]);
  });
});
