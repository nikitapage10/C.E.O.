import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { FEED_TOKEN, LOG_TOKEN } from "../_site/roomkeys.ts";
import { fakeMeals } from "./meals.fixture.ts";
import { addLunches, applyEdit, candidates, dayProtein, lunchView, MEALS_PATH, mealsPut, portionsOf, readEdit, readMeals, shoppingList, statusOf, weekWords, type MealsDeps, type MealsFile } from "./meals.ts";

/** Lunches in the Kitchen's meal planner (#719): leftovers or a quick lunch from the catalog. Made-up meals only. */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const ok = (got: ReturnType<typeof applyEdit>): MealsFile => {
  if (!got.ok) throw new Error(got.error);
  return got.file;
};

/** The fixture as a file from before lunches: no course on any meal, every lunch plain text, no lunch days. */
function oldFile(): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(fakeMeals())) as { catalog: Array<Record<string, unknown>>; profile: Record<string, unknown>; week: { slots: Array<{ lunch: Record<string, unknown> }> } };
  raw.catalog = raw.catalog.filter((m) => m.course !== "lunch").map(({ course: _c, ...m }) => m);
  delete raw.profile.lunchDays;
  raw.week.slots.forEach((s, i) => (s.lunch = { text: i === 0 ? "Salad" : "Leftovers", protein: 50, leftoverOf: i === 0 ? null : i - 1, shop: [] }));
  return raw;
}

