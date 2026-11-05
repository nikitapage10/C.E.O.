/**
 * The private half of Relay's texts line (#535, docs/RELAY-PRIVACY.md, "Mac to the site"): the shapes that travel
 * between the Mac hub, the site and the signed-in Desk, each read back by hand against a closed allowlist (no zod, so
 * the Desk can import this file alone). Pure: no node:crypto, no store.
 *
 *   TextItem      one thread Dialtone keeps: who (their name from Nikita's contacts), when, the sort, Dialtone's
 *                 one-line gist and Blasto's draft (both the models' own words, never a message body), or a group's
 *                 summary. The hub pushes the list; the site keeps it sealed, 7 days at most; only a passkey session
 *                 reads it.
 *   TextRequest   what Nikita's tap on the Desk asks of the hub: send this text on this thread, push it to later,
 *                 mark it done, or restyle what he dictated. Single-use, bound to one thread and one draft, 10
 *                 minutes. A send also needs the device's send unlock (a fresh passkey check, good 72 hours on that device).
 *                 "compose" (#536) asks the hub to write a new text: who (as Nikita said it) and the gist; the hub
 *                 finds the contact on the Mac and Blasto writes it. It can't send anything.
 *   TextCard      what the hub makes of a compose (#536): the contact's name, the last 4 digits of the number or a
 *                 masked address, the channel and Blasto's text; or the choices when the name fits several; or why
 *                 not. A send to a card is an ordinary send request, bound to the card and the text on screen.
 *
 * Since #758 (Nikita, 2026-11-05) an owed thread also carries its own newest texts for the Desk (`messages`, sealed, capped,
 * only when every rule passed); the models still see only placeholdered snippets.
 */

import { readVoice, type Voice } from "./voice.js";

export const TEXT_KEEP_MS = 7 * 24 * 60 * 60_000;
/**
 * How far back a text still counts as owed (#758): a one-to-one chat whose last message is someone else's, sent
 * within 30 days. An owed item stays on the list this long; a settled one (a group's summary) TEXT_KEEP_MS.
 */
export const OWED_WINDOW_MS = 30 * 24 * 60 * 60_000;
/**
 * The longest one of the Desk's shown texts (#758) is kept on the site, whatever the item's own window: the owed window
 * (#803). At 7 days, every backlog text older than a week was dropped on the Mac before it was sent, so an owed thread
 * from the 30-day backlog showed only its gist, never the texts themselves.
 */
export const SHOWN_KEEP_MS = OWED_WINDOW_MS;

/** Items with every shown text older than SHOWN_KEEP_MS dropped (an item whose texts all aged out shows its gist). */
export function freshItems(items: readonly TextItem[], now: number): TextItem[] {
  return items.map((i) => {
    if (!i.messages) return i;
    const fresh = i.messages.filter((m) => now - m.at < SHOWN_KEEP_MS);
    const { messages: _old, ...rest } = i;
    return fresh.length ? { ...rest, messages: fresh } : rest;
  });
}
/**
 * How far back an "older unanswered" chat still counts (#803, Nikita 2026-11-05): owed within 30 days, the older fold
 * from 30 to 60 days, and past 60 days nothing at all, neither named nor counted: those were let go on purpose.
 */
export const OLDER_WINDOW_MS = 60 * 24 * 60 * 60_000;

/**
 * The older fold within OLDER_WINDOW_MS (#803). The hub names its newest MAX_OLDER, newest first, so once one named
 * chat is past the window every chat after it is too, and the count is exactly the named ones still inside. A hub
 * from before #803 counted everything; with all its named ones still inside, its count stands (it can't be told).
 */
export function olderWithin(older: { count: number; items: OlderItem[] }, now: number): { count: number; items: OlderItem[] } {
  const items = older.items.filter((i) => now - i.since < OLDER_WINDOW_MS);
  return { count: items.length < older.items.length ? items.length : older.count, items };
}

/** The most "older unanswered" chats the list names (the count can be larger). */
export const MAX_OLDER = 40;
export const MAX_ITEMS = 100;
export const NAME_MAX = 80;
export const GIST_MAX = 160;
export const DRAFT_MAX = 600;
export const SEND_MAX = 2_000;
export const SUMMARY_MAX = 300;
export const DICTATED_MAX = 1_000;

export const TEXT_STATES = ["owed", "later", "settled"] as const;
export type TextState = (typeof TEXT_STATES)[number];

