/**
 * The Haven Gym's workout plan and log (#660): one JSON file in the private blob store (`haven/gym.json`), next to the
 * Kitchen list and the floor plan. Read in full only in a Desk passkey session (GET /api/haven?view=gym); anyone else
 * gets the counts (`gymCounts`: sessions a week, sessions done this week), never an exercise or a time.
 *
 *   - Until Nikita changes it, the plan is the generic default in api/_haven/gymShape.ts (`DEFAULT_GYM_PLAN`).
 *   - A session is logged by a tap on the Desk or through Hey Skippy ("did core day A", "log core workout"); a tap can
 *     be taken back. The log keeps LOG_KEEP_WEEKS of weeks, LOG_MAX entries at most.
 *   - Weeks run Monday to Sunday on Mountain time, Nikita's clock (api/_today/parse.ts).
 *
 * The seam for #646's room tool registry: `editGymPlan` is the one function that changes the plan. It takes a small
 * closed set of edits (set the whole plan, put one session, remove one, reset to the default), checks the result with
 * `readGymPlan` and saves it. A tool that adds or edits plans calls it and nothing else.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { atWall, wall } from "../_today/parse.js";
import { readJson, updateJson } from "./json.js";
import { DEFAULT_GYM_PLAN, readGymPlan, type GymCounts, type GymPlan, type GymSession } from "./gymShape.js";

export * from "./gymShape.js";

export const GYM_PATH = "haven/gym.json";
export const LOG_MAX = 400;
export const LOG_KEEP_WEEKS = 26;
/** How many weeks the Gym's history strip shows. */
export const HISTORY_WEEKS = 8;
const WEEK = 7 * 24 * 3_600_000;

export type GymVia = "desk" | "phone";

export interface GymLogEntry {
  id: string;
  /** The session's letter ("a"). */
  session: string;
  at: string;
  via: GymVia;
}

interface GymFile {
  plan?: unknown;
  log?: unknown;
}

/** What a passkey session sees. */
export interface GymView {
  plan: GymPlan;
  /** True while the plan is still the shipped default. */
  isDefault: boolean;
  /** This week (Monday, Mountain) and what was logged in it. */
  week: { start: string; done: GymLogEntry[] };
  /** Sessions done in each of the last HISTORY_WEEKS weeks, oldest first; the last is this week. */
  weeks: number[];
}

/** The Monday 00:00 (Mountain) that starts the week `now` is in. */
export function weekStart(now: number): number {
  const w = wall(now);
  const back = (w.wd + 6) % 7;
  return atWall(w.y, w.mo, w.d - back, 0, 0);
}

const ENTRY_ID = /^[a-z0-9-]{4,40}$/;
const logOf = (v: unknown): GymLogEntry[] =>
  (Array.isArray(v) ? v : []).filter(
    (e): e is GymLogEntry =>
      !!e && typeof e === "object" && typeof (e as GymLogEntry).id === "string" && ENTRY_ID.test((e as GymLogEntry).id) && typeof (e as GymLogEntry).session === "string" && /^[a-g]$/.test((e as GymLogEntry).session) && Number.isFinite(Date.parse((e as GymLogEntry).at)) && ((e as GymLogEntry).via === "desk" || (e as GymLogEntry).via === "phone"),
  );

const planOf = (f: GymFile): { plan: GymPlan; isDefault: boolean } => {
  const saved = f.plan === undefined ? null : readGymPlan(f.plan);
  return saved ? { plan: saved, isDefault: false } : { plan: DEFAULT_GYM_PLAN, isDefault: true };
};

/** Entries kept: the last LOG_KEEP_WEEKS weeks, newest LOG_MAX. */
const trim = (log: GymLogEntry[], now: number) => log.filter((e) => Date.parse(e.at) >= weekStart(now) - LOG_KEEP_WEEKS * WEEK).slice(-LOG_MAX);

async function load(blob: BlobBackend): Promise<GymFile> {
  const got = await readJson<unknown>(blob, GYM_PATH, {});
  return got && typeof got === "object" && !Array.isArray(got) ? (got as GymFile) : {};
}

/** The plan, its log this week and the weeks before: the passkey view. */
export async function gymView(blob: BlobBackend, now: number): Promise<GymView> {
  const f = await load(blob);
  const { plan, isDefault } = planOf(f);
  const log = logOf(f.log);
  const start = weekStart(now);
  const weeks: number[] = [];
  for (let i = HISTORY_WEEKS - 1; i >= 0; i--) {
    const from = start - i * WEEK;
    weeks.push(log.filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) < from + WEEK).length);
  }
  return { plan, isDefault, week: { start: new Date(start).toISOString(), done: log.filter((e) => Date.parse(e.at) >= start) }, weeks };
}

/** The public face: sessions a week and sessions done this week. Never an exercise. */
export async function gymCounts(blob: BlobBackend, now: number): Promise<GymCounts> {
  const f = await load(blob);
  const start = weekStart(now);
  return { perWeek: planOf(f).plan.sessions.length, doneThisWeek: logOf(f.log).filter((e) => Date.parse(e.at) >= start).length };
}

/* ── The seam: the one function that changes the plan (#646's tool registry calls it) ── */

export type GymEdit =
  | { op: "set"; plan: unknown }
  | { op: "put-session"; session: unknown }
  | { op: "remove-session"; id: unknown }
  | { op: "reset" };

