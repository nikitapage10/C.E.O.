import type { EmailItem, EmailStatus } from "./email.ts";
import type { TextItem, TextRequestView } from "./texts.ts";
import type { RelayStatus } from "@ceo/core";
import { closingOf, draftAsk, skipOf } from "../../../api/_email/intentWords.ts";

/**
 * Relay's Thread (#615), the logic with no DOM: one exchange at a time, from the two live lines.
 *
 *   queueOf      the email that needs Nikita (Gmail, #263) and the texts they owe (the Mac hub, #535), as one queue of
 *                exchanges, newest first (or oldest first, or by priority: the toggle on the line, #803); skipped
 *                ones go to the back.
 *   commandOf    what a spoken or typed line means: yes, no, skip, later, change it, filter these out, block this
 *                sender, undo, or (anything else) words for a reply.
 *   allowed      the gate. A command only works in the state it belongs to: "send" and "yes" only while a draft is on
 *                screen, "undo" only while a send waits out its five seconds, the sender rules only on the email line.
 *   undoable     a send waits UNDO_MS before it goes; Undo in that window and nothing is sent.
 *   metricsOf    the four numbers under the stage.
 *
 *   pendingOf    the Open the codex dashboard: counts by line, who has waited longest, and what is high priority.
 *
 * Nothing here sends. The page asks the existing endpoints: a text's send is the texts line's send request (the
 * device's 72-hour passkey unlock, single-use, bound to the draft on screen); an email's is /api/email's send (only
 * with Gmail's send grant, single-use, bound to the draft on screen), and without that grant it is copied for Gmail.
 */

export type Line = "email" | "text";

export interface Exchange {
  /** "e:<gmail id>" or "t:<relay id>". */
  key: string;
  line: Line;
  id: string;
  who: string;
  /** "Email", "iMessage" or "SMS". */
  channel: string;
  /** When it came in (the first unanswered text, or the mail). */
  at: number;
  /** An email's subject; "" for a text. */
  subject: string;
  /** What it says, as Relay may show it: Dialtone's gist of a text (the text itself never leaves the Mac), or an email's summary. */
  body: string;
  /** Dialtone's suggested next step (email). */
  action: string;
  /** Blasto's advice (email). */
  advice: string;
  /** The draft on screen, or null while there is none. */
  draft: string | null;
  /** A text's draft time: its send binds to it. */
  draftAt: number;
  /** Nikita's own words the draft was written from, when it was. */
  said: string;
  sooner: boolean;
  later: boolean;
  /** Dialtone put it in the needs-you tier (email); a text is owed either way. */
  needsYou: boolean;
  /** A one-to-one text can be sent from here; an email only once Gmail granted send; groups are never drafted for. */
  sendable: boolean;
  /** The Mac's contact photo id, or the sender domain's logo id (#642): opaque, asked for passkey-only. */
  photo?: string;
  logo?: string;
  /** A text whose ready draft is folded until Reply (#642). */
  ready?: boolean;
  /** A text whose latest message Messages shows unread (#758): a mark only; a read one is just as owed. */
  unread?: boolean;
  /** Their own texts (#758): the newest unanswered ones, real words, sealed; a group's with each sender. */
  messages?: TextItem["messages"];
  /** A group text: owed only when Nikita was asked or named, never drafted for. */
  group?: boolean;
}

const firstName = (who: string) => who.trim().split(/\s+/)[0] || who;

/** The letter on an avatar. */
export const initialOf = (who: string) => (who.trim()[0] ?? "?").toUpperCase();

/** One email item as an exchange; sendable only when Gmail granted send. */
export function fromEmail(i: EmailItem, canSend = false): Exchange {
  return { key: `e:${i.id}`, line: "email", id: i.id, who: i.from || "Unknown sender", channel: "Email", at: i.at, subject: i.subject, body: i.summary || i.subject, action: i.action, advice: i.advice ?? "", draft: i.draft ?? null, draftAt: 0, said: i.said ?? "", sooner: false, later: false, needsYou: i.kind === "needs-you", sendable: canSend, ...(i.photo && { photo: i.photo }), ...(i.logo && { logo: i.logo }) };
}

/** One text thread as an exchange. */
export function fromText(i: TextItem): Exchange {
  return { key: `t:${i.id}`, line: "text", id: i.id, who: i.name || "Unknown sender", channel: i.channel, at: i.since, subject: "", body: i.group ? (i.summary?.text ?? "") : i.gist, action: "", advice: "", draft: i.group ? null : (i.draft?.text ?? null), draftAt: i.draft?.at ?? 0, said: "", sooner: i.sort === "sooner", later: i.state === "later", needsYou: true, sendable: !i.group, ...(i.photo && { photo: i.photo }), ...(i.unread && { unread: true }), ...(i.messages?.length && { messages: i.messages }), ...(i.group && { group: true }) };
}

