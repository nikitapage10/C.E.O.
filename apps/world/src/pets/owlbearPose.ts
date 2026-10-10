import { Box3, Euler, Quaternion, Vector3, type Bone, type Object3D } from "three";
import type { PetMode } from "./types.ts";

/**
 * How the owlbear cub moves. The model ships rigged but without a single clip, so every pose here is built on its
 * own skeleton: each bone is turned about the cub's own axes (+Y up, +Z forward, +X his left), so nothing depends
 * on how the rig's bones happen to be oriented.
 *
 * - Walking is a bear's: a slow lateral-sequence walk (hind foot, then the front foot on the same side, then the
 *   other side), paws lifting low, the hips and shoulders rolling over the planted legs, the head carried low and
 *   swinging.
 * - Idle: standing square, breathing, looking about, ear tufts twitching.
 * - Sit: down on his haunches like a bear, hind legs out in front, forepaws on his belly.
 * - Nap: flat on his front, forepaws out, chin down on them.
 * - Groom: sat up and preening a shoulder with his beak, the owl half of him.
 */

/** The rig, by role. Bone names are the export's own. */
const BONES = {
  pelvis: "Bone_001",
  spine: ["Bone_007", "Bone_006", "Bone_005", "Bone_004"],
  neck: ["Bone_024", "Bone_023"],
  head: "Bone_022",
  beak: "Bone_048",
  tufts: ["Bone_051", "Bone_054"],
  tail: ["Bone_002", "Bone_021", "Bone_020", "Bone_019"],
  /** Shoulder or hip first, down to the paw. */
  fore: [
    ["Bone_030", "Bone_029", "Bone_028", "Bone_027", "Bone_026"],
    ["Bone_036", "Bone_035", "Bone_034", "Bone_033", "Bone_032"],
  ],
  hind: [
    ["Bone_012", "Bone_011", "Bone_010", "Bone_009"],
    ["Bone_017", "Bone_016", "Bone_015", "Bone_014"],
  ],
} as const;

/** Every number the motion is built from. Angles in radians; lengths in model units (he's 1.7 tall at rest). */
export const OWLBEAR_GAIT = {
  /** Model units travelled per full cycle (every foot steps once). */
  stride: 0.95,
  /** Share of a cycle a foot is planted. */
  duty: 0.62,
  /** When each foot steps: hind left, fore left, hind right, fore right. A bear's lateral sequence. */
  phase: { hindL: 0, foreL: 0.14, hindR: 0.5, foreR: 0.64 },
  /** How far a leg swings fore and aft at the shoulder or hip. */
  swing: 0.36,
  /** How much the knee and wrist fold to lift the paw at mid-step. */
  fold: 0.75,
  /** Roll of the hips and shoulders over the planted side, and their sway. The lumber. */
  roll: 0.07,
  sway: 0.08,
  /** Head carried low while walking, and swinging side to side. */
  headDown: 0.18,
  headSwing: 0.14,
  /** Body bob, twice a cycle. */
  bob: 0.025,
};

export interface OwlbearRig {
  model: Object3D;
  rest: Map<Bone, Quaternion>;
  /** In hierarchy order, so a parent is posed before its children. */
  order: Bone[];
  /** Puts his feet on the floor, centred under the origin. */
  offset: Vector3;
  /** The fore and hind legs, left (+X) first. */
  fore: [string[], string[]];
  hind: [string[], string[]];
  /** The gait's clock, in cycles. */
  clock: number;
  /** How much of each mode is showing, eased so he settles into a pose rather than snapping. */
  weights: Record<PetMode, number>;
  /** A slow, wandering look-about for the idle. */
  look: number;
  lookTarget: number;
  nextLook: number;
}

export function rigOwlbear(model: Object3D): OwlbearRig {
  const bones = new Map<string, Bone>();
  const order: Bone[] = [];
  model.traverse((o) => {
    const b = o as Bone;
    if (b.isBone) {
      bones.set(b.name, b);
      order.push(b);
    }
  });
  const rest = new Map(order.map((b) => [b, b.quaternion.clone()]));
  model.updateMatrixWorld(true);
  const inv = model.matrixWorld.clone().invert();
  const box = new Box3().setFromObject(model, true).applyMatrix4(inv);
  const offset = new Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const sideX = (leg: readonly string[]) => {
    const b = bones.get(leg[0]!);
    return b ? new Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv).x : 0;
  };
  const pair = ([a, b]: readonly (readonly string[])[]) => (sideX(a!) >= sideX(b!) ? [[...a!], [...b!]] : [[...b!], [...a!]]) as [string[], string[]];
  return {
    model,
    rest,
    order,
    offset,
    fore: pair(BONES.fore),
    hind: pair(BONES.hind),
    clock: 0,
    weights: { idle: 1, walk: 0, sit: 0, nap: 0, groom: 0 },
    look: 0,
    lookTarget: 0,
    nextLook: 0,
  };
}

