/* global process, console */
/**
 * Copies the library models the world uses into apps/world/public/models/lib, trimmed to what it needs.
 *
 * The library is https://github.com/nikitapage10/models (812 meshopt GLBs). Clone it next to this repo, or point
 * CEO_MODELS at a clone:
 *
 *   git clone --depth 1 https://github.com/nikitapage10/models ../models
 *   node scripts/vendor-models.mjs
 *
 * What gets copied is apps/world/library.json:
 *   models: { "<pack>/<id>": { clips?: string[] } }   clips: keep only these (omit to keep all, [] for none)
 *   anims:  { "<name>": { from: "<pack>/<id>", clips } }  just the clips, no mesh, for characters sharing a rig
 *
 * Rigged or animated models get a file each. Static props are bundled one file per pack (lib/<pack>.glb, each
 * model under a root node named by its id), so a kit's shared textures ship once. apps/world/src/fx/bundles.gen.json
 * tells the app which ids live in which bundle.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, mergeDocuments, prune, unpartition } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const library = path.resolve(process.env.CEO_MODELS ?? path.join(repo, "..", "models"));
const out = path.join(repo, "apps/world/public/models/lib");
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "apps/world/library.json"), "utf8"));

if (!fs.existsSync(path.join(library, "catalog.json"))) throw new Error(`No model library at ${library}; clone nikitapage10/models there or set CEO_MODELS.`);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

/** Disposing an animation alone leaves its samplers, and their keyframes, behind. */
function drop(anim) {
  for (const s of anim.listSamplers()) s.dispose();
  for (const c of anim.listChannels()) c.dispose();
  anim.dispose();
}

function keepClips(doc, clips) {
  if (!clips) return;
  for (const a of doc.getRoot().listAnimations()) if (!clips.includes(a.getName())) drop(a);
  const missing = clips.filter((c) => !doc.getRoot().listAnimations().some((a) => a.getName() === c));
  if (missing.length) throw new Error(`missing clips: ${missing.join(", ")}`);
}

async function write(doc, rel) {
  await doc.transform(prune({ keepLeaves: true }));
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await io.write(file, doc);
  return fs.statSync(file).size;
}

/** The node name a bundled model sits under. GLTFLoader strips "/" from names, so use "__". */
const bundleKey = (id) => id.replace(/\//g, "__");

fs.rmSync(out, { recursive: true, force: true });
let total = 0;
const bundles = new Map();
for (const [id, opts] of Object.entries(manifest.models)) {
  const doc = await io.read(path.join(library, `${id}.glb`));
  keepClips(doc, opts.clips);
  const root = doc.getRoot();
  if (!root.listSkins().length && !root.listAnimations().length) {
    const pack = id.split("/")[0];
    if (!bundles.has(pack)) bundles.set(pack, []);
    bundles.get(pack).push([id, doc]);
    continue;
  }
  const size = await write(doc, `${id}.glb`);
  total += size;
  console.log(`${id}.glb`.padEnd(48), `${(size / 1024).toFixed(0)} KB`);
}
const index = {};
for (const [pack, docs] of bundles) {
  const target = new Document();
  const scene = target.createScene(pack);
  for (const [id, doc] of docs) {
    const map = mergeDocuments(target, doc);
    const holder = target.createNode(bundleKey(id));
    for (const s of doc.getRoot().listScenes()) {
      const copy = map.get(s);
      for (const child of copy.listChildren()) holder.addChild(child);
      copy.dispose();
    }
    scene.addChild(holder);
    index[id] = pack;
  }
  await target.transform(unpartition(), dedup());
  const size = await write(target, `${pack}.glb`);
  total += size;
  console.log(`${pack}.glb (${docs.length} props)`.padEnd(48), `${(size / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(repo, "apps/world/src/fx/bundles.gen.json"), JSON.stringify(index, null, 1) + "\n");
for (const [name, opts] of Object.entries(manifest.anims ?? {})) {
  const doc = await io.read(path.join(library, `${opts.from}.glb`));
  keepClips(doc, opts.clips);
  for (const n of doc.getRoot().listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  for (const m of doc.getRoot().listMeshes()) m.dispose();
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const size = await write(doc, `anims/${name}.glb`);
  total += size;
  console.log(`anims/${name}.glb`.padEnd(48), `${(size / 1024).toFixed(0)} KB`);
}
console.log(`${(total / 1024 / 1024).toFixed(2)} MB in ${out}`);
