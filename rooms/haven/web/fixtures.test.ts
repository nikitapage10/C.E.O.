import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { placeLight, readPlan } from "../../../api/_haven/planShape.ts";
import { furnish } from "./furnish.ts";
import { backlightRun, kindOf, kitchenRun, laundrySpot, placeFixture, spotRows, studioLampCorner } from "./fixtures.ts";
import { drawList, spotCount } from "./realLights.ts";
import type { Light } from "./lights.ts";
import { cut, cutAll, layout } from "./surroundings.ts";

/** The home's own fixtures, the hob's place and the block round the home (#1007), on the made-up plan only. */

const stored = readPlan(FAKE_PLAN)!;
const plan = furnish(stored);
const sb = (name: string, on = true): Light => ({ id: name, vendor: "switchbot", name, type: "Bot", on, online: true });
const mid = (b: [number, number, number, number]) => (b[0] + b[2]) / 2;

describe("the kitchen as drawn (#1007)", () => {
  it("puts the hob centre-left on the run, from the fridge's end, clear of the sink", () => {
    const k = kitchenRun(plan)!;
    expect(k.wall).toBe("n");
    // Looking at the run on the north wall, the fridge is on the left (west) and the hob about a third along from it.
    expect(mid(k.fridge!)).toBeLessThan(k.run[0]);
    const t = (mid(k.hob!) - k.run[0]) / (k.run[2] - k.run[0]);
    expect(t).toBeGreaterThan(0.25);
    expect(t).toBeLessThan(0.45);
    const sink = plan.items.find((i) => i.k === "sink")!;
    expect(sink.x + sink.w <= k.hob![0] || sink.x >= k.hob![2]).toBe(true);
  });

  it("runs the backlight along the run's wall from the hob toward the coffee maker or the far end", () => {
    const k = kitchenRun(plan)!, b = backlightRun(plan)!;
    expect(b.kind).toBe("backlight");
    expect(b.run.y0).toBeCloseTo(k.run[1] + 1.5);
    expect(b.run.y1).toBe(b.run.y0);
    expect(b.run.x0).toBeGreaterThan(k.hob![2]);
    expect(b.run.x1).toBeLessThanOrEqual(k.coffee ? k.coffee[0] : k.run[2]);
    expect(b.out).toEqual([0, 1]);
  });
});

describe("the home's fixtures (#1007)", () => {
  it("knows the four switches by name, and the plan's own kind first", () => {
    expect(kindOf("Left Living Room")).toBe("spots");
    expect(kindOf("right living room")).toBe("spots");
    expect(kindOf("Kitchen")).toBe("backlight");
    expect(kindOf("Laundry")).toBe("glow");
    expect(kindOf("Porch")).toBeNull();
    expect(kindOf("Porch", { kind: "spots" })).toBe("spots");
  });

  it("lays the two spot rows across the open kitchen and the hall, the first before the island, the second past it", () => {
    const [a, b] = spotRows(plan)!;
    const k = kitchenRun(plan)!;
    expect(a.y0).toBe(a.y1);
    expect(a.y0).toBeGreaterThan(k.run[3]);
    expect(a.y0).toBeLessThan(k.island![1]);
    expect(b.y0).toBeGreaterThan(k.island![3]);
    expect(b.y0).toBeLessThan(k.R[3]);
    // Into the hall at the kitchen's west end.
    const hall = plan.rooms.find((r) => r.id === "hall")!.parts[0]!;
    expect(a.x0).toBeLessThan(hall[0] + hall[2]);
    expect(a.x1).toBeLessThanOrEqual(k.R[2]);
    expect(spotCount(a.x1 - a.x0)).toBeGreaterThanOrEqual(3);
  });

  it("puts the laundry's fitting at the hall's far end from the kitchen", () => {
    const hall = plan.rooms.find((r) => r.id === "hall")!.parts[0]!;
    expect(laundrySpot(plan)).toEqual({ x: hall[0] + hall[2] / 2, y: hall[1] + hall[3] * 0.8 });
  });

  it("takes a saved run over the house's own, and a saved point as a row through it", () => {
    expect(placeFixture(plan, "spots", { x: 100, y: 200, x2: 500, y2: 210 })!.run).toEqual({ x0: 100, y0: 200, x1: 500, y1: 210 });
    const through = placeFixture(plan, "spots", { x: 400, y: 150 })!.run;
    expect([through.y0, through.y1]).toEqual([150, 150]);
    expect(through.x1 - through.x0).toBeGreaterThan(400);
    const strip = placeFixture(plan, "backlight", { x: 300, y: 50, x2: 500, y2: 50 })!;
    expect(strip.out).toEqual([0, 1]);
  });

  it("draws each of the four as its fixture, the marker at the run's middle", () => {
    const list = drawList(plan, [sb("Left Living Room"), sb("Right Living Room"), sb("Kitchen"), sb("Laundry", false)], undefined, false);
    expect(list.map((d) => d.fixture)).toEqual(["spots", "spots", "backlight", "glow"]);
    const [a, b] = spotRows(plan)!;
    expect(list[0]!.place!.run).toEqual(a);
    expect(list[1]!.place!.run).toEqual(b);
    expect(list[0]!.y).toBe(a.y0);
    expect(list.every((d) => !d.room)).toBe(true);
  });

  it("saves a run's far end on the plan, clamped, and keeps a saved kind", () => {
    const p = placeLight({ ...stored, lights: [{ name: "Porch", x: 1, y: 1, kind: "glow" }] }, "porch", { x: 10, y: 20, x2: 99999, y2: 30 })!;
    expect(p.lights).toEqual([{ name: "porch", x: 10, y: 20, x2: stored.w, y2: 30, kind: "glow" }]);
    expect(readPlan({ ...FAKE_PLAN, lights: [{ name: "Row", x: 1, y: 2, x2: 3, y2: 4, kind: "spots" }, { name: "Odd", x: 1, y: 2, kind: "disco" }] })!.lights).toEqual([
      { name: "Row", x: 1, y: 2, x2: 3, y2: 4, kind: "spots" },
      { name: "Odd", x: 1, y: 2 },
    ]);
  });
});

