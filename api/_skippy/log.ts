/**
 * What Nikita asked Skippy on the Desk, kept by room (#273). Nikita (2026-10-22): "whenever I ask Skippy, the
 * Magnificent on the Desk, he'll answer, but those questions will get routed and stored within the thread of the
 * submind." Nothing server-side can post into a project thread, so this is the Desk's own version: Skippy tags each
 * answer with the room it belongs to (`room` in the answer's closed schema, api/_skippy/prompt.ts; no extra call), and
 * api/skippy.ts keeps the turn here, under that room, for the room's Desk page to show ("Asked Skippy").
 *
 *   - One file per room in the private blob store (`desk/skippy/rooms/<room>.json`), beside the chat's month ledger
 *     (`desk/skippy/spend.json`) and the Desk's sign-ins: Vercel's private Blob store, or the Function App's
 *     `ceo-state` container on Azure (api/_blob.ts). Never a public path.
 *   - Each turn is the question, Skippy's answer, the room, the time and the model that answered. The question already
 *     passed the privacy check before Claude saw it (a private-looking message is refused whole, 422), and the answer
 *     is one plain line (`readReply`). The history the browser sent is never kept.
 *   - The last 200 turns per room, and none older than 30 days: both trimmed on every write and filtered on every read.
 *   - Read only in a signed-in Desk session (`requireSession`, the chat's own sign-in), through GET /api/skippy-log
 *     (on Vercel a rewrite into api/skippy.ts, so the deployment keeps its twelve functions). The Exchange's and
 *     Relay's turns are private like the rest; nothing here reaches the Lattice or a public feed. The one outside
 *     reader is the subminds' read key (#281, api/_site/roomkeys.ts), for the four active rooms only, never Relay's.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";

/** The rooms an ask can belong to; "none" for small talk and anything that fits no room. */
export const LOG_ROOMS = ["green", "exchange", "boiler", "foundry", "relay", "none"] as const;
export type LogRoom = (typeof LOG_ROOMS)[number];

/** Kept per room: the last 200 turns, none older than 30 days. */
export const LOG_KEEP = 200;
export const LOG_DAYS = 30;
const LOG_MS = LOG_DAYS * 24 * 60 * 60 * 1000;
/** The most a read sends the Desk at once. */
export const LOG_SHOW = 50;
/** Caps on a kept turn (the chat's own: a message of 600 characters, a reply of 700). */
const QUESTION_MAX = 600;
const ANSWER_MAX = 700;
const MODEL_MAX = 40;

/** One question and Skippy's answer. */
export interface LoggedTurn {
  /** ISO time it was answered. */
  at: string;
  question: string;
  answer: string;
  room: LogRoom;
  /** The model that wrote the answer, like "claude-sonnet-5-5". */
  model: string;
}

/** A room from anywhere (the model's answer, a query): one of the set, else "none". */
export const readRoom = (v: unknown): LogRoom => (typeof v === "string" && (LOG_ROOMS as readonly string[]).includes(v) ? (v as LogRoom) : "none");

/** Whether `v` names a room exactly (for a read, where a wrong name is refused rather than guessed). */
export const isLogRoom = (v: unknown): v is LogRoom => typeof v === "string" && (LOG_ROOMS as readonly string[]).includes(v);

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A stored turn, checked again on the way out: null when it isn't one. */
export function cleanTurn(v: unknown): LoggedTurn | null {
  const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const at = typeof t.at === "string" && Number.isFinite(Date.parse(t.at)) ? new Date(Date.parse(t.at)).toISOString() : "";
  const question = line(t.question, QUESTION_MAX);
  const answer = line(t.answer, ANSWER_MAX);
  const model = line(t.model, MODEL_MAX);
  if (!at || !question || !answer) return null;
  return { at, question, answer, room: readRoom(t.room), model: model || "unknown" };
}

/** A room's turns, oldest first: only good ones, none older than 30 days, the last 200. */
export function keepTurns(raw: unknown, now: number): LoggedTurn[] {
  const from = now - LOG_MS;
  return (Array.isArray(raw) ? raw : [])
    .map(cleanTurn)
    .filter((t): t is LoggedTurn => t !== null && Date.parse(t.at) >= from)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-LOG_KEEP);
}

/** Where the turns live. */
export interface RoomLog {
  /** A room's turns, newest first, at most LOG_SHOW. */
  list(room: LogRoom, now: number): Promise<LoggedTurn[]>;
  add(turn: LoggedTurn, now: number): Promise<void>;
}

const pathOf = (room: LogRoom) => `desk/skippy/rooms/${room}.json`;
const newestFirst = (turns: LoggedTurn[]) => turns.slice(-LOG_SHOW).reverse();

/** The log in the private blob store; a write checks the ETag, so two answers at once both land. */
export class BlobRoomLog implements RoomLog {
  constructor(private readonly blob: BlobBackend) {}
  private async load(room: LogRoom): Promise<unknown> {
    const found = await this.blob.get(pathOf(room));
    return found ? await new Response(found.stream).json().catch(() => []) : [];
  }
  async list(room: LogRoom, now: number): Promise<LoggedTurn[]> {
    return newestFirst(keepTurns(await this.load(room), now));
  }
  async add(turn: LoggedTurn, now: number): Promise<void> {
    const good = cleanTurn(turn);
    if (!good) return;
    const path = pathOf(good.room);
    for (let attempt = 0; attempt < 3; attempt++) {
      const etag = await this.blob.etag(path);
      const cur = etag ? await this.load(good.room) : [];
      try {
        await this.blob.put(path, JSON.stringify(keepTurns([...(Array.isArray(cur) ? cur : []), good], now)), {
          contentType: "application/json",
          addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
  }
}

/** In memory, for tests. */
export class MemoryRoomLog implements RoomLog {
  rooms: Partial<Record<LogRoom, unknown[]>> = {};
  async list(room: LogRoom, now: number): Promise<LoggedTurn[]> {
    return newestFirst(keepTurns(structuredClone(this.rooms[room] ?? []), now));
  }
  async add(turn: LoggedTurn, now: number): Promise<void> {
    const good = cleanTurn(turn);
    if (good) this.rooms[good.room] = keepTurns([...(this.rooms[good.room] ?? []), good], now);
  }
}
