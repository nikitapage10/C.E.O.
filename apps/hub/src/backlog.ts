import { MAX_ITEMS, OLDER_WINDOW_MS, OWED_WINDOW_MS, UNREAD_WINDOW_MS } from "../../../api/_relay/texts.ts";
import { isEnder, UNREAD_ENDER_MS } from "./enders.ts";
import type { SettledWhy } from "./store.ts";
import { onlyAcks } from "../../../api/_email/intentWords.ts";
import { mediaOnly, type BlueBubbles, type ChatInfo, type Contact, type Message } from "./bluebubbles.ts";
import { settleByRule } from "./rules.ts";

/**
 * The backlog (#758, docs/RELAY-PRIVACY.md, "The backlog"): on start and on the Desk's Rescan, the hub reads every
 * chat's last message from BlueBubbles' chat query and sorts each one-to-one chat here, on the Mac, without a model:
 *
 *   owed     the last message is someone else's and came within OWED_WINDOW_MS (30 days): it joins the owed list
 *            and goes to Dialtone and Blasto like a new text (every rule runs again there, and closing intent).
 *   older    the same, 30 to 60 days old: folded into one "N older unanswered" count; the Desk can show who, never
 *            more. Past 60 days (OLDER_WINDOW_MS, #803) a chat is left out entirely, neither named nor counted.
 *   settled  a rule matches the last message (money and legal, codes, short codes, promos, the skip list), or, for an
 *            older chat, it is only an acknowledgement ("ok", "thanks").
 *   check    the last item is a reaction, a system item or has no text: the engine reads that chat's latest messages
 *            and sorts it again on the newest real one.
 *
 * Groups (#916: 6 or more other people, GROUP_MIN_PEOPLE) stay summary-only once read; a smaller chat of several is
 * sorted like a one-to-one chat. A chat whose last message is Nikita's own is answered. Since #950 (Nikita,
 * 2026-11-06: "waiting" is his phone's Unread filter, plus read chats that need a reply) an unread chat is owed whatever
 * its age, kind or sender (`judge` below), and a read one ending on an obvious "ok cool" or a tapback is set aside
 * without a model. BlueBubbles 1.9 serialises no chat-level unread state (no unread count, no
 * last_read_message_timestamp), so "unread" is the last item's `dateRead`, which is what the Mac's Messages shows.
 */

export interface BacklogEntry {
  chat: string;
  handle: string;
  /** When their last message came (ms). */
  at: number;
  unread: boolean;
  /**
   * Owed only while it is unread (#950): the set-aside that lands once Messages has read it. A group (summary-only
   * once read), or a code, short-code or promo sender (listed while unread, never sent to a model).
   */
  untilRead?: UntilRead;
  /** A muted chat (Messages' "Hide Alerts", #950). A mark only. */
  muted?: true;
}

/** A set-aside that waits for the chat to be read (#950). */
export type UntilRead = "group" | "code" | "short-code" | "promo";

/** A chat set aside by the scan (#950): listed under "set aside" with why, so nothing silently vanishes. */
export interface AsideEntry {
  chat: string;
  handle: string;
  at: number;
  why: SettledWhy;
}

export interface BacklogSort {
  /** Oldest first. */
  owed: BacklogEntry[];
  /** Newest first. */
  older: BacklogEntry[];
  check: ChatInfo[];
  settled: number;
  /** The settled ones a rule or the ender check set aside (#950), newest first; the skip list's are only counted. */
  aside: AsideEntry[];
  groups: number;
}

/** The most chats the backlog marks owed at once (#861: as many as the Desk lists, was 80); past it, the oldest within the window are counted with the older ones. */
export const BACKLOG_MAX = MAX_ITEMS;

export type Verdict = "owed" | "older" | "settled" | "check" | "answered" | "group" | "empty";

export interface Judged {
  verdict: Verdict;
  /** Why, for `settled`. */
  why?: SettledWhy;
  /** For `owed`: the set-aside that lands once it is read (#950). */
  untilRead?: UntilRead;
}

/** A rule's kind that still lists an unread chat (#950: Messages' Unread filter shows it), kept from the models. */
const LISTED_UNREAD: readonly SettledWhy[] = ["code", "short-code", "promo"];

