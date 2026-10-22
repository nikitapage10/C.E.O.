/**
 * Where the Green keeps its slow reads (#252): Sleeper's players list (about 15 MB, trimmed to a few hundred kB, at
 * most once a day) and FantasyPros' answer (at most every six hours, so its daily allowance is never in doubt), in the
 * private Blob store beside the Desk's other files (desk/green/…), so every instance shares one read. Public football
 * data only: player names, teams, ranks and projections. Never the key.
 *
 * Without a store (a local run) the copies live in the instance's memory only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";

export const PLAYERS_PATH = "desk/green/players.json";
export const FP_PATH = "desk/green/fantasypros.json";
/** Sleeper's NFL schedule, trimmed to who plays each week (for the byes), read at most once a day. */
export const SCHEDULE_PATH = "desk/green/schedule.json";

export interface Kept<T> {
  /** When it was read (ms). */
  at: number;
  /** What it was read for (a season and week, for FantasyPros), so a new week reads afresh. */
  tag: string;
  value: T;
}

export interface GreenStore {
  read<T>(path: string): Promise<Kept<T> | null>;
  write<T>(path: string, kept: Kept<T>): Promise<void>;
}

export class BlobGreenStore implements GreenStore {
  constructor(private readonly blob: BlobBackend) {}
  async read<T>(path: string): Promise<Kept<T> | null> {
    const found = await this.blob.get(path);
    if (!found) return null;
    const got = (await new Response(found.stream).json().catch(() => null)) as Kept<T> | null;
    return got && typeof got.at === "number" && typeof got.tag === "string" && got.value !== undefined ? got : null;
  }
  async write<T>(path: string, kept: Kept<T>): Promise<void> {
    await this.blob.put(path, JSON.stringify(kept), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  }
}

export class MemoryGreenStore implements GreenStore {
  files = new Map<string, string>();
  async read<T>(path: string): Promise<Kept<T> | null> {
    const s = this.files.get(path);
    return s ? (JSON.parse(s) as Kept<T>) : null;
  }
  async write<T>(path: string, kept: Kept<T>): Promise<void> {
    this.files.set(path, JSON.stringify(kept));
  }
}

export function pickGreenStore(env: Record<string, string | undefined> = process.env): GreenStore | null {
  const blob = pickBlob(env);
  return blob ? new BlobGreenStore(blob) : null;
}

const memory = new Map<string, Kept<unknown>>();

/** For tests: forget what this instance kept. */
export function forgetMemory(): void {
  memory.clear();
}

/**
 * The kept copy when it is younger than `ttlMs` and was read for `tag`; else a fresh read, saved for everyone. When the
 * read fails, a copy up to `staleMs` old (any tag) stands in, marked stale.
 */
export async function keptOrRead<T>(store: GreenStore | null, path: string, tag: string, ttlMs: number, staleMs: number, now: number, read: () => Promise<T>): Promise<{ value: T; at: number; stale: boolean }> {
  const fresh = (k: Kept<unknown> | null | undefined): k is Kept<T> => !!k && k.tag === tag && now - k.at < ttlMs && now >= k.at - 60_000;
  const mem = memory.get(path);
  if (fresh(mem)) return { value: mem.value, at: mem.at, stale: false };
  const saved = store ? await store.read<T>(path).catch(() => null) : null;
  if (fresh(saved)) {
    memory.set(path, saved);
    return { value: saved.value, at: saved.at, stale: false };
  }
  try {
    const value = await read();
    const kept: Kept<T> = { at: now, tag, value };
    memory.set(path, kept);
    if (store) await store.write(path, kept).catch(() => undefined);
    return { value, at: now, stale: false };
  } catch (e) {
    const old = [mem, saved].filter((k): k is Kept<T> => !!k && now - k.at < staleMs).sort((a, b) => b.at - a.at)[0];
    if (old) return { value: old.value, at: old.at, stale: true };
    throw e;
  }
}
