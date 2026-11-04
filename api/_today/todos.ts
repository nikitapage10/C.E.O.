/**
 * Nikita's own to-dos on Today, and what they said back to the things held for them (#622): the shapes, how two
 * devices' changes merge, what is due, and the counts the public may see. Kept in the private blob store
 * (`desk/today/todos.json`, the `ceo-state` container on Azure) behind the Desk's passkey, so it follows Nikita from the
 * PC to the phone. The public site and the Lattice get counts only, never a word of a to-do or a note (publicCounts).
 *
 * Pure, so the browser imports it too; the stores are next door (./store.ts). Underscore folder: never served as a
 * function.
 */

import { TEXT_MAX } from "./parse.js";

/** One to-do of Nikita's own. Times are ISO. */
export interface Todo {
  id: string;
  text: string;
  /** When it was added, and last changed (a merge keeps the newer). */
  at: string;
  updated: string;
  /** When it is due: it rises to the top of Today then, and pings Nikita's phone. */
  due?: string;
  /** Snoozed: out of the list until then. */
  until?: string;
  notes?: string[];
  /** When it was done (or dismissed). */
  done?: string;
  /** When its reminder pinged, so it pings once. */
  pinged?: string;
  /** The held thing it was made from (a Today row's key), when it was one. */
  from?: string;
}

/** What Nikita said back to a held thing that isn't theirs (a decision, a reply, Rivet's question), by its row key. */
export interface Mark {
  ref: string;
  updated: string;
  until?: string;
  remind?: string;
  notes?: string[];
  done?: string;
  pinged?: string;
}

export interface TodoState {
  todos: Todo[];
  marks: Mark[];
}

export const TODO_STORE_PATH = "desk/today/todos.json";
/** The most kept: open to-dos and marks; a done to-do stays a week (for Undo and the other device), a mark 30 days. */
export const TODO_MAX = 100;
export const MARK_MAX = 100;
export const NOTES_MAX = 6;
const DONE_KEEP_MS = 7 * 24 * 3_600_000;
const MARK_KEEP_MS = 30 * 24 * 3_600_000;

export const isTodoId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{6,40}$/.test(v);
/** A Today row's key: a room's action id, "q123", "email", "setup", "ideas" and the like. */
export const isRef = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_.-]{1,80}$/.test(v);
const line = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX) : "");
const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : "");
const notesOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(line).filter(Boolean).slice(-NOTES_MAX) : []);

/** A to-do as sent or stored, checked: null when it isn't one. */
export function cleanTodo(v: unknown): Todo | null {
  const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const text = line(t.text);
  const at = iso(t.at);
  const updated = iso(t.updated) || at;
  if (!isTodoId(t.id) || !text || !at) return null;
  const notes = notesOf(t.notes);
  const opt = { due: iso(t.due), until: iso(t.until), done: iso(t.done), pinged: iso(t.pinged) };
  return {
    id: t.id,
    text,
    at,
    updated,
    ...Object.fromEntries(Object.entries(opt).filter(([, x]) => x)),
    ...(notes.length && { notes }),
    ...(isRef(t.from) && { from: t.from }),
  };
}

export function cleanMark(v: unknown): Mark | null {
  const m = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const updated = iso(m.updated);
  if (!isRef(m.ref) || !updated) return null;
  const notes = notesOf(m.notes);
  const opt = { until: iso(m.until), remind: iso(m.remind), done: iso(m.done), pinged: iso(m.pinged) };
  return { ref: m.ref, updated, ...Object.fromEntries(Object.entries(opt).filter(([, x]) => x)), ...(notes.length && { notes }) };
}

const ms = (s: string | undefined) => (s ? Date.parse(s) : NaN);

/** The state, checked and trimmed: done to-dos a week, marks 30 days, newest kept. */
export function keepState(raw: unknown, now: number): TodoState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const todos = (Array.isArray(r.todos) ? r.todos : [])
    .map(cleanTodo)
    .filter((t): t is Todo => t !== null && !(t.done && now - ms(t.done) > DONE_KEEP_MS))
    .sort((a, b) => ms(a.at) - ms(b.at))
    .slice(-TODO_MAX);
  const marks = (Array.isArray(r.marks) ? r.marks : [])
    .map(cleanMark)
    .filter((m): m is Mark => m !== null && now - ms(m.updated) <= MARK_KEEP_MS)
    .sort((a, b) => ms(a.updated) - ms(b.updated))
    .slice(-MARK_MAX);
  const seen = new Set<string>();
  return { todos: todos.filter((t) => !seen.has(t.id) && seen.add(t.id)), marks: marks.filter((m) => !seen.has(`m:${m.ref}`) && seen.add(`m:${m.ref}`)) };
}

