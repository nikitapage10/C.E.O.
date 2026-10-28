import { BLUEBUBBLES } from "./config.ts";

/**
 * BlueBubbles Server's local API (http://127.0.0.1:1234, its own password), the hub's only way to Messages: the
 * hub never opens chat.db itself, so it needs no Full Disk Access. Read: contacts (names for placeholders and the
 * Desk), a chat's recent messages (fetched for one call and dropped), the one-to-one chats' ids (to find the chat a
 * new text goes in, #536; read for one ask and dropped). Write: one text, only when Nikita's signed send
 * request says so (./engine.ts, `act`). Attachments are never asked for.
 */

export interface Message {
  /** A message's text, "" for one with none (an attachment, a reaction). Memory only. */
  text: string;
  fromMe: boolean;
  at: number;
  /** The sender's handle (a number or address); "" for Nikita's own. */
  handle: string;
}

export interface Contact {
  names: string[];
  handles: string[];
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
  /** Sends one text; true when BlueBubbles took it. */
  send(chat: string, text: string, tempGuid: string): Promise<boolean>;
  /** The guids of Messages' one-to-one chats (iMessage;-;… and SMS;-;…), for finding the chat a new text goes in (#536). */
  chats(): Promise<string[]>;
}

/** Whether a chat id is a group's (iMessage;+;chat…) rather than one person's (iMessage;-;+1…). */
export const isGroupChat = (chat: string) => /;\+;/.test(chat);
export const channelOf = (chat: string): "iMessage" | "SMS" => (/^SMS;/i.test(chat) ? "SMS" : "iMessage");

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, max = 10_000) => (typeof v === "string" ? v.slice(0, max) : "");

export function readMessage(o: Record<string, unknown> | null | undefined): Message | null {
  if (!o || typeof o !== "object") return null;
  // Reactions, edits and system items carry an associated guid or a non-zero item type: not a message to answer.
  if (o.associatedMessageGuid || (typeof o.itemType === "number" && o.itemType !== 0)) return null;
  const handle = o.handle && typeof o.handle === "object" ? str((o.handle as Record<string, unknown>).address, 200) : "";
  return { text: str(o.text), fromMe: o.isFromMe === true, at: num(o.dateCreated), handle: o.isFromMe === true ? "" : handle };
}

/** A BlueBubbles webhook body, read: a new message in one chat, or null for any other event. */
export function readWebhook(body: unknown): Inbound | null {
  const b = body as Record<string, unknown> | null;
  if (!b || b.type !== "new-message" || !b.data || typeof b.data !== "object") return null;
  const data = b.data as Record<string, unknown>;
  const chat = Array.isArray(data.chats) ? (data.chats[0] as Record<string, unknown> | undefined) : undefined;
  const guid = str(chat?.guid, 300);
  const message = readMessage(data);
  if (!guid || !message || !message.at) return null;
  return { chat: guid, group: isGroupChat(guid), groupName: str(chat?.displayName, 80), message };
}

export function blueBubbles(password: string, fetcher: typeof fetch = fetch, base = BLUEBUBBLES): BlueBubbles {
  const url = (path: string, q: Record<string, string> = {}) => `${base}${path}?${new URLSearchParams({ ...q, password }).toString()}`;
  const get = async (path: string, q?: Record<string, string>) => {
    const res = await fetcher(url(path, q), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw Object.assign(new Error("bluebubbles"), { name: "HttpError" });
    return ((await res.json()) as { data?: unknown }).data;
  };
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
      return (data as Record<string, unknown>[]).map((c) => ({
        names: [str(c.displayName, 80), str(c.firstName, 40), str(c.lastName, 40)].filter((x) => x.trim().length > 1),
        handles: [...(Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []), ...(Array.isArray(c.emails) ? c.emails : [])].map((h) => str((h as Record<string, unknown>)?.address, 200)).filter(Boolean),
      }));
    },
    messages: async (chat, limit) => {
      const data = await get(`/api/v1/chat/${encodeURIComponent(chat)}/message`, { limit: String(Math.min(100, limit)), sort: "DESC", with: "handle" });
      return Array.isArray(data) ? (data as Record<string, unknown>[]).map(readMessage).filter((m): m is Message => m !== null) : [];
    },
    chats: async () => {
      const res = await fetcher(url("/api/v1/chat/query"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 1000, offset: 0, sort: "lastmessage" }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw Object.assign(new Error("bluebubbles"), { name: "HttpError" });
      const data = ((await res.json()) as { data?: unknown }).data;
      return Array.isArray(data) ? (data as Record<string, unknown>[]).map((c) => str(c?.guid, 300)).filter((g) => /^(?:iMessage|SMS);-;/i.test(g)) : [];
    },
    send: async (chat, text, tempGuid) => {
      const res = await fetcher(url("/api/v1/message/text"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatGuid: chat, tempGuid, message: text, method: "apple-script" }), signal: AbortSignal.timeout(30_000) });
      return res.ok;
    },
  };
}

/** Registers the hub's webhook with BlueBubbles (new messages only), replacing any earlier Relay one. */
export async function registerWebhook(password: string, hookUrl: string, fetcher: typeof fetch = fetch, base = BLUEBUBBLES): Promise<void> {
  const q = new URLSearchParams({ password }).toString();
  const list = await fetcher(`${base}/api/v1/webhook?${q}`).then((r) => r.json() as Promise<{ data?: { id?: unknown; url?: unknown }[] }>);
  for (const w of list.data ?? []) {
    if (typeof w.url === "string" && w.url.startsWith("http://127.0.0.1:7420/")) await fetcher(`${base}/api/v1/webhook/${encodeURIComponent(String(w.id))}?${q}`, { method: "DELETE" });
  }
  const res = await fetcher(`${base}/api/v1/webhook?${q}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: hookUrl, events: ["new-message"] }) });
  if (!res.ok) throw Object.assign(new Error("bluebubbles webhook"), { name: "HttpError" });
}

/** Removes the hub's webhook from BlueBubbles (the wipe). */
export async function removeWebhook(password: string, fetcher: typeof fetch = fetch, base = BLUEBUBBLES): Promise<void> {
  const q = new URLSearchParams({ password }).toString();
  const list = await fetcher(`${base}/api/v1/webhook?${q}`).then((r) => r.json() as Promise<{ data?: { id?: unknown; url?: unknown }[] }>);
  for (const w of list.data ?? []) {
    if (typeof w.url === "string" && w.url.startsWith("http://127.0.0.1:7420/")) await fetcher(`${base}/api/v1/webhook/${encodeURIComponent(String(w.id))}?${q}`, { method: "DELETE" });
  }
}