/**
 * One chat's verdict (#950, Nikita 2026-11-06: "waiting" is Messages' Unread filter, plus read chats that need a reply).
 * `contactOf` finds the sender's contact (for the skip list's names).
 *
 *   (A) Unread: their latest item (a text, a photo or a tapback) has no read time in Messages and nothing of Nikita's
 *       came after it. Owed whatever its age, a group (muted ones too) or not, a short code, an unknown number or an
 *       email address. No model judges it. Only the skip list and a money or legal text set it aside (listed, counted).
 *       A code, short-code or promo sender is listed but never reaches a model. An unread text over UNREAD_ENDER_MS old
 *       still goes through the ender check: the Mac's read state can lag the phone's.
 *   (B) Read: owed within OWED_WINDOW_MS unless a rule or the ender pre-pass sets it aside; Dialtone (one Claude call
 *       on the site, within the cap) then judges whether it needs a reply. 30 to 60 days: the older count. A group
 *       stays summary-only (owed only when Nikita is asked or named).
 */
export function judge(c: ChatInfo, now: number, skipTerms: readonly string[], contactOf: (handle: string) => Contact | undefined): Judged {
  const m = c.last;
  const it = c.lastItem;
  const several = c.multi ?? c.group;
  // A tapback or another item with no message last (#950): theirs and unread is waiting, as Messages shows it; theirs
  // and read only ends the conversation; Nikita's own reaction is his answer. Without the item, the chat's latest
  // messages decide, as before.
  if (!m && it && !(it.reaction === false && !it.fromMe)) {
    if (it.fromMe) return { verdict: "answered" };
    if (!it.read && now - it.at < UNREAD_ENDER_MS) return { verdict: "owed", ...(c.group && { untilRead: "group" as const }) };
    return c.group ? { verdict: "group" } : { verdict: "settled", why: "ender" };
  }
  if (!m) return { verdict: c.lastAt && now - c.lastAt < OLDER_WINDOW_MS ? "check" : "empty" };
  if (m.fromMe) return { verdict: "answered" };
  const unread = m.read === false;
  // No words and no attachment mark: the chat's latest messages decide.
  if (!m.text.trim() && !m.media) return { verdict: now - m.at < (unread ? UNREAD_WINDOW_MS : OLDER_WINDOW_MS) ? "check" : "empty" };
  // A chat of several's last message names no sender: its latest messages (which do) decide, so the skip list runs on
  // whoever wrote it. An unread group needs no sender to be listed: only the rules over its text.
  if (several && !m.handle && !(c.group && unread)) return { verdict: now - m.at < (unread ? UNREAD_WINDOW_MS : OLDER_WINDOW_MS) ? "check" : "empty" };
  const handle = m.handle || c.handle;
  const rule = settleByRule({ handle, names: handle ? (contactOf(handle)?.names ?? []) : [], text: m.text }, skipTerms);
  const ender = !m.media && isEnder(m.text);
  if (unread) {
    if (now - m.at >= UNREAD_WINDOW_MS) return { verdict: "empty" };
    if (rule === "skip" || rule === "money") return { verdict: "settled", why: rule };
    // Stale read state (#950): an old unread "ok cool" ends the conversation like a read one.
    if (ender && now - m.at >= UNREAD_ENDER_MS) return c.group ? { verdict: "group" } : { verdict: "settled", why: "ender" };
    if (c.group) return { verdict: "owed", untilRead: "group" };
    if (rule && LISTED_UNREAD.includes(rule)) return { verdict: "owed", untilRead: rule as UntilRead };
    return { verdict: "owed" };
  }
  if (c.group) return { verdict: "group" };
  if (rule) return { verdict: "settled", why: rule };
  // Past 60 days (#803): let go on purpose, neither named nor counted.
  if (now - m.at >= OLDER_WINDOW_MS) return { verdict: "empty" };
  // The ender pre-pass (#950): an obvious "ok cool" or "lol" never reaches a model.
  if (ender) return { verdict: "settled", why: "ender" };
  if (now - m.at < OWED_WINDOW_MS) return { verdict: "owed" };
  // No model reads an older chat, so its closing intent is judged here: an "ok" or a "thanks" owes nothing.
  return m.text.trim() && onlyAcks([m.text]) ? { verdict: "settled", why: "ender" } : { verdict: "older" };
}

