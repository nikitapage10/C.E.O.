/**
 * The Haven Kitchen's meal planner (#678): the shapes, the reader that checks every file and body as untrusted data,
 * and the pure edits. No I/O and nothing Node-only, so the server (api/_haven/meals.ts) and the Desk
 * (apps/world/src/desk/haven/MealPlanner.tsx) run the very same `applyEdit`: the Desk shows an edit at once and the
 * server's answer replaces it.
 *
 * One file holds it all (`haven/meals.json` in the private store, passkey-only):
 *   - the taste profile: the protein goal, the budget (only ever in the store), the top-up, what to avoid (`avoid`, with an `unless`, so "no
 *     avocado unless it's guac with chips" is one rule), likes and plain rules;
 *   - the catalog: every meal, its own ingredients, its swappable parts (protein, carb, side: ids in the component
 *     library), its macros as built, a photo id, how often it was had, and whether Nikita passed on it;
 *   - the week: seven slots, each a meal with two backups, lunch, for two, HelloFresh, in the cart, and how it was
 *     customized (`custom`: a part swapped for another component, the portion, the spice);
 *   - lunches (#719): a catalog meal with `course: "lunch"` is a quick lunch (a salad, a cook-yourself lunch). A day's
 *     lunch is last night's leftovers (`leftoverOf`: that dinner is cooked one portion bigger) or one of those, with
 *     its own two backups. A file from before lunches (every meal a dinner, lunches as plain text) reads as it was;
 *   - one Undo.
 *
 * The swap model (Nikita, 07:57Z, "change out the grains or the carbs... really customizable"): a meal's protein, carb
 * and side are parts that point into the component library (COMPONENTS, plus any `components` the file adds). Swapping
 * a part takes the old component's ingredients out and the new one's in, and moves the macros by the difference, so
 * the protein ring and the shopping list follow at once. Talk to edit (PR2) drives the same `customize` edit. A
 * customized night shows "photo pending" until the week is confirmed; `confirm` queues those nights in
 * `week.photoQueue`, the hook the photo library (#687) reads to make each one's own picture (`slot.photo`).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_NAME: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const ROLES = ["protein", "carb", "side"] as const;
export type Role = (typeof ROLES)[number];
export const SPICES = ["mild", "medium", "hot"] as const;
export type Spice = (typeof SPICES)[number];
export const PORTIONS = [0.75, 1, 1.25, 1.5] as const;
export const UNITS = ["lb", "oz", "cup", "tbsp", "tsp", "each", "clove", "can", "jar", "pack", "bunch", "slice", "tub", "bag", "bottle"] as const;
export type Unit = (typeof UNITS)[number];

export interface Macros {
  protein: number;
  carbs: number;
  fat: number;
  kcal: number;
}

export interface Ingredient {
  item: string;
  /** For one portion. */
  qty: number;
  unit: Unit;
  /** A staple kept in the kitchen (salt, oil): shown in the recipe, never sent to the list. */
  pantry?: boolean;
}

/** A swappable piece of a meal: its ingredients and macros for one portion. */
export interface Component {
  id: string;
  role: Role;
  name: string;
  ingredients: Ingredient[];
  macros: Macros;
}

export interface Part {
  role: Role;
  /** A component id. */
  option: string;
}

export type MealSource = "seed" | "desk" | "skippy";
export const COURSES = ["dinner", "lunch"] as const;
export type Course = (typeof COURSES)[number];

export interface Meal {
  id: string;
  name: string;
  cuisine: string;
  minutes: number;
  blurb: string;
  steps: string[];
  /** Everything but the parts (sauce, aromatics, toppings), for one portion. */
  ingredients: Ingredient[];
  parts: Part[];
  /** The whole meal as built, parts included, for one portion. */
  macros: Macros;
  spice: Spice;
  /** The photo's id in the photo library (#687, api/_haven/photos.ts), or null. */
  photo: string | null;
  timesHad: number;
  lastHad: string | null;
  passed: boolean;
  source: MealSource;
  /** A dinner (the default, and every meal in a file from before #719) or a quick lunch. */
  course: Course;
}

export interface Custom {
  /** Part index → component id. */
  parts?: Record<string, string>;
  portion?: number;
  spice?: Spice;
}

export interface Lunch {
  text: string;
  /** What it counts when nothing better is known (a plain-text lunch, leftovers from a HelloFresh night). */
  protein: number;
  /** The day index whose dinner it's left over from: that dinner is cooked one portion bigger. */
  leftoverOf: number | null;
  /** What it needs from the store beyond the leftovers, for the one lunch. */
  shop: Ingredient[];
  /** A quick lunch from the catalog (`course: "lunch"`), or null: leftovers or a plain-text lunch (#719). */
  meal: string | null;
  /** Two other quick lunches to swap in. */
  backups: string[];
}

export interface Slot {
  day: Day;
  meal: string;
  backups: string[];
  lunch: Lunch;
  forTwo: boolean;
  helloFresh: boolean;
  inCart: boolean;
  custom: Custom;
  /** This night's own photo from the photo library (#687) for a customized meal, else null. */
  photo: string | null;
}

export interface Avoid {
  term: string;
  /** The rule doesn't apply to a meal that also has this ("avocado" unless "tortilla chips"). */
  unless?: string;
}

export interface Profile {
  proteinGoal: number;
  /** Dollars a week, set only in the private store (never a number in the repo); null when not set. */
  budget: { min: number; max: number } | null;
  topUp: { text: string; protein: number; shop: Ingredient[] };
  /** What a HelloFresh night counts for, protein-wise. */
  helloFreshProtein: number;
  /** Monday's lunch, and any lunch that isn't a leftover, when the catalog has no quick lunches. */
  salad: Lunch;
  /** The days that get a quick lunch when a week is planned (Monday always does: Sunday's leftovers are last week's). */
  lunchDays: Day[];
  /** The nights cooked for two by default when a week is planned. */
  forTwo: Day[];
  avoid: Avoid[];
  /** What Nikita said he likes ("spicy food", "salmon"): a meal that has one is planned first among equals. */
  likes: string[];
  rules: string[];
  /** The house heat: how hot every night is cooked unless the night says otherwise. Null: as each meal is written. */
  spice: Spice | null;
}

export interface Week {
  /** The Monday, YYYY-MM-DD. */
  start: string;
  slots: Slot[];
  /** "Try something new?": meal ids not had yet. */
  picks: string[];
  confirmedAt: string | null;
  /** Days whose customized meal needs its own photo (the photo library's queue, #687). */
  photoQueue: Day[];
  sentAt: string | null;
}

export interface MealsState {
  profile: Profile;
  catalog: Meal[];
  /** Components beyond the library (Talk to edit may add one). */
  components: Component[];
  week: Week | null;
}

export interface MealsFile extends MealsState {
  v: 1;
  undo: { label: string; at: string; state: MealsState } | null;
}

/* ── The component library: generic, one portion each, raw vegetables only (Nikita's rule) ── */

const m = (protein: number, carbs: number, fat: number, kcal: number): Macros => ({ protein, carbs, fat, kcal });
const ing = (item: string, qty: number, unit: Unit, pantry?: boolean): Ingredient => ({ item, qty, unit, ...(pantry && { pantry }) });
const c = (id: string, role: Role, name: string, ingredients: Ingredient[], macros: Macros): Component => ({ id, role, name, ingredients, macros });

