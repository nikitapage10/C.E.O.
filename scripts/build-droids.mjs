/* global console */
/**
 * Builds the Boiler Room's two droids from their Meshy sculpts: Drop, the astromech, and Clause, the protocol droid.
 *
 *   node scripts/build-droids.mjs
 *
 * The originals are untextured, unrigged STL meshes, kept in this repo (assets/droids/*.stl.gz) because they are not
 * in the model library (github.com/nikitapage10/models). The GLBs go to apps/world/public/models/droids, outside
 * public/models/lib, which scripts/vendor-models.mjs empties and refills from the library on every run.
 *
 * Each sculpt is one solid piece, so this cuts it into the parts the world moves (apps/world/src/agents/bodies/
 * droidPose.ts) by where each triangle sits: the astromech's dome, body and two legs; the protocol droid's head,
 * torso, arms and legs. Every part is a node at its pivot (a shoulder, a hip, the neck, the dome's seam), holding its
 * mesh in a child node so compression can't move the pivot. Empty nodes mark where the lights go (the dome's eye
 * and lamp, the droid's two eyes). Colour is painted per vertex: white and blue for the astromech, gold for the
 * protocol droid. Then the usual: quantized and meshopt-compressed, about 200 KB each.
 *
 * STL axes are Z up, facing +Y; the world's are Y up, facing +Z.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { meshopt, prune, quantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "apps/world/public/models/droids");

/** Triangles of a binary STL, as a flat array of 9 floats each. */
function readStl(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const n = buf.readUInt32LE(80);
  const p = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) p[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4);
  return p;
}

/**
 * Splits every triangle that crosses a plane (and passes `where`, given its centroid) into pieces that don't, so a
 * part cut there, or a colour that changes there, has a clean edge instead of a saw-tooth one. `side` is the
 * plane's signed distance, a linear function of the point.
 */
function cut(p, side, where = () => true) {
  const out = [];
  for (let o = 0; o < p.length; o += 9) {
    const v = [0, 1, 2].map((k) => [p[o + k * 3], p[o + k * 3 + 1], p[o + k * 3 + 2]]);
    const c = [0, 1, 2].map((a) => (v[0][a] + v[1][a] + v[2][a]) / 3);
    const d = v.map(side);
    const above = d.map((x) => x > 0);
    const n = above.filter(Boolean).length;
    if (n === 0 || n === 3 || !where(c)) {
      out.push(...v.flat());
      continue;
    }
    // Rotate so v[0] is the vertex alone on its side, keeping the winding.
    const lone = above.findIndex((a) => (n === 1 ? a : !a));
    const [i, j, k] = [lone, (lone + 1) % 3, (lone + 2) % 3];
    const at = (q, r) => {
      const t = d[q] / (d[q] - d[r]);
      return [0, 1, 2].map((a) => v[q][a] + (v[r][a] - v[q][a]) * t);
    };
    const ab = at(i, j);
    const ad = at(i, k);
    out.push(...v[i], ...ab, ...ad, ...ab, ...v[j], ...v[k], ...ab, ...v[k], ...ad);
  }
  return new Float32Array(out);
}

const hex = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));

/**
 * Builds one droid. `part(c, n)` names the part a triangle belongs to from its centroid and normal (STL units and
 * axes); `paint(part, c, n)` its colour. `pivots` are in STL units; `marks` are empty nodes, each [parent, point].
 */
