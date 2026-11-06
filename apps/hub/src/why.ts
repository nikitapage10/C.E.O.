import { maskHandle, matchContacts } from "../../../api/_relay/compose.ts";
import { judgeChat, scanWants } from "./backlog.ts";
import { channelOf, isGroupChat, mediaOnly, type ChatInfo, type Contact, type Message } from "./bluebubbles.ts";
import { chatPerson } from "./learn.ts";
import type { SettledWhy, Thread } from "./store.ts";

/**
 * `relay why <name or number>` (#870), on the Mac only: for each one-to-one chat of the matching contacts, the verdict
 * the hub's own rules give it today, the dates of their last text and Nikita's, and what the hub's state file says of
 * it. Read from BlueBubbles on 127.0.0.1 and the state file; nothing goes to the site, and no message's text is
 * printed (the rule's kind only, never the words that matched).
 */

export type WhyVerdict = "owed" | "answered" | "group" | "settled" | "closing" | "ender" | "older" | "empty" | "missing";

export interface WhyLine {
  chat: string;
  verdict: WhyVerdict;
  /** The rule that settles it, when `settled`. */
  rule: SettledWhy | null;
  theirLast: number | null;
  myLast: number | null;
  /** Their unanswered photos or files with no words. */
  media: number;
  /** Whether Messages on this Mac shows their newest text unread (#950); null with none. */
  unread: boolean | null;
  /** What the state file holds for this chat, or null when the hub has no row for it. */
  stored: { state: Thread["state"]; why: Thread["why"]; kept: boolean } | null;
}

const digits = (h: string) => h.replace(/\D/g, "").slice(-10);
const same = (a: string, b: string) => (a.includes("@") || b.includes("@") ? a.trim().toLowerCase() === b.trim().toLowerCase() : digits(a).length >= 7 && digits(a) === digits(b));

/** The contacts a query names: by name (as a new text's card finds them), or by number (its last digits, 4 or more). */
export function whoMatches(contacts: readonly Contact[], query: string): Contact[] {
  const q = query.trim();
  const d = q.replace(/\D/g, "");
  if (d.length >= 4 && !/[A-Za-z]{2}/.test(q)) return contacts.filter((c) => c.handles.some((h) => h.replace(/\D/g, "").endsWith(d)));
  if (q.includes("@")) return contacts.filter((c) => c.handles.some((h) => h.trim().toLowerCase() === q.toLowerCase()));
  const exact = matchContacts(contacts, q);
  if (exact.length) return exact;
  const low = q.toLowerCase();
  return low.length >= 2 ? contacts.filter((c) => c.names.some((n) => n.toLowerCase().includes(low))) : [];
}

/** The one-to-one chats with any of these handles (a number or an address), from BlueBubbles' chat list. */
export const chatsFor = (chats: readonly ChatInfo[], handles: readonly string[]) => chats.filter((c) => !(c.multi ?? c.group) && handles.some((h) => same(h, c.handle || chatPerson(c.chat))));

/** Chats of several whose name in Messages holds the query (#950: groups in `relay why`), 10 at most. */
export const groupsFor = (chats: readonly ChatInfo[], query: string): ChatInfo[] => {
  const q = query.trim().toLowerCase();
  return q.length < 2 ? [] : chats.filter((c) => (c.multi ?? c.group) && c.name.toLowerCase().includes(q)).slice(0, 10);
};

/**
 * One chat's verdict (#950): the same code path the full scan uses (./backlog.ts, judgeChat), so `why` and the scan
 * agree. `msgs` are its latest messages (oldest first, words or attachments), as the engine reads them. The skip list
 * lives on the site and isn't read here; the state file's verdict shows it.
 */