export interface TextItem {
  /** Relay's own random id (16 hex). */
  id: string;
  /** Their name as Nikita's contacts have it, or "Unknown sender". */
  name: string;
  channel: "iMessage" | "SMS";
  group: boolean;
  state: TextState;
  sort: "sooner" | "normal" | null;
  /** The first message Nikita hasn't answered (ms). */
  since: number;
  /**
   * When their latest text came (ms; #895). An owed item stays on the list while this is inside OWED_WINDOW_MS, as the
   * hub counts it: by `since` alone, a thread whose first unanswered text was over 30 days old but whose latest was
   * recent was counted owed on the Mac and dropped here. Left out by an older hub (then `since` decides).
   */
  last?: number;
  laterUntil: number | null;
  /** Dialtone's one line on what they want. */
  gist: string;
  /** Blasto's draft and when it was made (the send binds to `at`). */
  draft: { text: string; at: number } | null;
  /** A group's summary: two sentences at most, and whether Nikita was asked something. */
  summary: { text: string; asked: boolean } | null;
  /** The contact's photo id (#642, ./photos.ts): opaque, the Desk asks for it passkey-only. Left out without one. */
  photo?: string;
  /** Their latest text has no read time in Messages (#758). Never hides an item: a read one is still owed. */
  unread?: true;
  /**
   * Their own texts, for Nikita's eyes on the Desk (#758; Nikita, 2026-11-05: "It should be the full text"): an owed
   * one-to-one thread's newest unanswered texts, a group's since their last reply, with each sender's name and photo
   * id in a group. MAX_SHOWN at most, SHOWN_CHARS in all. Only for a thread every rule passed (never money, legal, a
   * code, a promo or the skip list). Sealed with the list; never public, never logged, never sent to a model.
   */
  messages?: ShownText[];
  /** Why an owed one-to-one thread has no gist yet (#861), from the closed list GIST_WAITS. Left out once it has one. */
  wait?: GistWait;
  /**
   * How many of their unanswered texts are a photo or another attachment with no words (#870): a count only, never
   * the attachment, its name or its kind. Left out at 0.
   */
  media?: number;
}

/**
 * A one-to-one thread Relay set aside (#870): who, when their last text came, and why, from the closed list below.
 * No text, no gist. The Desk lists them under "Relay set these aside"; "Bring back" (a `back` request) puts one of
 * the first three kinds back in line and keeps it there. A rule's kind can't be brought back: its texts never reach
 * a model. The skip list's and groups' are never listed.
 *
 *   no-reply    Dialtone read it as needing no reply
 *   closing     an acknowledgement after Nikita's own closing reply ("sounds good" … "ok")
 *   done        Nikita marked it done on the Desk
 *   money       a money or legal text (the email line's filter), kept from the models
 *   code        a one-time or verification code
 *   short-code  a short-code sender (banks, carriers, alerts)
 *   promo       marketing
 */
export const ASIDE_WHYS = ["no-reply", "closing", "done", "money", "code", "short-code", "promo"] as const;
export type AsideWhy = (typeof ASIDE_WHYS)[number];
/** The kinds "Bring back" may undo; a rule's kinds stay set aside. */
export const BACKABLE: readonly AsideWhy[] = ["no-reply", "closing", "done"];
export const MAX_ASIDE = 50;

export interface AsideItem {
  /** The thread's Relay id (16 hex). */
  id: string;
  name: string;
  channel: "iMessage" | "SMS";
  /** When their last text came (ms). */
  since: number;
  why: AsideWhy;
  photo?: string;
}

/**
 * Why Dialtone hasn't sorted an owed text yet (#861), so the Desk says the real reason instead of "hasn't read this
 * one". A closed list: never the error's own words.
 *
 *   queued    waiting in line (the backlog goes a few threads a round, newest first)
 *   cap       the texts line's monthly model cap is reached; it waits for next month or a higher cap
 *   model     the model call failed (Anthropic or the site's function answered with an error); it tries again
 *   site      the Mac couldn't reach the site; it tries again
 *   messages  the Mac couldn't read the thread from BlueBubbles; it tries again
 *   refused   Dialtone's answer didn't pass the checks; it tries again later
 */
export const GIST_WAITS = ["queued", "cap", "model", "site", "messages", "refused"] as const;
export type GistWait = (typeof GIST_WAITS)[number];

/** Each reason in words for the Desk, after "No gist yet: ". */
export const GIST_WAIT_WORDS: Record<GistWait, string> = {
  queued: "waiting in line for Dialtone.",
  cap: "the texts line's monthly model cap is reached.",
  model: "the model call failed. Relay tries again shortly.",
  site: "the Mac couldn't reach the site. Relay tries again shortly.",
  messages: "the Mac couldn't read this thread from BlueBubbles. Relay tries again shortly.",
  refused: "Dialtone's answer didn't pass the checks. Relay tries again later.",
};

