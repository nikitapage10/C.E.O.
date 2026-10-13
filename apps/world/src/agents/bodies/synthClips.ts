import { AnimationClip, Bone, Euler, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Object3D } from "three";

/**
 * Clips for a Mixamo-rigged character that shipped with only a walk cycle (Meshy exports). The standing pose is
 * the walk averaged over its cycle (the arm and leg swings cancel out); every other pose bends that one by aiming
 * bones in world space, so it works whatever the rig's local bone axes are.
 */

type V = [number, number, number];
/** Bone → the world direction (character space: +Y up, +Z forward, +X the character's left) it should point. */
type Aims = Record<string, V>;

// GLTFLoader drops the colon from "mixamorig:Hips" when it names nodes and tracks.
const BONE = (n: string) => `mixamorig${n}`;
const CHILD: Record<string, string> = {
  LeftArm: "LeftForeArm", LeftForeArm: "LeftHand", RightArm: "RightForeArm", RightForeArm: "RightHand",
  Spine: "Spine1", Spine1: "Spine2", Spine2: "Neck", Neck: "Head",
  LeftUpLeg: "LeftLeg", LeftLeg: "LeftFoot", RightUpLeg: "RightLeg", RightLeg: "RightFoot",
};

function bonesOf(root: Object3D) {
  const out = new Map<string, Bone>();
  root.traverse((o) => {
    if ((o as Bone).isBone) out.set(o.name, o as Bone);
  });
  return out;
}

/** The mean of each bone's rotation over the clip, and the hips' mean position. */
function averagePose(clip: AnimationClip) {
  const quats = new Map<string, Quaternion>();
  let hips: Vector3 | null = null;
  for (const t of clip.tracks) {
    const [name, prop] = t.name.split(".") as [string, string];
    const n = t.times.length;
    if (prop === "quaternion") {
      const acc = new Quaternion(0, 0, 0, 0);
      const first = new Quaternion().fromArray(t.values, 0);
      const q = new Quaternion();
      for (let i = 0; i < n; i++) {
        q.fromArray(t.values, i * 4);
        const s = q.dot(first) < 0 ? -1 : 1;
        acc.set(acc.x + q.x * s, acc.y + q.y * s, acc.z + q.z * s, acc.w + q.w * s);
      }
      quats.set(name, acc.normalize());
    } else if (prop === "position" && name === BONE("Hips")) {
      hips = new Vector3();
      for (let i = 0; i < n; i++) hips.add(new Vector3().fromArray(t.values, i * 3));
      hips.multiplyScalar(1 / n);
    }
  }
  return { quats, hips };
}

const m = new Matrix4();
const a = new Vector3();
const b = new Vector3();
const want = new Vector3();
const pq = new Quaternion();
const wq = new Quaternion();
const dq = new Quaternion();

/** Rotate `bone` so the segment to its child points along `dir` (character space), keeping the parents as they are. */
function aim(root: Object3D, bones: Map<string, Bone>, name: string, dir: V) {
  const bone = bones.get(BONE(name));
  const child = bones.get(BONE(CHILD[name]!));
  if (!bone || !child) return;
  root.updateMatrixWorld(true);
  const inv = m.copy(root.matrixWorld).invert();
  a.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inv);
  b.setFromMatrixPosition(child.matrixWorld).applyMatrix4(inv);
  const cur = b.sub(a).normalize();
  want.set(...dir).normalize();
  // The turn in character space, carried into the bone's parent space.
  dq.setFromUnitVectors(cur, want);
  root.getWorldQuaternion(pq);
  const rootInv = pq.clone().invert();
  bone.parent!.getWorldQuaternion(wq);
  const parentInChar = rootInv.clone().multiply(wq);
  const local = parentInChar.clone().invert().multiply(dq).multiply(parentInChar).multiply(bone.quaternion);
  bone.quaternion.copy(local);
}

/** Turn a bone by an angle about a character-space axis (relative to its standing pose): nods, head turns, slumps. */
type Turns = Record<string, [x: number, y: number, z: number]>;

