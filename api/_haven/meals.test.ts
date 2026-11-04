import { afterEach, describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FEED_TOKEN, LOG_TOKEN } from "../_site/roomkeys.ts";
import { KitchenList } from "./list.ts";
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
  onConfirmPhotos,
  photoJobs,
  readEdit,
  readMeals,
  shopLine,
  shoppingList,
  statusOf,
  type MealsDeps,
  type MealsFile,
  type PhotoJob,
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
    expect(f.catalog).toHaveLength(10);
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
    expect(dayProtein(f, s)).toEqual({ dinner: 80, lunch: 50, topUp: 75, total: 205 });
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
    expect(jobs).toEqual([{ day: "wed", meal: "sausage-pasta", name: "sausage pasta", changes: ["Roast potatoes for rigatoni"], ingredients: expect.arrayContaining(["Yukon gold potatoes", "Italian sausage"]), basePhoto: "sausage-pasta" }]);
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
const post = (body: unknown, cookie = "") => new Request(`${ORIGIN}/api/haven-meals`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });
const put = (body: unknown, key?: string) => new Request(`${ORIGIN}/api/haven-meals`, { method: "PUT", headers: { "Content-Type": "application/json", ...(key && { Authorization: `Bearer ${key}` }) }, body: JSON.stringify(body) });

describe("/api/haven-meals", () => {
  afterEach(() => {
    onConfirmPhotos.run = null;
  });

  it("is passkey-only to read and change; the feed key may only seed, and gets counts back", async () => {
    const d = deps();
    expect((await mealsGet(new Request(`${ORIGIN}/api/haven-meals`), d)).status).toBe(401);
    expect((await mealsPost(post({ action: "confirm" }), d)).status).toBe(401);
    for (const key of [undefined, LOG, "wrong-key-wrong-key-wrong-key-wrong-key"]) expect((await mealsPut(put({ meals: fixture() }, key), d)).status).toBe(401);
    const seeded = await mealsPut(put({ meals: fixture() }, FEED), d);
    const text = await seeded.text();
    expect(JSON.parse(text)).toEqual({ ok: true, meals: 10, nights: 7 });
    expect(text).not.toContain("beef");
    expect((await mealsPut(put({ meals: fixture() }, FEED), d)).status).toBe(409);
    expect(d.blob.files.has(MEALS_PATH)).toBe(true);
    expect(await mealCountsOf(d.blob)).toEqual({ planned: 7, cooking: 7, helloFresh: 0, confirmed: false });
  });

  it("signed in: reads the plan, makes an edit, and confirm puts the shopping on the Kitchen list and hands the photo step its nights", async () => {
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

    const handed: PhotoJob[][] = [];
    onConfirmPhotos.run = async (jobs) => void handed.push(jobs);
    const res = await mealsPost(post({ action: "confirm" }, cookie), d);
    const body = (await res.json()) as { added: number; photos: number; meals: MealsFile };
    expect(res.status).toBe(200);
    expect(body.photos).toBe(1);
    expect(body.added).toBeGreaterThan(10);
    expect(body.meals.week!.confirmedAt).not.toBeNull();
    expect(body.meals.week!.sentAt).not.toBeNull();
    expect(handed[0]!.map((j) => j.day)).toEqual(["mon"]);
    const list = await new KitchenList(d.blob).items(NOW);
    expect(list.every((i) => i.source === "meals")).toBe(true);
    expect(list.map((i) => i.name)).toContain("Quinoa (1 cup)");
  });
});