function droid({ name, file, height, centre, cuts = [], parts, part, paint, pivots, marks, materials }) {
  let p = readStl(path.join(ROOT, "assets/droids", file));
  for (const [side, where] of cuts) p = cut(p, side, where);
  const tris = p.length / 9;
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let i = 2; i < p.length; i += 3) {
    zmin = Math.min(zmin, p[i]);
    zmax = Math.max(zmax, p[i]);
  }
  const s = height / (zmax - zmin);
  /** STL point to world (metres, Y up, facing +Z), centred on `centre` at the floor. */
  const world = (x, y, z) => [-(x - centre[0]) * s, (z - zmin) * s, (y - centre[1]) * s];

  // Weld, then smooth normals across edges flatter than 40 degrees.
  const ids = new Map();
  const vid = new Int32Array(tris * 3);
  for (let v = 0; v < tris * 3; v++) {
    const k = `${p[v * 3].toFixed(4)},${p[v * 3 + 1].toFixed(4)},${p[v * 3 + 2].toFixed(4)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    vid[v] = ids.get(k);
  }
  const fn = new Float32Array(tris * 3);
  const area = new Float32Array(tris);
  const centroid = new Float32Array(tris * 3);
  const faces = Array.from({ length: ids.size }, () => []);
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const e1 = [p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]];
    const e2 = [p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...c) || 1;
    fn.set([c[0] / l, c[1] / l, c[2] / l], t * 3);
    area[t] = l / 2;
    for (let a = 0; a < 3; a++) centroid[t * 3 + a] = (p[o + a] + p[o + 3 + a] + p[o + 6 + a]) / 3;
    for (let k = 0; k < 3; k++) faces[vid[t * 3 + k]].push(t);
  }
  const crease = Math.cos((40 * Math.PI) / 180);

  // Sort triangles into parts and paint them.
  const groups = new Map(parts.map((n) => [n, []]));
  for (let t = 0; t < tris; t++) {
    const c = [centroid[t * 3], centroid[t * 3 + 1], centroid[t * 3 + 2]];
    const n = [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]];
    const which = part(c, n);
    groups.get(which).push([t, hex(paint(which, c, n))]);
  }

  const doc = new Document();
  doc.createBuffer();
  const mats = Object.fromEntries(
    Object.entries(materials).map(([k, m]) => [k, doc.createMaterial(`${name}-${k}`).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(m.metal).setRoughnessFactor(m.rough)]),
  );
  const scene = doc.createScene(name);
  const root = doc.createNode(name);
  scene.addChild(root);
  const nodes = {};
  const pivotWorld = {};
  for (const [part, { at }] of Object.entries(pivots)) {
    pivotWorld[part] = world(...at);
    nodes[part] = doc.createNode(part);
  }
  for (const [part, { parent }] of Object.entries(pivots)) {
    const node = nodes[part];
    const up = parent ? pivotWorld[parent] : [0, 0, 0];
    node.setTranslation(pivotWorld[part].map((v, i) => v - up[i]));
    (parent ? nodes[parent] : root).addChild(node);
  }
  for (const [part, list] of groups) {
    if (!list.length) throw new Error(`${name}: no triangles in ${part}`);
    const pivot = pivotWorld[part];
    const verts = new Map();
    const pos = [];
    const nor = [];
    const col = [];
    const idx = [];
    for (const [t, rgb] of list) {
      const n0 = [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]];
      for (let k = 0; k < 3; k++) {
        const v = vid[t * 3 + k];
        const sum = [0, 0, 0];
        for (const f of faces[v]) {
          const d = fn[f * 3] * n0[0] + fn[f * 3 + 1] * n0[1] + fn[f * 3 + 2] * n0[2];
          if (d < crease) continue;
          for (let a = 0; a < 3; a++) sum[a] += fn[f * 3 + a] * area[f];
        }
        const l = Math.hypot(...sum) || 1;
        const n = [-sum[0] / l, sum[2] / l, sum[1] / l];
        const key = `${v}|${n.map((x) => x.toFixed(2)).join(",")}|${rgb.join(",")}`;
        let i = verts.get(key);
        if (i === undefined) {
          i = verts.size;
          verts.set(key, i);
          const o = (t * 3 + k) * 3;
          const w = world(p[o], p[o + 1], p[o + 2]);
          pos.push(w[0] - pivot[0], w[1] - pivot[1], w[2] - pivot[2]);
          nor.push(...n);
          col.push(...rgb);
        }
        idx.push(i);
      }
    }
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(nor)))
      .setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(new Float32Array(col)))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)))
      .setMaterial(mats[materials[part] ? part : "default"]);
    const holder = doc.createNode(`${part}_mesh`).setMesh(doc.createMesh(part).addPrimitive(prim));
    nodes[part].addChild(holder);
  }
  for (const [mark, [parent, at]] of Object.entries(marks)) {
    const w = world(...at);
    const up = pivotWorld[parent];
    nodes[parent].addChild(doc.createNode(mark).setTranslation(w.map((v, i) => v - up[i])));
  }
  return doc;
}

/** A level cut at height z (STL units). */
const level = (z) => (v) => v[2] - z;
/** A vertical cut through the STL's Z axis along the direction `a` radians round from the front (+Y). */
const meridian = (a) => (v) => v[0] * Math.cos(a) - v[1] * Math.sin(a);
/** Only on the half of the droid that faces direction `a`. */
const facing = (a) => (c) => c[0] * Math.sin(a) + c[1] * Math.cos(a) > 0;

/** Highest STL y (the front) of a sculpt near (x, z), plus `out`: where a light sits on the surface. */
function front(file, x, z, r, out) {
  const p = readStl(path.join(ROOT, "assets/droids", file));
  let best = -Infinity;
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - x) < r && Math.abs(p[i + 2] - z) < r) best = Math.max(best, p[i + 1]);
  return [x, best + out, z];
}

// Drop, the astromech: 50 STL units tall, facing +Y. Legs hang off the sides past |x| 11.2; below z 8.5 there is
// only feet; the dome sits on the groove at z 37.5. The shoulder hubs are at z 31.6.
const ASTRO = "astromech.stl.gz";
const DOME = 37.5;
const astromech = droid({
  name: "astromech",
  file: ASTRO,
  height: 1.08,
  centre: [0, 0],
  // The dome's seam, and every edge where the paint changes, so the panels have straight edges.
  cuts: [
    [level(DOME), ([x]) => Math.abs(x) < 11.6],
    ...[39.5, 43.5, 45.2, 46.6, 33.6, 35.6, 15, 30, 10.5, 12.5, 8.5].map((z) => [level(z)]),
    ...Array.from({ length: 16 }, (_, k) => k * (Math.PI / 8) - Math.PI).map((a) => [meridian(a), (c) => facing(a)(c) && c[2] > 39 && c[2] < 44]),
    ...Array.from({ length: 6 }, (_, k) => -0.85 + k * 0.34).map((a) => [meridian(a), (c) => facing(a)(c) && c[2] > 14.5 && c[2] < 30.5]),
    ...[-1.1, 1.1].map((a) => [meridian(a), (c) => facing(a)(c) && c[2] > 10 && c[2] < 13]),
  ],
  parts: ["body", "dome", "legL", "legR"],
  part: ([x, , z]) => (z < 8.5 || (Math.abs(x) > 11.2 && z < DOME - 1) ? (x < 0 ? "legL" : "legR") : z > DOME && Math.abs(x) < 11.6 ? "dome" : "body"),
  paint: (part, [x, y, z], [nx]) => {
    const blue = "#2f5fc4";
    const angle = Math.atan2(x, y); // 0 is straight ahead
    if (part === "dome") {
      // Two rings of panels round the dome, every other one blue, and a blue cap ring near the top.
      const sector = Math.floor((angle + Math.PI) / (Math.PI / 8));
      if (z > 39.5 && z < 43.5 && sector % 2 === 0) return blue;
      if (z > 45.2 && z < 46.6) return blue;
      return "#c7ccd4";
    }
    if (part === "body") {
      if (z > 33.6 && z < 35.6) return blue; // the collar under the dome
      // Front: two columns of blue panels, and a blue vent band low down.
      if (Math.abs(angle) < 0.85 && z > 15 && z < 30 && Math.floor((angle + 0.85) / 0.34) % 2 === 1) return blue;
      if (Math.abs(angle) < 1.1 && z > 10.5 && z < 12.5) return blue;
      // Back: a hatch of three blue slats, so it reads from behind too.
      if (Math.abs(angle) > Math.PI - 0.6 && z > 18 && z < 27 && Math.floor((angle + 2 * Math.PI) / 0.3) % 2 === 0) return blue;
      return "#eef0f3";
    }
    // Legs: a blue shoulder hub on the outside, grey feet, white struts.
    if (z < 8.5) return "#9aa1aa";
    if (Math.abs(nx) > 0.7 && Math.hypot(y, z - 31.6) < 4.2) return blue;
    if (z > 12 && z < 26 && Math.abs(nx) > 0.7) return "#d9dde3";
    return "#eef0f3";
  },
  pivots: {
    body: { at: [0, 0, 31.6] },
    dome: { at: [0, 0, DOME], parent: "body" },
    legL: { at: [-14, 0, 31.6] },
    legR: { at: [14, 0, 31.6] },
  },
  marks: {
    // The big radar eye up front, and the round lamp (the holo-lens) beside and below it.
    eye: ["dome", front(ASTRO, -0.6, 44.6, 1.2, 0.2)],
    lamp: ["dome", front(ASTRO, 3.9, 40.4, 0.9, 0.2)],
    // Where the third leg comes down from: the middle of the body's underside.
    hatch: ["body", [0, 0, 8.6]],
  },
  materials: { default: { metal: 0.12, rough: 0.42 }, dome: { metal: 0.65, rough: 0.3 } },
});

// Clause, the protocol droid: 50 STL units tall, facing +Y, its right hand (+x) on its hip and its left hanging.
const PROTO = "protocol-droid.stl.gz";
const NECK = 42.6;
const HIP = 20.5;
const protocol = droid({
  name: "protocol",
  file: PROTO,
  height: 1.72,
  centre: [-0.6, 0],
  cuts: [
    ...[NECK, HIP, 26.6, 30.2, 10.8, 13.4, 31, 33].map((z) => [level(z)]),
    ...[-4.8, 3.6].map((x) => [(v) => v[0] - x, (c) => c[2] > 26 && c[2] < 31]),
  ],
  parts: ["torso", "head", "armL", "armR", "legL", "legR"],
  part: ([x, , z]) => {
    if (z > NECK) return "head";
    if (z < HIP) return x < -0.3 ? "legL" : "legR";
    if (z < 40.5 && x < (z < 36 ? -6.6 : -7.0) && z > 24) return "armL";
    if (z < 40.5 && x > (z < 36 ? 4.4 : 5.0) && z > 26.5) return "armR";
    return "torso";
  },
  paint: (part, [x, , z]) => {
    // Gold plate, with the bundle of wiring at the midriff and the knee and elbow joints a darker brass.
    if (part === "torso" && z > 26.6 && z < 30.2 && Math.abs(x + 0.6) < 4.2) return "#7a5c2c";
    if ((part === "legL" || part === "legR") && z > 10.8 && z < 13.4) return "#9a7428";
    if ((part === "armL" || part === "armR") && z > 31 && z < 33) return "#9a7428";
    return "#d9a63c";
  },
  pivots: {
    torso: { at: [-0.4, 0, HIP] },
    head: { at: [-0.4, 0, NECK], parent: "torso" },
    armL: { at: [-7.4, 0, 38.6], parent: "torso" },
    armR: { at: [6.4, 0, 38.6], parent: "torso" },
    legL: { at: [-3.0, 0, HIP] },
    legR: { at: [2.4, 0, HIP] },
  },
  marks: {
    eyeL: ["head", front(PROTO, -1.6, 46.4, 0.5, 0.1)],
    eyeR: ["head", front(PROTO, 0.6, 46.4, 0.5, 0.1)],
  },
  materials: { default: { metal: 0.85, rough: 0.3 } },
});

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
fs.mkdirSync(OUT, { recursive: true });
for (const [file, doc] of [["astromech.glb", astromech], ["protocol.glb", protocol]]) {
  await doc.transform(prune({ keepLeaves: true }), quantize({ quantizeNormal: 8, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const out = path.join(OUT, file);
  await io.write(out, doc);
  console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
