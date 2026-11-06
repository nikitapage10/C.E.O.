import { describe, expect, it, vi } from "vitest";
import type { EmailItem } from "./email.ts";
import type { TextItem } from "./texts.ts";
import { allowed, codexOf, commandOf, contactsHint, doneHere, fromText, isOrder, noGistLine, olderInOrder, keyCommand, metricsOf, offered, OVERDUE_MS, passesOf, pendingOf, queueOf, undoable, UNDO_MS, weekSent, type Command, type Phase, type Timers } from "./thread.ts";
import { readTextItem } from "../../../api/_relay/texts.ts";
import { emptyRelayStatus } from "@ceo/core";
import { GHOST, MAX_LIVE, room, SigilStage, SIGILS } from "@ceo/engine/sigils/sigils.ts";

/* Relay's Thread (#615). Every person and message here is made up. */

const NOW = Date.UTC(2026, 10, 3, 18, 0, 0);
const mail = (over: Partial<EmailItem> = {}): EmailItem => ({ id: "aa11bb22cc33", at: NOW - 3_600_000, from: "Robin Madeup", subject: "Picnic Saturday?", kind: "needs-you", summary: "Robin asks about the picnic.", action: "Reply", done: false, ...over });
const text = (over: Partial<TextItem> = {}): TextItem => ({ id: "0123456789abcdef", name: "Sam Test", channel: "iMessage", group: false, state: "owed", sort: "normal", since: NOW - 4 * 60_000, laterUntil: null, gist: "Asks whether to start without you", draft: { text: "start without me! running 10 late", at: NOW - 60_000 }, summary: null, ...over });

