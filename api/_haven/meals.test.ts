import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FEED_TOKEN, LOG_TOKEN } from "../_site/roomkeys.ts";
import { KitchenList } from "./list.ts";
import { findMeal } from "./mealShape.ts";
import { fakeMeals } from "./meals.fixture.ts";
import {
  applyEdit,
  dayProtein,
  DAYS,
  dishOf,
  mealCounts,
  mealCountsOf,
  MEALS_PATH,
  mealsGet,
  mealsPost,
  mealsPut,
  photoJobs,
  plannedLines,
  readEdit,
  readMeals,
  shopLine,
  shoppingList,
  statusOf,
  type MealsDeps,
  type MealsFile,
} from "./meals.ts";

/** The Kitchen's meal planner (#678): the file's shape, the swap model, the edits and the passkey-only route. Made-up meals. */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const NOW = Date.parse("2026-11-04T18:00:00Z");

const fixture = fakeMeals;

describe("readMeals", () => {
  it("reads a good file, with no budget unless the store has one", () => {
    const f = fixture();
    expect(f.catalog).toHaveLength(13);
    expect(f.week?.slots.map((s) => s.day)).toEqual([...DAYS]);
    expect(f.profile.budget).toBeNull();
    expect(f.profile.proteinGoal).toBe(200);
  });

  it("refuses a file with no catalog, and drops a week naming a meal it doesn't have", () => {
    for (const v of [null, 1, "x", [], {}, { catalog: [] }]) expect(readMeals(v)).toBeNull();
    const raw = JSON.parse(JSON.stringify(fixture()));
    raw.week.slots[2].meal = "not-there";
    expect(readMeals(raw)?.week).toBeNull();
  });

  it("strips markup, closes the sets and clamps the numbers", () => {
    const raw = JSON.parse(JSON.stringify(fixture()));
    raw.catalog[0].name = '<img src=x onerror="1">Bowl';
    raw.catalog[0].spice = "volcanic";
    raw.catalog[0].macros.protein = 9e9;
    raw.catalog[0].parts.push({ role: "dessert", option: "cake" });
    raw.week.slots[0].custom = { parts: { "0": "Bad Id", "1": "quinoa" }, portion: 7, spice: "hot" };
    const f = readMeals(raw)!;
    expect(f.catalog[0]!.name).toBe('img src=x onerror="1" Bowl');
    expect(f.catalog[0]!.spice).toBe("medium");
    expect(f.catalog[0]!.macros.protein).toBe(400);
    expect(f.catalog[0]!.parts).toHaveLength(3);
    expect(f.week!.slots[0]!.custom).toEqual({ parts: { "1": "quinoa" }, spice: "hot" });
  });
});

describe("the swap model", () => {
  it("swaps a part: the old component's ingredients out, the new one's in, macros moved by the difference", () => {
    const f = fixture();
    const m = f.catalog[0]!;
    const base = dishOf(f, m);
    const d = dishOf(f, m, { parts: { "1": "quinoa" } });
    expect(base.customized).toBe(false);
    expect(d.macros.protein).toBe(80 - 6 + 12);
    expect(d.ingredients.map((i) => i.item)).toContain("Quinoa");
    expect(d.ingredients.map((i) => i.item)).not.toContain("Jasmine rice");
    expect(d.changes).toEqual(["Quinoa for jasmine rice"]);
    expect(dishOf(f, m, { parts: { "1": "no-carb" } }).changes).toEqual(["No jasmine rice"]);
    // A component of another role is ignored.
    expect(dishOf(f, m, { parts: { "1": "shrimp" } }).customized).toBe(false);
    expect(dishOf(f, m, { portion: 1.5 }).macros.protein).toBe(120);
  });

  it("counts the day's protein: dinner, lunch and the top-up, or HelloFresh's", () => {
    const f = fixture();
    const s = f.week!.slots[0]!;
    expect(dayProtein(f, s)).toEqual({ dinner: 80, lunch: 82, topUp: 75, total: 237 });
    expect(dayProtein(f, { ...s, helloFresh: true }).dinner).toBe(45);
  });
});

