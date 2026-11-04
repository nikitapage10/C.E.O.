/**
 * Today's reminders as the Desk's pings (#622): the hourly ping scan (api/desk-pings.ts) asks how many of Nikita's
 * reminders have come due, and this marks them pinged in the same write, so each pings once. The ping says only that
 * one is due, never what it says: it can show on a lock screen. The Desk shows the reminder itself at the top of Today.
 *
 * Underscore folder: never served as a function.
 */

import { pickBlob } from "../_blob.js";
import type { PingText } from "../_desk/pings.js";
import { BlobTodoStore, type TodoStore } from "./store.js";
import { dueReminders, markPinged } from "./todos.js";

export const REMINDER_PING: PingText = { title: "C.E.O. Desk", body: "A reminder you set on Today is due.", url: "/" };

/** Marks the due reminders pinged and says how many there were. */
export async function remindDue(store: TodoStore, now: number): Promise<number> {
  return store.change(now, (state) => {
    const due = dueReminders(state, now);
    const n = due.todos.length + due.marks.length;
    return { state: n ? markPinged(state, due, now) : null, out: n };
  });
}

/** The live check, with the private blob store; undefined without one. */
export function todayReminders(env: Record<string, string | undefined> = process.env): (() => Promise<number>) | undefined {
  const blob = pickBlob(env);
  if (!blob) return undefined;
  const store = new BlobTodoStore(blob);
  return () => remindDue(store, Date.now());
}
