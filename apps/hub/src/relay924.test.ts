import { describe, expect, it } from "vitest";
import { itemLive, OWED_WINDOW_MS, readTextsView, UNREAD_WINDOW_MS, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import { REQUEST_MS, signRequest } from "../../../api/_relay/tokens.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { verdictOf } from "./backlog.ts";
import type { BlueBubbles, ChatInfo, Contact, Message, Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine, peopleName, SETTLE_MS } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore, type Thread } from "./store.ts";
import { explain } from "./why.ts";

/**
 * #924 (Nikita, 2026-11-06: his phone's Unread filter is his real to-reply list): a one-to-one chat kept unread in
 * Messages is owed for 60 days, whatever Dialtone or closing intent read; the rules still settle it, Done holds until
 * they write again, a group stays summary-only, and a read chat keeps today's handling. #923: Blasto drafts only on
 * "Write for me", and an unnamed group is named by its people. Every name, number and text here is made up (555 numbers).
 */

const NOW = Date.parse("2026-11-06T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
const A = "+15555550101";
const B = "+15555550102";
const PEOPLE: Contact[] = [
  { names: ["Avery Sample"], handles: [A] },
  { names: ["Blake Example"], handles: [B] },
];
const chatOf = (h: string) => `iMessage;-;${h}`;
const msg = (text: string, at: number, fromMe = false, handle = A, read = false): Message => ({ text, fromMe, at, handle: fromMe ? "" : handle, read });
const chat = (h: string, last: Message | null, over: Partial<ChatInfo> = {}): ChatInfo => ({ chat: chatOf(h), group: false, name: "", handle: h, last, lastAt: last?.at ?? 0, ...over });
const contactOf = (h: string) => PEOPLE.find((p) => p.handles.includes(h));

class FakeBB implements BlueBubbles {
  chatsList: ChatInfo[] = [];
  byChat = new Map<string, Message[]>();
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
    return true;
  }
  async chats() {
    return [];
  }
  async react(): Promise<boolean> {
    return true;
  }
  async privateApi(): Promise<boolean | null> {
    return true;
  }
  async contactPhotos() {
    return [];
  }
  async since(): Promise<Polled[]> {
    return [];
  }
  async chatList(offset: number, limit: number) {
    return this.chatsList.slice(offset, offset + limit);
  }
}

class FakeSite implements Site {
  sorts: SortInput[] = [];
  drafts: DraftInput[] = [];
  waiting: unknown[] = [];
  reported: { rid: string; result: string; reason?: string }[] = [];
  sortAnswer: unknown = { needsReply: false, sort: "normal", gist: "Says it was fun" };
  async status() {
    return true;
  }
  async texts(_: TextsView) {
    return true;
  }
  async sort(input: SortInput) {
    this.sorts.push(input);
    return { answer: this.sortAnswer as never };
  }
  async draft(input: DraftInput) {
    this.drafts.push(input);
    return { answer: { draft: "so glad you came" } };
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

const setup = () => {
  let now = NOW;
  const bb = new FakeBB();
  const site = new FakeSite();
  const store = memoryStore();
  const engine = new Engine({ store, bb, site, log: memoryLogger(() => now), config: DEFAULT_CONFIG, sendKey: KEY, now: () => now, offsetAt: () => 0 });
  return { bb, site, store, engine, at: (t: number) => (now = t), now: () => now };
};

const drain = async (h: ReturnType<typeof setup>) => {
  for (let i = 0; i < 10 && h.engine.pending(); i++) await h.engine.work();
};

const request = (kind: "draft" | "done", thread: string, now: number, rid: string) => {
  const f = { rid, kind, thread, draftAt: 0, text: "", until: now + REQUEST_MS };
  return { ...f, created: now, sig: signRequest(KEY, f) };
};

const threadOf = (h: ReturnType<typeof setup>, c: string): Thread => h.store.load().threads.find((t) => t.chat === chatOf(c))!;

/** Avery's "Had so much fun!" arrives and is sorted; Dialtone reads it as needing no reply. */
const fun = async (read: boolean) => {
  const h = setup();
  const last = msg("Had so much fun!", NOW - 60_000, false, A, read);
  h.bb.byChat.set(chatOf(A), [msg("thanks for coming", NOW - 120_000, true), last]);
  await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: last });
  h.at(NOW + SETTLE_MS + 1);
  await drain(h);
  return h;
};