export const COMPONENTS: readonly Component[] = [
  // Proteins: a generous portion, about 3/4 lb raw.
  c("chicken-thigh", "protein", "Chicken thighs", [ing("Chicken thighs, boneless", 0.75, "lb")], m(72, 0, 28, 560)),
  c("chicken-breast", "protein", "Chicken breast", [ing("Chicken breast", 0.75, "lb")], m(80, 0, 9, 420)),
  c("ground-beef", "protein", "Ground beef", [ing("Ground beef 85/15", 0.75, "lb")], m(68, 0, 51, 730)),
  c("skirt-steak", "protein", "Skirt steak", [ing("Skirt steak", 0.75, "lb")], m(74, 0, 36, 630)),
  c("sirloin", "protein", "Sirloin steak", [ing("Sirloin steak", 0.75, "lb")], m(78, 0, 24, 540)),
  c("ribeye", "protein", "Ribeye", [ing("Ribeye steak", 0.75, "lb")], m(66, 0, 60, 820)),
  c("strip", "protein", "NY strip", [ing("NY strip steak", 0.75, "lb")], m(72, 0, 40, 660)),
  c("picanha", "protein", "Picanha", [ing("Picanha (sirloin cap)", 0.75, "lb")], m(70, 0, 48, 720)),
  c("italian-sausage", "protein", "Italian sausage", [ing("Italian sausage", 0.5, "lb")], m(40, 2, 60, 720)),
  c("shrimp", "protein", "Shrimp", [ing("Raw shrimp 16/20", 0.75, "lb")], m(70, 0, 4, 340)),
  c("lobster", "protein", "Lobster tail", [ing("Lobster tail, 5 oz", 1, "each")], m(27, 0, 1, 120)),
  c("ground-lamb", "protein", "Lamb", [ing("Ground lamb", 0.6, "lb")], m(46, 0, 64, 770)),
  c("pork-tenderloin", "protein", "Pork tenderloin", [ing("Pork tenderloin", 0.75, "lb")], m(76, 0, 12, 420)),
  c("tofu", "protein", "Tofu", [ing("Extra-firm tofu", 1, "pack")], m(40, 8, 22, 380)),
  // Carbs and grains.
  c("jasmine-rice", "carb", "Jasmine rice", [ing("Jasmine rice", 0.5, "cup")], m(6, 74, 0, 340)),
  c("brown-rice", "carb", "Brown rice", [ing("Brown rice", 0.5, "cup")], m(7, 72, 3, 340)),
  c("quinoa", "carb", "Quinoa", [ing("Quinoa", 0.5, "cup")], m(12, 55, 5, 320)),
  c("potatoes", "carb", "Roast potatoes", [ing("Yukon gold potatoes", 0.6, "lb")], m(5, 45, 0, 200)),
  c("fries", "carb", "Fries", [ing("Frozen fries", 0.4, "bag")], m(4, 48, 14, 330)),
  c("spaghetti", "carb", "Spaghetti", [ing("Spaghetti", 4, "oz")], m(14, 84, 2, 420)),
  c("rigatoni", "carb", "Rigatoni", [ing("Rigatoni", 4, "oz")], m(14, 84, 2, 420)),
  c("linguine", "carb", "Linguine", [ing("Linguine", 4, "oz")], m(14, 84, 2, 420)),
  c("protein-pasta", "carb", "Protein pasta", [ing("Protein pasta", 4, "oz")], m(28, 64, 4, 420)),
  c("corn-tortillas", "carb", "Corn tortillas", [ing("Corn tortillas", 4, "each")], m(6, 44, 3, 220)),
  c("flour-tortillas", "carb", "Flour tortillas", [ing("Flour tortillas", 2, "each")], m(8, 50, 8, 300)),
  c("pita", "carb", "Pita", [ing("Pita bread", 1, "each")], m(6, 33, 1, 165)),
  c("no-carb", "carb", "No carb", [], m(0, 0, 0, 0)),
  // Sides: raw only.
  c("kimchi", "side", "Kimchi", [ing("Kimchi", 0.25, "jar")], m(1, 4, 0, 20)),
  c("cucumber-salad", "side", "Cucumber and tomato", [ing("Cucumber", 0.5, "each"), ing("Tomato", 1, "each")], m(2, 7, 0, 35)),
  c("snow-peas", "side", "Raw snow peas", [ing("Snow peas", 3, "oz")], m(2, 6, 0, 35)),
  c("cabbage", "side", "Shredded raw cabbage", [ing("Green cabbage", 0.25, "each")], m(2, 8, 0, 35)),
  c("romaine", "side", "Plain romaine", [ing("Romaine hearts", 0.5, "each")], m(1, 3, 0, 15)),
  c("pico", "side", "Pico de gallo", [ing("Pico de gallo", 0.25, "tub")], m(1, 4, 0, 20)),
  c("chips-guac", "side", "Chips and guac", [ing("Tortilla chips", 0.33, "bag"), ing("Avocado", 1, "each"), ing("Lime", 1, "each")], m(5, 40, 30, 450)),
  c("black-beans", "side", "Black beans", [ing("Black beans", 0.5, "can")], m(11, 30, 1, 170)),
  c("no-side", "side", "No side", [], m(0, 0, 0, 0)),
];

/* ── Reading untrusted data ── */

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** One plain line: no control characters, no angle brackets, single spaces, capped. */
export const plain = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\p{Cc}<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const int = (v: unknown, lo: number, hi: number, dflt: number) => Math.round(num(v, lo, hi, dflt));
const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
const oneOf = <T extends string>(set: readonly T[], v: unknown, dflt: T): T => ((set as readonly unknown[]).includes(v) ? (v as T) : dflt);
export const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export const CATALOG_MAX = 160;
export const COMPONENTS_MAX = 80;
const LIST_CAP = 40;

const macrosOf = (v: unknown): Macros => {
  const x = o(v);
  return { protein: int(x.protein, 0, 400, 0), carbs: int(x.carbs, 0, 600, 0), fat: int(x.fat, 0, 400, 0), kcal: int(x.kcal, 0, 6000, 0) };
};

function ingredientOf(v: unknown): Ingredient | null {
  const x = o(v);
  const item = plain(x.item, 60);
  if (!item) return null;
  return { item, qty: Math.round(num(x.qty, 0, 100, 1) * 100) / 100, unit: oneOf(UNITS, x.unit, "each"), ...(x.pantry === true && { pantry: true }) };
}
const ingredientsOf = (v: unknown) => arr(v).map(ingredientOf).filter((i): i is Ingredient => i !== null).slice(0, LIST_CAP);

function componentOf(v: unknown): Component | null {
  const x = o(v);
  if (!isId(x.id) || !(ROLES as readonly unknown[]).includes(x.role)) return null;
  const name = plain(x.name, 40);
  return name ? { id: x.id, role: x.role as Role, name, ingredients: ingredientsOf(x.ingredients), macros: macrosOf(x.macros) } : null;
}

function mealOf(v: unknown): Meal | null {
  const x = o(v);
  const name = plain(x.name, 80);
  if (!isId(x.id) || !name) return null;
  return {
    id: x.id,
    name,
    cuisine: plain(x.cuisine, 30) || "Other",
    minutes: int(x.minutes, 5, 240, 30),
    blurb: plain(x.blurb, 240),
    steps: arr(x.steps).map((s) => plain(s, 240)).filter(Boolean).slice(0, 12),
    ingredients: ingredientsOf(x.ingredients),
    parts: arr(x.parts)
      .map((p) => o(p))
      .filter((p) => (ROLES as readonly unknown[]).includes(p.role) && isId(p.option))
      .map((p) => ({ role: p.role as Role, option: p.option as string }))
      .slice(0, 6),
    macros: macrosOf(x.macros),
    spice: oneOf(SPICES, x.spice, "medium"),
    photo: isId(x.photo) ? x.photo : null,
    timesHad: int(x.timesHad, 0, 999, 0),
    lastHad: iso(x.lastHad),
    passed: x.passed === true,
    source: oneOf(["seed", "desk", "skippy"] as const, x.source, "desk"),
    course: oneOf(COURSES, x.course, "dinner"),
  };
}

function lunchOf(v: unknown): Lunch {
  const x = o(v);
  const lo = x.leftoverOf;
  const leftoverOf = typeof lo === "number" && Number.isInteger(lo) && lo >= 0 && lo < 7 ? lo : null;
  return {
    text: plain(x.text, 80) || "Lunch",
    protein: int(x.protein, 0, 200, 0),
    leftoverOf,
    shop: ingredientsOf(x.shop).slice(0, 8),
    // Leftovers or a quick lunch, never both.
    meal: leftoverOf === null && isId(x.meal) ? x.meal : null,
    backups: arr(x.backups).filter(isId).slice(0, 3),
  };
}

function customOf(v: unknown): Custom {
  const x = o(v);
  const parts: Record<string, string> = {};
  for (const [k, id] of Object.entries(o(x.parts))) if (/^[0-5]$/.test(k) && isId(id)) parts[k] = id;
  const portion = (PORTIONS as readonly unknown[]).includes(x.portion) ? (x.portion as number) : undefined;
  const spice = (SPICES as readonly unknown[]).includes(x.spice) ? (x.spice as Spice) : undefined;
  return { ...(Object.keys(parts).length && { parts }), ...(portion !== undefined && portion !== 1 && { portion }), ...(spice && { spice }) };
}

