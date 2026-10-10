import { Box3, Euler, Quaternion, Vector3, type Bone, type Matrix4, type Object3D } from "three";
import type { PetMode } from "./types.ts";

/**
 * How Brogu moves. The model ships rigged but without a single clip, and with his left arm stuck up in front of
 * him mid-gesture, so rigBrogu first brings that arm down to match the other, then every pose here is built on his
 * own skeleton: each bone is turned about his own axes (+Y up, +Z forward, +X his left), so nothing depends on how
 * the rig's bones happen to be oriented.
 *
 * - Walking is a toddler's: short, quick steps on a wide stance, the whole of him rocking over whichever foot is
 *   down, a little bounce on every step, arms held out for balance, and the ears flopping a beat behind.
 * - Idle: standing, breathing, looking about, an ear twitching, the head tipping to one side when something's
 *   interesting.
 * - Sit: plopped on his bottom, legs straight out in front, feet waggling.
 * - Nap: sat, nodding off, ears drooping, chin to his chest.
 * - Groom: his party trick. One hand raised at something across the room, eyes screwed up, very still.
 */

/** The rig, by role. Bone names are the export's own; left is +X. */
const BONES = {
  root: "Bone_000",
  pelvis: "Bone_001",
  spine: ["Bone_005", "Bone_004", "Bone_003", "Bone_002"],
  neck: "Bone_015",
  head: "Bone_014",
  /** Base to tip. */
  ears: [
    ["Bone_029", "Bone_028"],
    ["Bone_026", "Bone_025"],
  ],
  /** Shoulder, elbow, wrist, hand. */
  arms: [
    ["Bone_019", "Bone_018", "Bone_017", "Bone_016"],
    ["Bone_023", "Bone_022", "Bone_021", "Bone_020"],
  ],
  fingers: [
    ["Bone_031", "Bone_034", "Bone_037"],
    ["Bone_040", "Bone_043", "Bone_046"],
  ],
  /** Hip, knee, ankle, toe. */
  legs: [
    ["Bone_013", "Bone_012", "Bone_011", "Bone_010"],
    ["Bone_009", "Bone_008", "Bone_007", "Bone_006"],
  ],
} as const;

/** Every number the motion is built from. Angles in radians; lengths in model units (he's 1.7 tall at rest). */
export const BROGU_GAIT = {
  /**
   * Model units travelled per full cycle (both feet step once). Longer than his legs could manage, but the robe
   * hides that, and it keeps his cadence a toddler's rather than a sewing machine's.
   */
  stride: 0.9,
  /** Share of a cycle a foot is planted. Over a half, so there's a moment with both down: he's careful. */
  duty: 0.56,
  /** How far a leg swings fore and aft at the hip. */
  swing: 0.2,
  /** How much the knee folds to lift the foot at mid-step. */
  knee: 0.45,
  /** Rock of the body over the planted foot, and the counter-tilt of the head. The waddle. */
  rock: 0.13,
  /** Hips and shoulders twisting with the step. */
  twist: 0.12,
  /** Arms held out from his sides, and their swing. */
  armsOut: 0.42,
  armSwing: 0.32,
  /** The bounce, twice a cycle, and how far the ears flop behind it. */
  bob: 0.045,
  flop: 0.22,
  /** Leaning into the walk. */
  lean: 0.08,
};

export interface BroguRig {
  model: Object3D;
  rest: Map<Bone, Quaternion>;
  /** In hierarchy order, so a parent is posed before its children. */
  order: Bone[];
  /** Puts his feet on the floor, centred under the origin. */
  offset: Vector3;
  /** The gait's clock, in cycles. */
  clock: number;
  /** How much of each mode is showing, eased so he settles into a pose rather than snapping. */
  weights: Record<PetMode, number>;
  /** A slow, wandering look-about for the idle. */
  look: number;
  lookTarget: number;
  nextLook: number;
}

const q = new Quaternion();
const pq = new Quaternion();
const rq = new Quaternion();
const e = new Euler(0, 0, 0, "YXZ");
const va = new Vector3();
const vb = new Vector3();
const vt = new Vector3();

