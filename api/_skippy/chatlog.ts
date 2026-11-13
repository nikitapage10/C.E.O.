/**
 * Desk chats, kept whole (#1097, Nikita 2026-11-13): every turn with Desk Skippy (typed on the Desk, a room's mic, the
 * phone) and every line of a Talk call, so Skippy, the Magnificent's thread can read the full history. The memory's
 * journal (#646, ./agent/memory.ts) keeps only trimmed turns for the distiller; this keeps the words as said.
 *
 *   Where     the private blob store only (`desk/skippy/memory/chats.json`), the last CHAT_DAYS days, at most CHAT_MAX
 *             turns. Never the public site, a log, an issue or the repo.
 *   Talk      a call's turns come from its finished conversation at ElevenLabs (api/skippy-voice.ts settle → onDone):
 *             each thing Nikita said with what was answered, in order. The call's own hand-offs to the deeper mind
 *             aren't kept twice.
 *   Rules     the memory's rules hold on every turn (`memoryRefusal`): one with private details, money, legal matters,
 *             the skip list's terms or the priority list is left out whole.
 *   Read      GET /api/skippy-journal?since=<ISO time> with the subminds' read key (SUBMIND_LOG_TOKEN,
 *             api/_site/roomkeys.ts), or in the Desk's passkey session; `private, no-store`. Oldest first, at most
 *             READ_MAX turns an answer, with `more` when there are later ones (ask again from the last `at`).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { readJson, updateJson } from "../_haven/json.js";
import { readsWithLogKey } from "../_site/roomkeys.js";
import { memoryRefusal } from "./agent/memory.js";

export const CHATS_PATH = "desk/skippy/memory/chats.json";
export const CHAT_PATH = "/api/skippy-journal";
export const CHAT_DAYS = 30;
export const CHAT_MAX = 3_000;
/** The most a side of a turn keeps: a whole answer, cut only if it runs very long. */
export const CHAT_TEXT_MAX = 8_000;
/** The most turns one read answers. */
export const READ_MAX = 500;

export type ChatVia = "desk" | "phone" | "room" | "talk";
const VIAS: readonly ChatVia[] = ["desk", "phone", "room", "talk"];

export interface ChatTurn {
  at: string;
  via: ChatVia;
  /** What Nikita said or typed. */
  q: string;
  /** What Skippy (or a submind on a call) answered. */
  a: string;
  /** The room, for a room's mic. */
  room?: string;
  /** A Talk call's conversation id, so a call's turns read together. */
  call?: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").trim().slice(0, CHAT_TEXT_MAX) : "");

/** A turn as kept, or null when it is empty or trips the memory's rules. */
export function keepable(t: ChatTurn, skipTerms: readonly string[] = []): ChatTurn | null {
  const q = text(t.q);
  const a = text(t.a);
  if (!q && !a) return null;
  if (memoryRefusal(`${q}\n${a}`, skipTerms)) return null;
  const at = Number.isNaN(Date.parse(t.at)) ? new Date(0).toISOString() : new Date(t.at).toISOString();
  return { at, via: VIAS.includes(t.via) ? t.via : "desk", q, a, ...(t.room && { room: String(t.room).slice(0, 20) }), ...(t.call && { call: String(t.call).slice(0, 80) }) };
}

function clean(raw: unknown): ChatTurn[] {
  return (Array.isArray(raw) ? raw : []).filter((t): t is ChatTurn => !!t && typeof t === "object" && typeof (t as ChatTurn).at === "string" && typeof (t as ChatTurn).q === "string" && typeof (t as ChatTurn).a === "string");
}

export interface ChatLog {
  add(turns: ChatTurn[], now: number): Promise<number>;
  read(since: number, now: number): Promise<ChatTurn[]>;
}

/** The chats in the private blob store; each write checks the ETag, so two at once both land. */
export class BlobChatLog implements ChatLog {
  constructor(
    private readonly blob: BlobBackend,
    private readonly skipTerms: readonly string[] = [],
  ) {}

