import { create } from "zustand";
import type { RiteInput } from "./rite.ts";

/**
 * What the Senate has already said, and which docket cards Nikita has put away (#900). Nikita, 2026-11-05: "the Senate
 * is still repeating in a loop … they shouldn't loop. They should say things once and then keep going." and the cards
 * "I should be able to say, okay, cool, and then just like archive them."
 *
 * Each docket item is known by its key and a version of its content (`versionOf`): it is said once per version, so a
 * reload or the session coming round again never replays it, and only new content (two changes shipped becomes three)
 * is said again. A card put away ("Got it") leaves the docket and is never said; it waits under "Archived" until its
 * content changes, when it comes back. The interludes' status lines are said once too (`ambientKey`), and the recess
 * picks up its debates where it left off. All of it per viewer, on this device; a private window keeps it for the visit.
 */

export interface Mark {
  /** The content version it was said or put away at. */
  v: string;
  at: number;
}

export interface SenateMemory {
  said: Record<string, Mark>;
  archived: Record<string, Mark>;
  /** The next debate of the recess (debates.ts, `debateAt`). */
  recess: number;
}

export const EMPTY: SenateMemory = { said: {}, archived: {}, recess: 0 };
const KEY = "ceo.senate.memory.v1";
/** Marks older than this are let go. */
export const KEEP_MS = 30 * 24 * 3_600_000;
/** The most marks kept in each list (the newest). */
export const KEEP_MAX = 300;

/** A short, stable hash (FNV-1a), base 36. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * An item's content version: what it says, never where it sits on the docket (its numeral and the canned counterpoint
 * move with its place). A row whose words carry a clock (a reply's "it has waited 3 hours") gives its own `ver` instead.
 */
export function versionOf(input: Omit<RiteInput, "key">): string {
  if (input.ver !== undefined) return hash(JSON.stringify([input.kind, input.by, input.ver]));
  return hash(JSON.stringify([input.kind, input.by, input.room, input.what, input.say ?? "", (input.options ?? []).map((o) => [o.label, o.say ?? ""]), input.cause ?? "", input.fix ?? ""]));
}

/** An interlude's line, by who says it and its words, numbers aside: "at 41" and "at 42" are the same news. */
export const ambientKey = (by: string, text: string): string => `~${by}:${hash(text.toLowerCase().replace(/\d+([.,]\d+)?/g, "#").replace(/\s+/g, " ").trim())}`;

export const isSaid = (m: SenateMemory, key: string, v: string): boolean => m.said[key]?.v === v;
export const isArchived = (m: SenateMemory, key: string, v: string): boolean => m.archived[key]?.v === v;

export const markSaid = (m: SenateMemory, key: string, v: string, now: number): SenateMemory => (isSaid(m, key, v) ? m : { ...m, said: { ...m.said, [key]: { v, at: now } } });

/** Put away: off the docket, and counted as said so it never takes the floor. */
export const archive = (m: SenateMemory, key: string, v: string, now: number): SenateMemory => {
  const s = markSaid(m, key, v, now);
  return { ...s, archived: { ...s.archived, [key]: { v, at: now } } };
};

/** Back on the docket, still said: it shows again, but isn't read out again. */
export const restore = (m: SenateMemory, key: string): SenateMemory => {
  if (!m.archived[key]) return m;
  const archived = { ...m.archived };
  delete archived[key];
  return { ...m, archived };
};

/** The first item not yet said at its current version, in docket order. */
export function nextFresh<T extends { key: string; ver: string }>(items: readonly T[], m: SenateMemory, skip?: ReadonlySet<string>): T | null {
  return items.find((it) => !isSaid(m, it.key, it.ver) && !isArchived(m, it.key, it.ver) && !skip?.has(`${it.key}@${it.ver}`)) ?? null;
}

/** Splits a docket's rows into those on show and those put away (at their current version). */
export function splitArchived<T>(rows: readonly T[], keyOf: (r: T) => string, verOf: (r: T) => string, m: SenateMemory): { shown: T[]; away: T[] } {
  const shown: T[] = [];
  const away: T[] = [];
  for (const r of rows) (isArchived(m, keyOf(r), verOf(r)) ? away : shown).push(r);
  return { shown, away };
}

const trim = (marks: Record<string, Mark>, now: number): Record<string, Mark> => {
  const kept = Object.entries(marks)
    .filter(([, k]) => now - k.at <= KEEP_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, KEEP_MAX);
  return Object.fromEntries(kept);
};
/** Lets old marks go, so the memory stays small. */
export const prune = (m: SenateMemory, now: number): SenateMemory => ({ ...m, said: trim(m.said, now), archived: trim(m.archived, now) });

const marksOf = (x: unknown): Record<string, Mark> => {
  const out: Record<string, Mark> = {};
  if (!x || typeof x !== "object") return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const mk = v as Partial<Mark> | null;
    if (mk && typeof mk.v === "string" && typeof mk.at === "number" && Number.isFinite(mk.at)) out[k] = { v: mk.v, at: mk.at };
  }
  return out;
};
/** Reads a stored memory, taking only what is well formed. */
export function parse(raw: string | null | undefined): SenateMemory {
  if (!raw) return EMPTY;
  try {
    const o = JSON.parse(raw) as Partial<SenateMemory> | null;
    if (!o || typeof o !== "object") return EMPTY;
    return { said: marksOf(o.said), archived: marksOf(o.archived), recess: typeof o.recess === "number" && Number.isInteger(o.recess) && o.recess >= 0 ? o.recess : 0 };
  } catch {
    return EMPTY;
  }
}

type Store = Pick<Storage, "getItem" | "setItem">;
const storage = (): Store | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};
export function load(s: Store | null = storage(), now = Date.now()): SenateMemory {
  try {
    return prune(parse(s?.getItem(KEY)), now);
  } catch {
    return EMPTY;
  }
}
export function save(m: SenateMemory, s: Store | null = storage()): void {
  try {
    s?.setItem(KEY, JSON.stringify(m));
  } catch {
    /* a private window or a full store: the memory lasts this visit */
  }
}

interface MemoryStore extends SenateMemory {
  said_: (key: string, v: string) => void;
  archive_: (key: string, v: string) => void;
  restore_: (key: string) => void;
  setRecess: (n: number) => void;
}
const pick = (s: MemoryStore): SenateMemory => ({ said: s.said, archived: s.archived, recess: s.recess });

/** The memory, kept in step with this device's storage. */
export const useSenateMemory = create<MemoryStore>((set, get) => {
  const apply = (next: SenateMemory) => {
    const now = get();
    if (next.said === now.said && next.archived === now.archived && next.recess === now.recess) return;
    set(next);
    save(next);
  };
  return {
    ...load(),
    said_: (key, v) => apply(markSaid(pick(get()), key, v, Date.now())),
    archive_: (key, v) => apply(archive(pick(get()), key, v, Date.now())),
    restore_: (key) => apply(restore(pick(get()), key)),
    setRecess: (n) => apply({ ...pick(get()), recess: n }),
  };
});
