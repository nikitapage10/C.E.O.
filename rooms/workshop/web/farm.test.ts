import { describe, expect, it } from "vitest";
import { BAYS, measure, PAWN, PLATE_MM, preflight, viewKey, type Profile } from "./farm.ts";

describe("the print farm's facts (#827)", () => {
  it("has one real printer, waiting, and the rest open bays: nothing printing is made up", () => {
    expect(BAYS.filter((b) => b.state === "waiting")).toHaveLength(1);
    expect(BAYS.every((b) => b.state === "waiting" || b.state === "open")).toBe(true);
    expect(BAYS.map((b) => b.n)).toEqual([1, 2, 3, 4]);
  });

  it("names its views", () => {
    expect(viewKey({ k: "farm" })).toBe("farm");
    expect(viewKey({ k: "table" })).toBe("table");
    expect(viewKey({ k: "bay", n: 2 })).toBe("bay-2");
  });

  it("measures the check piece: a 28 mm foot, about 40 mm tall, no steeper than 45 degrees", () => {
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
});