describe("a chat kept unread in Messages is owed (#924)", () => {
  it("skips Dialtone's no-reply set-aside while unread, and settles once it is read on the phone", async () => {
    const h = await fun(false);
    expect(h.site.sorts).toHaveLength(1);
    expect(threadOf(h, A)).toMatchObject({ state: "owed", held: "no-reply", unread: true, gist: "Says it was fun" });
    const view = readTextsView(h.engine.texts(), h.now())!;
    expect(view.items.find((i) => i.name === "Avery Sample")).toMatchObject({ state: "owed", unread: true });
    // Read on the phone (iCloud brings the read time to the Mac): the read check lets the held verdict land.
    h.bb.byChat.get(chatOf(A))![1] = { ...h.bb.byChat.get(chatOf(A))![1]!, read: true };
    await h.engine.recheck();
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "no-reply" });
    expect(threadOf(h, A).held).toBeUndefined();
    // No second model call for it.
    expect(h.site.sorts).toHaveLength(1);
  });

  it("keeps today's handling for a chat Nikita has read: Dialtone's no-reply sets it aside", async () => {
    const h = await fun(true);
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "no-reply" });
  });

  it("skips closing intent while unread, and still never drafts on its own", async () => {
    const h = setup();
    const thanks = msg("thanks!", NOW - 60_000, false, A, false);
    h.bb.byChat.set(chatOf(A), [msg("Can you send the photos?", NOW - 300_000), msg("no worries, already did it", NOW - 120_000, true), thanks]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: thanks });
    h.at(NOW + SETTLE_MS + 1);
    await drain(h);
    expect(threadOf(h, A)).toMatchObject({ state: "owed", held: "closing" });
    expect(h.site.drafts).toHaveLength(0);
    // Read: closing intent lands.
    h.bb.byChat.get(chatOf(A))![2] = { ...thanks, read: true };
    await h.engine.recheck();
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "closing" });
  });

  it("never overrides a rule: money, codes, short codes, promos and the skip list still settle an unread chat", async () => {
    const h = setup();
    const money = msg("Thank you for your business, your invoice is attached", NOW - 60_000, false, A, false);
    h.bb.byChat.set(chatOf(A), [money]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: money });
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "money" });
    expect(verdictOf(chat("72345", msg("Join us tonight", NOW - DAY, false, "72345", false)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(A, msg("Your verification code is 482913", NOW - 40 * DAY, false, A, false)), NOW, [], contactOf)).toBe("settled");
    expect(verdictOf(chat(B, msg("hey", NOW - 40 * DAY, false, B, false)), NOW, ["blake example"], contactOf)).toBe("settled");
  });

  it("reaches back 60 days: the backlog owes an unread 45-day chat, lists it with its texts, and keeps it past 30", async () => {
    const h = setup();
    const old = msg("Yes", NOW - 45 * DAY, false, A, false);
    const readOld = msg("did you ever get the photos?", NOW - 45 * DAY, false, B, true);
    h.bb.byChat.set(chatOf(A), [msg("are you coming Saturday?", NOW - 46 * DAY, true), old]);
    h.bb.byChat.set(chatOf(B), [readOld]);
    h.bb.chatsList = [chat(A, old), chat(B, readOld)];
    h.site.sortAnswer = { needsReply: false, sort: "normal", gist: "Says yes" };
    expect(await h.engine.backlog()).toEqual({ owed: 1, older: 1 });
    await drain(h);
    expect(threadOf(h, A)).toMatchObject({ state: "owed", held: "no-reply", unread: true });
    await h.engine.report(true);
    const view = readTextsView(h.engine.texts(), h.now())!;
    const item = view.items.find((i) => i.name === "Avery Sample")!;
    expect(item).toMatchObject({ state: "owed", unread: true });
    expect(item.messages?.map((m) => m.text)).toEqual(["are you coming Saturday?", "Yes"]);
    expect(view.older?.items.map((o) => o.name)).toEqual(["Blake Example"]);
    h.engine.sweep();
    expect(threadOf(h, A).state).toBe("owed");
    // Past 60 days it goes, unread or not.
    h.at(NOW + 16 * DAY);
    h.engine.sweep();
    expect(h.store.load().threads.some((t) => t.chat === chatOf(A))).toBe(false);
  });

  it("on the site: an unread item lives 60 days, a read one 30", () => {
    const since = NOW - 40 * DAY;
    expect(itemLive({ state: "owed", since, last: since, unread: true }, NOW)).toBe(true);
    expect(itemLive({ state: "owed", since, last: since }, NOW)).toBe(false);
    expect(itemLive({ state: "owed", since: NOW - UNREAD_WINDOW_MS - 1, unread: true }, NOW)).toBe(false);
    expect(UNREAD_WINDOW_MS).toBe(2 * OWED_WINDOW_MS);
  });

  it("brings back a chat Relay set aside once it is unread again, on the scan and on the read check, with no model call", async () => {
    const h = await fun(true);
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "no-reply" });
    // Marked unread on the phone: the newest text has no read time again.
    const unread = { ...h.bb.byChat.get(chatOf(A))![1]!, read: false };
    h.bb.byChat.get(chatOf(A))![1] = unread;
    await h.engine.recheck();
    expect(threadOf(h, A)).toMatchObject({ state: "owed", held: "no-reply", unread: true, gist: "Says it was fun" });
    // Back to read, it settles again; then the scan sees it unread and brings it back too.
    h.bb.byChat.get(chatOf(A))![1] = { ...unread, read: true };
    await h.engine.recheck();
    expect(threadOf(h, A).state).toBe("settled");
    h.bb.chatsList = [chat(A, unread)];
    await h.engine.backlog();
    expect(threadOf(h, A)).toMatchObject({ state: "owed", held: "no-reply" });
    expect(h.site.sorts).toHaveLength(1);
  });

  it("lets Done on the Desk win until they text again", async () => {
    const h = await fun(false);
    const id = threadOf(h, A).id;
    h.site.waiting = [request("done", id, h.now(), "d".repeat(24))];
    await h.engine.act();
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "done" });
    const last = h.bb.byChat.get(chatOf(A))![1]!;
    h.bb.chatsList = [chat(A, last)];
    await h.engine.backlog();
    await h.engine.recheck();
    expect(threadOf(h, A)).toMatchObject({ state: "settled", why: "done" });
    // A new text from them makes it owed again.
    const again = msg("also, brunch Sunday?", h.now() + 60_000, false, A, false);
    h.at(h.now() + 60_000);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: again });
    expect(threadOf(h, A).state).toBe("owed");
  });

  it("leaves a large group summary-only: unread alone doesn't make it owed", () => {
    expect(verdictOf(chat(A, msg("who's in?", NOW - DAY, false, A, false), { chat: "iMessage;+;chat924", group: true, multi: true, people: 7, handle: "" }), NOW, [], contactOf)).toBe("group");
  });

  it("`relay check` says so: an unread 45-day chat is owed, a read one older", () => {
    const c = chat(A, null);
    expect(explain(c, [msg("Yes", NOW - 45 * DAY, false, A, false)], undefined, NOW, []).verdict).toBe("owed");
    expect(explain(c, [msg("Yes", NOW - 45 * DAY, false, A, true)], undefined, NOW, []).verdict).toBe("older");
  });
});

