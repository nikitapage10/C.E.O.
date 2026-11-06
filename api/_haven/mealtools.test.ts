import { describe, expect, it } from "vitest";
import { MemoryPending } from "../_skippy/agent/pending.ts";
import { callTool, confirmTool, toolNamed, toolsFor, type ToolHost } from "../_skippy/agent/tools.ts";
import { classify, mealTalk } from "./classify.ts";
import { fakeMeals } from "./meals.fixture.ts";
import { applyEdit, candidates, componentFor, dishOf, readEdit, readMeals, slotDish, weekWords, type MealEdit, type MealsFile } from "./mealShape.ts";

/**
 * Talking to the meal planner (#698): every Skippy meal tool through `callTool` against a made-up planner file
 * (meals.fixture.ts), the taste edits it adds (likes, the house heat), the King Soopers send behind the Yes tap, and
 * the Haven's voice rules sending meal talk to Skippy. Nothing here is Nikita's plan, profile or budget.
 */

const NOW = Date.parse("2026-11-04T18:00:00Z");

interface Cart {
  picks: { key: string; productId: string }[];
  unmatched: number;
  connected: boolean;
  store: boolean;
}

/** A host whose planner lives in memory and runs the real `applyEdit`, as MealsStore does. */
function mealsHost(file: MealsFile | null = fakeMeals(), cart: Cart | null = null): ToolHost & { file: () => MealsFile | null; sent: { key: string; productId: string }[][]; edits: MealEdit[] } {
  let f = file;
  const sent: { key: string; productId: string }[][] = [];
  const edits: MealEdit[] = [];
  return {
    read: async () => "",
    memory: null,
    kitchenAdd: null,
    homeAct: null,
    fileIssue: null,
    skipTerms: [],
    now: NOW,
    meals: {
      read: async () => f,
      edit: async (edit) => {
        edits.push(edit);
        if (!f) return { ok: false, error: "not-seeded" };
        const got = applyEdit(f, edit, NOW);
        if (got.ok) f = got.file;
        return got;
      },
      send: async () => ({ added: 5, already: 1 }),
    },
    cart: cart && {
      now: async () => cart,
      send: async (picks) => {
        sent.push(picks);
        return { result: "sent", items: picks.length };
      },
    },
    file: () => f,
    sent,
    edits,
  };
}

const desk = { pending: null, surface: "desk" as const };
const slot = (f: MealsFile | null, day: number) => f!.week!.slots[day]!;