/**
 * What to do when the hub reads no contacts (#861: `contacts: 0` in RelayStatus): macOS hasn't let BlueBubbles read
 * Contacts, so every sender reads "Unknown". The Desk and `relay check` on the Mac say the same words.
 */
export const CONTACTS_HINT =
  "BlueBubbles can't read your contacts, so every sender shows as Unknown. On the Mac, open System Settings > Privacy & Security > Contacts and turn on BlueBubbles, then quit BlueBubbles (BlueBubbles menu > Quit) and open it again. If BlueBubbles isn't in that list, quit and reopen it once so macOS asks. Names show within a few minutes.";

export interface ShownText {
  text: string;
  at: number;
  /** A group member's name as Nikita's contacts have it ("Unknown sender"); left out in a one-to-one thread. */
  from?: string;
  /** That member's photo id (#642), when the site has it. */
  photo?: string;
  /** A photo or another attachment with no words (#870): `text` is exactly MEDIA_TEXT ("Photo"). Nothing of it is sent. */
  media?: true;
  /** Nikita's own line (#870), in a one-to-one thread's recent turns: no `from`. */
  me?: true;
  /**
   * The line's opaque id for a tapback (#888): 8 hex the hub makes from the message on the Mac, never its guid or text.
   * Only on their lines (never `me`); the Mac alone maps it back to the message. Left out by a hub from before #888.
   */
  ref?: string;
}

/* ── Tapbacks (#888) ── */

/**
 * iMessage's six tapbacks, by BlueBubbles' own names for them (`/api/v1/message/react`, MessageInterface.possibleReactions):
 * heart, thumbs up, thumbs down, haha, !! and ?. A tapback is a send like any other (Nikita's tap, signed, single-use,
 * 10 minutes), aimed at one of their shown lines by its `ref`. It never settles the thread.
 */
export const TAPBACKS = ["love", "like", "dislike", "laugh", "emphasize", "question"] as const;
export type Tapback = (typeof TAPBACKS)[number];
/** Each tapback as the Desk draws it, and its name for a screen reader. */
export const TAPBACK_FACE: Record<Tapback, { icon: string; label: string }> = {
  love: { icon: "\u2764\uFE0F", label: "Heart" },
  like: { icon: "\u{1F44D}", label: "Thumbs up" },
  dislike: { icon: "\u{1F44E}", label: "Thumbs down" },
  laugh: { icon: "\u{1F602}", label: "Haha" },
  emphasize: { icon: "\u203C\uFE0F", label: "Exclamation" },
  question: { icon: "\u2753", label: "Question" },
};
/**
 * What to do when the Mac says tapbacks are off (#888): BlueBubbles' Private API (its helper inside Messages) does them.
 * The Desk and `relay check` on the Mac say the same words.
 */
export const TAPBACKS_HINT =
  "Tapbacks need BlueBubbles' Private API. On the Mac, open BlueBubbles > Settings > Private API, turn it on and follow its setup (it asks to turn off System Integrity Protection), then restart BlueBubbles. Texts send either way.";
/** A line's ref: 8 hex. */
export const LINE_REF = /^[0-9a-f]{8}$/;
/** Whether tapbacks can go from the Mac (#888): BlueBubbles' Private API and its helper are on, or not. A state only. */
export type TapbackState = "on" | "off";

/** A tapback request's text: which tapback, on which line ("love:1a2b3c4d"). Never the message's words. */
export const tapbackText = (t: Tapback, ref: string) => `${t}:${ref}`;
/** A tapback request's text read back; null for anything else. */
export function readTapback(text: string): { tapback: Tapback; ref: string } | null {
  const m = /^([a-z]+):([0-9a-f]{8})$/.exec(text);
  return m && (TAPBACKS as readonly string[]).includes(m[1]!) ? { tapback: m[1] as Tapback, ref: m[2]! } : null;
}

export const MAX_SHOWN = 5;
/** What a photo or file with no words reads as on the Desk (#870). */
export const MEDIA_TEXT = "Photo";
export const SHOWN_CHARS = 1_000;

