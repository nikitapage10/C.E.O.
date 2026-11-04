/**
 * Where "Hey Skippy" puts a to-do (#627): "remind me to call the dermatologist tomorrow".
 *
 * TODO(#622): Today's own voice to-dos (#622, "Today: your own to-dos by voice") are being built beside this, and
 * hadn't merged when this shipped. Until they do, phone to-dos wait here, in their own file
 * (`haven/phone-todos.json`, private blob store, a name #622's store doesn't use), behind this one small interface.
 * When #622 lands, swap `PhoneTodos` for its store (keep `addTodo`'s shape) and move anything still open in this file
 * across once. The Desk shows only the count meanwhile.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { readJson, updateJson } from "./json.js";

export const TODOS_PATH = "haven/phone-todos.json";
export const TODO_MAX = 200;
export const TODO_TEXT_MAX = 300;

export interface PhoneTodo {
  id: string;
  text: string;
  addedAt: string;
  source: "phone";
  done: boolean;
}

/** The one thing capture needs from a to-do store. */
export interface TodoSink {
  addTodo(text: string, now: number): Promise<PhoneTodo>;
  openCount(): Promise<number>;
}

const clean = (raw: unknown): PhoneTodo[] =>
  (Array.isArray(raw) ? raw : []).filter((t): t is PhoneTodo => !!t && typeof t === "object" && typeof (t as PhoneTodo).id === "string" && typeof (t as PhoneTodo).text === "string").slice(-TODO_MAX);

/** The adapter's own store (see the TODO above). */
export class PhoneTodos implements TodoSink {
  constructor(private readonly blob: BlobBackend) {}
  async addTodo(text: string, now: number): Promise<PhoneTodo> {
    const todo: PhoneTodo = { id: randomBytes(6).toString("hex"), text: text.replace(/\s+/g, " ").trim().slice(0, TODO_TEXT_MAX), addedAt: new Date(now).toISOString(), source: "phone", done: false };
    return updateJson(this.blob, TODOS_PATH, [] as unknown, (raw) => ({ next: [...clean(raw), todo].slice(-TODO_MAX), result: todo }));
  }
  async openCount(): Promise<number> {
    return clean(await readJson(this.blob, TODOS_PATH, [])).filter((t) => !t.done).length;
  }
}
