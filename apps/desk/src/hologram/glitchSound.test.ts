import { describe, expect, it } from "vitest";
import { glitchPlan, playGlitchIn } from "./glitchSound.ts";

describe("the hologram's glitch sound (#1093)", () => {
  it("stutters over the glitch's own length, thinning as he settles, with a few tears", () => {
    const { crackles, tears } = glitchPlan(1000, 7);
    expect(crackles.length).toBeGreaterThan(8);
    expect(crackles.every((c) => c.at >= 0 && c.at + c.dur <= 1.0001 && c.dur > 0)).toBe(true);
    const gap = (i: number) => crackles[i + 1]!.at - crackles[i]!.at;
    expect(gap(crackles.length - 2)).toBeGreaterThan(gap(0));
    expect(tears).toHaveLength(3);
    expect(tears.every((t) => t.at < 1)).toBe(true);
  });

  it("is silent where there's no Web Audio", () => {
    expect(() => playGlitchIn(800)).not.toThrow();
  });
});