function turn(root: Object3D, bones: Map<string, Bone>, name: string, [x, y, z]: [number, number, number]) {
  const bone = bones.get(BONE(name));
  if (!bone) return;
  root.updateMatrixWorld(true);
  root.getWorldQuaternion(pq);
  const rootInv = pq.clone().invert();
  bone.parent!.getWorldQuaternion(wq);
  const parentInChar = rootInv.multiply(wq);
  dq.setFromEuler(new Euler(x, y, z, "YXZ"));
  bone.quaternion.copy(parentInChar.clone().invert().multiply(dq).multiply(parentInChar).multiply(bone.quaternion));
}

interface Key {
  t: number;
  aims?: Aims;
  turns?: Turns;
  /** Extra hips turn (radians about X) and drop (fraction of standing hip height), for lying down. */
  lie?: number;
}

function build(root: Object3D, bones: Map<string, Bone>, base: ReturnType<typeof averagePose>, name: string, keys: Key[]) {
  const names = [...base.quats.keys()];
  const qv = new Map(names.map((n) => [n, [] as number[]]));
  const hv: number[] = [];
  for (const k of keys) {
    for (const n of names) bones.get(n)?.quaternion.copy(base.quats.get(n)!);
    const hips = bones.get(BONE("Hips"));
    if (hips && base.hips) hips.position.copy(base.hips);
    if (k.lie && hips && base.hips) {
      hips.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -k.lie * (Math.PI / 2)));
      hips.position.y = base.hips.y * (1 - 0.82 * k.lie);
    }
    for (const [bone, angles] of Object.entries(k.turns ?? {})) turn(root, bones, bone, angles);
    for (const [bone, dir] of Object.entries(k.aims ?? {})) aim(root, bones, bone, dir);
    for (const n of names) qv.get(n)!.push(...bones.get(n)!.quaternion.toArray());
    if (hips) hv.push(...hips.position.toArray());
  }
  const times = keys.map((k) => k.t);
  const tracks = [
    ...names.map((n) => new QuaternionKeyframeTrack(`${n}.quaternion`, times, qv.get(n)!)),
    ...(base.hips ? [new VectorKeyframeTrack(`${BONE("Hips")}.position`, times, hv)] : []),
  ];
  return new AnimationClip(name, keys[keys.length - 1]!.t, tracks);
}

const DOWN_L: V = [0.18, -1, 0.05];
const DOWN_R: V = [-0.18, -1, 0.05];
const REST: Aims = { LeftArm: DOWN_L, LeftForeArm: [0.1, -1, 0.25], RightArm: DOWN_R, RightForeArm: [-0.1, -1, 0.25] };

