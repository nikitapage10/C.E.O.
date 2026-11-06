import { describe, expect, it } from "vitest";
import { readTextsView, type RequestResult, type Reason, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import { readDraftInput, readSortInput } from "../../../api/_relay/models.ts";
import { REQUEST_MS, signRequest } from "../../../api/_relay/tokens.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { queueOf } from "../../../rooms/relay/data/thread.ts";
import { bigGroup, GROUP_MIN_PEOPLE, readChat, readPolled, type BlueBubbles, type ChatInfo, type Contact, type Inbound, type Message, type Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine, SETTLE_MS } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";

/**
 * #916 (Nikita, 2026-11-05: "group chats should only be designated as ... 6 or more users. Anything underneath that is
 * less of a group chat and still more of a regular chat"): a chat of several with fewer than GROUP_MIN_PEOPLE other
 * people is handled as a one-to-one thread (owed, a gist and a draft, on the Desk's line with its texts, in the owed
 * count, its reply to the chat itself); 6 or more stays a group. Every name, number and text is made up (555 numbers).
 */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 9);
const num = (i: number) => `+1555555${String(200 + i).padStart(4, "0")}`;
const FIRST = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper"];
const PEOPLE: Contact[] = FIRST.map((n, i) => ({ names: [`${n} Sample`], handles: [num(i)] }));
const SMALL = "iMessage;+;chat000000000000000916";
const BIG = "iMessage;+;chat000000000000000917";
const members = (n: number) => Array.from({ length: n }, (_, i) => num(i));
const inbound = (chat: string, people: number, text: string, at: number, handle: string): Inbound => ({ chat, group: bigGroup(people), multi: true, people, members: members(people), groupName: "", message: { text, fromMe: false, at, handle, read: false } });

