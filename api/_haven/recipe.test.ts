/**
 * A night's recipe edited by voice (#1027): a step added with what it needs, ingredients dropped or replaced, a step
 * changed. A draft week's shopping list follows; a finalized week keeps everything but the recipe (the list, the cart,
 * finalized itself). Cook mode and its step pictures read the edited steps. Every meal here is the made-up fixture's.
 */
import { describe, expect, it } from "vitest";
import { cookOf, stepShotsOf } from "../../rooms/haven/web/cook.ts";
import { MemoryPending } from "../_skippy/agent/pending.ts";
import { callTool, type ToolHost } from "../_skippy/agent/tools.ts";
import { fakeMeals } from "./meals.fixture.ts";
import { applyEdit, ingredientLine, readEdit, readMeals, recipeWords, shopLine, shoppingList, slotDish, weekStage, type MealEdit, type MealsFile } from "./mealShape.ts";

const NOW = Date.parse("2026-11-12T01:00:00Z");
const THU = 3;

const edit = (f: MealsFile, e: Record<string, unknown>): MealsFile => {
  const got = applyEdit(f, readEdit(e)!, NOW);
  if (!got.ok) throw new Error(got.error);
  return got.file;
};
const finalized = (): MealsFile => edit(fakeMeals(), { op: "confirm" });
const list = (f: MealsFile) => shoppingList(f).map(shopLine).join(" | ");

describe("ingredient lines (#1027)", () => {
  it("reads an amount, a unit and the item, and a staple", () => {
    expect(ingredientLine("2 roma tomatoes")).toEqual({ item: "Roma tomatoes", qty: 2, unit: "each" });
    expect(ingredientLine("0.25 cup cilantro")).toEqual({ item: "Cilantro", qty: 0.25, unit: "cup" });
    expect(ingredientLine("1/2 tsp ground cumin")).toEqual({ item: "Ground cumin", qty: 0.5, unit: "tsp" });
    expect(ingredientLine("1 1/2 tablespoons lime juice")).toEqual({ item: "Lime juice", qty: 1.5, unit: "tbsp" });
    expect(ingredientLine("½ white onion")).toEqual({ item: "White onion", qty: 0.5, unit: "each" });
    expect(ingredientLine("salt (pantry)")).toEqual({ item: "Salt", qty: 1, unit: "each", pantry: true });
    expect(ingredientLine("   ")).toBeNull();
  });
});