/** Idle, Type, Work, Cheer, Slump, Nap, Wait and Stare clips, from a walk cycle on a model's own skeleton. */
export function synthesizeClips(model: Object3D, walk: AnimationClip): AnimationClip[] {
  const bones = bonesOf(model);
  const base = averagePose(walk);
  const saved = new Map([...bones].map(([n, bone]) => [n, { q: bone.quaternion.clone(), p: bone.position.clone() }]));
  const look = (yaw: number, pitch = 0): Turns => ({ Neck: [pitch, yaw, 0] });
  const ARMS_FWD = (lift: number): Aims => ({
    LeftArm: [0.3, -0.6 + lift, 0.75], RightArm: [-0.3, -0.6 + lift, 0.75],
    LeftForeArm: [-0.2, 0.15 + lift, 1], RightForeArm: [0.2, 0.15 + lift, 1],
  });
  const clips = [
    build(model, bones, base, "Idle", [
      { t: 0, aims: REST, turns: look(0) },
      { t: 1.8, aims: REST, turns: { ...look(0.2, 0.04), Spine: [0.02, 0, 0] } },
      { t: 3.6, aims: REST, turns: look(0) },
    ]),
    build(model, bones, base, "Wait", [
      { t: 0, aims: REST, turns: look(-0.55) },
      { t: 1.6, aims: REST, turns: look(0.55) },
      { t: 3.2, aims: REST, turns: look(-0.55) },
    ]),
    build(model, bones, base, "Stare", [
      { t: 0, aims: REST, turns: look(0, 0.12) },
      { t: 4, aims: REST, turns: look(0, 0.15) },
    ]),
    build(model, bones, base, "Type", [0, 0.18, 0.36].map((t, i) => ({
      t,
      turns: look(0, 0.25),
      aims: {
        LeftArm: [0.25, -0.75, 0.65], RightArm: [-0.25, -0.75, 0.65],
        LeftForeArm: [-0.15, -0.05 + (i === 1 ? 0.12 : 0), 1], RightForeArm: [0.15, -0.05 + (i === 1 ? 0 : 0.12), 1],
      },
    }))),
    build(model, bones, base, "Work", [
      { t: 0, turns: { ...look(0, 0.3), Spine1: [0.08, 0, 0] }, aims: ARMS_FWD(0) },
      { t: 0.7, turns: { ...look(0, 0.35), Spine1: [0.12, 0, 0] }, aims: ARMS_FWD(0.15) },
      { t: 1.4, turns: { ...look(0, 0.3), Spine1: [0.08, 0, 0] }, aims: ARMS_FWD(0) },
    ]),
    build(model, bones, base, "Cheer", [0, 0.3, 0.6].map((t, i) => ({
      t,
      turns: { ...look(0, -0.2), Spine2: [-0.08, 0, 0] },
      aims: {
        LeftArm: [0.55, 1, 0.1], RightArm: [-0.55, 1, 0.1],
        LeftForeArm: [i === 1 ? 0.6 : 0.1, 1, 0], RightForeArm: [i === 1 ? -0.1 : -0.6, 1, 0],
      },
    }))),
    // A conductor's beat: the right hand up and forward like a baton, sweeping across the room; the left lifted to
    // hold the section. (The Skippy subminds direct their rooms with it.)
    build(model, bones, base, "Conduct", [
      { t: 0, turns: { ...look(-0.2, -0.05), Spine2: [-0.04, -0.1, 0] }, aims: { LeftArm: [0.45, -0.25, 0.6], LeftForeArm: [0.1, 0.25, 1], RightArm: [-0.55, 0.35, 0.75], RightForeArm: [-0.35, 0.55, 1] } },
      { t: 0.55, turns: { ...look(0.05, 0), Spine2: [-0.04, 0, 0] }, aims: { LeftArm: [0.45, -0.2, 0.6], LeftForeArm: [0.1, 0.3, 1], RightArm: [-0.2, 0.55, 0.8], RightForeArm: [-0.05, 0.9, 0.6] } },
      { t: 1.1, turns: { ...look(0.25, -0.05), Spine2: [-0.04, 0.1, 0] }, aims: { LeftArm: [0.45, -0.25, 0.6], LeftForeArm: [0.1, 0.25, 1], RightArm: [0.05, 0.3, 0.85], RightForeArm: [0.35, 0.45, 1] } },
      { t: 1.65, turns: { ...look(0.05, 0), Spine2: [-0.04, 0, 0] }, aims: { LeftArm: [0.45, -0.2, 0.6], LeftForeArm: [0.1, 0.3, 1], RightArm: [-0.2, 0.55, 0.8], RightForeArm: [-0.05, 0.9, 0.6] } },
      { t: 2.2, turns: { ...look(-0.2, -0.05), Spine2: [-0.04, -0.1, 0] }, aims: { LeftArm: [0.45, -0.25, 0.6], LeftForeArm: [0.1, 0.25, 1], RightArm: [-0.55, 0.35, 0.75], RightForeArm: [-0.35, 0.55, 1] } },
    ]),
    build(model, bones, base, "Slump",[0, 3].map((t, i) => ({
      t,
      turns: { Spine1: [0.3 + i * 0.03, 0, 0], Spine2: [0.25, 0, 0], Neck: [0.45, 0, 0] },
      aims: { LeftArm: [0.1, -1, 0.3], RightArm: [-0.1, -1, 0.3], LeftForeArm: [0, -1, 0.3], RightForeArm: [0, -1, 0.3] },
    }))),
    build(model, bones, base, "Nap", [
      { t: 0, lie: 1, aims: {} },
      { t: 3, lie: 1, aims: {} },
    ]),
  ];
  for (const [n, s] of saved) {
    bones.get(n)!.quaternion.copy(s.q);
    bones.get(n)!.position.copy(s.p);
  }
  return clips;
}
