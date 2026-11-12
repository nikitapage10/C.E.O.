/**
 * Recipe steps that make sense (#1036): every part a dish uses is cooked in some step, the check that finds the one
 * that isn't, and the step the planner writes for it. Every meal here is made up (the fixture, or one written below).
 */
import { describe, expect, it } from "vitest";
import { cookOf } from "../../rooms/haven/web/cook.ts";
import { completeSteps, kindOf, RECIPE_RULES, stepName, uncooked } from "./cookSteps.ts";
import { fakeMeals } from "./meals.fixture.ts";
import { applyEdit, COMPONENTS, componentNamed, readMeals, RECIPE_STEPS_MAX, shoppingList, slotDish, STEP_MAX, type Meal, type MealsFile } from "./mealShape.ts";

const NOW = Date.parse("2026-11-12T01:00:00Z");
const comp = (id: string) => COMPONENTS.find((c) => c.id === id)!;
const partsOf = (f: MealsFile, m: Meal) => m.parts.map((p) => componentNamed(f, p.option));

/** A made-up three-step recipe that never boils its pasta: the kind Nikita found. */
const VAGUE = [
  "Brown the sausage, then take it out of the pan.",
  "Fry the tomato paste and garlic, add the vodka, then the cream.",
  "Toss with the rigatoni and the sausage.",
];
const vagueFile = (): MealsFile => {
  const raw = JSON.parse(JSON.stringify(fakeMeals())) as { catalog: Array<{ id: string; steps: string[] }> };
  raw.catalog.find((m) => m.id === "sausage-pasta")!.steps = VAGUE;
  return readMeals(raw)!;
};
const WED = 2;

describe("the check (#1036)", () => {
  it("finds the pasta that's never boiled, and nothing missing in a recipe that cooks every part", () => {
    expect(uncooked(VAGUE, [comp("italian-sausage"), comp("rigatoni")])).toEqual([{ role: "carb", component: "rigatoni", kind: "pasta" }]);
    expect(uncooked(["Boil the rigatoni in salted water, 10 min.", ...VAGUE], [comp("italian-sausage"), comp("rigatoni")])).toEqual([]);
    // A part never named at all, and a raw side never served.
    expect(uncooked(["Sear the steak."], [comp("sirloin"), comp("jasmine-rice"), comp("kimchi")]).map((g) => g.component)).toEqual(["jasmine-rice", "kimchi"]);
    // No carb and No side have nothing to cook.
    expect(uncooked(["Sear the sirloin steak, 4 min a side."], [comp("sirloin"), comp("no-carb"), comp("no-side"), undefined])).toEqual([]);
  });

  it("reads the verb for what the part is, never a word in an ingredient's name", () => {
    // "Brown rice" isn't the beef browned, and tossing the pasta isn't boiling it.
    expect(uncooked(["Spoon the ground beef over the brown rice."], [comp("ground-beef"), comp("brown-rice")]).map((g) => g.component)).toEqual(["ground-beef", "brown-rice"]);
    expect(uncooked(["Warm the corn tortillas in a dry pan, 30 s a side."], [comp("corn-tortillas")])).toEqual([]);
    expect(uncooked(["Roast the Yukon gold potatoes at 425°F, 30 min."], [comp("potatoes")])).toEqual([]);
  });

  it("knows what every part in the library is, and how to name it in a step", () => {
    expect(COMPONENTS.map((c) => [c.id, kindOf(c)]).filter(([id]) => ["rigatoni", "protein-pasta", "jasmine-rice", "brown-rice", "potatoes", "fries", "pita", "ground-lamb", "pork-tenderloin", "black-beans", "pico"].includes(id!))).toEqual([
      ["ground-lamb", "ground"],
      ["pork-tenderloin", "pork"],
      ["jasmine-rice", "rice"],
      ["brown-rice", "brown-rice"],
      ["potatoes", "potato"],
      ["fries", "fries"],
      ["rigatoni", "pasta"],
      ["protein-pasta", "pasta"],
      ["pita", "flatbread"],
      ["pico", "raw"],
      ["black-beans", "beans"],
    ]);
    expect(stepName(comp("potatoes"))).toBe("yukon gold potatoes");
    expect(stepName(comp("strip"))).toBe("NY strip");
    expect(stepName(comp("snow-peas"))).toBe("snow peas");
  });
});

describe("the repair (#1036)", () => {
  it("boils the pasta just before the step that tosses it, with the heat, the time and the pasta water", () => {
    const out = completeSteps(VAGUE, [comp("italian-sausage"), comp("rigatoni")]);
    expect(out).toHaveLength(4);
    expect(out[2]).toMatch(/^Bring a large pot of well-salted water to a boil\. Cook the rigatoni .*al dente; save 1 cup of pasta water/);
    expect(out[3]).toBe(VAGUE[2]);
    // Once is enough: a complete recipe comes back as it was, the same array.
    expect(completeSteps(out, [comp("italian-sausage"), comp("rigatoni")])).toBe(out);
  });

  it("puts the rice and the potatoes first and a raw side last, and stops at the most steps a recipe keeps", () => {
    const out = completeSteps(["Sear the sirloin steak over high heat, 4 min a side."], [comp("sirloin"), comp("jasmine-rice"), comp("kimchi")]);
    expect(out[0]).toMatch(/^Rinse the jasmine rice/);
    expect(out.at(-1)).toBe("Serve the kimchi on the side.");
    const full = Array.from({ length: RECIPE_STEPS_MAX }, (_, k) => `Step ${k + 1}.`);
    expect(completeSteps(full, [comp("jasmine-rice")], [], RECIPE_STEPS_MAX)).toBe(full);
  });

  it("writes a step for every part in the library within a step's length, and that step cooks it", () => {
    for (const c of COMPONENTS.filter((x) => x.ingredients.length)) {
      const out = completeSteps([], [c]);
      expect(out, c.id).toHaveLength(1);
      expect(out[0]!.length, c.id).toBeLessThanOrEqual(STEP_MAX);
      expect(uncooked(out, [c], [], true), c.id).toEqual([]);
    }
  });
});

