/**
 * Recipe steps that make sense (#1036). A recipe's steps are written by whoever wrote the planner file (the Builder
 * seeding `haven/meals.json`, or Skippy's `meals_recipe` editing a night), and Nikita found ones that skip a part
 * outright: "brown the sausage, … toss with rigatoni" never boils the rigatoni. This is the check, and the repair the
 * planner makes on every dish it shows (`dishOf` in api/_haven/mealShape.ts), so a recipe already in his file is
 * complete the next time it's read, with nothing rewritten in the store and no model asked.
 *
 *   - `uncooked`: the dish's parts (protein, carb, side) that no step cooks: a part is cooked when one step names it
 *     (`usesOf`, cook mode's own matcher) and says how it's cooked for what it is (pasta boiled, rice simmered,
 *     potatoes roasted, tortillas warmed, meat seared or browned); a raw side only has to be served in some step.
 *   - `completeSteps`: the steps with one written step added for each part that's missing, where it belongs (rice and
 *     potatoes first, the pasta just before the step that tosses it, a raw side at the end), with the heat, the time
 *     and how to tell it's done. A recipe that already cooks everything comes back as it was, so it is idempotent.
 *   - `RECIPE_RULES`: the bar a written recipe meets, for whoever writes one (docs/HOME-DEVICES.md, "Writing a recipe").
 *
 * Also the step matcher cook mode uses (moved here from rooms/haven/web/cook.ts so the planner can use it too):
 * `lineNames`, `usesOf` and `partNames`. Pure, no imports at run time.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { Component, Role } from "./mealShape.js";

/** The bar for a written recipe (#1036), as said to whoever writes one. */
export const RECIPE_RULES =
  "Write every recipe as a cook would follow it: a dinner in about 5 to 8 steps (combine actions in one step where it reads naturally), each step at most 240 characters. Cook every part the dish uses in some step: boil the pasta in well-salted water (time, save pasta water), simmer the rice, roast the potatoes, warm the tortillas, sear or brown the protein; serve a raw side in a step. Give each cooking step the heat, the time and a doneness cue (\"over medium-high heat until browned, 6–8 min\"; \"until it darkens to brick red, about 2 min\"). Name each part by its name in the recipe (\"the rigatoni\", \"the chicken thighs\"), so swaps and the per-step amounts find it.";

/* ── The step matcher (#1010) ── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words a recipe might use for a component: its name, and each ingredient's name before a comma (longest first). */
export function partNames(c: Pick<Component, "name" | "ingredients">): string[] {
  const all = [c.name, ...c.ingredients.map((i) => i.item.split(",")[0]!.trim())].filter((x) => x.length >= 3);
  return [...new Set(all.map((x) => x.toLowerCase()))].sort((a, b) => b.length - a.length);
}

/** Words that say what kind, not what: never enough on their own to tie a step to an ingredient. */
const DESCRIPTIVE = new Set(
  "fresh ground raw large small medium italian greek boneless skinless black white red green yellow extra virgin dried dry chopped minced sliced diced whole baby plain light dark sweet hot mild lean frozen canned kosher sea unsalted salted low fat free sodium shredded grated crushed cooked uncooked thin thick cut boxed jarred block bunch each piece pieces head clove cloves".split(" "),
);

/** One ingredient line as a step might name it: its full names (the item, the part it belongs to) and its telling words. */
export interface LineNames {
  /** Whole names, matched as a phrase: "italian sausage", "protein pasta". */
  names: string[];
  /** Single words a step may use alone ("sausage", "chicken"), counted only when no other line shares them. */
  words: string[];
}

/** "Ground beef 85/15" → "ground beef"; "Lobster tail, 5 oz" → "lobster tail". */
const bare = (s: string) =>
  s
    .split(",")[0]!
    .toLowerCase()
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w))
    .join(" ")
    .trim();

/** The names a line can go by: the item, and the part it belongs to (its component's name). */
export function lineNames(item: string, part?: string): LineNames {
  const names = [...new Set([bare(item), part ? bare(part) : ""].filter((x) => x.length >= 3))];
  const words = [...new Set(names.flatMap((n) => n.split(" ")).filter((w) => w.length >= 3 && !DESCRIPTIVE.has(w)))];
  return { names, words };
}

/** A name as a pattern: whole words, an optional plural on the last ("tortilla" finds "tortillas", "peach" "peaches"). */
function patternOf(name: string): RegExp {
  const stem = name.replace(/(?:es|s)$/, (m) => (name.length - m.length >= 3 ? "" : m));
  return new RegExp(`(?<![\\p{L}])${esc(stem).replace(/ /g, "[\\s-]+")}(?:s|es)?(?![\\p{L}])`, "giu");
}

