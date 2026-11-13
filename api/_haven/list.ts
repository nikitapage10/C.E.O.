/**
 * Haven's Kitchen list (#627): the shopping list "Hey Skippy" adds to from the iPhone ("garlic and lemons"). Private,
 * like the rest of what Nikita keeps: one JSON file in the private blob store (`haven/kitchen.json`, api/_blob.ts:
 * Vercel's private Blob store, or the Function App's `ceo-state` container on Azure), read in full only in a Desk
 * passkey session. Anyone else gets the counts (`counts`).
 *
 *   - Each item: id, name, addedAt, source ("phone", "tasks" when Google Tasks quick-add brought it in, #637, or "meals" when the meal planner sent its week, #678),
 *     done (and doneAt once ticked off).
 *   - A new name is dropped when an open item already has it, ignoring case, spacing and a trailing plural "s".
 *   - Ticked items stay a day (so a mis-tap can be undone), then go; at most LIST_MAX items are kept.
 *   - A removed item (the Desk's ×, or "remove garlic" by voice, #657) is hidden at once and kept ten minutes so Undo
 *     can bring it back; it never counts, is never listed and never goes to King Soopers.
 *
 * Lists (#735): the Kitchen list is one of the private lists (`LISTS`): "Groceries" (the Kitchen list, this file's
 * original) and "Things to buy" (`haven/lists/buy.json`: the Amazon-style list of things that aren't groceries, a phone
 * charger, batteries). Each is its own JSON file with the same rules. Nikita can make more from the Desk (New list): their
 * names and ids are kept in `haven/lists/index.json` (`CUSTOM_PATH`), each list in its own `haven/lists/<id>.json`, and
 * only those can be deleted. A custom list's name is his own words, so the public counts never carry it. Nothing here
 * buys anything; items sent to the King Soopers cart leave the Kitchen list (`removeKeys`). The Desk shows every list in the Haven (rooms/haven/web/HavenLists.tsx); the Kitchen page keeps its
 * own view of the groceries.
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
/** How long a removed item can still be brought back. */
export const REMOVED_KEEP_MS = 10 * 60_000;

/** Where an item came from: Hey Skippy on the phone, the Google Tasks import (#637), the meal planner, or the Desk's quick add (#735). */
export type ListSource = "phone" | "tasks" | "meals" | "desk";

export interface ListItem {
  id: string;
  name: string;
  addedAt: string;
  source: ListSource;
  done: boolean;
  doneAt?: string;
  /** Set when removed: the item is hidden at once and can be brought back for REMOVED_KEEP_MS (the Desk's Undo). */
  removedAt?: string;
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
      return { id: o.id, name, addedAt: o.addedAt, source: o.source === "tasks" || o.source === "meals" || o.source === "desk" ? o.source : "phone", done: o.done === true, ...(o.done === true && typeof o.doneAt === "string" && { doneAt: o.doneAt }), ...(typeof o.removedAt === "string" && { removedAt: o.removedAt }) };
    })
    .filter((i): i is ListItem => i !== null && !(i.done && i.doneAt && Date.parse(i.doneAt) < now - DONE_KEEP_MS) && !(i.removedAt && !(Date.parse(i.removedAt) >= now - REMOVED_KEEP_MS)))
    .slice(-LIST_MAX);
}

const shown = (items: ListItem[]) => items.filter((i) => !i.removedAt);

export const countsOf = (items: ListItem[]): ListCounts => ({ open: shown(items).filter((i) => !i.done).length, done: shown(items).filter((i) => i.done).length });

/** What adding came to: the names that went on, and the ones already there. */
export interface Added {
  added: string[];
  already: string[];
}

