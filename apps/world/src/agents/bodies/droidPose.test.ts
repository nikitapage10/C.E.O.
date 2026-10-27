import { describe, expect, it } from "vitest";
import type { PoseMode } from "../behavior.ts";
import { ROLL_TILT, STRIDE, astromechState, protocolPose, servo, stepAstromech } from "./droidPose.ts";

const MODES: PoseMode[] = ["idle", "walking", "carrying", "typing", "working", "celebrating", "slumped", "napping", "waiting", "staring", "stare"];
const DT = 1 / 60;

/** Runs Drop for `seconds` in one mode and returns every pose. */
function run(mode: PoseMode, seconds: number, st = astromechState(), from = 0) {
  const out = [];
  for (let i = 0; i < seconds / DT; i++) out.push(stepAstromech(st, mode, from + i * DT, DT, 0.7));
  return { st, out };
}

describe("the astromech", () => {
  it("gives every mode a finite pose", () => {
    for (const mode of MODES) {
      for (const p of run(mode, 3).out) for (const [k, v] of Object.entries(p)) expect(Number.isFinite(v), `${mode}.${k}`).toBe(true);
    }
  });

  it("drops its third leg first, then leans back onto it to roll", () => {
    const { st, out } = run("walking", 2);
    // Early on the leg is coming down and the body hasn't leaned yet.
    expect(out[10]!.leg).toBeGreaterThan(0);
    expect(Math.abs(out[10]!.tilt)).toBeLessThan(0.02);
    expect(st.leg).toBe(1);
    expect(st.tilt).toBeCloseTo(ROLL_TILT, 1);
  });

  it("swings past upright when it stops, settles, and only then tucks the leg away", () => {
    const { st } = run("walking", 2);
    const { out } = run("idle", 3, st, 2);
    expect(Math.min(...out.map((p) => p.tilt))).toBeLessThan(-0.02);
    const tucked = out.findIndex((p) => p.leg < 1);
    expect(tucked).toBeGreaterThan(5);
    expect(Math.abs(out[tucked]!.tilt)).toBeLessThan(0.05);
    expect(out.at(-1)!.leg).toBe(0);
  });

  it("turns its dome on a security sweep and spins it to celebrate", () => {
    const sweep = run("staring", 8).out.map((p) => p.dome);
    expect(Math.max(...sweep) - Math.min(...sweep)).toBeGreaterThan(2);
    const spin = run("celebrating", 3).out.map((p) => p.dome);
    expect(spin.at(-1)! - spin[0]!).toBeGreaterThan(Math.PI * 2);
  });

  it("lights up now and then, and dims to sleep", () => {
    const lamps = run("idle", 12).out.map((p) => p.lamp);
    expect(Math.max(...lamps)).toBeGreaterThan(3);
    expect(Math.min(...lamps)).toBeLessThan(1);
    const asleep = run("napping", 4).out;
    expect(Math.max(...asleep.map((p) => p.eye))).toBeLessThan(0.5);
  });
});

describe("the protocol droid", () => {
  it("gives every mode a finite pose within its joints' reach", () => {
    for (const mode of MODES) {
      for (let t = 0; t < 8; t += 0.29) {
        for (const [k, v] of Object.entries(protocolPose(mode, t, 1.1, t > 4))) {
          expect(Number.isFinite(v), `${mode}.${k}`).toBe(true);
          expect(Math.abs(v), `${mode}.${k}`).toBeLessThan(2);
        }
      }
    }
  });

  it("walks stiff-legged: the legs swing against each other, no further than a stride, and the hips dip", () => {
    for (let t = 0; t < 3; t += 0.1) {
      const p = protocolPose("walking", t);
      expect(p.legL).toBeCloseTo(-p.legR, 6);
      expect(Math.abs(p.legL)).toBeLessThanOrEqual(STRIDE + 1e-9);
      expect(p.lift).toBeLessThanOrEqual(0);
      // The free arm swings against its own leg; the hand on the hip barely moves.
      if (Math.abs(p.legL) > 0.05) expect(Math.sign(p.armL)).toBe(-Math.sign(p.legL));
      expect(Math.abs(p.armR)).toBeLessThan(0.05);
    }
  });

  it("fusses when idle: the free arm comes up a little now and then, stiffly", () => {
    const arms = Array.from({ length: 80 }, (_, i) => protocolPose("idle", i * 0.1).armL);
    expect(Math.max(...arms)).toBeGreaterThan(0.35);
    expect(Math.min(...arms)).toBeLessThan(0.1);
  });

  it("shuts down to nap: head down, eyes all but out", () => {
    const p = protocolPose("napping", 2);
    expect(p.headPitch).toBeGreaterThan(0.3);
    expect(p.eye).toBeLessThan(0.2);
  });
});

describe("servo", () => {
  it("holds an angle, then snaps to the next on the beat", () => {
    const pick = (n: number) => n;
    expect(servo(5.9, 1, 0.2, pick)).toBe(5);
    expect(servo(5.05, 1, 0.2, pick)).toBeGreaterThan(4);
    expect(servo(5.05, 1, 0.2, pick)).toBeLessThan(5);
  });
});
