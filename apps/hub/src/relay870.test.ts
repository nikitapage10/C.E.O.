import { describe, expect, it } from "vitest";
import { readTextsView, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import { REQUEST_MS, signRequest } from "../../../api/_relay/tokens.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { verdictOf } from "./backlog.ts";
import { readAvatar, readMessage, type BlueBubbles, type ChatInfo, type Contact, type Message, type Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine, MEDIA_GIST, MEDIA_LINE, SETTLE_MS } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";
import { chatsFor, describeWhy, explain, whoMatches } from "./why.ts";

/**
 * #870: texts missing from the Desk's line. A photo-only text counts; a thread an earlier verdict set aside comes back
 * for a fresh look once per text (a rule's settle never does); every recent one-to-one thread is listed, set aside
 * ones with why; "Bring back"; `relay why`; contact pictures in each shape BlueBubbles has used. Every name, number
 * and text here is made up (555 numbers).
 */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
const A = "+15555550101";
const B = "+15555550102";
const PEOPLE: Contact[] = [
  { names: ["Avery Sample"], handles: [A] },
  { names: ["Blake Example"], handles: [B] },
];
const chatOf = (h: string) => `iMessage;-;${h}`;
const msg = (text: string, at: number, fromMe = false, handle = A, extra: Partial<Message> = {}): Message => ({ text, fromMe, at, handle: fromMe ? "" : handle, read: true, ...extra });
const photo = (at: number, handle = A): Message => msg("", at, false, handle, { media: true });
const chat = (h: string, last: Message | null): ChatInfo => ({ chat: chatOf(h), group: false, name: "", handle: h, last, lastAt: last?.at ?? 0 });

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
  async send(_chat: string, _text: string): Promise<boolean> {
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
  sortAnswer: unknown = { needsReply: true, sort: "normal", gist: "Asks about Friday" };
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
    return { answer: { draft: "yes, Friday works" } };
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
  return { bb, site, store, engine, at: (t: number) => (now = t) };
};

/** Every round of work until nothing waits. */
const drain = async (h: ReturnType<typeof setup>) => {
  for (let i = 0; i < 10 && h.engine.pending(); i++) await h.engine.work();
};

const back = (thread: string, now: number) => {
  const f = { rid: "d".repeat(24), kind: "back" as const, thread, draftAt: 0, text: "", until: now + REQUEST_MS };
  return { ...f, created: now, sig: signRequest(KEY, f) };
};

describe("a photo or file with no words (#870)", () => {
  it("is read as an attachment: Messages' mark comes out of the text, and BlueBubbles' flags count", () => {
    expect(readMessage({ text: "￼", isFromMe: false, dateCreated: NOW, handle: { address: A } })).toMatchObject({ text: "", media: true });
    expect(readMessage({ text: "look￼", isFromMe: false, dateCreated: NOW })).toMatchObject({ text: "look", media: true });
    expect(readMessage({ text: null, hasAttachments: true, dateCreated: NOW })).toMatchObject({ text: "", media: true });
    expect(readMessage({ text: "hey", dateCreated: NOW })?.media).toBeUndefined();
    // A tapback is still not a message.
    expect(readMessage({ text: "Loved an image", associatedMessageGuid: "p:0/x", dateCreated: NOW })).toBeNull();
  });

  it("makes the backlog owe the chat, as its last message or found on the closer look", () => {
    expect(verdictOf(chat(A, photo(NOW - DAY)), NOW, [], () => undefined)).toBe("owed");
    expect(verdictOf(chat(A, photo(NOW - 40 * DAY)), NOW, [], () => undefined)).toBe("older");
  });

  it("arriving alone, puts the person on the line at the top with a Photo line and a count, and no model call", async () => {
    const h = setup();
    h.bb.byChat.set(chatOf(B), [msg("see you", NOW - 2 * DAY, true), msg("Are we still on?", NOW - DAY, false, B)]);
    await h.engine.onMessage({ chat: chatOf(B), group: false, groupName: "", message: msg("Are we still on?", NOW - DAY, false, B) });
    h.bb.byChat.set(chatOf(A), [msg("ok", NOW - 3 * DAY, true), photo(NOW - 60_000)]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: photo(NOW - 60_000) });
    h.at(NOW + SETTLE_MS);
    await drain(h);
    const t = h.store.load().threads.find((x) => x.chat === chatOf(A))!;
    expect(t).toMatchObject({ state: "owed", gist: MEDIA_GIST, media: 1 });
    // Only Blake's words went to Dialtone; nothing for the photo.
    expect(h.site.sorts).toHaveLength(1);
    await h.engine.report(true);
    const view = readTextsView(h.engine.texts(), NOW + SETTLE_MS)!;
    expect(view.items[0]).toMatchObject({ name: "Avery Sample", state: "owed", media: 1, messages: [{ text: "ok", me: true }, { text: "Photo", media: true }] });
    expect(view.items[1]?.name).toBe("Blake Example");
  });

  it("shows to a model as a marker only, beside the words", async () => {
    const h = setup();
    h.bb.byChat.set(chatOf(A), [msg("see you", NOW - 2 * DAY, true), photo(NOW - 120_000), msg("what do you think?", NOW - 60_000)]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: msg("what do you think?", NOW - 60_000) });
    h.at(NOW + SETTLE_MS);
    await drain(h);
    expect(h.site.sorts[0]!.lines.map((l) => l.text)).toEqual(["see you", MEDIA_LINE, "what do you think?"]);
    expect(h.store.load().threads[0]).toMatchObject({ state: "owed", media: 1 });
  });

  it("from them after Nikita's last message doesn't close the thread as answered", async () => {
    const h = setup();
    h.bb.byChat.set(chatOf(A), [msg("Are we on?", NOW - 3_000), msg("yes!", NOW - 2_000, true), photo(NOW - 1_000)]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: photo(NOW - 1_000) });
    h.at(NOW + SETTLE_MS);
    await drain(h);
    expect(h.store.load().threads[0]?.state).toBe("owed");
  });
});

