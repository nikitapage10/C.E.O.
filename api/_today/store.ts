/**
 * Where Today's to-dos live (#622): the private blob store, `desk/today/todos.json` (./todos.ts has the shapes). Kept
 * apart from the shapes so the browser, which imports those, never carries the blob client.
 *
 * Underscore folder: never served as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";
import { keepState, TODO_STORE_PATH, type TodoState } from "./todos.js";

type Change<T> = (state: TodoState) => { state: TodoState | null; out: T };

export interface TodoStore {
  load(now: number): Promise<TodoState>;
  change<T>(now: number, fn: Change<T>): Promise<T>;
}

/** In the private blob store; a write checks the ETag, so two devices saving at once both land. */
export class BlobTodoStore implements TodoStore {
  constructor(private readonly blob: BlobBackend) {}
  private async raw(): Promise<unknown> {
    const found = await this.blob.get(TODO_STORE_PATH);
    return found ? await new Response(found.stream).json().catch(() => ({})) : {};
  }
  async load(now: number): Promise<TodoState> {
    return keepState(await this.raw(), now);
  }
  async change<T>(now: number, fn: Change<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const etag = await this.blob.etag(TODO_STORE_PATH);
      const { state, out } = fn(keepState(etag ? await this.raw() : {}, now));
      if (!state) return out;
      try {
        await this.blob.put(TODO_STORE_PATH, JSON.stringify(keepState(state, now)), {
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
}

/** In memory, for tests. */
export class MemoryTodoStore implements TodoStore {
  raw: unknown = {};
  async load(now: number): Promise<TodoState> {
    return keepState(structuredClone(this.raw), now);
  }
  async change<T>(now: number, fn: Change<T>): Promise<T> {
    const { state, out } = fn(keepState(structuredClone(this.raw), now));
    if (state) this.raw = keepState(state, now);
    return out;
  }
}
