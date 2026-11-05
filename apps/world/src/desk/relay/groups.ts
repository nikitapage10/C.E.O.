import type { TextItem } from "../texts/texts.ts";
import type { Order } from "./thread.ts";

/**
 * The group flipper (#805): the Texts page's group chats one at a time, flipped by tap, arrow key or swipe, each with
 * its recent texts in one fast-scrolling column and a reply box under them. A group is never drafted for (Blasto never
 * sees a group, docs/RELAY-PRIVACY.md), so the reply is only Nikita's own words, sent exactly as typed after the Undo
 * window, with this device's passkey unlock. Nothing here sends; this file only picks, orders and reads gestures.
 */

/** A group whose newest text is older than this doesn't show at all. */
export const GROUP_MAX_AGE_MS = 60 * 24 * 60 * 60_000;
/** The longest reply the line takes (the site's SEND_MAX). */
export const GROUP_REPLY_MAX = 2_000;
/** How far a finger must travel sideways, more than it moves down, to flip. */
export const SWIPE_PX = 48;

/** When a group last spoke: its newest shown text, else when it was listed. */
export const lastHeard = (g: TextItem): number => Math.max(g.since, ...(g.messages ?? []).map((m) => m.at));

/**
 * The groups to flip through: listed, with a summary or texts to read, heard from within GROUP_MAX_AGE_MS, in the
 * Thread's order (#803): newest or oldest by when they last spoke; priority puts the ones that asked Nikita first.
 */
export function groupsOf(items: readonly TextItem[] | undefined, now: number, order: Order = "newest"): TextItem[] {
  const asks = (g: TextItem) => (g.state !== "settled" || g.summary?.asked ? 1 : 0);
  return (items ?? [])
    .filter((i) => i.group && (i.summary || i.messages?.length) && now - lastHeard(i) <= GROUP_MAX_AGE_MS)
    .sort((a, b) => (order === "priority" ? asks(b) - asks(a) : 0) || (order === "oldest" ? lastHeard(a) - lastHeard(b) : lastHeard(b) - lastHeard(a)));
}

/** The next group's index, round the ends both ways. */
export const flip = (i: number, n: number, dir: -1 | 1): number => (n ? (((i + dir) % n) + n) % n : 0);

/** Which way a finger went: -1 back (a swipe right), 1 on (a swipe left), 0 a scroll or a tap. */
export function swipeOf(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** The words as they will go: line endings made plain and the ends trimmed, nothing else changed; null if none or too long. */
export function replyOf(typed: string): string | null {
  const words = typed.replace(/\r\n?/g, "\n").trim();
  return words && words.length <= GROUP_REPLY_MAX ? words : null;
}
