/* global process, console */
/**
 * Re-skins Brogu's head before import. Meshy's auto-rig smeared his face across the chest, neck, both shoulders
 * and the left ear's root, so every ear flop, head turn or arm swing dragged one side of his face about. This
 * gives the head to the head bone alone (blending into the old weights at the neck), and the ears to the head
 * and their own bones only. The rest of the body keeps Meshy's weights.
 *
 *   node scripts/rig-brogu.mjs <meshy.glb> <out.glb>
 *   node scripts/import-meshy.mjs <out.glb> Brogu
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: rig-brogu.mjs <meshy.glb> <out.glb>");

const HEAD = "Bone_014";
/** Base to tip, his left (+X) first. */
const EARS = [
  ["Bone_029", "Bone_028", "Bone_027"],
  ["Bone_026", "Bone_025", "Bone_024"],
];
/** The skull, roughly: an ellipsoid round the head bone, in the export's units. Takes in the chin, clear of the collar. */
const SKULL = { c: [0.03, 1.47, -0.03], r: [0.32, 0.27, 0.31] };
/** A vertex is ear if Meshy gave its ear bones at least this much of it, and it's out to the side and not in front. */
const EAR_WEIGHT = 0.35;
const EAR_X = 0.2;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const skin = doc.getRoot().listSkins()[0];
const names = skin.listJoints().map((j) => j.getName());
const index = (n) => {
  const i = names.indexOf(n);
  if (i < 0) throw new Error(`no bone ${n}`);
  return i;
};
const head = index(HEAD);
const ears = EARS.map((chain) => chain.map(index));
const earBones = new Set(ears.flat());

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let face = 0;
let ear = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute("POSITION");
    const J = prim.getAttribute("JOINTS_0");
    const W = prim.getAttribute("WEIGHTS_0");
    if (!P || !J || !W) continue;
    const p = [];
    const j = [];
    const w = [];
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, p);
      J.getElement(i, j);
      W.getElement(i, w);
      const weights = new Map();
      const put = (b, x) => x > 0 && weights.set(b, (weights.get(b) ?? 0) + x);
      const dx = p[0] - SKULL.c[0];
      const side = dx >= 0 ? 0 : 1;
      let onEar = 0;
      for (let k = 0; k < 4; k++) if (ears[side].includes(j[k])) onEar += w[k];
      if (onEar >= EAR_WEIGHT && Math.abs(dx) > EAR_X && p[2] < 0.15 && p[1] > 1.25) {
        // Ear: its own chain and the head, nothing else.
        for (let k = 0; k < 4; k++) put(ears[side].includes(j[k]) ? j[k] : head, w[k]);
        ear++;
      } else {
        // Ear bones have no business anywhere else.
        for (let k = 0; k < 4; k++) put(earBones.has(j[k]) ? head : j[k], w[k]);
        const d = Math.hypot(dx / SKULL.r[0], (p[1] - SKULL.c[1]) / SKULL.r[1], (p[2] - SKULL.c[2]) / SKULL.r[2]);
        const h = 1 - smooth(0.85, 1.15, d);
        if (h > 0) {
          for (const [b, x] of weights) weights.set(b, x * (1 - h));
          put(head, h);
          face++;
        }
      }
      const top = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((s, [, x]) => s + x, 0);
      for (let k = 0; k < 4; k++) {
        j[k] = top[k]?.[0] ?? 0;
        w[k] = top[k] ? top[k][1] / sum : 0;
      }
      J.setElement(i, j);
      W.setElement(i, w);
    }
  }
}

await io.write(output, doc);
console.log(`${output}: ${face} head and ${ear} ear vertices re-skinned`);
