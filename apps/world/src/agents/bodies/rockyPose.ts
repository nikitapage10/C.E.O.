import { Quaternion, Vector3, type Bone, type Object3D } from "three";

/**
 * How an Eridian moves, as plain functions over its bones (shared by the world and offline previews). Five
 * identical limbs in radial symmetry, so nothing moves in left-right pairs:
 * - Standing, working, carrying: a tripod. Three limbs plant as a stable triangle; the front two rise as arms to
 *   engineer, gesture and hold. To walk like this it lifts one tripod leg at a time, in a ripple.
 * - Scuttling (getting somewhere): all five are legs, lifting in a fast, overlapping wave round the body,
 *   deliberately a little uneven, so it rolls rather than marches.
 * Plus a bounce to celebrate, a fist held out to bump, and a limp settle onto splayed legs to sleep.
 */

export type Leg = { bone: Bone; rest: Quaternion }[];
export type RockyMode = "idle" | "walking" | "carrying" | "typing" | "working" | "celebrating" | "slumped" | "napping" | "waiting" | "staring" | "stare";

/** The legs: every chain of three or more bones branching off the body, hip first, with its rest pose. */
export function legsOf(model: Object3D): Leg[] {
  const legs: Leg[] = [];
  model.traverse((o) => {
    const b = o as Bone;
    if (!b.isBone) return;
    const siblings = b.parent?.children.filter((c) => (c as Bone).isBone) ?? [];
    if (siblings.length < 2) return;
    const chain: Bone[] = [];
    let k: Object3D | undefined = b;
    while (k && (k as Bone).isBone) {
      chain.push(k as Bone);
      const next: Object3D[] = k.children.filter((c) => (c as Bone).isBone);
      k = next.length === 1 ? next[0] : undefined;
    }
    if (chain.length >= 3) legs.push(chain.map((bone) => ({ bone, rest: bone.quaternion.clone() })));
  });
  return legs;
}

/** Per leg, in the body's frame: the horizontal direction it splays out in, and whether it's one of the front pair. */
export interface LegFrame {
  out: Vector3;
  /** Axis to rotate about to lift the foot outward and up. */
  lift: Vector3;
  front: boolean;
  /** +1 on the left (+X), -1 on the right. */
  side: number;
}

const tmp = new Vector3();
const hip = new Vector3();
const foot = new Vector3();
export function legFrames(space: Object3D, legs: Leg[]): LegFrame[] {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const tips = legs.map((leg) => leg[leg.length - 1]!.bone.getWorldPosition(new Vector3()).applyMatrix4(inv));
  const order = tips.map((p, i) => ({ i, z: p.z })).sort((a, b) => b.z - a.z);
  const front = new Set([order[0]?.i, order[1]?.i]);
  return legs.map((leg, i) => {
    leg[0]!.bone.getWorldPosition(hip).applyMatrix4(inv);
    foot.copy(tips[i]!);
    const out = tmp.set(foot.x - 0, 0, foot.z - 0);
    if (out.lengthSq() < 1e-6) out.set(hip.x, 0, hip.z);
    out.normalize();
    return { out: out.clone(), lift: new Vector3(0, 1, 0).cross(out).normalize(), front: front.has(i), side: tips[i]!.x >= 0 ? 1 : -1 };
  });
}

export interface RockyState {
  /** 0..1: scuttling on all five. */
  scuttle: number;
  /** 0..1: stepping on the tripod. */
  tripod: number;
  /** How high the front pair are raised as arms (0 down as legs, ~1 working). */
  arms: number;
  sink: number;
  splay: number;
  bounce: number;
  bump: number;
}
export const rockyState = (): RockyState => ({ scuttle: 0, tripod: 0, arms: 0.45, sink: 0, splay: 0, bounce: 0, bump: 0 });
const smooth = (a: number, b: number, k: number) => a + (b - a) * k;

/** When each leg lifts in the scuttle, as a fraction of the cycle: a wave round the body, off the beat. */
const SCUTTLE_AT = [0, 0.17, 0.41, 0.58, 0.83];

/** A step: the foot is up for the first `duty` of each cycle, lifting and swinging through, then planted. */
function step(cycle: number, duty: number) {
  const c = ((cycle % 1) + 1) % 1;
  if (c < duty) {
    const u = c / duty;
    return { lift: Math.sin(u * Math.PI), swing: -Math.cos(u * Math.PI) };
  }
  const u = (c - duty) / (1 - duty);
  return { lift: 0, swing: -1 + 2 * u };
}

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const spaceQ = new Quaternion();
const parentQ = new Quaternion();
const r1 = new Quaternion();
const r2 = new Quaternion();

/** Turn a bone by `q` given in the body's frame, on top of where it is now. */
function turn(space: Object3D, bone: Bone, q: Quaternion) {
  space.getWorldQuaternion(spaceQ);
  bone.parent!.getWorldQuaternion(parentQ);
  const inBody = spaceQ.clone().invert().multiply(parentQ);
  bone.quaternion.copy(inBody.clone().invert().multiply(q).multiply(inBody).multiply(bone.quaternion));
  bone.updateWorldMatrix(false, true);
}

