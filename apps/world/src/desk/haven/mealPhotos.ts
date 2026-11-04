/**
 * The planner's side of the meal photo library (#687, api/_haven/photos.ts; contract in docs/HOME-DEVICES.md, "The
 * meal photo library"). Confirm week hands the library each customized night as cooked (`shootOf`), puts the photo
 * ids it answers on those nights, and the Kitchen polls their states until they're ready. A photo shows only through
 * `photoUrl` (the passkey session's GET); a missing one falls back to the placeholder.
 */

import { PHOTO_STATES, photoUrl, type MealToShoot, type PhotoBudget, type PhotoState, type PhotoTicket } from "../../../../../api/_haven/photoShape.ts";
import { DAYS, slotDish, type Day, type MealsFile } from "../../../../../api/_haven/mealShape.ts";

export { photoUrl };
export type { PhotoState };

const PATH = "/api/haven-photos";
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const state = (v: unknown): PhotoState | null => ((PHOTO_STATES as readonly unknown[]).includes(v) ? (v as PhotoState) : null);
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** A customized night's dish, as the library wants it: the components after the swaps (at most eight). */
export function shootOf(f: MealsFile, day: Day): MealToShoot | null {
  const s = f.week?.slots[DAYS.indexOf(day)];
  const d = s ? slotDish(f, s) : null;
  if (!d) return null;
  const components = d.parts.map((p) => p.now).filter((c) => c && c.ingredients.length).map((c) => c!.name).slice(0, 8);
  return { meal: d.meal.id, name: d.meal.name, description: [d.meal.blurb, d.changes.join(", ")].filter(Boolean).join(" ").slice(0, 300), components, style: "plate" };
}

function budgetOf(v: unknown): PhotoBudget | null {
  const b = o(v);
  return typeof b.reached === "boolean" ? { month: String(b.month ?? "").slice(0, 7), images: Number(b.images) || 0, usd: Number(b.usd) || 0, capUsd: Number(b.capUsd) || 0, left: Number(b.left) || 0, reached: b.reached } : null;
}

/** The confirm-week hook: the library's ticket for each meal (same meal and components, same photo), or null. */
export async function confirmPhotos(meals: MealToShoot[], f: typeof fetch = fetch): Promise<{ photos: PhotoTicket[]; budget: PhotoBudget | null } | null> {
  if (!meals.length) return { photos: [], budget: null };
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ action: "confirm", meals }) });
    if (!res.ok) return null;
    const got = o(await res.json().catch(() => null));
    const photos = (Array.isArray(got.photos) ? got.photos : [])
      .map((p): PhotoTicket | null => {
        const x = o(p);
        const st = state(x.status);
        return typeof x.meal === "string" && typeof x.id === "string" && ID.test(x.id) && st ? { meal: x.meal, key: String(x.key ?? "").slice(0, 16), id: x.id, status: st } : null;
      })
      .filter((p): p is PhotoTicket => p !== null);
    return { photos, budget: budgetOf(got.budget) };
  } catch {
    return null;
  }
}

/** The states of some photos, by id (polled while any is queued or making). Null when the library didn't answer. */
export async function photoStates(ids: string[], f: typeof fetch = fetch): Promise<Map<string, PhotoState> | null> {
  const want = [...new Set(ids.filter((id) => ID.test(id)))].slice(0, 50);
  if (!want.length) return new Map();
  try {
    const res = await f(`${PATH}?view=catalog&ids=${want.join(",")}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const got = o(await res.json().catch(() => null));
    const out = new Map<string, PhotoState>();
    for (const p of Array.isArray(got.photos) ? got.photos : []) {
      const x = o(p);
      const st = state(x.status);
      if (typeof x.id === "string" && want.includes(x.id) && st) out.set(x.id, st);
    }
    return out;
  } catch {
    return null;
  }
}

/** What a night's photo says while it isn't there yet. */
export const PHOTO_WORD: Record<PhotoState, string | null> = { queued: "photo queued", making: "making the photo", ready: null, failed: "photo failed", budget: "photo cap reached" };
