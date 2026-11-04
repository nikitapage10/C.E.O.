/**
 * Skippy's private memory of Nikita (#646): who Nikita is and what he has told him, so Desk Skippy knows him as well as
 * the project threads do. It lives only in the private blob store, behind the passkey, never in the repo, an issue,
 * a log or the public site.
 *
 *   Core card   a short card (at most CORE_MAX characters) that is always loaded, behind prompt caching.
 *   Pages       knowledge pages by topic, each with its source and date: a title and summary for the index, and a body.
 *   Facts       single facts Nikita confirmed ("remember that…" waits for his Yes tap), or mirrored from the project's
 *               memory (source "project"); looked up, never all loaded.
 *   Journal     the Desk's and the phone's turns, trimmed, the last JOURNAL_DAYS days, for the nightly distiller (later).
 *
 * What never goes in (`memoryRefusal`), checked on every write, whoever writes: anything the privacy check flags
 * (emails, phone numbers, addresses, card, bank and ID numbers, keys, people's names given away by a cue), money and
 * legal matters (the email filter's own rules and any amount), the skip-list's terms and the priority list. A journal
 * turn that trips it is left out whole.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../../_blob.js";
import { preFilter } from "../../_email/filter.js";
import { readJson, updateJson } from "../../_haven/json.js";
import { privateParts } from "../../_privacy.js";
import { plainLine } from "../../foundry.js";

export const MEMORY_PATH = "desk/skippy/memory/memory.json";
export const JOURNAL_PATH = "desk/skippy/memory/journal.json";

export const CORE_MAX = 1_500;
export const TITLE_MAX = 80;
export const SUMMARY_MAX = 300;
export const BODY_MAX = 4_000;
export const FACT_MAX = 300;
export const TOPIC_MAX = 40;
export const PAGES_MAX = 200;
export const FACTS_MAX = 400;
export const JOURNAL_DAYS = 30;
export const JOURNAL_MAX = 600;
const JOURNAL_Q = 240;
const JOURNAL_A = 360;

export type MemorySource = "desk" | "talk" | "phone" | "project" | "import" | "distiller";
const SOURCES: readonly MemorySource[] = ["desk", "talk", "phone", "project", "import", "distiller"];

export interface KbPage {
  id: string;
  topic: string;
  title: string;
  summary: string;
  body: string;
  source: MemorySource;
  at: string;
}

export interface Fact {
  id: string;
  text: string;
  topic: string;
  source: MemorySource;
  at: string;
}

export interface Memory {
  core: string;
  pages: KbPage[];
  facts: Fact[];
}

export interface JournalTurn {
  at: string;
  via: "desk" | "phone" | "room" | "talk";
  q: string;
  a: string;
}

export const EMPTY_MEMORY: Memory = { core: "", pages: [], facts: [] };

/* ── What never goes in ── */

export type Refusal = "private" | "money" | "legal" | "skip" | "lists";

/** An amount of money in any of the usual forms. */
const AMOUNT = /[$€£¥]\s?\d|\b\d[\d,.]*\s?(?:dollars?|bucks|usd|eur|euros?|gbp|cents)|\b(?:salary|income|net worth|debt|loan|mortgage|rent is|tax(?:es)? (?:owed|bill|return)|credit score|bank balance|savings|401k|brokerage|portfolio value)\b/i;
const LEGAL = /\b(?:lawyer|attorney|lawsuit|legal|court|custody|divorce|subpoena|settlement|sued|suing|contract|nda|immigration status|visa status|police|arrest(?:ed)?|criminal)\b/i;
const LISTS = /\b(?:skip[- ]?list|priority list|email[_ ]?skip|email[_ ]?priority)\b/i;

/** Why a piece of text can't be kept, or null when it can. `skipTerms` are the skip list's (EMAIL_SKIP_TERMS). */
export function memoryRefusal(text: string, skipTerms: readonly string[] = []): Refusal | null {
  if (privateParts(text).length) return "private";
  if (LISTS.test(text)) return "lists";
  if (AMOUNT.test(text) || preFilter({ fromAddress: "", fromDomain: "", subject: text.slice(0, 500) }).kind !== "pass") return LEGAL.test(text) ? "legal" : "money";
  if (LEGAL.test(text)) return "legal";
  const low = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  if (skipTerms.some((t) => t.trim() && low.includes(` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `))) return "skip";
  return null;
}

