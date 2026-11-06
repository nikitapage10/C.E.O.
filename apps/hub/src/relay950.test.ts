import { describe, expect, it } from "vitest";
import { readTextsView, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { judge, judgeChat, sortBacklog, unreadCounts } from "./backlog.ts";
import { mutedOf, readChat, type BlueBubbles, type ChatInfo, type Contact, type Message, type Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine, RULE_GIST } from "./engine.ts";
import { isEnder } from "./enders.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";
import { asideKinds, explain, groupsFor } from "./why.ts";

/**
 * #950 (Nikita, 2026-11-06 02:00Z): "waiting" is (A) every chat whose latest inbound item is unread, as Messages'
 * Unread filter shows it, whatever its age, kind or sender, or (B) a read chat whose last text needs a reply (Dialtone
 * judges, after a cheap ender pre-pass). The scan and `relay why` share one verdict. Every name, number, address and
 * text here is made up (555 numbers, example.com).
 */

const NOW = Date.parse("2026-11-06T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
const A = "+15555550101";
const B = "+15555550102";
const MAIL = "someone@example.com";
const SHORT = "38384";
const STRANGER = "+15555550188";
const PEOPLE: Contact[] = [
  { names: ["Avery Sample"], handles: [A] },
  { names: ["Blake Example"], handles: [B] },
  { names: ["Casey Mailer"], handles: [MAIL] },
];
const chatOf = (h: string) => `iMessage;-;${h}`;
const GROUP = "iMessage;+;chat950000000000000001";
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
  sortAnswer: unknown = { needsReply: true, sort: "normal", gist: "Asks about the weekend" };
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


describe("the ender pre-pass (#950)", () => {
  it("catches obvious enders and nothing that asks, plans or tells", () => {
    for (const t of ["ok cool", "Ok cool!", "lol", "haha", "hahaha", "sounds good", "Sounds good!", "👍", "❤️", "k", "thanks!", "got it", "no worries", "see you then", "Of course you are", "Ok cool", "oh makes sense", "love you too"]) expect(isEnder(t), t).toBe(true);
    for (const t of ["ok cool, what time?", "are you free Saturday", "lol did you see the game?", "can you call me", "I got the job!", "dinner at 7 at the usual place", "", "\u200b", "haha so tomorrow we should go to the lake and hike", "of course you are coming saturday right", "you are late"]) expect(isEnder(t), t).toBe(false);
  });
});

describe("waiting is Messages' Unread filter, plus read chats that need a reply (#950)", () => {
  it("owes every unread chat: a muted named group, a small group, one-to-one, a short code, an unknown number, an email, an old thread", () => {
    const group = chat(A, msg("who's in for Saturday?", NOW - DAY, false, A), { chat: GROUP, group: true, multi: true, people: 7, handle: "", name: "Weekend Crew", muted: true });
    const small = chat(A, msg("lunch tomorrow?", NOW - DAY, false, B), { chat: "iMessage;+;chat950000000000000002", group: false, multi: true, people: 2, handle: "" });
    const got = sortBacklog(
      [
        group,
        small,
        chat(A, msg("can you send me the address", NOW - 2 * DAY)),
        chat(SHORT, msg("You're invited! RSVP at the link", NOW - 3 * DAY + 60_000, false, SHORT)),
        chat(STRANGER, msg("hi, is this still available", NOW - 2 * DAY, false, STRANGER)),
        chat(MAIL, msg("quick question about the trip", NOW - 10 * DAY, false, MAIL)),
        chat(B, msg("did you ever find out about the tickets", NOW - 52 * DAY, false, B)),
      ],
      NOW,
      [],
      contactOf,
    );
    expect(got.owed).toHaveLength(7);
    expect(got.owed.find((e) => e.chat === GROUP)).toMatchObject({ untilRead: "group", muted: true, unread: true });
    expect(got.owed.find((e) => e.chat === chatOf(SHORT))).toMatchObject({ untilRead: "short-code" });
    expect(got.owed.find((e) => e.chat === chatOf(B))).toMatchObject({ unread: true });
  });

  it("counts an unread tapback as waiting; a read one, or Nikita's own, is not", () => {
    const tap = (fromMe: boolean, read: boolean, at = NOW - DAY): ChatInfo => chat(A, null, { lastAt: at, lastItem: { fromMe, read, at, reaction: true } });
    expect(judge(tap(false, false), NOW, [], contactOf)).toEqual({ verdict: "owed" });
    expect(judge(tap(false, true), NOW, [], contactOf)).toEqual({ verdict: "settled", why: "ender" });
    expect(judge(tap(true, false), NOW, [], contactOf)).toEqual({ verdict: "answered" });
    // An unread tapback over 3 days old: the Mac's read state may be stale, so it only ends the conversation.
    expect(judge(tap(false, false, NOW - 5 * DAY), NOW, [], contactOf)).toEqual({ verdict: "settled", why: "ender" });
  });

  it("keeps money and legal set aside even unread, and lists them with why instead of dropping them", () => {
    const got = sortBacklog([chat(A, msg("Your invoice is attached, payment due Friday", NOW - DAY)), chat(B, msg("ok cool", NOW - DAY, false, B, true))], NOW, [], contactOf);
    expect(got.owed).toEqual([]);
    expect(got.aside.map((a) => [a.chat, a.why])).toEqual([
      [chatOf(A), "money"],
      [chatOf(B), "ender"],
    ]);
    expect(asideKinds([{ group: false, state: "settled", why: "money" }, { group: false, state: "settled", why: "money" }, { group: false, state: "settled", why: "ender" }])).toBe("2 money or legal words (kept from the models), 1 only an ok, a lol or a tapback");
  });

  it("sends a read chat on to Dialtone unless it only ends the conversation; an old unread ender ends too", () => {
    expect(judge(chat(A, msg("are you around this weekend?", NOW - 2 * DAY, false, A, true)), NOW, [], contactOf).verdict).toBe("owed");
    expect(judge(chat(A, msg("lol", NOW - 2 * DAY, false, A, true)), NOW, [], contactOf)).toEqual({ verdict: "settled", why: "ender" });
    expect(judge(chat(A, msg("lol", NOW - 2 * DAY)), NOW, [], contactOf).verdict).toBe("owed");
    expect(judge(chat(A, msg("lol", NOW - 4 * DAY)), NOW, [], contactOf)).toEqual({ verdict: "settled", why: "ender" });
  });

  it("judges by the newest message by date, not the chat query's last (BlueBubbles' MAX(ROWID))", () => {
    // The chat query says Nikita's own message is last (written late by iCloud with a higher ROWID); by date theirs is.
    const c = chat(A, msg("see you", NOW - 9 * DAY, true));
    const msgs = [msg("see you", NOW - 9 * DAY, true), msg("are we still on for next week?", NOW - 5 * DAY)];
    expect(judge(c, NOW, [], contactOf).verdict).toBe("answered");
    expect(judgeChat(c, msgs, NOW, [], contactOf).judged.verdict).toBe("owed");
  });

  it("reads a muted mark and a group's own name from BlueBubbles' chat rows", () => {
    expect(mutedOf([{ ignoreAlertsFlag: true }])).toBe(true);
    expect(mutedOf({ ignoreAlertsFlag: 1 })).toBe(true);
    expect(mutedOf(null)).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ address: `+1555555030${i}` }));
    const row = { guid: GROUP, style: 43, displayName: " Weekend Crew ", participants: six, properties: [{ ignoreAlertsFlag: true }], lastMessage: { guid: "g1", text: "who's in?", isFromMe: false, dateCreated: NOW - DAY, dateRead: null, itemType: 0 } };
    expect(readChat(row)).toMatchObject({ group: true, name: "Weekend Crew", muted: true, lastItem: { fromMe: false, read: false, reaction: false } });
    const tap = readChat({ ...row, lastMessage: { ...row.lastMessage, associatedMessageGuid: "p:0/x", associatedMessageType: 2000 } })!;
    expect(tap.last).toBeNull();
    expect(tap.lastItem).toMatchObject({ reaction: true, read: false });
    expect(groupsFor([readChat(row)!], "weekend").map((c) => c.chat)).toEqual([GROUP]);
  });

  it("counts the Mac's unread chats and the stale ones for relay check", () => {
    const u = unreadCounts([chat(A, msg("hey", NOW - DAY)), chat(B, msg("hey", NOW - 10 * DAY, false, B)), chat(MAIL, msg("hey", NOW - DAY, false, MAIL, true)), chat(STRANGER, msg("hi", NOW - DAY, true))], NOW);
    expect(u).toEqual({ unread: 2, stale: 1 });
  });
});