describe("a thread an earlier verdict set aside (#870)", () => {
  it("gets a new text: re-opened, sorted afresh and listed first by date", async () => {
    const h = setup();
    h.site.sortAnswer = { needsReply: false, sort: "normal", gist: "Just saying hi" };
    h.bb.byChat.set(chatOf(A), [msg("hi!", NOW - DAY)]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: msg("hi!", NOW - DAY) });
    h.bb.byChat.set(chatOf(B), [msg("Can you call me?", NOW - 2 * DAY, false, B)]);
    await h.engine.onMessage({ chat: chatOf(B), group: false, groupName: "", message: msg("Can you call me?", NOW - 2 * DAY, false, B) });
    h.at(NOW + SETTLE_MS);
    await drain(h);
    expect(h.store.load().threads.every((t) => t.state === "settled" && t.why === "no-reply")).toBe(true);
    // Set aside, the two still show by date, with why.
    expect(readTextsView(h.engine.texts(), NOW + SETTLE_MS)!.aside?.map((a) => [a.name, a.why])).toEqual([
      ["Avery Sample", "no-reply"],
      ["Blake Example", "no-reply"],
    ]);
    h.site.sortAnswer = { needsReply: true, sort: "sooner", gist: "Asks for a call back" };
    h.bb.byChat.get(chatOf(B))!.push(msg("It's about Saturday", NOW + DAY, false, B));
    h.at(NOW + DAY);
    await h.engine.onMessage({ chat: chatOf(B), group: false, groupName: "", message: msg("It's about Saturday", NOW + DAY, false, B) });
    h.at(NOW + DAY + SETTLE_MS);
    await drain(h);
    const view = readTextsView(h.engine.texts(), NOW + DAY + SETTLE_MS)!;
    expect(view.items[0]).toMatchObject({ name: "Blake Example", state: "owed", gist: "Asks for a call back" });
    expect(view.aside?.map((a) => a.name)).toEqual(["Avery Sample"]);
  });

  it("is revisited by the next scan once per text when the model or closing intent set it aside; a rule's settle stays", async () => {
    const h = setup();
    // An earlier hub's state: Avery set aside by Dialtone, Blake by the money rule, both on their latest text.
    const avery = [msg("Are we still on for Friday?", NOW - DAY)];
    const blake = [msg("I sent the $20 for the tickets", NOW - DAY, false, B)];
    h.bb.byChat.set(chatOf(A), avery);
    h.bb.byChat.set(chatOf(B), blake);
    h.bb.chatsList = [chat(A, avery[0]!), chat(B, blake[0]!)];
    const row = (id: string, c: string, why: "no-reply" | "money") => ({ id, chat: c, group: false, state: "settled" as const, why, since: NOW - DAY, lastIn: NOW - DAY, sort: null, gist: "", sortedAt: NOW - DAY + 60_000, laterUntil: null, laterSet: null, draft: null, summary: null, repliedAt: null });
    h.store.save({ ...h.store.load(), threads: [row("aaaaaaaaaaaaaaaa", chatOf(A), "no-reply"), row("bbbbbbbbbbbbbbbb", chatOf(B), "money")] });
    await h.engine.backlog();
    expect(h.store.load().threads.find((t) => t.chat === chatOf(A))).toMatchObject({ state: "owed", rechecked: NOW - DAY });
    expect(h.store.load().threads.find((t) => t.chat === chatOf(B))).toMatchObject({ state: "settled", why: "money" });
    await drain(h);
    expect(h.store.load().threads.find((t) => t.chat === chatOf(A))).toMatchObject({ state: "owed", gist: "Asks about Friday" });
    // Dialtone says no reply this time: the next scan leaves that verdict for the same text.
    h.site.sortAnswer = { needsReply: false, sort: "normal", gist: "Nothing to answer" };
    h.store.save({ ...h.store.load(), threads: h.store.load().threads.map((t) => (t.chat === chatOf(A) ? { ...t, state: "settled", why: "no-reply" } : t)) });
    await h.engine.backlog();
    expect(h.store.load().threads.find((t) => t.chat === chatOf(A))?.state).toBe("settled");
    // The money one is listed as set aside, with its kind and no text, and can't be brought back.
    const view = readTextsView(h.engine.texts(), NOW)!;
    expect(view.aside?.find((a) => a.name === "Blake Example")?.why).toBe("money");
    expect(JSON.stringify(view)).not.toMatch(/\$20|tickets|555/);
    h.site.waiting = [back("bbbbbbbbbbbbbbbb", NOW)];
    await h.engine.act();
    expect(h.site.reported.at(-1)).toMatchObject({ result: "refused", reason: "not-owed" });
  });

  it("comes back on Bring back and stays owed, whatever Dialtone reads, until Nikita replies", async () => {
    const h = setup();
    h.site.sortAnswer = { needsReply: false, sort: "normal", gist: "Just saying hi" };
    h.bb.byChat.set(chatOf(A), [msg("hi!", NOW - DAY)]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: msg("hi!", NOW - DAY) });
    h.at(NOW + SETTLE_MS);
    await drain(h);
    const id = h.store.load().threads[0]!.id;
    h.site.waiting = [back(id, NOW + SETTLE_MS)];
    await h.engine.act();
    expect(h.site.reported.at(-1)).toEqual({ rid: "d".repeat(24), result: "done" });
    await drain(h);
    expect(h.store.load().threads[0]).toMatchObject({ state: "owed", kept: true, gist: "Just saying hi" });
    // Blasto drafts only on "Write for me" (#923).
    expect(h.site.drafts).toHaveLength(0);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: msg("hey", NOW + DAY, true) });
    expect(h.store.load().threads[0]?.state).toBe("replied");
    expect(h.store.load().threads[0]?.kept).toBeUndefined();
  });
});