describe("the queue", () => {
  it("holds needs-you mail and owed one-to-one texts, newest first (#803)", () => {
    const q = queueOf(
      [mail(), mail({ id: "aa11bb22cc34", kind: "fyi" }), mail({ id: "aa11bb22cc35", done: true })],
      [text(), text({ id: "1123456789abcdef", group: true, state: "settled" }), text({ id: "2123456789abcdef", state: "settled" }), text({ id: "3123456789abcdef", since: NOW - 60_000, draft: null })],
    );
    // #869: a settled one-to-one stays on the line in its place, marked, with nothing to send; a group never.
    expect(q.map((x) => x.key)).toEqual(["t:3123456789abcdef", "t:0123456789abcdef", "t:2123456789abcdef", "e:aa11bb22cc33"]);
    expect(q[3]).toMatchObject({ line: "email", sendable: false, body: "Robin asks about the picnic." });
    expect(q[1]).toMatchObject({ line: "text", sendable: true, draft: "start without me! running 10 late", draftAt: NOW - 60_000 });
    expect(q[2]).toMatchObject({ settled: true, sendable: false, draft: null });
    expect(allowed("done", "incoming", q[2]!)).toBe(false);
    expect(codexOf(q, NOW).waiting).toBe(3);
  });

  it("orders by the toggle on the line: newest, oldest, or priority (sooner first, then the longest waiting)", () => {
    const items = [text({ id: "3123456789abcdef", since: NOW - 60_000 }), text({ id: "4123456789abcdef", since: NOW - 9 * 60_000, sort: "sooner" })];
    const keys = (o: "newest" | "oldest" | "priority") => queueOf([mail()], items, [], false, o).map((x) => x.key);
    expect(keys("newest")).toEqual(["t:3123456789abcdef", "t:4123456789abcdef", "e:aa11bb22cc33"]);
    expect(keys("oldest")).toEqual(["e:aa11bb22cc33", "t:4123456789abcdef", "t:3123456789abcdef"]);
    expect(keys("priority")).toEqual(["t:4123456789abcdef", "e:aa11bb22cc33", "t:3123456789abcdef"]);
    expect(isOrder("newest")).toBe(true);
    expect(isOrder("loudest")).toBe(false);
    const older = [{ since: 2 }, { since: 3 }, { since: 1 }];
    expect(olderInOrder(older, "newest").map((o) => o.since)).toEqual([3, 2, 1]);
    expect(olderInOrder(older, "oldest").map((o) => o.since)).toEqual([1, 2, 3]);
  });

  it("keeps group chats off the line (#869): they sit on their own shelf", () => {
    const messages = [{ text: "Are you coming?", at: NOW - 60_000, from: "Sam Test" }];
    const q = queueOf([], [text(), text({ id: "1123456789abcdef", group: true, draft: null, summary: { text: "Plans for Friday.", asked: true }, messages })]);
    expect(q.map((x) => x.key)).toEqual(["t:0123456789abcdef"]);
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
    // #642: closing intent, skip and draft on request, with no model.
    ["already did it", "done"],
    ["I already replied", "done"],
    ["sent it", "done"],
    ["handled", "done"],
    ["no worries", "done"],
    ["taken care of", "done"],
    ["Oh, done.", "done"],
    ["pass", "skip"],
    ["nah", "skip"],
    ["not this one", "skip"],
    ["draft it", "draft"],
    ["write back", "draft"],
    ["did you already send it?", "words"],
    ["done with the old one, now tell them Friday", "words"],
    ["invites can wait", "words"],
  ])("%s → %s", (said, cmd) => expect(commandOf(said)).toBe(cmd));

  it("hears \"nah\" as no while a draft asks, and as skip before there is one", () => {
    expect(commandOf("nah", "ask")).toBe("no");
    expect(commandOf("nah", "incoming")).toBe("skip");
    expect(commandOf("not this one", "ask")).toBe("skip");
  });

  it("maps the keys", () => {
    expect(["y", "N", "s", "z", "l", "r", "d", "q"].map(keyCommand)).toEqual(["yes", "no", "skip", "undo", "later", "draft", "done", null]);
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
    // Email without Gmail's send grant: a draft on screen, and still no send.
    expect(allowed("yes", "ask", e!)).toBe(false);
    expect(allowed("yes", "ask", null)).toBe(false);
  });

  it("sends an email only once Gmail granted send, and only from the ask with its draft", () => {
    const [granted] = queueOf([mail({ draft: "Yes, see you there. N" })], [], [], true);
    expect(phases.filter((p) => allowed("yes", p, granted!))).toEqual(["ask"]);
    expect(allowed("yes", "ask", { ...granted!, draft: null })).toBe(false);
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
    expect(offered("incoming", bare)).toEqual(["draft", "done", "skip", "later"]);
    expect(offered("ask", t!)).toEqual(["yes", "no", "change", "draft", "done", "skip", "later"]);
  });

  it("drafts an email on request even without Gmail's send grant, and never a group text", () => {
    expect(allowed("draft", "incoming", { ...e!, draft: null })).toBe(true);
    expect(allowed("draft", "incoming", { ...bare, sendable: false })).toBe(false);
    expect(allowed("done", "incoming", e!)).toBe(true);
    expect(allowed("done", "drafting", e!)).toBe(false);
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
    expect(metricsOf(null, null, null, 0)).toEqual({ waiting: null, drafted: null, sent: null, filtered: null, unread: null });
    expect(metricsOf(email, texts, null, 0)).toEqual({ waiting: 5, drafted: 2, sent: 6, filtered: 39, unread: null });
    const q = queueOf([mail()], [text()]);
    expect(metricsOf(email, texts, q, 0)).toEqual({ waiting: 2, drafted: 1, sent: 6, filtered: 39, unread: 0 });
    // Groups waiting on the shelf (#950) count too.
    expect(metricsOf(email, texts, q, 0, 2).waiting).toBe(4);
  });

  it("count unread texts (#758) without hiding a read one", () => {
    expect(metricsOf(email, { ...(texts as object), unread: 2 } as never, null, 0).unread).toBe(2);
    const q = queueOf([], [{ ...text(), unread: true }, { ...text(), id: "b".repeat(16) }]);
    expect(q).toHaveLength(2);
    expect(q.filter((x) => x.unread)).toHaveLength(1);
    expect(metricsOf(email, texts, q, 0).unread).toBe(1);
  });
});

