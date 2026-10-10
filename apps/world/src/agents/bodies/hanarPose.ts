import { Euler, Matrix4, Quaternion, Vector3, type Bone, type Object3D } from "three";

/**
 * How a hanar moves, as plain functions over its bones so the same code drives the world and offline previews.
 * A hanar floats; its six tentacles drift as travelling waves, and the front pair work as hands: they reach out
 * and tap to type, handle things, cradle what it carries, rise to celebrate and lift in greeting.
 */

export type Chain = { bone: Bone; rest: Quaternion }[];
export type HanarMode = "idle" | "walking" | "carrying" | "typing" | "working" | "celebrating" | "slumped" | "napping" | "waiting" | "staring" | "stare";

/** The tentacles: every chain of five or more bones branching off the body, root first, with its rest pose. */
export function chainsOf(model: Object3D): Chain[] {
  const chains: Chain[] = [];
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
    if (chain.length >= 5) chains.push(chain.map((bone) => ({ bone, rest: bone.quaternion.clone() })));
  });
  return chains;
}

const v = new Vector3();
/** The two tentacles nearest the front (+Z in `space`), left (+X) first. */
export function frontPair(space: Object3D, chains: Chain[]): [number, number] {
  space.updateMatrixWorld(true);
  const inv = new Matrix4().copy(space.matrixWorld).invert();
  const at = chains.map((c, i) => {
    const tip = c[Math.min(2, c.length - 1)]!.bone;
    tip.getWorldPosition(v).applyMatrix4(inv);
    return { i, x: v.x, z: v.z };
  });
  const [a, b] = [...at].sort((p, q) => q.z - p.z);
  return a!.x >= b!.x ? [a!.i, b!.i] : [b!.i, a!.i];
}

export interface HanarState {
  amp: number;
  freq: number;
  sink: number;
  tilt: number;
  /** 0..1: how far the front pair has left the drift to do something. */
  reach: number;
}
export const hanarState = (): HanarState => ({ amp: 0.12, freq: 0.9, sink: 0, tilt: 0, reach: 0 });

const smooth = (a: number, b: number, k: number) => a + (b - a) * k;

const e = new Euler();
const q = new Quaternion();
const a = new Vector3();
const b = new Vector3();
const want = new Vector3();
const spaceQ = new Quaternion();
const parentQ = new Quaternion();
const dq = new Quaternion();

/** Turn `bone` so the segment to its child points along `dir` (in `space`), keeping its parents as they are. */
function aim(space: Object3D, bone: Bone, child: Bone, dir: [number, number, number]) {
  const inv = new Matrix4().copy(space.matrixWorld).invert();
  bone.getWorldPosition(a).applyMatrix4(inv);
  child.getWorldPosition(b).applyMatrix4(inv);
  const cur = b.sub(a).normalize();
  want.set(...dir).normalize();
  dq.setFromUnitVectors(cur, want);
  space.getWorldQuaternion(spaceQ);
  bone.parent!.getWorldQuaternion(parentQ);
  const inSpace = spaceQ.clone().invert().multiply(parentQ);
  bone.quaternion.copy(inSpace.clone().invert().multiply(dq).multiply(inSpace).multiply(bone.quaternion));
  bone.updateWorldMatrix(false, true);
}