/** The texts on an item (#758), checked: closed shape, MAX_SHOWN at most, SHOWN_CHARS in all. Null for anything off. */
export function readShown(v: unknown): ShownText[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_SHOWN) return null;
  const out: ShownText[] = [];
  let used = 0;
  for (const m of v as Record<string, unknown>[]) {
    if (!m || typeof m !== "object" || Array.isArray(m) || !keysOnly(m, ["text", "at", "from", "photo", "media", "me", "ref"])) return null;
    const text = str(m.text, SHOWN_CHARS);
    if (text === null || !isTime(m.at)) return null;
    if (m.media !== undefined && (m.media !== true || text !== MEDIA_TEXT)) return null;
    if (m.me !== undefined && (m.me !== true || m.from !== undefined || m.photo !== undefined)) return null;
    // A tapback's line id (#888): 8 hex, never on Nikita's own line, once per list.
    if (m.ref !== undefined && (typeof m.ref !== "string" || !LINE_REF.test(m.ref) || m.me !== undefined || out.some((x) => x.ref === m.ref))) return null;
    // A text that is only invisible characters (a zero-width space, a lone joiner) is left out, not the whole list
    // (#803: one such text refused the hub's every push, and the Desk kept an old list without the texts).
    if (!text.trim()) continue;
    used += text.length;
    if (used > SHOWN_CHARS) return null;
    let from: string | null = null;
    if (m.from !== undefined) {
      from = str(m.from, NAME_MAX);
      if (!from?.trim() || from.includes("\n")) return null;
    }
    if (m.photo !== undefined && (typeof m.photo !== "string" || !/^[0-9a-f]{32}$/.test(m.photo))) return null;
    out.push({ text, at: m.at, ...(from !== null && { from }), ...(typeof m.photo === "string" && { photo: m.photo }), ...(m.media === true && { media: true as const }), ...(m.me === true && { me: true as const }), ...(typeof m.ref === "string" && { ref: m.ref }) });
  }
  return out;
}

/**
 * A one-to-one chat whose last message is someone else's but older than OWED_WINDOW_MS (#758): who and since when,
 * nothing else (no gist, no draft, no model call). The Desk folds them into "N older unanswered", with "show them".
 */
export interface OlderItem {
  /** The hub's own random id (16 hex). */
  id: string;
  name: string;
  channel: "iMessage" | "SMS";
  since: number;
  photo?: string;
  unread?: true;
}

export interface TextsView {
  v: 1;
  /** When the hub made the list. */
  at: number;
  items: TextItem[];
  /** The texts Skippy asked Blasto to write (#536), newest first; left out by an older hub. */
  cards?: TextCard[];
  /** Older unanswered chats (#758): how many, and up to MAX_OLDER of them. Left out by an older hub. */
  older?: { count: number; items: OlderItem[] };
  /** When the hub last read every chat (#758: at start and on Rescan); null before it has. */
  scannedAt?: number | null;
  /** How Nikita texts, learned on "Learn from my texts" (#758, ./voice.ts); null before. */
  voice?: Voice | null;
  /** One-to-one threads Relay set aside within the owed window (#870), newest first; left out by an older hub. */
  aside?: AsideItem[];
  /** Whether tapbacks can go from the Mac (#888): BlueBubbles' Private API on or off. Left out until the hub has checked. */
  tapbacks?: TapbackState;
}

/* ── New texts Skippy asks for (#536) ── */

export const WHO_MAX = 80;
export const GIST_IN_MAX = 300;
export const MAX_CARDS = 10;
export const MAX_CHOICES = 6;
/** A card lives this long on the Mac and the site; then it goes, sent or not. */
export const CARD_KEEP_MS = 24 * 60 * 60_000;

/**
 * How a card's recipient is shown: "ending 0123" for a number (its last 4 digits only), or an address masked to its
 * first letters ("r•••@e•••.com"). Nothing else passes, so a whole number or address can't ride on a card.
 */
export const MASK = /^(?:ending \d{4}|[\p{L}\p{N}]•••@[\p{L}\p{N}]•••\.[a-z]{2,10})$/u;

/**
 * "ready": Blasto's text is on it. "choices": the name fits several, pick one. "none": no contact by that name. "off":
 * the rules keep it from the model (money, legal, a code, the skip list). "nochat": the contact's number has no country
 * code and Messages has no chat with it, so Relay won't guess one: Nikita texts them himself. "moved": Nikita texted
 * them since the card was made, so it wasn't sent. "sent": done.
 */
export const CARD_STATES = ["ready", "choices", "none", "off", "nochat", "moved", "sent"] as const;
export type CardState = (typeof CARD_STATES)[number];

export interface CardChoice {
  /** The hub's own random id for this choice (8 hex). */
  pick: string;
  name: string;
  mask: string;
  channel: "iMessage" | "SMS";
}

export interface TextCard {
  /** The card's id (16 hex): the compose request's thread, made by the site. Sends bind to it. */
  id: string;
  state: CardState;
  /** The contact's name as Nikita's contacts have it; for "none", what was asked. */
  name: string;
  mask: string | null;
  channel: "iMessage" | "SMS";
  /** Blasto's text and when it was made: a send binds to `at`. */
  draft: { text: string; at: number } | null;
  choices: CardChoice[];
  at: number;
}

