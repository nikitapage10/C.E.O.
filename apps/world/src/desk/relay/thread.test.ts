import { describe, expect, it, vi } from "vitest";
import type { EmailItem } from "../email/email.ts";
import type { TextItem } from "../texts/texts.ts";
import { allowed, commandOf, keyCommand, metricsOf, offered, queueOf, undoable, UNDO_MS, type Command, type Phase, type Timers } from "./thread.ts";
import { GHOST, MAX_LIVE, room, SigilStage, SIGILS } from "./sigils.ts";

/* Relay's Thread (#615). Every person and message here is made up. */

const NOW = Date.UTC(2026, 10, 3, 18, 0, 0);
const mail = (over: Partial<EmailItem> = {}): EmailItem => ({ id: "aa11bb22cc33", at: NOW - 3_600_000, from: "Robin Madeup", subject: "Picnic Saturday?", kind: "needs-you", summary: "Robin asks about the picnic.", action: "Reply", done: false, ...over });
const text = (over: Partial<TextItem> = {}): TextItem => ({ id: "0123456789abcdef", name: "Sam Test", channel: "iMessage", group: false, state: "owed", sort: "normal", since: NOW - 4 * 60_000, laterUntil: null, gist: "Asks whether to start without you", draft: { text: "start without me! running 10 late", at: NOW - 60_000 }, summary: null, ...over });

describe("the queue", () => {
  it("holds needs-you mail and owed one-to-one texts, sooner first, then the longest waiting", () => {
    const q = queueOf(
      [mail(), mail({ id: "aa11bb22cc34", kind: "fyi" }), mail({ id: "aa11bb22cc35", done: true })],
      [text(), text({ id: "1123456789abcdef", group: true }), text({ id: "2123456789abcdef", state: "settled" }), text({ id: "3123456789abcdef", sort: "sooner", since: NOW - 60_000, draft: null })],
    );
    expect(q.map((x) => x.key)).toEqual(["t:3123456789abcdef", "e:aa11bb22cc33", "t:0123456789abcdef"]);
    expect(q[1]).toMatchObject({ line: "email", sendable: false, body: "Robin asks about the picnic." });
    expect(q[2]).toMatchObject({ line: "text", sendable: true, draft: "start without me! running 10 late", draftAt: NOW - 60_000 });
  });

  it("puts skipped ones at the back, in the order skipped", () => {
    const q = queueOf([mail()], [text()], ["e:aa11bb22cc33"]);
    expect(q.map((x) => x.key)).toEqual(["t:0123456789abcdef", "e:aa11bb22cc33"]);
  });
});

describe("commands", () => {
  it.each<[string, Command]>([
    ["yes", "yes"],
    ["Send it.", "yes"],
    ["ok send", "yes"],
    ["go ahead and send", "yes"],
    ["no", "no"],
    ["don't send it", "no"],
    ["skip", "skip"],
    ["later", "later"],
    ["not now", "later"],
    ["filter these out", "filter"],
    ["block this sender", "block"],
    ["undo", "undo"],
    ["change it", "change"],
    ["tell them I'll be 10 late", "words"],
    ["haha that was funny", "words"],
    ["send it?", "words"],
    ["send it to Sam instead", "words"],
  ])("%s → %s", (said, cmd) => expect(commandOf(said)).toBe(cmd));

  it("maps the keys", () => {
    expect(["y", "N", "s", "z", "l", "q"].map(keyCommand)).toEqual(["yes", "no", "skip", "undo", "later", null]);
  });
});

describe("the gate", () => {
  const [t] = queueOf([], [text()]);
  const [e] = queueOf([mail({ draft: "Yes, see you there. N" })], []);
  const bare = { ...t!, draft: null };
  const phases: Phase[] = ["empty", "incoming", "drafting", "ask", "undo", "sent"];

  it("sends only from the ask, with a draft on screen that can be sent from here", () => {
    expect(phases.filter((p) => allowed("yes", p, t!))).toEqual(["ask"]);
    expect(allowed("yes", "ask", bare)).toBe(false);
    expect(allowed("yes", "ask", { ...t!, draft: "   " })).toBe(false);
    // Email is read-only: a draft on screen, and still no send.
    expect(allowed("yes", "ask", e!)).toBe(false);
    expect(allowed("yes", "ask", null)).toBe(false);
  });

  it("takes undo only in the undo window, and nothing else then", () => {
    expect(phases.filter((p) => allowed("undo", p, t!))).toEqual(["undo"]);
    expect(offered("undo", t!)).toEqual(["undo"]);
  });

  it("keeps the sender rules to the email line, and words to an open exchange", () => {
    expect(allowed("block", "incoming", e!)).toBe(true);
    expect(allowed("filter", "ask", e!)).toBe(true);
    expect(allowed("block", "incoming", t!)).toBe(false);
    expect(allowed("words", "drafting", t!)).toBe(false);
    expect(allowed("words", "undo", t!)).toBe(false);
    expect(offered("incoming", bare)).toEqual(["skip", "later"]);
    expect(offered("ask", t!)).toEqual(["yes", "no", "change", "skip", "later"]);
  });
});