/**
 * How the queue is ordered (#803, the toggle on the line): newest first (the default), oldest first, or priority
 * (Dialtone's "reply sooner" ones first, then the longest waiting, the order before #803).
 */
export type Order = "newest" | "oldest" | "priority";
export const ORDERS: readonly Order[] = ["newest", "oldest", "priority"];
export const isOrder = (v: unknown): v is Order => typeof v === "string" && (ORDERS as readonly string[]).includes(v);

/** Two exchanges in an order: newest or oldest by when they came, or priority (sooner first, then the longest waiting). */
export function byOrder(order: Order): (a: Exchange, b: Exchange) => number {
  if (order === "oldest") return (a, b) => a.at - b.at;
  if (order === "priority") return (a, b) => Number(b.sooner) - Number(a.sooner) || a.at - b.at;
  return (a, b) => b.at - a.at;
}

/** The queue: email that needs Nikita and texts they owe (a group only once it asked or named them, #758; never settled ones), in `order` (newest first unless asked otherwise, #803); skipped and later at the back. */
export function queueOf(email: EmailItem[] | undefined, texts: TextItem[] | undefined, skipped: readonly string[] = [], canSend = false, order: Order = "newest"): Exchange[] {
  const all = [
    ...(email ?? []).filter((i) => !i.done && (i.kind === "needs-you" || i.kind === "unsorted")).map((i) => fromEmail(i, canSend)),
    ...(texts ?? []).filter((i) => i.state !== "settled").map(fromText),
  ];
  const back = (x: Exchange) => {
    const s = skipped.indexOf(x.key);
    return s >= 0 ? 2 + s : x.later ? 1 : 0;
  };
  const by = byOrder(order);
  return all.sort((a, b) => back(a) - back(b) || by(a, b));
}

/* ── commands ── */

export type Command = "yes" | "no" | "skip" | "later" | "change" | "filter" | "block" | "undo" | "done" | "draft" | "words";

const norm = (w: string) =>
  w
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const PLEASE = "(?: please| now| thanks| thank you)?";
const COMMANDS: [Command, RegExp][] = [
  ["yes", new RegExp(`^(?:(?:yes|yeah|yep|yup|ok|okay|sure)(?: send(?: it)?)?|(?:(?:yes|ok|okay) )?(?:go ahead and )?send(?: it)?)${PLEASE}$`)],
  ["no", new RegExp(`^(?:no|nope|nah|no thanks|don't send(?: it)?|do not send(?: it)?|cancel)${PLEASE}$`)],
  ["undo", new RegExp(`^(?:undo|wait|stop|take it back|unsend)(?: that| it)?${PLEASE}$`)],
  ["skip", new RegExp(`^(?:skip|next|skip (?:it|this|this one)|pass)${PLEASE}$`)],
  ["later", new RegExp(`^(?:later|not now|remind me later|later please|ask me later)${PLEASE}$`)],
  ["change", new RegExp(`^(?:change(?: it)?|edit(?: it)?|rewrite(?: it)?|try again|redo(?: it)?)${PLEASE}$`)],
  ["filter", new RegExp(`^(?:filter(?: (?:these|this|them|it))?(?: out)?|fewer like (?:this|these)|less of (?:this|these))${PLEASE}$`)],
  ["block", new RegExp(`^(?:block(?: (?:this|the|them))?(?: sender| person)?)${PLEASE}$`)],
];

/**
 * What one line, said or typed, means, with no model (#642): a gate command, "already did it" (done), "skip / pass /
 * nah / not this one" (skip), "draft it" (draft). Anything else is "words", which the intent layer reads (one Haiku
 * call, api/_email/intent.ts). "nah" is "no" while a draft asks "Send to X?", and skip before there is one.
 */
export function commandOf(raw: string, phase: Phase = "incoming"): Command | null {
  const w = norm(raw);
  if (!w) return null;
  // A question is never a command ("send it?", "did you send it?"), and neither is a line that redirects one.
  if (/\?/.test(raw)) return "words";
  // "nah" and "nope" answer "Send to X?" (no) while a draft asks; every other skip word skips in any phase.
  if (skipOf(raw) && !(phase === "ask" && /^(?:nah|nope)$/.test(w))) return "skip";
  for (const [c, re] of COMMANDS) if (re.test(w)) return c;
  if (closingOf(raw)) return "done";
  if (draftAsk(raw)) return "draft";
  return "words";
}

