import { describe, expect, it } from "vitest";
import { measure, PAWN, PLATE_MM, preflight, radiusAt, slice, STAGES, viewKey, type Profile } from "./flow.ts";

describe("the Workshop's flow (#989)", () => {
  it("is four stages left to right, design to print, on one printer", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["design", "mesh", "slice", "print"]);
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(STAGES.filter((s) => /printer/i.test(s.tool))).toHaveLength(1);
  });

  it("makes nothing up: the design and the mesh idle, the slicer on its check piece, the printer waiting", () => {
    expect(STAGES.map((s) => s.state)).toEqual(["idle", "idle", "check", "waiting"]);
    expect(STAGES.every((s) => s.wait.length > 0)).toBe(true);
  });

  it("names its views", () => {
    expect(viewKey({ k: "flow" })).toBe("flow");
    expect(viewKey({ k: "stage", n: 3 })).toBe("stage-3");
  });
});

describe("the check piece (#827)", () => {
  it("measures a 28 mm foot, about 40 mm tall, no steeper than 45 degrees", () => {
    const m = measure(PAWN);
    expect(m.w).toBe(28);
    expect(m.base).toBe(14);
    expect(m.h).toBeCloseTo(39.6, 1);
    expect(m.overhang).toBeLessThanOrEqual(45.01);
  });

  it("passes the check piece on every count", () => {
    const c = preflight(PAWN);
    expect(c.map((x) => x.id)).toEqual(["plate", "height", "base", "supports"]);
    expect(c.every((x) => x.ok)).toBe(true);
    expect(c[0]!.detail).toBe(`28 × 28 mm of ${PLATE_MM.x} × ${PLATE_MM.y}`);
  });

  it("fails what wouldn't print: too wide, too tall, no foot, an overhang", () => {
    const wide: Profile = [[0, 0], [140, 0], [140, 10], [0, 10]];
    expect(preflight(wide).find((x) => x.id === "plate")!.ok).toBe(false);
    const tall: Profile = [[0, 0], [10, 0], [10, 300], [0, 300]];
    expect(preflight(tall).find((x) => x.id === "height")!.ok).toBe(false);
    const ball: Profile = [[0, 0], [1, 0], [10, 4], [0, 18]];
    const c = preflight(ball);
    expect(c.find((x) => x.id === "base")!.ok).toBe(false);
    expect(c.find((x) => x.id === "supports")!.ok).toBe(false);
    const shelf: Profile = [[0, 0], [5, 0], [5, 10], [12, 10], [12, 12], [0, 12]];
    expect(measure(shelf).overhang).toBe(90);
  });

  it("slices it into 0.2 mm layers, each ring as wide as the piece at that height", () => {
    const s = slice(PAWN);
    expect(s.layers).toBe(Math.ceil(measure(PAWN).h / 0.2 - 1e-9));
    expect(s.rings).toHaveLength(s.layers);
    expect(s.rings[0]).toBe(14);
    expect(Math.max(...s.rings)).toBeLessThanOrEqual(14);
    expect(radiusAt(PAWN, 20)).toBeGreaterThan(5);
    expect(radiusAt(PAWN, 20)).toBeLessThan(5.5);
    const cube: Profile = [[0, 0], [10, 0], [10, 1], [0, 1]];
    expect(slice(cube, 0.25)).toEqual({ layers: 4, layer: 0.25, rings: [10, 10, 10, 10] });
  });
});