describe("applyEdit", () => {
  it("swaps a backup in, trading places, with Undo", () => {
    const got = applyEdit(fixture(), { op: "swap", day: "mon", meal: "steak-bowl" }, NOW);
    if (!got.ok) throw new Error(got.error);
    expect(got.file.week!.slots[0]!.meal).toBe("steak-bowl");
    expect(got.file.week!.slots[0]!.backups[0]).toBe("beef-bowl");
    expect(got.changes[0]).toMatch(/Monday: steak bowl instead of beef bowl/);
    const back = applyEdit(got.file, { op: "undo" }, NOW);
    expect(back.ok && back.file.week!.slots[0]!.meal).toBe("beef-bowl");
  });

  it("trades two nights when the meal swapped in is already another night's (#1095)", () => {
    const f = fixture();
    const tue = f.week!.slots[1]!.meal;
    const got = applyEdit(f, { op: "swap", day: "mon", meal: tue }, NOW);
    if (!got.ok) throw new Error(got.error);
    expect(got.file.week!.slots[0]!.meal).toBe(tue);
    expect(got.file.week!.slots[1]!.meal).toBe("beef-bowl");
    expect(got.file.week!.slots.filter((s) => s.meal === tue)).toHaveLength(1);
    expect(got.changes[0]).toMatch(/^Monday: .+ instead of beef bowl, which moves to Tuesday\.$/);
  });

  it("finds a meal said loosely, the week's own first (#1095)", () => {
    const f = fixture();
    const tue = f.week!.slots[1]!.meal;
    const name = f.catalog.find((m) => m.id === tue)!.name;
    expect(findMeal(f, `the ${name} from Tuesday`, "dinner")?.id).toBe(tue);
    expect(findMeal(f, `${name.split(" ").pop()}s`, "dinner")).toBeDefined();
    expect(findMeal(f, "the", "dinner")).toBeUndefined();
    expect(findMeal(f, "zzz unknown", "dinner")).toBeUndefined();
  });

  it("Not for me passes on the meal and puts the first backup on", () => {
    const got = applyEdit(fixture(), { op: "nope", day: "tue" }, NOW);
    if (!got.ok) throw new Error(got.error);
    expect(got.file.week!.slots[1]!.meal).toBe("kofta");
    expect(got.file.catalog.find((m) => m.id === "chicken-plate")!.passed).toBe(true);
    expect(statusOf(got.file, got.file.catalog.find((m) => m.id === "chicken-plate")!)).toBe("passed");
  });

  it("customizes a night, drafts the week again, and confirm queues the customized nights for photos", () => {
    let f = fixture();
    const c = applyEdit(f, { op: "confirm" }, NOW);
    if (!c.ok) throw new Error(c.error);
    expect(c.file.week!.confirmedAt).not.toBeNull();
    expect(c.file.week!.photoQueue).toEqual([]);
    const cu = applyEdit(c.file, { op: "customize", day: "wed", part: { index: 1, option: "potatoes" } }, NOW);
    if (!cu.ok) throw new Error(cu.error);
    f = cu.file;
    expect(f.week!.confirmedAt).toBeNull();
    expect(f.week!.slots[2]!.custom).toEqual({ parts: { "1": "potatoes" } });
    const again = applyEdit(f, { op: "confirm" }, NOW);
    if (!again.ok) throw new Error(again.error);
    expect(again.file.week!.photoQueue).toEqual(["wed"]);
    const jobs = photoJobs(again.file);
    expect(jobs).toEqual([
      {
        day: "wed",
        meal: "sausage-pasta",
        name: "sausage pasta",
        changes: ["Roast potatoes for rigatoni"],
        ingredients: expect.arrayContaining(["Yukon gold potatoes", "Italian sausage"]),
        basePhoto: "sausage-pasta",
      },
    ]);
    // The photo step writes its id back; the night leaves the queue and the week stays confirmed.
    const ph = applyEdit(again.file, { op: "photo", day: "wed", photo: "wed-custom-1" }, NOW);
    if (!ph.ok) throw new Error(ph.error);
    expect(ph.file.week!.slots[2]!.photo).toBe("wed-custom-1");
    expect(ph.file.week!.photoQueue).toEqual([]);
    expect(ph.file.week!.confirmedAt).not.toBeNull();
    // Swapping the part back to the recipe's own is no customization.
    const reset = applyEdit(f, { op: "customize", day: "wed", part: { index: 1, option: "rigatoni" } }, NOW);
    expect(reset.ok && reset.file.week!.slots[2]!.custom).toEqual({});
  });

  it("refuses a part of the wrong role", () => {
    expect(applyEdit(fixture(), { op: "customize", day: "mon", part: { index: 1, option: "shrimp" } }, NOW)).toEqual({ ok: false, error: "bad-meal" });
  });

  it("an avoided ingredient swaps every night that has it, but not one its unless covers", () => {
    const got = applyEdit(fixture(), { op: "avoid", term: "greek yogurt" }, NOW);
    if (!got.ok) throw new Error(got.error);
    expect(got.file.week!.slots[2]!.meal).not.toBe("sausage-pasta");
    expect(got.file.profile.avoid.map((a) => a.term)).toContain("greek yogurt");
    // Tacos have avocado, but with tortilla chips: they stay.
    expect(got.file.week!.slots[3]!.meal).toBe("tacos");
  });

  it("plans next week: seven fresh dinners, no cuisine twice running, last week's counted as had", () => {
    const got = applyEdit(fixture(), { op: "next-week" }, NOW);
    if (!got.ok) throw new Error(got.error);
    const w = got.file.week!;
    expect(w.start).toBe("2026-11-16");
    expect(new Set(w.slots.map((s) => s.meal)).size).toBe(7);
    const cuisines = w.slots.map((s) => got.file.catalog.find((m) => m.id === s.meal)!.cuisine);
    expect(cuisines.some((c, i) => i > 0 && c === cuisines[i - 1])).toBe(false);
    expect(got.file.catalog.find((m) => m.id === "beef-bowl")!.timesHad).toBe(1);
  });

  it("reads edits as untrusted data", () => {
    expect(readEdit({ op: "swap", day: "funday", meal: "x" })).toBeNull();
    expect(readEdit({ op: "customize", day: "mon" })).toBeNull();
    expect(readEdit({ op: "customize", day: "mon", portion: 3 })).toBeNull();
    expect(readEdit({ op: "goal", protein: 9000 })).toBeNull();
    expect(readEdit({ op: "photo", day: "mon", meal: "x-y", photo: "p1" })).toBeNull();
    expect(readEdit({ op: "avoid", term: "<b>Kale</b>" })).toEqual({ op: "avoid", term: "b kale /b" });
    expect(readEdit({ op: "night", day: "fri", helloFresh: true })).toEqual({ op: "night", day: "fri", helloFresh: true });
  });
});