/**
 * "rescan" and "learn" (#758) ask the hub to read every chat again, or to learn Nikita's voice from their sent texts:
 * chores, not about one thread, so they name a fresh random id and carry no text. Neither can send.
 */
export const REQUEST_KINDS = ["send", "later", "done", "restyle", "compose", "rescan", "learn", "back", "react"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** A request's state as the Desk sees it. "expired": never taken (the Mac was offline); Resend makes a new one. */
export const REQUEST_STATES = ["waiting", "taken", "sent", "done", "failed", "refused", "expired"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export interface TextRequest {
  rid: string;
  kind: RequestKind;
  /** The thread (TextItem.id). */
  thread: string;
  /** The draft the request was made from (its `at`), or 0 when there was none. */
  draftAt: number;
  /** The text to send, or what Nikita dictated (restyle), or the gist of a new text (compose); "" otherwise. */
  text: string;
  /** compose only: who, as Nikita said it, or "pick:<8 hex>" for one of a card's choices. */
  who?: string;
  created: number;
  until: number;
  /** The send key's signature over the fields above (api/_relay/tokens.ts). */
  sig: string;
}

const ID = /^[0-9a-f]{16}$/;
export const RID = /^[0-9a-f]{24}$/;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= Date.UTC(2026, 0, 1) && v <= Date.UTC(2100, 0, 1);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : "")) : null);
const keysOnly = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

const ITEM_KEYS = ["id", "name", "channel", "group", "state", "sort", "since", "last", "laterUntil", "gist", "draft", "summary", "photo", "unread", "messages", "wait", "media"] as const;

/** One item, rebuilt from the allowlist; null for anything else (an unknown key, a long string, a bad time). */
export function readTextItem(v: unknown): TextItem | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ITEM_KEYS)) return null;
  const name = str(o.name, NAME_MAX);
  const gist = str(o.gist, GIST_MAX);
  if (typeof o.id !== "string" || !ID.test(o.id) || !name || gist === null || !isTime(o.since)) return null;
  if (o.channel !== "iMessage" && o.channel !== "SMS") return null;
  if (!(TEXT_STATES as readonly string[]).includes(o.state as string)) return null;
  if (o.sort !== null && o.sort !== "sooner" && o.sort !== "normal") return null;
  if (o.laterUntil !== null && !isTime(o.laterUntil)) return null;
  if (o.last !== undefined && !isTime(o.last)) return null;
  let draft: TextItem["draft"] = null;
  if (o.draft !== null) {
    const d = o.draft as Record<string, unknown>;
    const text = d && typeof d === "object" && keysOnly(d, ["text", "at"]) ? str(d.text, DRAFT_MAX) : null;
    if (!text || !isTime(d.at)) return null;
    draft = { text, at: d.at };
  }
  let summary: TextItem["summary"] = null;
  if (o.summary !== null) {
    const g = o.summary as Record<string, unknown>;
    const text = g && typeof g === "object" && keysOnly(g, ["text", "asked"]) ? str(g.text, SUMMARY_MAX) : null;
    if (!text || typeof g.asked !== "boolean") return null;
    summary = { text, asked: g.asked };
  }
  if (o.photo !== undefined && (typeof o.photo !== "string" || !/^[0-9a-f]{32}$/.test(o.photo))) return null;
  if (o.unread !== undefined && o.unread !== true) return null;
  const messages = o.messages === undefined ? null : readShown(o.messages);
  if (o.messages !== undefined && !messages) return null;
  // A one-to-one item's texts are only someone else's, with no sender line; a group's each name their sender.
  // Since #870 a one-to-one item's recent turns include Nikita's own lines (`me`); a group's never do.
  if (messages && messages.some((m) => (o.group === true) !== (m.from !== undefined) || (o.group === true && m.me))) return null;
  if (o.wait !== undefined && !(GIST_WAITS as readonly unknown[]).includes(o.wait)) return null;
  const wait = o.wait as GistWait | undefined;
  if (o.media !== undefined && (!Number.isInteger(o.media) || (o.media as number) < 1 || (o.media as number) > 999)) return null;
  return { id: o.id, name, channel: o.channel, group: o.group === true, state: o.state as TextState, sort: o.sort as TextItem["sort"], since: o.since, laterUntil: o.laterUntil as number | null, ...(typeof o.last === "number" && { last: o.last }), gist, draft, summary, ...(typeof o.photo === "string" && { photo: o.photo }), ...(o.unread === true && { unread: true as const }), ...(messages?.length && { messages }), ...(wait && !gist && { wait }), ...(typeof o.media === "number" && { media: o.media }) };
}