class FakeBB implements BlueBubbles {
  byChat = new Map<string, Message[]>();
  size = new Map<string, number>();
  sent: { chat: string; text: string }[] = [];
  async ping() {
    return true;
  }
  async contacts() {
    return PEOPLE;
  }
  async messages(c: string, limit: number) {
    return [...(this.byChat.get(c) ?? [])].sort((a, b) => b.at - a.at).slice(0, limit);
  }
  async send(chat: string, text: string) {
    this.sent.push({ chat, text });
    return true;
  }
  async react(): Promise<boolean> {
    return true;
  }
  async privateApi(): Promise<boolean | null> {
    return true;
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
  async chatList(offset: number, limit: number) {
    // The chat query's last message carries no handle (BlueBubbles 1.9.12), as on the Mac.
    const all: ChatInfo[] = [...this.byChat].map(([chat, ms]) => {
      const last = [...ms].sort((a, b) => b.at - a.at)[0] ?? null;
      const people = this.size.get(chat) ?? 1;
      return { chat, group: bigGroup(people), multi: true, people, members: members(people), name: "", handle: "", last: last && { ...last, handle: "" }, lastAt: last?.at ?? 0 };
    });
    return all.slice(offset, offset + limit);
  }
}

class FakeSite implements Site {
  views: TextsView[] = [];
  sorts: SortInput[] = [];
  drafts: DraftInput[] = [];
  waiting: unknown[] = [];
  reported: { rid: string; result: RequestResult; reason?: Reason }[] = [];
  async status() {
    return true;
  }
  async texts(v: TextsView) {
    this.views.push(JSON.parse(JSON.stringify(v)) as TextsView);
    return true;
  }
  async sort(input: SortInput) {
    this.sorts.push(input);
    return { answer: (input.group ? { summary: "Member 1 and Member 2 plan Sunday.", asked: false } : { needsReply: true, sort: "normal", gist: "Member 1 asks if you can bring chairs" }) as never };
  }
  async draft(input: DraftInput) {
    this.drafts.push(input);
    return { answer: { draft: "Sure Member 1, I'll bring two" } };
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
  async results(r: { rid: string; result: RequestResult; reason?: Reason }[]) {
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

/** A chat of `people` others, two of them asking Nikita something; one of his own lines before. */
async function chatOf(chat: string, people: number) {
  const h = setup();
  h.bb.size.set(chat, people);
  h.bb.byChat.set(chat, [
    { text: "see you all soon", fromMe: true, at: NOW - 10 * 60_000, handle: "" },
    { text: "Sunday at noon?", fromMe: false, at: NOW - 5 * 60_000, handle: num(0), read: false },
    { text: "Can you bring chairs?", fromMe: false, at: NOW - 60_000, handle: num(1), read: false },
  ]);
  await h.engine.onMessage(inbound(chat, people, "Can you bring chairs?", NOW - 60_000, num(1)));
  h.at(NOW + SETTLE_MS + 1);
  for (let i = 0; i < 4 && h.engine.pending(); i++) await h.engine.work();
  // A regular chat's draft comes on "Write for me" (#923): a signed "draft" request.
  const t = h.store.load().threads.find((x) => x.chat === chat);
  if (t && !t.group) {
    const f = { rid: "e".repeat(24), kind: "draft" as const, thread: t.id, draftAt: 0, text: "", until: h.now() + REQUEST_MS };
    h.site.waiting = [{ ...f, created: h.now(), sig: signRequest(KEY, f) }];
    await h.engine.act();
    await h.engine.work();
  }
  await h.engine.report(true);
  return h;
}

describe("the group line is one named constant (#916)", () => {
  it("6 or more other people make a group; fewer, or a size BlueBubbles didn't give, as before", () => {
    expect(GROUP_MIN_PEOPLE).toBe(6);
    expect([2, 3, 5].map(bigGroup)).toEqual([false, false, false]);
    expect([6, 12].map(bigGroup)).toEqual([true, true]);
    expect(bigGroup(null)).toBe(true);
  });

  it("BlueBubbles' chats and polled messages are read with their size", () => {
    const parts = (n: number) => members(n).map((address) => ({ address }));
    const row = (n: number) => ({ guid: SMALL, style: 43, displayName: "", participants: parts(n), lastMessage: { guid: "m1", text: "hi", isFromMe: false, dateCreated: NOW, handle: null } });
    expect(readChat(row(3))).toMatchObject({ group: false, multi: true, people: 3, handle: "" });
    expect(readChat(row(6))).toMatchObject({ group: true, multi: true, people: 6 });
    expect(readChat({ ...row(0), participants: undefined })).toMatchObject({ group: true, multi: true, people: null });
    const polled = (n: number) => readPolled({ guid: "g1", text: "hi", isFromMe: false, dateCreated: NOW, handle: { address: num(0) }, chats: [{ guid: SMALL, displayName: "", participants: parts(n) }] })?.inbound;
    expect(polled(3)).toMatchObject({ group: false, multi: true, people: 3 });
    expect(polled(6)).toMatchObject({ group: true, multi: true, people: 6 });
  });
});

describe("a small chat of several is a regular chat (#916)", () => {
  it("a 3-person chat becomes owed, gets a gist and a draft, and shows on the Desk's line with its texts", async () => {
    const h = await chatOf(SMALL, 3);
    const t = h.store.load().threads.find((x) => x.chat === SMALL)!;
    expect(t).toMatchObject({ group: false, state: "owed", gist: "Avery asks if you can bring chairs" });
    // Blasto drafts it; the people are "Member N" to the models, every line of theirs "them", and the name comes back.
    expect(h.site.sorts.at(-1)!.group).toBe(false);
    expect(h.site.drafts).toHaveLength(1);
    const draft = h.site.drafts[0]!;
    expect(readDraftInput(JSON.parse(JSON.stringify(draft)))).not.toBeNull();
    expect(readSortInput(JSON.parse(JSON.stringify(h.site.sorts.at(-1))))).not.toBeNull();
    expect(draft.lines.map((l) => l.from)).toEqual(["me", "them", "them"]);
    expect(JSON.stringify([h.site.sorts, h.site.drafts])).not.toMatch(/Avery|Blake|555/);
    expect(t.draft?.text).toBe("Sure Avery, I'll bring two");
    // The hub's owed count has it.
    expect(h.engine.status()!.owed).toBe(1);
    // The Desk: the site reads the list, the item is a regular one named by its people, with who said each line.
    const view = readTextsView(h.site.views.at(-1), h.now());
    expect(view).not.toBeNull();
    const item = view!.items.find((i) => i.id === t.id)!;
    expect(item).toMatchObject({ group: false, state: "owed", name: "Avery, Blake, Casey" });
    expect(item.draft?.text).toBe("Sure Avery, I'll bring two");
    expect(item.messages?.map((m) => [m.from ?? null, m.me ?? null])).toEqual([
      [null, true],
      ["Avery Sample", null],
      ["Blake Sample", null],
    ]);
    // On the Desk's Relay line, sendable, with its texts.
    const line = queueOf([], view!.items, [], true).find((e) => e.id === t.id);
    expect(line).toMatchObject({ who: "Avery, Blake, Casey", sendable: true });
    expect(line?.messages?.length).toBe(3);
  });

  it("its reply goes to the chat itself, through the same signed, single-use, draft-bound send", async () => {
    const h = await chatOf(SMALL, 3);
    const t = h.store.load().threads.find((x) => x.chat === SMALL)!;
    const now = h.now();
    const f = { rid: "c".repeat(24), kind: "send" as const, thread: t.id, draftAt: t.draft!.at, text: t.draft!.text, until: now + REQUEST_MS };
    h.site.waiting = [{ ...f, created: now, sig: signRequest(KEY, f) }];
    await h.engine.act();
    expect(h.bb.sent).toEqual([{ chat: SMALL, text: "Sure Avery, I'll bring two" }]);
    expect(h.site.reported.at(-1)).toEqual({ rid: "c".repeat(24), result: "sent" });
    // Once only.
    h.site.waiting = [{ ...f, created: now, sig: signRequest(KEY, f) }];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);
    // Unsigned: refused.
    h.site.waiting = [{ ...f, rid: "d".repeat(24), created: now, sig: "0".repeat(64) }];
    await h.engine.act();
    expect(h.bb.sent).toHaveLength(1);
  });

  it("the backlog finds an owed small chat though the chat query names no sender", async () => {
    const h = setup();
    h.bb.size.set(SMALL, 4);
    h.bb.byChat.set(SMALL, [{ text: "Are you coming Friday?", fromMe: false, at: NOW - 2 * DAY, handle: num(2), read: false }]);
    await h.engine.backlog();
    expect(h.store.load().threads.find((x) => x.chat === SMALL)).toMatchObject({ group: false, state: "owed" });
  });
});

describe("6 or more other people stay a group (#916)", () => {
  it("a 6-person chat is summarised, never drafted for, and stays off the Desk's line", async () => {
    const h = await chatOf(BIG, 6);
    const t = h.store.load().threads.find((x) => x.chat === BIG)!;
    expect(t.group).toBe(true);
    expect(t.summary?.text).toBe("Member 1 and Member 2 plan Sunday.");
    expect(h.site.sorts.every((s) => s.group)).toBe(true);
    expect(h.site.drafts).toHaveLength(0);
    const view = readTextsView(h.site.views.at(-1), h.now())!;
    // Unnamed in Messages, it is named by its first two people and how many more (#923), not "Group chat".
    expect(view.items.find((i) => i.id === t.id)).toMatchObject({ group: true, name: "Avery, Blake +4" });
    expect(queueOf([], view.items, [], true).some((e) => e.id === t.id)).toBe(false);
  });

  it("a chat that was a group under the old line becomes a regular chat once its size is known", async () => {
    const h = setup();
    h.bb.byChat.set(SMALL, [{ text: "Lunch tomorrow?", fromMe: false, at: NOW - 60_000, handle: num(0), read: false }]);
    // An earlier hub's group row, its size unknown.
    await h.engine.onMessage({ chat: SMALL, group: true, groupName: "", message: { text: "Lunch tomorrow?", fromMe: false, at: NOW - 120_000, handle: num(0) } });
    expect(h.store.load().threads[0]).toMatchObject({ group: true, state: "settled", why: "group" });
    await h.engine.onMessage(inbound(SMALL, 2, "Lunch tomorrow?", NOW - 60_000, num(0)));
    expect(h.store.load().threads[0]).toMatchObject({ group: false, state: "owed", summary: null });
  });
});
