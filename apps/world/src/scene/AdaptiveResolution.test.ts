import { describe, expect, it } from "vitest";
import { bounds, stepToward } from "./AdaptiveResolution.tsx";

describe("adaptive resolution (#115)", () => {
  it("steps down below 50 fps and back up only near 60", () => {
    expect(bounds(60)).toEqual([50, 57]);
    expect(bounds(144)).toEqual([50, 57]);
  });

  it("keeps the 50 fps line on a machine that has never run fast", () => {
    expect(bounds(20)[0]).toBe(50);
  });

  it("always leaves a gap between stepping down and stepping up, so it can't flicker", () => {
    for (const refresh of [20, 45, 50, 58, 60, 120]) {
      const [lower, upper] = bounds(refresh);
      expect(upper - lower).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("sharp resolution (#327)", () => {
  it("steps one quarter at a time toward what the monitor wants, never past the floor or the sharp ratio", () => {
    expect(stepToward(2, 1, 1, 2)).toBe(1.75);
    expect(stepToward(1.75, 2, 1, 2)).toBe(2);
    expect(stepToward(1, 0.5, 1, 2)).toBe(1);
    expect(stepToward(2, 3, 1, 2)).toBe(2);
  });

  it("stays put when what's wanted is within half a step", () => {
    expect(stepToward(1.5, 1.45, 1, 1.5)).toBe(1.5);
    expect(stepToward(1.5, 1.3, 1, 1.5)).toBe(1.38);
  });

  it("does nothing on a 1x screen", () => {
    expect(stepToward(1, 0.5, 1, 1)).toBe(1);
  });
});
