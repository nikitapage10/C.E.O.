/**
 * The Desk's library for Skippy (#1141). Nikita, on a call (2026-11-13): Skippy should have "a repository and wealth of
 * information" about the Desk itself, "not just about the lore. Anything related to the Desk, including lore, building
 * design, schemas, and future plans." So:
 *
 *   - The library: the repo's public docs, lore, room manifests and the cast's dossiers, split by heading into
 *     sections with ids, written at every install and build into ./deskIndex.ts (scripts/desk-library-lib.mjs; not
 *     committed, like stackDeps.ts), so the Function App's bundle carries it. Repo content only: public, never kb/.
 *   - The plans: the Foundry's open issues (titles and pitches, already public on GitHub), read live and kept ten
 *     minutes per warm function (`livePlans`).
 *   - The search: local keyword ranking (BM25-like, titles weigh more), so a lookup costs nothing. `desk_lookup` gives
 *     the top titles with short excerpts and ids, `desk_read` one section by id (capped), and a Talk call's
 *     `GET /api/skippy-tools?read=desk&q=` the top excerpts as a few spoken lines (`deskCallText`).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { githubToken } from "../_github.js";
import { memo } from "../_feedcache.js";
import { privateParts } from "../_privacy.js";
import { DESK_SECTIONS } from "./deskIndex.js";

export interface DeskSection {
  id: string;
  title: string;
  source: string;
  text: string;
}

export interface DeskHit {
  id: string;
  title: string;
  source: string;
  excerpt: string;
  score: number;
}

/** The most desk_read returns of a section (the index's parts are at most 2,400 characters). */
export const READ_MAX = 2_600;
/** The most a call's answer carries. */
export const CALL_MAX = 1_400;
/** How many hits a lookup lists. */
export const LOOKUP_TOP = 5;

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my no not of on or our so tell than that the their them then there these they this those to us was we were what when where which who whom why will with would you your about any all also just like know more most much some very skippy desk c.e.o ceo".split(" "),
);

/** A word's search form: lowercase, a plain plural, possessive, -ing or -ed dropped (the same on both sides). */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) w = w.slice(0, -1);
  else if (w.length > 6 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 5 && w.endsWith("ed") && !w.endsWith("eed")) w = w.slice(0, -2);
  return w;
}

/** The searchable words of a text, stop words left out. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [])
    .map((w) => w.replace(/['’-]+$/, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem);
}

interface Indexed {
  s: DeskSection;
  title: Set<string>;
  tf: Map<string, number>;
  len: number;
}

const indexOne = (s: DeskSection): Indexed => {
  const tf = new Map<string, number>();
  const body = terms(s.text);
  for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { s, title: new Set(terms(s.title)), tf, len: body.length };
};

/** The library as sections. */
export const DESK_LIBRARY: readonly DeskSection[] = DESK_SECTIONS.map(([id, title, source, text]) => ({ id, title, source, text }));

let built: { docs: Indexed[]; df: Map<string, number>; avg: number } | null = null;
/** The library's word index, built once per warm function on its first search. */
function library() {
  if (built) return built;
  const docs = DESK_LIBRARY.map(indexOne);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set([...d.tf.keys(), ...d.title])) df.set(t, (df.get(t) ?? 0) + 1);
  built = { docs, df, avg: docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length) };
  return built;
}

