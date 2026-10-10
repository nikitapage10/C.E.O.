/* global process, console, window, URL */
/**
 * Bakes cat animation clips from other rigs onto Myshka's Meshy body, then shrinks the result like import-meshy.
 *
 *   node scripts/retarget-cat.mjs <meshy.glb> <jobs.json> <out.glb> [--port 8765]
 *
 * jobs.json lists the clips: { "name", "source" (glb/gltf/fbx, relative to the json), "clip" (index), "loop",
 * "map" ([[role, sourceBone], …]), "feet" ([sourceBone, …]), "sourceRoot", "sourceHip", "sourceHead", "start",
 * "end" }. Roles are the Meshy rig's bones, named in ROLES below. The retargeting itself runs in headless
 * Chromium (scripts/retarget/retarget.html), where three's loaders handle every format; this script serves the
 * files, collects the baked tracks and writes them into the GLB as glTF animations. Run import-meshy.mjs on
 * the output to compress it. The clip's travel per cycle, in model units, is written to each animation's extras
 * as `stride`, for the runtime to match the walk to the cat's real speed.
 */
import { Accessor, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { resample } from "@gltf-transform/functions";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args.splice(portIdx, 2)[1]) : 8765;
const [targetIn, jobsIn, outIn] = args;
if (!targetIn || !jobsIn || !outIn) throw new Error("usage: retarget-cat.mjs <meshy.glb> <jobs.json> <out.glb>");

/** Myshka's SmartRig bones by role. Sides are the cat's own: L is his left, +X when he faces +Z. */
export const ROLES = {
  root: "Bone_000",
  hips: "Bone_001",
  spine1: "Bone_003",
  spine2: "Bone_002",
  chest: "Bone_026",
  chest2: "Bone_025",
  shoulders: "Bone_024",
  neck1: "Bone_028",
  neck2: "Bone_027",
  head: "Bone_036",
  face: "Bone_035",
  jaw: "Bone_069",
  "ear:L": "Bone_062",
  "ear:R": "Bone_064",
  "frontUpper:L": "Bone_032",
  "frontElbow:L": "Bone_031",
  "frontFore:L": "Bone_050",
  "frontPaw:L": "Bone_049",
  "frontToe:L": "Bone_048",
  "frontToe2:L": "Bone_047",
  "frontUpper:R": "Bone_030",
  "frontElbow:R": "Bone_029",
  "frontFore:R": "Bone_043",
  "frontPaw:R": "Bone_042",
  "frontToe:R": "Bone_041",
  "frontToe2:R": "Bone_040",
  "hindThigh:L": "Bone_009",
  "hindShin:L": "Bone_008",
  "hindHock:L": "Bone_007",
  "hindFoot:L": "Bone_006",
  "hindToe:L": "Bone_005",
  "hindThigh:R": "Bone_015",
  "hindShin:R": "Bone_014",
  "hindHock:R": "Bone_013",
  "hindFoot:R": "Bone_012",
  "hindToe:R": "Bone_011",
  tail1: "Bone_021",
  tail2: "Bone_020",
  tail3: "Bone_019",
  tail4: "Bone_018",
  tail5: "Bone_017",
  tail6: "Bone_016",
};
/**
 * Chains whose bones are aimed along the source's: after the bind-relative turn, each of these bones is
 * swung so it points where the source's bone points. That carries a pose across rigs whose rest poses differ
 * (a crouched source onto a standing target) and is what keeps the legs under the body when he sits.
 */
