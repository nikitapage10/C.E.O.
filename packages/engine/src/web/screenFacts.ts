/**
 * What Nikita is looking at (#1027): a small registry each view fills with what's on screen, sent with every Skippy
 * request so "this", "here" and "that" resolve. The Desk's shell says the room and the tab; a view inside it adds the
 * open item and its key fields (Kitchen cook mode: the meal, the day, the step and its ingredients). Only the room on
 * screen counts: a page the Desk keeps mounted but hidden adds nothing.
 *
 * Light on purpose: compact JSON of at most SCREEN_MAX characters, no picture (Skippy asks for one with his
 * look_at_screen tool only when this isn't enough). Never keys: a value that looks like a key or a token is dropped.
 * `private` holds what Skippy may see but a public Foundry issue never does (job and resume details, money); the
 * server scrubs it again before anything leaves (`scrubScreen`).
 */

/** A value a view may report: plain words, a number, a flag, or a short list of words. */
export type ScreenValue = string | number | boolean | readonly string[];

export interface ScreenFacts {
  /** The room on screen (its Desk page id: "haven", "annex", "relay"). */
  room?: string;
  /** The tab or section ("Kitchen", "Job search"). */
  tab?: string;
  /** The open item, in a few words ("Cook mode: Tuesday's dinner"). */
  item?: string;
  /** Where the item is in its process ("draft", "finalized", "cooking"). */
  stage?: string;
  /** Its key fields. */
  fields?: Record<string, ScreenValue>;
  /** Fields Skippy may read but a public issue never carries. */
  private?: Record<string, ScreenValue>;
}

/** The most the JSON may be: about 2 KB. */
export const SCREEN_MAX = 2_048;
const VALUE_MAX = 240;
const LIST_MAX = 12;
const FIELDS_MAX = 24;

/** Looks like a key, a token or a secret: never sent. */
const KEYISH = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abpr])[-_][A-Za-z0-9_-]{12,}|\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

const entries = new Map<string, ScreenFacts>();
let base: string | null = null;

/** Sets (or, with null, clears) one view's facts. The Desk's shell passes `isBase`: its room decides which views count. */
export function setScreen(id: string, facts: ScreenFacts | null, isBase = false): void {
  if (!facts) {
    entries.delete(id);
    if (base === id) base = null;
    return;
  }
  entries.set(id, facts);
  if (isBase) base = id;
}

/** Clears every view's facts (tests). */
export function clearScreen(): void {
  entries.clear();
  base = null;
}

/** What's on screen now: the shell's facts, then each view of the same room's, in the order they were set. */
export function screenNow(): ScreenFacts {
  const room = base ? entries.get(base)?.room : undefined;
  const out: ScreenFacts = {};
  const order = base ? [base, ...[...entries.keys()].filter((k) => k !== base)] : [...entries.keys()];
  for (const id of order) {
    const f = entries.get(id)!;
    if (id !== base && room && f.room && f.room !== room) continue;
    if (id !== base && room && !f.room) continue;
    if (f.room) out.room = f.room;
    if (f.tab) out.tab = f.tab;
    if (f.item) out.item = f.item;
    if (f.stage) out.stage = f.stage;
    if (f.fields) out.fields = { ...out.fields, ...f.fields };
    if (f.private) out.private = { ...out.private, ...f.private };
  }
  return out;
}

const cleanText = (v: string) => v.replace(/[\p{Cc}<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, VALUE_MAX);

function cleanValue(v: unknown): ScreenValue | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = cleanText(v);
    return t && !KEYISH.test(t) ? t : undefined;
  }
  if (Array.isArray(v)) {
    const list = v
      .filter((x): x is string => typeof x === "string")
      .map(cleanText)
      .filter((x) => x && !KEYISH.test(x))
      .slice(0, LIST_MAX);
    return list.length ? list : undefined;
  }
  return undefined;
}

function cleanFields(v: unknown): Record<string, ScreenValue> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, ScreenValue> = {};
  for (const [k, raw] of Object.entries(v).slice(0, FIELDS_MAX)) {
    if (!/^[A-Za-z][A-Za-z0-9 _-]{0,31}$/.test(k) || /key|token|secret|password|cookie/i.test(k)) continue;
    const val = cleanValue(raw);
    if (val !== undefined) out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Facts made safe: plain capped words, no key-like values, no key-named fields. The browser and the server both run it. */
export function cleanScreen(v: unknown): ScreenFacts {
  const x = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const word = (k: string, max = 80) => {
    const t = typeof x[k] === "string" ? cleanText(x[k] as string).slice(0, max) : "";
    return t && !KEYISH.test(t) ? t : undefined;
  };
  const room = word("room", 24);
  const tab = word("tab", 60);
  const item = word("item", 160);
  const stage = word("stage", 24);
  const fields = cleanFields(x.fields);
  const priv = cleanFields(x.private);
  return { ...(room && { room }), ...(tab && { tab }), ...(item && { item }), ...(stage && { stage }), ...(fields && { fields }), ...(priv && { private: priv }) };
}

/** The facts without their private fields: what a public Foundry issue may carry. */
export function scrubScreen(f: ScreenFacts): ScreenFacts {
  const { private: _p, ...rest } = f;
  return rest;
}

/**
 * The facts as compact JSON, at most `max` characters: the fields at the end go first, then the private ones, then
 * the item, until it fits. Empty when there's nothing to say.
 */
export function screenJSON(f: ScreenFacts = screenNow(), max = SCREEN_MAX): string {
  const c = cleanScreen(f);
  if (!Object.keys(c).length) return "";
  const fit = (x: ScreenFacts) => JSON.stringify(x);
  let s = fit(c);
  const trim = (key: "fields" | "private") => {
    while (s.length > max && c[key] && Object.keys(c[key]!).length) {
      const keys = Object.keys(c[key]!);
      delete c[key]![keys[keys.length - 1]!];
      if (!Object.keys(c[key]!).length) delete c[key];
      s = fit(c);
    }
  };
  trim("fields");
  trim("private");
  if (s.length > max) {
    delete c.item;
    s = fit(c);
  }
  return s.length > max ? fit({ ...(c.room && { room: c.room }), ...(c.tab && { tab: c.tab }) }) : s;
}

