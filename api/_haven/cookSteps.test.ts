/**
 * Recipe steps that make sense (#1036): every part a dish uses is cooked in some step, the check that finds the one
 * that isn't, and the step the planner writes for it. Every meal here is made up (the fixture, or one written below).
 */
import { describe, expect, it } from "vitest";
import { cookOf } from "../../rooms/haven/web/cook.ts";
import { completeSteps, kindOf, orderSteps, RECIPE_RULES, stepName, uncooked, WATER_START } from "./cookSteps.ts";
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
  it("puts the water on first and boils the pasta just before the step that tosses it, with the heat, the time and the pasta water (#1041)", () => {
    const out = completeSteps(VAGUE, [comp("italian-sausage"), comp("rigatoni")]);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(WATER_START);
    expect(out[3]).toMatch(/^Drop the rigatoni into the boiling water and cook .*al dente; save 1 cup of pasta water/);
    expect(out[4]).toBe(VAGUE[2]);
    // Once is enough: a complete recipe comes back as it was, the same array.
    expect(completeSteps(out, [comp("italian-sausage"), comp("rigatoni")])).toBe(out);
  });

  it("puts the rice and the potatoes first and a raw side last, and stops at the most steps a recipe keeps", () => {
    const out = completeSteps(["Sear the sirloin steak over high heat, 4 min a side."], [comp("sirloin"), comp("jasmine-rice"), comp("kimchi")]);
    expect(out[0]).toMatch(/^Rinse the jasmine rice/);
    expect(out.at(-1)).toBe("Serve the kimchi on the side.");
    const full = Array.from({ length: RECIPE_STEPS_MAX }, (_, k) => `Step ${k + 1}.`);
    expect(completeSteps(full, [comp("jasmine-rice")], [], RECIPE_STEPS_MAX)).toBe(full);
    // One short of the most: the pasta's start and its cooking in one step.
    const one = completeSteps(full.slice(1), [comp("rigatoni")], [], RECIPE_STEPS_MAX);
    expect(one).toHaveLength(RECIPE_STEPS_MAX);
    expect(one.at(-2)).toMatch(/^Bring a large pot of well-salted water to a boil\. Cook the rigatoni/);
  });

  it("writes a step for every part in the library within a step's length, and that step cooks it", () => {
    for (const c of COMPONENTS.filter((x) => x.ingredients.length)) {
      const out = completeSteps([], [c]);
      // The pasta and the pork tenderloin start first (#1041): the water on, the oven heated.
      expect(out, c.id).toHaveLength(["pasta", "pork"].includes(kindOf(c)) ? 2 : 1);
      for (const t of out) expect(t.length, c.id).toBeLessThanOrEqual(STEP_MAX);
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
    expect(d.meal.steps).toHaveLength(5);
    expect(d.meal.steps[0]).toBe(WATER_START);
    expect(d.meal.steps[3]).toMatch(/Drop the rigatoni/);
    expect(f.catalog.find((m) => m.id === "sausage-pasta")!.steps).toEqual(VAGUE);
    expect(shoppingList(f)).toEqual(shoppingList(fakeMeals()));
  });

  it("in a finalized week: the list, the cart and finalized itself as they were", () => {
    const got = applyEdit(vagueFile(), { op: "confirm" }, NOW);
    if (!got.ok) throw new Error(got.error);
    const again = readMeals(JSON.parse(JSON.stringify(got.file)))!;
    expect(again.week!.confirmedAt).toBe(got.file.week!.confirmedAt);
    expect(again.week!.slots.map((s) => s.inCart)).toEqual(got.file.week!.slots.map((s) => s.inCart));
    expect(slotDish(again, again.week!.slots[WED]!)!.meal.steps[3]).toMatch(/Drop the rigatoni/);
  });

  it("follows a swap and a part left out in cook mode", () => {
    const swap = applyEdit(vagueFile(), { op: "customize", day: "wed", part: { index: 1, option: "protein-pasta" } }, NOW);
    if (!swap.ok) throw new Error(swap.error);
    const c = cookOf(swap.file, swap.file.week!.slots[WED]!)!;
    expect(c.steps[3]!.runs.find((r) => r.swap)?.text).toBe("protein pasta");
    expect(c.steps[3]!.uses.map((k) => c.lines[k]!.item)).toEqual(["Protein pasta"]);
    expect(c.steps[0]!.skip).toBeNull();
    const none = applyEdit(vagueFile(), { op: "customize", day: "wed", part: { index: 1, option: "no-carb" } }, NOW);
    if (!none.ok) throw new Error(none.error);
    const left = cookOf(none.file, none.file.week!.slots[WED]!)!;
    expect(left.steps[3]!.skip).toBe("No rigatoni tonight");
    // The pot of water was for the rigatoni (#1041).
    expect(left.steps[0]!.skip).toBe("No rigatoni tonight");
    expect(left.steps[1]!.skip).toBeNull();
  });

  it("completes a night's own edited steps too, but not for a part the night took out whole", () => {
    let f = vagueFile();
    const step = applyEdit(f, { op: "recipe", day: "wed", action: "edit-step", step: 1, text: "Brown the sausage over medium-high heat until crisp, 6–8 min." }, NOW);
    if (!step.ok) throw new Error(step.error);
    f = step.file;
    // The edit copied the steps as shown (already complete), so the boil is in the night's own steps now.
    expect(f.week!.slots[WED]!.custom.recipe!.steps!.some((t) => /Drop the rigatoni/.test(t))).toBe(true);
    const raw = JSON.parse(JSON.stringify(f)) as { week: { slots: Array<{ custom: { recipe: { steps: string[]; drop?: string[] } } }> } };
    raw.week.slots[WED]!.custom.recipe.steps = VAGUE;
    raw.week.slots[WED]!.custom.recipe.drop = ["rigatoni"];
    const dropped = readMeals(raw)!;
    expect(slotDish(dropped, dropped.week!.slots[WED]!)!.meal.steps).toEqual(VAGUE);
  });
});

