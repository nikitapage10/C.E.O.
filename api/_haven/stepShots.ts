/**
 * Cook steps' pictures at plan time (#1016). When a week is finalized, every recipe cooked that week (each dinner, and
 * each quick lunch that isn't leftovers) gets one picture per step queued in the meal photo library
 * (api/_haven/photos.ts), the same shots cook mode reads (`stepShotsOf`, rooms/haven/web/cook.ts), so opening a
 * recipe in cook mode only ever reads them. The library's own run makes them after the answer, one at a time, recipes'
 * photos first; the ten-minute timer (azure/src/index.ts, `haven_photos_tick`) picks up whatever a run left. A step
 * already in the library is never made again (same recipe as cooked, same key), and one that failed or hit the cap is
 * tried once more on the next finalize.
 *
 * Nothing here logs a meal, a step or a prompt: counts only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { cookLunchOf, cookOf, stepShotsOf } from "../../rooms/haven/web/cook.ts";
import { viewOf, type MealsFile } from "./mealShape.js";
import type { MealToShoot } from "./photoShape.js";

/** Every step picture the week (the current one, or the one ahead starting `week`) wants, each once. */
export function weekStepShots(file: MealsFile, week?: string): MealToShoot[] {
  const f = viewOf(file, week);
  if (!f.week) return [];
  const out: MealToShoot[] = [];
  const seen = new Set<string>();
  for (const s of f.week.slots) {
    for (const cook of [cookOf(f, s), cookLunchOf(f, s)]) {
      if (!cook) continue;
      for (const { shot } of stepShotsOf(cook)) {
        const sig = JSON.stringify([shot.meal, shot.description, shot.components]);
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(shot);
      }
    }
  }
  return out;
}