describe("multi-send (#870, Nikita 2026-11-05)", () => {
  const send = (rid: string, thread: string, text: string, now: number) => {
    const f = { rid, kind: "send" as const, thread, draftAt: 0, text, until: now + REQUEST_MS };
    return { ...f, created: now, sig: signRequest(KEY, f) };
  };
  const done = (rid: string, thread: string, now: number) => {
    const f = { rid, kind: "done" as const, thread, draftAt: 0, text: "", until: now + REQUEST_MS };
    return { ...f, created: now, sig: signRequest(KEY, f) };
  };
  const owedOne = async () => {
    const h = setup();
    const sent: string[] = [];
    h.bb.byChat.set(chatOf(A), [msg("Are we still on for Friday?", NOW - DAY)]);
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: msg("Are we still on for Friday?", NOW - DAY) });
    h.at(NOW + SETTLE_MS);
    await drain(h);
    // The draft goes with the first send; these are typed words, bound to no draft.
    h.store.save({ ...h.store.load(), threads: h.store.load().threads.map((t) => ({ ...t, draft: null })) });
    h.bb.send = async (_c: string, text: string) => {
      sent.push(text);
      return true;
    };
    return { h, sent, id: h.store.load().threads[0]!.id, now: NOW + SETTLE_MS };
  };

  it("sends twice to one thread, keeps it in the queue after each, and only Done settles it", async () => {
    const { h, sent, id, now } = await owedOne();
    h.site.waiting = [send("1".repeat(24), id, "Yes!", now)];
    await h.engine.act();
    // Messages shows the reply; the poll reads it back, and the closing check runs: still in the queue.
    h.bb.byChat.get(chatOf(A))!.push(msg("Yes!", now + 1, true));
    await h.engine.onMessage({ chat: chatOf(A), group: false, groupName: "", message: msg("Yes!", now + 1, true) });
    await h.engine.recheck();
    expect(h.store.load().threads[0]).toMatchObject({ state: "owed", draft: null });
    h.site.waiting = [send("2".repeat(24), id, "See you at 7", now)];
    await h.engine.act();
    expect(sent).toEqual(["Yes!", "See you at 7"]);
    expect(h.site.reported.map((r) => r.result)).toEqual(["sent", "sent"]);
    expect(h.store.load().threads[0]?.state).toBe("owed");
    expect(readTextsView(h.engine.texts(), now)!.items.map((i) => i.name)).toEqual(["Avery Sample"]);
    h.site.waiting = [done("3".repeat(24), id, now)];
    await h.engine.act();
    expect(h.store.load().threads[0]).toMatchObject({ state: "settled", why: "done" });
    expect(h.store.load().threads[0]?.sentHere).toBeUndefined();
  });

  it("#914: Done stays done through a rescan and the sweep, even for a text the hub's lastIn missed; a newer text brings it back", async () => {
    const { h, id, now: t0 } = await owedOne();
    // A text of theirs the poll never read (the hub was asleep), after Dialtone's sort: Messages has it, lastIn doesn't.
    const missed = msg("also, bring the charger", t0 + 30 * 60_000);
    h.bb.byChat.get(chatOf(A))!.push(missed);
    const info = (last: Message): ChatInfo => ({ chat: chatOf(A), group: false, name: "", handle: A, last, lastAt: last.at });
    h.bb.chatsList = [info(missed)];
    // Nikita sees it on the Desk an hour later and presses Done.
    const now = t0 + 60 * 60_000;
    h.at(now);
    h.site.waiting = [done("6".repeat(24), id, now)];
    await h.engine.act();
    expect(h.store.load().threads[0]).toMatchObject({ state: "settled", why: "done", doneAt: now });
    // A rescan (each hub start and each day): their latest text is older than the Done, so it stays done.
    await h.engine.backlog();
    expect(h.store.load().threads[0]).toMatchObject({ state: "settled", why: "done" });
    expect(readTextsView(h.engine.texts(), now)!.items).toEqual([]);
    // The sweep keeps the row through the owed window from the Done, so no rescan re-lists it as a new thread.
    h.at(missed.at + 30 * DAY + 60_000);
    h.engine.sweep();
    expect(h.store.load().threads.map((t) => t.id)).toEqual([id]);
    // A newer text from them after the Done: back in line.
    const later = msg("you there?", missed.at + 30 * DAY + 120_000);
    h.at(later.at + 1);
    h.bb.byChat.get(chatOf(A))!.push(later);
    h.bb.chatsList = [info(later)];
    await h.engine.backlog();
    expect(h.store.load().threads[0]?.state).toBe("owed");
  });

  it("never acts on one request id twice, and a Resend of a text Messages already shows is refused", async () => {
    const { h, sent, id, now } = await owedOne();
    const once = send("4".repeat(24), id, "Yes!", now);
    h.site.waiting = [once];
    await h.engine.act();
    h.site.waiting = [once];
    await h.engine.act();
    expect(sent).toEqual(["Yes!"]);
    expect(h.site.reported.at(-1)).toMatchObject({ result: "refused", reason: "replay" });
    // A Resend (a new id) of the same text, once Messages shows it went: refused, not sent twice.
    h.bb.byChat.get(chatOf(A))!.push(msg("Yes!", now + 1, true));
    h.site.waiting = [send("5".repeat(24), id, "Yes!", now)];
    await h.engine.act();
    expect(sent).toEqual(["Yes!"]);
    expect(h.site.reported.at(-1)).toMatchObject({ result: "refused", reason: "answered" });
  });
});