describe("sigils", () => {
  it("are code and rune, and the live count is capped", () => {
    for (const g of ["{", "}", "<", ">", "/", ";", "=", "=>", "λ", "0x", "∴", "ᚠ", "☿", "🜂"]) expect(SIGILS).toContain(g);
    expect(room(0, 500)).toBe(500);
    expect(room(MAX_LIVE - 10, 500)).toBe(10);
    expect(room(MAX_LIVE + 5, 500)).toBe(0);
  });

  it("with reduced motion draws nothing: text just appears and goes", async () => {
    const attrs = new Set<string>([GHOST]);
    const el = { setAttribute: (a: string) => attrs.add(a), removeAttribute: (a: string) => attrs.delete(a), hasAttribute: (a: string) => attrs.has(a) } as unknown as HTMLElement;
    const host = { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientWidth: 100, clientHeight: 100, appendChild: vi.fn() } as unknown as HTMLElement;
    const s = new SigilStage(host, { reduced: true });
    expect(s.reduced).toBe(true);
    expect(host.appendChild).not.toHaveBeenCalled();
    await s.form(el);
    expect(attrs.has(GHOST)).toBe(false);
    s.burst(10, 10, { n: 50 });
    expect(s.live).toBe(0);
    await s.dissolve(el);
    expect(attrs.has(GHOST)).toBe(true);
    s.destroy();
  });
});

describe("Open the codex", () => {
  const q = queueOf(
    [mail({ id: "aa11bb22cc33", at: NOW - 2 * 3_600_000 }), mail({ id: "aa11bb22cc34", kind: "unsorted", at: NOW - 30 * 3_600_000 }), mail({ id: "aa11bb22cc35", kind: "unsorted", at: NOW - 600_000 })],
    [text({ sort: "sooner" }), text({ id: "1123456789abcdef", since: NOW - 3 * 60_000 })],
  );

  it("counts what waits by line", () => {
    const p = pendingOf(q, NOW);
    expect([p.texts, p.email]).toEqual([2, 3]);
  });

  it("lists who has waited longest, oldest first, with how long", () => {
    const p = pendingOf(q, NOW, undefined, 3);
    expect(p.longest.map((l) => [l.ex.key, l.waited])).toEqual([
      ["e:aa11bb22cc34", 30 * 3_600_000],
      ["e:aa11bb22cc33", 2 * 3_600_000],
      ["e:aa11bb22cc35", 600_000],
    ]);
  });

  it("marks high priority by Relay's own signals only: sooner, needs you, waiting past a day", () => {
    const p = pendingOf(q, NOW);
    expect(p.high.map((h) => [h.ex.key, h.why])).toEqual([
      ["t:0123456789abcdef", ["sooner"]],
      ["e:aa11bb22cc34", ["overdue"]],
      ["e:aa11bb22cc33", ["needs-you"]],
    ]);
    // Nothing from the private priority list rides along: only these three words, never a term.
    for (const h of p.high) for (const w of h.why) expect(["sooner", "needs-you", "overdue"]).toContain(w);
    expect(OVERDUE_MS).toBe(86_400_000);
  });

  it("signed out, it shows the public counts and no names", () => {
    expect(pendingOf(null, NOW, { email: 1, texts: 2 })).toEqual({ texts: 2, email: 1, longest: [], high: [] });
  });

  it("ticks the learned style first, then the checks every draft gets", () => {
    const [e] = queueOf([mail({ draft: "Sure. N" })], []);
    const [t] = queueOf([], [text()]);
    expect(passesOf(e!, ["signs as N", "short", "no emoji", "warm", "a fifth"])).toEqual(["signs as N", "short", "no emoji", "warm", "under 120 words", "nothing made up"]);
    expect(passesOf(e!, null)).toEqual(["in your voice", "under 120 words", "nothing made up"]);
    expect(passesOf(t!, ["signs as N"])).toEqual(["in your voice", "one text", "nothing made up"]);
  });
});

