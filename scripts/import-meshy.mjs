/* global process, console */
/**
 * Shrinks a rigged Meshy export (or any single-character GLB) into apps/world/public/models/lib/custom.
 *
 *   node scripts/import-meshy.mjs <in.glb> <Name> [--tex 1024] [--yaw <degrees>]
 *
 * Meshy ships 4K JPEG textures and float geometry, 15+ MB a character. This resizes the textures to WebP
 * (base colour at --tex, normal and metal/rough at half that), quantizes and meshopt-compresses the geometry,
 * and drops anything unused, which lands most characters under 1 MB. --yaw turns the whole rig about Y, for
 * exports that came out facing off-axis; the world expects characters to face +Z.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const [v] = args.splice(i, 2).slice(1);
  return Number(v);
};
const tex = flag("tex", 1024);
const yaw = flag("yaw", 0);
const [input, name] = args;
if (!input || !name) throw new Error("usage: import-meshy.mjs <in.glb> <Name> [--tex 1024] [--yaw <degrees>]");

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const doc = await io.read(input);
const root = doc.getRoot();

if (yaw) {
  const h = (yaw * Math.PI) / 360;
  for (const n of root.getDefaultScene().listChildren()) {
    const [x, y, z, w] = n.getRotation();
    // q_yaw * q
    const [qx, qy, qz, qw] = [0, Math.sin(h), 0, Math.cos(h)];
    n.setRotation([qw * x + qx * w + qy * z - qz * y, qw * y - qx * z + qy * w + qz * x, qw * z + qx * y - qy * x + qz * w, qw * w - qx * x - qy * y - qz * z]);
  }
}

// Normal and metal/rough maps read fine at half the colour map's size.
const half = Math.max(256, tex / 2);
await doc.transform(
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 82, slots: /^baseColorTexture$/ }),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [half, half], quality: 82, slots: /^(?!baseColorTexture$)/ }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);

const out = path.resolve(import.meta.dirname, "../apps/world/public/models/lib/custom", `${name}.glb`);
await io.write(out, doc);
console.log(`${path.relative(process.cwd(), out)}  ${(fs.statSync(input).size / 1048576).toFixed(1)} MB -> ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
