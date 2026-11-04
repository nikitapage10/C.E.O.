import { useEffect, useState } from "react";

/**
 * The Gym's exercise reference (#729): each exercise of the plan matched to an entry of free-exercise-db
 * (github.com/yuhonas/free-exercise-db, released under the Unlicense, so public domain), with its two photographed
 * frames, step-by-step instructions, the muscles it works, its equipment and level. Only the entries the Gym can use
 * are vendored, trimmed, under public/gym/exercises (index.json and <id>/0.jpg, 1.jpg), so nothing depends on GitHub.
 * The index is read once, when the Gym opens. It replaced the generated workout art (#718), which no longer runs.
 */

export interface ExerciseRef {
  id: string;
  name: string;
  level: string;
  equipment: string;
  category: string;
  primary: string[];
  secondary: string[];
  instructions: string[];
  frames: number;
}

/** A plan exercise's match: the entry, and whether it is the same movement or only the closest one the set has. */
export interface RefMatch {
  ref: ExerciseRef;
  exact: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");

/**
 * The plan's names the set calls something else: the same movement under another name, or (exact false) the
 * closest one it has. A name missing here and in the set has no reference, and the card says so.
 */
const ALIAS: Record<string, { id: string; exact: boolean }> = {
  "side plank": { id: "side-bridge", exact: true },
  "front plank": { id: "plank", exact: true },
  "ab wheel rollout": { id: "ab-roller", exact: true },
  "ab wheel": { id: "ab-roller", exact: true },
  "cable woodchop": { id: "standing-cable-wood-chop", exact: true },
  "woodchop": { id: "standing-cable-wood-chop", exact: true },
  "hanging knee raise": { id: "hanging-leg-raise", exact: false },
  "glute bridge": { id: "butt-lift-bridge", exact: true },
  "bicycle crunch": { id: "air-bike", exact: true },
  "lying leg raise": { id: "flat-bench-lying-leg-raise", exact: true },
};

/** The entry for a plan exercise's name, or null when the set has nothing close. Pure. */
export function refFor(name: string, list: ExerciseRef[]): RefMatch | null {
  const n = norm(name);
  const alias = ALIAS[n];
  if (alias) {
    const ref = list.find((r) => r.id === alias.id);
    if (ref) return { ref, exact: alias.exact };
  }
  const same = list.find((r) => norm(r.name) === n);
  if (same) return { ref: same, exact: true };
  // Every word of the plan's name in the entry's, or the other way round: "Plank" for "Plank", "Dead bugs" for "Dead Bug".
  const words = n.split(" ");
  let best: { ref: ExerciseRef; score: number } | null = null;
  for (const r of list) {
    const rw = norm(r.name).split(" ");
    const hit = words.filter((w) => rw.includes(w)).length;
    const score = hit / Math.max(words.length, rw.length);
    if (hit === words.length && (!best || score > best.score)) best = { ref: r, score };
  }
  return best && best.score >= 0.5 ? { ref: best.ref, exact: best.score === 1 } : null;
}

/** A frame's picture, served from the Desk's own files. */
export const frameUrl = (id: string, i: number) => `/gym/exercises/${id}/${i}.jpg`;

/** A demo to watch: a YouTube search for the exercise, opened in a new tab (never embedded). */
export const demoUrl = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise form`)}`;

/** Read a fetched index: the entries that have what a card needs, nothing else. */
export function readIndex(v: unknown): ExerciseRef[] {
  const list = v && typeof v === "object" && Array.isArray((v as { exercises?: unknown }).exercises) ? (v as { exercises: unknown[] }).exercises : [];
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const out: ExerciseRef[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(o.id) || typeof o.name !== "string") continue;
    out.push({
      id: o.id,
      name: o.name,
      level: typeof o.level === "string" ? o.level : "",
      equipment: typeof o.equipment === "string" ? o.equipment : "",
      category: typeof o.category === "string" ? o.category : "",
      primary: strs(o.primary),
      secondary: strs(o.secondary),
      instructions: strs(o.instructions),
      frames: typeof o.frames === "number" ? Math.max(0, Math.min(2, o.frames)) : 0,
    });
  }
  return out;
}

let index: Promise<ExerciseRef[]> | null = null;

/** The vendored index, read once a page load; empty while it loads or if it can't be read. */
export function useExerciseRefs(): ExerciseRef[] {
  const [list, setList] = useState<ExerciseRef[]>([]);
  useEffect(() => {
    let gone = false;
    index ??= fetch("/gym/exercises/index.json", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then(readIndex)
      .catch(() => {
        index = null;
        return [];
      });
    void index.then((l) => !gone && setList(l));
    return () => {
      gone = true;
    };
  }, []);
  return list;
}
