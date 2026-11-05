import { WEEKDAY_LONG, WEEKDAY_SHORT, doseOf, readGymPlan, type GymExercise, type GymPlan, type GymSession } from "../../../api/_haven/gymShape.ts";

export type { GymPlan, GymSession, GymExercise, Weekday } from "../../../api/_haven/gymShape.ts";
export { WEEKDAY_LONG, WEEKDAY_SHORT, doseOf, readGymPlan };

/**
 * The Haven Gym's plan, browser side (#660; api/_haven/gym.ts). A passkey session reads the plan, this week's log and
 * the last weeks' counts from /api/haven?view=gym, and logs, takes back and edits through POST /api/haven. Signed out
 * the Haven gets the counts only, from the status view. `scoreOf` lays a session out in time (how its twenty minutes
 * fall); pure, so it's tested on its own.
 */

export interface GymLogEntry {
  id: string;
  session: string;
  at: string;
  via: "desk" | "phone";
}

export interface GymView {
  plan: GymPlan;
  isDefault: boolean;
  week: { start: string; done: GymLogEntry[] };
  weeks: number[];
}

export type GymLoad = { state: "idle" } | { state: "ready"; view: GymView } | { state: "out" } | { state: "off" } | { state: "failed" };

const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

/** A view read from the server, checked: the plan through the same `readGymPlan` the endpoint uses. */
export function readGymView(v: unknown): GymView | null {
  const b = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const plan = readGymPlan(b.plan);
  const week = b.week && typeof b.week === "object" ? (b.week as Record<string, unknown>) : null;
  if (!plan || !week || typeof week.start !== "string") return null;
  const done = (Array.isArray(week.done) ? week.done : []).filter((e): e is GymLogEntry => !!e && typeof e === "object" && typeof (e as GymLogEntry).id === "string" && typeof (e as GymLogEntry).session === "string" && typeof (e as GymLogEntry).at === "string");
  const weeks = (Array.isArray(b.weeks) ? b.weeks : []).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return { plan, isDefault: b.isDefault === true, week: { start: week.start, done }, weeks };
}

export async function loadGym(f: typeof fetch = fetch): Promise<GymLoad> {
  try {
    const res = await f("/api/haven?view=gym", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || !isJson(res)) return { state: "off" };
    if (!res.ok) return { state: "failed" };
    const view = readGymView(await res.json().catch(() => null));
    return view ? { state: "ready", view } : { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

type Sent = { ok: true; view: GymView; entry?: GymLogEntry } | { ok: false; error: string };

async function send(body: unknown, f: typeof fetch): Promise<Sent> {
  try {
    const res = await f("/api/haven", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const got = (isJson(res) ? await res.json().catch(() => ({})) : {}) as { view?: unknown; entry?: GymLogEntry; error?: unknown };
    const view = res.ok ? readGymView(got.view) : null;
    if (view) return { ok: true, view, ...(got.entry && { entry: got.entry }) };
    return { ok: false, error: String(got.error ?? (res.status === 401 ? "signed-out" : "failed")) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export const logGym = (session: string, f: typeof fetch = fetch) => send({ action: "gym-log", session }, f);
export const unlogGym = (id: string, f: typeof fetch = fetch) => send({ action: "gym-unlog", id }, f);
export const saveGymPlan = (plan: GymPlan, f: typeof fetch = fetch) => send({ action: "gym-edit", edit: { op: "set", plan } }, f);
export const resetGymPlan = (f: typeof fetch = fetch) => send({ action: "gym-edit", edit: { op: "reset" } }, f);

export const GYM_NOTE: Record<string, string> = {
  "bad-plan": "That plan doesn't add up: every day needs at least one exercise.",
  "not-found": "That's already gone.",
  "signed-out": "Your session ended. Sign in again.",
  "not-set-up": "The private store isn't set up on this copy of the Desk.",
  failed: "That didn't go through. Try again.",
};

/* ── The score: a session laid out in time ── */

/** Seconds a rep takes, at an even tempo, for the estimate. */
export const REP_SECONDS = 3;

export interface ScoreSet {
  /** Seconds from the session's start. */
  at: number;
  len: number;
}

export interface ScoreRow {
  exercise: GymExercise;
  dose: string;
  sets: ScoreSet[];
  /** Where the row starts and ends, in seconds from the session's start (its rests included). */
  from: number;
  to: number;
}

export interface Score {
  rows: ScoreRow[];
  /** The estimated length, in seconds, resting the middle of the plan's range. */
  total: number;
  /** The rest used between sets and between exercises, in seconds. */
  rest: number;
}

/** One set's working time: reps at REP_SECONDS each, or the hold, on each side when it's per side. */
export const setSeconds = (e: GymExercise) => (e.reps !== null ? e.reps * REP_SECONDS : (e.seconds ?? 0)) * (e.perSide ? 2 : 1);

/**
 * A session laid out in time: every set where it falls, with the rest between sets and between exercises (the middle
 * of the plan's range). An estimate for the eye, not a timer.
 */
export function scoreOf(session: GymSession, restRange: [number, number]): Score {
  const rest = Math.round((restRange[0] + restRange[1]) / 2);
  let t = 0;
  const rows: ScoreRow[] = session.exercises.map((exercise, i) => {
    if (i > 0) t += rest;
    const from = t;
    const len = setSeconds(exercise);
    const sets: ScoreSet[] = [];
    for (let s = 0; s < exercise.sets; s++) {
      if (s > 0) t += rest;
      sets.push({ at: t, len });
      t += len;
    }
    return { exercise, dose: doseOf(exercise), sets, from, to: t };
  });
  return { rows, total: t, rest };
}

/** "21 min", "45 s". */
export const minutesOf = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** The plan's days in week order (Monday first), and which session falls on each. */
export function weekOf(plan: GymPlan): Array<{ wd: number; session: GymSession | null }> {
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => ({ wd, session: plan.sessions.find((s) => s.day === wd) ?? null }));
}

/** The session to show first: today's if there is one not yet done, else the next one coming, else the first. */
export function nextSession(plan: GymPlan, done: GymLogEntry[], today: number): GymSession {
  const did = new Set(done.map((e) => e.session));
  const order = [...plan.sessions].sort((a, b) => ((a.day - today + 7) % 7) - ((b.day - today + 7) % 7));
  return order.find((s) => !did.has(s.id)) ?? order[0]!;
}

/** The Gym's first line: how the week stands, in plain words. */
export function gymLine(plan: GymPlan, done: GymLogEntry[], today: number): string {
  const per = plan.sessions.length;
  const n = done.length;
  if (n >= per) return `${plan.name}, ${per === 2 ? "twice" : `${per} times`} a week. The week is done.`;
  const next = nextSession(plan, done, today);
  const when = next.day === today ? "today" : WEEKDAY_LONG[next.day];
  return `${plan.name}, ${per === 1 ? "once" : per === 2 ? "twice" : `${per} times`} a week. ${n} of ${per} done; ${next.name} is ${next.day === today ? "" : "on "}${when}.`;
}
