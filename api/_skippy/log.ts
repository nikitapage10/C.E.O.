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
 * Hand-offs (#312): when Desk Skippy can't settle an ask from the Desk, his stack sheet and a lookup, or it is a build or
 * room request, the turn is kept with `needs`: "skippy" (the "Skippy, the Magnificent" thread) or the id of the room's
 * active submind. GET /api/skippy-log?room=<room>&needs=<who> lists the ones still open; the thread side answers through
 * POST /api/skippy-answer (api/skippy.ts), which keeps the answer on the turn as its `followUp` and closes it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash } from "node:crypto";
import { BlobPreconditionError, type BlobBackend } from "../_blob.js";

/**
 * The rooms an ask can belong to; "none" for small talk and anything that fits no room. "kernel" (#480) is Skippy,
 * the Magnificent's own thread: builds, look-ups across rooms and anything that needs real work, always handed to
 * "skippy", whose thread answers it (scripts/submind-watch.sh kernel).
 */
export const LOG_ROOMS = ["green", "exchange", "boiler", "foundry", "relay", "kernel", "none"] as const;
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

/**
 * Each room's submind, who a hand-off for that room goes to (packages/simulator/src/subminds.ts, the one list; a test
 * holds this copy to it, since the functions don't bundle the simulator). Only an active one has a thread to take it;
 * a hand-off for a room whose submind isn't active goes to Skippy.
 */
export const ROOM_SUBMINDS = {
  green: { id: "turf", name: "The Commentator", active: true },
  exchange: { id: "ticker", name: "The Bookie", active: true },
  boiler: { id: "soot", name: "The Pessimist", active: true },
  foundry: { id: "ember", name: "The Builder", active: true },
  relay: { id: "static", name: "The Messenger", active: true },
} as const satisfies Record<Exclude<LogRoom, "none" | "kernel">, { id: string; name: string; active: boolean }>;

/** Who a turn can be handed to: Skippy's own thread, or a room's submind by its id. */
export const NEEDS = ["skippy", ...Object.values(ROOM_SUBMINDS).map((m) => m.id)] as const;
export type Needs = "skippy" | (typeof ROOM_SUBMINDS)[keyof typeof ROOM_SUBMINDS]["id"];
export const isNeeds = (v: unknown): v is Needs => typeof v === "string" && (NEEDS as readonly string[]).includes(v);

/** Who a hand-off asked for in the answer ("skippy" or "submind") goes to, for the room it was filed under. */
export function handoffTo(ask: unknown, room: LogRoom): Needs | null {
  if (ask === "skippy") return "skippy";
  if (ask !== "submind") return null;
  const m = room === "none" || room === "kernel" ? null : ROOM_SUBMINDS[room];
  return m && m.active ? m.id : "skippy";
}

/** The name a hand-off is said to go to. */
export const needsName = (n: Needs): string => (n === "skippy" ? "Skippy's thread" : (Object.values(ROOM_SUBMINDS).find((m) => m.id === n)?.name ?? "Skippy's thread"));

/**
 * The answer card a submind may send with its line (#341): the numbers side by side (for the Green, Sleeper's and
 * FantasyPros' projections), its verdict, the metrics that decided it and where the numbers came from. The Desk's chat
 * shows it in place of "Checking with the <submind>…". Plain text and numbers only, checked here and by the privacy
 * check (api/skippy.ts) like the line itself.
 */
export interface AnswerCard {
  /** The call, one line: "Start Tre Tucker in the FLEX". */
  verdict: string;
  /** The column heads of the numbers, two or three ("Sleeper", "FantasyPros"). */
  cols: string[];
  /** One row a player or option: its label and a number (or none) per column. */
  rows: { label: string; values: (number | null)[] }[];
  /** What decided it, a few short lines. */
  metrics: string[];
  /** Where the numbers came from, by name ("Sleeper projections, 18:02"); never a link. */
  sources: string[];
}

/** The card's caps. */
export const CARD_LIMITS = { verdict: 200, col: 24, cols: 3, label: 48, rows: 6, metric: 140, metrics: 5, source: 80, sources: 5 } as const;

const NO_LINK = /\b(?:https?:\/\/|www\.)|[<>]/i;
const cardLine = (v: unknown, max: number) => {
  const t = line(v, max);
  return t && !NO_LINK.test(t) ? t : "";
};

