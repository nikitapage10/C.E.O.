import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { placeLight, readPlan } from "../../../api/_haven/planShape.ts";
import { furnish } from "./furnish.ts";
import { backlightRun, kindOf, kitchenRun, laundrySpot, overheadZones, placeFixture, spotRows, studioLampCorner } from "./fixtures.ts";
import { drawList, spillOf } from "./realLights.ts";
import type { Light } from "./lights.ts";
import { cut, cutAll, layout, LV, nearFor } from "./surroundings.ts";

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

  it("lights the open kitchen, dining room and living room as one, in two halves, and part of the hall (#1020, #1022)", () => {
    const [a, b] = overheadZones(plan)!;
    const part = (id: string) => plan.rooms.find((r) => r.id === id)!.parts[0]!;
    const k = part("kitchen"), d = part("nook"), l = part("living"), hall = part("hall");
    // The made-up open room runs west to east from the kitchen (x 220) to the living room's far wall (x 960), y 40 to
    // 460: the first half at the kitchen's end, the second on to the far end, meeting with no gap.
    expect(a.x1).toBe(b.x0);
    expect(b.x1).toBe(l[0] + l[2]);
    expect(a.x0).toBeLessThan(k[0]);
    expect(Math.min(a.y0, b.y0)).toBe(k[1]);
    expect(Math.max(a.y1, b.y1)).toBe(d[1] + d[3]);
    // The whole living room across, not a spot.
    expect(b.y0).toBeLessThanOrEqual(l[1]);
    expect(b.y1).toBeGreaterThanOrEqual(l[1] + l[3]);
    // Part of the hall beside the kitchen, up to 150 into it, not all of it.
    expect(a.x0).toBeGreaterThanOrEqual(hall[0] + hall[2] - 150);
    expect(a.x0).toBeLessThan(hall[0] + hall[2]);
  });

  it("draws each of the four as its fixture, the ceiling ones as areas, and the living room's spill (#1020)", () => {
    const list = drawList(plan, [sb("Left Living Room"), sb("Right Living Room"), sb("Kitchen"), sb("Laundry", false)], undefined, false);
    expect(list.map((d) => d.fixture)).toEqual(["spots", "spots", "backlight", "glow", "spill"]);
    expect(list[0]!.place!.zone).toEqual(overheadZones(plan)![0]);
    expect(list[1]!.place!.zone).toEqual(overheadZones(plan)![1]);
    expect(list[3]!.place!.zone).toBeDefined();
    const spill = list[4]!;
    expect(spill.virtual).toBe(true);
    expect(spill.light.on).toBe(true);
    expect(spill.room).toBeDefined();
    const [a, b] = spotRows(plan)!;
    expect(list[0]!.place!.run).toEqual(a);
    expect(list[1]!.place!.run).toEqual(b);
    expect(list[0]!.y).toBe(a.y0);
    expect(list.slice(0, 4).every((d) => !d.room)).toBe(true);
  });

  it("spills into the living room only while a kitchen or dining light is on, and not over its own light (#1020)", () => {
    const off = drawList(plan, [sb("Left Living Room", false), sb("Kitchen", false)], undefined, false);
    expect(off.find((d) => d.fixture === "spill")!.light.on).toBe(false);
    const one = drawList(plan, [sb("Left Living Room", false), sb("Kitchen")], undefined, false);
    expect(one.find((d) => d.fixture === "spill")!.light.on).toBe(true);
    // A light of the living room's own lights it instead.
    const own = drawList(plan, [sb("Kitchen"), sb("Living room lamp")], [{ name: "living room lamp", x: 700, y: 200 }], false);
    expect(spillOf(plan, own.filter((d) => d.fixture !== "spill"))).toBeNull();
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
    // The decks in the north-east corner, the sofas meeting in the south-west (furnish.ts STUDIO_WALLS); each lamp
    // right in its corner, against both walls (#1022).
    expect(list.map((d) => [d.fixture, d.x, d.y])).toEqual([
      ["floor", sx + sw - 16, sy + 16],
      ["floor", sx + 16, sy + sh - 16],
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
    expect(hits(L.yard1)).toBe(false);
    expect(hits(L.yard2)).toBe(false);
    expect(L.yard1.x0).toBeGreaterThan(home.x1);
    expect(L.street.a).toBeLessThan(home.x0);
    const W = layout(home, [home], false);
    expect(W.yard1.x1).toBeLessThan(home.x0);
    expect(W.street.a).toBeGreaterThan(home.x1);
  });

  it("puts the home on the block's outer corner, the courtyard past it about twice its size, a larger one beyond (#1020)", () => {
    const home = { x0: 0, z0: 0, x1: 9, z1: 8 };
    const L = layout(home, [home], true);
    const area = (b: { x0: number; z0: number; x1: number; z1: number }) => (b.x1 - b.x0) * (b.z1 - b.z0);
    // The home at the block's street face and its near end (the boulevard's side).
    expect(L.outer.x0).toBeCloseTo(home.x0 - 0.3);
    expect(L.outer.z1).toBeCloseTo(home.z1 + 0.3);
    expect(L.blvd.z0).toBeGreaterThan(home.z1);
    // The courtyard past the home's balcony side and further back, about twice its size.
    const ratio = area(L.yard1) / area(home);
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
    expect((L.yard1.z0 + L.yard1.z1) / 2).toBeLessThan((home.z0 + home.z1) / 2);
    expect(L.yard1.z1).toBeGreaterThan(home.z0);
    // The block wraps it; the second courtyard larger, further along and further back, its pool at the far end.
    expect(L.yard1.z1).toBeLessThan(L.outer.z1 - 3);
    expect(L.yard1.z0).toBeGreaterThan(L.outer.z0 + 3);
    expect(area(L.yard2)).toBeGreaterThan(area(L.yard1));
    expect(L.yard2.x0).toBeGreaterThan(L.yard1.x1);
    expect(L.yard2.z0).toBeLessThan(L.yard1.z0);
    expect(L.pool.z0).toBeLessThan((L.yard2.z0 + L.yard2.z1) / 2);
    expect(L.pool.x0).toBeGreaterThan(L.yard2.x0);
    // Across the street: the decks toward the boulevard, the trail and river beyond.
    for (const d of L.decks) expect(d.x1).toBeLessThan(L.across);
    expect(Math.max(...L.decks.map((d) => d.z1))).toBeLessThan(L.blvd.z0);
    expect(L.trail.x1).toBeLessThan(L.decks[0]!.x0);
    expect(L.river.x1).toBeLessThan(L.trail.x0);
    // Roofs of every kind, one pool among them, in a few tones and heights.
    const uses = new Set(L.roofs.map((r) => r.use));
    expect(L.roofs.filter((r) => r.use === "pool")).toHaveLength(1);
    for (const u of ["hvac", "solar", "sky", "terrace"] as const) expect(uses.has(u)).toBe(true);
    expect(new Set(L.roofs.map((r) => r.tone)).size).toBeGreaterThan(3);
    expect(new Set(L.roofs.map((r) => r.h.toFixed(2))).size).toBeGreaterThan(3);
    // Everything inside the bounds the city's lights keep off.
    for (const b of [L.outer, L.river, L.farBank, ...L.decks]) {
      expect(b.x0).toBeGreaterThanOrEqual(L.bounds.x0);
      expect(b.x1).toBeLessThanOrEqual(L.bounds.x1);
      expect(b.z0).toBeGreaterThanOrEqual(L.bounds.z0);
      expect(b.z1).toBeLessThanOrEqual(L.bounds.z1);
    }
  });

  it("keeps the ground's layers far enough apart for the depth buffer when the view is out wide (#1020, the strobe)", () => {
    // A 24-bit depth buffer resolves about d² / (near · 2²⁴) at distance d. Out at the widest (r about 24) the block's far
    // streets are some 60 away: the step there must be a small part of the smallest gap between two layers.
    const step = (d: number, near: number) => (d * d) / (near * 2 ** 24);
    const levels = Object.values(LV).sort((a, b) => a - b);
    const gap = Math.min(...levels.slice(1).map((v, i) => v - levels[i]!));
    expect(gap).toBeGreaterThan(0.0049);
    expect(step(60, nearFor(24))).toBeLessThan(gap / 10);
    // The fixed 0.05 it had would not: the layers fought over the same pixels as the view turned.
    expect(step(60, 0.05)).toBeGreaterThan(0.001);
    expect(nearFor(3)).toBeLessThanOrEqual(0.12);
  });
});