/** How Skippy says no to keeping something, by reason. Safe to say aloud: it never repeats the words. */
export const REFUSAL_SAY: Record<Refusal, string> = {
  private: "That has private details in it (a number, an address, a name or a key), so I won't keep it.",
  money: "Money stays out of my memory, by your own rule.",
  legal: "Legal matters stay out of my memory, by your own rule.",
  skip: "That touches your skip list, so it stays out of my memory.",
  lists: "Your skip list and priority list never go in my memory.",
};

/* ── Clean shapes ── */

const newId = (kind: "p" | "f") => `${kind}${randomBytes(6).toString("hex")}`;
export const isMemoryId = (v: unknown): v is string => typeof v === "string" && /^[pf][0-9a-f]{12}$/.test(v);
const cleanTopic = (v: unknown) => (typeof v === "string" ? plainLine(v, TOPIC_MAX).toLowerCase() : "") || "general";
const cleanSource = (v: unknown): MemorySource => (SOURCES.includes(v as MemorySource) ? (v as MemorySource) : "import");
const iso = (v: unknown, fallback: string) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);

function cleanMemory(raw: unknown): Memory {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Memory>;
  const now = new Date(0).toISOString();
  const pages = (Array.isArray(r.pages) ? r.pages : [])
    .filter((p): p is KbPage => !!p && typeof p === "object" && isMemoryId(p.id) && typeof p.title === "string")
    .map((p) => ({ id: p.id, topic: cleanTopic(p.topic), title: plainLine(p.title, TITLE_MAX), summary: plainLine(String(p.summary ?? ""), SUMMARY_MAX), body: String(p.body ?? "").slice(0, BODY_MAX), source: cleanSource(p.source), at: iso(p.at, now) }))
    .slice(-PAGES_MAX);
  const facts = (Array.isArray(r.facts) ? r.facts : [])
    .filter((f): f is Fact => !!f && typeof f === "object" && isMemoryId(f.id) && typeof f.text === "string")
    .map((f) => ({ id: f.id, text: plainLine(f.text, FACT_MAX), topic: cleanTopic(f.topic), source: cleanSource(f.source), at: iso(f.at, now) }))
    .filter((f) => f.text)
    .slice(-FACTS_MAX);
  return { core: typeof r.core === "string" ? r.core.slice(0, CORE_MAX) : "", pages, facts };
}

/* ── Looking things up ── */

const STOP = new Set("a an and are as at be by did do does for from had has have he her his i in is it its me my of on or our she that the their them they this to was we what when where which who why will with you your about tell know like".split(" "));
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

export interface Hit {
  id: string;
  kind: "page" | "fact";
  title: string;
  line: string;
  score: number;
}

/**
 * The best matches for a query: titles and topics weigh most, then summaries and facts; pages' bodies only break ties.
 * The index answers first (titles and summaries), and the agent reads a whole page by its id when it needs it.
 */