describe("relay why (#870)", () => {
  it("finds the contact by name or number and gives each chat's verdict and dates, never the text", () => {
    expect(whoMatches(PEOPLE, "avery").map((c) => c.names[0])).toEqual(["Avery Sample"]);
    expect(whoMatches(PEOPLE, "0102").map((c) => c.names[0])).toEqual(["Blake Example"]);
    const chats = [chat(A, null), chat(B, null)];
    expect(chatsFor(chats, [A]).map((c) => c.chat)).toEqual([chatOf(A)]);
    const at = (text: string, t: number, fromMe = false) => msg(text, t, fromMe);
    expect(explain(chat(A, null), [at("Are we on?", NOW - DAY)], undefined, NOW, []).verdict).toBe("owed");
    expect(explain(chat(A, null), [at("Are we on?", NOW - DAY), at("yes", NOW - 1_000, true)], undefined, NOW, []).verdict).toBe("answered");
    expect(explain(chat(A, null), [at("no worries", NOW - 2 * DAY, true), at("thanks!", NOW - DAY)], undefined, NOW, []).verdict).toBe("ender");
    expect(explain(chat(A, null), [at("Your rent payment of $1,450 is past due", NOW - DAY)], undefined, NOW, [])).toMatchObject({ verdict: "settled", rule: "money" });
    expect(explain(chat(A, null), [at("hello?", NOW - 40 * DAY)], undefined, NOW, []).verdict).toBe("older");
    expect(explain({ ...chat(A, null), group: true }, [], undefined, NOW, []).verdict).toBe("group");
    const w = explain(chat(A, null), [at("see you", NOW - 3 * DAY, true), photo(NOW - DAY), at("Are we on? I paid the invoice", NOW - 1_000)], { id: "aaaaaaaaaaaaaaaa", chat: chatOf(A), group: false, state: "settled", why: "no-reply", since: 0, lastIn: 0, sort: null, gist: "", sortedAt: null, laterUntil: null, laterSet: null, draft: null, summary: null, repliedAt: null }, NOW, ["Avery Sample"]);
    const lines = describeWhy("Avery Sample", w).join("\n");
    expect(lines).toContain("Avery Sample (iMessage, ending 0101)");
    expect(lines).toContain("money or legal");
    expect(lines).toContain("1 photo or file unanswered");
    expect(lines).toContain("the hub's state: settled (Dialtone read it as needing no reply)");
    expect(lines).not.toMatch(/Are we on|paid|\+1555/);
  });
});

describe("contact pictures in each shape BlueBubbles has sent (#870)", () => {
  const jpeg = new Uint8Array(200).fill(7);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  it("reads base64, a data: URL, a Buffer as JSON, a byte array and comma-joined bytes; refuses what isn't a picture", () => {
    const b64 = Buffer.from(jpeg).toString("base64");
    for (const v of [b64, `data:image/jpeg;base64,${b64}`, { type: "Buffer", data: [...jpeg] }, [...jpeg], [...jpeg].join(",")]) expect(readAvatar(v)).toEqual(jpeg);
    expect(readAvatar(Buffer.from(new Uint8Array(200).fill(7)).toString("base64"))).toBeNull();
    expect(readAvatar("")).toBeNull();
    expect(readAvatar(42)).toBeNull();
  });
});