describe("Blasto drafts only on request (#923)", () => {
  it("writes no draft on its own; \"Write for me\" asks for one, once, and it never sends", async () => {
    const h = setup();
    h.site.sortAnswer = { needsReply: true, sort: "normal", gist: "Asks about Saturday" };
    const ask = msg("Are we still on for Saturday?", NOW - 60_000, false, A, true);
    h.bb.byChat.set(chatOf(A), [ask]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: ask });
    h.at(NOW + SETTLE_MS + 1);
    await drain(h);
    expect(threadOf(h, A)).toMatchObject({ state: "owed", gist: "Asks about Saturday", draft: null });
    expect(h.site.drafts).toHaveLength(0);
    h.site.waiting = [request("draft", threadOf(h, A).id, h.now(), "e".repeat(24))];
    await h.engine.act();
    expect(h.site.reported).toEqual([{ rid: "e".repeat(24), result: "done" }]);
    await drain(h);
    expect(h.site.drafts).toHaveLength(1);
    // The sort it already had stands: no second Dialtone call.
    expect(h.site.sorts).toHaveLength(1);
    expect(threadOf(h, A).draft?.text).toBe("so glad you came");
    await drain(h);
    expect(h.site.drafts).toHaveLength(1);
  });

  it("refuses a draft for a group or a thread that isn't owed", async () => {
    const h = await fun(true);
    h.site.waiting = [request("draft", threadOf(h, A).id, h.now(), "f".repeat(24))];
    await h.engine.act();
    expect(h.site.reported.at(-1)).toMatchObject({ result: "refused", reason: "not-owed" });
  });
});

describe("an unnamed group is named by its people (#923)", () => {
  it("first two and how many more for a group, every name for a small chat, \"Group chat\" with none", () => {
    expect(peopleName(["Alex", "Sam", "Kai", "Lee", "Max", "Ren", "Ty"], true)).toBe("Alex, Sam +5");
    expect(peopleName(["Alex", "Sam", "Kai"], false)).toBe("Alex, Sam, Kai");
    expect(peopleName([], true)).toBe("Group chat");
  });
});
