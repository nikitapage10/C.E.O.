import type { PoseMode } from "../behavior.ts";

/**
 * How the Boiler Room's two droids move. Both are Nikita's sculpts, cut into rigid parts on pivots by
 * scripts/build-droids.mjs, so a pose is a handful of angles. Angles are about character axes (+Y up, +Z forward,
 * +X the droid's left).
 *
 * Drop, the astromech, rolls on the feet of its two legs. To get going it drops its third leg out of its belly and
 * leans its body back on the shoulder pins; when it stops, the body rights itself, swings past upright and settles,
 * and only then does the leg tuck away. The dome turns on its own: glances about, sweeps the room on a security
 * pass, spins when it's pleased, wiggles while it beeps. Every few seconds its lights flare: the eye brightens and
 * the lamp blinks a burst.
 *
 * Clause, the protocol droid, walks without bending a knee: each leg swings from the hip as one stiff piece, the body
 * dips as the legs splay and rocks over onto each foot in turn, and the free arm swings a little, stiff as a rod. The
 * other hand stays on its hip. Its head moves like a servo, in small snaps from one fixed angle to the next, and when
 * it's idle it fusses: the free arm comes up in an "oh my" and the head tilts back.
 */

const moving = (mode: PoseMode) => mode === "walking" || mode === "carrying";

