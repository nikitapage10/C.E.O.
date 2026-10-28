import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Relay's own database on the Mac (docs/RELAY-PRIVACY.md, "Data inventory"): one JSON file,
 * `~/Library/Application Support/CEO Relay/relay.json`, mode 0600, rewritten whole on every change (a temp file and a
 * rename), so a deleted row never lingers in free pages. It holds, per thread, a random Relay id, the Messages chat id,
 * the times, the state and Dialtone's sort; Relay's own outputs (drafts, group summaries, the later times); daily
 * counts; the ids of Desk requests already acted on. **Never a message body, a name or a handle of its own** (the chat id carries the handle,
 * which is why it never leaves this file: not in a log, a status or a model call).
 */

export type ThreadState = "owed" | "later" | "settled" | "replied";
/** Why a thread needs nothing, from a closed list (never words from a message). */
export type SettledWhy = "group" | "code" | "short-code" | "promo" | "money" | "skip" | "no-reply" | "done";
export type Sort = "sooner" | "normal";

export interface Draft {
  text: string;
  at: number;
  /** "blasto" or "restyled" (from Nikita's dictation on the Desk). */
  by: "blasto" | "restyled";
}

export interface GroupSummary {
  text: string;
  asked: boolean;
  at: number;
}

export interface Thread {
  /** Relay's own random id: the only id the Desk, a log or a count ever sees. */
  id: string;
  /** The Messages chat id (BlueBubbles' chat guid). Holds the handle: this file only. */
  chat: string;
  group: boolean;
  state: ThreadState;
  why: SettledWhy | null;
  /** The first message Nikita hasn't answered (ms). */
  since: number;
  /** The latest inbound message (ms). */
  lastIn: number;
  sort: Sort | null;
  /** Dialtone's one line on what they want (the model's words, names put back for the Desk). */
  gist: string;
  sortedAt: number | null;
  laterUntil: number | null;
  laterSet: number | null;
  draft: Draft | null;
  summary: GroupSummary | null;
  repliedAt: number | null;
}

export interface Day {
  /** Local midnight (ms). */
  day: number;
  sent: number;
  /** Minutes to reply, one per reply that answered an owed thread (200 at most). */
  minutes: number[];
}

/** One recipient a new text could go to (#536): the handle stays in this file, the Desk sees only its mask. */
export interface CardTarget {
  /** The hub's own random id for it, when it is one of several choices (8 hex). */
  pick: string;
  name: string;
  handle: string;
  /** The Messages chat id the text goes to (holds the handle: this file only). */
  chat: string;
  channel: "iMessage" | "SMS";
  /** A new chat this card starts (an address or a +country number Messages has no chat with yet). */
  fresh?: true;
}

/**
 * A new text Skippy asked for (#536): who it goes to, Blasto's text, or the choices when a name fits several. Kept a
 * day at most (CARD_KEEP_MS); a send clears its text.
 */
export interface Card {
  /** The compose request's thread id (made by the site): sends bind to it. */
  id: string;
  state: "ready" | "choices" | "none" | "off" | "nochat" | "moved" | "sent";
  /** The contact's name; for "none", what was asked. */
  name: string;
  target: CardTarget | null;
  choices: CardTarget[];
  draft: { text: string; at: number } | null;
  at: number;
}

export interface RelayState {
  v: 1;
  paused: boolean;
  threads: Thread[];
  /** New texts Skippy asked for (#536). */
  cards: Card[];
  days: Day[];
  streak: { days: number; lastDay: number | null };
  /** Desk requests already acted on (their ids and when), a day at most: a replayed request is refused. */
  seen: { rid: string; at: number }[];
  /** When the hourly sweep last ran. */
  sweptAt: number | null;
}

export const emptyState = (): RelayState => ({ v: 1, paused: false, threads: [], cards: [], days: [], streak: { days: 0, lastDay: null }, seen: [], sweptAt: null });

export const newThreadId = () => randomBytes(8).toString("hex");

const STATES: ThreadState[] = ["owed", "later", "settled", "replied"];
const WHYS: SettledWhy[] = ["group", "code", "short-code", "promo", "money", "skip", "no-reply", "done"];
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

