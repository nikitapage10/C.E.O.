import { describe, expect, it } from "vitest";
import type { PoseMode } from "../behavior.ts";
import { compactorPose } from "./compactorPose.ts";

const MODES: PoseMode[] = ["idle", "walking", "carrying", "typing", "working", "celebrating", "slumped", "napping", "waiting", "staring", "stare"];

describe("compactorPose", () => {
  it("gives every mode a finite pose that stays within the joints' reach", () => {
    for (const mode of MODES) {
      for (let t = 0; t < 6; t += 0.37) {
        for (const [k, v] of Object.entries(compactorPose(mode, t, 1.3, true))) {
          expect(Number.isFinite(v), `${mode}.${k}`).toBe(true);
          expect(Math.abs(v), `${mode}.${k}`).toBeLessThan(1.6);
        }
      }
    }
  });

  it("swings the arms against each other while rolling, and holds them together to carry", () => {
    const roll = compactorPose("walking", 0.3);
    expect(Math.sign(roll.armL)).toBe(-Math.sign(roll.armR));
    const carry = compactorPose("carrying", 0.3);
    expect(carry.armL).toBe(carry.armR);
  });

  it("folds up to nap and throws its arms up to celebrate", () => {
    expect(compactorPose("napping", 2).neck).toBeGreaterThan(0.6);
    const cheer = compactorPose("celebrating", 2);
    expect(Math.min(cheer.armL, cheer.armR)).toBeLessThan(-0.6);
  });

  it("compacts in a rhythm: the arms come down on each crush", () => {
    const arms = Array.from({ length: 12 }, (_, i) => compactorPose("working", i * 0.1).armL);
    expect(Math.max(...arms) - Math.min(...arms)).toBeGreaterThan(0.5);
  });
});