/** One set-aside thread (#870), rebuilt from the allowlist; null for anything else. */
export function readAsideItem(v: unknown): AsideItem | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["id", "name", "channel", "since", "why", "photo"])) return null;
  const name = str(o.name, NAME_MAX);
  if (typeof o.id !== "string" || !ID.test(o.id) || !name?.trim() || name.includes("\n") || !isTime(o.since) || (o.channel !== "iMessage" && o.channel !== "SMS")) return null;
  if (!(ASIDE_WHYS as readonly unknown[]).includes(o.why)) return null;
  if (o.photo !== undefined && (typeof o.photo !== "string" || !/^[0-9a-f]{32}$/.test(o.photo))) return null;
  return { id: o.id, name, channel: o.channel, since: o.since, why: o.why as AsideWhy, ...(typeof o.photo === "string" && { photo: o.photo }) };
}

/** One older unanswered chat (#758), rebuilt from the allowlist; null for anything else. */
export function readOlderItem(v: unknown): OlderItem | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["id", "name", "channel", "since", "photo", "unread"])) return null;
  const name = str(o.name, NAME_MAX);
  if (typeof o.id !== "string" || !ID.test(o.id) || !name?.trim() || name.includes("\n") || !isTime(o.since) || (o.channel !== "iMessage" && o.channel !== "SMS")) return null;
  if (o.photo !== undefined && (typeof o.photo !== "string" || !/^[0-9a-f]{32}$/.test(o.photo))) return null;
  if (o.unread !== undefined && o.unread !== true) return null;
  return { id: o.id, name, channel: o.channel, since: o.since, ...(typeof o.photo === "string" && { photo: o.photo }), ...(o.unread === true && { unread: true as const }) };
}

/** The older-unanswered block (#758), checked; null for anything off the shape. */
export function readOlder(v: unknown): { count: number; items: OlderItem[] } | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["count", "items"]) || !Number.isInteger(o.count) || (o.count as number) < 0 || (o.count as number) > 9_999) return null;
  if (!Array.isArray(o.items) || o.items.length > MAX_OLDER || o.items.length > (o.count as number)) return null;
  const items = o.items.map(readOlderItem);
  return items.some((i) => i === null) ? null : { count: o.count as number, items: items as OlderItem[] };
}

const channelOk = (v: unknown): v is "iMessage" | "SMS" => v === "iMessage" || v === "SMS";
const maskOk = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && MASK.test(v);

function readChoice(v: unknown): CardChoice | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["pick", "name", "mask", "channel"])) return null;
  const name = str(o.name, NAME_MAX);
  if (typeof o.pick !== "string" || !/^[0-9a-f]{8}$/.test(o.pick) || !name?.trim() || name.includes("\n") || !maskOk(o.mask) || !channelOk(o.channel)) return null;
  return { pick: o.pick, name, mask: o.mask, channel: o.channel };
}

const CARD_KEYS = ["id", "state", "name", "mask", "channel", "draft", "choices", "at"] as const;

/** One card, rebuilt from the allowlist; null for anything else. A card never holds a whole number or address. */
export function readTextCard(v: unknown): TextCard | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, CARD_KEYS)) return null;
  const name = str(o.name, NAME_MAX);
  if (typeof o.id !== "string" || !ID.test(o.id) || !(CARD_STATES as readonly string[]).includes(o.state as string) || !name || name.includes("\n") || !isTime(o.at) || !channelOk(o.channel)) return null;
  if (o.mask !== null && !maskOk(o.mask)) return null;
  let draft: TextCard["draft"] = null;
  if (o.draft !== null) {
    const d = o.draft as Record<string, unknown>;
    const text = d && typeof d === "object" && keysOnly(d, ["text", "at"]) ? str(d.text, DRAFT_MAX) : null;
    if (!text?.trim() || !isTime(d.at)) return null;
    draft = { text, at: d.at };
  }
  if (!Array.isArray(o.choices) || o.choices.length > MAX_CHOICES) return null;
  const choices = o.choices.map(readChoice);
  if (choices.some((c) => c === null)) return null;
  const state = o.state as CardState;
  // Each state carries what it needs and nothing more: a ready card its recipient and text; choices only on "choices".
  if (state === "ready" && (!draft || o.mask === null)) return null;
  if (state !== "ready" && state !== "sent" && draft) return null;
  if ((state === "choices") !== choices.length > 0) return null;
  return { id: o.id, state, name, mask: o.mask as string | null, channel: o.channel, draft, choices: choices as CardChoice[], at: o.at };
}