/** A card from anywhere (the thread's POST, the stored turn), checked: null when it isn't one or has no verdict. */
export function cleanCard(v: unknown): AnswerCard | null {
  const c = (v && typeof v === "object" && !Array.isArray(v) ? v : null) as Record<string, unknown> | null;
  if (!c) return null;
  const verdict = cardLine(c.verdict, CARD_LIMITS.verdict);
  if (!verdict) return null;
  const list = (x: unknown, max: number, each: number) => (Array.isArray(x) ? x : []).map((s) => cardLine(s, each)).filter(Boolean).slice(0, max);
  const cols = list(c.cols, CARD_LIMITS.cols, CARD_LIMITS.col);
  const value = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6 ? Math.round(n * 100) / 100 : null);
  const rows = cols.length
    ? (Array.isArray(c.rows) ? c.rows : [])
        .map((r) => {
          const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
          const label = cardLine(o.label, CARD_LIMITS.label);
          const values = cols.map((_, i) => value(Array.isArray(o.values) ? o.values[i] : null));
          return label ? { label, values } : null;
        })
        .filter((r): r is AnswerCard["rows"][number] => r !== null)
        .slice(0, CARD_LIMITS.rows)
    : [];
  return { verdict, cols: rows.length ? cols : [], rows, metrics: list(c.metrics, CARD_LIMITS.metrics, CARD_LIMITS.metric), sources: list(c.sources, CARD_LIMITS.sources, CARD_LIMITS.source) };
}

/** Every string on a card, for the privacy check. */
export const cardText = (c: AnswerCard): string[] => [c.verdict, ...c.cols, ...c.rows.map((r) => r.label), ...c.metrics, ...c.sources];

/** The thread side's answer to a hand-off, kept on the turn. */
export interface FollowUp {
  from: Needs;
  text: string;
  /** ISO time it came back. */
  at: string;
  /** The answer card (#341), when the thread sent one. */
  card?: AnswerCard;
  /**
   * `false` on an interim answer (#480: "on it, #481"): it shows in the Desk's bubble and the hand-off stays open for
   * a later one. Left out (the default) on a final answer, which closes the hand-off.
   */
  final?: false;
}

/** Whether a turn's hand-off is still waiting on an answer: none yet, or only an interim one. */
export const isOpen = (t: Pick<LoggedTurn, "needs" | "followUp">): boolean => !!t.needs && (!t.followUp || t.followUp.final === false);

/** A turn's id: 16 hex characters, stable for a turn (its time and its question). */
export const turnId = (at: string, question: string) => createHash("sha256").update(`${at}|${question}`).digest("hex").slice(0, 16);
export const isTurnId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);

/** One question and Skippy's answer. */
export interface LoggedTurn {
  /** Its id, for a follow-up to name (#312). */
  id: string;
  /** ISO time it was answered. */
  at: string;
  question: string;
  answer: string;
  room: LogRoom;
  /** The model that wrote the answer, like "claude-sonnet-5-5". */
  model: string;
  /** Handed off (#312): who it waits on. */
  needs?: Needs;
  /** The answer that came back for a hand-off; the hand-off is closed once there is one. */
  followUp?: FollowUp;
}

/** A room from anywhere (the model's answer, a query): one of the set, else "none". */
export const readRoom = (v: unknown): LogRoom => (typeof v === "string" && (LOG_ROOMS as readonly string[]).includes(v) ? (v as LogRoom) : "none");

/** Whether `v` names a room exactly (for a read, where a wrong name is refused rather than guessed). */
export const isLogRoom = (v: unknown): v is LogRoom => typeof v === "string" && (LOG_ROOMS as readonly string[]).includes(v);

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A stored turn, checked again on the way out: null when it isn't one. */
const isoOf = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : "");

/** A follow-up, checked like the rest: who from, one plain line under the answer's cap, and when. */
export function cleanFollowUp(v: unknown): FollowUp | null {
  const f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const at = isoOf(f.at);
  const text = line(f.text, ANSWER_MAX);
  const card = f.card === undefined ? null : cleanCard(f.card);
  return at && text && isNeeds(f.from) ? { from: f.from, text, at, ...(card && { card }), ...(f.final === false && { final: false as const }) } : null;
}

export function cleanTurn(v: unknown): LoggedTurn | null {
  const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const at = isoOf(t.at);
  const question = line(t.question, QUESTION_MAX);
  const answer = line(t.answer, ANSWER_MAX);
  const model = line(t.model, MODEL_MAX);
  if (!at || !question || !answer) return null;
  const followUp = cleanFollowUp(t.followUp);
  return {
    id: isTurnId(t.id) ? t.id : turnId(at, question),
    at,
    question,
    answer,
    room: readRoom(t.room),
    model: model || "unknown",
    ...(isNeeds(t.needs) && { needs: t.needs }),
    ...(followUp && { followUp }),
  };
}

/** Which turns a read wants: every one, or only the hand-offs still open (to one thread, or to any). */
export type NeedsFilter = Needs | "any";
export const isNeedsFilter = (v: unknown): v is NeedsFilter => v === "any" || isNeeds(v);
const fits = (t: LoggedTurn, needs?: NeedsFilter) => !needs || (isOpen(t) && (needs === "any" || t.needs === needs));

/** What answering a hand-off came to. */
export type Answered = { ok: true; turn: LoggedTurn } | { ok: false; why: "missing" | "not-handed-off" | "answered" | "wrong-thread" };

