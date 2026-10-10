import type { Object3D } from "three";
import type { PoseMode } from "../behavior.ts";
import { smooth } from "./limbs.ts";

/**
 * How the salvage compactor moves. It is all rigid parts on pivots (see scripts/rig-tessellate.mjs), so a pose is
 * a handful of angles: the box rocks on its treads, the neck folds, the head turns and tilts on top of it, and
 * each arm swings from the shoulder with its claw flexing at the wrist. Angles are from the rest pose, about
 * character axes (+Y up, +Z forward, +X the robot's left): a positive pitch tips a part forward and down.
 * - Rolling (walking, carrying): no legs to step with, so the treads judder and the box sways and leans in; the
 *   arms swing as it goes, or hold steady to carry.
 * - Working: compacting. Both arms pump together and the box bounces with each crush, head down to watch.
 * - Napping: folds up for the night, head down on the box and arms tucked in.
 */

export interface CompactorAngles {
  /** Box height offset (metres before scale), forward pitch and side roll. */
  lift: number;
  lean: number;
  roll: number;
  /** Neck fold (forward), then the head's own pitch, turn (to its left) and tilt. */
  neck: number;
  pitch: number;
  yaw: number;
  tilt: number;
  /** Arm pitch (positive lowers) and claw flex, per side. */
  armL: number;
  armR: number;
  clawL: number;
  clawR: number;
  /** Tread judder, metres, per side. */
  treadL: number;
  treadR: number;
}

export const REST: CompactorAngles = { lift: 0, lean: 0, roll: 0, neck: 0, pitch: 0, yaw: 0, tilt: 0, armL: 0, armR: 0, clawL: 0, clawR: 0, treadL: 0, treadR: 0 };

/** The pose for what it's doing, as a pure function of time. `phase` keeps a crowd of them out of step. */
export function compactorPose(mode: PoseMode, t: number, phase = 0, speaking = false): CompactorAngles {
  const p = { ...REST };
  const s = t + phase;
  // Never quite still: a slow glance about and a hum through the box.
  p.yaw = Math.sin(s * 0.45) * 0.35 + Math.sin(s * 1.3) * 0.05;
  p.tilt = Math.sin(s * 0.31) * 0.12;
  p.lean = Math.sin(s * 1.4) * 0.008;
  p.armL = Math.sin(s * 0.9) * 0.04;
  p.armR = Math.sin(s * 0.9 + 1.2) * 0.04;

  switch (mode) {
    case "walking":
    case "carrying": {
      const r = s * 11;
      p.treadL = Math.abs(Math.sin(r)) * 0.008;
      p.treadR = Math.abs(Math.sin(r + 1.3)) * 0.008;
      p.lift = Math.abs(Math.sin(r + 0.6)) * 0.012;
      p.lean = 0.06;
      p.roll = Math.sin(s * 5.5) * 0.025;
      p.yaw = Math.sin(s * 0.7) * 0.12;
      p.pitch = -0.05;
      if (mode === "walking") {
        p.armL = Math.sin(s * 5.5) * 0.28;
        p.armR = -Math.sin(s * 5.5) * 0.28;
      } else {
        // Holding the load out in front, claws closed on it.
        p.armL = p.armR = -0.08;
        p.clawL = p.clawR = 0.25;
        p.neck = 0.12;
      }
      break;
    }
    case "typing": {
      p.neck = 0.25;
      p.pitch = 0.15;
      p.yaw = Math.sin(s * 0.6) * 0.08;
      p.armL = 0.35 + Math.max(0, Math.sin(s * 13)) * 0.12;
      p.armR = 0.35 + Math.max(0, Math.sin(s * 13 + Math.PI)) * 0.12;
      p.clawL = p.clawR = 0.3;
      break;
    }
    case "working": {
      // Compacting: a crush every 1.1 s, fast down, slow back up.
      const c = (s / 1.1) % 1;
      const crush = c < 0.25 ? c / 0.25 : 1 - (c - 0.25) / 0.75;
      p.neck = 0.3;
      p.pitch = 0.2;
      p.yaw = 0;
      p.armL = p.armR = -0.35 + crush * 0.75;
      p.clawL = p.clawR = 0.15 + crush * 0.35;
      p.lift = -crush * 0.05;
      p.lean = 0.04 + crush * 0.05;
      break;
    }
    case "celebrating": {
      p.lift = Math.abs(Math.sin(s * 8)) * 0.06;
      p.armL = -0.75 + Math.sin(s * 9) * 0.25;
      p.armR = -0.75 + Math.sin(s * 9 + Math.PI) * 0.25;
      p.pitch = -0.3;
      p.tilt = Math.sin(s * 4) * 0.25;
      p.yaw = 0;
      break;
    }
    case "slumped": {
      p.neck = 0.45;
      p.pitch = 0.25;
      p.yaw = Math.sin(s * 0.2) * 0.06;
      p.tilt = 0.18;
      p.armL = p.armR = 0.55;
      p.lean = 0.05;
      p.lift = -0.02;
      break;
    }
    case "napping": {
      // Folded up: the head comes down to rest on the box, the arms tuck in, and it breathes very slowly.
      p.neck = 0.75;
      p.pitch = 0.45;
      p.yaw = 0;
      p.tilt = 0.08;
      p.armL = p.armR = 0.6;
      p.clawL = p.clawR = 0.4;
      p.lift = -0.05 + Math.sin(s * 0.8) * 0.006;
      p.lean = 0;
      break;
    }
    case "waiting": {
      // Looking about for whoever it's waiting on, head cocked, one claw tapping.
      p.yaw = Math.sin(s * 0.9) * 0.6;
      p.tilt = 0.2 * Math.sign(Math.sin(s * 0.9)) + Math.sin(s * 3) * 0.03;
      p.pitch = -0.1;
      p.clawR = Math.max(0, Math.sin(s * 6)) * 0.3;
      break;
    }
    case "staring":
    case "stare": {
      p.yaw = Math.sin(s * 0.15) * 0.04;
      p.pitch = -0.12;
      p.tilt = 0.22;
      p.armL = p.armR = 0.1;
      break;
    }
    case "idle":
      break;
  }
  if (speaking) {
    p.pitch += Math.sin(t * 9) * 0.06;
    p.tilt += Math.sin(t * 2.3) * 0.08;
  }
  return p;
}