const CHAINS = [
  ["hips", "spine1", "spine2", "chest", "chest2", "shoulders", "neck1", "neck2", "head"],
  ...["L", "R"].flatMap((s) => [
    [`frontUpper:${s}`, `frontElbow:${s}`, `frontFore:${s}`, `frontPaw:${s}`, `frontToe:${s}`, `frontToe2:${s}`],
    [`hindThigh:${s}`, `hindShin:${s}`, `hindHock:${s}`, `hindFoot:${s}`, `hindToe:${s}`],
  ]),
  ["tail1", "tail2", "tail3", "tail4", "tail5", "tail6"],
];
const AIM = {};
for (const chain of CHAINS) for (let i = 0; i + 1 < chain.length; i++) AIM[ROLES[chain[i]]] = ROLES[chain[i + 1]];
const MIRROR = {};
for (const [role, bone] of Object.entries(ROLES)) {
  const m = role.endsWith(":L") ? role.slice(0, -2) + ":R" : role.endsWith(":R") ? role.slice(0, -2) + ":L" : null;
  if (m) MIRROR[bone] = ROLES[m];
}

const repo = path.resolve(import.meta.dirname, "..");
const jobsDir = path.dirname(path.resolve(jobsIn));
const jobs = JSON.parse(fs.readFileSync(jobsIn, "utf8"));

// Serve the repo (for three) and the job's folder (for the models) over plain http.
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".fbx": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = url.startsWith("/src/") ? path.join(jobsDir, url.slice(5)) : url === "/target.glb" ? path.resolve(targetIn) : path.join(repo, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
try {
  for (const job of jobs) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(`[${job.name}]`, e.stack));
    const full = { ...job, target: "/target.glb", source: `/src/${job.source}`, roles: ROLES, mirror: MIRROR, aim: AIM, targetRoot: ROLES.root, targetFeet: [ROLES["frontToe2:L"], ROLES["frontToe2:R"], ROLES["hindToe:L"], ROLES["hindToe:R"]], targetHead: ROLES.head, targetHip: ROLES.hips, sideThreshold: 0.05, fps: job.fps ?? 30 };
    await page.goto(`http://127.0.0.1:${port}/scripts/retarget/retarget.html?job=${encodeURIComponent(JSON.stringify(full))}`);
    await page.waitForFunction(() => window.__result || window.__error, null, { timeout: 180000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(`${job.name}: ${err}`);
    const r = await page.evaluate(() => window.__result);
    console.log(`${job.name}: ${r.times.length} keys over ${r.times[r.times.length - 1].toFixed(2)}s, ${Object.keys(r.tracks).length} bones, stride ${r.stride.toFixed(3)}, lift ${r.lift.toFixed(3)}, scale ${r.scale.toFixed(3)}, drift ${r.drift.map((v) => v.toFixed(2))}, pose-vs-bind ${r.notes.targetPoseVsBind.toExponential(1)}${r.notes.sideFixed.length ? `, sides swapped: ${r.notes.sideFixed}` : ""}`);
    if (process.env.RETARGET_DEBUG) console.log(JSON.stringify(r.notes));
    results.push(r);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(targetIn);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
for (const a of root.listAnimations()) a.dispose();
for (const r of results) {
  const anim = doc.createAnimation(r.name).setExtras({ stride: r.stride });
  const input = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Float32Array(r.times)).setBuffer(buffer);
  for (const [name, tr] of Object.entries(r.tracks)) {
    const node = nodes.get(name);
    if (!node) throw new Error(`no node ${name}`);
    const rot = doc.createAccessor().setType(Accessor.Type.VEC4).setArray(new Float32Array(tr.q)).setBuffer(buffer);
    anim.addSampler(doc.createAnimationSampler().setInput(input).setOutput(rot).setInterpolation("LINEAR"));
    anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath("rotation").setSampler(anim.listSamplers().at(-1)));
    if (tr.p) {
      const pos = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(tr.p)).setBuffer(buffer);
      anim.addSampler(doc.createAnimationSampler().setInput(input).setOutput(pos).setInterpolation("LINEAR"));
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(anim.listSamplers().at(-1)));
    }
  }
}
await doc.transform(resample({ tolerance: 1e-4 }));
await io.write(outIn, doc);
console.log(`${outIn}: ${root.listAnimations().map((a) => a.getName()).join(", ")}`);
