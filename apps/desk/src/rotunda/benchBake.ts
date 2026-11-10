import { BufferAttribute, BufferGeometry, Matrix4, type Bone, type Object3D, type SkinnedMesh } from "three";

/**
 * The bench's figures, baked (#973). The bench (#948) was fourteen skinned clones of the members' model, each skinned
 * on the GPU and its skeleton worked out on the CPU every frame, never culled, though only its head ever moves. Here
 * the model is skinned once, on the CPU, into its standing pose (`bakePose`): a plain mesh the whole bench shares as one
 * instanced draw. What moved stays: each vertex keeps how much of it follows the head bone (`aHead`), and the vertex
 * shader turns that share about the head's pivot by each figure's own yaw (`BENCH_HEAD_GLSL`), the same sum the GPU
 * skinning made with the head bone turned and every other bone at rest, so the bench looks as it did.
 */

export interface BakedPose {
  /** The model in its pose, in the skinned mesh's own space, with `aHead` (0..1) per vertex. */
  geometry: BufferGeometry;
  /** The head bone at that pose, in the same space: its pivot and axes. */
  head: Matrix4;
}

/** Whether `o` is `head` or under it. */
const under = (o: Object3D | null, head: Object3D): boolean => {
  for (let p = o; p; p = p.parent) if (p === head) return true;
  return false;
};

/**
 * Skins `mesh` once in the pose its bones hold now (world matrices up to date), exactly as three's skinning does
 * (attached bind mode, the four influences it reads), into a plain geometry in the mesh's own space.
 */
export function bakePose(mesh: SkinnedMesh, head: Bone): BakedPose {
  const sk = mesh.skeleton;
  const g = mesh.geometry;
  const inv = mesh.matrixWorld.clone().invert();
  // Each bone's skinning matrix, as the shader takes it: bindMatrixInverse · boneWorld · boneInverse · bindMatrix.
  const mats = sk.bones.map((b, i) => new Matrix4().multiplyMatrices(inv, b.matrixWorld).multiply(sk.boneInverses[i]!).multiply(mesh.bindMatrix).elements);
  const turns = sk.bones.map((b) => under(b, head));
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const si = g.getAttribute("skinIndex");
  const sw = g.getAttribute("skinWeight");
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = nor ? new Float32Array(n * 3) : null;
  const H = new Float32Array(n);
  const e = new Float32Array(16);
  for (let k = 0; k < n; k++) {
    e.fill(0);
    let hw = 0;
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(k, j);
      if (!w) continue;
      const b = si.getComponent(k, j);
      const m = mats[b]!;
      for (let q = 0; q < 16; q++) e[q]! += w * m[q]!;
      if (turns[b]) hw += w;
    }
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    // xyz of the blended matrix times (p, 1), no divide: as `(bindMatrixInverse * skinned).xyz`.
    P[k * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    P[k * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    P[k * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    if (N && nor) {
      const a = nor.getX(k);
      const b = nor.getY(k);
      const c = nor.getZ(k);
      const nx = e[0]! * a + e[4]! * b + e[8]! * c;
      const ny = e[1]! * a + e[5]! * b + e[9]! * c;
      const nz = e[2]! * a + e[6]! * b + e[10]! * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[k * 3] = nx / l;
      N[k * 3 + 1] = ny / l;
      N[k * 3 + 2] = nz / l;
    }
    H[k] = Math.min(1, hw);
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(P, 3));
  if (N) out.setAttribute("normal", new BufferAttribute(N, 3));
  const uv = g.getAttribute("uv");
  if (uv) out.setAttribute("uv", uv.clone());
  out.setAttribute("aHead", new BufferAttribute(H, 1));
  if (g.index) out.setIndex(g.index.clone());
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { geometry: out, head: new Matrix4().multiplyMatrices(inv, head.matrixWorld) };
}

/** The head's turn on the bench: a slight nod (the bench's own 0.06 rad) and a yaw, as `Euler(NOD, yaw, 0)` in the head's frame. */
export const BENCH_NOD = 0.06;

/**
 * Where a baked vertex goes with the head turned by `yaw` (and nodded BENCH_NOD) in its own frame: the vertex shader's
 * sum (BENCH_HEAD_GLSL) on the CPU, for the tests. `p` is changed in place.
 */
export function turnHead(p: [number, number, number], aHead: number, yaw: number, head: Matrix4): [number, number, number] {
  const hi = head.clone().invert().elements;
  const h = head.elements;
  const [x, y, z] = p;
  // Into the head's frame.
  const lx = hi[0]! * x + hi[4]! * y + hi[8]! * z + hi[12]!;
  const ly = hi[1]! * x + hi[5]! * y + hi[9]! * z + hi[13]!;
  const lz = hi[2]! * x + hi[6]! * y + hi[10]! * z + hi[14]!;
  // Rx(nod) · Ry(yaw).
  const ca = Math.cos(BENCH_NOD);
  const sa = Math.sin(BENCH_NOD);
  const cb = Math.cos(yaw);
  const sb = Math.sin(yaw);
  const ry = [cb * lx + sb * lz, ly, -sb * lx + cb * lz];
  const r = [ry[0]!, ca * ry[1]! - sa * ry[2]!, sa * ry[1]! + ca * ry[2]!];
  const tx = h[0]! * r[0]! + h[4]! * r[1]! + h[8]! * r[2]! + h[12]!;
  const ty = h[1]! * r[0]! + h[5]! * r[1]! + h[9]! * r[2]! + h[13]!;
  const tz = h[2]! * r[0]! + h[6]! * r[1]! + h[10]! * r[2]! + h[14]!;
  p[0] = x + (tx - x) * aHead;
  p[1] = y + (ty - y) * aHead;
  p[2] = z + (tz - z) * aHead;
  return p;
}

/** The vertex shader's part: declarations (after `#include <common>`). */
export const BENCH_HEAD_DECL = /* glsl */ `
attribute float aHead;
attribute float aHy;
uniform mat4 uHead;
uniform mat4 uHeadInv;
mat3 benchTurn(float yaw) {
  float ca = cos(${BENCH_NOD.toFixed(3)}), sa = sin(${BENCH_NOD.toFixed(3)}), cb = cos(yaw), sb = sin(yaw);
  return mat3(1., 0., 0., 0., ca, sa, 0., -sa, ca) * mat3(cb, 0., -sb, 0., 1., 0., sb, 0., cb);
}
`;
/** After `#include <beginnormal_vertex>`: the normal turns with the head's share. */
export const BENCH_HEAD_NORMAL = /* glsl */ `
mat3 benchR = benchTurn(aHy);
objectNormal = normalize(mix(objectNormal, mat3(uHead) * benchR * mat3(uHeadInv) * objectNormal, aHead));
`;
/** After `#include <begin_vertex>`: the vertex turns with the head's share, about the head's pivot. */
export const BENCH_HEAD_GLSL = /* glsl */ `
vec3 benchL = benchR * (uHeadInv * vec4(transformed, 1.)).xyz;
transformed = mix(transformed, (uHead * vec4(benchL, 1.)).xyz, aHead);
`;