export interface CompactorRig {
  body: Object3D;
  neck: Object3D;
  head: Object3D;
  armL: Object3D;
  armR: Object3D;
  handL: Object3D;
  handR: Object3D;
  treadL: Object3D;
  treadR: Object3D;
  /** Rest heights of the box and treads, which the pose offsets. */
  bodyY: number;
  treadY: number;
  /** The pose as it's shown, easing toward the target so one activity flows into the next. */
  now: CompactorAngles;
}

export function rigCompactor(model: Object3D): CompactorRig | null {
  const get = (n: string) => model.getObjectByName(n);
  const [body, neck, head, armL, armR, handL, handR, treadL, treadR] = ["Body", "Neck", "Head", "ArmL", "ArmR", "HandL", "HandR", "TreadL", "TreadR"].map(get);
  if (!body || !neck || !head || !armL || !armR || !handL || !handR || !treadL || !treadR) return null;
  return { body, neck, head, armL, armR, handL, handR, treadL, treadR, bodyY: body.position.y, treadY: treadL.position.y, now: { ...REST } };
}

/** One frame: ease toward the pose for `mode` and set the bones. */
export function poseCompactor(rig: CompactorRig, mode: PoseMode, t: number, dt: number, phase: number, speaking: boolean) {
  const want = compactorPose(mode, t, phase, speaking);
  // Frame-rate independent easing, quick enough that the rhythms (treads, crushes) still read.
  const k = 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.1) * 12);
  const n = rig.now;
  for (const key of Object.keys(n) as (keyof CompactorAngles)[]) n[key] = smooth(n[key], want[key], k);
  rig.body.position.y = rig.bodyY + n.lift;
  rig.body.rotation.set(n.lean, 0, n.roll);
  rig.neck.rotation.set(n.neck, 0, 0);
  rig.head.rotation.set(n.pitch, n.yaw, n.tilt, "YXZ");
  rig.armL.rotation.set(n.armL, 0, 0);
  rig.armR.rotation.set(n.armR, 0, 0);
  rig.handL.rotation.set(n.clawL, 0, 0);
  rig.handR.rotation.set(n.clawR, 0, 0);
  rig.treadL.position.y = rig.treadY + n.treadL;
  rig.treadR.position.y = rig.treadY + n.treadR;
}