/** One chat's verdict (see `judge`). */
export const verdictOf = (c: ChatInfo, now: number, skipTerms: readonly string[], contactOf: (handle: string) => Contact | undefined): Verdict => judge(c, now, skipTerms, contactOf).verdict;

/** Their latest item and whether it counts as waiting, for one chat (#950): the backlog's entry for an owed verdict. */
function entryOf(c: ChatInfo, j: Judged): BacklogEntry {
  const m = c.last;
  const at = m && !m.fromMe ? m.at : (c.lastItem?.at ?? c.lastAt);
  const unread = m ? m.read !== true : c.lastItem ? !c.lastItem.read : true;
  return { chat: c.chat, handle: m?.handle || c.handle, at, unread, ...(j.untilRead && { untilRead: j.untilRead }), ...(c.muted && { muted: true as const }) };
}

/**
 * One chat's verdict from its own latest messages (#950), the one path the full scan and `relay why` share: `msgs` are
 * the chat's newest messages with words or an attachment, oldest first, as `/api/v1/chat/<guid>/message` gives them
 * (sorted by date). The chat query's last message can't be trusted for this: BlueBubbles picks it by MAX(ROWID), not by
 * date, and Messages in iCloud writes late-synced older messages with higher ROWIDs, so a chat whose newest text is
 * theirs could read as answered. A tapback after the newest message (the chat query's last item) still counts.
 */
export function judgeChat(c: ChatInfo, msgs: readonly Message[], now: number, skipTerms: readonly string[], contactOf: (handle: string) => Contact | undefined): { judged: Judged; entry: BacklogEntry | null; aside: AsideEntry | null } {
  const newest = msgs.length ? msgs[msgs.length - 1]! : null;
  const it = c.lastItem;
  const several = c.multi ?? c.group;
  let judged: Judged;
  let entry: BacklogEntry | null = null;
  let at = 0;
  let handle = c.handle;
  if (it?.reaction && (!newest || it.at > newest.at)) {
    judged = judge({ ...c, last: null }, now, skipTerms, contactOf);
    at = it.at;
    if (judged.verdict === "owed" || judged.verdict === "older") entry = { chat: c.chat, handle, at, unread: !it.read, ...(judged.untilRead && { untilRead: judged.untilRead }), ...(c.muted && { muted: true as const }) };
  } else if (!newest) {
    judged = { verdict: c.group ? "group" : "empty" };
  } else {
    handle = newest.fromMe ? "" : newest.handle || (several ? "" : c.handle);
    judged = judge({ ...c, lastItem: undefined, lastAt: newest.at, last: { ...newest, handle, ...(mediaOnly(newest) && { media: true as const }) } }, now, skipTerms, contactOf);
    // A chat of several whose newest text names no sender can't be checked against the rules: it waits for its sender.
    if (judged.verdict === "check") judged = { verdict: "empty" };
    at = newest.at;
    if (judged.verdict === "owed" || judged.verdict === "older") entry = { chat: c.chat, handle: handle || c.handle, at, unread: newest.read !== true, ...(judged.untilRead && { untilRead: judged.untilRead }), ...(c.muted && { muted: true as const }) };
  }
  const aside = judged.verdict === "settled" && judged.why && judged.why !== "skip" && !c.group ? { chat: c.chat, handle: handle || c.handle, at, why: judged.why } : null;
  return { judged, entry, aside };
}

/** The scan reads a chat's own messages (judgeChat) when its last item came within this, or is theirs and unread. */
export const SCAN_REACH_MS = 120 * 24 * 60 * 60_000;
/** Whether the full scan reads this chat's messages (#950): active lately, or its last item is theirs and unread. */
export const scanWants = (c: ChatInfo, now: number) => (c.lastAt > 0 && now - c.lastAt < SCAN_REACH_MS) || (!!c.lastItem && !c.lastItem.fromMe && !c.lastItem.read);