/** Adds names to a list (pure): dedupes against open items and within the batch itself. */
export function addTo(items: ListItem[], names: string[], now: number, id: () => string = () => randomBytes(6).toString("hex"), source: ListSource = "phone"): { items: ListItem[]; result: Added } {
  const open = new Set(shown(items).filter((i) => !i.done).map((i) => sameKey(i.name)));
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

/** The built-in private lists, in the order the Desk shows them. `kitchen` is the Kitchen list (groceries). */
export const LISTS = [
  { id: "kitchen", name: "Groceries", path: LIST_PATH },
  { id: "buy", name: "Things to buy", path: "haven/lists/buy.json" },
] as const;
/** A list's id: a built-in one (`LISTS`) or one Nikita made ("l-" and eight letters or digits). */
export type ListId = string;
/** One list: its id, name and file. `custom` when Nikita made it on the Desk (the only kind that can be deleted). */
export interface ListDef {
  id: ListId;
  name: string;
  path: string;
  custom?: true;
}

/** Where the lists Nikita made are named (#1091). */
export const CUSTOM_PATH = "haven/lists/index.json";
/** The most lists he can make. */
export const CUSTOM_MAX = 12;
export const LIST_NAME_MAX = 40;
const CUSTOM_ID = /^l-[a-z0-9]{8}$/;
const isBuiltIn = (v: unknown) => LISTS.some((l) => l.id === v);
const customPath = (id: string) => `haven/lists/${id}.json`;

/** A list's name as kept: one plain line, capped. "" when nothing is left. */
export const cleanListName = (v: unknown): string => (typeof v === "string" ? v.replace(/[\p{Cc}<>]/gu, "").replace(/\s+/g, " ").trim().slice(0, LIST_NAME_MAX) : "");

function cleanCustom(raw: unknown): ListDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ListDef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, name } = r as Record<string, unknown>;
    const clean = cleanListName(name);
    if (typeof id === "string" && CUSTOM_ID.test(id) && clean && !out.some((d) => d.id === id)) out.push({ id, name: clean, path: customPath(id), custom: true });
  }
  return out.slice(0, CUSTOM_MAX);
}

/** Every list: the built-in ones, then the ones he made, oldest first. */
export async function listDefs(blob: BlobBackend): Promise<ListDef[]> {
  const custom = await readJson<unknown>(blob, CUSTOM_PATH, []).then(cleanCustom, () => []);
  return [...LISTS.map((l) => ({ id: l.id, name: l.name, path: l.path })), ...custom];
}

/** The list a request names, or null when there is no such list. */
export async function findList(blob: BlobBackend, id: unknown): Promise<ListDef | null> {
  if (typeof id !== "string") return null;
  if (!isBuiltIn(id) && !CUSTOM_ID.test(id)) return null;
  return (await listDefs(blob)).find((d) => d.id === id) ?? null;
}

export type MadeList = { ok: true; list: ListDef } | { ok: false; error: "bad-name" | "too-many" | "taken" };

/** Makes a new, empty list (the Desk's New list). A name another list already has (ignoring case) is "taken". */
export async function makeList(blob: BlobBackend, name: unknown): Promise<MadeList> {
  const clean = cleanListName(name);
  if (!clean) return { ok: false, error: "bad-name" };
  const key = clean.toLowerCase();
  if (LISTS.some((l) => l.name.toLowerCase() === key)) return { ok: false, error: "taken" };
  return updateJson(blob, CUSTOM_PATH, [] as unknown, (raw) => {
    const cur = cleanCustom(raw);
    if (cur.some((d) => d.name.toLowerCase() === key)) return { next: null, result: { ok: false, error: "taken" } as MadeList };
    if (cur.length >= CUSTOM_MAX) return { next: null, result: { ok: false, error: "too-many" } as MadeList };
    const id = `l-${randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 8)}`;
    const list: ListDef = { id, name: clean, path: customPath(id), custom: true };
    return { next: [...cur, list].map((d) => ({ id: d.id, name: d.name })), result: { ok: true, list } as MadeList };
  });
}

/**
 * Deletes a list he made (the Desk's Delete list, after its "Are you sure"): its name leaves the index and its file
 * is deleted. The built-in lists can't be deleted. False when there is no such list.
 */
export async function deleteList(blob: BlobBackend, id: unknown): Promise<boolean> {
  if (typeof id !== "string" || !CUSTOM_ID.test(id)) return false;
  const gone = await updateJson(blob, CUSTOM_PATH, [] as unknown, (raw) => {
    const cur = cleanCustom(raw);
    if (!cur.some((d) => d.id === id)) return { next: null, result: false };
    return { next: cur.filter((d) => d.id !== id).map((d) => ({ id: d.id, name: d.name })), result: true };
  });
  if (gone) await blob.del(customPath(id)).catch(() => undefined);
  return gone;
}