export function explain(chat: ChatInfo, msgs: readonly Message[], stored: Thread | undefined, now: number, names: readonly string[]): WhyLine {
  const theirs = msgs.filter((m) => !m.fromMe);
  const mine = msgs.filter((m) => m.fromMe);
  const lastMine = msgs.map((m) => m.fromMe).lastIndexOf(true);
  const unanswered = msgs.slice(lastMine + 1).filter((m) => !m.fromMe);
  const newest = theirs.length ? theirs[theirs.length - 1]! : null;
  const base = {
    chat: chat.chat,
    rule: null,
    theirLast: newest ? newest.at : null,
    myLast: mine.length ? mine[mine.length - 1]!.at : null,
    media: unanswered.filter(mediaOnly).length,
    unread: newest ? newest.read !== true : null,
    stored: stored ? { state: stored.state, why: stored.why, kept: stored.kept === true } : null,
  };
  const contactOf = (h: string) => (names.length && h ? { names: [...names], handles: [h] } : undefined);
  const { judged } = judgeChat(chat, msgs, now, [], contactOf);
  switch (judged.verdict) {
    case "group":
      return { ...base, verdict: "group" };
    case "answered":
      return { ...base, verdict: "answered" };
    case "owed":
      return { ...base, verdict: "owed" };
    case "older":
      return { ...base, verdict: "older" };
    case "settled":
      return judged.why === "ender" ? { ...base, verdict: "ender" } : { ...base, rule: judged.why ?? null, verdict: "settled" };
    default:
      return { ...base, verdict: "empty" };
  }
}

/** Whether the full scan reads this chat at all (#950): `why` says so when it doesn't. */
export { scanWants };

const WORDS: Record<WhyVerdict, string> = {
  owed: "waiting: unread in Messages (any age), or read within 30 days and not only an ok",
  answered: "answered: your message is the newest",
  group: "a group, read: summarised on the shelf, waiting only when you are asked or named",
  settled: "set aside by a rule",
  closing: "closing intent: only an acknowledgement after your closing reply",
  ender: "set aside: their last text only ends the conversation (an ok, a lol, a tapback)",
  older: "read, and older than the 30-day window (shown in the older count)",
  empty: "nothing to answer (no messages, or past 60 days)",
  missing: "not in BlueBubbles",
};

const RULE_WORDS: Record<SettledWhy, string> = {
  group: "group",
  code: "a one-time code",
  "short-code": "a short-code sender",
  promo: "marketing",
  money: "money or legal words (kept from the models)",
  skip: "your skip list",
  "no-reply": "Dialtone read it as needing no reply",
  closing: "closing intent",
  done: "you marked it done",
  ender: "only an ok, a lol or a tapback",
};

/** A local date and time, minutes only. */
const when = (t: number | null) => {
  if (t === null) return "none";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** The Terminal's lines for one chat: who (name, channel, last 4 digits or a masked address), the verdict, the dates. */
export function describeWhy(name: string, w: WhyLine): string[] {
  const several = isGroupChat(w.chat);
  const mask = several ? "a chat of several" : (maskHandle(chatPerson(w.chat)) ?? "no number");
  const verdict = w.verdict === "settled" && w.rule ? `${WORDS.settled}: ${RULE_WORDS[w.rule]}` : WORDS[w.verdict];
  const stored = w.stored
    ? `${w.stored.state}${w.stored.why ? ` (${RULE_WORDS[w.stored.why]})` : ""}${w.stored.kept ? ", brought back" : ""}`
    : "no row yet (the next scan or their next text adds one)";
  return [
    `${name} (${channelOf(w.chat)}, ${mask})`,
    `  verdict: ${verdict}`,
    `  their last text: ${when(w.theirLast)}${w.unread === null ? "" : w.unread ? " (unread on this Mac)" : " (read on this Mac)"}; yours: ${when(w.myLast)}${w.media ? `; ${w.media} photo or file${w.media === 1 ? "" : "s"} unanswered` : ""}`,
    `  the hub's state: ${stored}`,
  ];
}

export { WORDS as WHY_WORDS };

/** The one-to-one threads set aside, by kind (#950: `relay check`), counts only: "4 money or legal, 2 a code"; "" for none. */
export function asideKinds(threads: readonly Pick<Thread, "group" | "state" | "why">[]): string {
  const n = new Map<SettledWhy, number>();
  for (const t of threads) if (!t.group && t.state === "settled" && t.why) n.set(t.why, (n.get(t.why) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c} ${RULE_WORDS[k]}`).join(", ");
}
