import { describe, expect, it } from "vitest";
import { readTextsView, OWED_WINDOW_MS, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import { signRequest, REQUEST_MS } from "../../../api/_relay/tokens.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { BACKLOG_MAX, sortBacklog, verdictOf } from "./backlog.ts";
import { readChat, type BlueBubbles, type ChatInfo, type Contact, type Message, type Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";

/**
 * The backlog (#758): every chat's last message read on start and on Rescan, sorted on the Mac. Every name, number and
 * text here is made up (555 numbers, example.com).
 */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
const A = "+15555550101";
const B = "+15555550102";
const C = "+15555550103";
const PEOPLE: Contact[] = [
  { names: ["Avery Sample"], handles: [A] },
  { names: ["Blake Example"], handles: [B] },
  { names: ["Private Person"], handles: [C] },
];
const chatOf = (h: string) => `iMessage;-;${h}`;
const msg = (text: string, at: number, fromMe = false, handle = A, read = false): Message => ({ text, fromMe, at, handle: fromMe ? "" : handle, read });
const chat = (h: string, last: Message | null, over: Partial<ChatInfo> = {}): ChatInfo => ({ chat: chatOf(h), group: false, name: "", handle: h, last, lastAt: last?.at ?? 0, ...over });
const contactOf = (h: string) => PEOPLE.find((p) => p.handles.includes(h));

describe("the backlog classifier", () => {
  it("owes a chat whose last message is someone else's within 30 days, and folds older ones into a count", () => {
    expect(verdictOf(chat(A, msg("Are we still on for Friday?", NOW - 3 * DAY)), NOW, [], contactOf)).toBe("owed");
    expect(verdictOf(chat(A, msg("Are we still on for Friday?", NOW - OWED_WINDOW_MS + 60_000)), NOW, [], contactOf)).toBe("owed");
    expect(verdictOf(chat(A, msg("Are we still on for Friday?", NOW - OWED_WINDOW_MS - 60_000)), NOW, [], contactOf)).toBe("older");
    expect(verdictOf(chat(A, msg("sounds good, see you", NOW - DAY, true)), NOW, [], contactOf)).toBe("answered");
  });

  it("leaves groups alone (summary-only) and runs every rule: money, legal, codes, promos, short codes, the skip list", () => {
    expect(verdictOf(chat(A, msg("who's in for Saturday?", NOW - DAY), { chat: "iMessage;+;chat123", group: true, handle: "" }), NOW, [], contactOf)).toBe("group");
    expect(verdictOf(chat(A, msg("Your rent payment is overdue", NOW - DAY)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(A, msg("The court date for the settlement moved", NOW - DAY)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(A, msg("Your verification code is 482913", NOW - DAY)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(A, msg("20% off today, reply STOP to opt out", NOW - DAY)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat("72345", msg("Alert", NOW - DAY, false, "72345")), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(C, msg("hey, quick one", NOW - DAY, false, C)), NOW, ["private person"], contactOf)).toBe("settled");
    // The rules run on older chats too, so the count never holds one.
    expect(verdictOf(chat(A, msg("Your rent payment is overdue", NOW - 60 * DAY)), NOW, [], contactOf)).toBe("settled");
  });

  it("judges an older chat's closing intent without a model: an acknowledgement owes nothing", () => {
    expect(verdictOf(chat(A, msg("thanks!", NOW - 45 * DAY)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(A, msg("ok", NOW - 45 * DAY)), NOW, [], contactOf)).toBe("settled");
    // Within the window an acknowledgement still goes on, where Nikita's own last reply and Dialtone decide.
    expect(verdictOf(chat(A, msg("thanks!", NOW - 2 * DAY)), NOW, [], contactOf)).toBe("owed");
  });

  it("folds 30 to 60 days as older and leaves out anything past 60 days (#803)", () => {
    expect(verdictOf(chat(A, msg("did you ever get the photos?", NOW - 59 * DAY)), NOW, [], contactOf)).toBe("older");
    expect(verdictOf(chat(A, msg("did you ever get the photos?", NOW - 61 * DAY)), NOW, [], contactOf)).toBe("empty");
  });

  it("reads a chat again when a reaction, a system item or a photo was last", () => {
    expect(verdictOf(chat(A, null, { lastAt: NOW - DAY }), NOW, [], contactOf)).toBe("check");
    expect(verdictOf(chat(A, msg("", NOW - DAY)), NOW, [], contactOf)).toBe("check");
    expect(verdictOf(chat(A, null, { lastAt: NOW - 90 * DAY }), NOW, [], contactOf)).toBe("empty");
  });

  it("orders owed chats oldest first, older newest first, marks unread from Messages' read time, and caps the owed list", () => {
    const got = sortBacklog([chat(A, msg("one", NOW - 5 * DAY, false, A, true)), chat(B, msg("two", NOW - 9 * DAY, false, B)), chat(C, msg("three", NOW - 50 * DAY, false, C)), chat("+15555550104", msg("four", NOW - 40 * DAY, false, "+15555550104"))], NOW, [], contactOf);
    expect(got.owed.map((e) => e.chat)).toEqual([chatOf(B), chatOf(A)]);
    expect(got.owed.map((e) => e.unread)).toEqual([true, false]);
    expect(got.older.map((e) => e.chat)).toEqual([chatOf("+15555550104"), chatOf(C)]);
    const many = Array.from({ length: BACKLOG_MAX + 5 }, (_, i) => chat(`+1555555${String(1000 + i)}`, msg("hi there", NOW - (i + 1) * 60 * 60_000, false, `+1555555${String(1000 + i)}`)));
    const capped = sortBacklog(many, NOW, [], contactOf);
    expect(capped.owed).toHaveLength(BACKLOG_MAX);
    // The newest BACKLOG_MAX stay owed; the 5 oldest within the window join the older ones.
    expect(capped.older).toHaveLength(5);
    expect(Math.min(...capped.owed.map((e) => e.at))).toBeGreaterThan(Math.max(...capped.older.map((e) => e.at)));
  });

  it("reads BlueBubbles' chat query rows: the other person from participants, the last message's read time", () => {
    const row = { guid: chatOf(A), style: 45, displayName: "", participants: [{ address: A }], lastMessage: { guid: "m1", text: "hey", isFromMe: false, dateCreated: NOW - DAY, dateRead: null, handle: null, itemType: 0 } };
    expect(readChat(row)).toEqual({ chat: chatOf(A), group: false, name: "", handle: A, last: { text: "hey", fromMe: false, at: NOW - DAY, handle: A, read: false }, lastAt: NOW - DAY });
    expect(readChat({ ...row, lastMessage: { ...row.lastMessage, dateRead: NOW } })?.last?.read).toBe(true);
    expect(readChat({ ...row, lastMessage: { ...row.lastMessage, associatedMessageGuid: "p:0/x" } })?.last).toBeNull();
    expect(readChat({ ...row, guid: "iMessage;+;chat99", style: 43, displayName: "Climbing" })).toMatchObject({ group: true, name: "Climbing", handle: "" });
  });
});

/* ── The engine's scan, on fakes ── */

class FakeBB implements BlueBubbles {
  chatsList: ChatInfo[] = [];
  byChat = new Map<string, Message[]>();
  inbox: Polled[] = [];
  async ping() {
    return true;
  }
  async contacts() {
    return PEOPLE;
  }
  async messages(c: string, limit: number) {
    return [...(this.byChat.get(c) ?? [])].sort((a, b) => b.at - a.at).slice(0, limit);
  }
  async send() {
    return true;
  }
  async chats() {
    return [];
  }
  async contactPhotos() {
    return [];
  }
  async since(after: number, limit: number) {
    return this.inbox.filter((p) => p.at >= after).sort((a, b) => a.at - b.at).slice(0, limit);
  }
  pages: number[] = [];
  async chatList(offset: number, limit: number) {
    this.pages.push(offset);
    return this.chatsList.slice(offset, offset + limit);
  }
}

class FakeSite implements Site {
  sorts: SortInput[] = [];
  drafts: DraftInput[] = [];
  views: TextsView[] = [];
  statuses: unknown[] = [];
  learns: LearnInput[] = [];
  waiting: unknown[] = [];
  reported: { rid: string; result: string }[] = [];
  sortAnswer: unknown = { needsReply: true, sort: "normal", gist: "Asks about Friday" };
  async status(s: unknown) {
    this.statuses.push(s);
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
    return { answer: { draft: "yes, Friday works" } };
  }
  async compose(_: ComposeInput) {
    return { answer: null };
  }
  async learn(input: LearnInput) {
    this.learns.push(input);
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
    return ["private person"];
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

const setup = () => {
  let now = NOW;
  const bb = new FakeBB();
  const site = new FakeSite();
  const store = memoryStore();
  const log = memoryLogger(() => now);
  const engine = new Engine({ store, bb, site, log, config: DEFAULT_CONFIG, sendKey: KEY, now: () => now, offsetAt: () => 0 });
  return { bb, site, store, log, engine, at: (t: number) => (now = t) };
};

/** A made-up account: Avery owes a reply (unread), Blake's thanks closes Nikita's "no worries", Private Person is skip-listed, an older chat, a group. */
const seed = (h: ReturnType<typeof setup>) => {
  const avery = [msg("see you soon", NOW - 6 * DAY, true), msg("Are we still on for Friday? Call +1 555 555 0177", NOW - 5 * DAY, false, A, false)];
  const blake = [msg("no worries", NOW - 4 * DAY, true), msg("thanks!", NOW - 3 * DAY, false, B, true)];
  const priv = [msg("hey, quick one", NOW - 2 * DAY, false, C)];
  const old = [msg("did you ever get the photos?", NOW - 45 * DAY, false, "+15555550104")];
  h.bb.byChat.set(chatOf(A), avery);
  h.bb.byChat.set(chatOf(B), blake);
  h.bb.byChat.set(chatOf(C), priv);
  h.bb.byChat.set(chatOf("+15555550104"), old);
  h.bb.chatsList = [chat(A, avery[1]!), chat(B, blake[1]!), chat(C, priv[0]!), chat("+15555550104", old[0]!), chat(A, msg("who's in?", NOW - DAY), { chat: "iMessage;+;chat777", group: true, handle: "" })];
};

describe("the engine's backlog scan", () => {
  it("queues owed chats like new texts, runs the rules and closing intent again, and leaves groups alone", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    seed(h);
    expect(await h.engine.backlog()).toEqual({ owed: 2, older: 1 });
    let s = h.store.load();
    // Avery and Blake are owed for now; Private Person (the skip list) and the group never become threads.
    expect(s.threads.map((t) => t.chat).sort()).toEqual([chatOf(A), chatOf(B)]);
    expect(s.threads.find((t) => t.chat === chatOf(A))?.unread).toBe(true);
    await h.engine.work();
    s = h.store.load();
    // Blake's "thanks!" after Nikita's "no worries" settles with no model call; Avery is sorted and drafted.
    expect(s.threads.find((t) => t.chat === chatOf(B))).toMatchObject({ state: "settled", why: "no-reply" });
    expect(s.threads.find((t) => t.chat === chatOf(A))).toMatchObject({ state: "owed" });
    expect(h.site.sorts).toHaveLength(1);
    expect(h.site.drafts).toHaveLength(1);
    expect(JSON.stringify([h.site.sorts, h.site.drafts])).not.toMatch(/Avery|Blake|555/);
  });

  it("queues an owed chat without a gist again on the next scan, shows its texts, and tells a stranger apart by 4 digits (#803)", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    seed(h);
    const stranger = "+15555550199";
    const theirs = [msg("hey, is the bike still for sale?", NOW - 20 * DAY, false, stranger), msg("​", NOW - 20 * DAY + 1, false, stranger)];
    h.bb.byChat.set(chatOf(stranger), theirs);
    h.bb.chatsList.push(chat(stranger, theirs[0]!));
    await h.engine.backlog();
    // The sort never ran (the model was down, say): the next scan queues it again instead of leaving "No gist" for good.
    expect(h.engine.pending()).toBeGreaterThan(0);
    while (h.engine.pending()) await h.engine.work().catch(() => undefined);
    h.store.save({ ...h.store.load(), threads: h.store.load().threads.map((t) => (t.chat === chatOf(stranger) ? { ...t, gist: "" } : t)) });
    await h.engine.backlog();
    expect(h.engine.pending()).toBe(1);
    await h.engine.report(true);
    const view = readTextsView(h.engine.texts(), NOW)!;
    const item = view.items.find((i) => i.name.startsWith("Unknown"))!;
    expect(item.name).toBe("Unknown (ending 0199)");
    // Twenty days old, its words still show (a week was the old limit); the invisible one is left out.
    expect(item.messages?.map((m) => m.text)).toEqual(["hey, is the bike still for sale?"]);
    expect(JSON.stringify(view)).not.toMatch(/\+1555|5555550199/);
  });

  it("shows a read chat as owed too, counts unread and older in the status, and names older ones in the sealed list only", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    seed(h);
    const read = h.bb.byChat.get(chatOf(A))!;
    read[1] = { ...read[1]!, read: true };
    h.bb.chatsList[0] = chat(A, read[1]!);
    await h.engine.backlog();
    const status = h.engine.status()!;
    expect(status.owed).toBe(2);
    expect(status.unread).toBe(0);
    expect(status.older).toBe(1);
    const view = readTextsView(h.engine.texts(), NOW)!;
    expect(view.items.map((i) => i.name).sort()).toEqual(["Avery Sample", "Blake Example"]);
    expect(view.items.every((i) => !i.unread)).toBe(true);
    expect(view.older).toEqual({ count: 1, items: [{ id: expect.stringMatching(/^[0-9a-f]{16}$/), name: "Unknown sender", channel: "iMessage", since: NOW - 45 * DAY, unread: true }] });
    // Never a number, a chat id or a message (ids are random hex, so the check looks for the numbers' own shape).
    expect(JSON.stringify(view)).not.toMatch(/\+1 ?555|555 0177|iMessage;-;|Are we still/);
    expect(view.scannedAt).toBe(NOW);
  });

  it("keeps the 30-day window: an owed thread past it moves to the older count, and the list keeps owed items 30 days", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    seed(h);
    await h.engine.backlog();
    expect(readTextsView(h.engine.texts(), NOW)!.items.some((i) => i.name === "Avery Sample")).toBe(true);
    h.at(NOW + 26 * DAY);
    h.engine.sweep();
    expect(h.store.load().threads.some((t) => t.chat === chatOf(A))).toBe(false);
    expect(h.store.load().older.some((o) => o.chat === chatOf(A))).toBe(true);
    // The scan's week-old snapshot is dropped (the hub rescans daily); the thread that aged out is counted.
    expect(h.engine.status()!.older).toBe(1);
  });

  it("doesn't bring back a thread Nikita dismissed, and a new message from an older chat makes it owed", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    seed(h);
    await h.engine.backlog();
    const avery = h.store.load().threads.find((t) => t.chat === chatOf(A))!;
    h.store.save({ ...h.store.load(), threads: h.store.load().threads.map((t) => (t.id === avery.id ? { ...t, state: "settled", why: "done" } : t)) });
    await h.engine.backlog();
    expect(h.store.load().threads.find((t) => t.chat === chatOf(A))?.state).toBe("settled");
    await h.engine.onMessage({ chat: chatOf("+15555550104"), group: false, groupName: "", message: msg("hello?", NOW, false, "+15555550104") });
    expect(h.store.load().older).toEqual([]);
    expect(h.store.load().threads.find((t) => t.chat === chatOf("+15555550104"))?.state).toBe("owed");
  });

  it("runs on the Desk's Rescan: a signed, single-use request; paused, nothing is read", async () => {
    const h = setup();
    await h.engine.refreshSkipTerms(true);
    seed(h);
    const f = { rid: "c".repeat(24), kind: "rescan" as const, thread: "1234567890abcdef", draftAt: 0, text: "", until: NOW + REQUEST_MS };
    const r = { ...f, created: NOW, sig: signRequest(KEY, f) };
    h.site.waiting = [r];
    await h.engine.act();
    expect(h.site.reported).toEqual([{ rid: r.rid, result: "done" }]);
    expect(h.store.load().scannedAt).toBe(NOW);
    h.site.waiting = [r];
    await h.engine.act();
    expect(h.site.reported.at(-1)).toEqual({ rid: r.rid, result: "refused", reason: "replay" });
    h.engine.pause();
    h.bb.pages = [];
    expect(await h.engine.backlog()).toBeNull();
    expect(h.bb.pages).toEqual([]);
  });

  it("reads every page of chats, and logs counts only", async () => {
    const h = setup();
    h.bb.chatsList = Array.from({ length: 1_500 }, (_, i) => chat(`+1555${String(1_000_000 + i)}`, msg("old one", NOW - 90 * DAY, true)));
    await h.engine.backlog();
    expect(h.bb.pages).toEqual([0, 1_000]);
    expect(h.log.lines.join("\n")).not.toMatch(/555|old one|iMessage/);
  });
});
