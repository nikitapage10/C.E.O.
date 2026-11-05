import { describe, expect, it } from "vitest";
import { isTimingsView, median } from "./LatticeTimings.tsx";

describe("the Boiler Room's Lattice timings (#373)", () => {
  it("takes the median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(3);
  });

  it("checks the answer's shape", () => {
    const t = { at: "2026-10-24T04:00:00.000Z", kind: "return", trip: 2, firstFrame: 60, curtain: 60, fps: 58, worstFrame: 30, draws: 800, triangles: 1, programs: 2 };
    expect(isTimingsView({ ok: true, timings: [t] })).toBe(true);
    expect(isTimingsView({ ok: true, timings: [{ ...t, kind: "x" }] })).toBe(false);
    expect(isTimingsView({ error: "not-set-up" })).toBe(false);
  });
});
