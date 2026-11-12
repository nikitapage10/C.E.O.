/**
 * Where "Hey Skippy" puts a to-do (#627): "remind me to call the dermatologist tomorrow". It lands in Today's own
 * to-do store (#622, api/_today/store.ts), so it shows in the Haven's To-dos panel (#1056) with the same snooze, remind and done, and
 * a time it names ("tomorrow", "Friday at 3") is read with Today's own rules (api/_today/parse.ts).
 *
 * Phone to-dos used to wait in `haven/phone-todos.json`. The first read or add carries anything still open in that file
 * across (once, by id) and deletes it; nothing writes to it any more.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../_blob.js";
import { readCapture } from "../_today/parse.js";
import { BlobTodoStore, type TodoStore } from "../_today/store.js";
import { isOpen, type Todo } from "../_today/todos.js";
import { readJson } from "./json.js";

/** The old adapter's file, read once to migrate and then removed. */
export const LEGACY_PATH = "haven/phone-todos.json";

/** A to-do as capture needs it back: its words and, when it named one, its due time (ISO). */
export interface AddedTodo {
  text: string;
  due?: string;
}

/** The one thing capture needs from a to-do store. */
export interface TodoSink {
  addTodo(text: string, now: number): Promise<AddedTodo>;
  openCount(now?: number): Promise<number>;
  /** Takes back the phone's latest to-do, kept in the last ten minutes, and gives its words (#641); null if none. */
  takeBackLast?(now: number): Promise<string | null>;
}

/** How recent a phone to-do must be to be taken back by "not as a task". */
export const TAKE_BACK_MS = 10 * 60_000;

interface Legacy {
  id: string;
  text: string;
  addedAt?: string;
  done?: boolean;
}

const legacyOf = (raw: unknown): Legacy[] =>
  (Array.isArray(raw) ? raw : []).filter((t): t is Legacy => !!t && typeof t === "object" && typeof (t as Legacy).id === "string" && /^[a-z0-9]{4,30}$/.test((t as Legacy).id) && typeof (t as Legacy).text === "string");

/** Today's own words for a line: its text and due time. */
function read(text: string, now: number): { text: string; due?: number } {
  const got = readCapture(text, now);
  if (got && got.kind === "add") return { text: got.text, ...(got.due !== undefined && { due: got.due }) };
  return { text: text.replace(/\s+/g, " ").trim() };
}

/** Phone to-dos in Today's store. */
export class PhoneTodos implements TodoSink {
  private readonly store: TodoStore;
  constructor(private readonly blob: BlobBackend, store?: TodoStore) {
    this.store = store ?? new BlobTodoStore(blob);
  }

  /** Moves the old file's open items into Today's store, then deletes it. Safe to run twice: ids carry across. */
  private async migrate(now: number): Promise<void> {
    if (!(await this.blob.etag(LEGACY_PATH))) return;
    const open = legacyOf(await readJson(this.blob, LEGACY_PATH, [])).filter((t) => !t.done);
    if (open.length) {
      await this.store.change(now, (state) => {
        const have = new Set(state.todos.map((t) => t.id));
        const moved: Todo[] = open
          .filter((t) => !have.has(`phone-${t.id}`))
          .map((t) => {
            const said = read(t.text, now);
            const at = Number.isFinite(Date.parse(t.addedAt ?? "")) ? new Date(Date.parse(t.addedAt ?? "")).toISOString() : new Date(now).toISOString();
            return { id: `phone-${t.id}`, text: said.text, at, updated: at, ...(said.due !== undefined && { due: new Date(said.due).toISOString() }) };
          });
        return moved.length ? { state: { ...state, todos: [...state.todos, ...moved] }, out: undefined } : { state: null, out: undefined };
      });
    }
    await this.blob.del(LEGACY_PATH);
  }

  async addTodo(text: string, now: number): Promise<AddedTodo> {
    await this.migrate(now).catch(() => undefined);
    const said = read(text, now);
    const at = new Date(now).toISOString();
    const id = `phone-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const todo: Todo = { id, text: said.text, at, updated: at, ...(said.due !== undefined && { due: new Date(said.due).toISOString() }) };
    await this.store.change(now, (state) => ({ state: { ...state, todos: [...state.todos, todo] }, out: undefined }));
    return { text: todo.text, ...(todo.due && { due: todo.due }) };
  }

  async takeBackLast(now: number): Promise<string | null> {
    return this.store.change(now, (state) => {
      const mine = state.todos.filter((t) => t.id.startsWith("phone-") && now - Date.parse(t.at) <= TAKE_BACK_MS && now >= Date.parse(t.at) - 60_000);
      const last = mine.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      if (!last) return { state: null, out: null };
      return { state: { ...state, todos: state.todos.filter((t) => t.id !== last.id) }, out: last.text };
    });
  }

  async openCount(now = Date.now()): Promise<number> {
    await this.migrate(now).catch(() => undefined);
    return (await this.store.load(now)).todos.filter((t) => isOpen(t, now)).length;
  }
}
