import { describe, expect, it } from "vitest";
import { fakeMeals } from "./meals.fixture.ts";
import { applyEdit, mealCounts, ordersIn, readEdit, readMeals, shoppingList, weekWords, type MealsFile } from "./mealShape.ts";

/** Order-in in the meal plan (#1195, phase 2): a skip whose reason is DoorDash, the weekend default and a store per meal. Made-up meals and stores. */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const ok = (got: ReturnType<typeof applyEdit>): MealsFile => {
  if (!got.ok) throw new Error(got.error);
  return got.file;
};
const weekend = (f: MealsFile, w = f.week!) => w.slots.filter((s) => s.day === "sat" || s.day === "sun").map((s) => s.skip?.dinner ?? null);

describe("order-in", () => {
  it("reads the setting: weekends on unless the file says off, stores only with a numeric id and a name", () => {
    expect(fakeMeals().profile.orderIn).toEqual({ weekends: true, stores: {} });
    const raw = JSON.parse(JSON.stringify(fakeMeals()));
    raw.profile.orderIn = { weekends: false, stores: { "sat-dinner": { id: "123456", name: "<b>Noodle</b> Bar" }, "sun-dinner": { id: "abc", name: "Nope" }, "fun-dinner": { id: "1", name: "Nope" }, "fri-lunch": { id: "42", name: "" } } };
    expect(readMeals(raw)!.profile.orderIn).toEqual({ weekends: false, stores: { "sat-dinner": { id: "123456", name: "b Noodle /b Bar" } } });
  });

  it("orders a meal in: off the shopping and the cooking, a draft again, said plainly, and read back", () => {
    const f = { ...fakeMeals(), week: { ...fakeMeals().week!, confirmedAt: "2026-11-03T12:00:00.000Z" } };
    expect(readEdit({ op: "night", day: "sat", skipDinner: "order" })).toEqual({ op: "night", day: "sat", skipDinner: "order" });
    const got = applyEdit(f, { op: "night", day: "sat", skipDinner: "order" }, NOW);
    const g = ok(got);
    expect(got.ok && got.changes).toEqual(["Saturday's dinner: ordered in, so nothing to cook or buy for it."]);
    expect(shoppingList(g).some((i) => i.item === "Ribeye steak")).toBe(false);
    expect(ordersIn(g.week!.slots[5]!, "dinner")).toBe(true);
    expect(mealCounts(g)?.cooking).toBe(6);
    expect(g.week!.confirmedAt).toBeNull();
    expect(readMeals(JSON.parse(JSON.stringify(g)))!.week!.slots[5]!.skip).toEqual({ dinner: "order" });
    expect(weekWords(g)).toContain("dinner skipped (order in;");
    // A lunch can be ordered in too.
    const lunch = ok(applyEdit(f, { op: "night", day: "tue", skipLunch: "order" }, NOW));
    expect(ordersIn(lunch.week!.slots[1]!, "lunch")).toBe(true);
  });

  it("plans the weekend dinners as order-in while the setting is on, and cooks them when it's off", () => {
    const on = ok(applyEdit(fakeMeals(), { op: "next-week" }, NOW));
    expect(weekend(on)).toEqual(["order", "order"]);
    expect(on.week!.slots.filter((s) => s.skip).map((s) => s.day)).toEqual(["sat", "sun"]);
    const ahead = ok(applyEdit(on, { op: "plan-ahead" }, NOW));
    expect(weekend(ahead, ahead.ahead[0])).toEqual(["order", "order"]);
    const raw = JSON.parse(JSON.stringify(fakeMeals()));
    raw.profile.orderIn = { weekends: false };
    const off = ok(applyEdit(readMeals(raw)!, { op: "next-week" }, NOW));
    expect(off.week!.slots.some((s) => s.skip)).toBe(false);
  });

  it("turning the setting on or off changes the draft weeks' weekend dinners, never a finalized week's, with Undo", () => {
    const f = ok(applyEdit(fakeMeals(), { op: "plan-ahead" }, NOW));
    // This week finalized, the week ahead a draft (planned with the setting on).
    const fin: MealsFile = { ...f, week: { ...f.week!, confirmedAt: "2026-11-03T12:00:00.000Z" } };
    expect(readEdit({ op: "order-in", weekends: false, week: "2026-11-16" })).toEqual({ op: "order-in", weekends: false });
    expect(readEdit({ op: "order-in", weekends: "yes" })).toBeNull();
    const off = applyEdit(fin, { op: "order-in", weekends: false }, NOW);
    const o = ok(off);
    expect(o.profile.orderIn.weekends).toBe(false);
    expect(weekend(o, o.ahead[0])).toEqual([null, null]);
    expect(weekend(o)).toEqual([null, null]);
    expect(o.week!.confirmedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(off.ok && off.changes[0]).toBe("Weekends are cooked again (2 weekend dinners in the draft weeks back on).");
    const on = ok(applyEdit(o, { op: "order-in", weekends: true }, NOW));
    expect(weekend(on, on.ahead[0])).toEqual(["order", "order"]);
    // The finalized week keeps its weekend as it was shopped.
    expect(weekend(on)).toEqual([null, null]);
    // A HelloFresh weekend night, or one already skipped for another reason, stays as it is.
    const hf = ok(applyEdit(o, { op: "night", day: "sat", helloFresh: true, week: "2026-11-16" }, NOW));
    const out = ok(applyEdit(hf, { op: "night", day: "sun", skipDinner: "out", week: "2026-11-16" }, NOW));
    const again = ok(applyEdit(out, { op: "order-in", weekends: true }, NOW));
    expect(weekend(again, again.ahead[0])).toEqual([null, "out"]);
    expect(ok(applyEdit(on, { op: "undo" }, NOW)).profile.orderIn.weekends).toBe(false);
  });

  it("remembers a store per meal without touching the plan or its Undo, and forgets it", () => {
    const f = ok(applyEdit(fakeMeals(), { op: "night", day: "sat", skipDinner: "order" }, NOW));
    expect(readEdit({ op: "order-store", day: "sat", course: "dinner", store: { id: "987", name: "Taco Spot" } })).toEqual({ op: "order-store", day: "sat", course: "dinner", store: { id: "987", name: "Taco Spot" } });
    for (const bad of [{ id: "x9", name: "A" }, { id: "1", name: "" }, "987", undefined]) expect(readEdit({ op: "order-store", day: "sat", course: "dinner", store: bad })).toBeNull();
    expect(readEdit({ op: "order-store", day: "sat", course: "brunch", store: null })).toBeNull();
    const got = applyEdit(f, { op: "order-store", day: "sat", course: "dinner", store: { id: "987", name: "Taco Spot" } }, NOW);
    const g = ok(got);
    expect(g.profile.orderIn.stores).toEqual({ "sat-dinner": { id: "987", name: "Taco Spot" } });
    expect(got.ok && got.changes).toEqual(["Taco Spot is remembered for Saturday dinners."]);
    expect(g.undo).toEqual(f.undo);
    expect(g.week).toEqual(f.week);
    const gone = ok(applyEdit(g, { op: "order-store", day: "sat", course: "dinner", store: null }, NOW));
    expect(gone.profile.orderIn.stores).toEqual({});
  });
});
