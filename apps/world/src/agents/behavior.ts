import type { Activity } from "@ceo/core";

export type Vec = [number, number, number];

/** Everything a Syntherion figure needs to strike a pose. Positions are relative to the agent's feet, +z forward. */
export interface Pose {
  /** Vertical offset of the whole body. */
  bob: number;
  /** Forward lean (radians, about x). */
  lean: number;
  /** Side roll (radians, about z). */
  roll: number;
  headPitch: number;
  headYaw: number;
  /** Extra head lift (the head floats; it bobs on its own). */
  headLift: number;
  handL: Vec;
  handR: Vec;
  /** Chest core brightness multiplier. */
  core: number;
  /** 0 = upright, 1 = lying on its back (napping). */
  lie: number;
}

export type PoseMode = Activity | "stare";

const REST_L: Vec = [-0.4, 0.72, 0.04];
const REST_R: Vec = [0.4, 0.72, 0.04];

/**
 * Procedural animation: a pure function of what the agent is doing and the time, so it's cheap,
 * deterministic and testable. `phase` de-syncs agents so they don't breathe in unison.
 */
export function poseFor(mode: PoseMode, t: number, phase = 0): Pose {
  const breathe = Math.sin(t * 1.6 + phase) * 0.02;
  const p: Pose = {
    bob: breathe,
    lean: 0,
    roll: 0,
    headPitch: 0,
    headYaw: Math.sin(t * 0.4 + phase) * 0.15,
    headLift: Math.sin(t * 2 + phase) * 0.03,
    handL: [...REST_L],
    handR: [...REST_R],
    core: 1,
    lie: 0,
  };
  switch (mode) {
    case "walking": {
      const s = t * 9 + phase;
      p.bob = Math.abs(Math.sin(s)) * 0.07;
      p.lean = 0.08;
      p.roll = Math.sin(s) * 0.04;
      p.handL = [-0.4, 0.72, Math.sin(s) * 0.18];
      p.handR = [0.4, 0.72, -Math.sin(s) * 0.18];
      p.headYaw = 0;
      break;
    }
    case "carrying": {
      const s = t * 9 + phase;
      p.bob = Math.abs(Math.sin(s)) * 0.05;
      p.lean = -0.04;
      p.handL = [-0.2, 0.98, 0.38];
      p.handR = [0.2, 0.98, 0.38];
      p.headYaw = 0;
      break;
    }
    case "typing": {
      const tap = (k: number) => Math.max(0, Math.sin(t * 18 + k)) * 0.05;
      p.lean = 0.12;
      p.handL = [-0.2, 0.9 + tap(phase), 0.42];
      p.handR = [0.2, 0.9 + tap(phase + 2), 0.42];
      p.headPitch = 0.2 + Math.sin(t * 3 + phase) * 0.03;
      p.headYaw = Math.sin(t * 0.9 + phase) * 0.08;
      p.core = 1.3 + Math.sin(t * 6) * 0.2;
      break;
    }
    case "working": {
      const w = Math.sin(t * 3 + phase);
      p.lean = 0.1;
      p.handL = [-0.25, 1 + w * 0.15, 0.45 + w * 0.08];
      p.handR = [0.25, 1 - w * 0.15, 0.45 - w * 0.08];
      p.headPitch = 0.12;
      p.core = 1.25 + w * 0.15;
      break;
    }
    case "celebrating": {
      const j = Math.abs(Math.sin(t * 7 + phase));
      p.bob = j * 0.25;
      p.handL = [-0.38, 1.75 + j * 0.15, 0.05];
      p.handR = [0.38, 1.75 + j * 0.15, 0.05];
      p.headPitch = -0.25;
      p.roll = Math.sin(t * 7) * 0.08;
      p.core = 2;
      break;
    }
    case "slumped": {
      p.bob = -0.08;
      p.lean = 0.38;
      p.headPitch = 0.6;
      p.headLift = -0.12;
      p.handL = [-0.32, 0.42, 0.16];
      p.handR = [0.32, 0.42, 0.16];
      p.core = 0.35;
      break;
    }
    case "napping": {
      p.lie = 1;
      p.bob = 0.12 + Math.sin(t * 0.9 + phase) * 0.015;
      p.headYaw = 0.3;
      p.handL = [-0.2, 0.75, 0.2];
      p.handR = [0.2, 0.75, 0.2];
      p.core = 0.5 + Math.sin(t * 0.9) * 0.2;
      break;
    }
    case "waiting": {
      p.bob = Math.max(0, Math.sin(t * 6 + phase)) * 0.02;
      p.roll = Math.sin(t * 0.8 + phase) * 0.06;
      p.headYaw = Math.sin(t * 0.7 + phase) * 0.45;
      p.handL = [-0.44, 0.82, -0.06];
      p.handR = [0.3, 0.9 + Math.max(0, Math.sin(t * 6)) * 0.05, 0.25];
      break;
    }
    case "staring": {
      p.headYaw = 0;
      p.headLift = 0;
      p.bob = 0;
      break;
    }
    case "stare": {
      // Fourth wall. Dead still, dead ahead, slightly too long.
      p.headYaw = 0;
      p.headPitch = -0.08;
      p.headLift = 0.02;
      p.bob = 0;
      p.handL = [-0.38, 0.7, 0.0];
      p.handR = [0.38, 0.7, 0.0];
      p.core = 1.6;
      break;
    }
    case "idle":
    default:
      break;
  }
  return p;
}