/** One list in the private store (`LISTS`). */
export class PrivateList {
  constructor(
    protected readonly blob: BlobBackend,
    private readonly path: string,
  ) {}

  async items(now: number): Promise<ListItem[]> {
    return shown(cleanItems(await readJson(this.blob, this.path, []), now));
  }

  async counts(now: number): Promise<ListCounts> {
    return countsOf(await this.items(now));
  }

  async add(names: string[], now: number, source: ListSource = "phone"): Promise<Added> {
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const { items, result } = addTo(cleanItems(raw, now), names, now, undefined, source);
      return { next: result.added.length ? items : null, result };
    });
  }

  /** Ticks an item off (or back on). False when there is no such item. */
  async tick(id: unknown, done: boolean, now: number): Promise<boolean> {
    if (typeof id !== "string") return false;
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const found = cur.find((i) => i.id === id);
      if (!found) return { next: null, result: false };
      const changed: ListItem = done ? { ...found, done: true, doneAt: new Date(now).toISOString() } : { id: found.id, name: found.name, addedAt: found.addedAt, source: found.source, done: false };
      return { next: cur.map((i) => (i === found ? changed : i)), result: true };
    });
  }

  /** Removes an item by id (hidden now, restorable for ten minutes). False when there is no such item. */
  async remove(id: unknown, now: number): Promise<boolean> {
    if (typeof id !== "string") return false;
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const found = cur.find((i) => i.id === id && !i.removedAt);
      if (!found) return { next: null, result: false };
      return { next: cur.map((i) => (i === found ? { ...i, removedAt: new Date(now).toISOString() } : i)), result: true };
    });
  }

  /** Brings a removed item back (Undo). False when it is gone for good or was never removed. */
  async restore(id: unknown, now: number): Promise<boolean> {
    if (typeof id !== "string") return false;
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const found = cur.find((i) => i.id === id && i.removedAt);
      if (!found) return { next: null, result: false };
      const { removedAt: _gone, ...back } = found;
      return { next: cur.map((i) => (i === found ? back : i)), result: true };
    });
  }

  /**
   * Removes open items by the names said ("garlic", "oat milk"). A name that matches one item exactly (ignoring case
   * and a plural "s") goes; otherwise it matches the one item that has all its words; two or more are `ambiguous`
   * (nothing removed for that name), none is `missing`.
   */
  async removeByName(names: string[], now: number): Promise<Removal> {
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const { items, result } = removeNamed(cleanItems(raw, now), names, now);
      return { next: result.removed.length ? items : null, result };
    });
  }

  /** Clears the whole list (#761, the Shopping card's Clear): every item hidden now, restorable for a while like a removal. How many went. */
  async clearAll(now: number): Promise<number> {
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const at = new Date(now).toISOString();
      const gone = cur.filter((i) => !i.removedAt).length;
      return { next: gone ? cur.map((i) => (i.removedAt ? i : { ...i, removedAt: at })) : null, result: gone };
    });
  }

  /** Brings back what one Clear list took (its Undo): every item removed at that moment. How many came back. */
  async restoreCleared(at: unknown, now: number): Promise<number> {
    if (typeof at !== "string" || !at) return 0;
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const back = cur.filter((i) => i.removedAt === at).length;
      return { next: back ? cur.map((i) => (i.removedAt === at ? (({ removedAt: _gone, ...rest }) => rest)(i) : i)) : null, result: back };
    });
  }

  /**
   * Takes the open items with these keys (`sameKey`) off the list (#1091): what was just sent to the King Soopers cart is
   * bought, so it leaves the list. Hidden like a removal. How many went.
   */
  async removeKeys(keys: ReadonlySet<string>, now: number): Promise<number> {
    if (!keys.size) return 0;
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const at = new Date(now).toISOString();
      const drop = (i: ListItem) => !i.removedAt && !i.done && keys.has(sameKey(i.name));
      const gone = cur.filter(drop).length;
      return { next: gone ? cur.map((i) => (drop(i) ? { ...i, removedAt: at } : i)) : null, result: gone };
    });
  }

  /**
   * Takes off the open items one source put on the list that it no longer wants (#761: the meal planner's lines after the
   * plan changed and was finalized again), compared by `sameKey`. Ticked items and other sources' stay. How many went.
   */
  async dropMissing(source: ListSource, keep: ReadonlySet<string>, now: number): Promise<number> {
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const at = new Date(now).toISOString();
      const drop = (i: ListItem) => !i.removedAt && !i.done && i.source === source && !keep.has(sameKey(i.name));
      const gone = cur.filter(drop).length;
      return { next: gone ? cur.map((i) => (drop(i) ? { ...i, removedAt: at } : i)) : null, result: gone };
    });
  }

  /** Clears every ticked item now (the Desk's "Clear ticked"). How many went. */
  async clearDone(now: number): Promise<number> {
    return updateJson(this.blob, this.path, [] as unknown, (raw) => {
      const cur = cleanItems(raw, now);
      const gone = cur.filter((i) => i.done && !i.removedAt).length;
      return { next: gone ? cur.filter((i) => !(i.done && !i.removedAt)) : null, result: gone };
    });
  }
}