export type GymEditResult = { ok: true; plan: GymPlan; isDefault: boolean } | { ok: false; error: "bad-plan" | "not-found" | "last-session" };

/** An edit from anywhere (the Desk, a room tool), as one of the closed set; null when it isn't one. */
export function readGymEdit(v: unknown): GymEdit | null {
  const b = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  if (b.op === "set") return { op: "set", plan: b.plan };
  if (b.op === "put-session") return { op: "put-session", session: b.session };
  if (b.op === "remove-session") return { op: "remove-session", id: b.id };
  if (b.op === "reset") return { op: "reset" };
  return null;
}

/**
 * Changes the plan: sets the whole of it, puts one session (adds it, or replaces the one with its letter), removes one,
 * or resets to the default. Every result is checked with `readGymPlan` before it's saved; the log is left alone.
 */
export async function editGymPlan(blob: BlobBackend, edit: GymEdit, now: number): Promise<GymEditResult> {
  return updateJson<GymFile, GymEditResult>(blob, GYM_PATH, {}, (cur) => {
    const f = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
    const { plan } = planOf(f);
    if (edit.op === "reset") {
      const { plan: _drop, ...rest } = f;
      void _drop;
      return { next: { ...rest, log: trim(logOf(f.log), now) }, result: { ok: true, plan: DEFAULT_GYM_PLAN, isDefault: true } };
    }
    let next: GymPlan | null;
    if (edit.op === "set") next = readGymPlan(edit.plan);
    else if (edit.op === "put-session") {
      const one = readGymPlan({ ...plan, sessions: [edit.session] })?.sessions[0];
      if (!one) return { next: null, result: { ok: false, error: "bad-plan" } };
      next = readGymPlan({ ...plan, sessions: [...plan.sessions.filter((s) => s.id !== one.id), one] });
    } else {
      const id = typeof edit.id === "string" ? edit.id.toLowerCase() : "";
      if (!plan.sessions.some((s) => s.id === id)) return { next: null, result: { ok: false, error: "not-found" } };
      if (plan.sessions.length === 1) return { next: null, result: { ok: false, error: "last-session" } };
      next = readGymPlan({ ...plan, sessions: plan.sessions.filter((s) => s.id !== id) });
    }
    if (!next) return { next: null, result: { ok: false, error: "bad-plan" } };
    return { next: { ...f, plan: next, log: trim(logOf(f.log), now) }, result: { ok: true, plan: next, isDefault: false } };
  });
}

/* ── Logging a session ── */

export type GymLogged = { ok: true; entry: GymLogEntry; session: GymSession; doneThisWeek: number; perWeek: number } | { ok: false; error: "not-found" };

/**
 * Which session a log means: the one named ("a"), else the one planned for today, else the first not yet done this
 * week, else the first. null only when a named letter isn't in the plan.
 */
export function pickSession(plan: GymPlan, named: string | null | undefined, doneThisWeek: GymLogEntry[], now: number): GymSession | null {
  if (named) return plan.sessions.find((s) => s.id === named.toLowerCase()) ?? null;
  const today = wall(now).wd;
  const done = new Set(doneThisWeek.map((e) => e.session));
  return plan.sessions.find((s) => s.day === today && !done.has(s.id)) ?? plan.sessions.find((s) => !done.has(s.id)) ?? plan.sessions.find((s) => s.day === today) ?? plan.sessions[0]!;
}

/** Logs one session done now. */
export async function logGymSession(blob: BlobBackend, named: string | null | undefined, via: GymVia, now: number): Promise<GymLogged> {
  return updateJson<GymFile, GymLogged>(blob, GYM_PATH, {}, (cur) => {
    const f = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
    const { plan } = planOf(f);
    const start = weekStart(now);
    const log = logOf(f.log);
    const week = log.filter((e) => Date.parse(e.at) >= start);
    const session = pickSession(plan, named, week, now);
    if (!session) return { next: null, result: { ok: false, error: "not-found" } };
    const entry: GymLogEntry = { id: `g-${now.toString(36)}-${randomBytes(3).toString("hex")}`, session: session.id, at: new Date(now).toISOString(), via };
    return { next: { ...f, log: trim([...log, entry], now) }, result: { ok: true, entry, session, doneThisWeek: week.length + 1, perWeek: plan.sessions.length } };
  });
}

/** Takes a logged session back (the Desk's Undo). False when there's no such entry. */
export async function unlogGymSession(blob: BlobBackend, id: unknown, now: number): Promise<boolean> {
  if (typeof id !== "string" || !ENTRY_ID.test(id)) return false;
  return updateJson<GymFile, boolean>(blob, GYM_PATH, {}, (cur) => {
    const f = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
    const log = logOf(f.log);
    if (!log.some((e) => e.id === id)) return { next: null, result: false };
    return { next: { ...f, log: trim(log.filter((e) => e.id !== id), now) }, result: true };
  });
}

/** What the shortcut says after logging: short, and quiet (#652). */
export function sayGymLogged(got: Extract<GymLogged, { ok: true }>): string {
  const left = got.perWeek - got.doneThisWeek;
  const tail = left > 0 ? `${got.doneThisWeek} of ${got.perWeek} this week.` : got.doneThisWeek === got.perWeek ? "That's the week done." : `${got.doneThisWeek} this week.`;
  return `Logged ${got.session.name}. ${tail}`;
}