describe("the recipes written in the repo (#1036)", () => {
  it("cook every part by its name, in 3 to 8 steps of at most 240 characters, each cooking step timed", () => {
    const f = fakeMeals();
    expect(RECIPE_RULES.length).toBeGreaterThan(100);
    for (const m of f.catalog) {
      const extra = m.ingredients.map((i) => i.item);
      expect(uncooked(m.steps, partsOf(f, m), extra, true), m.id).toEqual([]);
      expect(m.steps.length, m.id).toBeGreaterThanOrEqual(m.course === "dinner" ? 4 : 3);
      expect(m.steps.length, m.id).toBeLessThanOrEqual(8);
      for (const t of m.steps) {
        expect(t.length, t).toBeLessThanOrEqual(STEP_MAX);
        if (/^(Cook|Sear|Brown|Simmer|Boil|Roast|Bake|Fry|Warm|Bring|Rinse)\b/.test(t)) expect(t, t).toMatch(/\d+(?:–\d+)?\s*(?:min|s\b|minutes?|°F)/);
      }
      // Nothing for the planner to add.
      expect(completeSteps(m.steps, partsOf(f, m), extra), m.id).toBe(m.steps);
    }
  });
});

describe("a recipe already saved (#1036)", () => {
  it("reads complete wherever it's shown, the stored recipe untouched and the shopping exactly as it was", () => {
    const f = vagueFile();
    const d = slotDish(f, f.week!.slots[WED]!)!;
    expect(d.meal.steps).toHaveLength(4);
    expect(d.meal.steps[2]).toMatch(/Cook the rigatoni/);
    expect(f.catalog.find((m) => m.id === "sausage-pasta")!.steps).toEqual(VAGUE);
    expect(shoppingList(f)).toEqual(shoppingList(fakeMeals()));
  });

  it("in a finalized week: the list, the cart and finalized itself as they were", () => {
    const got = applyEdit(vagueFile(), { op: "confirm" }, NOW);
    if (!got.ok) throw new Error(got.error);
    const again = readMeals(JSON.parse(JSON.stringify(got.file)))!;
    expect(again.week!.confirmedAt).toBe(got.file.week!.confirmedAt);
    expect(again.week!.slots.map((s) => s.inCart)).toEqual(got.file.week!.slots.map((s) => s.inCart));
    expect(slotDish(again, again.week!.slots[WED]!)!.meal.steps[2]).toMatch(/Cook the rigatoni/);
  });

  it("follows a swap and a part left out in cook mode", () => {
    const swap = applyEdit(vagueFile(), { op: "customize", day: "wed", part: { index: 1, option: "protein-pasta" } }, NOW);
    if (!swap.ok) throw new Error(swap.error);
    const c = cookOf(swap.file, swap.file.week!.slots[WED]!)!;
    expect(c.steps[2]!.runs.find((r) => r.swap)?.text).toBe("protein pasta");
    expect(c.steps[2]!.uses.map((k) => c.lines[k]!.item)).toEqual(["Protein pasta"]);
    const none = applyEdit(vagueFile(), { op: "customize", day: "wed", part: { index: 1, option: "no-carb" } }, NOW);
    if (!none.ok) throw new Error(none.error);
    expect(cookOf(none.file, none.file.week!.slots[WED]!)!.steps[2]!.skip).toBe("No rigatoni tonight");
  });

  it("completes a night's own edited steps too, but not for a part the night took out whole", () => {
    let f = vagueFile();
    const step = applyEdit(f, { op: "recipe", day: "wed", action: "edit-step", step: 1, text: "Brown the sausage over medium-high heat until crisp, 6–8 min." }, NOW);
    if (!step.ok) throw new Error(step.error);
    f = step.file;
    // The edit copied the steps as shown (already complete), so the boil is in the night's own steps now.
    expect(f.week!.slots[WED]!.custom.recipe!.steps!.some((t) => /Cook the rigatoni/.test(t))).toBe(true);
    const raw = JSON.parse(JSON.stringify(f)) as { week: { slots: Array<{ custom: { recipe: { steps: string[]; drop?: string[] } } }> } };
    raw.week.slots[WED]!.custom.recipe.steps = VAGUE;
    raw.week.slots[WED]!.custom.recipe.drop = ["rigatoni"];
    const dropped = readMeals(raw)!;
    expect(slotDish(dropped, dropped.week!.slots[WED]!)!.meal.steps).toEqual(VAGUE);
  });
});