/** The Kitchen list (groceries) in the private store. */
export class KitchenList extends PrivateList {
  constructor(blob: BlobBackend) {
    super(blob, LIST_PATH);
  }
}

/** A built-in list by its id (`LISTS`). */
export const listOf = (blob: BlobBackend, id: (typeof LISTS)[number]["id"]): PrivateList => (id === "kitchen" ? new KitchenList(blob) : new PrivateList(blob, LISTS.find((l) => l.id === id)!.path));

/** Any list by its definition (`listDefs`, `findList`). */
export const listAt = (blob: BlobBackend, def: ListDef): PrivateList => (def.id === "kitchen" ? new KitchenList(blob) : new PrivateList(blob, def.path));

/** Every list with its items (signed in only). `custom` marks the ones he made. */
export async function allLists(blob: BlobBackend, now: number): Promise<Array<{ id: ListId; name: string; custom?: true; items: ListItem[] }>> {
  return Promise.all((await listDefs(blob)).map(async (l) => ({ id: l.id, name: l.name, ...(l.custom && { custom: true as const }), items: await listAt(blob, l).items(now) })));
}

/**
 * Every list's counts, never an item (the public face). The lists he made are named in his own words, so they are
 * counted together as "Other lists" and never named.
 */
export async function listCounts(blob: BlobBackend, now: number): Promise<Array<{ id: ListId; name: string } & ListCounts>> {
  const defs = await listDefs(blob);
  const each = await Promise.all(defs.map(async (l) => ({ l, c: await listAt(blob, l).counts(now).catch(() => ({ open: 0, done: 0 })) })));
  const out: Array<{ id: ListId; name: string } & ListCounts> = each.filter((e) => !e.l.custom).map((e) => ({ id: e.l.id, name: e.l.name, ...e.c }));
  const mine = each.filter((e) => e.l.custom);
  if (mine.length) out.push({ id: "other", name: "Other lists", open: mine.reduce((n, e) => n + e.c.open, 0), done: mine.reduce((n, e) => n + e.c.done, 0) });
  return out;
}

/** What removing by name came to. `ambiguous` holds, for each name, the item names it could have meant. */
export interface Removal {
  removed: string[];
  missing: string[];
  ambiguous: Array<{ said: string; could: string[] }>;
}

const wordsOf = (name: string) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w.replace(/(?:es|s)$/, "") || w);

/** Removes named items (pure). */
export function removeNamed(items: ListItem[], names: string[], now: number): { items: ListItem[]; result: Removal } {
  const result: Removal = { removed: [], missing: [], ambiguous: [] };
  const next = [...items];
  for (const raw of names) {
    const said = cleanName(raw);
    if (!said) continue;
    const open = next.filter((i) => !i.done && !i.removedAt);
    const exact = open.filter((i) => sameKey(i.name) === sameKey(said));
    const wanted = wordsOf(said);
    const hits = exact.length ? exact : open.filter((i) => wanted.every((w) => wordsOf(i.name).includes(w)));
    if (hits.length === 0) result.missing.push(said);
    else if (hits.length > 1 && !exact.length) result.ambiguous.push({ said, could: hits.map((h) => h.name) });
    else {
      for (const h of hits) next[next.indexOf(h)] = { ...h, removedAt: new Date(now).toISOString() };
      result.removed.push(hits[0]!.name);
    }
  }
  return { items: next, result };
}