/** The best place in a text to quote for these words: the sentence holding the rarest one found, trimmed to `max`. */
export function excerpt(text: string, words: string[], max = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.search(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    if (i >= 0 && (at < 0 || i < at)) at = i;
    if (at >= 0) break;
  }
  let start = at < 0 ? 0 : Math.max(0, flat.lastIndexOf(". ", at) + 2);
  if (at - start > max / 2) start = Math.max(0, at - Math.floor(max / 3));
  const cut = flat.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${cut}${start + max < flat.length ? "…" : ""}`;
}

/**
 * The sections that best answer a query: each word's weight by how rare it is (BM25), a word in the title counts
 * extra, and a section that has more of the query's words ranks above one that repeats a single word. `extra` (the
 * live plans) is ranked with the library's word counts.
 */
export function deskLookup(query: string, extra: readonly DeskSection[] = [], top = LOOKUP_TOP): DeskHit[] {
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const lib = library();
  const docs = [...lib.docs, ...extra.map(indexOne)];
  const n = docs.length;
  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const who = /\bwho\b/.test(phrase);
  const room = /\broom\b/.test(phrase);
  const hits: DeskHit[] = [];
  for (const d of docs) {
    let score = 0;
    let found = 0;
    for (const t of q) {
      const tf = d.tf.get(t) ?? 0;
      const inTitle = d.title.has(t);
      if (!tf && !inTitle) continue;
      found++;
      const df = lib.df.get(t) ?? 1;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const sat = (tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * d.len) / lib.avg));
      score += idf * (sat + (inTitle ? 1.5 : 0));
    }
    if (!found) continue;
    score *= 0.4 + (0.6 * found) / q.length;
    // "Who is…" leans to the cast's dossiers, "…room…" to the rooms' manifests.
    if (who && d.s.title.startsWith("Dossier:")) score *= 1.6;
    if (room && d.s.title.startsWith("Room:")) score *= 1.3;
    if (q.length > 1 && phrase.length > 6 && `${d.s.title} ${d.s.text}`.toLowerCase().includes(phrase)) score *= 1.3;
    hits.push({ id: d.s.id, title: d.s.title, source: d.s.source, excerpt: "", score });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const byId = new Map(docs.map((d) => [d.s.id, d.s]));
  return hits.slice(0, top).map((h) => ({ ...h, excerpt: excerpt(byId.get(h.id)!.text, q) }));
}

/**
 * Where a section can be cited from (#1153): only the repo's public docs, as the library reads them (docs, lore, the
 * README and CLAUDE.md, the room manifests, the simulator's dossiers). A plan (a GitHub issue) or anything else has no page.
 */
export const DOC_PATH = /^(?:(?:docs|lore)\/[A-Za-z0-9._-]+\.md|README\.md|CLAUDE\.md|rooms\/[a-z0-9-]+\/room\.ts|packages\/simulator\/src\/[A-Za-z0-9._-]+\.ts)$/;

/** A page an answer came from: the section's title and its doc file in the repo. */
export interface DeskSource {
  title: string;
  path: string;
}

/** The page a section came from, or null when it has none to show. */
export function sourceOf(s: Pick<DeskSection, "title" | "source"> | null | undefined): DeskSource | null {
  if (!s || !DOC_PATH.test(s.source)) return null;
  return { title: s.title.replace(/ \(part \d+ of \d+\)$/, "").slice(0, 120), path: s.source };
}

/** What desk_lookup's top hit cites (the best match, the one an answer most likely used). */
export function lookupSource(query: string, plans: readonly DeskSection[] = []): DeskSource | null {
  const top = deskLookup(query, plans)[0];
  return top ? sourceOf(top) : null;
}

/** One section by id, from the library or the live plans. */
export function deskSection(id: string, extra: readonly DeskSection[] = []): DeskSection | null {
  return DESK_LIBRARY.find((s) => s.id === id) ?? extra.find((s) => s.id === id) ?? null;
}

/** desk_lookup's answer: the top titles with their ids and an excerpt each. */
export function deskLookupText(query: string, plans: readonly DeskSection[] = []): string {
  const hits = deskLookup(query, plans);
  if (!hits.length) return "Nothing in the Desk's library on that.";
  return `${hits.map((h) => `[${h.id}] ${h.title} (${h.source}): ${h.excerpt}`).join("\n")}\nCall desk_read with an id for the whole section.`;
}

/** desk_read's answer: one section, capped, with the next part's id when it was cut into parts. */
export function deskReadText(id: string, plans: readonly DeskSection[] = []): string {
  const s = typeof id === "string" ? deskSection(id.trim(), plans) : null;
  if (!s) return "No section in the Desk's library with that id. Call desk_lookup first.";
  const part = / \(part (\d+) of (\d+)\)$/.exec(s.title);
  const next = part && Number(part[1]) < Number(part[2]) ? s.id.replace(/-\d+$/, `-${Number(part[1]) + 1}`) : "";
  const body = s.text.length > READ_MAX ? `${s.text.slice(0, READ_MAX)}…` : s.text;
  return `${s.title} (${s.source})\n${body}${next && deskSection(next, plans) ? `\nThe next part: [${next}]` : ""}`;
}

/** What a Talk call hears (GET ?read=desk&q=): the top three sections as short lines, for Skippy to say in his words. */
export function deskCallText(query: string, plans: readonly DeskSection[] = []): string {
  if (!terms(query).length) return "Say what to look up about the Desk: a room, a character, the lore, how something is built, or what's planned.";
  const hits = deskLookup(query, plans, 3);
  if (!hits.length) return "Nothing in the Desk's library on that. Say so in a line, or hand it to hand_to_kernel if it's about something live.";
  const q = [...new Set(terms(query))];
  const lines = hits.map((h) => `${h.title.replace(/ \(part \d+ of \d+\)$/, "")}: ${excerpt(deskSection(h.id, plans)!.text, q, 420)}`);
  let out = "";
  for (const l of lines) if ((out + l).length < CALL_MAX) out += `${out ? "\n" : ""}${l}`;
  return `From the Desk's own library (answer from this, in your own words, in a sentence or two): ${out || lines[0]!.slice(0, CALL_MAX)}`;
}

