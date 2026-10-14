import { describe, expect, it } from "vitest";
import { bounds } from "./AdaptiveResolution.tsx";

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
