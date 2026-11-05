/**
 * Talking back to an item on Today's floor (the Senate Rotunda's docket, #740): the words are read in the item's
 * context, never as free capture. Nikita (2026-11-05): "yeah, go ahead and fix this" on a Repair got the note/to-do
 * chooser; it should have gone to Skippy.
 *
 *   approve  "go ahead", "fix it", "do it", "yes", "ship it", "approve" on a Repair or a Decision: handed straight to
 *            Skippy, the Magnificent (the `kernel` log, needs "skippy", no model), with the item's context; his always-on
 *            responder files a build or a fix for the Builder (api/_skippy/kernelagent.ts).
 *   put off  "no", "not now", "later", "dismiss": snoozed or dismissed, like any held row (./parse.ts).
 *   rules    a note, a reminder, a time, "done", "make it a to-do": as before (./parse.ts readTalkBack).
 *   else     anything else goes to Skippy's chat with the item as context, and Skippy decides. Never the chooser.
 *
 * The item's words are the docket's own (rotunda/rite.ts), already safe to show; Nikita's go through the privacy check
 * on the server like every chat message. Pure and dependency-free apart from ./parse.ts, so the browser imports it too.
 * Underscore folder: never served as a function.
 */

import { atWall, DEFAULT_HOUR, readTalkBack, wall, type Reading } from "./parse.js";

export type FloorKind = "duty" | "decision" | "repair";

/** An item on the floor, in the docket's own safe words. */
export interface FloorItem {
  kind: FloorKind;
  /** The room's name: "Boiler Room". */
  room: string;
  /** The pod that brought it: a Council member's id ("boiler"), or "kernel". */
  by: string;
  /** The item in a few words: "Boiler Room needs a look". */
  what: string;
  /** Repair: the cause and the fix. */
  cause?: string;
  fix?: string;
  /** Decision: the suggested option (the first). */
  option?: string;
}

/** The submind that owns each room (docs/SKIPPY.md), for "reported by the Pessimist". */
export const OWNER: Record<string, string> = {
  kernel: "Skippy, the Magnificent",
  foundry: "the Builder",
  relay: "the Messenger",
  exchange: "the Bookie",
  green: "the Commentator",
  spire: "the Executive",
  archive: "the Historian",
  boiler: "the Pessimist",
  breakroom: "the Life of the Party",
  workshop: "the Artiste",
  studio: "the Director",
  annex: "the Stagehand",
  haven: "the Steward",
};
export const ownerOf = (by: string): string => OWNER[by] ?? "Skippy";

/** What a reply to a floor item comes to: a held-row intent (or its two chips), or Skippy. */
export type ItemReply = Reading | { ok: "skippy"; approve: boolean };

const LEAD = /^(?:\s*(?:ok(?:ay)?|so|um+|uh+|hey|alright|right|well|oh|hmm+|yes|yeah|yep|yup|sure|please|and)[,.!]?\s+)+/i;
/** A yes on its own, or with a word or two around it. */
const BARE_YES = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|alright|aye|approved?|agreed|sounds good|please|please do|do it|go|yes please)[.!]*$/i;
/** Saying to go on with it, anywhere in the line. */
const APPROVE = /\b(?:go ahead|go for it|go on|do it|do that|do this|fix (?:it|this|that|them)|fix it up|ship (?:it|this|that)|approve(?:d)?|green ?light|make it so|send it|run (?:it|the fix)|apply (?:it|the fix)|let'?s do (?:it|this|that)|let'?s go|proceed|carry on|sounds good|please do|get (?:it|this) (?:done|fixed|going)|take care of (?:it|this)|handle (?:it|this))\b/i;
/** Words that turn a yes into a no ("don't fix it", "not yet"). */
const NEGATED = /\b(?:don'?t|do not|no|not|never|wait|hold (?:on|off)|stop|cancel|nope)\b/i;
/** A plain no, or a put-off with no time: snoozed till tomorrow. */
const NO = /^(?:no|nope|nah|not now|not yet|not today|skip(?: it)?|pass|no thanks|no thank you|leave it|later|maybe later)[.!]*$/i;

/** 9:00 am Mountain tomorrow, where a put-off with no time lands. */
function tomorrow(now: number): number {
  const w = wall(now);
  return atWall(w.y, w.mo, w.d + 1, DEFAULT_HOUR);
}

/**
 * Reads a reply to a floor item. A yes on a Repair or a Decision is Skippy's, approved; a no is put off; a note, a
 * reminder, a time, done or a to-do are the held row's rules; everything else is Skippy's to decide. Null for nothing.
 */
export function readItemReply(raw: string, item: Pick<FloorItem, "kind">, now: number): ItemReply | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return null;
  const core = text.replace(LEAD, "").trim();
  const negated = NEGATED.test(text);
  const yes = BARE_YES.test(text) || BARE_YES.test(core) || (!negated && APPROVE.test(text));
  if (yes && !negated && (item.kind === "repair" || item.kind === "decision")) return { ok: "skippy", approve: true };
  if (NO.test(text) || NO.test(core)) return { ok: true, intent: { kind: "snooze", until: tomorrow(now) } };
  const ruled = readTalkBack(text, now);
  if (ruled) return ruled;
  return { ok: "skippy", approve: false };
}