function readThread(v: unknown): Thread | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const id = s(o.id, 32);
  const chat = s(o.chat, 300);
  const since = n(o.since);
  const lastIn = n(o.lastIn);
  if (!id || !/^[0-9a-f]{16}$/.test(id) || !chat || since === null || lastIn === null || !STATES.includes(o.state as ThreadState)) return null;
  const d = o.draft as Record<string, unknown> | null;
  const g = o.summary as Record<string, unknown> | null;
  return {
    id,
    chat,
    group: o.group === true,
    state: o.state as ThreadState,
    why: WHYS.includes(o.why as SettledWhy) ? (o.why as SettledWhy) : null,
    since,
    lastIn,
    sort: o.sort === "sooner" || o.sort === "normal" ? o.sort : null,
    gist: s(o.gist, 200) ?? "",
    sortedAt: n(o.sortedAt),
    laterUntil: n(o.laterUntil),
    laterSet: n(o.laterSet),
    draft: d && s(d.text, 2_000) !== null && n(d.at) !== null ? { text: d.text as string, at: d.at as number, by: d.by === "restyled" ? "restyled" : "blasto" } : null,
    summary: g && s(g.text, 400) !== null && n(g.at) !== null ? { text: g.text as string, asked: g.asked === true, at: g.at as number } : null,
    repliedAt: n(o.repliedAt),
  };
}

const CARD_STATES: Card["state"][] = ["ready", "choices", "none", "off", "nochat", "moved", "sent"];

function readTarget(v: unknown): CardTarget | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const pick = s(o.pick, 8);
  const name = s(o.name, 80);
  const handle = s(o.handle, 200);
  const chat = s(o.chat, 300);
  if (pick === null || !/^(?:[0-9a-f]{8})?$/.test(pick) || !name || !handle || !chat || (o.channel !== "iMessage" && o.channel !== "SMS")) return null;
  return { pick, name, handle, chat, channel: o.channel, ...(o.fresh === true && { fresh: true as const }) };
}

function readCard(v: unknown): Card | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const id = s(o.id, 16);
  const name = s(o.name, 80);
  const at = n(o.at);
  if (!id || !/^[0-9a-f]{16}$/.test(id) || !name || at === null || !CARD_STATES.includes(o.state as Card["state"])) return null;
  const d = o.draft as Record<string, unknown> | null;
  return {
    id,
    state: o.state as Card["state"],
    name,
    target: o.target ? readTarget(o.target) : null,
    choices: Array.isArray(o.choices) ? o.choices.map(readTarget).filter((t): t is CardTarget => t !== null).slice(0, 6) : [],
    draft: d && s(d.text, 2_000) !== null && n(d.at) !== null ? { text: d.text as string, at: d.at as number } : null,
    at,
  };
}

/** The state from the file's text, each row checked; a bad row is dropped, a bad file is a fresh state. */
export function readState(raw: string | null): RelayState {
  let o: Record<string, unknown>;
  try {
    o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return emptyState();
  }
  if (!o || o.v !== 1) return emptyState();
  const days = Array.isArray(o.days)
    ? o.days.flatMap((d: Record<string, unknown>) => (n(d?.day) !== null && n(d?.sent) !== null && Array.isArray(d.minutes) ? [{ day: d.day as number, sent: d.sent as number, minutes: (d.minutes as unknown[]).filter((m): m is number => typeof m === "number" && Number.isFinite(m)).slice(0, 200) }] : []))
    : [];
  const streak = o.streak as Record<string, unknown> | undefined;
  return {
    v: 1,
    paused: o.paused === true,
    threads: Array.isArray(o.threads) ? o.threads.map(readThread).filter((t): t is Thread => t !== null) : [],
    cards: Array.isArray(o.cards) ? o.cards.map(readCard).filter((c): c is Card => c !== null).slice(-20) : [],
    days,
    streak: { days: n(streak?.days) ?? 0, lastDay: n(streak?.lastDay) },
    seen: Array.isArray(o.seen) ? (o.seen as Record<string, unknown>[]).flatMap((e) => (typeof e?.rid === "string" && /^[0-9a-f]{24}$/.test(e.rid) && n(e.at) !== null ? [{ rid: e.rid, at: e.at as number }] : [])).slice(-500) : [],
    sweptAt: n(o.sweptAt),
  };
}

export interface StateStore {
  load(): RelayState;
  save(state: RelayState): void;
}

/** The file on the Mac. */
export function fileStore(path: string): StateStore {
  return {
    load: () => {
      try {
        return readState(readFileSync(path, "utf8"));
      } catch {
        return emptyState();
      }
    },
    save: (state) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      renameSync(tmp, path);
    },
  };
}

/** For tests. */
export function memoryStore(initial: RelayState = emptyState()): StateStore & { saved: string[] } {
  let json = JSON.stringify(initial);
  const saved: string[] = [];
  return {
    saved,
    load: () => readState(json),
    save: (state) => {
      json = JSON.stringify(state);
      saved.push(json);
    },
  };
}