describe("the shopping list", () => {
  it("sums the cooked nights by portions, leaves staples, HelloFresh and left-out nights out", () => {
    const f = fixture();
    const lines = shoppingList(f);
    // Saturday's ribeye: for two, plus Sunday's leftover lunch: three portions of 0.75 lb.
    expect(lines.find((i) => i.item === "Ribeye steak")).toEqual({ item: "Ribeye steak", qty: 2.25, unit: "lb" });
    expect(lines.some((i) => i.item === "Olive oil")).toBe(false);
    const hf = applyEdit(f, { op: "night", day: "sat", helloFresh: true }, NOW);
    expect(hf.ok && shoppingList(hf.file).some((i) => i.item === "Ribeye steak")).toBe(false);
    expect(shopLine({ item: "Ribeye steak", qty: 2.25, unit: "lb" })).toBe("Ribeye steak (2¼ lb)");
    expect(shopLine({ item: "Lime", qty: 2.5, unit: "each" })).toBe("Lime (3)");
  });

  it("skips a meal or a day (#788): out of the shopping, reasons kept, the week a draft again, Undo has it back", () => {
    const f = { ...fixture(), week: { ...fixture().week!, confirmedAt: "2026-11-03T12:00:00.000Z" } };
    // Saturday's ribeye for two, plus Sunday's leftover lunch: skipping Sunday's lunch takes one portion off.
    const lunch = applyEdit(f, { op: "night", day: "sun", skipLunch: "out" }, NOW);
    expect(lunch.ok && shoppingList(lunch.file).find((i) => i.item === "Ribeye steak")?.qty).toBe(1.5);
    expect(lunch.ok && lunch.file.week!.slots[6]!.skip).toEqual({ lunch: "out" });
    expect(lunch.ok && lunch.file.week!.confirmedAt).toBeNull();
    const dinner = applyEdit(f, { op: "night", day: "sat", skipDinner: "skip" }, NOW);
    expect(dinner.ok && shoppingList(dinner.file).some((i) => i.item === "Ribeye steak")).toBe(false);
    expect(dinner.ok && dayProtein(dinner.file, dinner.file.week!.slots[5]!).dinner).toBe(0);
    expect(dinner.ok && mealCounts(dinner.file)?.cooking).toBe(6);
    // Skip day, then back on: the slot reads exactly as it was.
    const day = applyEdit(f, { op: "night", day: "sat", skipDinner: "leftovers", skipLunch: "leftovers" }, NOW);
    expect(day.ok && readMeals(JSON.parse(JSON.stringify(day.file)))?.week?.slots[5]?.skip).toEqual({ dinner: "leftovers", lunch: "leftovers" });
    const back = day.ok ? applyEdit(day.file, { op: "night", day: "sat", skipDinner: null, skipLunch: null }, NOW) : null;
    expect(back?.ok && back.file.week!.slots[5]).toEqual(f.week.slots[5]);
    expect(readEdit({ op: "night", day: "fri", skipDinner: "bogus" })).toBeNull();
    expect(readEdit({ op: "night", day: "fri", skipDinner: null })).toEqual({ op: "night", day: "fri", skipDinner: null });
  });

  it("the public counts carry no meal", () => {
    expect(mealCounts(fixture())).toEqual({ planned: 7, cooking: 7, helloFresh: 0, confirmed: false });
  });
});

