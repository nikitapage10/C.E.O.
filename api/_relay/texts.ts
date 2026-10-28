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
}

export const REQUEST_KINDS = ["send", "later", "done", "restyle"] as const;
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
  /** The text to send, or what Nikita dictated (restyle); "" otherwise. */
  text: string;
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

/** The list, checked whole: one bad item refuses it (a hub that sends something extra has a bug). */
export function readTextsView(v: unknown, now: number): TextsView | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, ["v", "at", "items"]) || o.v !== 1 || !isTime(o.at) || !Array.isArray(o.items) || o.items.length > MAX_ITEMS) return null;
  const items = o.items.map(readTextItem);
  if (items.some((i) => i === null)) return null;
  return { v: 1, at: o.at, items: (items as TextItem[]).filter((i) => now - i.since < TEXT_KEEP_MS) };
}

const REQ_KEYS = ["rid", "kind", "thread", "draftAt", "text", "created", "until", "sig"] as const;

/** A request as stored or as the hub receives it; null for anything off the shape. The signature is checked apart. */
export function readTextRequest(v: unknown): TextRequest | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || !keysOnly(o, REQ_KEYS)) return null;
  if (typeof o.rid !== "string" || !RID.test(o.rid) || !(REQUEST_KINDS as readonly string[]).includes(o.kind as string)) return null;
  if (typeof o.thread !== "string" || !ID.test(o.thread) || !isTime(o.created) || !isTime(o.until) || typeof o.sig !== "string" || o.sig.length > 64) return null;
  if (o.draftAt !== 0 && !isTime(o.draftAt)) return null;
  const text = str(o.text, o.kind === "restyle" ? DICTATED_MAX : SEND_MAX);
  if (text === null || (o.kind === "send" && !text.trim()) || (o.kind === "restyle" && !text.trim())) return null;
  if ((o.kind === "later" || o.kind === "done") && text !== "") return null;
  return { rid: o.rid, kind: o.kind as RequestKind, thread: o.thread, draftAt: o.draftAt as number, text, created: o.created, until: o.until, sig: o.sig };
}

/** What a hub reports back about a request it took. */
export const RESULTS = ["sent", "done", "failed", "refused"] as const;
export type RequestResult = (typeof RESULTS)[number];