/** Pose an Eridian for one frame. `space` is the body's frame (+Z forward). Returns the carapace's height offset and roll. */
export function poseRocky(space: Object3D, legs: Leg[], frames: LegFrame[], st: RockyState, mode: RockyMode, t: number, phase: number) {
  const scuttling = mode === "walking";
  const stepping = mode === "carrying";
  st.scuttle = smooth(st.scuttle, scuttling ? 1 : 0, 0.12);
  st.tripod = smooth(st.tripod, stepping ? 1 : 0, 0.1);
  const armsUp = mode === "typing" || mode === "working" || mode === "carrying" ? 1.05 : scuttling || mode === "napping" ? 0 : mode === "slumped" ? 0.15 : 0.45;
  st.arms = smooth(st.arms, armsUp, 0.08);
  // Settling: splayed legs let the carapace down a little, never into the floor.
  st.sink = smooth(st.sink, mode === "napping" ? 1 : mode === "slumped" ? 0.4 : 0, mode === "napping" ? 0.12 : 0.05);
  st.splay = smooth(st.splay, mode === "napping" ? 1 : mode === "slumped" ? 0.4 : 0, 0.08);
  st.bounce = smooth(st.bounce, mode === "celebrating" ? 1 : 0, 0.1);
  st.bump = smooth(st.bump, mode === "waiting" ? 1 : 0, 0.06);

  for (const leg of legs) for (const { bone, rest } of leg) bone.quaternion.copy(rest);
  space.updateMatrixWorld(true);

  const tripodLegs = legs.map((_, k) => k).filter((k) => !frames[k]!.front);
  legs.forEach((leg, k) => {
    const f = frames[k]!;
    let lift = 0;
    let swing = 0;
    // Scuttle: every leg, fast, each on its own beat.
    if (st.scuttle > 0.01) {
      const s = step(t * 3.1 + SCUTTLE_AT[k % SCUTTLE_AT.length]! + phase * 0.1, 0.38);
      lift += s.lift * 0.32 * st.scuttle;
      swing += s.swing * 0.24 * st.scuttle;
    }
    // Tripod walk: the three planted legs lift one at a time.
    const t3 = tripodLegs.indexOf(k);
    if (t3 >= 0 && st.tripod > 0.01) {
      const s = step(t * 1.6 + t3 / 3 + phase * 0.1, 0.28);
      lift += s.lift * 0.26 * st.tripod;
      swing += s.swing * 0.16 * st.tripod;
    }
    // Celebrating: legs pump in turn round the body; settling: legs splay flat.
    lift += st.bounce * (0.12 + Math.max(0, Math.sin(t * 9 + k * 1.3)) * 0.3);
    lift -= st.splay * 0.5;
    // Breathing, so it's never quite still.
    lift += Math.sin(t * 1.4 + k + phase) * 0.03;
    r1.setFromAxisAngle(f.lift, -lift);
    r2.setFromAxisAngle(UP, swing);
    turn(space, leg[0]!.bone, r2.multiply(r1));
    // The knee keeps the foot pointing at the floor.
    if (leg[1]) turn(space, leg[1].bone, r1.setFromAxisAngle(f.lift, lift * 0.7));

    if (f.front) {
      // The front pair are arms: up and forward, tips tapping to type, turning things over to work.
      const tap = mode === "typing" ? Math.max(0, Math.sin(t * 10 + (f.side > 0 ? 0 : Math.PI))) * 0.25 : 0;
      const tinker = mode === "working" ? Math.sin(t * 3 + f.side) * 0.25 : 0;
      const gesture = mode === "idle" || mode === "staring" ? Math.sin(t * 0.9 + f.side * 2 + phase) * 0.12 : 0;
      const bump = f.side > 0 ? st.bump : 0;
      const reach = st.arms * (1 + tinker + gesture) * (1 - bump);
      if (reach > 0.01) {
        turn(space, leg[0]!.bone, r1.setFromAxisAngle(X, -reach));
        if (leg[1]) turn(space, leg[1].bone, r1.setFromAxisAngle(X, reach * 0.55 - tap));
        if (leg[2] && mode === "carrying") turn(space, leg[2].bone, r1.setFromAxisAngle(X, 0.6));
      }
      // Fist my bump: the left hand held up and straight out, knuckles forward, not cupped.
      if (bump > 0.01) {
        turn(space, leg[0]!.bone, r1.setFromAxisAngle(X, -1.45 * bump));
        if (leg[1]) turn(space, leg[1].bone, r1.setFromAxisAngle(X, -0.15 * bump));
        if (leg[2]) turn(space, leg[2].bone, r1.setFromAxisAngle(X, -0.35 * bump));
      }
    }
  });

  const bob = st.scuttle * Math.abs(Math.sin(t * 3.1 * Math.PI)) * 0.03 + st.tripod * Math.abs(Math.sin(t * 1.6 * Math.PI * 3)) * 0.02 + st.bounce * Math.abs(Math.sin(t * 9)) * 0.14;
  return { y: bob - st.sink * 0.1, roll: st.scuttle * Math.sin(t * 3.1 * Math.PI * 0.4) * 0.03 };
}
