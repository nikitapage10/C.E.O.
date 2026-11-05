import { MAX_ITEMS, OLDER_WINDOW_MS, OWED_WINDOW_MS } from "../../../api/_relay/texts.ts";
import { onlyAcks } from "../../../api/_email/intentWords.ts";
import type { ChatInfo, Contact } from "./bluebubbles.ts";
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
 * Groups stay summary-only and are left out. A chat whose last message is Nikita's own is answered. Read state
 * (Messages' `dateRead`) only marks an owed chat unread; it never hides one.
 */

export interface BacklogEntry {
  chat: string;
  handle: string;
  /** When their last message came (ms). */
  at: number;
  unread: boolean;
}

export interface BacklogSort {
  /** Oldest first. */
  owed: BacklogEntry[];
  /** Newest first. */
  older: BacklogEntry[];
  check: ChatInfo[];
  settled: number;
  groups: number;
}

/** The most chats the backlog marks owed at once (#861: as many as the Desk lists, was 80); past it, the oldest within the window are counted with the older ones. */
export const BACKLOG_MAX = MAX_ITEMS;

export type Verdict = "owed" | "older" | "settled" | "check" | "answered" | "group" | "empty";

/** One chat's verdict. `contactOf` finds the sender's contact (for the skip list's names). */
export function verdictOf(c: ChatInfo, now: number, skipTerms: readonly string[], contactOf: (handle: string) => Contact | undefined): Verdict {
  if (c.group) return "group";
  const m = c.last;
  if (!m) return c.lastAt && now - c.lastAt < OWED_WINDOW_MS ? "check" : "empty";
  if (m.fromMe) return "answered";
  // A photo or a sticker with no words may still want an answer: the chat's latest messages decide.
  if (!m.text.trim()) return now - m.at < OWED_WINDOW_MS ? "check" : "empty";
  const handle = m.handle || c.handle;
  if (settleByRule({ handle, names: contactOf(handle)?.names ?? [], text: m.text }, skipTerms)) return "settled";
  if (now - m.at < OWED_WINDOW_MS) return "owed";
  // Past 60 days (#803): let go on purpose, neither named nor counted.
  if (now - m.at >= OLDER_WINDOW_MS) return "empty";
  // No model reads an older chat, so its closing intent is judged here: an "ok" or a "thanks" owes nothing.
  return onlyAcks([m.text]) ? "settled" : "older";
}

/** Every chat sorted; owed oldest first (capped at BACKLOG_MAX, the rest join the older ones), older newest first. */
export function sortBacklog(chats: readonly ChatInfo[], now: number, skipTerms: readonly string[], contactOf: (handle: string) => Contact | undefined): BacklogSort {
  const out: BacklogSort = { owed: [], older: [], check: [], settled: 0, groups: 0 };
  const seen = new Set<string>();
  for (const c of chats) {
    if (seen.has(c.chat)) continue;
    seen.add(c.chat);
    const v = verdictOf(c, now, skipTerms, contactOf);
    if (v === "group") out.groups++;
    else if (v === "settled") out.settled++;
    else if (v === "check") out.check.push(c);
    else if (v === "owed" || v === "older") out[v].push({ chat: c.chat, handle: c.last!.handle || c.handle, at: c.last!.at, unread: c.last!.read !== true });
  }
  out.owed.sort((a, b) => b.at - a.at);
  out.older.push(...out.owed.splice(BACKLOG_MAX));
  out.owed.sort((a, b) => a.at - b.at);
  out.older.sort((a, b) => b.at - a.at);
  return out;
}
