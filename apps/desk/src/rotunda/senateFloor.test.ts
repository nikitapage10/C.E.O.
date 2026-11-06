import { describe, expect, it } from "vitest";
import { floorBlocked, floorChair } from "./senateFloor.ts";

/**
 * Nikita has the floor (#905): what the chair says, and when he can't have the floor. Who answers his words is Skippy's
 * one brain's call since #926 (api/_skippy/brain.test.ts, the Senate's cases; liveTalk.test.ts, `fetchFloor`).
 */

describe("the chair (#905)", () => {
  it("says who has it", () => {
    expect(floorChair(["green"])).toBe("The chair recognizes the Commentator.");
    expect(floorChair(["boiler", "foundry"])).toBe("The chair recognizes the Pessimist, then the Builder.");
    expect(floorChair(["kernel"])).toMatch(/himself/);
  });
});

describe("when the floor can't be had (#905)", () => {
  it("says so in a short line: signed out, still checking, no microphone", () => {
    expect(floorBlocked("out", true)).toMatch(/Sign in/);
    expect(floorBlocked("unknown", true)).toMatch(/Checking/);
    expect(floorBlocked("in", false)).toMatch(/can't hear/);
    expect(floorBlocked("in", true)).toBeNull();
  });
});
