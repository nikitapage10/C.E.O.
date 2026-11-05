import { describe, expect, it } from "vitest";
import { itemLive, OWED_WINDOW_MS, readTextItem, readTextsView, type TextItem, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { queueOf } from "../../../rooms/relay/data/thread.ts";
import type { BlueBubbles, ChatInfo, Contact, Message, Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";

/**
 * #895: the Mac counted 14 owed, the Desk's line showed 3 or 4. The hub lists an owed thread while their latest text
 * is inside the 30-day window (#861), but the site kept an item by `since`, the first text Nikita hadn't answered, so
 * every thread someone had kept writing in for over 30 days (or whose first unanswered text was that old) was counted
 * on the Mac and dropped on the site. The hub's count, the pushed list, the site's read and the Desk's line must agree.
 * Every name, number and text here is made up (555 numbers).
 */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
const num = (i: number) => `+1555555${String(100 + i).padStart(4, "0")}`;
const PEOPLE: Contact[] = Array.from({ length: 20 }, (_, i) => ({ names: [`Sample Person ${i}`], handles: [num(i)] }));
const chatOf = (h: string) => `iMessage;-;${h}`;
const msg = (text: string, at: number, fromMe: boolean, handle: string, extra: Partial<Message> = {}): Message => ({ text, fromMe, at, handle: fromMe ? "" : handle, read: false, ...extra });

class FakeBB implements BlueBubbles {
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
  async send() {
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
    const all: ChatInfo[] = [...this.byChat].map(([chat, ms]) => {
      const last = [...ms].sort((a, b) => b.at - a.at)[0] ?? null;
      return { chat, group: false, name: "", handle: chat.split(";").pop()!, last, lastAt: last?.at ?? 0 };
    });
    return all.slice(offset, offset + limit);
  }
}

class FakeSite implements Site {
  pushed: TextsView | null = null;
  async status() {
    return true;
  }
  async texts(v: TextsView) {
    // Over the wire, as the hub's push goes.
    this.pushed = JSON.parse(JSON.stringify(v)) as TextsView;
    return true;
  }
  async sort(input: SortInput) {
    // "zzz" stands for a thread Dialtone's answer doesn't pass on: it stays owed, with no gist yet.
    if (input.lines.some((l) => l.text.includes("zzz"))) return { answer: null };
    return { answer: { needsReply: true, sort: "normal", gist: "Asks about Friday" } as never };
  }
  async draft(input: DraftInput) {
    // "nodraft": Blasto's answer doesn't pass, so the thread waits on its draft.
    if (input.lines.some((l) => l.text.includes("nodraft"))) return { answer: null };
    return { answer: { draft: "yes, Friday works" } };
  }
  async compose(_: ComposeInput) {
    return { answer: null };
  }
  async learn(_: LearnInput) {
    return { answer: null, usd: 0 };
  }
  async requests() {
    return [];
  }
  async results() {
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
  const bb = new FakeBB();
  const site = new FakeSite();
  const store = memoryStore();
  const engine = new Engine({ store, bb, site, log: memoryLogger(() => NOW), config: DEFAULT_CONFIG, sendKey: KEY, now: () => NOW, offsetAt: () => 0 });
  return { bb, site, store, engine };
};

/** Fourteen owed one-to-one chats in every shape the Mac had, and one Nikita answered. */
function fixture(bb: FakeBB) {
  const put = (i: number, ms: [string, number, boolean?, Partial<Message>?][]) => bb.byChat.set(chatOf(num(i)), ms.map(([t, at, me, x]) => msg(t, at, me ?? false, num(i), x)));
  // The cause: they kept writing, their first unanswered text 45 days back, the latest 2 days ago.
  put(0, [["are you around this month?", NOW - 45 * DAY], ["hey, did you see this?", NOW - 2 * DAY]]);
  put(1, [["sure", NOW - 70 * DAY, true], ["one more thing", NOW - 40 * DAY], ["call me when you can", NOW - 6 * DAY]]);
  put(2, [["lunch next week?", NOW - 31 * DAY], ["still on for lunch?", NOW - 29 * DAY]]);
  // Read on the phone, never answered: still owed.
  put(3, [["can you send the photos?", NOW - 3 * DAY, false, { read: true }]]);
  put(4, [["ok", NOW - 9 * DAY, true], ["what time works?", NOW - 1 * DAY, false, { read: true }]]);
  // Waiting on Dialtone (no gist) and on Blasto (no draft).
  put(5, [["zzz are we still good", NOW - 4 * DAY]]);
  put(6, [["nodraft how was the trip", NOW - 5 * DAY]]);
  // Only a photo.
  put(7, [["", NOW - 8 * DAY, false, { media: true }]]);
  for (let i = 8; i < 14; i++) put(i, [[`question number ${i}?`, NOW - (i + 2) * DAY]]);
  // Answered: not owed, not on the line.
  put(14, [["see you then", NOW - 3 * DAY], ["see you!", NOW - 2 * DAY, true]]);
}

async function run() {
  const h = setup();
  fixture(h.bb);
  await h.engine.backlog();
  for (let i = 0; i < 10 && h.engine.pending(); i++) await h.engine.work();
  await h.engine.report(true);
  return h;
}

describe("#895: every owed one-to-one thread the hub counts is on the Desk's line", () => {
  it("hub count == pushed list == site's read == the Desk's line, read or unread, with or without a gist or draft", async () => {
    const h = await run();
    const state = h.store.load();
    // What `relay check` prints as "the hub counts N owed" (one-to-one).
    const owed = state.threads.filter((t) => !t.group && (t.state === "owed" || t.state === "later"));
    expect(owed).toHaveLength(14);
    const pushed = h.site.pushed!;
    expect(pushed.items.filter((i) => !i.group && i.state !== "settled")).toHaveLength(14);
    // The site's check (api/_relay/route.ts, view=texts) keeps every one.
    const read = readTextsView(pushed, NOW)!;
    expect(read).not.toBeNull();
    expect(read.items.filter((i) => !i.group && i.state !== "settled")).toHaveLength(14);
    // The Desk reads the private view item by item (rooms/relay/data/texts.ts) and builds its line (thread.ts).
    const desk = (JSON.parse(JSON.stringify(read.items)) as unknown[]).map(readTextItem).filter((i): i is TextItem => i !== null);
    const line = queueOf([], desk).filter((x) => x.line === "text" && !x.settled);
    expect(line).toHaveLength(owed.length);
    expect(new Set(line.map((x) => x.id))).toEqual(new Set(owed.map((t) => t.id)));
  });

  it("keeps the long-running thread with its first unanswered text as `since` and its latest as `last`", async () => {
    const h = await run();
    const item = h.site.pushed!.items.find((i) => i.name === "Sample Person 0")!;
    expect(NOW - item.since).toBeGreaterThan(OWED_WINDOW_MS);
    expect(item.last).toBe(NOW - 2 * DAY);
    // A shown text keeps its own 30 days (#803): the older one drops, the thread stays.
    expect(readTextsView(h.site.pushed, NOW)!.items.find((i) => i.id === item.id)?.messages?.map((m) => m.text)).toEqual(["hey, did you see this?"]);
  });

  it("shows a read thread as owed (no unread mark), and one still waiting on its gist or draft with its texts", async () => {
    const h = await run();
    const by = (n: number) => h.site.pushed!.items.find((i) => i.name === `Sample Person ${n}`)!;
    expect(by(3).unread).toBeUndefined();
    expect(by(3).messages?.at(-1)?.text).toBe("can you send the photos?");
    expect(by(5).gist).toBe("");
    expect(by(5).wait).toBe("refused");
    expect(by(5).messages?.length).toBe(1);
    expect(by(6).gist).not.toBe("");
    expect(by(6).draft).toBeNull();
    expect(by(6).messages?.length).toBe(1);
    // The Desk puts both on the line: the no-gist one says why, the no-draft one waits for Nikita's words or Blasto.
    const line = queueOf([], [by(5), by(6)]);
    expect(line.map((x) => x.wait ?? null)).toEqual(expect.arrayContaining(["refused", null]));
  });

  it("drops an owed item only once their latest text is past the window; an older hub's item by `since`", () => {
    const base = { state: "owed" as const, since: NOW - 45 * DAY };
    expect(itemLive({ ...base, last: NOW - 2 * DAY }, NOW)).toBe(true);
    expect(itemLive({ ...base, last: NOW - 31 * DAY }, NOW)).toBe(false);
    expect(itemLive(base, NOW)).toBe(false);
    expect(itemLive({ state: "owed", since: NOW - 3 * DAY }, NOW)).toBe(true);
    // A group's summary keeps its week.
    expect(itemLive({ state: "settled", since: NOW - 8 * DAY, last: NOW }, NOW)).toBe(false);
  });

  it("refuses a bad `last`", () => {
    const item = { id: "a".repeat(16), name: "Sample", channel: "iMessage", group: false, state: "owed", sort: null, since: NOW - DAY, laterUntil: null, gist: "", draft: null, summary: null };
    expect(readTextItem({ ...item, last: NOW })?.last).toBe(NOW);
    expect(readTextItem({ ...item, last: "soon" })).toBeNull();
    expect(readTextItem({ ...item, last: 5 })).toBeNull();
  });
});