describe("the Studio's floor lamps (#1007)", () => {
  const studio = furnish(readPlan({ ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.map((r) => (r.id === "study" ? { ...r, name: "Studio" } : r)) })!);
  const govee = (name: string): Light => ({ ...sb(name), vendor: "govee" });
  const [sx, sy, sw, sh] = studio.rooms.find((r) => r.id === "study")!.parts[0]!;

  it("stands one in the corner over the DJ decks and one behind the sofas, by order or by left and right", () => {
    const list = drawList(studio, [govee("Studio Floor Lamp 1"), govee("Studio Floor Lamp 2")], undefined, false);
    // The decks in the north-east corner, the sofas meeting in the south-west (furnish.ts STUDIO_WALLS).
    expect(list.map((d) => [d.fixture, d.x, d.y])).toEqual([
      ["floor", sx + sw - 18, sy + 18],
      ["floor", sx + 18, sy + sh - 18],
    ]);
    expect(studioLampCorner("Studio Lamp Left", 0)).toBe("sofas");
    expect(studioLampCorner("Studio Lamp Right", 1)).toBe("dj");
  });

  it("leaves a saved spot where it is", () => {
    const list = drawList(studio, [govee("Studio Floor Lamp")], [{ name: "studio floor lamp", x: 700, y: 500 }], false);
    expect([list[0]!.x, list[0]!.y]).toEqual([700, 500]);
  });
});

describe("the block round the home (#1007)", () => {
  it("cuts boxes out of boxes", () => {
    expect(cut({ x0: 0, z0: 0, x1: 10, z1: 10 }, { x0: 20, z0: 20, x1: 30, z1: 30 })).toHaveLength(1);
    const parts = cutAll({ x0: 0, z0: 0, x1: 10, z1: 10 }, [{ x0: 3, z0: 3, x1: 6, z1: 6 }]);
    expect(parts.reduce((a, p) => a + (p.x1 - p.x0) * (p.z1 - p.z0), 0)).toBeCloseTo(100 - 9);
  });

  it("leaves the home, its decks and the gym uncovered, the courtyard on the balcony side, the street on the other", () => {
    const home = { x0: -5, z0: -6, x1: 5, z1: 6 }, gym = { x0: 0, z0: -12, x1: 6, z1: -8 };
    const L = layout(home, [home, gym], true);
    const hits = (b: typeof home) => L.roofs.some((r) => r.x0 < b.x1 && r.x1 > b.x0 && r.z0 < b.z1 && r.z1 > b.z0);
    expect(hits(home)).toBe(false);
    expect(hits(gym)).toBe(false);
    expect(L.yard1.x0).toBeGreaterThan(home.x1);
    expect(L.street.a).toBeLessThan(home.x0);
    const W = layout(home, [home], false);
    expect(W.yard1.x1).toBeLessThan(home.x0);
    expect(W.street.a).toBeGreaterThan(home.x1);
  });
});
