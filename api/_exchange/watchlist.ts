/**
 * The Exchange's watchlist (#240): the Polymarket market ids Nikita pinned, kept in the private Blob store beside the
 * Desk's other settings (desk/exchange/watchlist.json). Market ids only: public numbers, nothing personal.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { ID } from "./polymarket.js";
import { PM_WATCH_MAX } from "./types.js";

export const WATCH_PATH = "desk/exchange/watchlist.json";

export interface WatchStore {
  read(): Promise<string[]>;
  write(ids: string[]): Promise<void>;
}

/** Only well-formed ids, no repeats, at most PM_WATCH_MAX. */
export function cleanIds(v: unknown): string[] {
  const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ID.test(x)) : [];
  return [...new Set(ids)].slice(0, PM_WATCH_MAX);
}

export class BlobWatchStore implements WatchStore {
  constructor(private readonly blob: BlobBackend) {}
  async read(): Promise<string[]> {
    const found = await this.blob.get(WATCH_PATH);
    if (!found) return [];
    const got = (await new Response(found.stream).json().catch(() => null)) as { ids?: unknown } | null;
    return cleanIds(got?.ids);
  }
  async write(ids: string[]): Promise<void> {
    await this.blob.put(WATCH_PATH, JSON.stringify({ ids: cleanIds(ids) }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  }
}

export class MemoryWatchStore implements WatchStore {
  ids: string[] = [];
  async read(): Promise<string[]> {
    return [...this.ids];
  }
  async write(ids: string[]): Promise<void> {
    this.ids = cleanIds(ids);
  }
}

export function pickWatchStore(env: Record<string, string | undefined> = process.env): WatchStore | null {
  const blob = pickBlob(env);
  return blob ? new BlobWatchStore(blob) : null;
}