describe("cooking order (#1041)", () => {
  const sausage = () => [comp("italian-sausage"), comp("rigatoni")];
  /** A made-up rigatoni alla vodka with sausage that only boils the water once the sauce is done. */
  const VODKA = [
    "Brown the Italian sausage in a wide pan over medium-high heat, breaking it up, until no pink remains, 6–8 min; set it aside.",
    "Fry the tomato paste and garlic in the fat until brick red, about 2 min, then add the vodka and cook it off, 1 min.",
    "Stir in the cream and simmer until it coats a spoon, 3–4 min.",
    "Bring a large pot of well-salted water to a boil. Cook the rigatoni 1–2 min short of the box time, about 10 min, until just al dente; save 1 cup of pasta water, then drain.",
    "Toss the rigatoni and the sausage in the sauce with a splash of pasta water until glossy, 1–2 min.",
  ];

  it("puts the rigatoni's water on first and leaves the cooking where it was", () => {
    const out = orderSteps(VODKA, sausage(), ["Tomato paste", "Vodka", "Heavy cream"]);
    expect(out).toHaveLength(6);
    expect(out[0]).toBe(WATER_START);
    expect(out.slice(1, 4)).toEqual(VODKA.slice(0, 3));
    expect(out[4]).toBe("Drop the rigatoni into the boiling water and cook 1–2 min short of the box time, about 10 min, until just al dente; save 1 cup of pasta water, then drain.");
    expect(out[5]).toBe(VODKA[4]);
    expect(uncooked(out, sausage(), [], true)).toEqual([]);
    // The planner shows the vague one the same way: the water first, the rigatoni boiled before it's tossed.
    const d = slotDish(vagueFile(), vagueFile().week!.slots[WED]!)!;
    expect(d.meal.steps[0]).toBe(WATER_START);
    expect(d.meal.steps.findIndex((t) => /Drop the rigatoni/.test(t))).toBe(d.meal.steps.length - 2);
  });

  it("starts the rice first in a rice bowl, and the oven before the potatoes", () => {
    const bowl = ["Brown the ground beef in a wok over high heat until crisp, 6–8 min.", "Meanwhile, rinse the jasmine rice, bring it to a boil with 1¼ times its volume of water, then cover and simmer on low until the water is gone, 15 min.", "Fluff the jasmine rice and spoon the ground beef over it."];
    const out = orderSteps(bowl, [comp("ground-beef"), comp("jasmine-rice")]);
    expect(out[0]).toMatch(/^Rinse the jasmine rice/);
    expect(out.slice(1)).toEqual([bowl[0], bowl[2]]);
    // A rice bowl missing its rice gets it as the first step too.
    expect(completeSteps([bowl[0]!, "Spoon the ground beef into bowls."], [comp("ground-beef"), comp("jasmine-rice")])[0]).toMatch(/^Rinse the jasmine rice/);
    const roast = ["Sear the sirloin steak over high heat, 4 min a side.", "Heat the oven to 425°F and roast the Yukon gold potatoes until crisp, 30–35 min."];
    expect(orderSteps(roast, [comp("sirloin"), comp("potatoes")])).toEqual([roast[1], roast[0]]);
    const oven = ["Sear the pork tenderloin on all sides, 5 min.", "Heat the oven to 425°F. Roast the pork tenderloin until 145°F inside, 12–15 min."];
    expect(orderSteps(oven, [comp("pork-tenderloin")])).toEqual(["Heat the oven to 425°F.", oven[0], "Roast the pork tenderloin until 145°F inside, 12–15 min."]);
  });

  it("changes nothing the second time, nor in a recipe already in order, and never goes past the most steps", () => {
    const once = orderSteps(VODKA, sausage());
    expect(orderSteps(once, sausage())).toBe(once);
    const f = fakeMeals();
    for (const m of f.catalog) expect(orderSteps(m.steps, partsOf(f, m), m.ingredients.map((i) => i.item)), m.id).toBe(m.steps);
    const full = [...Array.from({ length: RECIPE_STEPS_MAX - 1 }, (_, k) => `Step ${k + 1}.`), VODKA[3]!];
    expect(orderSteps(full, sausage(), [], RECIPE_STEPS_MAX)).toBe(full);
    // A second pot of water is one too many: it comes out of the later step.
    expect(orderSteps([WATER_START, "Brown the sausage, 6 min.", "Bring a pot of water to a boil. Cook the rigatoni 10 min."], sausage())).toEqual([WATER_START, "Brown the sausage, 6 min.", "Drop the rigatoni into the boiling water and cook 10 min."]);
  });
});
