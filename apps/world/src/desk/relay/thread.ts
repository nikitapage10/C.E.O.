import type { EmailItem, EmailStatus } from "../email/email.ts";
import type { TextItem, TextRequestView } from "../texts/texts.ts";
import type { RelayStatus } from "@ceo/core";

/**
 * Relay's Thread (#615), the logic with no DOM: one exchange at a time, from the two live lines.
 *
 *   queueOf      the email that needs Nikita (Gmail, #263) and the texts he owes (the Mac hub, #535), as one queue of
 *                exchanges, the ones to answer sooner and the longest waiting first; skipped ones go to the back.
 *   commandOf    what a spoken or typed line means: yes, no, skip, later, change it, filter these out, block this
 *                sender, undo, or (anything else) words for a reply.
 *   allowed      the gate. A command only works in the state it belongs to: "send" and "yes" only while a draft is on
 *                screen, "undo" only while a send waits out its five seconds, the sender rules only on the email line.
 *   undoable     a send waits UNDO_MS before it goes; Undo in that window and nothing is sent.
 *   metricsOf    the four numbers under the stage.
 *
 * Nothing here sends. The page asks the existing endpoints: a text's send is the texts line's send request (the
 * device's 72-hour passkey unlock, single-use, bound to the draft on screen); email stays read-only.
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
  /** Only a one-to-one text can be sent from here; email is read-only (Gmail's scope), groups are never drafted for. */
  sendable: boolean;
}

const firstName = (who: string) => who.trim().split(/\s+/)[0] || who;

/** The letter on an avatar. */
export const initialOf = (who: string) => (who.trim()[0] ?? "?").toUpperCase();

/** One email item as an exchange. */
export function fromEmail(i: EmailItem): Exchange {
  return { key: `e:${i.id}`, line: "email", id: i.id, who: i.from || "Unknown sender", channel: "Email", at: i.at, subject: i.subject, body: i.summary || i.subject, action: i.action, advice: i.advice ?? "", draft: i.draft ?? null, draftAt: 0, said: i.said ?? "", sooner: false, later: false, sendable: false };
}

/** One text thread as an exchange. */
export function fromText(i: TextItem): Exchange {
  return { key: `t:${i.id}`, line: "text", id: i.id, who: i.name || "Unknown sender", channel: i.channel, at: i.since, subject: "", body: i.group ? (i.summary?.text ?? "") : i.gist, action: "", advice: "", draft: i.group ? null : (i.draft?.text ?? null), draftAt: i.draft?.at ?? 0, said: "", sooner: i.sort === "sooner", later: i.state === "later", sendable: !i.group };
}

/** The queue: email that needs Nikita and texts he owes (not groups, not settled), sooner first, then oldest; skipped and later at the back. */
export function queueOf(email: EmailItem[] | undefined, texts: TextItem[] | undefined, skipped: readonly string[] = []): Exchange[] {
  const all = [
    ...(email ?? []).filter((i) => !i.done && (i.kind === "needs-you" || i.kind === "unsorted")).map(fromEmail),
    ...(texts ?? []).filter((i) => !i.group && i.state !== "settled").map(fromText),
  ];
  const back = (x: Exchange) => {
    const s = skipped.indexOf(x.key);
    return s >= 0 ? 2 + s : x.later ? 1 : 0;
  };
  return all.sort((a, b) => back(a) - back(b) || Number(b.sooner) - Number(a.sooner) || a.at - b.at);
}

/* ── commands ── */

export type Command = "yes" | "no" | "skip" | "later" | "change" | "filter" | "block" | "undo" | "words";

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

/** What one line, said or typed, means. Anything that isn't a command is words for a reply ("tell them I'll be 10 late"). */
export function commandOf(raw: string): Command | null {
  const w = norm(raw);
  if (!w) return null;
  // A question is never a command ("send it?", "did you send it?"), and neither is a line that redirects one.
  if (/\?/.test(raw)) return "words";
  for (const [c, re] of COMMANDS) if (re.test(w)) return c;
  return "words";
}

/** Where the Thread is with the exchange on screen. */
export type Phase =
  /** Nothing waiting (or nothing readable). */
  | "empty"
  /** An exchange on screen with no draft yet: Nikita answers in a few words, or skips. */
  | "incoming"
  /** His words went to Blasto; the draft is on its way. */
  | "drafting"
  /** A draft on screen and "Send to X?". */
  | "ask"
  /** He said yes: the send waits UNDO_MS, Undo takes it back. */
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
      return phase === "incoming" || phase === "ask";
    case "filter":
    case "block":
      return (phase === "incoming" || phase === "ask") && ex.line === "email";
    case "words":
      return phase === "incoming" || phase === "ask";
  }
}

/** The commands to offer on screen for a phase (said aloud or keyed). */
export function offered(phase: Phase, ex: Exchange | null): Command[] {
  const all: Command[] = ["yes", "no", "change", "skip", "later", "filter", "block", "undo"];
  return all.filter((c) => allowed(c, phase, ex));
}

/** Keys: Y yes, N no, S skip, Z undo, L later. */
export function keyCommand(key: string): Command | null {
  const k = key.toLowerCase();
  return k === "y" ? "yes" : k === "n" ? "no" : k === "s" ? "skip" : k === "z" ? "undo" : k === "l" ? "later" : null;
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
}

/**
 * The bottom row. Signed in, from the queue itself; signed out, from the public counts (counts only). A line that
 * isn't connected adds nothing; a number with neither line is null (shown as a dash).
 */
export function metricsOf(email: EmailStatus | null, texts: RelayStatus | null, queue: Exchange[] | null, sentHere: number): Metrics {
  const emailOn = !!email && email.gmail === "connected" && email.agent !== "waiting";
  const textsOn = !!texts && texts.hub !== "off" && texts.hub !== "wiped";
  if (!emailOn && !textsOn) return { waiting: null, drafted: null, sent: null, filtered: null };
  const waiting = queue ? queue.length : (emailOn ? email.needsYou : 0) + (textsOn ? texts.owed : 0);
  const drafted = queue ? queue.filter((x) => x.draft).length : textsOn ? texts.draftsReady : 0;
  const sent = Math.max(textsOn ? texts.sentToday : 0, sentHere);
  const filtered = (emailOn ? email.noise + email.skipped : 0) + (textsOn ? texts.settled : 0);
  return { waiting, drafted, sent, filtered };
}

/** The latest request on a thread. */
export const lastRequest = (requests: TextRequestView[] | undefined, thread: string) => (requests ?? []).filter((r) => r.thread === thread).sort((a, b) => b.created - a.created)[0];

/** "4 min", "1 h", "2 d". */
export function agoShort(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}
