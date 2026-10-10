import { describe, expect, it } from "vitest";
import type { PoseMode } from "../behavior.ts";
import { Object3D } from "three";
import { beltOf, compactorPose, runBelt, type Belt } from "./compactorPose.ts";

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

describe("runBelt", () => {
  // A square loop of eight links, one every half metre, running anticlockwise seen from +X.
  const square = (): Belt => {
    const links = [[0, 1, 0], [0, 1, 0.5], [0, 1, 1], [0, 0.5, 1], [0, 0, 1], [0, 0, 0.5], [0, 0, 0], [0, 0.5, 0]].map(
      ([x, y, z]) => {
        const o = new Object3D();
        o.position.set(x!, y!, z!);
        return o;
      },
    );
    return beltOf(links);
  };

  it("slides each link toward the next one's place, turning it round the corners, then steps it back", () => {
    const belt = square();
    runBelt(belt, 0.25);
    expect(belt.links[0]!.position.distanceTo(belt.rest[0]!.clone().lerp(belt.rest[1]!, 0.5))).toBeLessThan(1e-9);
    // Link 2 is going round the front corner, from heading +Z toward heading -Y.
    expect(belt.links[2]!.rotation.x).toBeGreaterThan(0.3);
    runBelt(belt, 0.25);
    belt.links.forEach((l, i) => expect(l.position.distanceTo(belt.rest[i]!)).toBeLessThan(1e-9));
  });

  it("comes back to where it started after whole links, either way round", () => {
    const belt = square();
    runBelt(belt, belt.length * 0.37);
    runBelt(belt, -belt.length * 1.37);
    belt.links.forEach((l, i) => {
      expect(l.position.distanceTo(belt.rest[i]!)).toBeLessThan(1e-9);
      expect(Math.abs(l.rotation.x)).toBeLessThan(1e-9);
    });
  });
});