  async add(turns: ChatTurn[], now: number): Promise<number> {
    const kept = turns.map((t) => keepable(t, this.skipTerms)).filter((t): t is ChatTurn => t !== null);
    if (!kept.length) return 0;
    const from = now - CHAT_DAYS * 24 * 60 * 60_000;
    await updateJson<unknown, null>(this.blob, CHATS_PATH, [], (cur) => {
      const old = clean(cur).filter((t) => Date.parse(t.at) >= from);
      // A call settled twice brings nothing twice.
      const seen = new Set(old.filter((t) => t.call).map((t) => `${t.call}|${t.at}|${t.q}`));
      const fresh = kept.filter((t) => !t.call || !seen.has(`${t.call}|${t.at}|${t.q}`));
      const next = [...old, ...fresh].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-CHAT_MAX);
      return { next, result: null };
    });
    return kept.length;
  }

  async read(since: number, now: number): Promise<ChatTurn[]> {
    const from = Math.max(since, now - CHAT_DAYS * 24 * 60 * 60_000);
    return clean(await readJson<unknown>(this.blob, CHATS_PATH, [])).filter((t) => Date.parse(t.at) > from);
  }
}

/**
 * A finished Talk call's turns (ElevenLabs' `transcript[]`: role, message, time_in_call_secs): each run of Nikita's
 * lines with the agents' lines that answered it. `start` is the call's start (ms) when ElevenLabs doesn't say.
 */
export function callTurns(conversation: unknown, id: string, start: number): ChatTurn[] {
  const c = (conversation && typeof conversation === "object" ? conversation : {}) as Record<string, unknown>;
  const meta = (c.metadata && typeof c.metadata === "object" ? c.metadata : {}) as Record<string, unknown>;
  const t0 = typeof meta.start_time_unix_secs === "number" && Number.isFinite(meta.start_time_unix_secs) ? meta.start_time_unix_secs * 1000 : start;
  const out: ChatTurn[] = [];
  let q: string[] = [];
  let a: string[] = [];
  let at = t0;
  const flush = () => {
    if (q.length || a.length) out.push({ at: new Date(at).toISOString(), via: "talk", q: q.join(" "), a: a.join(" "), call: id });
    q = [];
    a = [];
  };
  for (const line of Array.isArray(c.transcript) ? c.transcript : []) {
    const o = (line && typeof line === "object" ? line : {}) as Record<string, unknown>;
    if ((o.role !== "user" && o.role !== "agent") || typeof o.message !== "string" || !o.message.trim()) continue;
    const secs = typeof o.time_in_call_secs === "number" && Number.isFinite(o.time_in_call_secs) ? o.time_in_call_secs : 0;
    if (o.role === "user") {
      if (a.length) flush();
      if (!q.length) at = t0 + secs * 1000;
      q.push(o.message.trim());
    } else {
      if (!q.length && !a.length) at = t0 + secs * 1000;
      a.push(o.message.trim());
    }
  }
  flush();
  return out;
}

export interface ChatReadDeps {
  desk: DeskDeps;
  log: ChatLog | null;
  env: Record<string, string | undefined>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

/** GET /api/skippy-journal?since=<ISO>: the read key, or the Desk's passkey session. */
export async function chatLogGet(request: Request, deps: ChatReadDeps): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method" }, 405);
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const sinceRaw = url.searchParams.get("since");
  if (keys.some((k) => k !== "since") || keys.length > 1 || (sinceRaw !== null && Number.isNaN(Date.parse(sinceRaw)))) return json({ error: "bad-request" }, 400);
  const keyed = readsWithLogKey(request, deps.env);
  const signed = keyed ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => (signed ? withCookie(json(body, status), signed) : json(body, status));
  if (!deps.log) return reply({ error: "not-set-up" }, 503);
  const all = await deps.log.read(sinceRaw ? Date.parse(sinceRaw) : 0, deps.desk.now);
  const turns = all.slice(0, READ_MAX);
  return reply({ turns, more: all.length > turns.length });
}

/* ── History (#1160) ── */

