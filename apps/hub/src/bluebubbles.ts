import type { Reason, Tapback } from "../../../api/_relay/texts.ts";
import { BLUEBUBBLES } from "./config.ts";
import { errorClass } from "./log.ts";

/**
 * BlueBubbles Server's local API (http://127.0.0.1:1234, its own password), the hub's only way to Messages: the
 * hub never opens chat.db itself, so it needs no Full Disk Access. Every call goes to 127.0.0.1 with a timeout. Read: new
 * messages (polled every few seconds from `/api/v1/message/query`, #749: BlueBubbles 1.9.12 refuses API webhooks to
 * 127.0.0.1, and a poll needs no inbound path at all), contacts (names for placeholders and the
 * Desk), a chat's recent messages (fetched for one call and dropped), the one-to-one chats' ids (to find the chat a
 * new text goes in, #536; read for one ask and dropped). Write: one text, or one tapback (#888, `/api/v1/message/react`,
 * which needs BlueBubbles' Private API), only when Nikita's signed request says so (./engine.ts, `act`). Attachments
 * are never asked for.
 */

export interface Message {
  /** A message's text, "" for one with none (an attachment, a reaction). Memory only. */
  text: string;
  fromMe: boolean;
  at: number;
  /** The sender's handle (a number or address); "" for Nikita's own. */
  handle: string;
  /** Messages has a read time for it (BlueBubbles' `dateRead`, from chat.db; #758). Only meaningful for someone else's. */
  read?: boolean;
  /**
   * It carries a photo or another attachment (#870): Messages puts U+FFFC where one sits, and BlueBubbles marks it.
   * Only the mark: the attachment is never asked for, and `text` keeps only the words (U+FFFC taken out).
   */
  media?: true;
  /**
   * The message's guid in Messages (#888), for a tapback on it. Memory only: it never leaves the Mac, is never logged
   * or stored; the Desk gets an opaque ref made from it instead.
   */
  guid?: string;
}

/**
 * One chat from BlueBubbles' chat query (#758), for the backlog scan: its guid, whether it is a group, the one-to-one
 * chat's other handle (from its participants: the chat query's last message carries no handle), and its last message.
 * Memory only, for one scan.
 */
export interface ChatInfo {
  chat: string;
  group: boolean;
  /** A group's name, or "". */
  name: string;
  /** A one-to-one chat's other person (a number or address); "" for a group. */
  handle: string;
  /** The last message, read like any other; null for a reaction, a system item or a chat with none. */
  last: Message | null;
  /** When the last item of any kind came (ms); 0 for none. */
  lastAt: number;
}

export interface Contact {
  names: string[];
  handles: string[];
}

/** A contact's picture as BlueBubbles has it (#642): its handles and the image bytes, for one photo sync, then dropped. */
export interface ContactPhoto {
  handles: string[];
  image: Uint8Array;
}

export interface Inbound {
  chat: string;
  group: boolean;
  /** The group's name as Messages shows it, or "" (memory only, for the Desk's list). */
  groupName: string;
  message: Message;
}

export interface BlueBubbles {
  ping(): Promise<boolean>;
  contacts(): Promise<Contact[]>;
  /** The chat's latest messages, newest first. */
  messages(chat: string, limit: number): Promise<Message[]>;
  /** Sends one text: true when BlueBubbles took it; otherwise it throws a BlueBubblesError (sendReason says why). */
  send(chat: string, text: string, tempGuid: string): Promise<boolean>;
  /** The guids of Messages' one-to-one chats (iMessage;-;… and SMS;-;…), for finding the chat a new text goes in (#536). */
  chats(): Promise<string[]>;
  /** The contacts that have a picture (#642), with it: read for one photo sync and dropped. */
  contactPhotos(): Promise<ContactPhoto[]>;
  /**
   * One tapback (#888) on one message: true when BlueBubbles took it; otherwise a BlueBubblesError. BlueBubbles' route
   * needs its Private API (and the helper in Messages) on.
   */
  react(chat: string, messageGuid: string, tapback: Tapback): Promise<boolean>;
  /** Whether BlueBubbles' Private API is on with its helper connected (`/api/v1/server/info`); null when it can't tell. */
  privateApi(): Promise<boolean | null>;
  /** Messages dated at or after `after` (ms), oldest first, `limit` at most (#749): the hub's way in. */
  since(after: number, limit: number): Promise<Polled[]>;
  /** Every chat with its last message (#758), page by page: `/api/v1/chat/query` with `with: ["lastmessage"]`. */
  chatList(offset: number, limit: number): Promise<ChatInfo[]>;
}