/**
 * Whether an item is still on the list (#758): an owed one while their latest text is inside OWED_WINDOW_MS (#895: by
 * `last`, as the hub lists and counts it; an older hub's item by `since`), a settled one (a group's summary) a week.
 */
export function itemLive(i: Pick<TextItem, "state" | "since" | "last">, now: number): boolean {
  return i.state === "settled" ? now - i.since < TEXT_KEEP_MS : now - Math.max(i.since, i.last ?? 0) < OWED_WINDOW_MS;
}

/** The list, checked whole: one bad item refuses it (a hub that sends something extra has a bug). */
export function readTextsView(v: unknown, now: number): TextsView | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["v", "at", "items", "cards", "older", "scannedAt", "voice", "aside", "tapbacks"]) || o.v !== 1 || !isTime(o.at) || !Array.isArray(o.items) || o.items.length > MAX_ITEMS) return null;
  const items = o.items.map(readTextItem);
  if (items.some((i) => i === null)) return null;
  let cards: TextCard[] = [];
  if (o.cards !== undefined) {
    if (!Array.isArray(o.cards) || o.cards.length > MAX_CARDS) return null;
    const read = o.cards.map(readTextCard);
    if (read.some((c) => c === null)) return null;
    cards = (read as TextCard[]).filter((c) => now - c.at < CARD_KEEP_MS);
  }
  const read = o.older === undefined ? { count: 0, items: [] } : readOlder(o.older);
  if (!read) return null;
  const older = olderWithin(read, now);
  if (o.scannedAt !== undefined && o.scannedAt !== null && !isTime(o.scannedAt)) return null;
  const voice = o.voice === undefined || o.voice === null ? null : readVoice(o.voice);
  if (o.voice !== undefined && o.voice !== null && !voice) return null;
  let aside: AsideItem[] = [];
  if (o.aside !== undefined) {
    if (!Array.isArray(o.aside) || o.aside.length > MAX_ASIDE) return null;
    const got = o.aside.map(readAsideItem);
    if (got.some((a) => a === null)) return null;
    aside = (got as AsideItem[]).filter((a) => now - a.since < OWED_WINDOW_MS);
  }
  if (o.tapbacks !== undefined && o.tapbacks !== "on" && o.tapbacks !== "off") return null;
  const kept = freshItems((items as TextItem[]).filter((i) => itemLive(i, now)), now);
  return { v: 1, at: o.at, items: kept, cards, older, scannedAt: typeof o.scannedAt === "number" ? o.scannedAt : null, voice, aside, ...((o.tapbacks === "on" || o.tapbacks === "off") && { tapbacks: o.tapbacks }) };
}

const REQ_KEYS = ["rid", "kind", "thread", "draftAt", "text", "who", "created", "until", "sig"] as const;

/** A request as stored or as the hub receives it; null for anything off the shape. The signature is checked apart. */
export function readTextRequest(v: unknown): TextRequest | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, REQ_KEYS)) return null;
  if (typeof o.rid !== "string" || !RID.test(o.rid) || !(REQUEST_KINDS as readonly string[]).includes(o.kind as string)) return null;
  if (typeof o.thread !== "string" || !ID.test(o.thread) || !isTime(o.created) || !isTime(o.until) || typeof o.sig !== "string" || o.sig.length > 64) return null;
  if (o.draftAt !== 0 && !isTime(o.draftAt)) return null;
  const text = str(o.text, o.kind === "restyle" ? DICTATED_MAX : o.kind === "compose" ? GIST_IN_MAX : SEND_MAX);
  if (text === null || ((o.kind === "send" || o.kind === "restyle" || o.kind === "compose") && !text.trim())) return null;
  if ((o.kind === "later" || o.kind === "done" || o.kind === "rescan" || o.kind === "learn" || o.kind === "back") && text !== "") return null;
  if (o.kind === "back" && o.draftAt !== 0) return null;
  // A tapback (#888): which one and on which line, nothing else; bound to no draft.
  if (o.kind === "react" && (o.draftAt !== 0 || !readTapback(text))) return null;
  if ((o.kind === "rescan" || o.kind === "learn") && o.draftAt !== 0) return null;
  // Only a compose names who, and it must.
  if (o.kind === "compose") {
    const who = str(o.who, WHO_MAX);
    if (!who?.trim() || who.includes("\n") || o.draftAt !== 0) return null;
    return { rid: o.rid, kind: "compose", thread: o.thread, draftAt: 0, text, who, created: o.created, until: o.until, sig: o.sig };
  }
  if (o.who !== undefined) return null;
  return { rid: o.rid, kind: o.kind as RequestKind, thread: o.thread, draftAt: o.draftAt as number, text, created: o.created, until: o.until, sig: o.sig };
}