/* ── The plans: the Foundry's open issues ── */

export interface PlanIssue {
  number: number;
  title: string;
  body?: string | null;
  labels?: ({ name?: string } | string)[];
  pull_request?: unknown;
}

const labelNames = (i: PlanIssue) => (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? "")));
const PLAN_STATE: Record<string, string> = {
  "foundry:working": "being built now",
  "foundry:build": "approved, waiting for a builder",
  "foundry:ready": "ready for a builder",
  "foundry:blocked": "blocked",
  "foundry:paused": "paused",
  "foundry:question": "waiting on a question",
  "foundry:idea": "an idea waiting for Nikita's pick",
};

/**
 * The open Foundry issues as sections: each one's title, pitch and size, and one overview section ("plans") that
 * lists them all, for "what's planned?". Anything that looks private is left out whole.
 */
export function planSections(issues: readonly PlanIssue[]): DeskSection[] {
  const done = new Set(["foundry:shipped", "foundry:passed", "foundry:undone"]);
  const open = issues.filter((i) => !i.pull_request && typeof i.number === "number" && typeof i.title === "string" && !labelNames(i).some((l) => done.has(l)));
  const out: DeskSection[] = [];
  for (const i of open) {
    const body = i.body ?? "";
    const pitch = /\*\*Pitch:\*\*\s*([^\n]+)/.exec(body)?.[1]?.trim() ?? "";
    const size = /\*\*Size:\*\*\s*(\w+)/.exec(body)?.[1] ?? "";
    const state = labelNames(i).map((l) => PLAN_STATE[l]).find(Boolean) ?? "open";
    const text = [`Planned: an open Foundry issue, number ${i.number}, ${state}.`, pitch && `Pitch: ${pitch.slice(0, 600)}`, size && `Size: ${size}.`].filter(Boolean).join("\n");
    if (privateParts(`${i.title}\n${text}`).length) continue;
    out.push({ id: `plan-${i.number}`, title: `Plan #${i.number}: ${i.title.slice(0, 120)}`, source: `GitHub issue #${i.number}`, text });
  }
  if (out.length) {
    out.unshift({
      id: "plans",
      title: "Future plans: what's open in the Foundry",
      source: "GitHub issues labelled foundry",
      text: `What's planned, being built or waiting next for the Desk (roadmap, future work, coming up), from the Foundry's open issues:\n${out.map((p) => `- ${p.title.replace(/^Plan /, "")}`).join("\n")}`.slice(0, READ_MAX),
    });
  }
  return out;
}

const GH = "https://api.github.com/repos/nikitapage10/C.E.O.";

/** The Foundry's open issues as plan sections, read live with the read token and kept ten minutes per warm function. */
export const livePlans = memo(10 * 60_000, async (): Promise<DeskSection[]> => {
  const token = await githubToken("read").catch(() => "");
  const res = await fetch(`${GH}/issues?labels=foundry&state=open&sort=updated&direction=desc&per_page=50`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const got = (await res.json()) as unknown;
  return planSections(Array.isArray(got) ? (got as PlanIssue[]) : []);
});
