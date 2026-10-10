/* global process, console */
/**
 * Rebuilds Tessellate's body (a Meshy export of a boxy salvage robot) for the world: a clean rigid rig and a small
 * file. It lives in public/models rather than models/lib, which scripts/vendor-models.mjs rewrites from the library.
 *
 *   node scripts/rig-tessellate.mjs <source.glb> [out.glb]
 *
 * The export's auto-rig smears the box, head and arms across each other, so it is thrown away. The robot is
 * made of separate pieces (253 of them), and each piece goes whole to one bone by where it sits: the treads, the
 * box, the neck, the head, and each arm and claw. Bones are unrotated at rest, so the world's pose code
 * (compactorPose.ts) can turn them about plain character axes (+Y up, +Z forward, +X the robot's left). Textures go
 * to 1024px WebP, geometry is quantized and meshopt-compressed.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, quantize, reorder, textureCompress, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import path from "node:path";

const [src, out = path.resolve(import.meta.dirname, "../apps/world/public/models/compactor.glb")] = process.argv.slice(2);
if (!src) throw new Error("usage: node scripts/rig-tessellate.mjs <source.glb> [out.glb]");

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const meshNode = root.listNodes().find((n) => n.getMesh());
const prim = meshNode.getMesh().listPrimitives()[0];
const pos = prim.getAttribute("POSITION");
const index = prim.getIndices().getArray();
const count = pos.getCount();

/** The bones, parent first, with where each pivots (character space, metres at the export's 1.7 m height). */
const BONES = [
  { name: "Root", parent: null, at: [0, 0, 0] },
  { name: "Body", parent: "Root", at: [0, 0.34, -0.12] },
  { name: "Neck", parent: "Body", at: [0, 1.12, -0.2] },
  { name: "Head", parent: "Neck", at: [0, 1.3, -0.1] },
  // The arms rest unevenly (the right one higher), so each pivots where it meets the box.
  { name: "ArmL", parent: "Body", at: [0.5, 0.5, 0.1] },
  { name: "HandL", parent: "ArmL", at: [0.4, 0.74, 0.42] },
  { name: "ArmR", parent: "Body", at: [-0.5, 0.62, 0.04] },
  { name: "HandR", parent: "ArmR", at: [-0.42, 0.86, 0.42] },
  { name: "TreadL", parent: "Root", at: [0.52, 0.22, -0.1] },
  { name: "TreadR", parent: "Root", at: [-0.52, 0.22, -0.1] },
];
const J = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// Pieces: the triangles' connected islands, with coincident vertices welded so seams don't split a piece.
const p = [];
const weld = new Map();
const rep = new Int32Array(count);
for (let i = 0; i < count; i++) {
  pos.getElement(i, p);
  const k = p.map((v) => Math.round(v * 1e4)).join(",");
  if (!weld.has(k)) weld.set(k, i);
  rep[i] = weld.get(k);
}
const parent = Int32Array.from({ length: count }, (_, i) => i);
const find = (x) => {
  while (parent[x] !== x) x = parent[x] = parent[parent[x]];
  return x;
};
for (let i = 0; i < index.length; i += 3) {
  const a = find(rep[index[i]]);
  parent[find(rep[index[i + 1]])] = a;
  parent[find(rep[index[i + 2]])] = a;
}
const pieces = new Map();
for (let i = 0; i < count; i++) {
  const r = find(rep[i]);
  if (!pieces.has(r)) pieces.set(r, { verts: [], min: [9, 9, 9], max: [-9, -9, -9], sum: [0, 0, 0] });
  const piece = pieces.get(r);
  piece.verts.push(i);
  pos.getElement(i, p);
  for (let a = 0; a < 3; a++) {
    piece.min[a] = Math.min(piece.min[a], p[a]);
    piece.max[a] = Math.max(piece.max[a], p[a]);
    piece.sum[a] += p[a];
  }
}

/** Which bone a piece moves with, from where it sits. */
function boneOf({ min, max, sum, verts }) {
  const [x, y, z] = sum.map((s) => s / verts.length);
  const side = x > 0 ? "L" : "R";
  // The treads and the rails along their tops (low, or as wide as a tread, or behind the shoulders).
  if (Math.abs(x) > 0.36 && (max[1] < 0.5 || max[0] - min[0] > 0.25 || z < -0.08)) return `Tread${side}`;
  if (y > 0.45 && y < 1.1 && (Math.abs(x) > 0.4 || (Math.abs(x) > 0.14 && z > 0.22))) return z > 0.38 ? `Hand${side}` : `Arm${side}`;
  if (y > 1.1 && y < 1.3 && Math.abs(x) < 0.1 && max[0] - min[0] < 0.16) return "Neck";
  if (y > 1.2) return "Head";
  return "Body";
}

const joints = new Uint8Array(count * 4);
const weights = new Float32Array(count * 4);
const tally = {};
for (const piece of pieces.values()) {
  const bone = boneOf(piece);
  tally[bone] = (tally[bone] ?? 0) + 1;
  for (const v of piece.verts) {
    joints[v * 4] = J[bone];
    weights[v * 4] = 1;
  }
}
console.log("pieces per bone", tally);

// Out with the old rig.
const oldSkin = meshNode.getSkin();
const oldJoints = oldSkin.listJoints();
const armature = meshNode.getParentNode();
meshNode.setSkin(null);
oldSkin.dispose();
for (const j of oldJoints) j.dispose();
for (const a of root.listAnimations()) a.dispose();

// In with the new.
const nodes = {};
for (const b of BONES) {
  const at = b.parent ? BONES.find((o) => o.name === b.parent).at : [0, 0, 0];
  const node = doc.createNode(b.name).setTranslation(b.at.map((v, i) => v - at[i]));
  (b.parent ? nodes[b.parent] : armature).addChild(node);
  nodes[b.name] = node;
}
const ibm = new Float32Array(BONES.length * 16);
BONES.forEach((b, i) => {
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.at[0], -b.at[1], -b.at[2], 1], i * 16);
});
const buffer = root.listBuffers()[0];
const skin = doc
  .createSkin("Compactor")
  .setSkeleton(nodes.Root)
  .setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer));
for (const b of BONES) skin.addJoint(nodes[b.name]);
meshNode.setSkin(skin);
prim.getAttribute("JOINTS_0").setArray(joints);
prim.getAttribute("WEIGHTS_0").setArray(weights);
meshNode.getMesh().setName("Compactor");

await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
await io.write(out, doc);
console.log(out);