/** What a hub reports back about a request it took. */
export const RESULTS = ["sent", "done", "failed", "refused"] as const;
export type RequestResult = (typeof RESULTS)[number];

/**
 * Why the hub refused or failed a request (#767): a short code from this closed list, never a message, a name or a
 * number. The hub reports it with the result, the site keeps it on the sealed request, and the passkey Desk shows its
 * words ("Not sent: …") with Resend where another try can help. The public status never carries one.
 *
 *   signature      the send key didn't check out (the Mac was paired again since)
 *   expired        past its 10 minutes when the Mac read it, or the Mac's clock is off
 *   replay         the Mac had already seen that request
 *   paused         the hub is paused
 *   gone           the thread or card isn't on the Mac's list any more
 *   not-owed       the thread isn't waiting on a reply any more, or it's a group
 *   new-message    they texted again after the draft on screen
 *   changed        the card's text changed since it was shown
 *   answered       Messages already shows a reply from Nikita
 *   messages-down  the Mac couldn't read the chat from BlueBubbles, so it didn't risk a double send
 *   bad-text       the text was empty or too long
 *   bb-timeout     BlueBubbles didn't answer in time: it may have sent, or macOS is waiting on the Mac for a permission click
 *   bb-down        BlueBubbles wasn't reachable on the Mac
 *   bb-auth        BlueBubbles refused the hub's password
 *   mac-permission macOS didn't let BlueBubbles control Messages (its AppleScript send needs Automation access)
 *   bb-refused     BlueBubbles answered with an error
 *   model          Blasto couldn't write it (models down or out of budget)
 *   unreadable     the hub couldn't read the request (a hub older than the site)
 *   hub-error      the hub hit an error while acting on it
 *   no-answer      the Mac took it but never reported back (site side, 5 minutes after it ended)
 *   tapbacks-off   a tapback (#888), and BlueBubbles' Private API (or its helper) is off on the Mac
 *   no-line        a tapback's line isn't among the Mac's shown lines any more (the list moved on, or the hub restarted)
 */
export const REASONS = ["signature", "expired", "replay", "paused", "gone", "not-owed", "new-message", "changed", "answered", "messages-down", "bad-text", "bb-timeout", "bb-down", "bb-auth", "mac-permission", "bb-refused", "model", "unreadable", "hub-error", "no-answer", "tapbacks-off", "no-line"] as const;
export type Reason = (typeof REASONS)[number];

export const readReason = (v: unknown): Reason | undefined => ((REASONS as readonly string[]).includes(v as string) ? (v as Reason) : undefined);

/** A reason in the Desk's words, after "Not sent: ". */
export const REASON_WORDS: Record<Reason, string> = {
  signature: "the Mac couldn't check this request's key. Pair the Mac again",
  expired: "it reached the Mac too late (or the Mac's clock is off)",
  replay: "the Mac had already handled this request",
  paused: "Relay is paused on the Mac",
  gone: "that conversation isn't on the Mac's list any more",
  "not-owed": "that conversation isn't waiting on a reply any more",
  "new-message": "they texted again after this draft. Read the new message, then send again",
  changed: "the text changed since it was shown",
  answered: "Messages already shows your reply",
  "messages-down": "the Mac couldn't read the chat from BlueBubbles, so it didn't risk sending twice",
  "bad-text": "the text was empty or too long",
  "bb-timeout": "BlueBubbles didn't confirm it in time. It may have sent: check Messages before you resend. If the Mac is asking to let BlueBubbles control Messages, click Allow there",
  "bb-down": "BlueBubbles isn't running on the Mac",
  "bb-auth": "BlueBubbles refused the hub's password",
  "mac-permission": "the Mac needs permission for Messages. Allow BlueBubbles to control Messages: System Settings > Privacy & Security > Automation",
  "bb-refused": "BlueBubbles couldn't send it",
  model: "Blasto couldn't write it just now",
  unreadable: "the hub on the Mac is out of date. Run the installer again",
  "hub-error": "the hub hit an error. It may have sent: check Messages before you resend",
  "no-answer": "the Mac took it but never answered. It may have sent: check Messages before you resend",
  "tapbacks-off": "tapbacks need BlueBubbles' Private API. Turn it on in BlueBubbles' settings on the Mac",
  "no-line": "that message isn't on the Mac's list any more. Wait for the list to refresh, then try again",
};

/** The reasons another try can fix; the rest need a look first (a new message, a reply already sent). */
export const RESENDABLE: readonly Reason[] = ["expired", "paused", "messages-down", "bb-timeout", "bb-down", "bb-auth", "mac-permission", "bb-refused", "hub-error", "no-answer"];