function slotOf(v: unknown, i: number): Slot | null {
  const x = o(v);
  if (!isId(x.meal)) return null;
  return {
    day: DAYS[i]!,
    meal: x.meal,
    backups: arr(x.backups).filter(isId).slice(0, 3),
    lunch: lunchOf(x.lunch),
    forTwo: x.forTwo === true,
    helloFresh: x.helloFresh === true,
    inCart: x.inCart !== false,
    custom: customOf(x.custom),
    photo: isId(x.photo) ? x.photo : null,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function weekOf(v: unknown): Week | null {
  const x = o(v);
  if (typeof x.start !== "string" || !DATE.test(x.start) || !Number.isFinite(Date.parse(x.start))) return null;
  const slots = arr(x.slots).slice(0, 7).map(slotOf);
  if (slots.length !== 7 || slots.some((s) => s === null)) return null;
  return {
    start: x.start,
    slots: slots as Slot[],
    picks: arr(x.picks).filter(isId).slice(0, 6),
    confirmedAt: iso(x.confirmedAt),
    photoQueue: arr(x.photoQueue).filter((d): d is Day => (DAYS as readonly unknown[]).includes(d)),
    sentAt: iso(x.sentAt),
  };
}

const words = (v: unknown, max: number, cap = 20) => arr(v).map((s) => plain(s, max)).filter(Boolean).slice(0, cap);

export const DEFAULT_PROFILE: Profile = {
  proteinGoal: 200,
  budget: null,
  topUp: { text: "A protein shake", protein: 50, shop: [] },
  helloFreshProtein: 45,
  salad: { text: "A quick salad with chicken", protein: 50, leftoverOf: null, shop: [], meal: null, backups: [] },
  lunchDays: ["mon", "thu"],
  forTwo: [],
  avoid: [],
  likes: [],
  rules: [],
  spice: null,
};

function profileOf(v: unknown): Profile {
  const x = o(v);
  const b = o(x.budget);
  const t = o(x.topUp);
  const min = typeof b.min === "number" ? int(b.min, 0, 2000, 0) : null;
  const max = typeof b.max === "number" ? int(b.max, 0, 2000, 0) : null;
  return {
    proteinGoal: int(x.proteinGoal, 40, 400, DEFAULT_PROFILE.proteinGoal),
    budget: min !== null && max !== null ? { min, max: Math.max(min, max) } : null,
    topUp: { text: plain(t.text, 80) || DEFAULT_PROFILE.topUp.text, protein: int(t.protein, 0, 200, DEFAULT_PROFILE.topUp.protein), shop: ingredientsOf(t.shop).slice(0, 8) },
    helloFreshProtein: int(x.helloFreshProtein, 0, 200, DEFAULT_PROFILE.helloFreshProtein),
    salad: x.salad ? { ...lunchOf(x.salad), leftoverOf: null, meal: null, backups: [] } : DEFAULT_PROFILE.salad,
    lunchDays: Array.isArray(x.lunchDays) ? DAYS.filter((d) => (x.lunchDays as unknown[]).includes(d)) : DEFAULT_PROFILE.lunchDays,
    forTwo: arr(x.forTwo).filter((d): d is Day => (DAYS as readonly unknown[]).includes(d)),
    avoid: arr(x.avoid)
      .map((a) => o(a))
      .map((a) => ({ term: plain(a.term, 40).toLowerCase(), unless: plain(a.unless, 40).toLowerCase() }))
      .filter((a) => a.term.length >= 2)
      .map((a) => (a.unless ? a : { term: a.term }))
      .slice(0, 40),
    likes: words(x.likes, 80),
    rules: words(x.rules, 120),
    spice: (SPICES as readonly unknown[]).includes(x.spice) ? (x.spice as Spice) : null,
  };
}

function stateOf(x: Record<string, unknown>): MealsState {
  const seen = new Set<string>();
  const catalog = arr(x.catalog)
    .map(mealOf)
    .filter((meal): meal is Meal => meal !== null && !seen.has(meal.id) && Boolean(seen.add(meal.id)))
    .slice(0, CATALOG_MAX);
  const week = weekOf(x.week);
  // A week naming a meal the catalog doesn't have is dropped: the planner never shows a night it can't explain.
  const course = new Map(catalog.map((meal) => [meal.id, meal.course]));
  const lunchFix = (l: Lunch): Lunch => ({
    ...l,
    // A lunch naming a meal the catalog doesn't have (or a dinner) falls back to its own text.
    meal: l.meal && course.get(l.meal) === "lunch" ? l.meal : null,
    backups: l.backups.filter((b) => course.get(b) === "lunch" && b !== l.meal).slice(0, 2),
  });
  const okWeek =
    week && week.slots.every((s) => course.get(s.meal) === "dinner")
      ? { ...week, slots: week.slots.map((s) => ({ ...s, backups: s.backups.filter((b) => course.get(b) === "dinner" && b !== s.meal), lunch: lunchFix(s.lunch) })), picks: week.picks.filter((p) => course.get(p) === "dinner") }
      : null;
  return {
    profile: profileOf(x.profile),
    catalog,
    components: arr(x.components).map(componentOf).filter((cp): cp is Component => cp !== null).slice(0, COMPONENTS_MAX),
    week: okWeek,
  };
}

/** A whole file (or a seed), checked. Null when it holds no catalog at all. */
export function readMeals(v: unknown): MealsFile | null {
  const x = o(v);
  const state = stateOf(x);
  if (!state.catalog.length) return null;
  const u = o(x.undo);
  const undoState = x.undo ? stateOf(o(u.state)) : null;
  return { v: 1, ...state, undo: undoState && undoState.catalog.length && iso(u.at) ? { label: plain(u.label, 80), at: iso(u.at)!, state: undoState } : null };
}

/* ── Reading the plan ── */

export const componentNamed = (f: Pick<MealsState, "components">, id: string): Component | undefined => f.components.find((x) => x.id === id) ?? COMPONENTS.find((x) => x.id === id);
export const allComponents = (f: Pick<MealsState, "components">): Component[] => [...COMPONENTS.filter((x) => !f.components.some((y) => y.id === x.id)), ...f.components];
export const mealNamed = (f: Pick<MealsState, "catalog">, id: string): Meal | undefined => f.catalog.find((x) => x.id === id);

/** One night's meal as it'll be cooked: its parts as customized, the ingredients and macros for one portion. */
export interface Dish {
  meal: Meal;
  parts: Array<{ index: number; role: Role; base: Component | undefined; now: Component | undefined }>;
  ingredients: Ingredient[];
  macros: Macros;
  portion: number;
  spice: Spice;
  /** "Quinoa for jasmine rice", "1.25 portions", "Hot". */
  changes: string[];
  customized: boolean;
}

const add = (a: Macros, b: Macros, k = 1): Macros => ({ protein: a.protein + b.protein * k, carbs: a.carbs + b.carbs * k, fat: a.fat + b.fat * k, kcal: a.kcal + b.kcal * k });
const round = (x: Macros, k = 1): Macros => ({ protein: Math.max(0, Math.round(x.protein * k)), carbs: Math.max(0, Math.round(x.carbs * k)), fat: Math.max(0, Math.round(x.fat * k)), kcal: Math.max(0, Math.round(x.kcal * k)) });

export function dishOf(f: Pick<MealsState, "components"> & { profile?: Pick<Profile, "spice"> }, meal: Meal, custom: Custom = {}): Dish {
  let macros = meal.macros;
  const ingredients: Ingredient[] = [...meal.ingredients];
  const changes: string[] = [];
  const parts = meal.parts.map((p, index) => {
    const base = componentNamed(f, p.option);
    const want = custom.parts?.[String(index)];
    const swapped = want && want !== p.option ? componentNamed(f, want) : undefined;
    const now = swapped && swapped.role === p.role ? swapped : base;
    if (now && base && now !== base) {
      macros = add(add(macros, base.macros, -1), now.macros);
      changes.push(now.ingredients.length ? `${now.name} for ${base.name.toLowerCase()}` : `No ${base.name.toLowerCase()}`);
    }
    if (now) ingredients.push(...now.ingredients);
    return { index, role: p.role, base, now };
  });
  const portion = custom.portion ?? 1;
  if (portion !== 1) changes.push(`${portion} portions`);
  // The house heat (the taste profile's) isn't a change to the night: only a night's own spice is.
  const spice = custom.spice ?? f.profile?.spice ?? meal.spice;
  if (custom.spice && custom.spice !== meal.spice) changes.push(spice === "mild" ? "Mild" : spice === "hot" ? "Hot" : "Medium heat");
  return { meal, parts, ingredients, macros: round(macros, portion), portion, spice, changes, customized: changes.length > 0 };
}

export const slotDish = (f: MealsState, s: Slot): Dish | null => {
  const meal = mealNamed(f, s.meal);
  return meal ? dishOf(f, meal, s.custom) : null;
};

/** A day's quick lunch from the catalog, as written, or null (leftovers or a plain-text lunch). */
export const lunchDish = (f: MealsState, s: Slot): Dish | null => {
  const meal = s.lunch.meal ? mealNamed(f, s.lunch.meal) : undefined;
  return meal ? dishOf(f, meal) : null;
};

/** The night a day's lunch is left over from, or null. */
export const leftoverSlot = (f: MealsState, s: Slot): Slot | null => (s.lunch.leftoverOf === null ? null : (f.week?.slots[s.lunch.leftoverOf] ?? null));

export interface LunchView {
  kind: "quick" | "leftovers" | "text";
  /** "Steak and snow pea salad", "Leftover chicken katsu", or the lunch's own text. */
  name: string;
  /** The night it's left over from. */
  from: Day | null;
  protein: number;
  dish: Dish | null;
}

/**
 * A day's lunch as the planner shows and counts it: a quick lunch's own macros, leftovers counted as one more
 * portion of that night's dinner as it'll be cooked (so a swap or a part changed follows at once), else the text.
 */
export function lunchView(f: MealsState, s: Slot): LunchView {
  const dish = lunchDish(f, s);
  if (dish) return { kind: "quick", name: dish.meal.name, from: null, protein: dish.macros.protein, dish };
  const from = leftoverSlot(f, s);
  if (from) {
    const d = from.helloFresh ? null : slotDish(f, from);
    return { kind: "leftovers", name: d ? `Leftover ${d.meal.name}` : `Leftover ${DAY_NAME[from.day]} dinner`, from: from.day, protein: d ? d.macros.protein : s.lunch.protein, dish: null };
  }
  return { kind: "text", name: s.lunch.text, from: null, protein: s.lunch.protein, dish: null };
}

/** The day's protein: dinner (or HelloFresh's), lunch and the top-up. */
export function dayProtein(f: MealsState, s: Slot): { dinner: number; lunch: number; topUp: number; total: number } {
  const dinner = s.helloFresh ? f.profile.helloFreshProtein : (slotDish(f, s)?.macros.protein ?? 0);
  const lunch = lunchView(f, s).protein;
  const topUp = f.profile.topUp.protein;
  return { dinner, lunch, topUp, total: dinner + lunch + topUp };
}

/** Whether a set of ingredient names breaks an avoid rule (a whole-word match, so "pea" isn't "peanut"). */
export function breaks(avoid: Avoid[], names: string[]): Avoid | null {
  const text = ` ${names.join(" | ").toLowerCase().replace(/[^\p{L}\p{N}|]+/gu, " ")} `;
  const has = (t: string) => new RegExp(`(?:^|[^\\p{L}])${t.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ")}(?:es|s)?(?=[^\\p{L}]|$)`, "u").test(text);
  return avoid.find((a) => has(a.term) && !(a.unless && has(a.unless))) ?? null;
}
const dishBreaks = (f: MealsState, meal: Meal, custom?: Custom) => breaks(f.profile.avoid, [meal.name, ...dishOf(f, meal, custom).ingredients.map((i) => i.item)]);

export type MealStatus = "week" | "backup" | "new" | "had" | "passed" | "avoid";

export function statusOf(f: MealsState, meal: Meal): MealStatus {
  if (meal.passed) return "passed";
  if (f.week?.slots.some((s) => s.meal === meal.id || s.lunch.meal === meal.id)) return "week";
  if (dishBreaks(f, meal)) return "avoid";
  if (f.week?.slots.some((s) => s.backups.includes(meal.id) || s.lunch.backups.includes(meal.id))) return "backup";
  return meal.timesHad > 0 ? "had" : "new";
}

/** Meals the planner may pick for a course: not passed, nothing avoided, not in `exclude`; least had and longest ago first. */
export function candidates(f: MealsState, exclude: Iterable<string> = [], course: Course = "dinner"): Meal[] {
  const no = new Set(exclude);
  const liked = (meal: Meal) => (likesOf(f, meal) ? 0 : 1);
  return f.catalog
    .filter((meal) => meal.course === course && !meal.passed && !no.has(meal.id) && !dishBreaks(f, meal))
    .sort((a, b) => a.timesHad - b.timesHad || liked(a) - liked(b) || (a.lastHad ?? "").localeCompare(b.lastHad ?? "") || b.macros.protein - a.macros.protein || a.id.localeCompare(b.id));
}

/** The first of Nikita's likes a meal has (by its name, cuisine or ingredients, whole words), or null. */
export function likesOf(f: Pick<MealsState, "profile" | "components">, meal: Meal): string | null {
  if (!f.profile.likes.length) return null;
  const names = [meal.name, meal.cuisine, ...dishOf(f, meal).ingredients.map((i) => i.item)];
  return f.profile.likes.find((like) => breaks([{ term: like.toLowerCase() }], names)) ?? null;
}

const inWeek = (w: Week) => new Set(w.slots.flatMap((s) => [s.meal, ...s.backups]));

/** Two backups for a night: the same cuisine first, then whatever's freshest, never a meal already in the week. */
function backupsFor(f: MealsState, main: Meal, keep: string[], used: Set<string>): string[] {
  const out = keep.filter((id) => id !== main.id && mealNamed(f, id) && candidates(f).some((x) => x.id === id)).slice(0, 2);
  const pool = candidates(f, [main.id, ...used, ...out]);
  for (const meal of [...pool.filter((x) => x.cuisine === main.cuisine), ...pool]) {
    if (out.length >= 2) break;
    if (!out.includes(meal.id)) out.push(meal.id);
  }
  return out;
}

/** Two backup lunches: whatever's freshest, never the day's own. Lunches may repeat across the week. */
function lunchBackupsFor(f: MealsState, main: string | null, keep: string[]): string[] {
  const ok = candidates(f, main ? [main] : [], "lunch");
  const out = keep.filter((id) => ok.some((x) => x.id === id)).slice(0, 2);
  for (const meal of ok) {
    if (out.length >= 2) break;
    if (!out.includes(meal.id)) out.push(meal.id);
  }
  return out;
}

const leftovers = (i: number): Lunch => ({ text: `Leftover ${DAY_NAME[DAYS[i - 1]!]} dinner`, protein: 0, leftoverOf: i - 1, shop: [], meal: null, backups: [] });

/**
 * The week's lunches (#719): last night's leftovers most days, a quick lunch from the catalog on the profile's lunch
 * days and on Monday (no leftovers yet), each with two backups. With no quick lunches in the catalog, those days
 * get the profile's plain-text salad, as before lunches were planned.
 */
export function planLunches(f: MealsState, slots: Slot[]): void {
  const used = new Set<string>();
  slots.forEach((s, i) => {
    if (i > 0 && !f.profile.lunchDays.includes(s.day)) {
      const l = leftovers(i);
      l.protein = slotDish(f, slots[i - 1]!)?.macros.protein ?? 0;
      s.lunch = { ...l, backups: lunchBackupsFor(f, null, []) };
      return;
    }
    const pool = candidates(f, [], "lunch");
    const pick = pool.find((x) => !used.has(x.id)) ?? pool[0];
    if (!pick) {
      s.lunch = { ...f.profile.salad, meal: null, backups: [] };
      return;
    }
    used.add(pick.id);
    s.lunch = { text: pick.name, protein: pick.macros.protein, leftoverOf: null, shop: [], meal: pick.id, backups: lunchBackupsFor(f, pick.id, []) };
  });
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A fresh week from the catalog: seven mains (no cuisine twice running), backups, lunches, picks. */
export function planWeek(f: MealsState, start: string, prev: Week | null = null): Week | null {
  const used = new Set<string>();
  const mains: Meal[] = [];
  const lastWeek = new Set(prev?.slots.map((s) => s.meal) ?? []);
  for (let i = 0; i < 7; i++) {
    const pool = candidates(f, used);
    const fresh = pool.filter((x) => !lastWeek.has(x.id));
    const from = fresh.length ? fresh : pool;
    const pick = from.find((x) => x.cuisine !== mains[i - 1]?.cuisine) ?? from[0];
    if (!pick) return null;
    mains.push(pick);
    used.add(pick.id);
  }
  const slots: Slot[] = mains.map((meal, i) => ({
    day: DAYS[i]!,
    meal: meal.id,
    backups: [],
    lunch: { ...f.profile.salad },
    forTwo: f.profile.forTwo.includes(DAYS[i]!),
    helloFresh: false,
    inCart: true,
    custom: {},
    photo: null,
  }));
  for (const s of slots) {
    s.backups = backupsFor(f, mealNamed(f, s.meal)!, [], used);
    s.backups.forEach((b) => used.add(b));
  }
  planLunches(f, slots);
  const picks = candidates(f, used)
    .filter((x) => x.timesHad === 0)
    .slice(0, 3)
    .map((x) => x.id);
  return { start, slots, picks, confirmedAt: null, photoQueue: [], sentAt: null };
}

/* ── The edits: one closed set, the same on the Desk, the server and Skippy's tools ── */

export type MealEdit =
  | { op: "swap"; day: Day; meal: string }
  | { op: "nope"; day: Day }
  | { op: "night"; day: Day; helloFresh?: boolean; forTwo?: boolean; inCart?: boolean }
  | { op: "customize"; day: Day; part?: { index: number; option: string }; portion?: number; spice?: Spice; reset?: boolean }
  | { op: "avoid"; term: string; unless?: string }
  | { op: "unavoid"; term: string }
  /** A like for the taste profile ("salmon", "spicy food"), or taken back off. */
  | { op: "like"; term: string; liked: boolean }
  /** The house heat for every night (null: as each meal is written); a night's own spice still wins. */
  | { op: "heat"; spice: Spice | null }
  | { op: "goal"; protein: number }
  | { op: "pass"; meal: string; passed: boolean }
  /** A day's lunch (#719): a quick lunch from the catalog (`meal`), or last night's leftovers (`leftovers`). */
  | { op: "lunch"; day: Day; meal?: string; leftovers?: true }
  | { op: "next-week" }
  | { op: "confirm" }
  | { op: "undo" }
  /** The photo library's id, written back by the Desk: a night's own photo (`day`) or a catalog meal's (`meal`). No Undo. */
  | { op: "photo"; day?: Day; meal?: string; photo: string };

const isDay = (v: unknown): v is Day => (DAYS as readonly unknown[]).includes(v);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/** An edit from a request or a tool call, checked; null when it isn't one. */
export function readEdit(v: unknown): MealEdit | null {
  const x = o(v);
  switch (x.op) {
    case "swap":
      return isDay(x.day) && isId(x.meal) ? { op: "swap", day: x.day, meal: x.meal } : null;
    case "nope":
      return isDay(x.day) ? { op: "nope", day: x.day } : null;
    case "night": {
      if (!isDay(x.day)) return null;
      const e = { op: "night" as const, day: x.day, helloFresh: bool(x.helloFresh), forTwo: bool(x.forTwo), inCart: bool(x.inCart) };
      return e.helloFresh === undefined && e.forTwo === undefined && e.inCart === undefined ? null : JSON.parse(JSON.stringify(e));
    }
    case "customize": {
      if (!isDay(x.day)) return null;
      const p = o(x.part);
      const part = typeof p.index === "number" && Number.isInteger(p.index) && p.index >= 0 && p.index < 6 && isId(p.option) ? { index: p.index, option: p.option } : undefined;
      const portion = (PORTIONS as readonly unknown[]).includes(x.portion) ? (x.portion as number) : undefined;
      const spice = (SPICES as readonly unknown[]).includes(x.spice) ? (x.spice as Spice) : undefined;
      const reset = x.reset === true || undefined;
      if (!part && portion === undefined && !spice && !reset) return null;
      return { op: "customize", day: x.day, ...(part && { part }), ...(portion !== undefined && { portion }), ...(spice && { spice }), ...(reset && { reset }) };
    }
    case "avoid": {
      const term = plain(x.term, 40).toLowerCase();
      const unless = plain(x.unless, 40).toLowerCase();
      return term.length >= 2 ? { op: "avoid", term, ...(unless && { unless }) } : null;
    }
    case "unavoid": {
      const term = plain(x.term, 40).toLowerCase();
      return term ? { op: "unavoid", term } : null;
    }
    case "like": {
      const term = plain(x.term, 40).toLowerCase();
      return term.length >= 2 && typeof x.liked === "boolean" ? { op: "like", term, liked: x.liked } : null;
    }
    case "heat":
      return x.spice === null || (SPICES as readonly unknown[]).includes(x.spice) ? { op: "heat", spice: (x.spice as Spice | null) ?? null } : null;
    case "goal":
      return typeof x.protein === "number" && x.protein >= 40 && x.protein <= 400 ? { op: "goal", protein: Math.round(x.protein) } : null;
    case "pass":
      return isId(x.meal) && typeof x.passed === "boolean" ? { op: "pass", meal: x.meal, passed: x.passed } : null;
    case "lunch":
      if (!isDay(x.day) || (x.leftovers === true) === isId(x.meal)) return null;
      return x.leftovers === true ? { op: "lunch", day: x.day, leftovers: true } : { op: "lunch", day: x.day, meal: x.meal as string };
    case "next-week":
    case "confirm":
    case "undo":
      return { op: x.op };
    case "photo":
      if (!isId(x.photo) || isDay(x.day) === isId(x.meal)) return null;
      return isDay(x.day) ? { op: "photo", day: x.day, photo: x.photo } : { op: "photo", meal: x.meal as string, photo: x.photo };
    default:
      return null;
  }
}

export type EditResult = { ok: true; file: MealsFile; changes: string[] } | { ok: false; error: "no-week" | "not-found" | "no-backup" | "no-undo" | "bad-meal" | "short" };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nameOf = (f: MealsState, id: string) => mealNamed(f, id)?.name ?? id;

/** Puts `meal` on a night: a backup trades places with the main; anything else pushes the main into the backups. */
function putOn(f: MealsState, day: Day, meal: string): string | null {
  const w = f.week!;
  const s = w.slots[DAYS.indexOf(day)]!;
  if (s.meal === meal) return null;
  const old = s.meal;
  w.slots.forEach((o2) => (o2.backups = o2.backups.filter((b) => b !== meal)));
  s.backups = [old, ...s.backups].filter((b) => b !== meal).slice(0, 2);
  s.meal = meal;
  s.custom = {};
  s.photo = null;
  w.picks = w.picks.filter((p) => p !== meal);
  return `${DAY_NAME[day]}: ${nameOf(f, meal)} instead of ${nameOf(f, old)}.`;
}

/** Replaces a night's main with its first usable backup (or the catalog's freshest), refilling the backups. */
function replaceMain(f: MealsState, day: Day): string | null {
  const w = f.week!;
  const s = w.slots[DAYS.indexOf(day)]!;
  const old = s.meal;
  const ok = new Set(candidates(f).map((x) => x.id));
  const used = inWeek(w);
  const next = s.backups.find((b) => ok.has(b)) ?? candidates(f, used).find((x) => x.cuisine === mealNamed(f, old)?.cuisine)?.id ?? candidates(f, used)[0]?.id;
  if (!next) return null;
  s.meal = next;
  s.custom = {};
  s.photo = null;
  const others = new Set(w.slots.filter((x) => x !== s).flatMap((x) => [x.meal, ...x.backups]));
  s.backups = backupsFor(f, mealNamed(f, next)!, s.backups.filter((b) => b !== next && b !== old), new Set([...others, old]));
  w.picks = w.picks.filter((p) => p !== next);
  return `${DAY_NAME[day]}: ${nameOf(f, next)} instead of ${nameOf(f, old)}.`;
}

/** Puts a quick lunch on a day (`meal`), or last night's leftovers (null); what was there becomes a backup. */
function putLunch(f: MealsState, day: Day, meal: string | null): string | null {
  const i = DAYS.indexOf(day);
  const s = f.week!.slots[i]!;
  const was = lunchView(f, s);
  if (meal === null) {
    if (i === 0 || s.lunch.leftoverOf !== null) return null;
    s.lunch = { ...leftovers(i), protein: slotDish(f, f.week!.slots[i - 1]!)?.macros.protein ?? 0, backups: lunchBackupsFor(f, null, [s.lunch.meal ?? "", ...s.lunch.backups]) };
  } else {
    if (s.lunch.meal === meal) return null;
    const m = mealNamed(f, meal)!;
    s.lunch = { text: m.name, protein: m.macros.protein, leftoverOf: null, shop: [], meal, backups: lunchBackupsFor(f, meal, [s.lunch.meal ?? "", ...s.lunch.backups]) };
  }
  return `${DAY_NAME[day]}'s lunch: ${lunchView(f, s).name} instead of ${was.name.toLowerCase()}.`;
}

/** A day's quick lunch that no longer fits (passed on, avoided): its first usable backup, else leftovers, else the salad. */
function replaceLunch(f: MealsState, s: Slot): string {
  const ok = candidates(f, [], "lunch");
  const next = s.lunch.backups.find((b) => ok.some((x) => x.id === b)) ?? ok.find((x) => x.id !== s.lunch.meal)?.id;
  const i = DAYS.indexOf(s.day);
  const said = next ? putLunch(f, s.day, next) : i > 0 ? putLunch(f, s.day, null) : null;
  if (said) return said;
  s.lunch = { ...f.profile.salad, meal: null, backups: [] };
  return `${DAY_NAME[s.day]}'s lunch: ${s.lunch.text}.`;
}

/** Drops backups that no longer fit (passed on, or avoided) and tops each night back up to two. */
function refill(f: MealsState) {
  const w = f.week!;
  const ok = new Set(candidates(f).map((x) => x.id));
  for (const s of w.slots) s.lunch.backups = lunchBackupsFor(f, s.lunch.meal, s.lunch.backups);
  for (const s of w.slots) {
    s.backups = s.backups.filter((b) => ok.has(b));
    if (s.backups.length >= 2) continue;
    const others = new Set(w.slots.filter((x) => x !== s).flatMap((x) => [x.meal, ...x.backups]));
    s.backups = backupsFor(f, mealNamed(f, s.meal)!, s.backups, others);
  }
}

/** Applies one edit (pure). The file comes back new, with Undo set for anything that changed the plan. */
export function applyEdit(file: MealsFile, edit: MealEdit, now: number): EditResult {
  if (edit.op === "undo") {
    if (!file.undo) return { ok: false, error: "no-undo" };
    return { ok: true, file: { v: 1, ...clone(file.undo.state), undo: null }, changes: [`Undid: ${file.undo.label}`] };
  }
  const f: MealsState = clone({ profile: file.profile, catalog: file.catalog, components: file.components, week: file.week });
  const before: MealsState = clone(f);
  const stamp = new Date(now).toISOString();
  const changes: string[] = [];
  let label = "";
  const needWeek = (): Week | null => f.week;

  if (edit.op === "photo") {
    // Set when the photo library answers, never by a tap: it changes nothing about what's cooked, so the Undo stays as it was.
    if (edit.day) {
      if (!f.week) return { ok: false, error: "no-week" };
      f.week.slots[DAYS.indexOf(edit.day)]!.photo = edit.photo;
      f.week.photoQueue = f.week.photoQueue.filter((d) => d !== edit.day);
    } else {
      const meal = mealNamed(f, edit.meal ?? "");
      if (!meal) return { ok: false, error: "not-found" };
      meal.photo = edit.photo;
    }
    return { ok: true, file: { v: 1, ...f, undo: file.undo }, changes: ["Photo saved."] };
  }

  switch (edit.op) {
    case "swap": {
      if (!needWeek()) return { ok: false, error: "no-week" };
      const meal = mealNamed(f, edit.meal);
      if (!meal || meal.passed || meal.course !== "dinner") return { ok: false, error: "bad-meal" };
      const said = putOn(f, edit.day, meal.id);
      if (said) changes.push(said);
      label = `${DAY_NAME[edit.day]} swapped`;
      break;
    }
    case "nope": {
      if (!needWeek()) return { ok: false, error: "no-week" };
      const s = f.week!.slots[DAYS.indexOf(edit.day)]!;
      const meal = mealNamed(f, s.meal)!;
      meal.passed = true;
      const said = replaceMain(f, edit.day);
      if (!said) return { ok: false, error: "no-backup" };
      changes.push(`Passed on ${meal.name}.`, said);
      label = `Not for me: ${meal.name}`;
      break;
    }
    case "lunch": {
      if (!needWeek()) return { ok: false, error: "no-week" };
      let meal: Meal | undefined;
      if (edit.meal) {
        meal = mealNamed(f, edit.meal);
        if (!meal || meal.passed || meal.course !== "lunch") return { ok: false, error: "bad-meal" };
      } else if (edit.day === "mon") return { ok: false, error: "bad-meal" };
      const said = putLunch(f, edit.day, meal?.id ?? null);
      if (said) changes.push(said);
      label = `${DAY_NAME[edit.day]}'s lunch`;
      break;
    }
    case "night": {
      if (!needWeek()) return { ok: false, error: "no-week" };
      const s = f.week!.slots[DAYS.indexOf(edit.day)]!;
      if (edit.helloFresh !== undefined) {
        s.helloFresh = edit.helloFresh;
        changes.push(`${DAY_NAME[edit.day]}: ${edit.helloFresh ? "HelloFresh, so nothing to cook or buy" : "back to cooking"}.`);
      }
      if (edit.forTwo !== undefined) {
        s.forTwo = edit.forTwo;
        changes.push(`${DAY_NAME[edit.day]}: ${edit.forTwo ? "for two" : "for one"}.`);
      }
      if (edit.inCart !== undefined) {
        s.inCart = edit.inCart;
        changes.push(`${DAY_NAME[edit.day]}: ${edit.inCart ? "in the cart" : "left out of the cart"}.`);
      }
      label = `${DAY_NAME[edit.day]} changed`;
      break;
    }
    case "customize": {
      if (!needWeek()) return { ok: false, error: "no-week" };
      const s = f.week!.slots[DAYS.indexOf(edit.day)]!;
      const meal = mealNamed(f, s.meal)!;
      if (edit.reset) s.custom = {};
      if (edit.part) {
        const p = meal.parts[edit.part.index];
        const cp = componentNamed(f, edit.part.option);
        if (!p || !cp || cp.role !== p.role) return { ok: false, error: "bad-meal" };
        const parts = { ...(s.custom.parts ?? {}) };
        if (edit.part.option === p.option) delete parts[String(edit.part.index)];
        else parts[String(edit.part.index)] = edit.part.option;
        s.custom = { ...s.custom, parts };
        if (!Object.keys(parts).length) delete s.custom.parts;
      }
      if (edit.portion !== undefined) {
        s.custom = { ...s.custom, portion: edit.portion };
        if (edit.portion === 1) delete s.custom.portion;
      }
      if (edit.spice) {
        s.custom = { ...s.custom, spice: edit.spice };
        if (edit.spice === (f.profile.spice ?? meal.spice)) delete s.custom.spice;
      }
      s.photo = null;
      const d = dishOf(f, meal, s.custom);
      changes.push(d.customized ? `${DAY_NAME[edit.day]}: ${meal.name}, ${d.changes.join(", ").toLowerCase()}.` : `${DAY_NAME[edit.day]}: ${meal.name} as written.`);
      label = `${DAY_NAME[edit.day]} customized`;
      break;
    }
    case "avoid": {
      const rule: Avoid = { term: edit.term, ...(edit.unless && { unless: edit.unless }) };
      f.profile.avoid = [...f.profile.avoid.filter((a) => a.term !== rule.term), rule].slice(-40);
      changes.push(`Noted: no ${rule.term}${rule.unless ? ` unless there's ${rule.unless}` : ""}.`);
      for (const s of f.week?.slots ?? []) {
        const meal = mealNamed(f, s.meal)!;
        if (!dishBreaks(f, meal, s.custom)) continue;
        const said = replaceMain(f, s.day);
        changes.push(said ?? `${DAY_NAME[s.day]}: ${meal.name} has ${rule.term}, and nothing else fits. Swap it by hand.`);
      }
      for (const s of f.week?.slots ?? []) {
        const lunch = s.lunch.meal ? mealNamed(f, s.lunch.meal) : undefined;
        if (lunch && dishBreaks(f, lunch)) changes.push(replaceLunch(f, s));
      }
      if (f.week) refill(f);
      if (breaks([rule], [f.profile.topUp.text, ...f.profile.topUp.shop.map((i) => i.item)])) changes.push(`The daily top-up has ${rule.term} in it; change it in the taste profile.`);
      if (f.week?.slots.some((s) => !s.lunch.meal && breaks([rule], [s.lunch.text, ...s.lunch.shop.map((i) => i.item)]))) changes.push(`A lunch has ${rule.term} in it.`);
      label = `No ${rule.term}`;
      break;
    }
    case "unavoid": {
      const had = f.profile.avoid.length;
      f.profile.avoid = f.profile.avoid.filter((a) => a.term !== edit.term);
      if (f.profile.avoid.length === had) return { ok: false, error: "not-found" };
      changes.push(`${edit.term[0]!.toUpperCase()}${edit.term.slice(1)} is back on the table.`);
      label = `${edit.term} allowed`;
      break;
    }
    case "like": {
      const had = f.profile.likes.some((l) => l.toLowerCase() === edit.term);
      if (!edit.liked && !had) return { ok: false, error: "not-found" };
      f.profile.likes = edit.liked ? [...f.profile.likes.filter((l) => l.toLowerCase() !== edit.term), edit.term].slice(-20) : f.profile.likes.filter((l) => l.toLowerCase() !== edit.term);
      changes.push(edit.liked ? `Noted: you like ${edit.term}. Meals with it come first when a week is planned.` : `Took ${edit.term} off your likes.`);
      label = edit.liked ? `Likes ${edit.term}` : `${edit.term} off the likes`;
      break;
    }
    case "heat": {
      f.profile.spice = edit.spice;
      // A night set to what is now the house heat no longer needs its own.
      for (const s of f.week?.slots ?? []) if (s.custom.spice && s.custom.spice === edit.spice) delete s.custom.spice;
      changes.push(edit.spice ? `Every night is cooked ${edit.spice === "medium" ? "at medium heat" : edit.spice} now, unless a night says otherwise.` : "Every night is back to the heat its recipe says.");
      label = edit.spice ? `Heat: ${edit.spice}` : "Heat as written";
      break;
    }
    case "goal":
      f.profile.proteinGoal = edit.protein;
      changes.push(`Protein goal: ${edit.protein} g a day.`);
      label = "Protein goal";
      break;
    case "pass": {
      const meal = mealNamed(f, edit.meal);
      if (!meal) return { ok: false, error: "not-found" };
      meal.passed = edit.passed;
      changes.push(edit.passed ? `Passed on ${meal.name}.` : `${meal.name} is back in the catalog.`);
      if (edit.passed) for (const s of f.week?.slots ?? []) if (s.meal === meal.id) changes.push(replaceMain(f, s.day) ?? "");
      if (edit.passed) for (const s of f.week?.slots ?? []) if (s.lunch.meal === meal.id) changes.push(replaceLunch(f, s));
      if (f.week) refill(f);
      label = edit.passed ? `Passed on ${meal.name}` : `${meal.name} back`;
      break;
    }
    case "next-week": {
      const prev = f.week;
      for (const s of prev?.slots ?? []) {
        const lunch = s.lunch.meal ? mealNamed(f, s.lunch.meal) : undefined;
        if (lunch) {
          lunch.timesHad += 1;
          lunch.lastHad = stamp;
        }
        if (s.helloFresh || !s.inCart) continue;
        const meal = mealNamed(f, s.meal)!;
        meal.timesHad += 1;
        meal.lastHad = stamp;
      }
      const start = prev ? addDays(prev.start, 7) : stamp.slice(0, 10);
      const week = planWeek(f, start, prev);
      if (!week) return { ok: false, error: "short" };
      f.week = week;
      changes.push(`Planned the week of ${start}.`);
      label = "Planned next week";
      break;
    }
    case "confirm": {
      if (!needWeek()) return { ok: false, error: "no-week" };
      const w = f.week!;
      w.confirmedAt = stamp;
      // The photo library's queue (#687): every cooked night customized and still without its own photo.
      w.photoQueue = w.slots.filter((s) => !s.helloFresh && !s.photo && slotDish(f, s)?.customized).map((s) => s.day);
      changes.push(`Confirmed the week.${w.photoQueue.length ? ` ${w.photoQueue.length} customized meal${w.photoQueue.length === 1 ? "" : "s"} will get ${w.photoQueue.length === 1 ? "its" : "their"} own photo.` : ""}`);
      // Confirming keeps the Undo that was there: it changes nothing about what's cooked.
      return { ok: true, file: { v: 1, ...f, undo: file.undo }, changes };
    }
  }
  if (!changes.length) changes.push("Nothing changed.");
  // Any change to the plan makes the week a draft again until it's confirmed.
  if (f.week && JSON.stringify(f.week.slots) !== JSON.stringify(before.week?.slots)) {
    f.week.confirmedAt = null;
    f.week.photoQueue = [];
  }
  return { ok: true, file: { v: 1, ...f, undo: { label, at: stamp, state: before } }, changes: changes.filter(Boolean) };
}

/* ── Adding lunches to a planner that's already there (#719) ── */

export interface LunchMerge {
  file: MealsFile;
  /** Quick lunches new to the catalog. */
  added: number;
  /** Days of the week whose lunch changed. */
  days: number;
}

/**
 * Lunches from a seed, added to the file that's in the store without touching anything else in it: the seed's quick
 * lunches (and any components they need) join the catalog when their id is new, the seed's lunch days come along,
 * and when the week has no quick lunch yet it gets the seed's lunch plan (the same week) or a planned one. Dinners,
 * the taste profile's rules and every edit since stay as they are. Undo puts it back; a second run changes nothing.
 */
export function addLunches(file: MealsFile, seed: MealsFile, now: number): LunchMerge {
  const before: MealsState = clone({ profile: file.profile, catalog: file.catalog, components: file.components, week: file.week });
  const f: MealsState = clone(before);
  const have = new Set(f.catalog.map((x) => x.id));
  const fresh = seed.catalog.filter((x) => x.course === "lunch" && !have.has(x.id)).slice(0, Math.max(0, CATALOG_MAX - f.catalog.length));
  f.catalog.push(...clone(fresh));
  const parts = new Set(fresh.flatMap((x) => x.parts.map((p) => p.option)));
  const comps = new Set(f.components.map((x) => x.id));
  f.components.push(...seed.components.filter((x) => parts.has(x.id) && !comps.has(x.id)).slice(0, Math.max(0, COMPONENTS_MAX - f.components.length)));
  f.profile.lunchDays = [...seed.profile.lunchDays];
  const w = f.week;
  if (w && !w.slots.some((s) => s.lunch.meal)) {
    const lunches = new Set(f.catalog.filter((x) => x.course === "lunch").map((x) => x.id));
    if (seed.week?.start === w.start && seed.week.slots.some((s) => s.lunch.meal && lunches.has(s.lunch.meal))) {
      w.slots.forEach((s, i) => {
        const l = clone(seed.week!.slots[i]!.lunch);
        s.lunch = { ...l, meal: l.meal && lunches.has(l.meal) ? l.meal : null, backups: l.backups.filter((b) => lunches.has(b)) };
      });
    } else planLunches(f, w.slots);
    // The lunches' backups only: the dinners' stay exactly as they were.
    for (const s of w.slots) s.lunch.backups = lunchBackupsFor(f, s.lunch.meal, s.lunch.backups);
  }
  const days = w ? w.slots.filter((s, i) => JSON.stringify(s.lunch) !== JSON.stringify(before.week!.slots[i]!.lunch)).length : 0;
  if (!fresh.length && !days) return { file, added: 0, days: 0 };
  if (w && days) {
    w.confirmedAt = null;
    w.photoQueue = [];
  }
  return { file: { v: 1, ...f, undo: { label: "Lunches added", at: new Date(now).toISOString(), state: before } }, added: fresh.length, days };
}

/* ── The shopping list ── */

const fmtQty = (q: number): string => {
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  const f = [
    [0.25, "¼"],
    [0.33, "⅓"],
    [0.5, "½"],
    [0.67, "⅔"],
    [0.75, "¾"],
  ].find(([v]) => Math.abs(frac - (v as number)) < 0.05)?.[1];
  if (frac < 0.05) return String(whole);
  if (f) return whole ? `${whole}${f}` : String(f);
  return String(Math.round(q * 10) / 10);
};
/** "Chicken thighs, boneless (2¼ lb)", "Lime (3)". */
export const shopLine = (i: Ingredient): string => {
  const q = i.unit === "lb" || i.unit === "oz" || i.unit === "cup" ? Math.round(i.qty * 4) / 4 : i.unit === "each" || i.unit === "clove" || i.unit === "slice" ? Math.ceil(i.qty - 0.05) : Math.ceil(i.qty * 4 - 0.05) / 4;
  const n = Math.max(q, 0.25);
  const many = n > 1 && !["lb", "oz", "tbsp", "tsp", "each"].includes(i.unit);
  const unit = i.unit === "each" ? "" : ` ${i.unit}${many ? (i.unit === "bunch" ? "es" : "s") : ""}`;
  return `${i.item} (${fmtQty(n)}${unit})`.slice(0, 60);
};

/** How many portions each night's dinner is cooked in: one, two for two, one more for each lunch left over from it. */
export function portionsOf(w: Week): number[] {
  return w.slots.map((s, i) => (s.forTwo ? 2 : 1) + w.slots.filter((o2) => o2.lunch.leftoverOf === i && !w.slots[i]!.helloFresh).length);
}

/** What the week needs from the store, summed by item and unit, staples left out. HelloFresh and left-out nights add nothing. */
export function shoppingList(f: MealsState): Ingredient[] {
  const w = f.week;
  if (!w) return [];
  const sum = new Map<string, Ingredient>();
  const put = (i: Ingredient, k: number) => {
    if (i.pantry || k <= 0) return;
    const key = `${i.item.toLowerCase()}|${i.unit}`;
    const had = sum.get(key);
    sum.set(key, had ? { ...had, qty: had.qty + i.qty * k } : { item: i.item, qty: i.qty * k, unit: i.unit });
  };
  const portions = portionsOf(w);
  w.slots.forEach((s, i) => {
    const cooked = !s.helloFresh && s.inCart;
    if (cooked) {
      const d = slotDish(f, s);
      for (const x of d?.ingredients ?? []) put(x, portions[i]! * (d?.portion ?? 1));
    }
    // A quick lunch is bought for one (#719); a lunch's own extras come along unless it's left over from a night that isn't cooked.
    const quick = lunchDish(f, s);
    if (quick) for (const x of quick.ingredients) put(x, 1);
    const from = s.lunch.leftoverOf === null ? null : w.slots[s.lunch.leftoverOf]!;
    if (!quick && (!from || (!from.helloFresh && from.inCart))) for (const x of s.lunch.shop) put(x, 1);
  });
  for (const x of f.profile.topUp.shop) put(x, 1);
  return [...sum.values()];
}

/**
 * One customized night that needs its own photo once the week is confirmed. The Desk turns it into the photo
 * library's `MealToShoot` (api/_haven/photoShape.ts: name, description, the components as customized), and writes
 * the id the library answers back with the `photo` edit ({ op: "photo", day, photo }), which takes it off the queue.
 */
export interface PhotoJob {
  day: Day;
  meal: string;
  name: string;
  /** "Quinoa for jasmine rice", "Hot". */
  changes: string[];
  ingredients: string[];
  /** The meal's own photo, for the look to follow, or null. */
  basePhoto: string | null;
}

export function photoJobs(f: MealsState): PhotoJob[] {
  const w = f.week;
  if (!w) return [];
  return w.photoQueue.flatMap((day) => {
    const s = w.slots[DAYS.indexOf(day)]!;
    const d = slotDish(f, s);
    return d ? [{ day, meal: d.meal.id, name: d.meal.name, changes: d.changes, ingredients: d.ingredients.map((i) => i.item), basePhoto: d.meal.photo }] : [];
  });
}

/** The counts the public status view may show: never a meal, an ingredient or a taste. */
export interface MealCounts {
  planned: number;
  cooking: number;
  helloFresh: number;
  confirmed: boolean;
}

export function mealCounts(f: MealsState | null): MealCounts | null {
  if (!f?.week) return null;
  const s = f.week.slots;
  return { planned: s.length, cooking: s.filter((x) => !x.helloFresh && x.inCart).length, helloFresh: s.filter((x) => x.helloFresh).length, confirmed: f.week.confirmedAt !== null };
}

/** The week in a few plain lines, for Skippy's tool (the whole thing, no photos). */
export function weekWords(f: MealsState): string {
  const w = f.week;
  if (!w) return "No meal plan yet.";
  const lines = w.slots.map((s) => {
    const d = slotDish(f, s);
    const p = dayProtein(f, s);
    const what = s.helloFresh ? "HelloFresh" : `${d?.meal.name ?? s.meal}${d?.customized ? ` (${d.changes.join(", ").toLowerCase()})` : ""}`;
    const extra = [s.forTwo && "for two", !s.inCart && !s.helloFresh && "left out of the cart"].filter(Boolean).join(", ");
    const l = lunchView(f, s);
    const lunch = `lunch ${l.name}${l.kind === "quick" && s.lunch.backups.length ? ` (or ${s.lunch.backups.map((b) => nameOf(f, b)).join(" or ")})` : ""}`;
    return `${DAY_NAME[s.day]}: ${what}${extra ? `, ${extra}` : ""}; ${lunch}; ${p.total} g protein for the day; backups ${s.backups.map((b) => nameOf(f, b)).join(" or ") || "none"}.`;
  });
  const avoid = f.profile.avoid.map((a) => (a.unless ? `${a.term} (unless ${a.unless})` : a.term)).join(", ");
  const likes = f.profile.likes.join(", ");
  return [
    `Week of ${w.start}${w.confirmedAt ? ", confirmed" : ", a draft"}. Goal ${f.profile.proteinGoal} g protein a day.${f.profile.spice ? ` House heat: ${f.profile.spice}.` : ""}`,
    ...lines,
    avoid ? `Avoiding: ${avoid}.` : "",
    likes ? `Likes: ${likes}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A meal by its id or (loosely) its name, for Skippy's tools; `course` narrows it to dinners or lunches. */
export function findMeal(f: MealsState, said: string, course?: Course): Meal | undefined {
  const k = said.toLowerCase().trim();
  const all = course ? f.catalog.filter((x) => x.course === course) : f.catalog;
  return all.find((x) => x.id === k) ?? all.find((x) => x.name.toLowerCase() === k) ?? all.find((x) => x.name.toLowerCase().includes(k) && k.length >= 3);
}

const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/**
 * A component by what Nikita said ("quinoa", "brown rice", "no rice", "chicken"), for Skippy's tools: the id or the
 * name exactly, then "no …" / "without …" as the role's no-part, then a loose match either way. `role` narrows it
 * (the part being changed); without it, "no rice" finds its role from what follows the "no".
 */
export function componentFor(f: Pick<MealsState, "components">, said: string, role?: Role): Component | undefined {
  const all = allComponents(f).filter((x) => !role || x.role === role);
  const k = norm(said);
  if (!k) return undefined;
  const exact = all.find((x) => x.id === k.replace(/ /g, "-") || norm(x.name) === k);
  if (exact) return exact;
  const none = /^(?:no|none|without|skip(?: the)?|hold(?: the)?)(?: (.+))?$/.exec(k);
  if (none) {
    const of = none[1] ? componentFor(f, none[1], role) : undefined;
    const r = role ?? of?.role;
    return r ? all.find((x) => x.role === r && x.ingredients.length === 0) ?? allComponents(f).find((x) => x.role === r && x.ingredients.length === 0) : undefined;
  }
  if (k.length < 3) return undefined;
  return all.find((x) => norm(x.name).startsWith(k)) ?? all.find((x) => norm(x.name).includes(k)) ?? all.find((x) => k.includes(norm(x.name)));
}
