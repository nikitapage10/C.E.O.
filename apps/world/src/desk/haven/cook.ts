/**
 * Cook mode (#705), the pure half: one night's dinner as it'll be cooked, for the full-screen, one-step-at-a-time view
 * (CookMode.tsx). Everything comes from the planner's own helpers (`slotDish`, which is `dishOf` with the night's
 * `custom`, and `portionsOf`), so the swapped parts, the portion and the heat match the drawer exactly. A step that
 * names a part that was swapped names the new one, marked; a step for a part left out (No carb, No side) says so.
 * Nothing new is read or stored.
 */

import { DAY_NAME, DAYS, lunchDish, portionsOf, shopLine, slotDish, type Component, type Day, type Dish, type Ingredient, type MealsFile, type Role, type Slot, type Spice } from "./meals.ts";

/** A run of a step's words; `swap` marks the new part's name where the recipe named the old one. */
export interface Run {
  text: string;
  swap?: boolean;
}

export interface CookStep {
  runs: Run[];
  /** "No rigatoni tonight": the step is for a part that's left out. */
  skip: string | null;
}

export interface CookPart {
  role: Role;
  name: string;
  /** The part as written, when it was swapped ("rigatoni"). */
  was: string | null;
}

export interface CookLine {
  item: string;
  amount: string;
  pantry: boolean;
}

export interface Cook {
  day: Day;
  /** Tonight's dinner, or the day's quick lunch (#719). */
  course: "dinner" | "lunch";
  dayName: string;
  name: string;
  cuisine: string;
  minutes: number;
  steps: CookStep[];
  parts: CookPart[];
  /** How many portions go in the pan tonight: one, two for two, one more for each lunch left over. */
  portions: number;
  /** The night's portion size (1, 1.25, …). */
  portion: number;
  /** Why it's more than one: "for two", "makes Tuesday's lunch". */
  why: string[];
  spice: Spice;
  /** The heat as the recipe wrote it, when tonight's is different. */
  spiceWas: Spice | null;
  /** The ingredients for every portion in the pan. */
  lines: CookLine[];
  changes: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words a recipe might use for a component: its name, and each ingredient's name before a comma. */
function namesOf(c: Component): string[] {
  const all = [c.name, ...c.ingredients.map((i) => i.item.split(",")[0]!.trim())].filter((x) => x.length >= 3);
  return [...new Set(all.map((x) => x.toLowerCase()))].sort((a, b) => b.length - a.length);
}

/** "Protein pasta" where the recipe wrote "rigatoni", lower-cased the way the recipe had it (acronyms kept: "NY strip"). */
function cased(found: string, name: string): string {
  if (found[0] === found[0]!.toUpperCase()) return name[0]!.toUpperCase() + name.slice(1);
  return /^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name;
}

interface Swap {
  find: RegExp;
  to: string | null;
  was: string;
}

/** One step's words with every swapped part renamed, and whether it's for a part left out tonight. */
export function stepOf(text: string, swaps: Swap[]): CookStep {
  let runs: Run[] = [{ text }];
  let skip: string | null = null;
  for (const s of swaps) {
    const next: Run[] = [];
    for (const r of runs) {
      if (r.swap) {
        next.push(r);
        continue;
      }
      let at = 0;
      s.find.lastIndex = 0;
      for (let m = s.find.exec(r.text); m; m = s.find.exec(r.text)) {
        if (s.to === null) {
          skip ??= `No ${s.was} tonight`;
          break;
        }
        if (m.index > at) next.push({ text: r.text.slice(at, m.index) });
        next.push({ text: cased(m[0], s.to), swap: true });
        at = m.index + m[0].length;
      }
      if (at < r.text.length) next.push({ text: r.text.slice(at) });
    }
    runs = next;
  }
  return { runs: runs.filter((r) => r.text.length > 0), skip };
}

/** "Rigatoni (8 oz)" → { item: "Rigatoni", amount: "8 oz" }, with the planner's own rounding (`shopLine`). */
function lineOf(i: Ingredient, k: number): CookLine {
  const line = shopLine({ ...i, qty: i.qty * k });
  const m = /^(.*) \(([^()]*)\)$/.exec(line);
  return { item: m ? m[1]! : line, amount: m ? m[2]! : "", pantry: !!i.pantry };
}

/** The night's dinner for cook mode, or null for a night with no meal (or a HelloFresh night: nothing to cook here). */
export function cookOf(f: MealsFile, s: Slot): Cook | null {
  const d = slotDish(f, s);
  if (!d || !f.week || s.helloFresh) return null;
  const i = DAYS.indexOf(s.day);
  const portions = portionsOf(f.week)[i] ?? 1;
  const why: string[] = [];
  if (s.forTwo) why.push("for two");
  f.week.slots.forEach((o, j) => {
    if (o.lunch.leftoverOf === i) why.push(`makes ${DAY_NAME[DAYS[j]!]}'s lunch`);
  });
  return cookDish(d, s.day, "dinner", portions, why);
}

/** The day's quick lunch for cook mode (#719), for one; null when the lunch is leftovers or plain text. */
export function cookLunchOf(f: MealsFile, s: Slot): Cook | null {
  const d = lunchDish(f, s);
  return d ? cookDish(d, s.day, "lunch", 1, []) : null;
}

function cookDish(d: Dish, day: Day, course: Cook["course"], portions: number, why: string[]): Cook {
  const swaps: Swap[] = [];
  for (const p of d.parts) {
    if (!p.base || !p.now || p.base.id === p.now.id) continue;
    const words = namesOf(p.base);
    if (!words.length) continue;
    swaps.push({
      find: new RegExp(`(?<![\\p{L}])(?:${words.map(esc).join("|")})(?![\\p{L}])`, "giu"),
      to: p.now.ingredients.length ? p.now.name : null,
      was: p.base.name.toLowerCase(),
    });
  }
  const steps = d.meal.steps.map((t) => stepOf(t, swaps));
  return {
    day,
    course,
    dayName: DAY_NAME[day],
    name: d.meal.name,
    cuisine: d.meal.cuisine,
    minutes: d.meal.minutes,
    steps,
    parts: d.parts.filter((p) => p.now && p.now.ingredients.length).map((p) => ({ role: p.role, name: p.now!.name, was: p.base && p.base.id !== p.now!.id ? p.base.name.toLowerCase() : null })),
    portions,
    portion: d.portion,
    why,
    spice: d.spice,
    spiceWas: d.spice !== d.meal.spice ? d.meal.spice : null,
    lines: d.ingredients.map((x) => lineOf(x, d.portion * portions)),
    changes: d.changes,
  };
}