/* ── the route ── */

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

function deps(blob = memoryBlob()): MealsDeps & { lines: string[]; blob: ReturnType<typeof memoryBlob>; store: MemoryAuthStore } {
  const lines: string[] = [];
  const store = new MemoryAuthStore();
  return { desk: { deskKey: DESK, store, now: NOW }, blob, env: { [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED }, log: (l) => lines.push(l), lines, store };
}
const post = (body: unknown, cookie = "") =>
  new Request(`${ORIGIN}/api/haven-meals`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });
const put = (body: unknown, key?: string) =>
  new Request(`${ORIGIN}/api/haven-meals`, { method: "PUT", headers: { "Content-Type": "application/json", ...(key && { Authorization: `Bearer ${key}` }) }, body: JSON.stringify(body) });

describe("/api/haven-meals", () => {
  it("is passkey-only to read and change; the feed key may only seed, and gets counts back", async () => {
    const d = deps();
    expect((await mealsGet(new Request(`${ORIGIN}/api/haven-meals`), d)).status).toBe(401);
    expect((await mealsPost(post({ action: "confirm" }), d)).status).toBe(401);
    for (const key of [undefined, LOG, "wrong-key-wrong-key-wrong-key-wrong-key"]) expect((await mealsPut(put({ meals: fixture() }, key), d)).status).toBe(401);
    const seeded = await mealsPut(put({ meals: fixture() }, FEED), d);
    const text = await seeded.text();
    expect(JSON.parse(text)).toEqual({ ok: true, meals: 13, nights: 7, completed: 0 });
    expect(text).not.toContain("beef");
    expect((await mealsPut(put({ meals: fixture() }, FEED), d)).status).toBe(409);
    expect(d.blob.files.has(MEALS_PATH)).toBe(true);
    expect(await mealCountsOf(d.blob)).toEqual({ planned: 7, cooking: 7, helloFresh: 0, confirmed: false });
    // A recipe that never cooks a part (#1036): stored as written, counted back so the writer knows.
    const vague = fixture();
    vague.catalog.find((m) => m.id === "sausage-pasta")!.steps = ["Brown the sausage.", "Toss with the rigatoni."];
    expect(await (await mealsPut(put({ meals: vague, replace: true }, FEED), d)).json()).toEqual({ ok: true, meals: 13, nights: 7, completed: 1 });
  });

  it("the feed key upgrades only the recipes' written steps: the weeks, the edits, the list and the cart as they were (#1041)", async () => {
    const d = deps();
    const steps = { "sausage-pasta": ["Fill a large pot with water, salt it well and set it over high heat to come to a boil.", "Brown the Italian sausage, 6–8 min.", "Drop the rigatoni into the boiling water and cook 10 min.", "Toss it all together, 1 min."] };
    expect((await mealsPut(put({ merge: "steps", steps }, FEED), d)).status).toBe(404);
    const cookie = await signedInCookie(DESK, NOW, d.store);
    await mealsPost(post({ action: "seed", meals: fixture() }, cookie), d);
    await mealsPost(post({ action: "edit", edit: { op: "recipe", day: "thu", action: "drop", terms: ["avocado"] } }, cookie), d);
    await mealsPost(post({ action: "confirm" }, cookie), d);
    const before = JSON.parse(new TextDecoder().decode(d.blob.files.get(MEALS_PATH)!)) as { catalog: Array<{ id: string; steps: string[] }> };
    const list = await new KitchenList(d.blob).items(NOW);

    for (const key of [undefined, LOG]) expect((await mealsPut(put({ merge: "steps", steps }, key), d)).status).toBe(401);
    // Only steps: never a whole file with it, never a step too long, empty or one too many.
    for (const bad of [{ merge: "steps", steps, meals: fixture() }, { merge: "steps", steps, replace: true }, { merge: "steps", steps: { "sausage-pasta": ["x".repeat(241)] } }, { merge: "steps", steps: { "sausage-pasta": [] } }, { merge: "steps", steps: { "sausage-pasta": Array(17).fill("Stir.") } }, { merge: "steps", steps: { "Bad id!": ["Stir."] } }, { merge: "steps", steps: [] }])
      expect((await mealsPut(put(bad, FEED), d)).status, JSON.stringify(bad).slice(0, 80)).toBe(400);

    const res = await mealsPut(put({ merge: "steps", steps: { ...steps, "not-a-meal": ["Stir."], tacos: before.catalog.find((m) => m.id === "tacos")!.steps } }, FEED), d);
    expect(await res.json()).toEqual({ ok: true, updated: 1, unchanged: 1, missing: 1 });
    const after = JSON.parse(new TextDecoder().decode(d.blob.files.get(MEALS_PATH)!)) as typeof before;
    expect(after.catalog.find((m) => m.id === "sausage-pasta")!.steps).toEqual(steps["sausage-pasta"]);
    after.catalog.find((m) => m.id === "sausage-pasta")!.steps = before.catalog.find((m) => m.id === "sausage-pasta")!.steps;
    expect(after).toEqual(before);
    expect(await new KitchenList(d.blob).items(NOW)).toEqual(list);
    // Counts only in the log, never a meal.
    expect(d.lines.at(-1)).toBe("haven: recipe steps were rewritten with the feed key (1 updated, 1 unchanged, 1 not found)");
    // Again: nothing to write.
    expect(await (await mealsPut(put({ merge: "steps", steps }, FEED), d)).json()).toEqual({ ok: true, updated: 0, unchanged: 1, missing: 0 });
  });

  it("signed in: reads the plan, makes an edit, and confirm puts the shopping on the Kitchen list and queues the customized nights for photos", async () => {
    const d = deps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    const empty = await mealsGet(new Request(`${ORIGIN}/api/haven-meals`, { headers: { Cookie: cookie } }), d);
    expect(await empty.json()).toEqual({ meals: null, components: [] });
    expect((await mealsPost(post({ action: "seed", meals: fixture() }, cookie), d)).status).toBe(200);
    const edited = await mealsPost(post({ action: "edit", edit: { op: "customize", day: "mon", part: { index: 1, option: "quinoa" } } }, cookie), d);
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { changes: string[] }).changes[0]).toMatch(/quinoa for jasmine rice/);
    expect(d.lines).toContain("haven: meals customize");
    expect((await mealsPost(post({ action: "edit", edit: { op: "swap", day: "nope" } }, cookie), d)).status).toBe(400);

    const res = await mealsPost(post({ action: "confirm" }, cookie), d);
    const body = (await res.json()) as { added: number; photos: number; meals: MealsFile };
    expect(res.status).toBe(200);
    expect(body.photos).toBe(1);
    expect(body.added).toBeGreaterThan(10);
    expect(body.meals.week!.confirmedAt).not.toBeNull();
    expect(body.meals.week!.sentAt).not.toBeNull();
    expect(body.meals.week!.photoQueue).toEqual(["mon"]);
    const list = await new KitchenList(d.blob).items(NOW);
    expect(list.every((i) => i.source === "meals")).toBe(true);
    expect(list.map((i) => i.name)).toContain("Quinoa (1 cup)");
  });

  it("a change after finalizing reopens Finalize and marks what no longer fits; finalizing again takes it off; reopen opens the week (#761)", async () => {
    const d = deps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    await mealsPost(post({ action: "seed", meals: fixture() }, cookie), d);
    await mealsPost(post({ action: "edit", edit: { op: "customize", day: "mon", part: { index: 1, option: "quinoa" } } }, cookie), d);
    await mealsPost(post({ action: "confirm" }, cookie), d);
    const list = new KitchenList(d.blob);
    await list.add(["paper towels"], NOW);
    // Changed back after finalizing: a draft again, and quinoa no longer wanted.
    const back = (await (await mealsPost(post({ action: "edit", edit: { op: "customize", day: "mon", part: { index: 1, option: "jasmine-rice" } } }, cookie), d)).json()) as { meals: MealsFile };
    expect(back.meals.week!.confirmedAt).toBeNull();
    const plan = plannedLines(back.meals);
    expect(plan.changed).toBe(1);
    expect(plan.keep.has("quinoa (1 cup)")).toBe(false);
    // Finalize again: quinoa comes off the list; his own item stays.
    const again = (await (await mealsPost(post({ action: "confirm" }, cookie), d)).json()) as { dropped: number; meals: MealsFile };
    expect(again.dropped).toBeGreaterThanOrEqual(1);
    const names = (await list.items(NOW)).map((i) => i.name);
    expect(names).not.toContain("Quinoa (1 cup)");
    expect(names).toContain("paper towels");
    expect(plannedLines(again.meals).changed).toBe(0);
    // Clear list: everything off, then the week reopened.
    expect(await list.clearAll(NOW)).toBe(names.length);
    const reopened = (await (await mealsPost(post({ action: "reopen" }, cookie), d)).json()) as { meals: MealsFile };
    expect(reopened.meals.week).toMatchObject({ confirmedAt: null, sentAt: null, photoQueue: [] });
    expect(plannedLines(reopened.meals)).toMatchObject({ changed: 0, fresh: [] });
  });
});