/** An empty sort, for the scan to fill chat by chat. */
export const emptySort = (): BacklogSort => ({ owed: [], older: [], check: [], settled: 0, aside: [], groups: 0 });

/** Puts one judged chat in its place in a sort. */
export function place(out: BacklogSort, c: ChatInfo, r: ReturnType<typeof judgeChat>): void {
  const v = r.judged.verdict;
  if (v === "group") out.groups++;
  else if (v === "settled") {
    out.settled++;
    if (r.aside) out.aside.push(r.aside);
  } else if (v === "check") out.check.push(c);
  else if ((v === "owed" || v === "older") && r.entry) out[v].push(r.entry);
}

/** The sort's final order: owed oldest first (capped at BACKLOG_MAX, the rest join the older ones), older and aside newest first. */
export function finish(out: BacklogSort): BacklogSort {
  out.owed.sort((a, b) => b.at - a.at);
  out.older.push(...out.owed.splice(BACKLOG_MAX));
  out.owed.sort((a, b) => a.at - b.at);
  out.older.sort((a, b) => b.at - a.at);
  out.aside.sort((a, b) => b.at - a.at);
  return out;
}

/** Every chat sorted; owed oldest first (capped at BACKLOG_MAX, the rest join the older ones), older newest first. */
export function sortBacklog(chats: readonly ChatInfo[], now: number, skipTerms: readonly string[], contactOf: (handle: string) => Contact | undefined): BacklogSort {
  const out: BacklogSort = { owed: [], older: [], check: [], settled: 0, aside: [], groups: 0 };
  const seen = new Set<string>();
  for (const c of chats) {
    if (seen.has(c.chat)) continue;
    seen.add(c.chat);
    const j = judge(c, now, skipTerms, contactOf);
    const v = j.verdict;
    if (v === "group") out.groups++;
    else if (v === "settled") {
      out.settled++;
      if (j.why && j.why !== "skip" && !c.group) out.aside.push({ chat: c.chat, handle: c.last?.handle || c.handle, at: c.last?.at ?? c.lastItem?.at ?? c.lastAt, why: j.why });
    } else if (v === "check") out.check.push(c);
    else if (v === "owed" || v === "older") out[v].push(entryOf(c, j));
  }
  out.owed.sort((a, b) => b.at - a.at);
  out.older.push(...out.owed.splice(BACKLOG_MAX));
  out.owed.sort((a, b) => a.at - b.at);
  out.older.sort((a, b) => b.at - a.at);
  out.aside.sort((a, b) => b.at - a.at);
  return out;
}

/**
 * What `relay check` says of the Mac's own read state (#950): how many chats Messages shows unread (their latest item
 * unread, nothing of Nikita's after it) and how many of those have been unread over STALE_UNREAD_MS. Many old ones
 * hint that the phone's reads aren't reaching this Mac (Messages in iCloud). Counts only.
 */
export const STALE_UNREAD_MS = 7 * 24 * 60 * 60_000;
export function unreadCounts(chats: readonly ChatInfo[], now: number): { unread: number; stale: number } {
  let unread = 0;
  let stale = 0;
  const seen = new Set<string>();
  for (const c of chats) {
    if (seen.has(c.chat)) continue;
    seen.add(c.chat);
    const it = c.lastItem ?? (c.last ? { fromMe: c.last.fromMe, read: c.last.read === true, at: c.last.at, reaction: false } : null);
    if (!it || it.fromMe || it.read) continue;
    unread++;
    if (now - it.at > STALE_UNREAD_MS) stale++;
  }
  return { unread, stale };
}

/**
 * Every chat BlueBubbles has, page by page until an empty page (#870: a page can come back short of the limit before
 * the end, and stopping at the first short page left every older chat unread), `pages` pages at most.
 */
export async function allChats(bb: Pick<BlueBubbles, "chatList">, page: number, pages: number): Promise<ChatInfo[]> {
  const chats: ChatInfo[] = [];
  for (let i = 0; i < pages; i++) {
    const got = await bb.chatList(i * page, page);
    chats.push(...got);
    if (!got.length) break;
  }
  return chats;
}