/** A follow-up applied to a room's turns: the turns as they become, and what it came to. */
export function withFollowUp(turns: LoggedTurn[], id: string, f: FollowUp): { turns: LoggedTurn[]; result: Answered } {
  const i = turns.findIndex((t) => t.id === id);
  const t = turns[i];
  if (!t) return { turns, result: { ok: false, why: "missing" } };
  if (!t.needs) return { turns, result: { ok: false, why: "not-handed-off" } };
  // An interim answer (#480) keeps it open for the next one; a final one closes it.
  if (!isOpen(t)) return { turns, result: { ok: false, why: "answered" } };
  // Skippy can answer anything handed off; a submind only what was handed to it.
  if (f.from !== "skippy" && f.from !== t.needs) return { turns, result: { ok: false, why: "wrong-thread" } };
  const turn = { ...t, followUp: f };
  return { turns: turns.map((x, j) => (j === i ? turn : x)), result: { ok: true, turn } };
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
  /** A room's turns, newest first, at most LOG_SHOW; with `needs`, only the hand-offs still open to that thread. */
  list(room: LogRoom, now: number, needs?: NeedsFilter): Promise<LoggedTurn[]>;
  add(turn: Omit<LoggedTurn, "id"> & { id?: string }, now: number): Promise<void>;
  /** Keeps the thread side's answer on a handed-off turn, in whichever room it was filed (#312). */
  answer(id: string, followUp: FollowUp, now: number): Promise<Answered>;
}

const pathOf = (room: LogRoom) => `desk/skippy/rooms/${room}.json`;
const newestFirst = (turns: LoggedTurn[], needs?: NeedsFilter) => turns.filter((t) => fits(t, needs)).slice(-LOG_SHOW).reverse();

/** The log in the private blob store; a write checks the ETag, so two answers at once both land. */
export class BlobRoomLog implements RoomLog {
  constructor(private readonly blob: BlobBackend) {}
  private async load(room: LogRoom): Promise<unknown> {
    const found = await this.blob.get(pathOf(room));
    return found ? await new Response(found.stream).json().catch(() => []) : [];
  }
  async list(room: LogRoom, now: number, needs?: NeedsFilter): Promise<LoggedTurn[]> {
    return newestFirst(keepTurns(await this.load(room), now), needs);
  }
  /** Rewrites a room's file from what is there now; the ETag check means a write that lost the race tries again. */
  private async change<T>(room: LogRoom, now: number, fn: (turns: LoggedTurn[]) => { turns: LoggedTurn[] | null; out: T }): Promise<T> {
    const path = pathOf(room);
    for (let attempt = 0; ; attempt++) {
      const etag = await this.blob.etag(path);
      const { turns, out } = fn(keepTurns(etag ? await this.load(room) : [], now));
      if (!turns) return out;
      try {
        await this.blob.put(path, JSON.stringify(keepTurns(turns, now)), {
          contentType: "application/json",
          addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return out;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
  }
  async add(turn: Omit<LoggedTurn, "id"> & { id?: string }, now: number): Promise<void> {
    const good = cleanTurn(turn);
    if (!good) return;
    await this.change(good.room, now, (cur) => ({ turns: [...cur, good], out: undefined }));
  }
  async answer(id: string, followUp: FollowUp, now: number): Promise<Answered> {
    const f = cleanFollowUp(followUp);
    if (!f || !isTurnId(id)) return { ok: false, why: "missing" };
    for (const room of LOG_ROOMS) {
      const result = await this.change(room, now, (cur) => {
        const r = withFollowUp(cur, id, f);
        return { turns: r.result.ok ? r.turns : null, out: r.result };
      });
      if (result.ok || result.why !== "missing") return result;
    }
    return { ok: false, why: "missing" };
  }
}

/** In memory, for tests. */
export class MemoryRoomLog implements RoomLog {
  rooms: Partial<Record<LogRoom, unknown[]>> = {};
  async list(room: LogRoom, now: number, needs?: NeedsFilter): Promise<LoggedTurn[]> {
    return newestFirst(keepTurns(structuredClone(this.rooms[room] ?? []), now), needs);
  }
  async add(turn: Omit<LoggedTurn, "id"> & { id?: string }, now: number): Promise<void> {
    const good = cleanTurn(turn);
    if (good) this.rooms[good.room] = keepTurns([...(this.rooms[good.room] ?? []), good], now);
  }
  async answer(id: string, followUp: FollowUp, now: number): Promise<Answered> {
    const f = cleanFollowUp(followUp);
    if (!f) return { ok: false, why: "missing" };
    for (const room of LOG_ROOMS) {
      const r = withFollowUp(keepTurns(this.rooms[room] ?? [], now), id, f);
      if (r.result.ok) this.rooms[room] = r.turns;
      if (r.result.ok || r.result.why !== "missing") return r.result;
    }
    return { ok: false, why: "missing" };
  }
}
