/* global process, console */
/**
 * Rebuilds the rigged character models in apps/world/public/models from their CC0 sources.
 *
 *   KayKit Adventurers Character Pack 1.0 (CC0, Kay Lousberg): https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
 *   RobotExpressive (CC0, Tomás Laulhé, modifications by Don McCurdy): three.js examples/models/gltf/RobotExpressive
 *
 * Usage (needs @gltf-transform/core, /functions and /extensions installed somewhere resolvable):
 *   node scripts/build-models.mjs <kaykit Characters/gltf dir> <RobotExpressive.glb> apps/world/public/models
 *
 * The KayKit characters share one skeleton, so their animations live once in kaykit-anims.glb and each
 * character file is just the mesh, skin and texture.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, resample } from "@gltf-transform/functions";
import path from "node:path";

const [kaykit, robot, out] = process.argv.slice(2);
if (!kaykit || !robot || !out) throw new Error("usage: build-models.mjs <kaykit gltf dir> <RobotExpressive.glb> <out dir>");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const CLIPS = new Set([
  "Idle", "Unarmed_Idle", "Walking_A", "Walking_C", "Running_A", "Cheer", "Interact", "Use_Item", "PickUp",
  "Sit_Chair_Idle", "Sit_Floor_Idle", "Lie_Idle", "Hit_B", "Spellcasting", "Spellcast_Long", "Throw", "Jump_Full_Short", "Block",
]);
const CHARACTERS = { Mage: "mage", Rogue: "rogue", Rogue_Hooded: "hooded", Knight: "knight", Barbarian: "barbarian" };

/** Disposing an animation alone leaves its samplers, and their keyframes, behind. */
function drop(anim) {
  const keys = new Set();
  for (const s of anim.listSamplers()) {
    keys.add(s.getInput());
    keys.add(s.getOutput());
    s.dispose();
  }
  for (const c of anim.listChannels()) c.dispose();
  anim.dispose();
  // Keyframe accessors can be shared between clips; only drop the ones nothing else uses.
  for (const k of keys) if (k && k.listParents().every((p) => p.propertyType === "Root")) k.dispose();
}

async function write(doc, file) {
  await doc.transform(dedup(), resample({ tolerance: 0.001 }), prune({ keepLeaves: true }), quantize(), prune({ keepLeaves: true }));
  await io.write(path.join(out, file), doc);
  console.log(file, doc.getRoot().listAnimations().length, "clips");
}

// The characters, without animations.
for (const [src, name] of Object.entries(CHARACTERS)) {
  const doc = await io.read(path.join(kaykit, `${src}.glb`));
  for (const a of doc.getRoot().listAnimations()) drop(a);
  await write(doc, `${name}.glb`);
}

// The shared animations, without meshes.
{
  const doc = await io.read(path.join(kaykit, "Mage.glb"));
  for (const a of doc.getRoot().listAnimations()) if (!CLIPS.has(a.getName())) drop(a);
  for (const n of doc.getRoot().listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  for (const m of doc.getRoot().listMeshes()) m.dispose();
  for (const t of doc.getRoot().listTextures()) t.dispose();
  await write(doc, "kaykit-anims.glb");
}

// The native Syntherion: the expressive robot, all of its clips.
{
  const doc = await io.read(robot);
  await write(doc, "robot.glb");
}