/** Where the Thread is with the exchange on screen. */
export type Phase =
  /** Nothing waiting (or nothing readable). */
  | "empty"
  /** An exchange on screen with no draft yet: Nikita answers in a few words, or skips. */
  | "incoming"
  /** Their words went to Blasto; the draft is on its way. */
  | "drafting"
  /** A draft on screen and "Send to X?". */
  | "ask"
  /** They said yes: the send waits UNDO_MS, Undo takes it back. */
  | "undo"
  /** Gone to the line; the next exchange comes up. */
  | "sent";

/**
 * Whether a command works now. The hard rule: "yes" sends only with a draft on screen that can be sent from here, and
 * only in the ask; nothing else ever sends. Undo works only inside the undo window.
 */
export function allowed(cmd: Command, phase: Phase, ex: Exchange | null): boolean {
  if (!ex) return false;
  switch (cmd) {
    case "yes":
      return phase === "ask" && !!ex.draft?.trim() && ex.sendable;
    case "undo":
      return phase === "undo";
    case "no":
    case "change":
      return phase === "ask";
    case "skip":
    case "later":
    case "done":
      return phase === "incoming" || phase === "ask";
    case "draft":
      // An email drafts even without Gmail's send grant (the draft is copied for Gmail); a group text never.
      return (phase === "incoming" || phase === "ask") && (ex.line === "email" || ex.sendable);
    case "filter":
    case "block":
      return (phase === "incoming" || phase === "ask") && ex.line === "email";
    case "words":
      return phase === "incoming" || phase === "ask";
  }
}

/** The commands to offer on screen for a phase (said aloud or keyed). */
export function offered(phase: Phase, ex: Exchange | null): Command[] {
  const all: Command[] = ["yes", "no", "change", "draft", "done", "skip", "later", "filter", "block", "undo"];
  return all.filter((c) => allowed(c, phase, ex));
}

/** Keys: Y yes, N no, R reply (draft it), D done, L later, S skip, Z undo. */
export function keyCommand(key: string): Command | null {
  const k = key.toLowerCase();
  return k === "y" ? "yes" : k === "n" ? "no" : k === "s" ? "skip" : k === "z" ? "undo" : k === "l" ? "later" : k === "d" ? "done" : k === "r" ? "draft" : null;
}

/** "Send to Sam?" */
export const askLine = (ex: Exchange) => `Send to ${firstName(ex.who)}?`;

/* ── the undo window ── */

export const UNDO_MS = 5_000;

export interface Timers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}

const windowTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };

/**
 * A send that waits out the undo window: `start` schedules `fire` after `ms`; `undo` before then cancels it and
 * nothing is sent. One at a time: a new start first lets the previous one go (it was already confirmed).
 */
export function undoable(timers: Timers = windowTimers, ms = UNDO_MS) {
  let pending: { id: number; key: string; fire: () => void } | null = null;
  return {
    start(key: string, fire: () => void) {
      if (pending) this.flush();
      const id = timers.set(() => {
        const p = pending;
        pending = null;
        p?.fire();
      }, ms);
      pending = { id, key, fire };
    },
    /** Takes the waiting send back; true when there was one. */
    undo(): string | null {
      if (!pending) return null;
      timers.clear(pending.id);
      const k = pending.key;
      pending = null;
      return k;
    },
    /** Sends the waiting one now (the page is closing, or another send starts). */
    flush() {
      if (!pending) return;
      timers.clear(pending.id);
      const p = pending;
      pending = null;
      p.fire();
    },
    get waiting() {
      return pending?.key ?? null;
    },
  };
}

/* ── the four numbers ── */

export interface Metrics {
  waiting: number | null;
  drafted: number | null;
  sent: number | null;
  filtered: number | null;
  /** Owed texts whose latest message is unread in Messages (#758); null while the texts line isn't on. */
  unread: number | null;
}

/**
 * The bottom row. Signed in, from the queue itself; signed out, from the public counts (counts only). A line that
 * isn't connected adds nothing; a number with neither line is null (shown as a dash).
 */
export function metricsOf(email: EmailStatus | null, texts: RelayStatus | null, queue: Exchange[] | null, sentHere: number): Metrics {
  const emailOn = !!email && email.gmail === "connected" && email.agent !== "waiting";
  const textsOn = !!texts && texts.hub !== "off" && texts.hub !== "wiped";
  if (!emailOn && !textsOn) return { waiting: null, drafted: null, sent: null, filtered: null, unread: null };
  const waiting = queue ? queue.length : (emailOn ? email.needsYou : 0) + (textsOn ? texts.owed : 0);
  const drafted = queue ? queue.filter((x) => x.draft).length : textsOn ? texts.draftsReady : 0;
  const sent = Math.max(textsOn ? texts.sentToday : 0, sentHere);
  const filtered = (emailOn ? email.noise + email.skipped : 0) + (textsOn ? texts.settled : 0);
  const unread = !textsOn ? null : queue ? queue.filter((x) => x.line === "text" && x.unread).length : (texts.unread ?? null);
  return { waiting, drafted, sent, filtered, unread };
}