/** One message from a poll: its guid and time move the cursor; `inbound` is null for a reaction or a system item. */
export interface Polled {
  guid: string;
  at: number;
  inbound: Inbound | null;
}

/** The most of one contact picture the hub reads (bytes): bigger ones are skipped. */
export const AVATAR_MAX = 4 * 1024 * 1024;

/** The first bytes of a picture `sips` can read: JPEG, PNG, GIF, TIFF, HEIC/HEIF (an ISO box), WebP, BMP. */
const looksLikeImage = (b: Uint8Array) =>
  (b[0] === 0xff && b[1] === 0xd8) ||
  (b[0] === 0x89 && b[1] === 0x50) ||
  (b[0] === 0x47 && b[1] === 0x49) ||
  (b[0] === 0x49 && b[1] === 0x49) ||
  (b[0] === 0x4d && b[1] === 0x4d) ||
  (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) ||
  (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) ||
  (b[0] === 0x42 && b[1] === 0x4d);

/**
 * A contact's avatar from BlueBubbles' contact data, null when there isn't a usable one (#870: no photo ever showed).
 * BlueBubbles has sent it in more than one shape over its versions: base64, a data: URL, a Node Buffer as JSON
 * (`{ type: "Buffer", data: [...] }`), a bare byte array, or a Uint8Array's `toString()` (bytes joined by commas).
 * Each is read, and only bytes that start like a picture are kept.
 */
export function readAvatar(v: unknown): Uint8Array | null {
  let bytes: Uint8Array | null = null;
  const fromList = (a: unknown[]) => (a.length <= AVATAR_MAX && a.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255) ? new Uint8Array(a as number[]) : null);
  if (Array.isArray(v)) bytes = fromList(v);
  else if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) bytes = fromList((v as { data: unknown[] }).data);
  else if (typeof v === "string" && v && v.length <= AVATAR_MAX * 4 + 64) {
    if (/^\d{1,3}(?:,\d{1,3}){63,}$/.test(v)) bytes = fromList(v.split(",").map(Number));
    else {
      const b64 = v.startsWith("data:") ? v.slice(v.indexOf(",") + 1) : v;
      if (/^[A-Za-z0-9+/=\s]+$/.test(b64)) bytes = new Uint8Array(Buffer.from(b64, "base64"));
    }
  }
  return bytes && bytes.length >= 64 && bytes.length <= AVATAR_MAX && looksLikeImage(bytes) ? bytes : null;
}

/** A contact's picture from whichever field BlueBubbles filled (#870): `avatar`, else the full image, else the thumbnail. */
export const avatarOf = (c: Record<string, unknown>): Uint8Array | null => readAvatar(c.avatar) ?? readAvatar(c.contactImage) ?? readAvatar(c.contactThumbnailImage) ?? readAvatar(c.contactImageThumbnail);

export { CONTACTS_HINT, TAPBACKS_HINT } from "../../../api/_relay/texts.ts";

/**
 * A contact's handles from BlueBubbles' contact data (#861): each phone number and email as `{ address }` (BlueBubbles
 * 1.9's shape) or as a bare string, so a shape change can't leave every contact with no handle and every sender
 * "Unknown".
 */
export function contactHandles(c: Record<string, unknown>): string[] {
  const all: unknown[] = [...(Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []), ...(Array.isArray(c.emails) ? c.emails : [])];
  return all.map((h) => (typeof h === "string" ? h.slice(0, 200) : str((h as Record<string, unknown> | null)?.address, 200)).trim()).filter(Boolean);
}

/**
 * One contact from BlueBubbles' contact data (#861): the name to show first (its display name, else first and last
 * together, else the nickname), then each part for the placeholders. Memory only.
 */