describe("the full scan and relay why agree (#950)", () => {
  it("writes a row for every chat why calls waiting, groups and strangers included, and lists the set-aside ones", async () => {
    const h = setup();
    const chats: [ChatInfo, Message[]][] = [
      // A one-to-one chat whose chat-query last message is an older one of Nikita's (the ROWID case).
      [chat(A, msg("see you", NOW - 20 * DAY, true)), [msg("see you", NOW - 20 * DAY, true), msg("are we still on for next week?", NOW - 18 * DAY)]],
      [chat(STRANGER, msg("hi, is this still available", NOW - 12 * DAY, false, STRANGER)), [msg("hi, is this still available", NOW - 12 * DAY, false, STRANGER)]],
      [chat(SHORT, msg("You're invited! RSVP at the link", NOW - DAY, false, SHORT)), [msg("You're invited! RSVP at the link", NOW - DAY, false, SHORT)]],
      [chat(B, msg("ok cool", NOW - 2 * DAY, false, B, true)), [msg("can you make it", NOW - 3 * DAY, true), msg("ok cool", NOW - 2 * DAY, false, B, true)]],
      [chat(MAIL, msg("Your invoice is attached, payment due Friday", NOW - DAY, false, MAIL)), [msg("Your invoice is attached, payment due Friday", NOW - DAY, false, MAIL)]],
      [
        chat(A, msg("who's in for Saturday?", NOW - DAY, false, A), { chat: GROUP, group: true, multi: true, people: 7, handle: "", name: "Weekend Crew", muted: true, members: Array.from({ length: 7 }, (_, i) => `+1555555040${i}`) }),
        [msg("who's in for Saturday?", NOW - DAY, false, "+15555550400")],
      ],
    ];
    h.bb.chatsList = chats.map(([c]) => c);
    for (const [c, m] of chats) h.bb.byChat.set(c.chat, m);
    await h.engine.backlog();
    const state = h.store.load();
    for (const [c, m] of chats) {
      const why = explain(c, m, state.threads.find((t) => t.chat === c.chat), NOW, []);
      const row = state.threads.find((t) => t.chat === c.chat);
      if (why.verdict === "owed") expect(row?.state, c.chat).toBe("owed");
      else expect(row?.state ?? "none", c.chat).not.toBe("owed");
    }
    expect(state.threads.filter((t) => t.state === "owed").map((t) => t.chat).sort()).toEqual([chatOf(A), chatOf(SHORT), chatOf(STRANGER), GROUP].sort());
    expect(state.threads.find((t) => t.chat === GROUP)).toMatchObject({ group: true, held: "group", muted: true });
    // The short code waits with the hub's own line and never reaches a model.
    while (h.engine.pending()) await h.engine.work();
    expect(state.threads.find((t) => t.chat === chatOf(SHORT))).toBeDefined();
    expect(h.store.load().threads.find((t) => t.chat === chatOf(SHORT))).toMatchObject({ state: "owed", gist: RULE_GIST["short-code"], held: "short-code" });
    expect(JSON.stringify(h.site.sorts)).not.toMatch(/invited|invoice/);
    await h.engine.report(true);
    const view = readTextsView(h.engine.texts(), NOW)!;
    // The group's chip carries its own name and the muted mark; the money one is listed as set aside.
    expect(view.items.find((i) => i.group)).toMatchObject({ name: "Weekend Crew", muted: true, state: "owed" });
    expect(view.aside?.map((a) => a.why).sort()).toEqual(["ender", "money"]);
    // Read on the Mac, the short code's wait ends and it is set aside as before.
    h.bb.byChat.set(chatOf(SHORT), [msg("You're invited! RSVP at the link", NOW - DAY, false, SHORT, true)]);
    await h.engine.recheck();
    expect(h.store.load().threads.find((t) => t.chat === chatOf(SHORT))).toMatchObject({ state: "settled", why: "short-code" });
  });
});