const clip = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, max);
const quote = (s: string) => `"${clip(s, 300).replace(/"/g, "'")}"`;

/** The item in one line of context: what it is, where from, cause and fix or the suggestion, who reported it. */
export function itemLine(item: FloorItem): string {
  const kind = item.kind === "repair" ? "Repair" : item.kind === "decision" ? "Decision" : "Duty";
  const parts = [`${kind} item from the ${clip(item.room, 40)}: ${clip(item.what, 120)}.`];
  if (item.cause) parts.push(`Cause: ${clip(item.cause, 120)}.`);
  if (item.fix) parts.push(`Fix ready: ${clip(item.fix, 120)}.`);
  if (item.option) parts.push(`Suggested: ${clip(item.option, 80)}.`);
  parts.push(`${item.kind === "repair" ? "Reported" : "Brought"} by ${ownerOf(item.by)}.`);
  return parts.join(" ");
}

/**
 * The ask handed to Skippy, the Magnificent when Nikita approves an item: a build request in plain words, the item's
 * context, then what Nikita said. Its first words make a fair issue title when it is filed for the Builder.
 */
export function floorQuestion(item: FloorItem, said: string): string {
  const head =
    item.kind === "repair"
      ? `Fix the ${clip(item.room, 40)}: ${clip(item.cause || item.what, 100)}`
      : `Go ahead on the ${clip(item.room, 40)} decision: ${clip(item.what, 100)}${item.option ? `, ${clip(item.option, 60)}` : ""}`;
  return `${head} (approved on Today's floor). ${itemLine(item)} Nikita said: ${quote(said)}`.slice(0, FLOOR_ASK_MAX);
}

/** Anything else said to an item: a chat message with the item as its context, for Skippy to decide. */
export function floorMessage(item: FloorItem, said: string): string {
  return `About an item on Today's floor. ${itemLine(item)} Nikita says: ${quote(said)}`.slice(0, FLOOR_ASK_MAX);
}

/** The longest ask (the chat's message cap). */
export const FLOOR_ASK_MAX = 600;

/** The answer kept on the hand-off's turn, said in character (#498): no plumbing words. */
export const FLOOR_REPLY = "Approved on Today's floor. Consulting the deeper me; if it's a fix, the Builder gets it.";

const KINDS: readonly FloorKind[] = ["duty", "decision", "repair"];
const field = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A floor hand-off's body (POST /api/skippy { floor, message }), checked: null when it isn't one. */
export function readFloor(body: unknown): { item: FloorItem; said: string } | null {
  const b = (body && typeof body === "object" ? body : {}) as { floor?: unknown; message?: unknown };
  const f = (b.floor && typeof b.floor === "object" ? b.floor : null) as Record<string, unknown> | null;
  const said = field(b.message, FLOOR_ASK_MAX);
  if (!f || !said) return null;
  const kind = KINDS.find((k) => k === f.kind);
  const room = field(f.room, 40);
  const by = field(f.by, 20);
  const what = field(f.what, 120);
  // Only a Repair or a Decision is approved straight through; anything else goes through the chat.
  if ((kind !== "repair" && kind !== "decision") || !room || !/^[a-z]{2,12}$/.test(by) || !what) return null;
  const cause = field(f.cause, 120);
  const fix = field(f.fix, 120);
  const option = field(f.option, 80);
  return { item: { kind, room, by, what, ...(cause && { cause }), ...(fix && { fix }), ...(option && { option }) }, said };
}

/** Where a floor hand-off stands, from its turn in the `kernel` log. */
export type HandedState = "sent" | "pondering" | "builder" | "answered";

/** An answer that names an issue ("number 812", "#812") or the crew means the Builder has it. */
const BUILDER = /(?:#\s?\d+|\bnumber \d+|\bissue \d+|\bthe (?:builder|crew|foundry)\b)/i;

/** The hand-off's state from its follow-up: none yet, an interim line, or the answer. */
export function handedState(followUp: { text: string; final?: false } | null | undefined): HandedState {
  if (!followUp) return "sent";
  if (BUILDER.test(followUp.text)) return "builder";
  return followUp.final === false ? "pondering" : "answered";
}

/** The floor's words for each state. */
export const HANDED_LINE: Record<HandedState, string> = {
  sent: "Sent to Skippy → Builder",
  pondering: "Handed to Skippy · pondering it",
  builder: "Builder on it",
  answered: "Skippy answered",
};