describe("a night's recipe edits (#1027)", () => {
  it("adds a step with its ingredients, and in a draft week the shopping list follows", () => {
    const f = edit(fakeMeals(), { op: "recipe", day: "thu", action: "add-step", step: 2, text: "Make the pico de gallo: dice the roma tomatoes and white onion, toss with cilantro and lime.", add: [ingredientLine("2 roma tomatoes"), ingredientLine("0.5 white onion"), ingredientLine("0.25 cup cilantro")] });
    expect(weekStage(f.week)).toBe("draft");
    const d = slotDish(f, f.week!.slots[THU]!)!;
    expect(d.meal.steps[1]).toMatch(/^Make the pico/);
    expect(d.ingredients.map((i) => i.item)).toEqual(expect.arrayContaining(["Roma tomatoes", "White onion", "Cilantro"]));
    expect(list(f)).toMatch(/Roma tomatoes/);
    expect(list(fakeMeals())).not.toMatch(/Roma tomatoes/);
    // Only that night: the catalog's tacos are as written.
    expect(f.catalog.find((m) => m.id === "tacos")!.steps).toEqual(["Cook it."]);
    // Cook mode reads the edited step, with its ingredients and amounts, and its picture is a new one to make.
    const cook = cookOf(f, f.week!.slots[THU]!)!;
    const step = cook.steps[1]!;
    expect(step.runs.map((r) => r.text).join("")).toMatch(/pico de gallo/);
    expect(step.uses.map((k) => cook.lines[k]!.item)).toEqual(expect.arrayContaining(["Roma tomatoes", "White onion", "Cilantro"]));
    expect(stepShotsOf(cook).some((s) => /pico/.test(s.shot.description))).toBe(true);
    expect(f.undo?.label).toBe("Thursday's recipe");
  });

  it("drops the guac, the avocado and the chips, and a finalized week keeps its list and stays finalized", () => {
    const before = finalized();
    expect(weekStage(before.week)).toBe("finalized");
    const f = edit(before, { op: "recipe", day: "thu", action: "drop", terms: ["avocado", "guac", "chips"] });
    expect(weekStage(f.week)).toBe("finalized");
    expect(f.week!.confirmedAt).toBe(before.week!.confirmedAt);
    const d = slotDish(f, f.week!.slots[THU]!)!;
    expect(d.ingredients.map((i) => i.item.toLowerCase()).join(" ")).not.toMatch(/avocado|chips/);
    expect(d.changes.join(" ")).toMatch(/No tortilla chips, avocado/);
    // The file round-trips through the reader as it is kept.
    expect(readMeals(JSON.parse(JSON.stringify(f)))!.week!.slots[THU]!.custom.recipe).toEqual({ drop: ["avocado", "guac", "chips"] });
  });

  it("replaces an ingredient and renames it in the steps; edits and takes out a step; refuses what isn't there", () => {
    let f = edit(fakeMeals(), { op: "recipe", day: "thu", action: "add-step", text: "Squeeze the lime over everything." });
    f = edit(f, { op: "recipe", day: "thu", action: "replace", terms: ["lime"], add: [ingredientLine("1 lemon")] });
    const d = slotDish(f, f.week!.slots[THU]!)!;
    expect(d.meal.steps[1]).toBe("Squeeze the lemon over everything.");
    expect(d.ingredients.map((i) => i.item)).toContain("Lemon");
    f = edit(f, { op: "recipe", day: "thu", action: "edit-step", step: 1, text: "Sear the steak hard, two minutes a side." });
    expect(slotDish(f, f.week!.slots[THU]!)!.meal.steps[0]).toMatch(/^Sear the steak/);
    f = edit(f, { op: "recipe", day: "thu", action: "remove-step", step: 2 });
    expect(slotDish(f, f.week!.slots[THU]!)!.meal.steps).toHaveLength(1);
    expect(applyEdit(f, readEdit({ op: "recipe", day: "thu", action: "edit-step", step: 9, text: "Nope." })!, NOW)).toEqual({ ok: false, error: "not-found" });
    expect(applyEdit(f, readEdit({ op: "recipe", day: "thu", action: "drop", terms: ["saffron"] })!, NOW)).toEqual({ ok: false, error: "not-found" });
    expect(readEdit({ op: "recipe", day: "thu", action: "add-step" })).toBeNull();
    expect(recipeWords(f, f.week!.slots[THU]!)).toMatch(/^Thursday's tacos \(the week is a draft\)/);
  });
});

describe("meals_recipe, Skippy's tool (#1027)", () => {
  function mealsHost(file: MealsFile, photos: MealsFile[] = []): ToolHost & { file: () => MealsFile; added: string[][] } {
    let f = file;
    const added: string[][] = [];
    return {
      read: async () => "",
      memory: null,
      kitchenAdd: async (items) => {
        added.push(items);
        return { added: items, already: [] };
      },
      homeAct: null,
      fileIssue: null,
      skipTerms: [],
      now: NOW,
      meals: {
        read: async () => f,
        edit: async (e: MealEdit) => {
          const got = applyEdit(f, e, NOW);
          if (got.ok) f = got.file;
          return got;
        },
        send: async () => null,
        stepPhotos: async (x) => {
          photos.push(x);
          return 1;
        },
      },
      file: () => f,
      added,
    };
  }

  it("runs at once (an order, no Yes), says what changed, keeps a finalized week's list, and queues the new step's picture", async () => {
    const photos: MealsFile[] = [];
    const h = mealsHost(finalized(), photos);
    const pending = new MemoryPending();
    const got = await callTool("meals_recipe", { day: "thu", action: "add_step", step: 2, text: "Make a homemade pico de gallo and spoon it over the tacos.", ingredients: ["2 roma tomatoes", "0.25 cup cilantro", "salt (pantry)"] }, h, { pending, surface: "spoken" });
    expect(got).toMatchObject({ ok: true, did: "Thursday's recipe edited" });
    const text = got.ok && "text" in got ? got.text : "";
    expect(text).toMatch(/new step 2/);
    expect(text).toMatch(/finalized, so only the recipe changed/);
    expect(text).toMatch(/Not bought this week: roma tomatoes, cilantro\./);
    expect(text).not.toMatch(/Not bought this week:[^.]*salt/i);
    expect(text).toMatch(/1 step picture/);
    expect(pending.items).toEqual([]);
    expect(h.added).toEqual([]);
    expect(photos).toHaveLength(1);
    expect(weekStage(h.file().week)).toBe("finalized");
  });

  it("in a draft week says the shopping list follows, and shows the recipe numbered", async () => {
    const h = mealsHost(fakeMeals());
    const drop = await callTool("meals_recipe", { day: "thu", action: "drop", terms: ["avocado", "guac", "chips"] }, h, { pending: null, surface: "desk" });
    expect(drop.ok && "text" in drop && drop.text).toMatch(/took out tortilla chips, avocado.*a draft, so its shopping list follows/);
    const show = await callTool("meals_recipe", { day: "thu", action: "show" }, h, { pending: null, surface: "desk" });
    expect(show.ok && "text" in show && show.text).toMatch(/1\. Cook it\./);
    const bad = await callTool("meals_recipe", { day: "thu", action: "edit_step" }, h, { pending: null, surface: "desk" });
    expect(bad.ok).toBe(false);
  });
});
