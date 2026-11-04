/**
 * The Haven Gym's workout plan, its shape (#660): what a weekly plan is, how one read from anywhere is checked, and the
 * default plan the Gym starts from. No server imports, so the Desk reads plans with the same code the endpoint does
 * (api/_haven/gym.ts).
 *
 * The repo holds only this shape and a generic default (a twice-a-week core routine anyone could follow). What Nikita
 * changes it to, and every session logged, is data in the private store, read only by a passkey session.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** 0 Sunday .. 6 Saturday, as `wall().wd` counts them (api/_today/parse.ts). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** One exercise: so many sets of reps, or of seconds held, on each side or not. */
export interface GymExercise {
  name: string;
  sets: number;
  /** Reps per set, or null when the set is held for `seconds`. */
  reps: number | null;
  seconds: number | null;
  perSide: boolean;
}

/** One session of the week: its letter, the day it falls on and what's in it. */
export interface GymSession {
  /** "a", "b", …: what "core day A" names. */
  id: string;
  name: string;
  day: Weekday;
  minutes: number;
  exercises: GymExercise[];
}

export interface GymPlan {
  v: 1;
  name: string;
  /** Rest between sets, in seconds: [least, most]. */
  rest: [number, number];
  /** How the plan moves on, in a line ("add a rep or five seconds each week"). */
  progress: string;
  sessions: GymSession[];
}

export const GYM_LIMITS = { sessions: 7, exercises: 12, sets: 10, reps: 100, seconds: 600, minutes: 180, rest: 600 } as const;
export const GYM_BODY_MAX = 16 * 1024;

/**
 * The default plan (Nikita's ask, 2026-11-04): core twice a week, Tuesday and Friday, about twenty minutes, resting 45
 * to 60 seconds between sets and moving on each week. Generic exercises with no personal numbers; editable.
 */
export const DEFAULT_GYM_PLAN: GymPlan = {
  v: 1,
  name: "Core",
  rest: [45, 60],
  progress: "Each week, add a rep or five seconds where the last set felt easy.",
  sessions: [
    {
      id: "a",
      name: "Core day A",
      day: 2,
      minutes: 20,
      exercises: [
        { name: "Dead bugs", sets: 3, reps: 10, seconds: null, perSide: true },
        { name: "Pallof press", sets: 3, reps: 10, seconds: null, perSide: true },
        { name: "Hanging knee raises", sets: 3, reps: 12, seconds: null, perSide: false },
        { name: "Side plank", sets: 3, reps: null, seconds: 30, perSide: true },
      ],
    },
    {
      id: "b",
      name: "Core day B",
      day: 5,
      minutes: 20,
      exercises: [
        { name: "Ab wheel rollouts", sets: 3, reps: 8, seconds: null, perSide: false },
        { name: "Cable woodchops", sets: 3, reps: 10, seconds: null, perSide: true },
        { name: "Bird dogs", sets: 3, reps: 10, seconds: null, perSide: true },
        { name: "Front plank", sets: 3, reps: null, seconds: 45, perSide: false },
      ],
    },
  ],
};

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
/** Plain words, no markup, capped. */
export const gymText = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\p{Cc}<>&"'`\\{}]/gu, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
const SESSION_ID = /^[a-g]$/;

function readExercise(v: unknown): GymExercise | null {
  const e = o(v);
  const name = gymText(e.name, 40);
  const sets = int(e.sets, 1, GYM_LIMITS.sets);
  const reps = e.reps === null || e.reps === undefined ? null : int(e.reps, 1, GYM_LIMITS.reps);
  const seconds = e.seconds === null || e.seconds === undefined ? null : int(e.seconds, 5, GYM_LIMITS.seconds);
  if (!name || sets === null) return null;
  // Reps or a hold, never both and never neither.
  if ((reps === null) === (seconds === null)) return null;
  return { name, sets, reps, seconds, perSide: e.perSide === true };
}

/** A plan read from anywhere (the store, an edit), checked and cleaned; null when it isn't one. */
export function readGymPlan(v: unknown): GymPlan | null {
  const b = o(v);
  if (b.v !== 1) return null;
  const seen = new Set<string>();
  const sessions: GymSession[] = [];
  for (const raw of (Array.isArray(b.sessions) ? b.sessions : []).slice(0, GYM_LIMITS.sessions)) {
    const s = o(raw);
    const id = typeof s.id === "string" ? s.id.toLowerCase() : "";
    if (!SESSION_ID.test(id) || seen.has(id)) continue;
    const day = int(s.day, 0, 6);
    const exercises = (Array.isArray(s.exercises) ? s.exercises : []).slice(0, GYM_LIMITS.exercises).map(readExercise).filter((e): e is GymExercise => e !== null);
    if (day === null || !exercises.length) continue;
    seen.add(id);
    sessions.push({ id, name: gymText(s.name, 40) || `Day ${id.toUpperCase()}`, day: day as Weekday, minutes: int(s.minutes, 5, GYM_LIMITS.minutes) ?? 20, exercises });
  }
  if (!sessions.length) return null;
  const rest = Array.isArray(b.rest) ? b.rest : [];
  const lo = int(rest[0], 0, GYM_LIMITS.rest) ?? 45;
  const hi = int(rest[1], 0, GYM_LIMITS.rest) ?? 60;
  return {
    v: 1,
    name: gymText(b.name, 32) || "Workout",
    rest: [Math.min(lo, hi), Math.max(lo, hi)],
    progress: gymText(b.progress, 140),
    sessions: sessions.sort((x, y) => x.id.localeCompare(y.id)),
  };
}

/** "3 × 10 / side", "3 × 30 s / side", as the Gym writes a dose. */
export function doseOf(e: GymExercise): string {
  const each = e.reps !== null ? `${e.reps}` : `${e.seconds} s`;
  return `${e.sets} × ${each}${e.perSide ? " / side" : ""}`;
}

/** The public face of the plan: how many sessions a week and how many are done this week. Never an exercise. */
export interface GymCounts {
  perWeek: number;
  doneThisWeek: number;
}
