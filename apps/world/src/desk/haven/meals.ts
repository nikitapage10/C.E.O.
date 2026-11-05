/**
 * The Kitchen's meal planner, browser side (#678; api/_haven/meals.ts). Signed in, the Kitchen reads the private
 * planner file (taste profile, catalog, week) and changes it with the same closed set of edits the server runs
 * (`applyEdit` in api/_haven/mealShape.ts): the page shows an edit at once and the server's answer replaces it. Every
 * answer is read again with `readMeals`, so a bad body can't put anything odd on the page.
 */

import { applyEdit, readMeals, type MealEdit, type MealsFile } from "../../../../../api/_haven/mealShape.ts";

export * from "../../../../../api/_haven/mealShape.ts";

const PATH = "/api/haven-meals";

export type MealsLoad = { state: "ready"; file: MealsFile | null } | { state: "off" } | { state: "out" } | { state: "failed" };

export async function loadMeals(f: typeof fetch = fetch): Promise<MealsLoad> {
  try {
    const res = await f(PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || res.status === 503 || !(res.headers.get("content-type") ?? "").includes("json")) return { state: "off" };
    if (!res.ok) return { state: "failed" };
    const body = (await res.json().catch(() => null)) as { meals?: unknown } | null;
    if (!body || !("meals" in body)) return { state: "failed" };
    return { state: "ready", file: body.meals === null ? null : readMeals(body.meals) };
  } catch {
    return { state: "failed" };
  }
}

export type MealsAction = { action: "edit"; edit: MealEdit } | { action: "confirm"; week?: string } | { action: "send"; week?: string } | { action: "reopen"; week?: string } | { action: "seed"; meals: unknown; replace?: boolean };

export interface MealsAnswer {
  ok: boolean;
  status: number;
  error: string | null;
  file: MealsFile | null;
  changes: string[];
  added: number;
  already: number;
  photos: number;
}

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000 ? v : 0);

export async function mealsAction(body: MealsAction, f: typeof fetch = fetch): Promise<MealsAnswer> {
  try {
    const res = await f(PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const got = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const changes = Array.isArray(got.changes)
      ? got.changes
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.slice(0, 200))
          .slice(0, 12)
      : [];
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? null : typeof got.error === "string" ? got.error.slice(0, 20) : "failed",
      file: got.meals ? readMeals(got.meals) : null,
      changes,
      added: count(got.added),
      already: count(got.already),
      photos: count(got.photos),
    };
  } catch {
    return { ok: false, status: 0, error: "failed", file: null, changes: [], added: 0, already: 0, photos: 0 };
  }
}

/** The edit shown at once, before the server answers (the server's file replaces it). */
export function preview(file: MealsFile, edit: MealEdit): MealsFile {
  const got = applyEdit(file, edit, Date.now());
  return got.ok ? got.file : file;
}

/** What the Kitchen says when a planner action didn't work. */
export const MEALS_NOTE: Record<string, string> = {
  "not-seeded": "The meal planner isn't loaded yet.",
  "no-week": "There's no week planned yet.",
  "not-found": "That isn't in the plan any more.",
  "no-backup": "Nothing else fits that night. Pick a meal from the catalog.",
  "no-undo": "Nothing to undo.",
  "bad-meal": "That doesn't fit there.",
  short: "The catalog is too small to plan a whole week.",
  empty: "Nothing to send: every night is HelloFresh or left out.",
  "bad-meals": "That file isn't a meal planner file.",
  full: "A month is planned: four weeks is the most.",
  already: "The planner is already loaded.",
  "signed-out": "Your session ended. Sign in again.",
  failed: "That didn't go through. Try again.",
};