/** The bone's parent's turn relative to the model, as posed so far. */
function parentTurn(model: Object3D, bone: Bone, out: Quaternion) {
  out.identity();
  for (let o = bone.parent; o && o !== model; o = o.parent) out.premultiply(o.quaternion);
  return out;
}

/** Turn `bone` by `turn`, given in the model's frame: local' = P⁻¹ · R · P · local. */
function turnInModel(model: Object3D, bone: Bone, turn: Quaternion) {
  parentTurn(model, bone, pq);
  q.copy(pq).invert().multiply(turn).multiply(pq);
  bone.quaternion.premultiply(q);
}

/** Where a bone is, in the model's frame. */
function at(inv: Matrix4, b: Bone, out: Vector3) {
  return out.setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
}

export function rigBrogu(model: Object3D): BroguRig {
  const bones = new Map<string, Bone>();
  const order: Bone[] = [];
  model.traverse((o) => {
    const b = o as Bone;
    if (b.isBone) {
      bones.set(b.name, b);
      order.push(b);
    }
  });
  const bone = (n: string) => bones.get(n);

  // His left arm comes up mid-gesture. Point each of its segments the way the right arm's mirror image points.
  model.updateMatrixWorld(true);
  const inv = model.matrixWorld.clone().invert();
  const centre = (names: readonly string[], out: Vector3) => {
    out.set(0, 0, 0);
    for (const n of names) out.add(at(inv, bone(n)!, vt));
    return out.divideScalar(names.length);
  };
  const [L, R] = BONES.arms;
  const segments: [string, string | readonly string[], string, string | readonly string[]][] = [
    [L[0], L[1], R[0], R[1]],
    [L[1], L[2], R[1], R[2]],
    [L[3], BONES.fingers[0], R[3], BONES.fingers[1]],
  ];
  if (order.length && segments.every(([a, , c]) => bone(a) && bone(c))) {
    for (const [from, to, mFrom, mTo] of segments) {
      model.updateMatrixWorld(true);
      const end = (x: string | readonly string[], out: Vector3) => (typeof x === "string" ? at(inv, bone(x)!, out) : centre(x, out));
      const d = end(to, va).sub(at(inv, bone(from)!, vt)).normalize();
      const target = end(mTo, vb).sub(at(inv, bone(mFrom)!, vt));
      target.x = -target.x;
      target.normalize();
      turnInModel(model, bone(from)!, rq.setFromUnitVectors(d, target));
    }
  }

  const rest = new Map(order.map((b) => [b, b.quaternion.clone()]));
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model, true).applyMatrix4(inv);
  const offset = new Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return {
    model,
    rest,
    order,
    offset,
    clock: 0,
    weights: { idle: 1, walk: 0, sit: 0, nap: 0, groom: 0 },
    look: 0,
    lookTarget: 0,
    nextLook: 0,
  };
}

