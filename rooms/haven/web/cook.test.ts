import { describe, expect, it } from "vitest";
import { fakeMeals } from "../../../api/_haven/meals.fixture.ts";
import { applyEdit, type MealEdit, type MealsFile } from "./meals.ts";
import { cookLunchOf, cookOf, lineNames, usesOf } from "./cook.ts";

const edited = (f: MealsFile, ...edits: MealEdit[]) => edits.reduce((x, e) => {
  const got = applyEdit(x, e, 0);
  if (!got.ok) throw new Error(got.error);
  return got.file;
}, f);
const wed = (f: MealsFile) => cookOf(f, f.week!.slots[2]!)!;
const text = (f: MealsFile, i: number) => wed(f).steps[i]!.runs.map((r) => (r.swap ? `[${r.text}]` : r.text)).join("");

describe("cook mode (#705)", () => {
  it("is the meal as written, one step each, with the amounts for every portion in the pan", () => {
    const c = wed(fakeMeals());
    expect(c.name).toBe("sausage pasta");
    expect(c.dayName).toBe("Wednesday");
    expect(c.steps).toHaveLength(5);
    expect(c.steps.every((s) => s.skip === null && s.runs.every((r) => !r.swap))).toBe(true);
    expect(c.meal).toBe("sausage-pasta");
    // Wednesday's dinner makes Thursday's lunch too.
    expect(c.portions).toBe(2);
    expect(c.why).toEqual(["makes Thursday's lunch"]);
    expect(c.parts).toEqual([
      { role: "protein", name: "Italian sausage", was: null },
      { role: "carb", name: "Rigatoni", was: null },
    ]);
    expect(c.lines).toContainEqual({ item: "Rigatoni", amount: "8 oz", pantry: false });
    expect(c.lines).toContainEqual({ item: "Italian sausage", amount: "1 lb", pantry: false });
    expect(c.spiceWas).toBeNull();
  });

  it("names the swapped part in the steps, marked, in the recipe's own case", () => {
    const f = edited(fakeMeals(), { op: "customize", day: "wed", part: { index: 1, option: "protein-pasta" } });
    expect(text(f, 2)).toBe("Drop the [protein pasta] into the boiling water and cook two minutes short of the box, about 10 min, until just al dente; save a cup of the pasta water, then drain.");
    expect(text(f, 1)).toContain("Italian sausage");
    expect(wed(f).parts[1]).toEqual({ role: "carb", name: "Protein pasta", was: "rigatoni" });
    expect(wed(f).lines.some((l) => l.item === "Rigatoni")).toBe(false);
    expect(wed(f).lines).toContainEqual({ item: "Protein pasta", amount: "8 oz", pantry: false });
  });

  it("marks the step for a part left out, and follows the portion and the heat", () => {
    const f = edited(fakeMeals(), { op: "customize", day: "wed", part: { index: 1, option: "no-carb" } }, { op: "customize", day: "wed", portion: 1.5 }, { op: "customize", day: "wed", spice: "hot" });
    const c = wed(f);
    expect(c.steps[2]!.skip).toBe("No rigatoni tonight");
    expect(c.steps[1]!.skip).toBeNull();
    expect(c.parts.map((p) => p.name)).toEqual(["Italian sausage"]);
    expect(c.portion).toBe(1.5);
    expect(c.lines).toContainEqual({ item: "Italian sausage", amount: "1½ lb", pantry: false });
    expect(c.spice).toBe("hot");
    expect(c.spiceWas).toBe("medium");
  });

  it("has nothing to cook on a HelloFresh night", () => {
    const f = edited(fakeMeals(), { op: "night", day: "wed", helloFresh: true });
    expect(cookOf(f, f.week!.slots[2]!)).toBeNull();
  });

  it("cooks a quick lunch for one, and has nothing to cook for leftovers (#719)", () => {
    const f = fakeMeals();
    const c = cookLunchOf(f, f.week!.slots[0]!)!;
    expect(c).toMatchObject({ course: "lunch", name: "chicken salad", dayName: "Monday", portions: 1, why: [] });
    expect(c.steps).toHaveLength(3);
    expect(c.lines).toContainEqual({ item: "Chicken breast", amount: "¾ lb", pantry: false });
    expect(cookLunchOf(f, f.week!.slots[1]!)).toBeNull();
    expect(cookOf(f, f.week!.slots[0]!)!.course).toBe("dinner");
  });

  it("ties each step to the ingredients it names, with their amounts (#1010)", () => {
    const c = wed(fakeMeals());
    const used = (i: number) => c.steps[i]!.uses.map((k) => `${c.lines[k]!.item} ${c.lines[k]!.amount}`);
    expect(used(0)).toEqual([]);
    expect(used(1)).toEqual(["Italian sausage 1 lb"]);
    expect(used(2)).toEqual(["Rigatoni 8 oz"]);
    expect(used(3)).toEqual(["Rigatoni 8 oz"]);
    expect(used(4)).toEqual(["Greek yogurt ½ cup"]);
  });

  it("follows a swap: the step that now names the new part uses its amount (#1010)", () => {
    const f = edited(fakeMeals(), { op: "customize", day: "wed", part: { index: 1, option: "protein-pasta" } });
    const c = wed(f);
    expect(c.steps[2]!.uses.map((k) => c.lines[k]!.item)).toEqual(["Protein pasta"]);
  });
});

describe("which ingredients a step uses (#1010)", () => {
  const lines = [lineNames("Chicken breast", "Chicken breast"), lineNames("Ground beef 85/15", "Ground beef"), lineNames("Corn tortillas"), lineNames("Black pepper"), lineNames("Red pepper flakes"), lineNames("Garlic"), lineNames("Lobster tail, 5 oz", "Lobster tail")];

  it("finds whole names, plurals and telling words alone, in the order the step says them", () => {
    expect(usesOf("Warm the tortilla, then sear the chicken.", lines)).toEqual([2, 0]);
    expect(usesOf("Brown the ground beef with the garlic.", lines)).toEqual([1, 5]);
    expect(usesOf("Broil the lobster tails.", lines)).toEqual([6]);
    expect(usesOf("Season the beef.", lines)).toEqual([1]);
  });

  it("ties a word two lines share to neither, but a whole name still to its own", () => {
    expect(usesOf("Season with pepper.", lines)).toEqual([]);
    expect(usesOf("Finish with black pepper.", lines)).toEqual([3]);
  });

  it("never matches inside another word or on what kind it is alone", () => {
    expect(usesOf("Bring well-salted water to a boil.", [lineNames("Salt")])).toEqual([]);
    expect(usesOf("Add the ground spices.", lines)).toEqual([]);
    expect(usesOf("Toss with garlicky oil.", lines)).toEqual([]);
  });
});
