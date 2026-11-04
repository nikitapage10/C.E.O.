/**
 * Haven's Kitchen list (#627): the shopping list "Hey Skippy" adds to from the iPhone ("garlic and lemons"). Private,
 * like the rest of what Nikita keeps: one JSON file in the private blob store (`haven/kitchen.json`, api/_blob.ts:
 * Vercel's private Blob store, or the Function App's `ceo-state` container on Azure), read in full only in a Desk
 * passkey session. Anyone else gets the counts (`counts`).
 *
 *   - Each item: id, name, addedAt, source ("phone", or "tasks" when Google Tasks quick-add brought it in, #637),
 *     done (and doneAt once ticked off).
 *   - A new name is dropped when an open item already has it, ignoring case, spacing and a trailing plural "s".
 *   - Ticked items stay a day (so a mis-tap can be undone), then go; at most LIST_MAX items are kept.
 *
 * Until the Haven room ships, the Desk shows it as a small "Kitchen list" card on Today (apps/world/src/desk/KitchenList.tsx).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { readJson, updateJson } from "./json.js";

export const LIST_PATH = "haven/kitchen.json";
export const LIST_MAX = 100;
export const NAME_MAX = 60;
/** How long a ticked item stays before it is cleared. */
export const DONE_KEEP_MS = 24 * 60 * 60_000;

/** Where an item came from: Hey Skippy on the phone, or the Google Tasks import (#637). */
export type ListSource = "phone" | "tasks";

export interface ListItem {
  id: string;
  name: string;
  addedAt: string;
  source: ListSource;
  done: boolean;
  doneAt?: string;
}

/** The public face: how many are open and how many were ticked off. Never a name. */
export interface ListCounts {
  open: number;
  done: number;
}

/** An item's name as kept: one plain line, capped. "" when nothing is left. */
export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\p{Cc}<>]/gu, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
}

/** The key two names are compared by: lower case, single spaces, no trailing plural "s" or "es". */
export function sameKey(name: string): string {
  const k = name.toLowerCase().replace(/\s+/g, " ").trim();
  return k.replace(/(?:es|s)$/, "") || k;
}

function cleanItems(raw: unknown, now: number): ListItem[] {
  return (Array.isArray(raw) ? raw : [])
    .map((v): ListItem | null => {
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const name = cleanName(o.name);
      if (typeof o.id !== "string" || !name || typeof o.addedAt !== "string") return null;
      return { id: o.id, name, addedAt: o.addedAt, source: o.source === "tasks" ? "tasks" : "phone", done: o.done === true, ...(o.done === true && typeof o.doneAt === "string" && { doneAt: o.doneAt }) };
    })
    .filter((i): i is ListItem => i !== null && !(i.done && i.doneAt && Date.parse(i.doneAt) < now - DONE_KEEP_MS))
    .slice(-LIST_MAX);
}

export const countsOf = (items: ListItem[]): ListCounts => ({ open: items.filter((i) => !i.done).length, done: items.filter((i) => i.done).length });

/** What adding came to: the names that went on, and the ones already there. */
export interface Added {
  added: string[];
  already: string[];
}

/** Adds names to a list (pure): dedupes against open items and within the batch itself. */
export function addTo(items: ListItem[], names: string[], now: number, id: () => string = () => randomBytes(6).toString("hex"), source: ListSource = "phone"): { items: ListItem[]; result: Added } {
  const open = new Set(items.filter((i) => !i.done).map((i) => sameKey(i.name)));
  const added: string[] = [];
  const already: string[] = [];
  const next = [...items];
  for (const raw of names) {
    const name = cleanName(raw);
    if (!name) continue;
    const key = sameKey(name);
    if (open.has(key)) {
      if (!already.some((a) => sameKey(a) === key) && !added.some((a) => sameKey(a) === key)) already.push(name);
      continue;
    }
    open.add(key);
    added.push(name);
    next.push({ id: id(), name, addedAt: new Date(now).toISOString(), source, done: false });
  }
  return { items: next.slice(-LIST_MAX), result: { added, already } };
}

/** The Kitchen list in the private store. */
export class KitchenList {
  constructor(private readonly blob: BlobBackend) {}

  async items(now: number): Promise<ListItem[]> {
    return cleanItems(await readJson(this.blob, LIST_PATH, []), now);
  }

  async counts(now: number): Promise<ListCounts> {
    return countsOf(await this.items(now));
  }

  async add(names: string[], now: number, source: ListSource = "phone"): Promise<Added> {
    return updateJson(this.blob, LIST_PATH, [] as unknown, (raw) => {
      const { items, result } = addTo(cleanItems(raw, now), names, now, undefined, source);
      return { next: result.added.length ? items : null, result };
    });
  }

  /** Ticks an item off (or back on). False when there is no such item. */
  async tick(id: unknown, done: boolean, now: number): Promise<boolean> {
    if (typeof id !== "string") return false;
    return updateJson(this.blob, LIST_PATH, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const found = cur.find((i) => i.id === id);
      if (!found) return { next: null, result: false };
      const changed: ListItem = done ? { ...found, done: true, doneAt: new Date(now).toISOString() } : { id: found.id, name: found.name, addedAt: found.addedAt, source: found.source, done: false };
      return { next: cur.map((i) => (i === found ? changed : i)), result: true };
    });
  }
}
