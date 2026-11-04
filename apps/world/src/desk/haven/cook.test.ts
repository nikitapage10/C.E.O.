import { describe, expect, it } from "vitest";
import { fakeMeals } from "../../../../../api/_haven/meals.fixture.ts";
import { applyEdit, type MealEdit, type MealsFile } from "./meals.ts";
import { cookOf } from "./cook.ts";

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
    expect(text(f, 2)).toBe("Cook the [protein pasta] two minutes short of the box, then save a cup of the water.");
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
});
