import { describe, expect, it } from "vitest";
import { fakeMeals } from "./meals.fixture.ts";
import { AHEAD_MAX, allWeeks, applyEdit, readEdit, readMeals, shoppingList, viewOf, type MealsFile } from "./meals.ts";

/** Weeks planned ahead (#721): up to a month, each edited by its Monday. Made-up meals only. */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const ok = (got: ReturnType<typeof applyEdit>): MealsFile => {
  if (!got.ok) throw new Error(got.error);
  return got.file;
};
const ahead = (n: number) => Array.from({ length: n }).reduce<MealsFile>((f) => ok(applyEdit(f, { op: "plan-ahead" }, NOW)), fakeMeals());

describe("weeks ahead (#721)", () => {
  it("reads a file without them as it was, and keeps only whole weeks after the current one", () => {
    expect(fakeMeals().ahead).toEqual([]);
    const f = ahead(2);
    const raw = JSON.parse(JSON.stringify(f));
    raw.ahead.push(raw.week, { start: "nope" }, raw.ahead[0]);
    const back = readMeals(raw)!;
    expect(back.ahead.map((w) => w.start)).toEqual(["2026-11-16", "2026-11-23"]);
  });

  it("plans up to a month: three weeks after this one, each its own meals", () => {
    const f = ahead(AHEAD_MAX);
    expect(allWeeks(f).map((w) => w.start)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(applyEdit(f, { op: "plan-ahead" }, NOW)).toEqual({ ok: false, error: "full" });
    // A week ahead doesn't repeat the dinners of the week before it, where the catalog allows.
    expect(f.ahead[0]!.slots[0]!.meal).not.toBe(f.week!.slots[0]!.meal);
  });

  it("edits a week ahead by its Monday, leaves the current week alone, and Undo puts it back", () => {
    const f = ahead(1);
    expect(readEdit({ op: "swap", day: "mon", meal: "kofta", week: "2026-11-16" })).toEqual({ op: "swap", day: "mon", meal: "kofta", week: "2026-11-16" });
    expect(readEdit({ op: "undo", week: "2026-11-16" })).toEqual({ op: "undo" });
    const g = ok(applyEdit(f, { op: "night", day: "tue", forTwo: true, week: "2026-11-16" }, NOW));
    expect(g.ahead[0]!.slots[1]!.forTwo).toBe(true);
    expect(g.week).toEqual(f.week);
    expect(g.week!.start).toBe("2026-11-09");
    const u = ok(applyEdit(g, { op: "undo" }, NOW));
    expect(u.week!.start).toBe("2026-11-09");
    expect(u.ahead[0]!.slots[1]!.forTwo).toBe(false);
    expect(applyEdit(f, { op: "night", day: "tue", forTwo: true, week: "2027-01-04" }, NOW)).toEqual({ ok: false, error: "no-week" });
  });

  it("confirms a week ahead on its own, and its shopping is its own", () => {
    const f = ahead(1);
    const g = ok(applyEdit(f, { op: "confirm", week: "2026-11-16" }, NOW));
    expect(g.ahead[0]!.confirmedAt).not.toBeNull();
    expect(g.week!.confirmedAt).toBeNull();
    expect(viewOf(g, "2026-11-16").week!.start).toBe("2026-11-16");
    expect(viewOf(g, null).week!.start).toBe("2026-11-09");
    expect(shoppingList(viewOf(g, "2026-11-16"))).not.toEqual(shoppingList(g));
  });

  it("next week moves on to the week planned ahead; an avoid reaches every week", () => {
    const f = ahead(2);
    const g = ok(applyEdit(f, { op: "next-week" }, NOW));
    expect(g.week).toEqual(f.ahead[0]);
    expect(g.ahead.map((w) => w.start)).toEqual(["2026-11-23"]);
    const h = ok(applyEdit(f, { op: "avoid", term: "rigatoni" }, NOW));
    for (const w of allWeeks(h)) expect(w.slots.some((s) => s.meal === "sausage-pasta")).toBe(false);
  });
});