/** Pitch (about X), yaw (about Y), roll (about Z), in the cub's frame. */
type Turn = [number, number, number];
interface Pose {
  turns: Map<string, Turn>;
  lift: number;
}

function add(p: Pose, name: string | undefined, x = 0, y = 0, z = 0) {
  if (!name) return;
  const t = p.turns.get(name);
  if (t) {
    t[0] += x;
    t[1] += y;
    t[2] += z;
  } else p.turns.set(name, [x, y, z]);
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const TAU = Math.PI * 2;

/** One leg through its step: fore/aft swing at the top, a fold through the lower joints while the paw is up. */
function step(p: Pose, leg: string[], u: number, w: number, hind: boolean) {
  const g = OWLBEAR_GAIT;
  u = ((u % 1) + 1) % 1;
  let along: number;
  let up = 0;
  if (u < g.duty) along = 1 - (2 * u) / g.duty;
  else {
    const s = (u - g.duty) / (1 - g.duty);
    along = -1 + 2 * smooth(s);
    up = Math.sin(Math.PI * s);
  }
  const [top, mid, low, paw] = leg;
  // Negative pitch carries a hanging leg forward.
  add(p, top, -g.swing * along * w);
  if (hind) {
    // The knee comes forward and the hock folds back: a flat-footed bear's step.
    add(p, mid, -g.fold * 0.5 * up * w);
    add(p, low, g.fold * up * w);
    add(p, paw, g.fold * 0.4 * up * w);
  } else {
    // The forepaw swings through curled, then reaches for the floor.
    add(p, mid, g.fold * 0.35 * up * w);
    add(p, low, g.fold * 0.6 * up * w);
    add(p, paw, g.fold * 0.9 * up * w);
  }
}

function walkPose(p: Pose, rig: OwlbearRig, w: number) {
  if (w < 1e-3) return;
  const g = OWLBEAR_GAIT;
  const c = rig.clock;
  step(p, rig.hind[0], c - g.phase.hindL, w, true);
  step(p, rig.fore[0], c - g.phase.foreL, w, false);
  step(p, rig.hind[1], c - g.phase.hindR, w, true);
  step(p, rig.fore[1], c - g.phase.foreR, w, false);
  // Weight rolls onto whichever side is planted; the shoulders follow the hips a beat later.
  const s = Math.sin(TAU * c);
  const s2 = Math.sin(TAU * (c - 0.14));
  add(p, BONES.pelvis, 0, g.sway * s * w, g.roll * s * w);
  add(p, BONES.spine[2], 0, -g.sway * 0.8 * s2 * w, -g.roll * 1.6 * s2 * w);
  // Head low and swinging, against the shoulders.
  add(p, BONES.neck[0], g.headDown * w, g.headSwing * Math.sin(TAU * (c - 0.3)) * w);
  add(p, BONES.head, (-g.headDown * 0.5 + 0.04 * Math.sin(TAU * 2 * c)) * w);
  add(p, BONES.tail[0], 0, -0.15 * s * w);
  add(p, BONES.tail[2], 0, -0.15 * Math.sin(TAU * (c - 0.2)) * w);
  p.lift += g.bob * (Math.cos(TAU * 2 * c) - 1) * 0.5 * w;
}

function idlePose(p: Pose, rig: OwlbearRig, t: number, w: number) {
  if (w < 1e-3) return;
  const breath = Math.sin(t * 1.6);
  add(p, BONES.spine[1], -0.015 * breath * w);
  add(p, BONES.spine[3], -0.02 * breath * w);
  add(p, BONES.neck[0], 0.05 * w, rig.look * 0.6 * w);
  // Now and then the head cocks, owl-fashion.
  add(p, BONES.head, 0.05 * Math.sin(t * 0.7) * w, rig.look * 0.5 * w, 0.25 * Math.max(0, Math.sin(t * 0.37)) ** 6 * w);
  add(p, BONES.tufts[0], -0.35 * Math.sin(t * 0.9) ** 24 * w);
  add(p, BONES.tufts[1], -0.35 * Math.sin(t * 0.9 + 1.3) ** 24 * w);
  add(p, BONES.tail[1], 0, 0.08 * Math.sin(t * 1.1) * w);
}

/** Down on his haunches, like a bear. `preen` hands the head over to the groom. */
function sitPose(p: Pose, t: number, w: number, preen: number) {
  if (w < 1e-3) return;
  const up = -0.62;
  add(p, BONES.pelvis, up * w);
  // Hind legs out in front, paws turned up.
  for (const leg of BONES.hind) {
    add(p, leg[0], (-1.0 - up) * w);
    add(p, leg[1], -0.2 * w);
    add(p, leg[2], -0.35 * w);
    add(p, leg[3], -0.45 * w);
  }
  // Forearms down to the belly, paws curled.
  for (const leg of BONES.fore) {
    add(p, leg[0], (-up - 0.05) * w);
    add(p, leg[2], -0.45 * w);
    add(p, leg[3], 0.6 * w);
    add(p, leg[4], 0.4 * w);
  }
  add(p, BONES.spine[1], 0.08 * w);
  add(p, BONES.neck[0], -up * 0.55 * w * (1 - preen));
  add(p, BONES.head, -up * 0.25 * w * (1 - preen));
  add(p, BONES.tail[0], 0.5 * w);
  add(p, BONES.tail[1], 0.3 * w);
  add(p, BONES.spine[3], -0.025 * Math.sin(t * 1.4) * w);
  p.lift -= 0.36 * w;
}

/** Preening a shoulder: the head turns right round, and the beak nibbles. */
function groomPose(p: Pose, t: number, w: number) {
  if (w < 1e-3) return;
  const side = Math.sin(t * 0.25) > 0 ? 1 : -1;
  const nib = Math.max(0, Math.sin(t * 9)) * (0.5 + 0.5 * Math.sin(t * 1.3));
  add(p, BONES.neck[0], 0.35 * w, 0.75 * side * w, 0.15 * side * w);
  add(p, BONES.neck[1], 0.2 * w, 0.55 * side * w);
  add(p, BONES.head, (0.3 + 0.12 * nib) * w, 0.3 * side * w, 0.2 * side * w);
  add(p, BONES.beak, 0.2 * nib * w);
}

/** Flat on his front, forepaws out, chin on them. */
function napPose(p: Pose, t: number, w: number) {
  if (w < 1e-3) return;
  const breath = Math.sin(t * 0.9);
  for (const leg of BONES.fore) {
    add(p, leg[0], -0.95 * w);
    add(p, leg[1], -0.2 * w);
    add(p, leg[2], 0.35 * w);
    add(p, leg[3], 0.5 * w);
  }
  for (const leg of BONES.hind) {
    add(p, leg[0], 1.15 * w);
    add(p, leg[2], -0.5 * w);
    add(p, leg[3], -0.4 * w);
  }
  add(p, BONES.pelvis, 0.06 * w, 0, 0.08 * w);
  add(p, BONES.spine[1], -0.03 * breath * w);
  add(p, BONES.spine[3], -0.04 * breath * w);
  add(p, BONES.neck[0], 0.35 * w);
  add(p, BONES.neck[1], 0.15 * w);
  add(p, BONES.head, -0.1 * w, 0.25 * w, 0.3 * w);
  add(p, BONES.tufts[0], 0.4 * w);
  add(p, BONES.tufts[1], 0.4 * w);
  add(p, BONES.tail[0], 0.25 * w);
  p.lift -= (0.42 + 0.008 * breath) * w;
}

const q = new Quaternion();
const pq = new Quaternion();
const rq = new Quaternion();
const e = new Euler(0, 0, 0, "YXZ");

/** The bone's parent's turn relative to the model, as posed so far. */
function parentTurn(rig: OwlbearRig, bone: Bone, out: Quaternion) {
  out.identity();
  for (let o = bone.parent; o && o !== rig.model; o = o.parent) out.premultiply(o.quaternion);
  return out;
}

/**
 * Pose the cub for `mode`. `t` is the render clock in seconds, `speed` how fast he's travelling in model units a
 * second (the gait clock runs on distance, so his paws don't skate).
 */
export function poseOwlbear(rig: OwlbearRig, mode: PetMode, t: number, dt: number, speed: number) {
  const g = OWLBEAR_GAIT;
  const ease = 1 - Math.exp(-dt * 4);
  for (const k of Object.keys(rig.weights) as PetMode[]) rig.weights[k] += ((k === mode ? 1 : 0) - rig.weights[k]) * ease;
  const w = rig.weights;
  // Keep the legs going while they ease out, so he finishes the step he's in.
  rig.clock += mode === "walk" ? (Math.max(speed, 0.3) * dt) / g.stride : w.walk > 0.02 ? dt * 0.4 : 0;

  if (t > rig.nextLook) {
    rig.lookTarget = (Math.random() - 0.5) * 1.1;
    rig.nextLook = t + 2 + Math.random() * 4;
  }
  rig.look += (rig.lookTarget - rig.look) * (1 - Math.exp(-dt * 2.5));

  const p: Pose = { turns: new Map(), lift: 0 };
  walkPose(p, rig, w.walk);
  idlePose(p, rig, t, w.idle);
  sitPose(p, t, w.sit + w.groom, w.groom / Math.max(1e-3, w.sit + w.groom));
  groomPose(p, t, w.groom);
  napPose(p, t, w.nap);

  for (const b of rig.order) {
    b.quaternion.copy(rig.rest.get(b)!);
    const turn = p.turns.get(b.name);
    if (!turn) continue;
    // Turn the bone about the cub's own axes: local' = P⁻¹ · R · P · local.
    parentTurn(rig, b, pq);
    rq.setFromEuler(e.set(turn[0], turn[1], turn[2]));
    q.copy(pq).invert().multiply(rq).multiply(pq);
    b.quaternion.premultiply(q);
  }
  rig.model.position.set(rig.offset.x, rig.offset.y + p.lift, rig.offset.z);
}