export function search(m: Memory, query: string, max = 6): Hit[] {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  const score = (fields: [string, number][]) => {
    let s = 0;
    for (const [text, weight] of fields) {
      const w = new Set(words(text));
      for (const term of q) if (w.has(term) || [...w].some((x) => x.length > 4 && (x.startsWith(term) || term.startsWith(x)))) s += weight;
    }
    return s;
  };
  const hits: Hit[] = [
    ...m.pages.map((p) => ({ id: p.id, kind: "page" as const, title: p.title, line: `${p.title} (${p.topic}, ${p.source}, ${p.at.slice(0, 10)}): ${p.summary}`, score: score([[p.title, 3], [p.topic, 2], [p.summary, 1.5], [p.body, 0.25]]) })),
    ...m.facts.map((f) => ({ id: f.id, kind: "fact" as const, title: f.topic, line: `${f.text} (${f.topic}, ${f.source}, ${f.at.slice(0, 10)})`, score: score([[f.topic, 2], [f.text, 1.5]]) })),
  ];
  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

/** One page or fact in full, as plain text for the model; null when there is no such id. */
export function readOne(m: Memory, id: string): string | null {
  const p = m.pages.find((x) => x.id === id);
  if (p) return `${p.title} (topic ${p.topic}; from ${p.source}, ${p.at.slice(0, 10)})\n${p.summary}\n\n${p.body}`;
  const f = m.facts.find((x) => x.id === id);
  return f ? `${f.text} (topic ${f.topic}; from ${f.source}, ${f.at.slice(0, 10)})` : null;
}

/* ── The store ── */

export type Saved<T> = { ok: true; value: T } | { ok: false; why: Refusal | "empty" | "full" | "missing" };

export interface MemoryStore {
  load(): Promise<Memory>;
  /** Keeps a fact Nikita confirmed. */
  addFact(text: string, topic: string, source: MemorySource, now: number): Promise<Saved<Fact>>;
  /** Adds a page, or replaces the one with the same title and topic. */
  putPage(page: { title: string; topic: string; summary: string; body: string; source: MemorySource }, now: number): Promise<Saved<KbPage>>;
  forget(id: string): Promise<boolean>;
  setCore(text: string): Promise<Saved<string>>;
  journal(turn: JournalTurn, now: number): Promise<boolean>;
  readJournal(now: number): Promise<JournalTurn[]>;
}

/** The same checks, wherever the memory lives. */
abstract class Checked implements MemoryStore {
  constructor(protected readonly skipTerms: readonly string[] = []) {}
  protected abstract read(): Promise<unknown>;
  protected abstract change<R>(fn: (cur: Memory) => { next: Memory | null; result: R }): Promise<R>;
  protected abstract readTurns(): Promise<unknown>;
  protected abstract changeTurns(fn: (cur: JournalTurn[]) => JournalTurn[]): Promise<void>;

  async load(): Promise<Memory> {
    return cleanMemory(await this.read());
  }

  async addFact(text: string, topic: string, source: MemorySource, now: number): Promise<Saved<Fact>> {
    const t = plainLine(text, FACT_MAX);
    if (!t) return { ok: false, why: "empty" };
    const why = memoryRefusal(`${t}\n${topic}`, this.skipTerms);
    if (why) return { ok: false, why };
    const fact: Fact = { id: newId("f"), text: t, topic: cleanTopic(topic), source, at: new Date(now).toISOString() };
    return this.change<Saved<Fact>>((raw) => {
      const cur = cleanMemory(raw);
      const same = cur.facts.find((f) => f.text.toLowerCase() === t.toLowerCase());
      if (same) return { next: null, result: { ok: true as const, value: same } };
      return { next: { ...cur, facts: [...cur.facts, fact].slice(-FACTS_MAX) }, result: { ok: true as const, value: fact } };
    });
  }

  async putPage(page: { title: string; topic: string; summary: string; body: string; source: MemorySource }, now: number): Promise<Saved<KbPage>> {
    const title = plainLine(page.title, TITLE_MAX);
    if (!title) return { ok: false, why: "empty" };
    const summary = plainLine(page.summary, SUMMARY_MAX);
    const body = page.body.replace(/\p{Cf}/gu, "").slice(0, BODY_MAX);
    const why = memoryRefusal(`${title}\n${page.topic}\n${summary}\n${body}`, this.skipTerms);
    if (why) return { ok: false, why };
    const topic = cleanTopic(page.topic);
    return this.change<Saved<KbPage>>((raw) => {
      const cur = cleanMemory(raw);
      const old = cur.pages.find((p) => p.title.toLowerCase() === title.toLowerCase() && p.topic === topic);
      const next: KbPage = { id: old?.id ?? newId("p"), topic, title, summary, body, source: page.source, at: new Date(now).toISOString() };
      if (!old && cur.pages.length >= PAGES_MAX) return { next: null, result: { ok: false as const, why: "full" as const } };
      return { next: { ...cur, pages: old ? cur.pages.map((p) => (p === old ? next : p)) : [...cur.pages, next] }, result: { ok: true as const, value: next } };
    });
  }

  async forget(id: string): Promise<boolean> {
    if (!isMemoryId(id)) return false;
    return this.change((raw) => {
      const cur = cleanMemory(raw);
      const facts = cur.facts.filter((f) => f.id !== id);
      const pages = cur.pages.filter((p) => p.id !== id);
      if (facts.length === cur.facts.length && pages.length === cur.pages.length) return { next: null, result: false };
      return { next: { ...cur, facts, pages }, result: true };
    });
  }

  async setCore(text: string): Promise<Saved<string>> {
    const core = text.replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n]/gu, "").replace(/\p{Cf}/gu, "").trim().slice(0, CORE_MAX);
    const why = core ? memoryRefusal(core, this.skipTerms) : null;
    if (why) return { ok: false, why };
    return this.change<Saved<string>>((raw) => ({ next: { ...cleanMemory(raw), core }, result: { ok: true as const, value: core } }));
  }

  /** One turn into the journal, trimmed; a turn that trips the rules is left out whole (false). */
  async journal(turn: JournalTurn, now: number): Promise<boolean> {
    const q = plainLine(turn.q, JOURNAL_Q);
    const a = plainLine(turn.a, JOURNAL_A);
    if (!q || !a || memoryRefusal(`${q}\n${a}`, this.skipTerms)) return false;
    const from = now - JOURNAL_DAYS * 24 * 60 * 60_000;
    await this.changeTurns((cur) => [...cur.filter((t) => Date.parse(t.at) >= from), { at: new Date(now).toISOString(), via: turn.via, q, a }].slice(-JOURNAL_MAX));
    return true;
  }

  async readJournal(now: number): Promise<JournalTurn[]> {
    const from = now - JOURNAL_DAYS * 24 * 60 * 60_000;
    const raw = await this.readTurns();
    return (Array.isArray(raw) ? raw : []).filter((t): t is JournalTurn => !!t && typeof t === "object" && typeof (t as JournalTurn).q === "string" && typeof (t as JournalTurn).a === "string" && Date.parse((t as JournalTurn).at) >= from);
  }
}

