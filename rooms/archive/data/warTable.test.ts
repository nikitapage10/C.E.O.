import { describe, expect, it } from "vitest";
import { groundOf, heightAt, MAP_D, MAP_W, PLACES, placeOf, stepPlace, surfaceAt } from "./warTable.ts";

describe("the war table (#826)", () => {
  it("has one place for each of the Archive's features, each with its own spot on the chart", () => {
    const ids = PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["today", "week", "day", "bonds", "shelf", "told", "ships", "tide", "how"]));
    for (const p of PLACES) {
      expect(Math.abs(p.x)).toBeLessThan(MAP_W / 2 - 0.8);
      expect(Math.abs(p.z)).toBeLessThan(MAP_D / 2 - 0.8);
      expect(p.name.length).toBeGreaterThan(2);
    }
    for (const a of PLACES) for (const b of PLACES) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.5);
  });

  it("keeps the near right corner clear, where Ask Skippy sits over the table", () => {
    expect(PLACES.filter((p) => p.x > 4 && p.z > 2)).toEqual([]);
  });

  it("stands the miniatures on level land and leaves the Tide's isle and the lab at sea", () => {
    for (const p of PLACES) {
      const h = heightAt(p.x, p.z);
      if (p.kind === "ghost" || p.kind === "lab") expect(h).toBeLessThan(0);
      else {
        expect(h).toBeGreaterThan(0);
        // Level under the model: the same height a little way off in every direction.
        for (const [dx, dz] of <[number, number][]>[
          [0.3, 0],
          [-0.3, 0],
          [0, 0.3],
          [0, -0.3],
        ])
          expect(Math.abs(heightAt(p.x + dx, p.z + dz) - h)).toBeLessThan(0.02);
        expect(groundOf(p)).toBeCloseTo(surfaceAt(p.x, p.z), 2);
      }
    }
  });

  it("sinks the chart to sea at the rim", () => {
    for (const [x, z] of <[number, number][]>[
      [-7.9, 0],
      [7.9, 0],
      [0, -4.9],
      [0, 4.9],
    ])
      expect(heightAt(x, z)).toBeLessThan(0);
  });

  it("walks the places in order, round from the last to the first", () => {
    expect(stepPlace("today", 1)).toBe(PLACES[1]!.id);
    expect(stepPlace(PLACES[0]!.id, -1)).toBe(PLACES[PLACES.length - 1]!.id);
    expect(placeOf("tide").kind).toBe("ghost");
  });
});