export function readContact(c: Record<string, unknown>): Contact {
  const first = str(c.firstName, 40).trim();
  const last = str(c.lastName, 40).trim();
  const whole = [first, last].filter(Boolean).join(" ");
  const names = [str(c.displayName, 80).trim(), whole, first, last, str(c.nickname, 40).trim()].filter((x, i, all) => x.length > 1 && all.indexOf(x) === i);
  return { names, handles: contactHandles(c) };
}

/** Whether a chat id is a group's (iMessage;+;chat…) rather than one person's (iMessage;-;+1…). */
export const isGroupChat = (chat: string) => /;\+;/.test(chat);
export const channelOf = (chat: string): "iMessage" | "SMS" => (/^SMS;/i.test(chat) ? "SMS" : "iMessage");

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, max = 10_000) => (typeof v === "string" ? v.slice(0, max) : "");

/** Where Messages puts an attachment inside a message's text. */
const ATTACHMENT_MARK = /\uFFFC/g;

export function readMessage(o: Record<string, unknown> | null | undefined): Message | null {
  if (!o || typeof o !== "object") return null;
  // Reactions, edits and system items carry an associated guid or a non-zero item type: not a message to answer.
  if (o.associatedMessageGuid || (typeof o.itemType === "number" && o.itemType !== 0)) return null;
  const handle = o.handle && typeof o.handle === "object" ? str((o.handle as Record<string, unknown>).address, 200) : "";
  const raw = str(o.text);
  // A photo or a file (#870): the mark in the text, or BlueBubbles' own flags. Never the attachment itself.
  const media = ATTACHMENT_MARK.test(raw) || o.hasAttachments === true || (Array.isArray(o.attachments) && o.attachments.length > 0) || (typeof o.balloonBundleId === "string" && o.balloonBundleId !== "");
  ATTACHMENT_MARK.lastIndex = 0;
  const text = raw.replace(ATTACHMENT_MARK, "");
  const guid = str(o.guid, 200);
  return { text: text.trim() ? text : "", fromMe: o.isFromMe === true, at: num(o.dateCreated), handle: o.isFromMe === true ? "" : handle, read: num(o.dateRead) > 0, ...(media && { media: true as const }), ...(guid && { guid }) };
}

/** A message with no words: a photo, a file, a sticker (#870). It counts as a text that came; nothing of it is read. */
export const mediaOnly = (m: Message) => !m.text.trim();

/**
 * One chat from `/api/v1/chat/query` (#758), read: null without a guid. BlueBubbles 1.9.12 (ChatInterface.get) fills
 * `lastMessage` from a join that loads no handle, so a one-to-one chat's other person comes from `participants`.
 */
export function readChat(o: Record<string, unknown> | null | undefined): ChatInfo | null {
  if (!o || typeof o !== "object") return null;
  const chat = str(o.guid, 300);
  if (!chat) return null;
  const group = isGroupChat(chat) || o.style === 43;
  const parts = Array.isArray(o.participants) ? (o.participants as Record<string, unknown>[]) : [];
  const handle = group ? "" : str(parts[0]?.address, 200) || chat.split(";").pop() || "";
  const lm = o.lastMessage && typeof o.lastMessage === "object" ? (o.lastMessage as Record<string, unknown>) : null;
  const read = readMessage(lm);
  const last = read ? { ...read, handle: read.fromMe ? "" : read.handle || handle } : null;
  return { chat, group, name: group ? str(o.displayName, 80) : "", handle, last, lastAt: num(lm?.dateCreated) };
}

/** One message from `/api/v1/message/query` (with its chats), read: null when it has no guid or time. */
export function readPolled(o: Record<string, unknown> | null | undefined): Polled | null {
  if (!o || typeof o !== "object") return null;
  const guid = str(o.guid, 200);
  const at = num(o.dateCreated);
  if (!guid || !at) return null;
  const chat = Array.isArray(o.chats) ? (o.chats[0] as Record<string, unknown> | undefined) : undefined;
  const chatGuid = str(chat?.guid, 300);
  const message = readMessage(o);
  return { guid, at, inbound: chatGuid && message ? { chat: chatGuid, group: isGroupChat(chatGuid), groupName: str(chat?.displayName, 80), message } : null };
}

