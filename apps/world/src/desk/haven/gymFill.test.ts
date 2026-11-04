import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../../../api/_haven/plan.fixture.ts";
import { DEFAULT_GYM_PLAN } from "../../../../../api/_haven/gymShape.ts";
import { promptFor } from "../../../../../api/_haven/photoShape.ts";
import type { HavenPlan } from "./data.ts";
import { GYM_KIT, gymFill, gymRoom, withGym } from "./gymFill.ts";
import { ART_MAX, artIdOf, artShoots } from "./gymArt.ts";

/** Filling the Gym and its exercise art (#718), on the made-up plan. */

const box = (i: { x: number; y: number; w: number; h: number }) => [i.x, i.y, i.x + i.w, i.y + i.h] as const;
const overlap = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;

describe("filling the Gym", () => {
  it("adds only what the plan's Gym is missing, inside it and clear of everything there", () => {
    const add = gymFill(FAKE_PLAN);
    const room = gymRoom(FAKE_PLAN)!;
    // The made-up gym has the whole kit: nothing to add. Without its bike and kettlebell, just those two come back.
    expect(add).toEqual([]);
    const less: HavenPlan = { ...FAKE_PLAN, items: FAKE_PLAN.items.filter((i) => i.k !== "bike" && i.k !== "kettle") };
    const back = gymFill(less);
    expect(back.map((i) => i.k)).toEqual(["bike", "kettle"]);
    for (const it of back) {
      expect(room.parts.some(([x, y, w, h]) => it.x >= x && it.y >= y && it.x + it.w <= x + w && it.y + it.h <= y + h)).toBe(true);
      for (const other of less.items.filter((o) => o.k !== "gmat" && !o.round)) expect(overlap(box(it), box(other))).toBe(false);
    }
    for (const it of add) {
      expect(room.parts.some(([x, y, w, h]) => it.x >= x && it.y >= y && it.x + it.w <= x + w && it.y + it.h <= y + h)).toBe(true);
      for (const other of FAKE_PLAN.items.filter((o) => o.k !== "gmat")) expect(overlap(box(it), box(other))).toBe(false);
    }
  });

  it("furnishes an empty gym with the whole kit, no two pieces on top of each other, the same way every time", () => {
    const bare: HavenPlan = { ...FAKE_PLAN, items: FAKE_PLAN.items.filter((i) => !["rack", "barbell", "bench", "dbrack", "kettle", "treadmill", "bike"].includes(i.k)) };
    const add = gymFill(bare);
    expect(add.map((i) => i.k)).toEqual(GYM_KIT.map((k) => k.k));
    for (let a = 0; a < add.length; a++) for (let b = a + 1; b < add.length; b++) expect(overlap(box(add[a]!), box(add[b]!))).toBe(false);
    expect(gymFill(bare)).toEqual(add);
    expect(withGym(bare).items.length).toBe(bare.items.length + add.length);
  });

  it("leaves a plan with no Gym alone", () => {
    const none: HavenPlan = { ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.map((r) => ({ ...r, tab: r.tab === "gym" ? null : r.tab })) };
    expect(gymFill(none)).toEqual([]);
    expect(withGym(none)).toBe(none);
  });
});

describe("the Gym's exercise art", () => {
  it("asks the library for each exercise once, in the workout style, with ids in the library's shape", () => {
    const shoots = artShoots(DEFAULT_GYM_PLAN);
    expect(shoots.length).toBe(8);
    expect(shoots.length).toBeLessThanOrEqual(ART_MAX);
    for (const s of shoots) {
      expect(s.style).toBe("workout");
      expect(s.meal).toMatch(/^gym-[a-z0-9][a-z0-9-]{1,43}$/);
    }
    expect(artIdOf("Ab wheel rollouts")).toBe("gym-ab-wheel-rollouts");
    expect(artIdOf("???")).toBe("gym-exercise");
  });

  it("prompts for the exercise in the night gym, with nobody recognisable", () => {
    const p = promptFor({ meal: "gym-side-plank", name: "Side plank", description: "", components: [], style: "workout" });
    expect(p).toContain("Exercise: Side plank.");
    expect(p).toContain("nobody recognisable");
    expect(p).not.toContain("food");
  });
});