/**
 * The lines a step uses: first every line whose whole name the step says ("the Italian sausage"), then any single
 * telling word only one line has ("sear the chicken" → the chicken breast). A word inside a name already found counts
 * for nothing more, and a word two lines share ("pepper") ties the step to neither. In the order the step says them.
 */
export function usesOf(text: string, lines: LineNames[]): number[] {
  const found = new Map<number, number>();
  let rest = text;
  const blank = (m: RegExpExecArray) => (rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length));
  // Longest names first, so "protein pasta" wins over a shorter name inside it.
  const whole = lines.flatMap((l, k) => l.names.map((n) => ({ k, n }))).sort((a, b) => b.n.length - a.n.length);
  for (const { k, n } of whole) {
    const re = patternOf(n);
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      if (!found.has(k) || m.index < found.get(k)!) found.set(k, m.index);
      blank(m);
      re.lastIndex = 0;
    }
  }
  const owners = new Map<string, number[]>();
  lines.forEach((l, k) => l.words.forEach((w) => owners.set(w, [...(owners.get(w) ?? []), k])));
  for (const [w, ks] of owners) {
    if (ks.length !== 1 || found.has(ks[0]!)) continue;
    const m = patternOf(w).exec(rest);
    if (m) found.set(ks[0]!, m.index);
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

/* ── What a part is, and how it's cooked ── */

export type PartKind =
  | "pasta" | "rice" | "brown-rice" | "quinoa" | "grain" | "potato" | "fries" | "flatbread"
  | "chicken" | "steak" | "ground" | "sausage" | "shrimp" | "fish" | "lobster" | "pork" | "tofu" | "protein"
  | "beans" | "veg" | "raw";

/** What a component is, from its role, id, name and ingredients ("Rigatoni" is pasta, "Ground lamb" ground meat). */
export function kindOf(c: Pick<Component, "id" | "role" | "name" | "ingredients">): PartKind {
  const n = `${c.id} ${c.name} ${c.ingredients.map((i) => i.item).join(" ")}`.toLowerCase();
  const has = (re: RegExp) => re.test(n);
  if (c.role === "carb") {
    if (has(/\bfries\b|\btots\b/)) return "fries";
    if (has(/pasta|spaghetti|rigatoni|linguine|penne|fettuccine|orzo|noodle|macaroni|gnocchi|ziti|fusilli|tagliatelle|pappardelle|bucatini|orecchiette/)) return "pasta";
    if (has(/brown rice|brown-rice/)) return "brown-rice";
    if (has(/\brice\b/)) return "rice";
    if (has(/quinoa/)) return "quinoa";
    if (has(/potato/)) return "potato";
    if (has(/tortilla|pita|naan|bread|\bbuns?\b|\brolls?\b|wrap|lavash|arepa|bagel/)) return "flatbread";
    return "grain";
  }
  if (c.role === "protein") {
    if (has(/sausage|chorizo|bratwurst/)) return "sausage";
    if (has(/\bground\b|mince/)) return "ground";
    if (has(/shrimp|prawn|scallop/)) return "shrimp";
    if (has(/lobster|crab/)) return "lobster";
    if (has(/salmon|\bcod\b|fish|tuna|halibut|tilapia|trout|sea bass|mahi/)) return "fish";
    if (has(/tofu|tempeh/)) return "tofu";
    if (has(/pork|chop/)) return "pork";
    if (has(/chicken|turkey/)) return "chicken";
    if (has(/steak|ribeye|sirloin|strip|picanha|beef|lamb|brisket|flank|tenderloin|filet/)) return "steak";
    return "protein";
  }
  if (has(/beans|lentil|chickpea/)) return "beans";
  if (has(/\braw\b|salad|slaw|pico|kimchi|guac|chips|romaine|lettuce|cucumber|tomato|pickle|cabbage|snow pea|sauerkraut|salsa|greens|arugula/)) return "raw";
  return "veg";
}

const PROTEIN_VERBS = "sear|brown|cook|grill|roast|bake|fry|fri(?:ed|es)|saut|poach|simmer|broil|braise|stir-fry|crisp|char|smok";
/** The verbs that cook each kind; null: a raw side only has to be served. */
const VERBS: Record<PartKind, string | null> = {
  pasta: "boil|cook",
  rice: "cook|simmer|steam|boil",
  "brown-rice": "cook|simmer|steam|boil",
  quinoa: "cook|simmer|steam|boil",
  grain: "cook|simmer|steam|boil|toast",
  potato: "roast|bake|boil|fry|fri(?:ed|es)|mash|cook|crisp",
  fries: "bake|fry|cook|roast|crisp",
  flatbread: "warm|char|toast|heat|grill|griddle|crisp|cook",
  chicken: PROTEIN_VERBS,
  steak: PROTEIN_VERBS,
  ground: PROTEIN_VERBS,
  sausage: PROTEIN_VERBS,
  shrimp: PROTEIN_VERBS,
  fish: PROTEIN_VERBS,
  lobster: PROTEIN_VERBS,
  pork: PROTEIN_VERBS,
  tofu: PROTEIN_VERBS,
  protein: PROTEIN_VERBS,
  beans: "warm|heat|simmer|cook",
  veg: "roast|steam|saut|cook|blanch|grill|stir-fry|char|bake|boil|sear|fry",
  raw: null,
};

/** The step written for a part no step cooks: the heat, the time and how to tell it's done (`{n}`: the part's name). */
const COOK_STEP: Record<PartKind, string> = {
  pasta: "Bring a large pot of well-salted water to a boil. Cook the {n} 1–2 min short of the box time, about 10 min, until just al dente; save 1 cup of pasta water, then drain.",
  rice: "Rinse the {n}, bring it to a boil with 1¼ times its volume of water and a pinch of salt, then cover and simmer on low until the water is gone, about 15 min; rest 5 min and fluff.",
  "brown-rice": "Rinse the {n}, bring it to a boil with twice its volume of water and a pinch of salt, then cover and simmer on low until tender, about 40 min; rest 10 min and fluff.",
  quinoa: "Rinse the {n}, bring it to a boil with twice its volume of salted water, then cover and simmer on low until the water is absorbed, about 15 min; rest 5 min and fluff.",
  grain: "Cook the {n} in a pot of salted water at a gentle simmer until tender, as the package says, then drain or fluff it and keep it warm.",
  potato: "Heat the oven to 425°F. Cut the {n} into 1-inch chunks, toss with oil and salt and roast on a sheet pan until golden and crisp, 30–35 min, turning once.",
  fries: "Heat the oven to 425°F and bake the {n} in one layer until golden and crisp, 20–25 min, flipping halfway.",
  flatbread: "Warm the {n} in a dry skillet over medium-high heat until soft and lightly charred, 30–60 s a side; keep them wrapped in a towel.",
  chicken: "Season the {n} with salt and cook in an oiled skillet over medium-high heat until browned and cooked through (165°F inside), 5–7 min a side; rest 5 min.",
  steak: "Pat the {n} dry, salt it and sear in a smoking-hot oiled skillet over high heat until deeply browned, 3–5 min a side for medium-rare (130°F); rest 5 min and slice against the grain.",
  ground: "Brown the {n} in a wide skillet over medium-high heat, breaking it up, until no pink remains and the edges crisp, 6–8 min; spoon off excess fat.",
  sausage: "Brown the {n} in a wide skillet over medium-high heat, breaking it into bite-size pieces, until browned and cooked through, 6–8 min.",
  shrimp: "Pat the {n} dry, season with salt and sear in a hot oiled skillet over medium-high heat until pink and just opaque, 1–2 min a side.",
  fish: "Pat the {n} dry, season with salt and sear in a hot oiled skillet over medium-high heat until golden and it flakes easily, 3–4 min a side.",
  lobster: "Split the {n}, brush with oil, season and broil 5 inches from the heat until the meat is opaque (140°F), 6–8 min.",
  pork: "Season the {n} and sear it on all sides in a hot oiled skillet, about 5 min, then roast at 425°F until 145°F inside, 12–15 min; rest 5 min and slice.",
  tofu: "Press the {n} for 10 min, cut it into cubes and pan-fry in oil over medium-high heat until golden and crisp on all sides, 8–10 min.",
  protein: "Season the {n} with salt and cook it in an oiled skillet over medium-high heat until browned and cooked through, 5–8 min.",
  beans: "Warm the {n} with a splash of their liquid and a pinch of salt in a small pot over medium heat until hot, about 5 min.",
  veg: "Cook the {n} in an oiled skillet over medium-high heat until tender and lightly browned, 5–7 min; season with salt.",
  raw: "Serve the {n} on the side.",
};

/** Where a missing step goes: first (it takes longest), just before the step that first uses the part, or last. */
const PLACE: Record<PartKind, "first" | "before" | "last"> = {
  pasta: "before", rice: "first", "brown-rice": "first", quinoa: "first", grain: "first", potato: "first", fries: "first", flatbread: "before",
  chicken: "before", steak: "before", ground: "before", sausage: "before", shrimp: "before", fish: "before", lobster: "before", pork: "before", tofu: "before", protein: "before",
  beans: "before", veg: "before", raw: "last",
};

/** The name a written step calls a part: "the rigatoni", "the Yukon gold potatoes" (not "the roast potatoes"). */
export function stepName(c: Pick<Component, "name" | "ingredients">): string {
  const first = c.ingredients[0]?.item.split(",")[0]!.trim();
  const name = /^(roast|roasted|raw|plain|shredded|grilled|fried|steamed|boiled)\b/i.test(c.name) && first ? first.replace(/\s+\d.*$/, "") : c.name;
  return /^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name;
}

/** A part that no step cooks. */
export interface Gap {
  role: Role;
  component: string;
  kind: PartKind;
}

type Part = Pick<Component, "id" | "role" | "name" | "ingredients">;

interface Seen {
  /** Steps that name the part, by index. */
  named: number[];
  /** Whether one of them cooks it (or, for a raw side, serves it). */
  cooked: boolean;
}

/**
 * For each part: the steps that name it and whether one cooks it. `strict` asks for the part's whole name (its own or
 * an ingredient's: what a swap renames and a left-out part skips), as a recipe written now should; otherwise any telling
 * word counts ("sear the chicken" for chicken thighs), as cook mode reads a recipe written before.
 */
function seenOf(steps: string[], parts: Part[], extra: string[], strict: boolean): Seen[] {
  const lines = [...parts.flatMap((c, p) => c.ingredients.map((i) => ({ p, n: lineNames(i.item, c.name) }))), ...extra.map((x) => ({ p: -1, n: lineNames(x) }))];
  const allNames = lines.flatMap((l) => l.n.names).sort((a, b) => b.length - a.length);
  const seen: Seen[] = parts.map(() => ({ named: [], cooked: false }));
  steps.forEach((text, k) => {
    // The verbs are read with every ingredient's name taken out, so "the brown rice" is never a part browned.
    let verbsIn = text;
    for (const n of allNames) verbsIn = verbsIn.replace(patternOf(n), " ");
    const used = new Set(usesOf(text, lines.map((l) => l.n)).map((i) => lines[i]!.p));
    parts.forEach((c, p) => {
      const named = strict ? partNames(c).some((n) => new RegExp(`(?<![\\p{L}])${esc(n)}(?![\\p{L}])`, "iu").test(text)) : used.has(p);
      if (!named) return;
      seen[p]!.named.push(k);
      const verbs = VERBS[kindOf(c)];
      if (!verbs || new RegExp(`(?<![\\p{L}])(?:${verbs})\\p{L}*`, "iu").test(verbsIn)) seen[p]!.cooked = true;
    });
  });
  return seen;
}

/** The parts with something to cook (No carb and No side have nothing). */
const cookable = (parts: Array<Part | undefined>): Part[] => parts.filter((c): c is Part => !!c && c.ingredients.length > 0);

/**
 * The dish's parts that no step cooks (#1036): the pasta never boiled, the rice never cooked, a raw side never served.
 * `extra` is the dish's other ingredient names, so a word they share with a part isn't taken for the part.
 */
export function uncooked(steps: string[], parts: Array<Part | undefined>, extra: string[] = [], strict = false): Gap[] {
  const ps = cookable(parts);
  const seen = seenOf(steps, ps, extra, strict);
  return ps.flatMap((c, p) => (seen[p]!.cooked ? [] : [{ role: c.role, component: c.id, kind: kindOf(c) }]));
}

/**
 * The steps with a written step added for each part no step cooks (#1036), each where it belongs; at most `max` steps
 * in all (a recipe already that long is left as it is). A complete recipe comes back unchanged (the same array).
 */
export function completeSteps(steps: string[], parts: Array<Part | undefined>, extra: string[] = [], max = 16): string[] {
  const ps = cookable(parts);
  if (!ps.length) return steps;
  let out = steps;
  for (let p = 0; p < ps.length; p++) {
    const seen = seenOf(out, ps, extra, false)[p]!;
    if (seen.cooked) continue;
    if (out.length >= max) break;
    const c = ps[p]!;
    const kind = kindOf(c);
    const step = COOK_STEP[kind].replace("{n}", stepName(c));
    const place = PLACE[kind];
    const at = place === "first" ? 0 : place === "last" ? out.length : seen.named.length ? seen.named[0]! : kind === "pasta" || kind === "flatbread" || kind === "beans" || kind === "veg" ? Math.max(0, out.length - 1) : 0;
    out = [...out.slice(0, at), step, ...out.slice(at)];
  }
  return out;
}