/* ── Calls, and failing in plain words (#749) ── */

/** How a BlueBubbles call failed. The error's name stays on log.ts's closed list. */
export type BlueBubblesFailure = "timeout" | "unreachable" | "http" | "not-json";

export class BlueBubblesError extends Error {
  readonly kind: BlueBubblesFailure;
  readonly status: number;
  /** BlueBubbles' own error words, redacted and cut short ("" when it gave none). */
  readonly detail: string;
  constructor(kind: BlueBubblesFailure, status = 0, detail = "") {
    super(`bluebubbles ${kind}`);
    this.name = kind === "timeout" ? "TimeoutError" : kind === "unreachable" ? "FetchError" : "HttpError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** Text with every secret taken out: each value given (raw and URL-encoded) and any password, guid, token or k param. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const v of secrets) {
    if (!v) continue;
    for (const form of new Set([v, encodeURIComponent(v), new URLSearchParams({ v }).toString().slice(2)])) out = out.split(form).join("•••");
  }
  return out.replace(/([?&](?:password|guid|token|k)=)[^&\s"']*/gi, "$1•••");
}

/** BlueBubbles' error words from its JSON body ({ error: { message } } or { message }), redacted, 200 characters at most. */
function errorWords(parsed: unknown, secrets: readonly string[]): string {
  const b = parsed as { message?: unknown; error?: unknown } | null;
  const e = b && typeof b === "object" && b.error && typeof b.error === "object" ? (b.error as { message?: unknown }).message : undefined;
  const words = typeof e === "string" && e ? e : b && typeof b === "object" && typeof b.message === "string" ? b.message : "";
  return redact(words, secrets).replace(/\s+/g, " ").trim().slice(0, 200);
}

const isTimeout = (e: unknown) => {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  return name === "TimeoutError" || name === "AbortError";
};

/** One call: a timeout always; a throw from fetch becomes a timeout or an unreachable, never its message (the URL holds the password). */
async function call(fetcher: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    throw new BlueBubblesError(isTimeout(e) ? "timeout" : "unreachable");
  }
}

/** The JSON body of an answer, or a BlueBubblesError: the HTTP status with BlueBubbles' words, or not JSON. */
async function body(res: Response, secrets: readonly string[]): Promise<{ data?: unknown }> {
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw new BlueBubblesError(isTimeout(e) ? "timeout" : "unreachable", res.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!res.ok) throw new BlueBubblesError("http", res.status, errorWords(parsed, secrets));
  if (!parsed || typeof parsed !== "object") throw new BlueBubblesError("not-json", res.status);
  return parsed as { data?: unknown };
}

export const BB_TIMEOUT_MS = 15_000;
export const BB_SEND_TIMEOUT_MS = 30_000;
/** The contact pictures' one call (#870): every picture at once. */
export const PHOTOS_TIMEOUT_MS = 180_000;

/** Words in BlueBubbles' error that mean macOS kept it from controlling Messages (TCC Automation, error -1743). */
const AUTOMATION = /-1743|not authori[sz]ed to send apple events|not allowed to send apple ?events|automation/i;

/**
 * Why a send through BlueBubbles didn't go, as a reason code for the Desk (#767). A timeout may still have sent; the
 * rest did not. Never BlueBubbles' own words: only which kind of failure.
 */
export function sendReason(e: unknown): Reason {
  if (!(e instanceof BlueBubblesError)) return "bb-refused";
  if (e.kind === "timeout") return "bb-timeout";
  if (e.kind === "unreachable") return "bb-down";
  if (e.kind === "http" && e.status === 401) return "bb-auth";
  if (e.kind === "http" && AUTOMATION.test(e.detail)) return "mac-permission";
  return "bb-refused";
}

/** A failed BlueBubbles call in plain words for the Terminal, the password never in it; "" for any other error. */
export function describeFailure(e: unknown): string {
  if (!(e instanceof BlueBubblesError)) return "";
  if (e.kind === "timeout") return `BlueBubbles didn't answer within ${BB_TIMEOUT_MS / 1000} seconds. Is it running, and not stuck on a dialog?`;
  if (e.kind === "unreachable") return "couldn't reach BlueBubbles on 127.0.0.1:1234. Is BlueBubbles open, with its server running?";
  if (e.kind === "not-json") return `BlueBubbles answered HTTP ${e.status} with something that isn't the JSON it should be. Is port 1234 BlueBubbles' own server?`;
  if (e.status === 401) return `BlueBubbles answered HTTP 401: the password in the Keychain doesn't match BlueBubbles' server password${e.detail ? ` (${e.detail})` : ""}.`;
  return `BlueBubbles answered HTTP ${e.status}${e.detail ? `: ${e.detail}` : ""}.`;
}

export function blueBubbles(password: string, fetcher: typeof fetch = fetch, base = BLUEBUBBLES): BlueBubbles {
  const secrets = [password];
  const url = (path: string, q: Record<string, string> = {}) => `${base}${path}?${new URLSearchParams({ ...q, password }).toString()}`;
  const get = async (path: string, q?: Record<string, string>) => (await body(await call(fetcher, url(path, q), {}, BB_TIMEOUT_MS), secrets)).data;
  const post = async (path: string, json: unknown, ms = BB_TIMEOUT_MS) => (await body(await call(fetcher, url(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) }, ms), secrets)).data;
  const handlesOf = contactHandles;
  return {
    ping: async () => {
      try {
        await get("/api/v1/ping");
        return true;
      } catch {
        return false;
      }
    },
    contacts: async () => {
      const data = await get("/api/v1/contact");
      if (!Array.isArray(data)) return [];
      return (data as Record<string, unknown>[]).filter((c) => c && typeof c === "object").map(readContact).filter((c) => c.handles.length > 0);
    },
    messages: async (chat, limit) => {
      const data = await get(`/api/v1/chat/${encodeURIComponent(chat)}/message`, { limit: String(Math.min(100, limit)), sort: "DESC", with: "handle" });
      return Array.isArray(data) ? (data as Record<string, unknown>[]).map(readMessage).filter((m): m is Message => m !== null) : [];
    },
    // Every contact's picture in one answer can be tens of megabytes (#870: with 1,000 contacts the 15-second timeout
    // cut it off every time, and no photo ever synced), so this one call gets PHOTOS_TIMEOUT_MS.
    contactPhotos: async () => {
      const data = (await body(await call(fetcher, url("/api/v1/contact", { extraProperties: "avatar" }), {}, PHOTOS_TIMEOUT_MS), secrets)).data;
      if (!Array.isArray(data)) return [];
      const out: ContactPhoto[] = [];
      for (const c of data as Record<string, unknown>[]) {
        if (!c || typeof c !== "object") continue;
        const image = avatarOf(c);
        const handles = handlesOf(c);
        if (image && handles.length) out.push({ handles, image });
      }
      return out;
    },
    chats: async () => {
      const data = await post("/api/v1/chat/query", { limit: 1000, offset: 0, sort: "lastmessage" });
      return Array.isArray(data) ? (data as Record<string, unknown>[]).map((c) => str(c?.guid, 300)).filter((g) => /^(?:iMessage|SMS);-;/i.test(g)) : [];
    },
    // BlueBubbles 1.9.12's message query (messageValidator.queryBodyRules): `after` is ms since 1970 and matches
    // message.date >= after, `with: ["chat"]` joins each message's chats (the handle always comes), ASC is oldest
    // first, `limit` is 1 to 1000. Attachments are never asked for.
    since: async (after, limit) => {
      const data = await post("/api/v1/message/query", { with: ["chat"], sort: "ASC", after: Math.max(0, Math.floor(after)), limit: Math.max(1, Math.min(1000, Math.floor(limit))) });
      if (!Array.isArray(data)) throw new BlueBubblesError("not-json", 200);
      return (data as Record<string, unknown>[]).map(readPolled).filter((p): p is Polled => p !== null);
    },
    // BlueBubbles 1.9.12 (chatValidator.queryRules, ChatInterface.get): `with` an array, `sort` only "lastmessage",
    // `limit` 1 to 1000. A page is the chats in Messages' own order (newest made first), sorted by last message
    // within the page only, so the scan reads every page and sorts for itself.
    chatList: async (offset, limit) => {
      const data = await post("/api/v1/chat/query", { with: ["lastmessage"], sort: "lastmessage", offset: Math.max(0, Math.floor(offset)), limit: Math.max(1, Math.min(1000, Math.floor(limit))) }, 60_000);
      if (!Array.isArray(data)) throw new BlueBubblesError("not-json", 200);
      return (data as Record<string, unknown>[]).map(readChat).filter((c): c is ChatInfo => c !== null);
    },
    // AppleScript sends (Private API off) need a tempGuid; BlueBubbles answers once Messages has the message, or
    // with an error (500) that names why, such as macOS refusing it Automation access to Messages (#767). The error
    // goes up, so the hub can say why instead of only "failed".
    send: async (chat, text, tempGuid) => {
      await post("/api/v1/message/text", { chatGuid: chat, tempGuid, message: text, method: "apple-script" }, BB_SEND_TIMEOUT_MS);
      return true;
    },
    // BlueBubbles Server's react route (messageValidator.sendReactionRules: chatGuid, selectedMessageGuid, reaction
    // from MessageInterface.possibleReactions, partIndex), behind its PrivateApiMiddleware: with the Private API off it
    // answers with an error, which goes up like a send's.
    react: async (chat, messageGuid, tapback) => {
      await post("/api/v1/message/react", { chatGuid: chat, selectedMessageGuid: messageGuid, reaction: tapback, partIndex: 0 }, BB_SEND_TIMEOUT_MS);
      return true;
    },
    // GeneralInterface.getServerMetadata: `private_api` is the setting, `helper_connected` whether the helper in
    // Messages answers. A tapback needs both.
    privateApi: async () => {
      try {
        const data = (await get("/api/v1/server/info")) as Record<string, unknown> | null;
        if (!data || typeof data !== "object") return null;
        return data.private_api === true && data.helper_connected === true;
      } catch {
        return null;
      }
    },
  };
}

