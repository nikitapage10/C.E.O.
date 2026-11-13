/**
 * Call history in Skippy's chat (#1160, Nikita 2026-11-13: "a small button that could look up call history and see
 * all our chats"), browser side. GET /api/skippy-history in the Desk's passkey session (api/_skippy/chatlog.ts,
 * historyGet): the last 30 days of Talk calls and typed, phone and room-mic chats as conversations, newest first, and
 * one conversation's turns when it is tapped. Read only, no model call; nothing is kept in the browser.
 */

export const HISTORY_PATH = "/api/skippy-history";

export type ChatVia = "desk" | "phone" | "room" | "talk";

export interface ChatSummary {
  id: string;
  kind: "talk" | "chat";
  via: ChatVia;
  at: string;
  end: string;
  turns: number;
  first: string;
}

export interface ChatLine {
  at: string;
  via: ChatVia;
  q: string;
  a: string;
  room?: string;
}

export interface ChatConversation extends ChatSummary {
  lines: ChatLine[];
}

export type Load<T> = { ok: true; value: T } | { ok: false; why: "signed-out" | "gone" | "failed" };

const VIAS: readonly ChatVia[] = ["desk", "phone", "room", "talk"];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const dated = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** A summary as the server sent it, checked again here; null when it doesn't hold together. */
export function readSummary(raw: unknown): ChatSummary | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || !dated(o.at)) return null;
  return {
    id: o.id,
    kind: o.kind === "talk" ? "talk" : "chat",
    via: VIAS.includes(o.via as ChatVia) ? (o.via as ChatVia) : "desk",
    at: o.at as string,
    end: dated(o.end) ? (o.end as string) : (o.at as string),
    turns: typeof o.turns === "number" && o.turns > 0 ? Math.floor(o.turns) : 1,
    first: str(o.first),
  };
}

function readLine(raw: unknown): ChatLine | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!dated(o.at)) return null;
  const q = str(o.q);
  const a = str(o.a);
  if (!q && !a) return null;
  return {
    at: o.at as string,
    via: VIAS.includes(o.via as ChatVia) ? (o.via as ChatVia) : "desk",
    q,
    a,
    ...(typeof o.room === "string" && o.room && { room: o.room }),
  };
}

async function getJson(path: string, fetcher: typeof fetch): Promise<Load<Record<string, unknown>>> {
  try {
    const res = await fetcher(path, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 401) return { ok: false, why: "signed-out" };
    if (res.status === 404) return { ok: false, why: "gone" };
    if (!res.ok) return { ok: false, why: "failed" };
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? { ok: true, value: body as Record<string, unknown> } : { ok: false, why: "failed" };
  } catch {
    return { ok: false, why: "failed" };
  }
}

/** The list, newest first. */
export async function loadHistory(fetcher: typeof fetch = fetch): Promise<Load<ChatSummary[]>> {
  const got = await getJson(HISTORY_PATH, fetcher);
  if (!got.ok) return got;
  const list = Array.isArray(got.value.conversations) ? got.value.conversations : [];
  return {
    ok: true,
    value: list
      .map(readSummary)
      .filter((c): c is ChatSummary => c !== null)
      .sort((x, y) => Date.parse(y.at) - Date.parse(x.at)),
  };
}

/** One conversation, its turns oldest first. */
export async function loadConversation(id: string, fetcher: typeof fetch = fetch): Promise<Load<ChatConversation>> {
  const got = await getJson(`${HISTORY_PATH}?id=${encodeURIComponent(id)}`, fetcher);
  if (!got.ok) return got;
  const summary = readSummary(got.value.conversation);
  const raw = (got.value.conversation as Record<string, unknown> | undefined)?.lines;
  if (!summary) return { ok: false, why: "failed" };
  return {
    ok: true,
    value: {
      ...summary,
      lines: (Array.isArray(raw) ? raw : []).map(readLine).filter((l): l is ChatLine => l !== null),
    },
  };
}

/** How it came in, in a word. */
export function viaLabel(c: Pick<ChatSummary, "kind" | "via">): string {
  if (c.kind === "talk") return "Call";
  return c.via === "phone" ? "Phone" : c.via === "room" ? "Room mic" : "Typed";
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today", "Yesterday", or "Wed 11 Nov", in the browser's own time. */
export function dayLabel(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  if (sameDay(d, today)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "14:05", in the browser's own time. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How long a call ran, when it ran a minute or more ("12 min"). */
export function spanLabel(c: Pick<ChatSummary, "at" | "end">): string {
  const mins = Math.round((Date.parse(c.end) - Date.parse(c.at)) / 60_000);
  return mins >= 1 ? `${mins} min` : "";
}

/** The list grouped under its days, newest first. */
export function byDay(list: readonly ChatSummary[], now: number = Date.now()): { day: string; items: ChatSummary[] }[] {
  const out: { day: string; items: ChatSummary[] }[] = [];
  for (const c of list) {
    const day = dayLabel(c.at, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(c);
    else out.push({ day, items: [c] });
  }
  return out;
}
