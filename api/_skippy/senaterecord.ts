/**
 * The Senate Record (#1181): every motion the Senate has argued, with the chair's ruling, for the Archive's Senate Record
 * place. The chamber already kept its motions (`desk/senate/topics.json`, senatetalk.ts) so it never argues one twice;
 * since #1181 each new recess argument also keeps `{ at, motion, close }` in its own small list
 * (`desk/senate/record.json`, the newest RECORD_KEEP). Only the motion and the chair's ruling: both are model lines
 * that passed the public-safe check before the chamber said them, and the Senate is public. Nikita's floor words, the
 * members' lines and a ruling rewritten after he joined in (#925) are never kept here.
 *
 * `senateRecord()` reads both lists into the view the Archive shows, newest first: the kept rulings, then the motions
 * argued before #1181 (or whose ruling was never kept), the motion alone.
 *
 * Underscore folder: Vercel never serves it as a function. The route is api/senate-record.ts.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";

export const RECORD_PATH = "desk/senate/record.json";
/** The rulings kept, newest last. */
export const RECORD_KEEP = 200;
/** The most entries the view hands back (the kept rulings plus the older motions). */
export const RECORD_VIEW_MAX = 400;
/** The longest motion or ruling kept (the chamber's own LINE_MAX). */
const TEXT_MAX = 240;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** One argument as kept: when it was argued, its motion and the chair's ruling. */
export interface SenateRuling {
  at: string;
  motion: string;
  close: string;
}

/** One line of the record as shown: a motion argued before #1181 has no `at` or `close`. */
export interface RecordEntry {
  motion: string;
  close?: string;
  at?: string;
}

export interface SenateRecordView {
  entries: RecordEntry[];
}

export interface RecordStore {
  load(): Promise<SenateRuling[]>;
  add(ruling: SenateRuling): Promise<void>;
}

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** A kept ruling read back, or null when it isn't one. */
export function readRuling(v: unknown): SenateRuling | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const at = text(o.at);
  const motion = text(o.motion);
  const close = text(o.close);
  if (!ISO.test(at) || !motion || !close || motion.length > TEXT_MAX || close.length > TEXT_MAX) return null;
  return { at, motion, close };
}

const cleanRulings = (got: unknown, keep: number): SenateRuling[] =>
  Array.isArray(got)
    ? got
        .map(readRuling)
        .filter((r): r is SenateRuling => r !== null)
        .slice(-keep)
    : [];

export class BlobRecordStore implements RecordStore {
  constructor(
    private readonly blob: BlobBackend,
    private readonly path: string = RECORD_PATH,
    private readonly keep: number = RECORD_KEEP,
  ) {}
  async load(): Promise<SenateRuling[]> {
    const found = await this.blob.get(this.path);
    return found ? cleanRulings(await new Response(found.stream).json().catch(() => []), this.keep) : [];
  }
  async add(ruling: SenateRuling): Promise<void> {
    const r = readRuling(ruling);
    if (!r) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const etag = await this.blob.etag(this.path);
      const cur = etag ? await this.load() : [];
      try {
        await this.blob.put(this.path, JSON.stringify([...cur, r].slice(-this.keep)), {
          contentType: "application/json",
          addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
  }
}

export class MemoryRecordStore implements RecordStore {
  list: SenateRuling[] = [];
  constructor(private readonly keep: number = RECORD_KEEP) {}
  async load(): Promise<SenateRuling[]> {
    return [...this.list];
  }
  async add(ruling: SenateRuling): Promise<void> {
    const r = readRuling(ruling);
    if (r) this.list = [...this.list, r].slice(-this.keep);
  }
}

/** A motion as compared: lower case, letters and digits only. */
const key = (m: string): string =>
  m
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The record as the Archive shows it, newest first: the kept rulings, then the motions the chamber argued without one
 * kept (before #1181), each once.
 */
export function senateRecord(rulings: readonly SenateRuling[], motions: readonly string[], max = RECORD_VIEW_MAX): SenateRecordView {
  const seen = new Set<string>();
  const entries: RecordEntry[] = [];
  for (const r of [...rulings].reverse()) {
    const k = key(r.motion);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    entries.push({ at: r.at, motion: r.motion, close: r.close });
  }
  for (const m of [...motions].reverse()) {
    const motion = text(m);
    const k = key(motion);
    if (!k || seen.has(k) || motion.length > TEXT_MAX) continue;
    seen.add(k);
    entries.push({ motion });
  }
  return { entries: entries.slice(0, max) };
}