type Dir = [number, number, number];
/** Directions for each segment of a front tentacle, root to tip, for side s (+1 left, -1 right). */
function handPose(mode: HanarMode, s: number, t: number, phase: number, n: number): Dir[] | null {
  const seg = (i: number) => i / (n - 1);
  switch (mode) {
    case "typing": {
      // Out over the desk, then the tips tap, left and right in turn.
      const tap = Math.max(0, Math.sin(t * 9 + (s > 0 ? 0 : Math.PI) + phase));
      return Array.from({ length: n }, (_, i) => {
        const f = seg(i);
        return f < 0.35 ? [0.3 * s, -0.72, 0.62] : f < 0.7 ? [0.1 * s, -0.3, 1] : [0.04 * s, -0.7 - tap * 0.7, 0.55 - tap * 0.3];
      });
    }
    case "working": {
      const lift = Math.sin(t * 2.2 + (s > 0 ? 0 : 1.6) + phase) * 0.35;
      return Array.from({ length: n }, (_, i) => {
        const f = seg(i);
        return f < 0.4 ? [0.3 * s, -0.7, 0.65] : [0.12 * s, -0.2 + lift * f, 1];
      });
    }
    case "carrying":
      // Forward and curled up underneath, a cradle.
      return Array.from({ length: n }, (_, i) => {
        const f = seg(i);
        return f < 0.4 ? [0.22 * s, -0.75, 0.6] : f < 0.7 ? [0.05 * s, -0.1, 1] : [-0.25 * s, 0.9, 0.3];
      });
    case "celebrating": {
      const wave = Math.sin(t * 6 + (s > 0 ? 0 : Math.PI)) * 0.5;
      return Array.from({ length: n }, (_, i) => {
        const f = seg(i);
        return [0.45 * s + wave * f * s, 1, 0.25 - f * 0.2];
      });
    }
    case "waiting":
      // The left one lifts in a slow hello; the right stays in the drift.
      if (s < 0) return null;
      return Array.from({ length: n }, (_, i) => {
        const f = seg(i);
        return f < 0.5 ? [0.35, 0.3, 0.9] : [0.2 + Math.sin(t * 3 + phase) * 0.45 * f, 1, 0.3];
      });
    default:
      return null;
  }
}

/**
 * Pose a hanar for one frame. `space` is the character's frame (+Z forward, +Y up), `float` the group that bobs.
 * Returns the float offset and lean to apply to that group.
 */
export function poseHanar(
  space: Object3D,
  chains: Chain[],
  front: [number, number],
  st: HanarState,
  mode: HanarMode,
  t: number,
  phase: number,
): { y: number; tilt: number } {
  const gliding = mode === "walking" || mode === "carrying";
  const hands = mode === "typing" || mode === "working" || mode === "carrying" || mode === "celebrating" || mode === "waiting";
  st.amp = smooth(st.amp, gliding ? 0.24 : mode === "celebrating" ? 0.3 : mode === "napping" ? 0.05 : mode === "slumped" ? 0.06 : 0.12, 0.05);
  st.freq = smooth(st.freq, gliding ? 1.5 : mode === "celebrating" ? 2.4 : 0.75, 0.05);
  st.sink = smooth(st.sink, mode === "napping" ? 1 : mode === "slumped" ? 0.35 : 0, 0.03);
  st.tilt = smooth(st.tilt, gliding ? 0.1 : mode === "slumped" ? 0.2 : mode === "typing" ? 0.08 : 0, 0.05);
  st.reach = smooth(st.reach, hands ? 1 : 0, 0.08);

  // The drift, on every tentacle.
  chains.forEach((chain, k) => {
    chain.forEach(({ bone, rest }, i) => {
      const along = (i + 1) / chain.length;
      const w = t * st.freq - i * 0.65 + k * 1.05 + phase;
      const amp = st.amp * (0.35 + along);
      e.set(Math.sin(w) * amp + st.sink * 0.22, Math.sin(w * 0.7 + k) * amp * 0.3, Math.cos(w) * amp * 0.6);
      bone.quaternion.copy(rest).multiply(q.setFromEuler(e));
    });
  });

  // The hands: aim the front pair from the rest pose, then blend in from the drift.
  if (st.reach > 0.01) {
    space.updateMatrixWorld(true);
    front.forEach((k, side) => {
      const chain = chains[k];
      if (!chain) return;
      const dirs = handPose(mode, side === 0 ? 1 : -1, t, phase, chain.length);
      if (!dirs) return;
      const drift = chain.map(({ bone }) => bone.quaternion.clone());
      for (const { bone, rest } of chain) bone.quaternion.copy(rest);
      chain[0]!.bone.updateWorldMatrix(true, true);
      for (let i = 0; i < chain.length - 1; i++) aim(space, chain[i]!.bone, chain[i + 1]!.bone, dirs[i]!);
      chain.forEach(({ bone }, i) => bone.quaternion.slerp(drift[i]!, 1 - st.reach));
    });
  }
  return { y: 0.18 + Math.sin(t * 1.1 + phase) * 0.06 - st.sink * 0.42, tilt: st.tilt };
}
