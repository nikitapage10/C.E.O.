/**
 * The Keys form's trail (#330): which key was set from the Desk, and when. The name and the time only, never the
 * value, its length or any part of it. Kept in the private store (`desk/keys/trail.json`, the last 100), beside the
 * passkeys, so the Desk can say when each key was last set from here.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";

export interface TrailEntry {
  /** The Key Vault secret's name (always one from the allowlist). */
  name: string;
  /** When it was set (ms). */
  at: number;
}

export interface KeyTrail {
  list(): Promise<TrailEntry[]>;
  add(entry: TrailEntry): Promise<void>;
}

const PATH = "desk/keys/trail.json";
export const TRAIL_MAX = 100;

const clean = (list: unknown): TrailEntry[] =>
  Array.isArray(list) ? list.filter((e): e is TrailEntry => Boolean(e) && typeof e.name === "string" && typeof e.at === "number").map((e) => ({ name: e.name, at: e.at })) : [];

export class BlobKeyTrail implements KeyTrail {
  constructor(private readonly blob: BlobBackend) {}
  async list(): Promise<TrailEntry[]> {
    const found = await this.blob.get(PATH);
    if (!found) return [];
    const got = (await new Response(found.stream).json().catch(() => null)) as { entries?: unknown } | null;
    return clean(got?.entries);
  }
  async add(entry: TrailEntry): Promise<void> {
    const entries = [{ name: entry.name, at: entry.at }, ...(await this.list())].slice(0, TRAIL_MAX);
    await this.blob.put(PATH, JSON.stringify({ entries }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  }
}

export class MemoryKeyTrail implements KeyTrail {
  entries: TrailEntry[] = [];
  async list(): Promise<TrailEntry[]> {
    return structuredClone(this.entries);
  }
  async add(entry: TrailEntry): Promise<void> {
    this.entries = [{ name: entry.name, at: entry.at }, ...this.entries].slice(0, TRAIL_MAX);
  }
}

export function pickKeyTrail(env: Record<string, string | undefined> = process.env): KeyTrail | null {
  const blob = pickBlob(env);
  return blob ? new BlobKeyTrail(blob) : null;
}