describe("the undo window", () => {
  function fakeTimers(): Timers & { run: () => void; ms: number[] } {
    const q = new Map<number, () => void>();
    let n = 0;
    const ms: number[] = [];
    return { set: (fn, d) => (q.set(++n, fn), ms.push(d), n), clear: (id) => void q.delete(id), run: () => [...q.entries()].forEach(([id, fn]) => (q.delete(id), fn())), ms };
  }

  it("sends after the window, and only then", () => {
    const tm = fakeTimers();
    const u = undoable(tm);
    const fire = vi.fn();
    u.start("t:1", fire);
    expect(tm.ms).toEqual([UNDO_MS]);
    expect(fire).not.toHaveBeenCalled();
    expect(u.waiting).toBe("t:1");
    tm.run();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(u.waiting).toBeNull();
  });

  it("Undo inside the window sends nothing", () => {
    const tm = fakeTimers();
    const u = undoable(tm);
    const fire = vi.fn();
    u.start("t:1", fire);
    expect(u.undo()).toBe("t:1");
    tm.run();
    expect(fire).not.toHaveBeenCalled();
    expect(u.undo()).toBeNull();
  });

  it("a second yes lets the first, already confirmed, go first", () => {
    const tm = fakeTimers();
    const u = undoable(tm);
    const a = vi.fn();
    const b = vi.fn();
    u.start("t:1", a);
    u.start("t:2", b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(u.waiting).toBe("t:2");
  });
});

describe("the four numbers", () => {
  const email = { v: 1, at: NOW, gmail: "connected", agent: "listening", needsYou: 2, fyi: 0, noise: 30, newToday: 40, unsorted: 0, skipped: 5, budgetPct: 3, lastCheck: NOW } as const;
  const texts = { v: 1, at: NOW, hub: "listening", messages: "up", models: "up", owed: 3, sooner: 1, overdue: 0, later: 0, settled: 4, draftsReady: 2, sentToday: 6, streakDays: 0, week: [], nextNudgeAt: null } as never;

  it("are dashes with no line, counts signed out, and the queue signed in", () => {
    expect(metricsOf(null, null, null, 0)).toEqual({ waiting: null, drafted: null, sent: null, filtered: null });
    expect(metricsOf(email, texts, null, 0)).toEqual({ waiting: 5, drafted: 2, sent: 6, filtered: 39 });
    const q = queueOf([mail()], [text()]);
    expect(metricsOf(email, texts, q, 0)).toEqual({ waiting: 2, drafted: 1, sent: 6, filtered: 39 });
  });
});

describe("sigils", () => {
  it("are code and rune, and the live count is capped", () => {
    for (const g of ["{", "}", "<", ">", "/", ";", "=", "λ", "∴", "⌘"]) expect(SIGILS).toContain(g);
    expect(room(0, 500)).toBe(500);
    expect(room(MAX_LIVE - 10, 500)).toBe(10);
    expect(room(MAX_LIVE + 5, 500)).toBe(0);
  });

  it("with reduced motion draws nothing: text just appears and goes", async () => {
    const classes = new Set<string>([GHOST]);
    const el = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } as unknown as HTMLElement;
    const host = { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientWidth: 100, clientHeight: 100, appendChild: vi.fn() } as unknown as HTMLElement;
    const s = new SigilStage(host, { reduced: true, ambient: 40 });
    expect(s.reduced).toBe(true);
    expect(host.appendChild).not.toHaveBeenCalled();
    await s.form(el);
    expect(classes.has(GHOST)).toBe(false);
    s.burst(10, 10, { n: 50 });
    expect(s.live).toBe(0);
    await s.dissolve(el);
    expect(classes.has(GHOST)).toBe(true);
    s.destroy();
  });
});