/**
 * Call history in Skippy's chat (#1160, Nikita 2026-11-13): the same journal, grouped into conversations for the
 * Desk's History button. The Desk's passkey session only (requireSession before anything is read: 401 signed out,
 * 403 cross-site, 503 not set up); never the subminds' read key or the feed key, and the gate doesn't list it.
 *
 *   GET /api/skippy-history          → { conversations: [{ id, kind, via, at, end, turns, first }] }, newest first.
 *   GET /api/skippy-history?id=<id>  → { conversation: { …the same, lines: ChatTurn[] } }, oldest turn first; 404 gone.
 *
 * A Talk call is one conversation (its `call` id). Typed, phone and room-mic turns run together while each comes within
 * CHAT_GAP of the last one. `private, no-store`, like the journal.
 */
export const HISTORY_PATH = "/api/skippy-history";
/** Typed turns this close together read as one conversation. */
export const CHAT_GAP = 30 * 60_000;
/** The most conversations one list answers. */
export const HISTORY_MAX = 300;
/** The first question as the list shows it. */
export const FIRST_MAX = 160;

export interface ChatSummary {
  /** `t<call id>` for a Talk call, `c<start ms>` for a typed run. */
  id: string;
  kind: "talk" | "chat";
  /** How it came in (a typed run takes its first turn's). */
  via: ChatVia;
  /** When it started and when its last turn was (ISO). */
  at: string;
  end: string;
  turns: number;
  /** The first thing Nikita said in it, trimmed for the list ("" when only Skippy spoke). */
  first: string;
}

export interface ChatConversation extends ChatSummary {
  lines: ChatTurn[];
}

const firstOf = (turns: ChatTurn[]) => {
  const q = turns.find((t) => t.q.trim())?.q.trim().replace(/\s+/g, " ") ?? "";
  return q.length > FIRST_MAX ? `${q.slice(0, FIRST_MAX - 1).trimEnd()}…` : q;
};

/** The journal's turns as conversations, newest first. */
export function conversations(all: readonly ChatTurn[]): ChatConversation[] {
  const sorted = [...all].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const calls = new Map<string, ChatTurn[]>();
  const runs: ChatTurn[][] = [];
  for (const t of sorted) {
    if (t.call) {
      const got = calls.get(t.call);
      if (got) got.push(t);
      else calls.set(t.call, [t]);
      continue;
    }
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && Date.parse(t.at) - Date.parse(last.at) <= CHAT_GAP) run.push(t);
    else runs.push([t]);
  }
  const make = (id: string, kind: ChatSummary["kind"], lines: [ChatTurn, ...ChatTurn[]]): ChatConversation => ({
    id,
    kind,
    via: kind === "talk" ? "talk" : lines[0].via,
    at: lines[0].at,
    end: (lines[lines.length - 1] ?? lines[0]).at,
    turns: lines.length,
    first: firstOf(lines),
    lines,
  });
  const out = [...[...calls].map(([call, lines]) => make(`t${call}`, "talk", lines as [ChatTurn, ...ChatTurn[]])), ...runs.map((lines) => make(`c${Date.parse((lines as [ChatTurn])[0].at)}`, "chat", lines as [ChatTurn, ...ChatTurn[]]))];
  return out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || (x.id < y.id ? -1 : 1));
}

/** A conversation id as asked for: `t` and a call id, or `c` and a start time in ms. */
const ID_RE = /^(t[A-Za-z0-9_.:-]{1,80}|c\d{1,15})$/;

/** GET /api/skippy-history[?id=]: the passkey session only. */
export async function historyGet(request: Request, deps: { desk: DeskDeps; log: ChatLog | null }): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method" }, 405);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const id = url.searchParams.get("id");
  if (keys.some((k) => k !== "id") || keys.length > 1 || (id !== null && !ID_RE.test(id))) return reply({ error: "bad-request" }, 400);
  if (!deps.log) return reply({ error: "not-set-up" }, 503);
  let all: ChatTurn[];
  try {
    all = await deps.log.read(0, deps.desk.now);
  } catch {
    return reply({ error: "unreadable" }, 502);
  }
  const convs = conversations(all);
  if (id === null) return reply({ conversations: convs.slice(0, HISTORY_MAX).map(({ lines: _lines, ...s }) => s) });
  const found = convs.find((c) => c.id === id);
  if (!found) return reply({ error: "gone" }, 404);
  return reply({ conversation: found });
}
