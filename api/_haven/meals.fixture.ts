import { readMeals, type MealsFile } from "./mealShape.ts";

/**
 * A made-up meal planner file (#678) for the tests and the browser tests: ten generic meals and a week. Never
 * Nikita's catalog or taste profile, which live only in the Haven's private store.
 */

const ing = (item: string, qty: number, unit: string) => ({ item, qty, unit });
const meal = (id: string, cuisine: string, protein: number, parts: Array<[string, string]>, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.replace(/-/g, " "),
  cuisine,
  minutes: 30,
  blurb: "",
  steps: ["Cook it."],
  ingredients: [ing("Garlic", 2, "clove"), ing("Salt", 1, "tsp"), { item: "Olive oil", qty: 1, unit: "tbsp", pantry: true }],
  parts: parts.map(([role, option]) => ({ role, option })),
  macros: { protein, carbs: 80, fat: 30, kcal: 900 },
  photo: id,
  ...extra,
});
const lunch = (leftoverOf: number | null) => ({ text: leftoverOf === null ? "Salad" : "Leftovers", protein: 50, leftoverOf, shop: [] });

/** Ten made-up meals and a week of seven, a fresh copy each call. */
export function fakeMeals(): MealsFile {
  const catalog = [
    meal("beef-bowl", "Korean", 80, [
      ["protein", "ground-beef"],
      ["carb", "jasmine-rice"],
      ["side", "kimchi"],
    ]),
    meal("steak-bowl", "Korean", 78, [
      ["protein", "sirloin"],
      ["carb", "jasmine-rice"],
    ]),
    meal("chicken-plate", "Greek", 85, [
      ["protein", "chicken-thigh"],
      ["carb", "pita"],
    ]),
    meal("kofta", "Greek", 70, [
      ["protein", "ground-beef"],
      ["carb", "pita"],
    ]),
    meal(
      "sausage-pasta",
      "Italian",
      62,
      [
        ["protein", "italian-sausage"],
        ["carb", "rigatoni"],
      ],
      { ingredients: [ing("Greek yogurt", 0.25, "cup")] },
    ),
    meal("tacos", "Mexican", 84, [
      ["protein", "skirt-steak"],
      ["carb", "corn-tortillas"],
      ["side", "chips-guac"],
    ]),
    meal("katsu", "Japanese", 80, [
      ["protein", "chicken-breast"],
      ["carb", "jasmine-rice"],
    ]),
    meal("surf-turf", "Steakhouse", 90, [
      ["protein", "ribeye"],
      ["carb", "no-carb"],
    ]),
    meal("scampi", "Italian", 58, [
      ["protein", "shrimp"],
      ["carb", "linguine"],
    ]),
    meal("new-thing", "Thai", 75, [
      ["protein", "ground-beef"],
      ["carb", "jasmine-rice"],
    ]),
  ];
  const mains = ["beef-bowl", "chicken-plate", "sausage-pasta", "tacos", "katsu", "surf-turf", "scampi"];
  const backups: Record<string, string[]> = { "beef-bowl": ["steak-bowl"], "chicken-plate": ["kofta"], "sausage-pasta": ["scampi"] };
  return readMeals({
    profile: { proteinGoal: 200, topUp: { text: "A shake", protein: 75, shop: [] }, avoid: [{ term: "avocado", unless: "tortilla chips" }], forTwo: ["sat"] },
    catalog,
    week: { start: "2026-11-09", slots: mains.map((m, i) => ({ meal: m, backups: backups[m] ?? [], lunch: lunch(i === 0 ? null : i - 1), forTwo: i === 5 })), picks: ["new-thing"] },
  })!;
}
