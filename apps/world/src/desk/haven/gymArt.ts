import { useEffect, useState } from "react";
import type { MealToShoot, PhotoState } from "../../../../../api/_haven/photoShape.ts";
import type { GymPlan } from "./gym.ts";
import { confirmPhotos, photoStates } from "./mealPhotos.ts";

/**
 * The Gym's exercise art (#718): one picture per exercise of the plan, made by the Haven's photo library
 * (api/_haven/photos.ts, style `workout`) with the project's OpenAI images key, under the same $10 a month cap, and
 * kept in the private store; it shows only to the passkey session. The library is asked once a page load for the
 * plan's exercises (at most ART_MAX), which it makes only the first time (the same exercise is the same picture), and
 * the pictures still being made are polled until they're in.
 */

export const ART_MAX = 10;
const POLL_MS = 20_000;
const POLLS = 30;

/** An exercise's id in the library: `gym-` and its name, slugged. */
export function artIdOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `gym-${slug || "exercise"}`;
}

/** What the library is asked for: each exercise of the plan once, in the plan's order, at most ART_MAX. */
export function artShoots(plan: GymPlan): MealToShoot[] {
  const seen = new Set<string>();
  const out: MealToShoot[] = [];
  for (const s of plan.sessions)
    for (const e of s.exercises) {
      const meal = artIdOf(e.name);
      if (seen.has(meal) || out.length >= ART_MAX) continue;
      seen.add(meal);
      out.push({ meal, name: e.name, description: e.perSide ? "worked one side at a time" : "", components: [], style: "workout" });
    }
  return out;
}

export interface Art {
  id: string;
  status: PhotoState;
}

let asked = "";
let cache = new Map<string, Art>();

/** The art for a plan's exercises, by exercise id (artIdOf); empty until the library answers, or where it doesn't. */
export function useGymArt(plan: GymPlan | null): Map<string, Art> {
  const [art, setArt] = useState<Map<string, Art>>(cache);
  const shoots = plan ? artShoots(plan) : [];
  const key = shoots.map((s) => s.meal).join(",");
  useEffect(() => {
    if (!key) return;
    let gone = false;
    let timer: number | undefined;
    const want = key.split(",");
    const poll = (left: number) => {
      const pending = want.map((m) => cache.get(m)).filter((a): a is Art => !!a && (a.status === "queued" || a.status === "making"));
      if (!pending.length || left <= 0) return;
      timer = window.setTimeout(() => {
        void photoStates(pending.map((a) => a.id)).then((states) => {
          if (gone || !states) return;
          const next = new Map(cache);
          for (const [m, a] of cache) {
            const st = states.get(a.id);
            if (st) next.set(m, { ...a, status: st });
          }
          cache = next;
          setArt(next);
          poll(left - 1);
        });
      }, POLL_MS);
    };
    if (asked === key) poll(POLLS);
    else {
      void confirmPhotos(shoots).then((got) => {
        if (!got) return;
        asked = key;
        const next = new Map(cache);
        for (const t of got.photos) next.set(t.meal, { id: t.id, status: t.status });
        cache = next;
        if (gone) return;
        setArt(next);
        poll(POLLS);
      });
    }
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
    // The shoots follow from the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return art;
}
