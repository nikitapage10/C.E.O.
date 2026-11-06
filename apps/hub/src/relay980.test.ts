import { describe, expect, it } from "vitest";
import { readTextsView, type TextsView } from "../../../api/_relay/texts.ts";
import type { ComposeInput, DraftInput, SortInput } from "../../../api/_relay/models.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import type { BlueBubbles, ChatInfo, Contact, Message, Polled } from "./bluebubbles.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { Engine, RULE_HELD } from "./engine.ts";
import { memoryLogger } from "./log.ts";
import type { Site } from "./site.ts";
import { memoryStore } from "./store.ts";

/**
 * #980 (Nikita, 2026-11-06): "Why does it need a gist? Just show the exact message." Every owed thread the Desk lists
 * carries its own recent lines, read from BlueBubbles through every rule, whether or not Dialtone has got to it yet;
 * a rule-held one says the hub's own line instead. Every name, number and text here is made up (555 numbers).
 */

const NOW = Date.parse("2026-11-06T15:00:00Z");
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 9);
const A = "+15555550101";
const STRANGER = "+15555550188";
const PEOPLE: Contact[] = [{ names: ["Avery Sample"], handles: [A] }];
const chatOf = (h: string) => `iMessage;-;${h}`;
let guids = 0;
const msg = (text: string, at: number, fromMe = false, handle = A): Message => ({ text, fromMe, at, handle: fromMe ? "" : handle, read: false, guid: `p:0/980-${++guids}` });

class FakeBB implements BlueBubbles {
  chatsList: ChatInfo[] = [];
  byChat = new Map<string, Message[]>();
  async ping() {
    return true;
  }
  async contacts() {
    return PEOPLE;
  }
  broken = new Set<string>();
  async messages(c: string, limit: number) {
    if (this.broken.has(c)) throw new Error("bb read failed");
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


const inbound = async (h: ReturnType<typeof setup>, handle: string, m: Message) => {
  const c = chatOf(handle);
  h.bb.byChat.set(c, [...(h.bb.byChat.get(c) ?? []), m]);
  await h.engine.onMessage({ chat: c, group: false, groupName: "", message: m });
};
const itemOf = (h: ReturnType<typeof setup>, name: string) => readTextsView(h.engine.texts(), h.now())!.items.find((i) => i.name === name);

describe("every listed owed thread shows its own texts, gist or no gist (#980)", () => {
  it("shows an unknown number's real lines while it waits in line for Dialtone", async () => {
    const h = setup();
    await inbound(h, STRANGER, msg("hi, is the bike still for sale?", NOW - 60_000, false, STRANGER));
    await h.engine.report(true);
    const item = itemOf(h, "Unknown (ending 0188)")!;
    expect(item.gist).toBe("");
    expect(item.wait).toBe("queued");
    expect(item.messages?.map((m) => m.text)).toEqual(["hi, is the bike still for sale?"]);
    expect(item.messages?.[0]?.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(h.site.sorts).toHaveLength(0);
  });

  it("fills the newest listed threads first, not the state file's first 100 owed ones", async () => {
    const h = setup();
    // 120 older owed threads ahead of it in the state file.
    for (let i = 0; i < 120; i++) {
      const handle = `+1555556${String(i).padStart(4, "0")}`;
      await inbound(h, handle, msg(`older question ${i}`, NOW - 5 * DAY + i * 60_000, false, handle));
    }
    await inbound(h, STRANGER, msg("are you coming tonight?", NOW - 60_000, false, STRANGER));
    await h.engine.report(true);
    expect(itemOf(h, "Unknown (ending 0188)")?.messages?.at(-1)?.text).toBe("are you coming tonight?");
  });

  it("keeps reading the rest when one chat can't be read", async () => {
    const h = setup();
    // The unreadable one is first, both in the state file and on the list.
    await inbound(h, STRANGER, msg("is this the right number?", NOW - 60_000, false, STRANGER));
    await inbound(h, A, msg("lunch on friday?", NOW - 2 * 60_000));
    h.bb.broken.add(chatOf(STRANGER));
    await h.engine.report(true);
    expect(itemOf(h, "Avery Sample")?.messages?.map((m) => m.text)).toEqual(["lunch on friday?"]);
    expect(itemOf(h, "Unknown (ending 0188)")?.messages).toBeUndefined();
    // Readable again: the next report fills it.
    h.bb.broken.clear();
    await h.engine.report(true);
    expect(itemOf(h, "Unknown (ending 0188)")?.messages?.map((m) => m.text)).toEqual(["is this the right number?"]);
  });

  it("shows a newer text at the next report, before Dialtone sorts it again", async () => {
    const h = setup();
    await inbound(h, A, msg("lunch on friday?", NOW - 10 * 60_000));
    await h.engine.work();
    expect(h.site.sorts).toHaveLength(1);
    expect(itemOf(h, "Avery Sample")?.messages?.map((m) => m.text)).toEqual(["lunch on friday?"]);
    h.at(NOW + 60_000);
    await inbound(h, A, msg("or saturday works too", NOW + 30_000));
    await h.engine.report();
    expect(itemOf(h, "Avery Sample")?.messages?.map((m) => m.text)).toEqual(["lunch on friday?", "or saturday works too"]);
  });

  it("says the hub's own line for a thread a rule keeps off the Desk, never its words or 'waiting in line'", async () => {
    const h = setup();
    // An earlier money line in the run the Desk would show; the new text itself is harmless.
    h.bb.byChat.set(chatOf(A), [msg("the invoice payment is overdue", NOW - DAY)]);
    await inbound(h, A, msg("see you later", NOW - 60_000));
    await h.engine.report(true);
    const item = itemOf(h, "Avery Sample")!;
    expect(item.messages).toBeUndefined();
    expect(item.gist).toBe(RULE_HELD);
    expect(item.wait).toBeUndefined();
    expect(JSON.stringify(h.engine.texts())).not.toMatch(/invoice|see you later/);
  });
});