describe("Skippy's meal tools reach the planner (#698)", () => {
  it("reads the week without the budget, and says so when nothing is loaded", async () => {
    const raw = JSON.parse(JSON.stringify(fakeMeals()));
    raw.profile.budget = { min: 9871, max: 9872 };
    const f = readMeals(raw)!;
    const got = await callTool("meals_week", {}, mealsHost(f), desk);
    expect(got).toMatchObject({ ok: true, text: expect.stringContaining("Monday: beef bowl") });
    expect(JSON.stringify(got)).not.toMatch(/9871|9872|budget/i);
    expect(await callTool("meals_week", {}, mealsHost(null), desk)).toMatchObject({ ok: true, text: "The meal planner isn't loaded yet." });
    expect(await callTool("meals_week", {}, { ...mealsHost(), meals: null }, desk)).toMatchObject({ ok: false });
  });

  it("swaps a night by the meal's name, a backup trading places, and passes on one with not for me", async () => {
    const h = mealsHost();
    const got = await callTool("meals_swap", { day: "mon", meal: "Steak Bowl" }, h, desk);
    expect(got).toMatchObject({ ok: true, did: "Monday: steak bowl instead of beef bowl." });
    expect(slot(h.file(), 0).meal).toBe("steak-bowl");
    expect(slot(h.file(), 0).backups[0]).toBe("beef-bowl");
    expect(h.file()!.undo?.label).toBe("Monday swapped");

    const nope = await callTool("meals_swap", { day: "tue", not_for_me: true }, h, desk);
    expect(nope).toMatchObject({ ok: true });
    expect(slot(h.file(), 1).meal).toBe("kofta");
    expect(h.file()!.catalog.find((m) => m.id === "chicken-plate")!.passed).toBe(true);

    expect(await callTool("meals_swap", { day: "wed", meal: "chocolate cake" }, h, desk)).toMatchObject({ ok: false, text: expect.stringContaining("no meal called") });
    expect(await callTool("meals_swap", { day: "wed" }, h, desk)).toMatchObject({ ok: false, text: "Name the meal, or say not for me." });
    // A passed-on meal can't go back on a night until it's brought back.
    expect(await callTool("meals_swap", { day: "wed", meal: "chicken plate" }, h, desk)).toMatchObject({ ok: false, text: expect.stringContaining("passed on") });
  });

  it("swaps a day's lunch by name, or back to leftovers (#719)", async () => {
    const h = mealsHost();
    const got = await callTool("meals_swap", { day: "wed", meal: "steak salad", lunch: true }, h, desk);
    expect(got).toMatchObject({ ok: true, did: expect.stringContaining("Wednesday's lunch: steak salad instead of") });
    expect(slot(h.file(), 2).lunch.meal).toBe("steak-salad");
    expect(slot(h.file(), 2).meal).toBe("sausage-pasta");
    expect(await callTool("meals_swap", { day: "wed", meal: "leftovers", lunch: true }, h, desk)).toMatchObject({ ok: true });
    expect(slot(h.file(), 2).lunch.leftoverOf).toBe(1);
    expect(await callTool("meals_swap", { day: "mon", meal: "leftovers", lunch: true }, h, desk)).toMatchObject({ ok: false, text: expect.stringContaining("Monday") });
    // A dinner isn't a lunch, and a lunch isn't a dinner.
    expect(await callTool("meals_swap", { day: "wed", meal: "beef bowl", lunch: true }, h, desk)).toMatchObject({ ok: false, text: expect.stringContaining("no lunch called") });
    expect(await callTool("meals_swap", { day: "wed", meal: "steak salad" }, h, desk)).toMatchObject({ ok: false, text: expect.stringContaining("no meal called") });
  });

  it("customizes a part by name alone, with or without a role, and the portion and spice", async () => {
    const h = mealsHost();
    expect(await callTool("meals_customize", { day: "mon", option: "quinoa" }, h, desk)).toMatchObject({ ok: true });
    expect(slot(h.file(), 0).custom.parts).toEqual({ "1": "quinoa" });
    await callTool("meals_customize", { day: "mon", option: "no rice" }, h, desk);
    expect(slot(h.file(), 0).custom.parts).toEqual({ "1": "no-carb" });
    await callTool("meals_customize", { day: "mon", role: "protein", option: "chicken" }, h, desk);
    expect(slot(h.file(), 0).custom.parts?.["0"]).toMatch(/^chicken-/);
    await callTool("meals_customize", { day: "mon", portion: "1.25", spice: "hot" }, h, desk);
    expect(slot(h.file(), 0).custom).toMatchObject({ portion: 1.25, spice: "hot" });
    expect(slotDish(h.file()!, slot(h.file(), 0))!.changes).toContain("Hot");
    await callTool("meals_customize", { day: "mon", reset: true }, h, desk);
    expect(slot(h.file(), 0).custom).toEqual({});
  });

  it("says plainly what it can't customize", async () => {
    const h = mealsHost();
    expect(await callTool("meals_customize", { day: "tue", option: "kimchi" }, h, desk)).toMatchObject({ ok: false, text: "Tuesday's chicken plate has no side to change." });
    expect(await callTool("meals_customize", { day: "mon", option: "unicorn steak" }, h, desk)).toMatchObject({ ok: false, text: expect.stringContaining("no \"unicorn steak\"") });
    expect(await callTool("meals_customize", { day: "mon", role: "carb" }, h, desk)).toMatchObject({ ok: false, text: "Say what the carb should be instead." });
    expect(await callTool("meals_customize", { day: "mon" }, h, desk)).toMatchObject({ ok: false });
    expect(h.edits).toEqual([]);
  });

  it("sets a night's switches", async () => {
    const h = mealsHost();
    expect(await callTool("meals_night", { day: "fri", hellofresh: true, for_two: true }, h, desk)).toMatchObject({ ok: true });
    expect(slot(h.file(), 4)).toMatchObject({ helloFresh: true, forTwo: true });
    expect(await callTool("meals_night", { day: "fri" }, h, desk)).toMatchObject({ ok: false });
  });

  it("skips a dinner, a lunch or a day by voice (#788), and has it back", async () => {
    const h = mealsHost();
    expect(await callTool("meals_night", { day: "fri", skip: "dinner", reason: "out" }, h, desk)).toMatchObject({ ok: true });
    expect(slot(h.file(), 4).skip).toEqual({ dinner: "out" });
    await callTool("meals_night", { day: "sat", skip: "day" }, h, desk);
    expect(slot(h.file(), 5).skip).toEqual({ dinner: "skip", lunch: "skip" });
    await callTool("meals_night", { day: "fri", skip: "dinner", unskip: true }, h, desk);
    expect(slot(h.file(), 4).skip).toBeUndefined();
  });

  it("turns a dislike into an avoid rule that swaps the nights that break it, and takes it back", async () => {
    const h = mealsHost();
    const got = await callTool("meals_avoid", { ingredient: "Greek Yogurt" }, h, desk);
    expect(got).toMatchObject({ ok: true, text: expect.stringContaining("Noted: no greek yogurt.") });
    expect(slot(h.file(), 2).meal).not.toBe("sausage-pasta");
    expect(h.file()!.profile.avoid.map((a) => a.term)).toContain("greek yogurt");
    expect(await callTool("meals_avoid", { ingredient: "greek yogurt", allow: true }, h, desk)).toMatchObject({ ok: true });
    expect(await callTool("meals_avoid", { ingredient: "mushrooms", allow: true }, h, desk)).toMatchObject({ ok: false, text: "That wasn't on the avoid list." });
  });

  it("notes likes, the house heat and the protein goal, in one call, each with Undo", async () => {
    const h = mealsHost();
    const got = await callTool("meals_taste", { like: "Shrimp", heat: "hot", protein_goal: 210 }, h, desk);
    expect(got).toMatchObject({ ok: true });
    const f = h.file()!;
    expect(f.profile).toMatchObject({ likes: ["shrimp"], spice: "hot", proteinGoal: 210 });
    // The house heat cooks every night hot, but isn't a customization (no photo of its own for it).
    const d = slotDish(f, slot(f, 0))!;
    expect(d.spice).toBe("hot");
    expect(d.customized).toBe(false);
    expect(await callTool("meals_undo", {}, h, desk)).toMatchObject({ ok: true, text: expect.stringContaining("Undid") });
    expect(h.file()!.profile.proteinGoal).toBe(200);
    expect(await callTool("meals_taste", { unlike: "broccoli" }, h, desk)).toMatchObject({ ok: false, text: "That wasn't on the likes." });
    expect(await callTool("meals_taste", {}, h, desk)).toMatchObject({ ok: false });
    expect(await callTool("meals_taste", { heat: "as-written" }, h, desk)).toMatchObject({ ok: true, text: expect.stringContaining("back to the heat its recipe says") });
  });

  it("sends the week to the Kitchen list and plans the next week", async () => {
    const h = mealsHost();
    expect(await callTool("meals_send", {}, h, desk)).toMatchObject({ ok: true, did: "Sent the week to the Kitchen list" });
    expect(await callTool("meals_next_week", {}, h, desk)).toMatchObject({ ok: true, text: expect.stringContaining("Planned the week of 2026-11-16.") });
  });

  it("every edit a tool makes is one the closed set takes", async () => {
    const h = mealsHost();
    await callTool("meals_swap", { day: "mon", meal: "steak bowl" }, h, desk);
    await callTool("meals_customize", { day: "tue", option: "quinoa", portion: "1.5" }, h, desk);
    await callTool("meals_night", { day: "wed", in_cart: false }, h, desk);
    await callTool("meals_avoid", { ingredient: "kimchi", unless: "rice" }, h, desk);
    await callTool("meals_taste", { like: "tacos", heat: "mild" }, h, desk);
    await callTool("meals_undo", {}, h, desk);
    await callTool("meals_next_week", {}, h, desk);
    expect(h.edits.length).toBeGreaterThanOrEqual(8);
    for (const e of h.edits) expect(readEdit(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});

describe("King Soopers waits for Nikita's tap (#698)", () => {
  const picks = [
    { key: "garlic", productId: "0001" },
    { key: "limes", productId: "0002" },
  ];

  it("asks first, with exactly what goes, and sends those picks only on Yes", async () => {
    const h = mealsHost(fakeMeals(), { picks, unmatched: 1, connected: true, store: true });
    const pending = new MemoryPending();
    const got = await callTool("meals_cart", {}, h, { pending, surface: "desk" });
    expect(got.ok && "confirm" in got && got.confirm).toMatchObject({ label: "Send to King Soopers", summary: expect.stringContaining("Add the 2 matched items") });
    expect(h.sent).toEqual([]);
    const id = got.ok && "confirm" in got ? got.confirm.id : "";
    expect(await confirmTool(id, false, h, pending)).toMatchObject({ ok: true, text: "Cancelled; nothing happened." });
    expect(h.sent).toEqual([]);

    const again = await callTool("meals_cart", {}, h, { pending, surface: "desk" });
    const yes = await confirmTool(again.ok && "confirm" in again ? again.confirm.id : "", true, h, pending);
    expect(yes).toMatchObject({ ok: true, did: "Sent the picks to King Soopers" });
    expect(h.sent).toEqual([picks]);
  });

  it("never sends from a spoken surface, saying it waits for the tap (#926), and says what's missing before it asks", async () => {
    expect(toolsFor("spoken").map((t) => t.name)).toContain("meals_cart");
    expect(toolsFor("spoken").map((t) => t.name)).toEqual(expect.arrayContaining(["meals_swap", "meals_customize", "meals_avoid", "meals_taste", "meals_undo"]));
    expect(toolNamed("meals_cart")).toMatchObject({ effect: "send", confirm: true });
    const pending = new MemoryPending();
    expect(await callTool("meals_cart", {}, mealsHost(fakeMeals(), { picks, unmatched: 0, connected: false, store: true }), { pending, surface: "desk" })).toMatchObject({ ok: false, text: expect.stringContaining("isn't connected") });
    expect(await callTool("meals_cart", {}, mealsHost(fakeMeals(), { picks: [], unmatched: 3, connected: true, store: true }), { pending, surface: "desk" })).toMatchObject({ ok: false, text: expect.stringContaining("tap Match") });
    expect(await callTool("meals_cart", {}, mealsHost(fakeMeals(), null), { pending, surface: "desk" })).toMatchObject({ ok: false });
    expect(await callTool("meals_cart", {}, mealsHost(fakeMeals(), { picks, unmatched: 0, connected: true, store: true }), { pending, surface: "spoken", said: "send the week to King Soopers" })).toMatchObject({ ok: false, text: expect.stringContaining("waits for Nikita's Yes tap") });
    expect(pending.items).toEqual([]);
  });
});

describe("the taste edits (#698)", () => {
  it("reads like and heat edits, and refuses anything else", () => {
    expect(readEdit({ op: "like", term: " Salmon ", liked: true })).toEqual({ op: "like", term: "salmon", liked: true });
    expect(readEdit({ op: "like", term: "x", liked: true })).toBeNull();
    expect(readEdit({ op: "like", term: "salmon" })).toBeNull();
    expect(readEdit({ op: "heat", spice: "hot" })).toEqual({ op: "heat", spice: "hot" });
    expect(readEdit({ op: "heat", spice: null })).toEqual({ op: "heat", spice: null });
    expect(readEdit({ op: "heat", spice: "volcanic" })).toBeNull();
  });

  it("plans a liked meal first among equals", () => {
    const f = fakeMeals();
    const before = candidates(f).map((m) => m.id);
    const liked = applyEdit(f, { op: "like", term: "shrimp", liked: true }, NOW);
    expect(liked.ok && candidates(liked.file)[0]!.id).toBe("scampi");
    expect(before[0]).not.toBe("scampi");
  });

  it("drops a night's own spice once the house heat matches it", () => {
    const f = fakeMeals();
    const a = applyEdit(f, { op: "customize", day: "mon", spice: "hot" }, NOW);
    const b = a.ok ? applyEdit(a.file, { op: "heat", spice: "hot" }, NOW) : a;
    expect(b.ok && b.file.week!.slots[0]!.custom).toEqual({});
    expect(b.ok && weekWords(b.file)).toContain("House heat: hot.");
    // A night set milder than the house still says so.
    const c = b.ok ? applyEdit(b.file, { op: "customize", day: "tue", spice: "mild" }, NOW) : b;
    expect(c.ok && c.file.week!.slots[1]!.custom.spice).toBe("mild");
  });

  it("finds a component by what was said", () => {
    const f = fakeMeals();
    expect(componentFor(f, "Quinoa")?.id).toBe("quinoa");
    expect(componentFor(f, "brown rice")?.id).toBe("brown-rice");
    expect(componentFor(f, "no rice")?.id).toBe("no-carb");
    expect(componentFor(f, "no side")?.id).toBe("no-side");
    expect(componentFor(f, "none", "side")?.id).toBe("no-side");
    expect(componentFor(f, "rice", "carb")?.role).toBe("carb");
    expect(componentFor(f, "rice", "protein")).toBeUndefined();
    expect(componentFor(f, "xy")).toBeUndefined();
    expect(dishOf(f, f.catalog[0]!, {}).spice).toBe("medium");
  });
});

describe("the Haven's voice sends meal talk to Skippy (#698)", () => {
  it("never makes a to-do or shopping of the meal plan", () => {
    for (const said of ["swap Tuesday for tacos", "make Friday a HelloFresh night", "quinoa instead of rice on Monday", "Saturday for two", "more spicy", "make dinner milder", "send the week to King Soopers", "plan next week's meals", "a bigger portion on Thursday", "not for me", "what's for dinner tonight", "skip dinner Friday", "skip lunch on Tuesday", "skip Saturday's meals", "eating out on Friday"]) {
      expect(classify(said, null), said).toMatchObject({ kind: "skippy" });
    }
    expect(mealTalk("call the vet on Friday")).toBe(false);
  });

  it("keeps the other rules as they were", () => {
    expect(classify("call the vet on Friday", null)).toMatchObject({ kind: "todo" });
    expect(classify("remind me to swap the filters tomorrow", null)).toMatchObject({ kind: "todo" });
    expect(classify("add garlic and lemons", null)).toMatchObject({ kind: "shopping" });
    expect(classify("feed the cat 2 portions", null)).toMatchObject({ kind: "device" });
  });
});