/** A little hash of a whole number to [0, 1), for choices that change every beat but not every frame. */
function rand(n: number, salt: number) {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A servo: holds one angle, then snaps to the next on the beat (`period` seconds), easing over the first `snap` of
 * each beat. `pick` chooses the angle for beat n.
 */
export function servo(t: number, period: number, snap: number, pick: (n: number) => number) {
  const n = Math.floor(t / period);
  const u = Math.min(1, (t / period - n) / snap);
  const e = u * u * (3 - 2 * u);
  return pick(n - 1) + (pick(n) - pick(n - 1)) * e;
}

/** One step of a damped spring toward `to`. Under-damped on purpose: a lean overshoots and settles, as a body would. */
export function spring(x: number, v: number, to: number, dt: number, stiffness = 60, damping = 7): [number, number] {
  const h = Math.min(dt, 1 / 30);
  const nv = v + ((to - x) * stiffness - v * damping) * h;
  return [x + nv * h, nv];
}

// ---------------------------------------------------------------------------------------------------- the astromech

export interface AstromechState {
  /** Body lean back on the shoulder pins, radians (positive: the dome goes back). */
  tilt: number;
  tiltV: number;
  /** How far the third leg is out, 0 (tucked) to 1 (on the floor). */
  leg: number;
  /** The dome's turn, radians, smoothed. */
  dome: number;
}

export const astromechState = (): AstromechState => ({ tilt: 0, tiltV: 0, leg: 0, dome: 0 });

export interface AstromechPose {
  /** Lift (metres before scale), side-to-side rock and a forward nod, for the whole droid. */
  lift: number;
  roll: number;
  pitch: number;
  /** Body lean on the shoulder pins and the third leg, from the state. */
  tilt: number;
  leg: number;
  dome: number;
  /** Light levels, as emissive intensity. */
  eye: number;
  lamp: number;
}

/** The lean it rolls at, radians. */
export const ROLL_TILT = 0.24;

/** The dome's aim for a mode, before smoothing. */
function domeAim(mode: PoseMode, s: number, phase: number, speaking: boolean) {
  if (mode === "celebrating") return s * 5;
  if (mode === "napping") return 0;
  // A security pass: a slow, full sweep of the room.
  if (mode === "staring" || mode === "stare") return Math.sin(s * 0.55) * 1.4;
  const glance = servo(s, 2.4, 0.18, (n) => (rand(n, phase) - 0.5) * 1.8);
  if (speaking) return glance * 0.4 + Math.sin(s * 14) * 0.22;
  if (moving(mode)) return glance * 0.35;
  if (mode === "working" || mode === "typing") return servo(s, 1.1, 0.25, (n) => (rand(n, phase + 3) - 0.5) * 0.9);
  return glance;
}

/**
 * Advances Drop by `dt` seconds and returns the pose. `s` is its own clock (seconds, already de-synced by phase).
 * Getting going: the leg drops first, then the body leans back onto it. Stopping: the body rights itself with a
 * swing past upright, then the leg tucks.
 */
export function stepAstromech(st: AstromechState, mode: PoseMode, s: number, dt: number, phase = 0, speaking = false): AstromechPose {
  const go = moving(mode);
  const legTo = go ? 1 : Math.abs(st.tilt) < 0.04 && Math.abs(st.tiltV) < 0.4 ? 0 : 1;
  st.leg += Math.sign(legTo - st.leg) * Math.min(Math.abs(legTo - st.leg), dt * 3.2);
  const lean = go ? ROLL_TILT * Math.max(0, (st.leg - 0.6) / 0.4) : mode === "napping" ? -0.05 : mode === "slumped" ? -0.09 : 0;
  [st.tilt, st.tiltV] = spring(st.tilt, st.tiltV, lean, dt);
  const aim = domeAim(mode, s, phase, speaking);
  st.dome = mode === "celebrating" ? aim : st.dome + (aim - st.dome) * Math.min(1, dt * 8);

  const p: AstromechPose = { lift: 0, roll: 0, pitch: 0, tilt: st.tilt, leg: st.leg, dome: st.dome, eye: 1.4, lamp: 0.5 };
  if (go) {
    // Rolling: a buzz through the feet and a slow rock from side to side.
    p.lift = Math.abs(Math.sin(s * 31)) * 0.004;
    p.roll = Math.sin(s * 2.6) * 0.045;
  } else if (mode === "working" || mode === "typing") {
    // Busy at a panel: a working judder, rocking on its feet.
    p.lift = Math.max(0, Math.sin(s * 17)) * 0.006;
    p.roll = Math.sin(s * 3.1) * 0.02;
  } else if (mode === "celebrating") {
    // A happy bounce on its feet, rocking side to side.
    p.lift = Math.abs(Math.sin(s * 7)) * 0.05;
    p.roll = Math.sin(s * 7) * 0.08;
  } else if (mode !== "napping") {
    p.roll = Math.sin(s * 0.9) * 0.012;
  }
  if (speaking) p.pitch = Math.sin(s * 11) * 0.03;

  // Lights: a flare every seven to ten seconds, the eye up and the lamp blinking a burst.
  const period = 7 + (phase % 3);
  const flare = s % period < 1.3;
  const blink = Math.sin(s * 34) > 0 ? 1 : 0;
  p.eye = 1.3 + Math.sin(s * 1.7) * 0.25 + (flare ? 2.4 : 0);
  p.lamp = flare ? 0.4 + blink * 4.5 : 0.35 + Math.max(0, Math.sin(s * 0.8)) * 0.3;
  if (speaking) p.lamp = 0.6 + blink * 4;
  if (mode === "working" || mode === "typing") p.lamp = Math.sin(s * 9) > 0.4 ? 3.5 : 0.5;
  if (mode === "celebrating") p.eye = p.lamp = 1.5 + blink * 3;
  if (mode === "napping") {
    p.eye = 0.12 + Math.max(0, Math.sin(s * 0.9)) * 0.15;
    p.lamp = 0;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------- the protocol droid

export interface ProtocolPose {
  /** Whole-droid lift (metres before scale; negative dips), and the torso's yaw, roll and forward pitch. */
  lift: number;
  yaw: number;
  roll: number;
  pitch: number;
  /** Each leg's swing from the hip, forward positive. The knees never bend. */
  legL: number;
  legR: number;
  /** The free (left) arm's forward raise and outward lift; the hand-on-hip (right) arm's. */
  armL: number;
  armLOut: number;
  armR: number;
  armROut: number;
  /** The head: turn (to its left), nod (down) and tilt. */
  headYaw: number;
  headPitch: number;
  headTilt: number;
  /** Eye glow, as emissive intensity. */
  eye: number;
}

/** How far a leg swings either way while walking, radians: short shuffling steps, with no knees to help. */
export const STRIDE = 0.16;
/** Hip height, metres before scale (scripts/build-droids.mjs puts the hips at 20.5 of 50 STL units, of 1.72 m). */
const HIP = 0.705;

export function protocolPose(mode: PoseMode, s: number, phase = 0, speaking = false): ProtocolPose {
  const p: ProtocolPose = { lift: 0, yaw: 0, roll: 0, pitch: 0, legL: 0, legR: 0, armL: 0, armLOut: 0.04, armR: 0, armROut: 0, headYaw: 0, headPitch: 0, headTilt: 0, eye: 1.6 };
  // The head never glides: it snaps between angles, a servo at a time.
  p.headYaw = servo(s, 1.9, 0.12, (n) => (rand(n, phase) - 0.5) * 0.8);
  p.headTilt = servo(s, 2.7, 0.12, (n) => (rand(n, phase + 1) - 0.5) * 0.18);
  // A blink now and then.
  if ((s + phase) % 4.3 < 0.12) p.eye = 0.2;

  if (moving(mode)) {
    // Stiff-legged: a shaped swing that lingers at each end of the stride, like a shuffle that has to think.
    const w = s * 5.2;
    const raw = Math.sin(w);
    const swing = Math.sign(raw) * Math.pow(Math.abs(raw), 0.7) * STRIDE;
    p.legL = swing;
    p.legR = -swing;
    // Straight legs splayed lower the hips; it rocks over onto each foot in turn and twists a little with each step.
    p.lift = -HIP * (1 - Math.cos(swing));
    p.roll = Math.cos(w) * 0.05;
    p.yaw = raw * 0.06;
    // The free arm swings against its leg, stiff as a rod. The other hand stays on its hip.
    p.armL = -swing * 0.6;
    p.armR = swing * 0.08;
    p.headYaw *= 0.4;
    p.headPitch = -0.04;
    if (mode === "carrying") {
      p.armL = 0.9;
      p.armR = 0.1;
    }
    return p;
  }
  switch (mode) {
    case "working":
    case "typing": {
      // Filing a compliance note: arm out over the ledger, stamping each line, head down to read it.
      p.armL = 0.85 + Math.max(0, Math.sin(s * 6)) * 0.12;
      p.headPitch = 0.3;
      p.headYaw *= 0.3;
      p.pitch = 0.05;
      break;
    }
    case "napping": {
      // Shut down for the night: head down, arm hanging, a slight stoop, eyes all but out.
      p.headPitch = 0.5;
      p.headYaw = 0;
      p.headTilt = 0.08;
      p.pitch = 0.07;
      p.armL = -0.05;
      p.eye = 0.08;
      break;
    }
    case "slumped": {
      p.headPitch = 0.38;
      p.pitch = 0.1;
      p.armL = -0.05;
      p.eye = 0.6;
      break;
    }
    case "celebrating": {
      // Both arms up and out, a jiggle of delight, the most it has ever bent.
      p.armL = 1.2;
      p.armLOut = 0.7 + Math.sin(s * 9) * 0.1;
      p.armR = 0.5;
      p.armROut = -0.6 - Math.sin(s * 9) * 0.1;
      p.lift = Math.abs(Math.sin(s * 9)) * 0.02;
      p.headPitch = -0.2;
      break;
    }
    case "staring":
    case "stare": {
      p.headYaw = servo(s, 3, 0.1, (n) => (rand(n, phase + 2) - 0.5) * 0.3);
      p.headPitch = -0.08;
      break;
    }
    default: {
      // Idle and waiting: fussing. Every few seconds the stiff free arm lifts a little, "oh my", and shakes at the wrist
      // of the hand it doesn't have; the head tilts back in dismay.
      const beat = 5.5 + (phase % 2);
      const u = (s % beat) / beat;
      const fuss = u > 0.55 && u < 0.85 ? Math.sin(((u - 0.55) / 0.3) * Math.PI) : 0;
      p.armL = fuss * 0.5 + Math.sin(s * 0.7) * 0.03;
      p.armLOut = 0.04 + fuss * 0.12 + fuss * Math.sin(s * 18) * 0.03;
      p.headPitch = -fuss * 0.16;
      p.roll = Math.sin(s * 0.8) * 0.012;
      if (mode === "waiting") p.yaw = Math.sin(s * 0.5) * 0.08;
    }
  }
  if (speaking) {
    // Talking with the free hand, in short stiff chops, and nodding along.
    p.armL = Math.max(p.armL, 0.25 + Math.abs(Math.sin(s * 5)) * 0.2);
    p.headPitch += Math.sin(s * 9) * 0.05;
  }
  return p;
}