/** The memory in the private blob store; every write checks the ETag, so two at once both land. */
export class BlobMemory extends Checked {
  constructor(
    private readonly blob: BlobBackend,
    skipTerms: readonly string[] = [],
  ) {
    super(skipTerms);
  }
  protected read() {
    return readJson<unknown>(this.blob, MEMORY_PATH, EMPTY_MEMORY);
  }
  protected change<R>(fn: (cur: Memory) => { next: Memory | null; result: R }) {
    return updateJson<unknown, R>(this.blob, MEMORY_PATH, EMPTY_MEMORY, (cur) => fn(cur as Memory));
  }
  protected readTurns() {
    return readJson<unknown>(this.blob, JOURNAL_PATH, []);
  }
  protected async changeTurns(fn: (cur: JournalTurn[]) => JournalTurn[]) {
    await updateJson<unknown, null>(this.blob, JOURNAL_PATH, [], (cur) => ({ next: fn(Array.isArray(cur) ? (cur as JournalTurn[]) : []), result: null }));
  }
}

/** In memory, for tests. */
export class MemoryMemory extends Checked {
  doc: unknown = EMPTY_MEMORY;
  turns: JournalTurn[] = [];
  protected async read() {
    return structuredClone(this.doc);
  }
  protected async change<R>(fn: (cur: Memory) => { next: Memory | null; result: R }) {
    const { next, result } = fn(cleanMemory(structuredClone(this.doc)));
    if (next) this.doc = next;
    return result;
  }
  protected async readTurns() {
    return structuredClone(this.turns);
  }
  protected async changeTurns(fn: (cur: JournalTurn[]) => JournalTurn[]) {
    this.turns = fn(structuredClone(this.turns));
  }
}

/** The core card as the agent's always-loaded block. */
export function coreBlock(m: Memory): string {
  return m.core.trim() || "(No core card yet. Learn what Nikita tells you, and look things up in memory when it matters.)";
}