export interface Changes {
  todos?: unknown[];
  marks?: unknown[];
  /** To-do ids to remove outright (Undo of an add). */
  drop?: unknown[];
}

/**
 * Two devices' changes, merged: each to-do or mark sent replaces the stored one unless the stored one is newer, and a
 * dropped id goes. A change from the future (a skewed clock) is pulled back to now.
 */
export function mergeState(state: TodoState, changes: Changes, now: number): TodoState {
  const cap = (s: string) => (ms(s) > now + 60_000 ? new Date(now).toISOString() : s);
  const todos = new Map(state.todos.map((t) => [t.id, t]));
  for (const raw of (changes.todos ?? []).slice(0, TODO_MAX)) {
    const t = cleanTodo(raw);
    if (!t) continue;
    const had = todos.get(t.id);
    if (had && ms(had.updated) > ms(t.updated)) continue;
    // A reminder that has pinged stays pinged unless its time moved.
    const pinged = had?.pinged && had.due === t.due ? had.pinged : undefined;
    const { pinged: _p, ...rest } = t;
    todos.set(t.id, { ...rest, updated: cap(t.updated), ...(pinged && { pinged }) });
  }
  for (const id of (changes.drop ?? []).slice(0, TODO_MAX)) if (isTodoId(id)) todos.delete(id);
  const marks = new Map(state.marks.map((m) => [m.ref, m]));
  for (const raw of (changes.marks ?? []).slice(0, MARK_MAX)) {
    const m = cleanMark(raw);
    if (!m) continue;
    const had = marks.get(m.ref);
    if (had && ms(had.updated) > ms(m.updated)) continue;
    const pinged = had?.pinged && had.remind === m.remind ? had.pinged : undefined;
    const { pinged: _p, ...rest } = m;
    marks.set(m.ref, { ...rest, updated: cap(m.updated), ...(pinged && { pinged }) });
  }
  return keepState({ todos: [...todos.values()], marks: [...marks.values()] }, now);
}

/** Still in play: not done, and not snoozed past now. */
export const isOpen = (t: Pick<Todo, "done" | "until">, now: number) => !t.done && !(t.until && ms(t.until) > now);

/** The reminders due now that haven't pinged: to-dos past their due time, marks past their remind time. */
export function dueReminders(state: TodoState, now: number): { todos: string[]; marks: string[] } {
  return {
    todos: state.todos.filter((t) => isOpen(t, now) && t.due && ms(t.due) <= now && !t.pinged).map((t) => t.id),
    marks: state.marks.filter((m) => !m.done && m.remind && ms(m.remind) <= now && !m.pinged).map((m) => m.ref),
  };
}

/** The state with those reminders marked pinged. */
export function markPinged(state: TodoState, due: { todos: string[]; marks: string[] }, now: number): TodoState {
  const at = new Date(now).toISOString();
  const t = new Set(due.todos);
  const m = new Set(due.marks);
  return {
    todos: state.todos.map((x) => (t.has(x.id) ? { ...x, pinged: at } : x)),
    marks: state.marks.map((x) => (m.has(x.ref) ? { ...x, pinged: at } : x)),
  };
}

/** What the public site and the Lattice may know: three numbers. No text, no times, no ids. */
export interface PublicCounts {
  open: number;
  due: number;
  snoozed: number;
}

export function publicCounts(state: TodoState, now: number): PublicCounts {
  const open = state.todos.filter((t) => isOpen(t, now));
  return {
    open: open.length,
    due: open.filter((t) => t.due && ms(t.due) <= now).length,
    snoozed: state.todos.filter((t) => !t.done && t.until && ms(t.until) > now).length + state.marks.filter((m) => !m.done && m.until && ms(m.until) > now).length,
  };
}