/** Whether BlueBubbles answers with this password: nothing when it does, else a BlueBubblesError that says why. */
export async function checkBlueBubbles(password: string, fetcher: typeof fetch = fetch, base = BLUEBUBBLES): Promise<void> {
  await body(await call(fetcher, `${base}/api/v1/ping?${new URLSearchParams({ password }).toString()}`, {}, BB_TIMEOUT_MS), [password]);
}

/** Where the hub's old webhook pointed (before #749): any BlueBubbles webhook to it is Relay's. */
export const OLD_HOOK_PREFIX = "http://127.0.0.1:7420/";

/**
 * Removes any webhook an earlier hub registered with BlueBubbles (the install and the wipe, #749): the hub polls now,
 * so a webhook to 127.0.0.1:7420 is left over. Returns how many went; throws a BlueBubblesError when it can't tell.
 */
export async function removeOldWebhooks(password: string, fetcher: typeof fetch = fetch, base = BLUEBUBBLES): Promise<number> {
  const secrets = [password];
  const q = new URLSearchParams({ password }).toString();
  const list = await body(await call(fetcher, `${base}/api/v1/webhook?${q}`, {}, BB_TIMEOUT_MS), secrets);
  if (!Array.isArray(list.data)) throw new BlueBubblesError("not-json", 200);
  let removed = 0;
  for (const w of list.data as { id?: unknown; url?: unknown }[]) {
    if (typeof w?.url !== "string" || !w.url.startsWith(OLD_HOOK_PREFIX) || (typeof w.id !== "number" && typeof w.id !== "string")) continue;
    await body(await call(fetcher, `${base}/api/v1/webhook/${encodeURIComponent(String(w.id))}?${q}`, { method: "DELETE" }, BB_TIMEOUT_MS), secrets);
    removed++;
  }
  return removed;
}

/** A command's failure line for the Terminal: a BlueBubbles failure says which, anything else its error class. Never a value. */
export function failure(e: unknown): string {
  const bb = describeFailure(e);
  return redact(bb ? `Relay: ${bb}` : `Relay: something went wrong (${errorClass(e)}).`);
}

