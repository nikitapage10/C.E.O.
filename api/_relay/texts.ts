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
 * No raw message ever crosses here: the hub sends only who, when, its states and the models' outputs.
 */

export const TEXT_KEEP_MS = 7 * 24 * 60 * 60_000;
export const MAX_ITEMS = 60;
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
  laterUntil: number | null;
  /** Dialtone's one line on what they want. */
  gist: string;
  /** Blasto's draft and when it was made (the send binds to `at`). */
  draft: { text: string; at: number } | null;
  /** A group's summary: two sentences at most, and whether Nikita was asked something. */
  summary: { text: string; asked: boolean } | null;
}

export interface TextsView {
  v: 1;
  /** When the hub made the list. */
  at: number;
  items: TextItem[];
  /** The texts Skippy asked Blasto to write (#536), newest first; left out by an older hub. */
  cards?: TextCard[];
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

/** "ready": Blasto's text is on it. "choices": the name fits several, pick one. "none": no contact by that name. "off": the rules keep it from the model (money, legal, a code, the skip list). "sent": done. */
export const CARD_STATES = ["ready", "choices", "none", "off", "sent"] as const;
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

export const REQUEST_KINDS = ["send", "later", "done", "restyle", "compose"] as const;
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

const ITEM_KEYS = ["id", "name", "channel", "group", "state", "sort", "since", "laterUntil", "gist", "draft", "summary"] as const;

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
  return { id: o.id, name, channel: o.channel, group: o.group === true, state: o.state as TextState, sort: o.sort as TextItem["sort"], since: o.since, laterUntil: o.laterUntil as number | null, gist, draft, summary };
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

/** The list, checked whole: one bad item refuses it (a hub that sends something extra has a bug). */
export function readTextsView(v: unknown, now: number): TextsView | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["v", "at", "items", "cards"]) || o.v !== 1 || !isTime(o.at) || !Array.isArray(o.items) || o.items.length > MAX_ITEMS) return null;
  const items = o.items.map(readTextItem);
  if (items.some((i) => i === null)) return null;
  let cards: TextCard[] = [];
  if (o.cards !== undefined) {
    if (!Array.isArray(o.cards) || o.cards.length > MAX_CARDS) return null;
    const read = o.cards.map(readTextCard);
    if (read.some((c) => c === null)) return null;
    cards = (read as TextCard[]).filter((c) => now - c.at < CARD_KEEP_MS);
  }
  return { v: 1, at: o.at, items: (items as TextItem[]).filter((i) => now - i.since < TEXT_KEEP_MS), cards };
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
  if ((o.kind === "later" || o.kind === "done") && text !== "") return null;
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
