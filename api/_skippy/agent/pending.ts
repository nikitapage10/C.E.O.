/**
 * Tool calls that wait for Nikita's Yes tap (#646): anything that sends, spends or deletes, and the writes that ask
 * for it (a saved memory, a home device). The agent or a room's voice hook asks; the call is kept here with exactly
 * the input it will run with, and only `POST /api/skippy-act { confirm, yes }` in a passkey session runs it, once.
 *
 * Kept in the private blob store (`desk/skippy/pending.json`) for PENDING_MS at most, PENDING_MAX at a time, each
 * taken at most once (an ETag-checked write removes it before it runs). A random id: nothing in a reply or a page can
 * guess one, and an id that was never issued here runs nothing.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../../_blob.js";
import { readJson, updateJson } from "../../_haven/json.js";

export const PENDING_PATH = "desk/skippy/pending.json";
/** How long a Yes button stays good: fifteen minutes. */
export const PENDING_MS = 15 * 60_000;
export const PENDING_MAX = 20;

export interface Pending {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  label: string;
  summary: string;
  at: number;
}

export const isPendingId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{20}$/.test(v);

const live = (list: unknown, now: number): Pending[] =>
  (Array.isArray(list) ? (list as Pending[]) : []).filter((p) => p && isPendingId(p.id) && typeof p.tool === "string" && typeof p.at === "number" && now - p.at < PENDING_MS && p.at <= now + 60_000);

export interface PendingStore {
  add(p: Omit<Pending, "id" | "at">, now: number): Promise<Pending>;
  /** Removes and returns the call, or null when it is unknown, used or too old. */
  take(id: string, now: number): Promise<Pending | null>;
}

export class BlobPending implements PendingStore {
  constructor(private readonly blob: BlobBackend) {}
  async add(p: Omit<Pending, "id" | "at">, now: number): Promise<Pending> {
    const made: Pending = { ...p, id: randomBytes(10).toString("hex"), at: now };
    await updateJson<unknown, null>(this.blob, PENDING_PATH, [], (cur) => ({ next: [...live(cur, now), made].slice(-PENDING_MAX), result: null }));
    return made;
  }
  async take(id: string, now: number): Promise<Pending | null> {
    if (!isPendingId(id)) return null;
    return updateJson<unknown, Pending | null>(this.blob, PENDING_PATH, [], (cur) => {
      const list = live(cur, now);
      const found = list.find((p) => p.id === id) ?? null;
      return { next: found ? list.filter((p) => p !== found) : null, result: found };
    });
  }
  /** For the Desk's own reads (tests): what is waiting now. */
  async list(now: number): Promise<Pending[]> {
    return live(await readJson<unknown>(this.blob, PENDING_PATH, []), now);
  }
}

export class MemoryPending implements PendingStore {
  items: Pending[] = [];
  async add(p: Omit<Pending, "id" | "at">, now: number): Promise<Pending> {
    const made: Pending = { ...p, id: randomBytes(10).toString("hex"), at: now };
    this.items = [...live(this.items, now), made].slice(-PENDING_MAX);
    return made;
  }
  async take(id: string, now: number): Promise<Pending | null> {
    const list = live(this.items, now);
    const found = list.find((p) => p.id === id) ?? null;
    this.items = found ? list.filter((p) => p !== found) : list;
    return found;
  }
}
