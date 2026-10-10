import { CylinderGeometry, Quaternion, Vector3, type Object3D } from "three";

/** A unit-height cylinder, stretched between two points each frame to make a limb segment. */
export const SEGMENT = new CylinderGeometry(1, 1, 1, 14);

const UP = new Vector3(0, 1, 0);
const dir = new Vector3();
const q = new Quaternion();

/** Place a SEGMENT mesh so it runs from `a` to `b` with radius `r`. */
export function span(o: Object3D | null, a: Vector3, b: Vector3, r: number) {
  if (!o) return;
  dir.copy(b).sub(a);
  const len = Math.max(0.001, dir.length());
  o.position.copy(a).addScaledVector(dir, 0.5);
  q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
  o.quaternion.copy(q);
  o.scale.set(r, len, r);
}

/** Two-bone IK in a vertical plane: the knee for a hip and foot, bending outward along `out`. */
const axis = new Vector3();
const side = new Vector3();
export function knee(hip: Vector3, foot: Vector3, upper: number, lower: number, out: Vector3, target: Vector3) {
  const d = Math.max(0.001, hip.distanceTo(foot));
  const reach = Math.min(d, upper + lower - 0.001);
  const a = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  axis.copy(foot).sub(hip).normalize();
  // Bend perpendicular to the hip→foot line, toward `out`.
  side.copy(out).addScaledVector(axis, -out.dot(axis)).normalize();
  return target.copy(hip).addScaledVector(axis, a).addScaledVector(side, h);
}

export const smooth = (cur: number, to: number, k: number) => cur + (to - cur) * k;