describe("lunches in the planner (#719)", () => {
  it("still reads a file from before lunches, every meal a dinner", () => {
    const f = readMeals(oldFile())!;
    expect(f.catalog).toHaveLength(10);
    expect(f.catalog.every((m) => m.course === "dinner")).toBe(true);
    expect(f.week!.slots[0]!.lunch).toEqual({ text: "Salad", protein: 50, leftoverOf: null, shop: [], meal: null, backups: [] });
    expect(f.profile.lunchDays).toEqual(["mon", "thu"]);
    expect(lunchView(f, f.week!.slots[0]!)).toMatchObject({ kind: "text", name: "Salad", protein: 50 });
  });

  it("drops a lunch naming a dinner or a missing meal, and a week with a lunch as a dinner", () => {
    const raw = JSON.parse(JSON.stringify(fakeMeals()));
    raw.week.slots[0].lunch.meal = "beef-bowl";
    raw.week.slots[4].lunch.meal = "gone";
    const f = readMeals(raw)!;
    expect(f.week!.slots[0]!.lunch.meal).toBeNull();
    expect(f.week!.slots[4]!.lunch.meal).toBeNull();
    const bad = JSON.parse(JSON.stringify(fakeMeals()));
    bad.week.slots[2].meal = "chicken-salad";
    expect(readMeals(bad)!.week).toBeNull();
  });

  it("counts a quick lunch's own protein, and leftovers as one more portion of the night as cooked", () => {
    const f = fakeMeals();
    expect(dayProtein(f, f.week!.slots[0]!).lunch).toBe(82);
    // Tuesday's lunch is Monday's beef bowl; quinoa on Monday moves it.
    const tue = f.week!.slots[1]!;
    expect(lunchView(f, tue)).toMatchObject({ kind: "leftovers", name: "Leftover beef bowl", from: "mon", protein: 80 });
    const g = ok(applyEdit(f, { op: "customize", day: "mon", part: { index: 1, option: "quinoa" } }, NOW));
    expect(dayProtein(g, g.week!.slots[1]!).lunch).toBe(86);
  });

  it("keeps lunches out of the dinners, and dinners out of the lunches", () => {
    const f = fakeMeals();
    expect(candidates(f).some((m) => m.course === "lunch")).toBe(false);
    expect(candidates(f, [], "lunch").map((m) => m.id).sort()).toEqual(["chicken-salad", "chicken-wrap", "steak-salad"]);
    expect(applyEdit(f, { op: "swap", day: "mon", meal: "steak-salad" }, NOW)).toEqual({ ok: false, error: "bad-meal" });
    expect(applyEdit(f, { op: "lunch", day: "mon", meal: "beef-bowl" }, NOW)).toEqual({ ok: false, error: "bad-meal" });
    expect(statusOf(f, f.catalog.find((m) => m.id === "chicken-salad")!)).toBe("week");
  });

  it("swaps a lunch: a quick one trades places with a backup, leftovers make last night bigger, with Undo", () => {
    const f = fakeMeals();
    expect(readEdit({ op: "lunch", day: "wed", meal: "steak-salad" })).toEqual({ op: "lunch", day: "wed", meal: "steak-salad" });
    expect(readEdit({ op: "lunch", day: "wed", meal: "steak-salad", leftovers: true })).toBeNull();
    expect(readEdit({ op: "lunch", day: "wed" })).toBeNull();
    // Wednesday: from Tuesday's leftovers to the steak salad, so Tuesday cooks one portion fewer.
    expect(portionsOf(f.week!)[1]).toBe(2);
    const a = applyEdit(f, { op: "lunch", day: "wed", meal: "steak-salad" }, NOW);
    const g = ok(a);
    expect(a.ok && a.changes[0]).toBe("Wednesday's lunch: steak salad instead of leftover chicken plate.");
    expect(g.week!.slots[2]!.lunch).toMatchObject({ meal: "steak-salad", leftoverOf: null });
    expect(g.week!.slots[2]!.lunch.backups).toHaveLength(2);
    expect(portionsOf(g.week!)[1]).toBe(1);
    expect(shoppingList(g).find((i) => i.item === "Sirloin steak")?.qty).toBe(1.5);
    // Back to leftovers.
    const h = ok(applyEdit(g, { op: "lunch", day: "wed", leftovers: true }, NOW));
    expect(h.week!.slots[2]!.lunch).toMatchObject({ meal: null, leftoverOf: 1 });
    expect(h.week!.slots[2]!.lunch.backups).toContain("steak-salad");
    expect(applyEdit(f, { op: "lunch", day: "mon", leftovers: true }, NOW)).toEqual({ ok: false, error: "bad-meal" });
    expect(ok(applyEdit(g, { op: "undo" }, NOW)).week!.slots[2]!.lunch.leftoverOf).toBe(1);
  });

  it("puts a quick lunch's ingredients on the shopping list, for one", () => {
    const lines = shoppingList(fakeMeals());
    // Monday's chicken salad and Friday's steak salad, each for one.
    expect(lines.find((i) => i.item === "Romaine hearts")).toEqual({ item: "Romaine hearts", qty: 0.5, unit: "each" });
    expect(lines.find((i) => i.item === "Snow peas")).toEqual({ item: "Snow peas", qty: 3, unit: "oz" });
  });

  it("passing on or avoiding a quick lunch swaps in a backup", () => {
    const f = fakeMeals();
    const g = ok(applyEdit(f, { op: "pass", meal: "chicken-salad", passed: true }, NOW));
    expect(g.week!.slots[0]!.lunch.meal).toBe("steak-salad");
    expect(g.week!.slots.every((s) => !s.lunch.backups.includes("chicken-salad"))).toBe(true);
    const h = ok(applyEdit(f, { op: "avoid", term: "snow peas" }, NOW));
    expect(h.week!.slots[4]!.lunch.meal).not.toBe("steak-salad");
  });

  it("plans lunches with the week: leftovers most days, quick lunches on Monday and the lunch days", () => {
    const g = ok(applyEdit(fakeMeals(), { op: "next-week" }, NOW));
    const l = g.week!.slots.map((s) => s.lunch);
    expect(l[0]!.meal).not.toBeNull();
    expect(l[4]!.meal).not.toBeNull();
    expect(l[0]!.meal).not.toBe(l[4]!.meal);
    for (const i of [1, 2, 3, 5, 6]) expect(l[i]).toMatchObject({ meal: null, leftoverOf: i - 1 });
    // Last week's quick lunches count as had.
    expect(g.catalog.find((m) => m.id === "chicken-salad")!.timesHad).toBe(1);
    expect(weekWords(g)).toMatch(/Monday: .*; lunch /);
  });

  it("adds a seed's lunches to a planner from before them, leaving the dinners and every edit alone", () => {
    const old = ok(applyEdit(readMeals(oldFile())!, { op: "customize", day: "tue", portion: 1.25 }, NOW));
    const got = addLunches(old, fakeMeals(), NOW);
    expect(got.added).toBe(3);
    expect(got.days).toBe(7);
    const w = got.file.week!;
    expect(w.slots.map((s) => s.meal)).toEqual(old.week!.slots.map((s) => s.meal));
    expect(w.slots.map((s) => s.backups)).toEqual(old.week!.slots.map((s) => s.backups));
    expect(w.slots[1]!.custom).toEqual({ portion: 1.25 });
    expect(w.slots[0]!.lunch.meal).toBe("chicken-salad");
    expect(w.slots[4]!.lunch.meal).toBe("steak-salad");
    expect(got.file.undo!.label).toBe("Lunches added");
    // A second run changes nothing.
    expect(addLunches(got.file, fakeMeals(), NOW)).toMatchObject({ added: 0, days: 0 });
  });
});

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: "1", contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? "1" : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && !files.has(path)) throw new BlobPreconditionError("unused");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}
const put = (body: unknown) => new Request("https://ceo.test/api/haven-meals", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${FEED}` }, body: JSON.stringify(body) });

describe("PUT /api/haven-meals { merge: \"lunches\" } (#719)", () => {
  it("adds the lunches to the planner that's there, counts back, never replaces", async () => {
    const blob = memoryBlob();
    const lines: string[] = [];
    const d: MealsDeps = { desk: { deskKey: "k", store: new MemoryAuthStore(), now: NOW }, blob, env: { [LOG_TOKEN]: "x", [FEED_TOKEN]: FEED }, log: (l) => lines.push(l) };
    expect((await mealsPut(put({ meals: fakeMeals(), merge: "lunches" }), d)).status).toBe(404);
    blob.files.set(MEALS_PATH, new TextEncoder().encode(JSON.stringify(oldFile())));
    expect((await mealsPut(put({ meals: fakeMeals(), merge: "dinners" }), d)).status).toBe(400);
    expect((await mealsPut(put({ meals: fakeMeals(), merge: "lunches", replace: true }), d)).status).toBe(400);
    const res = await mealsPut(put({ meals: fakeMeals(), merge: "lunches" }), d);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, added: 3, days: 7 });
    expect(text).not.toMatch(/salad|chicken/i);
    expect(lines.join(" ")).not.toMatch(/salad|chicken/i);
    const stored = readMeals(JSON.parse(new TextDecoder().decode(blob.files.get(MEALS_PATH)!)))!;
    expect(stored.catalog).toHaveLength(13);
    expect(JSON.parse(await (await mealsPut(put({ meals: fakeMeals(), merge: "lunches" }), d)).text())).toEqual({ ok: true, added: 0, days: 0 });
  });
});