/** Pitch (about X), yaw (about Y), roll (about Z), in his frame. */
type Turn = [number, number, number];
interface Pose {
  turns: Map<string, Turn>;
  lift: number;
  /** Sideways shift of the whole of him, for the waddle. */
  side: number;
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
/** +1 for his left (+X), -1 for his right. */
const SIDE = [1, -1] as const;

/** Lift (+) or droop (-) an ear, and sweep it back (+). */
function ear(p: Pose, i: 0 | 1, up: number, back: number, w: number) {
  const s = SIDE[i];
  const [base, tip] = BONES.ears[i];
  add(p, base, 0, -s * back * w, s * up * w);
  add(p, tip, 0, -s * back * 0.5 * w, s * up * 0.6 * w);
}

/** Hold an arm out from his side (+), forward (+), with the elbow bent (+). */
function arm(p: Pose, i: 0 | 1, out: number, fwd: number, bend: number, w: number) {
  const s = SIDE[i];
  const [shoulder, elbow] = BONES.arms[i];
  add(p, shoulder, -fwd * w, 0, s * out * w);
  add(p, elbow, -bend * w);
}

/** One leg through its step: fore/aft swing at the hip, the knee folding to lift the foot while it's up. */
function step(p: Pose, i: 0 | 1, u: number, w: number) {
  const g = BROGU_GAIT;
  u = ((u % 1) + 1) % 1;
  let along: number;
  let up = 0;
  if (u < g.duty) along = 1 - (2 * u) / g.duty;
  else {
    const s = (u - g.duty) / (1 - g.duty);
    along = -1 + 2 * smooth(s);
    up = Math.sin(Math.PI * s);
  }
  const [hip, knee, ankle] = BONES.legs[i];
  // Negative pitch carries a hanging leg forward; positive on the knee folds it back.
  add(p, hip, (-g.swing * along - g.knee * 0.45 * up) * w);
  add(p, knee, g.knee * up * w);
  // The foot stays level through the swing, then pushes off.
  add(p, ankle, (-g.knee * 0.5 * up + 0.15 * Math.max(0, -along) * (1 - up)) * w);
}

function walkPose(p: Pose, rig: BroguRig, w: number) {
  if (w < 1e-3) return;
  const g = BROGU_GAIT;
  const c = rig.clock;
  step(p, 0, c, w);
  step(p, 1, c - 0.5, w);
  // He rocks over whichever foot is down: left planted for the first half of the cycle.
  const rock = Math.sin(TAU * c);
  add(p, BONES.pelvis, 0, g.twist * rock * w, 0);
  add(p, BONES.spine[0], g.lean * w, 0, -g.rock * rock * w);
  add(p, BONES.spine[2], 0, -g.twist * 1.4 * rock * w, 0);
  add(p, BONES.neck, -g.lean * 0.6 * w, 0, g.rock * 0.6 * rock * w);
  add(p, BONES.head, 0.03 * Math.sin(TAU * 2 * c) * w, 0, g.rock * 0.3 * rock * w);
  p.side += 0.03 * rock * w;
  // Arms out for balance, swinging against the legs.
  arm(p, 0, g.armsOut, g.armSwing * rock, 0.35, w);
  arm(p, 1, g.armsOut, -g.armSwing * rock, 0.35, w);
  // A bounce on every step; the ears catch up late.
  const bounce = Math.cos(TAU * 2 * c);
  const flop = Math.cos(TAU * 2 * c - 1.3);
  p.lift += g.bob * (bounce - 1) * 0.5 * w;
  ear(p, 0, g.flop * flop, 0.12, w);
  ear(p, 1, g.flop * flop, 0.12, w);
}

function idlePose(p: Pose, rig: BroguRig, t: number, w: number) {
  if (w < 1e-3) return;
  const breath = Math.sin(t * 2.1);
  add(p, BONES.spine[1], -0.02 * breath * w);
  add(p, BONES.spine[3], -0.025 * breath * w);
  add(p, BONES.neck, 0, rig.look * 0.5 * w);
  // Something interesting: the head tips right over.
  const tip = Math.max(0, Math.sin(t * 0.31)) ** 8;
  add(p, BONES.head, 0.04 * Math.sin(t * 0.8) * w, rig.look * 0.4 * w, 0.32 * tip * w);
  // Ears ride up when he's curious, and twitch now and then.
  ear(p, 0, 0.12 * tip + 0.18 * Math.sin(t * 1.1) ** 30, 0, w);
  ear(p, 1, 0.12 * tip + 0.18 * Math.sin(t * 1.1 + 2.1) ** 30, 0, w);
  arm(p, 0, 0.1, 0.05, 0.3, w);
  arm(p, 1, 0.1, 0.05, 0.3, w);
  // He shifts his weight from foot to foot.
  add(p, BONES.spine[0], 0, 0, 0.02 * Math.sin(t * 0.6) * w);
}

/**
 * Plopped down on his bottom, robe pooled round him, feet poking forward and waggling. His legs are inside the
 * robe, so they only fold a little: any more and the hem goes with them.
 */
function sitPose(p: Pose, t: number, w: number, doze: number) {
  if (w < 1e-3) return;
  for (const i of [0, 1] as const) {
    const [hip, knee, ankle] = BONES.legs[i];
    const waggle = (1 - doze) * 0.3 * Math.sin(t * 3.2 + i * Math.PI) * Math.max(0, Math.sin(t * 0.45));
    add(p, hip, -0.45 * w, 0, SIDE[i] * 0.1 * w);
    add(p, knee, 0.25 * w);
    add(p, ankle, (-0.3 + waggle) * w);
    arm(p, i, 0.2, 0.5, 0.7, w);
  }
  add(p, BONES.spine[0], -0.06 * w);
  const breath = Math.sin(t * (1.9 - doze));
  add(p, BONES.spine[3], -0.02 * breath * w);
  add(p, BONES.neck, 0.04 * w);
  p.lift -= 0.06 * w;
}

/** Nodding off where he sits: chin dropping to his chest and jerking back up, ears down. */
function napPose(p: Pose, t: number, w: number) {
  if (w < 1e-3) return;
  const nod = 0.5 + 0.5 * Math.sin(t * 0.5);
  add(p, BONES.spine[2], 0.12 * w);
  add(p, BONES.neck, 0.3 * nod * w);
  add(p, BONES.head, (0.25 + 0.2 * nod) * w, 0, 0.15 * w);
  ear(p, 0, -0.35, 0.2, w);
  ear(p, 1, -0.35, 0.2, w);
}

/** One hand raised at something across the room, eyes screwed up, very still. */
function reachPose(p: Pose, t: number, w: number) {
  if (w < 1e-3) return;
  const side = Math.sin(t * 0.21) > 0 ? 0 : 1;
  const strain = 0.04 * Math.sin(t * 23) * Math.max(0, Math.sin(t * 0.7));
  arm(p, side, 0.35, 1.35 + strain, 0.2, w);
  add(p, BONES.arms[side][3], -0.3 * w);
  for (const f of BONES.fingers[side]) add(p, f, -0.2 * w);
  add(p, BONES.spine[2], -0.05 * w, SIDE[side] * -0.15 * w);
  add(p, BONES.head, 0.12 * w, SIDE[side] * 0.15 * w);
  ear(p, 0, -0.18, 0.25, w);
  ear(p, 1, -0.18, 0.25, w);
}

/**
 * Pose Brogu for `mode`. `t` is the render clock in seconds, `speed` how fast he's travelling in model units a
 * second (the gait clock runs on distance, so his feet don't skate).
 */
export function poseBrogu(rig: BroguRig, mode: PetMode, t: number, dt: number, speed: number) {
  const g = BROGU_GAIT;
  const ease = 1 - Math.exp(-dt * 5);
  for (const k of Object.keys(rig.weights) as PetMode[]) rig.weights[k] += ((k === mode ? 1 : 0) - rig.weights[k]) * ease;
  const w = rig.weights;
  // Keep the legs going while they ease out, so he finishes the step he's in.
  rig.clock += mode === "walk" ? (Math.max(speed, 0.3) * dt) / g.stride : w.walk > 0.02 ? dt * 0.6 : 0;

  if (t > rig.nextLook) {
    rig.lookTarget = (Math.random() - 0.5) * 1.2;
    rig.nextLook = t + 1.5 + Math.random() * 3.5;
  }
  rig.look += (rig.lookTarget - rig.look) * (1 - Math.exp(-dt * 3));

  const p: Pose = { turns: new Map(), lift: 0, side: 0 };
  walkPose(p, rig, w.walk);
  idlePose(p, rig, t, w.idle + w.groom);
  sitPose(p, t, w.sit + w.nap, w.nap / Math.max(1e-3, w.sit + w.nap));
  napPose(p, t, w.nap);
  reachPose(p, t, w.groom);

  for (const b of rig.order) {
    b.quaternion.copy(rig.rest.get(b)!);
    const turn = p.turns.get(b.name);
    if (!turn) continue;
    turnInModel(rig.model, b, rq.setFromEuler(e.set(turn[0], turn[1], turn[2])));
  }
  rig.model.position.set(rig.offset.x + p.side, rig.offset.y + p.lift, rig.offset.z);
}
