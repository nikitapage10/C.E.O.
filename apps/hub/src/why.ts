import { CAPS } from "../../../api/_relay/models.ts";
import { maskHandle, matchContacts } from "../../../api/_relay/compose.ts";
import { closingReply, onlyAcks } from "../../../api/_email/intentWords.ts";
import { OLDER_WINDOW_MS, OWED_WINDOW_MS } from "../../../api/_relay/texts.ts";
import { channelOf, mediaOnly, type ChatInfo, type Contact, type Message } from "./bluebubbles.ts";
import { chatPerson } from "./learn.ts";
import { settleByRule } from "./rules.ts";
import type { SettledWhy, Thread } from "./store.ts";

/**
 * `relay why <name or number>` (#870), on the Mac only: for each one-to-one chat of the matching contacts, the verdict
 * the hub's own rules give it today, the dates of their last text and Nikita's, and what the hub's state file says of
 * it. Read from BlueBubbles on 127.0.0.1 and the state file; nothing goes to the site, and no message's text is
 * printed (the rule's kind only, never the words that matched).
 */

export type WhyVerdict = "owed" | "answered" | "group" | "settled" | "closing" | "older" | "empty" | "missing";

export interface WhyLine {
  chat: string;
  verdict: WhyVerdict;
  /** The rule that settles it, when `settled`. */
  rule: SettledWhy | null;
  theirLast: number | null;
  myLast: number | null;
  /** Their unanswered photos or files with no words. */
  media: number;
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
export const chatsFor = (chats: readonly ChatInfo[], handles: readonly string[]) => chats.filter((c) => !c.group && handles.some((h) => same(h, c.handle || chatPerson(c.chat))));

/**
 * One chat's verdict, by the hub's own rules: `msgs` its latest messages (oldest first, words or attachments), as the
 * engine reads them. The skip list lives on the site and isn't read here; the state file's verdict shows it.
 */
export function explain(chat: ChatInfo, msgs: readonly Message[], stored: Thread | undefined, now: number, names: readonly string[]): WhyLine {
  const theirs = msgs.filter((m) => !m.fromMe);
  const mine = msgs.filter((m) => m.fromMe);
  const base = {
    chat: chat.chat,
    rule: null,
    theirLast: theirs.length ? theirs[theirs.length - 1]!.at : null,
    myLast: mine.length ? mine[mine.length - 1]!.at : null,
    media: 0,
    stored: stored ? { state: stored.state, why: stored.why, kept: stored.kept === true } : null,
  };
  if (chat.group) return { ...base, verdict: "group" };
  if (!msgs.length) return { ...base, verdict: "empty" };
  const lastMine = msgs.map((m) => m.fromMe).lastIndexOf(true);
  const unanswered = msgs.slice(lastMine + 1).filter((m) => !m.fromMe);
  if (!unanswered.length) return { ...base, verdict: "answered" };
  const media = unanswered.filter(mediaOnly).length;
  const handle = unanswered.find((m) => m.handle)?.handle || chat.handle || chatPerson(chat.chat);
  // Every rule over what a model call would carry: the unanswered run and the turns before it (as the engine does).
  const seen = msgs.slice(Math.max(0, lastMine - (CAPS.draftEarlier - 1)));
  const rule = seen.map((m) => settleByRule({ handle, names: [...names], text: m.text }, [])).find((w) => w !== null) ?? null;
  const last = unanswered[unanswered.length - 1]!.at;
  if (rule) return { ...base, media, rule, verdict: "settled" };
  if (now - last >= OLDER_WINDOW_MS) return { ...base, media, verdict: "empty" };
  if (now - last >= OWED_WINDOW_MS) return { ...base, media, verdict: "older" };
  if (!media && lastMine >= 0 && closingReply(msgs[lastMine]!.text) && onlyAcks(unanswered.map((m) => m.text))) return { ...base, media, verdict: "closing" };
  return { ...base, media, verdict: "owed" };
}

const WORDS: Record<WhyVerdict, string> = {
  owed: "owed: their text is the last word, within 30 days",
  answered: "answered: your message is the newest",
  group: "a group (groups are summarised, not listed one by one)",
  settled: "set aside by a rule",
  closing: "closing intent: only an acknowledgement after your closing reply",
  older: "older than the 30-day window (shown in the older count)",
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
  const mask = maskHandle(chatPerson(w.chat)) ?? "no number";
  const verdict = w.verdict === "settled" && w.rule ? `${WORDS.settled}: ${RULE_WORDS[w.rule]}` : WORDS[w.verdict];
  const stored = w.stored
    ? `${w.stored.state}${w.stored.why ? ` (${RULE_WORDS[w.stored.why]})` : ""}${w.stored.kept ? ", brought back" : ""}`
    : "no row yet (the next scan or their next text adds one)";
  return [
    `${name} (${channelOf(w.chat)}, ${mask})`,
    `  verdict: ${verdict}`,
    `  their last text: ${when(w.theirLast)}; yours: ${when(w.myLast)}${w.media ? `; ${w.media} photo or file${w.media === 1 ? "" : "s"} unanswered` : ""}`,
    `  the hub's state: ${stored}`,
  ];
}

export { WORDS as WHY_WORDS };