/** The latest request on a thread. */
export const lastRequest = (requests: TextRequestView[] | undefined, thread: string) => (requests ?? []).filter((r) => r.thread === thread).sort((a, b) => b.created - a.created)[0];

/** "4 min", "1 h", "2 d". */
export function agoShort(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/* ── Open the codex: the dashboard ── */

/** Waiting this long is overdue, whatever the tier. */
export const OVERDUE_MS = 24 * 3_600_000;

export type Why = "sooner" | "needs-you" | "overdue";

export interface Pending {
  /** Waiting on Nikita, by line; null when that line isn't readable (signed out uses the public counts). */
  texts: number | null;
  email: number | null;
  /** Oldest first, with how long. */
  longest: { ex: Exchange; waited: number }[];
  /** The needs-you tier and the urgency signals: Dialtone's "sooner", the needs-you tier, waiting past a day. */
  high: { ex: Exchange; why: Why[] }[];
}

/**
 * The dashboard's three sections from the queue. High priority says only why in Relay's own words ("sooner",
 * "needs you", "waiting 2 d"): never which line of the private priority list put a mail there.
 */
export function pendingOf(queue: Exchange[] | null, now: number, fallback: { email: number | null; texts: number | null } = { email: null, texts: null }, n = 6): Pending {
  if (!queue) return { texts: fallback.texts, email: fallback.email, longest: [], high: [] };
  const longest = [...queue]
    .sort((a, b) => a.at - b.at)
    .slice(0, n)
    .map((ex) => ({ ex, waited: Math.max(0, now - ex.at) }));
  const high = queue
    .map((ex) => {
      const why: Why[] = [];
      if (ex.sooner) why.push("sooner");
      if (ex.line === "email" && ex.needsYou) why.push("needs-you");
      if (now - ex.at > OVERDUE_MS) why.push("overdue");
      return { ex, why };
    })
    .filter((h) => h.why.length > 0)
    .sort((a, b) => Number(b.why.includes("sooner")) - Number(a.why.includes("sooner")) || b.why.length - a.why.length || a.ex.at - b.ex.at)
    .slice(0, n);
  return { texts: queue.filter((x) => x.line === "text").length, email: queue.filter((x) => x.line === "email").length, longest, high };
}

/* ── The Codex (#642): one line of numbers, then two lists ── */

export interface CodexRow {
  ex: Exchange;
  waited: number;
}

export interface Codex {
  /** Waiting on Nikita, both lines; null when neither line is readable. */
  waiting: number | null;
  /** How long the oldest has waited (ms); null with nothing waiting or signed out. */
  oldest: number | null;
  /** Email that needs action and texts owed, each in the queue's order (newest first by default, #803). Each exchange once. */
  email: CodexRow[];
  texts: CodexRow[];
}

/** The Codex from the queue: the same exchanges the Thread holds, in its order, so a Done leaves both at once. */
export function codexOf(queue: Exchange[] | null, now: number, fallback: { email: number | null; texts: number | null } = { email: null, texts: null }, order: Order = "newest"): Codex {
  if (!queue) return { waiting: fallback.email === null && fallback.texts === null ? null : (fallback.email ?? 0) + (fallback.texts ?? 0), oldest: null, email: [], texts: [] };
  const rows = [...queue].sort(byOrder(order)).map((ex) => ({ ex, waited: Math.max(0, now - ex.at) }));
  const oldest = rows.reduce<number | null>((m, r) => (m === null || r.waited > m ? r.waited : m), null);
  return { waiting: queue.length, oldest, email: rows.filter((r) => r.ex.line === "email"), texts: rows.filter((r) => r.ex.line === "text") };
}

/** The "older unanswered" fold (#758) in the Thread's order: the hub sends it newest first; "oldest" turns it round. */
export const olderInOrder = <T extends { since: number }>(items: readonly T[], order: Order): T[] => [...items].sort((a, b) => (order === "oldest" ? a.since - b.since : b.since - a.since));

/** Sent this week, both lines: the hub's last seven days of texts and the email agent's own count. */
export function weekSent(texts: Pick<RelayStatus, "week"> | null, emailWeek: number): number {
  return (texts?.week ?? []).reduce((n, d) => n + d.sent, 0) + Math.max(0, emailWeek);
}

/** The checks a draft passed, shown ticking between Nikita's words and the draft: the learned style first. */
export function passesOf(ex: Exchange, traits: readonly string[] | null): string[] {
  const own = ex.line === "email" && traits?.length ? traits.slice(0, 4) : [];
  return [...own, ...(own.length ? [] : ["in your voice"]), ex.line === "email" ? "under 120 words" : "one text", "nothing made up"];
}