describe("the Codex (#642)", () => {
  const q = queueOf([mail(), mail({ id: "aa11bb22cc36", at: NOW - 2 * 86_400_000 })], [text(), text({ id: "4123456789abcdef", since: NOW - 3 * 3_600_000 })]);

  it("is one line of numbers and two lists, newest first (#803), each exchange once", () => {
    const c = codexOf(q, NOW);
    expect(c.waiting).toBe(4);
    expect(c.oldest).toBe(2 * 86_400_000);
    expect(c.email.map((r) => r.ex.id)).toEqual(["aa11bb22cc33", "aa11bb22cc36"]);
    expect(c.texts.map((r) => r.ex.id)).toEqual(["0123456789abcdef", "4123456789abcdef"]);
    expect(codexOf(q, NOW, undefined, "oldest").email.map((r) => r.ex.id)).toEqual(["aa11bb22cc36", "aa11bb22cc33"]);
    const keys = [...c.email, ...c.texts].map((r) => r.ex.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("drops an exchange the moment it leaves the queue (Done shows at once)", () => {
    const c = codexOf(q.filter((x) => x.id !== "aa11bb22cc36"), NOW);
    expect(c.email.map((r) => r.ex.id)).toEqual(["aa11bb22cc33"]);
    expect(c.waiting).toBe(3);
  });

  it("signed out, counts only", () => {
    expect(codexOf(null, NOW, { email: 2, texts: 1 })).toEqual({ waiting: 3, oldest: null, email: [], texts: [] });
    expect(codexOf(null, NOW).waiting).toBeNull();
  });

  it("sums the week's sends from both lines", () => {
    expect(weekSent({ week: [{ day: NOW - 86_400_000, sent: 4, medianMinutes: 10 }, { day: NOW, sent: 2, medianMinutes: null }] }, 3)).toBe(9);
    expect(weekSent(null, 0)).toBe(0);
  });

  it("a text's photo and a sender's logo ride along as opaque ids only", () => {
    const [x] = queueOf([mail({ logo: "0123456789abcdef0123456789abcdef", photo: "fedcba9876543210fedcba9876543210" })], []);
    expect(x).toMatchObject({ logo: "0123456789abcdef0123456789abcdef", photo: "fedcba9876543210fedcba9876543210" });
  });
});

describe("why a text has no name or no gist (#861)", () => {
  it("says the hub's real reason instead of 'hasn't read this one'", () => {
    const x = fromText(text({ gist: "", wait: "cap" }));
    expect(noGistLine(x)).toBe("No gist yet: the texts line's monthly model cap is reached.");
    expect(noGistLine(fromText(text({ gist: "", wait: "queued" })))).toBe("No gist yet: waiting in line for Dialtone.");
    // An older hub sends no reason; a gist clears it.
    expect(noGistLine(fromText(text({ gist: "" })))).toBe("The Mac hasn't read this one yet.");
    expect(fromText(text({ wait: "model" })).wait).toBeUndefined();
  });

  it("takes a reason only from the closed list, and drops it once there is a gist", () => {
    expect(readTextItem({ ...text({ gist: "" }), wait: "site" })?.wait).toBe("site");
    expect(readTextItem({ ...text({ gist: "" }), wait: "anthropic said 429" })).toBeNull();
    expect(readTextItem({ ...text(), wait: "queued" })?.wait).toBeUndefined();
  });

  it("asks to let BlueBubbles read Contacts only when the hub reads none", () => {
    const on = { ...emptyRelayStatus(NOW), hub: "listening" as const };
    expect(contactsHint({ ...on, contacts: 0 })).toMatch(/Privacy & Security > Contacts/);
    expect(contactsHint({ ...on, contacts: 12 })).toBeNull();
    expect(contactsHint(on)).toBeNull();
    expect(contactsHint({ ...emptyRelayStatus(NOW, "wiped"), contacts: 0 })).toBeNull();
    expect(contactsHint(null)).toBeNull();
  });
});

describe("doneHere (#914): a Done stays off the line across reloads until the Mac settles it", () => {
  const T = 1_800_000_000_000;
  const item = { id: "a".repeat(16), since: T - 60_000, last: T - 30_000 };
  const req = (kind: "done" | "back", state: "waiting" | "taken" | "done" | "expired" | "failed" | "refused", created: number) => ({ kind, thread: item.id, state, created });
  it("hides a thread whose latest Done the site still holds, made after their latest text", () => {
    for (const s of ["waiting", "taken", "done"] as const) expect(doneHere([item], [req("done", s, T)]).has(item.id)).toBe(true);
  });
  it("shows it again for a Done the Mac never took, a newer text, or a later Bring back", () => {
    for (const s of ["expired", "failed", "refused"] as const) expect(doneHere([item], [req("done", s, T)]).size).toBe(0);
    expect(doneHere([{ ...item, last: T + 1 }], [req("done", "done", T)]).size).toBe(0);
    expect(doneHere([item], [req("done", "done", T), req("back", "waiting", T + 5)]).size).toBe(0);
    expect(doneHere([item], undefined).size).toBe(0);
  });
});
