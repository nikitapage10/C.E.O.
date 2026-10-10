import { ACTIVITIES } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { poseFor } from "./behavior.ts";

describe("poseFor", () => {
  it("produces finite, sane poses for every activity", () => {
    for (const mode of [...ACTIVITIES, "stare" as const]) {
      for (const t of [0, 0.37, 12.5, 999]) {
        const p = poseFor(mode, t, 1.3);
        for (const v of [p.bob, p.lean, p.roll, p.headPitch, p.headYaw, p.headLift, p.core, p.lie, ...p.handL, ...p.handR]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(p.lie).toBeGreaterThanOrEqual(0);
        expect(p.lie).toBeLessThanOrEqual(1);
        expect(Math.abs(p.bob)).toBeLessThan(0.5);
      }
    }
  });

  it("raises hands to celebrate and lies down to nap", () => {
    expect(poseFor("celebrating", 1).handL[1]).toBeGreaterThan(1.5);
    expect(poseFor("napping", 1).lie).toBe(1);
    expect(poseFor("slumped", 1).core).toBeLessThan(poseFor("idle", 1).core);
  });
});
