import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Group,
  type Mesh,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PetDrive } from "./types.ts";

/*
 * Myshka is drawn procedurally. His coat is "shell fur": each furry part is one mesh holding several copies of
 * its surface, each pushed a little further out along the normals, and the outer copies keep only the texels a
 * strand-noise texture lets through. One draw call per part, alpha-tested, so it sorts like any opaque mesh.
 * Textures are painted once on canvases and geometry is built once, both cached for the module.
 */

type V3 = [number, number, number];

const TAU = Math.PI * 2;
const v3 = (a: V3) => new Vector3(a[0], a[1], a[2]);

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ---------------------------------------------------------------------------------------------------------
// Coat textures

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function texture(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Fine strokes of lighter and darker hair laid along the coat, so markings fray instead of looking painted. */
function hairs(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number) {
  const rnd = rng(seed);
  g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const len = 3 + rnd() * 9;
    g.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.12 + rnd() * 0.2})` : `rgba(20,21,24,${0.06 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y + len);
    g.stroke();
  }
}

/**
 * Draws half of a symmetric sheet into the whole, mirrored about the middle. `fromAxis`: the half starts at the
 * axis of symmetry (and is drawn on the right); otherwise it ends there (and is drawn on the left).
 */
function mirror(g: CanvasRenderingContext2D, half: HTMLCanvasElement, w: number, fromAxis: boolean) {
  g.drawImage(half, fromAxis ? w / 2 : 0, 0);
  g.save();
  g.translate(fromAxis ? w / 2 : w, 0);
  g.scale(-1, 1);
  g.drawImage(half, 0, 0);
  g.restore();
}

/** Writes a greyscale sheet into a colour sheet's alpha: how long the fur grows there (black = bare). */
function furLength(c: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const g = c.getContext("2d")!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const m = mask.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = Math.max(1, m[i]!);
  g.putImageData(img, 0, 0);
}

const SILVER = "#c9ccd0";
const INK = "#18191c";

function stroke(g: CanvasRenderingContext2D, width: number, pts: number[], color = INK) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  if (pts.length === 6) g.quadraticCurveTo(pts[2]!, pts[3]!, pts[4]!, pts[5]!);
  else if (pts.length === 8) g.bezierCurveTo(pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[6]!, pts[7]!);
  else for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.stroke();
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color = INK, rot = 0) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fill();
}

/**
 * The body's coat. Nose-to-tail runs down the sheet (chest at the top); across it, around the barrel: belly at
 * x = 0, right flank at a quarter, spine in the middle, left flank at three quarters.
 */
function bodyCoat() {
  const W = 512;
  const H = 512;
  // Half sheet: x = 0 the belly, 128 the right flank, 256 the spine.
  const [half, h] = canvas(W / 2, H);
  h.fillStyle = SILVER;
  h.fillRect(0, 0, W / 2, H);
  const belly = h.createLinearGradient(0, 0, 110, 0);
  belly.addColorStop(0, "#f2f3f4");
  belly.addColorStop(0.55, "#e2e4e7");
  belly.addColorStop(1, "rgba(201,204,208,0)");
  h.fillStyle = belly;
  h.fillRect(0, 0, 110, H);
  const chest = h.createLinearGradient(0, 0, 0, 70);
  chest.addColorStop(0, "#f2f3f4");
  chest.addColorStop(1, "rgba(242,243,244,0)");
  h.fillStyle = chest;
  h.fillRect(0, 0, W / 2, 70);

  const [ink, k] = canvas(W / 2, H);
  // Three dark stripes down the spine.
  stroke(k, 26, [256, 60, 256, 498]);
  stroke(k, 12, [226, 90, 222, 300, 228, 480]);
  // Butterfly over the shoulders.
  blob(k, 214, 120, 32, 44, INK, -0.3);
  blob(k, 216, 122, 13, 20, SILVER, -0.3);
  stroke(k, 10, [250, 92, 205, 70, 175, 100]);
  // Bars over the shoulder and ribs, running down from the spine.
  stroke(k, 15, [236, 170, 180, 168, 140, 186, 92, 206]);
  stroke(k, 13, [234, 205, 186, 205, 150, 222, 110, 242]);
  stroke(k, 10, [150, 120, 128, 140, 110, 150]);
  stroke(k, 9, [120, 100, 100, 116, 76, 128]);
  // The bullseye on the flank: a dark oyster, a silver ring, a dark ring around that.
  blob(k, 132, 338, 39, 48, INK, 0.15);
  blob(k, 128, 336, 14, 21, SILVER, 0.15);
  blob(k, 130, 340, 5, 10, INK, 0.15);
  k.strokeStyle = INK;
  k.lineWidth = 14;
  k.beginPath();
  k.ellipse(132, 340, 66, 77, 0.15, -2.3, 2.6);
  k.stroke();
  // Hip and rump bars.
  stroke(k, 14, [244, 432, 196, 440, 160, 462, 120, 490]);
  stroke(k, 12, [248, 470, 214, 480, 196, 500, 180, 512]);
  // A few spots on the belly.
  const rnd = rng(5);
  for (let i = 0; i < 14; i++) blob(k, 30 + rnd() * 60, 120 + rnd() * 340, 4 + rnd() * 5, 6 + rnd() * 6, "rgba(40,42,46,0.55)");

  h.filter = "blur(2px)";
  h.drawImage(ink, 0, 0);
  h.filter = "none";
  hairs(h, W / 2, H, 2500, 3);

  const [c, g] = canvas(W, H);
  mirror(g, half, W, false);
  hairs(g, W, H, 7000, 4);
  return texture(c);
}

/**
 * The head's coat. Face in the middle of the sheet, the back of the head at the seam, crown at the top. Its alpha
 * is the fur length: short on the face, long on the cheeks, none where the eyes and nose sit.
 */
function headCoat() {
  const W = 512;
  const H = 256;
  // Half sheet: x = 0 the middle of the face, 128 the right side of the head, 256 the back.
  const [half, h] = canvas(W / 2, H);
  h.fillStyle = SILVER;
  h.fillRect(0, 0, W / 2, H);
  const face = h.createRadialGradient(0, 175, 10, 0, 175, 95);
  face.addColorStop(0, "#f6f6f6");
  face.addColorStop(0.6, "#eef0f1");
  face.addColorStop(1, "rgba(220,223,226,0)");
  h.fillStyle = face;
  h.fillRect(0, 70, 140, 186);
  h.fillStyle = "#f1f2f3";
  h.fillRect(0, 215, W / 2, 41);
  const cheek = h.createRadialGradient(95, 160, 5, 95, 160, 60);
  cheek.addColorStop(0, "#e4e6e8");
  cheek.addColorStop(1, "rgba(228,230,232,0)");
  h.fillStyle = cheek;
  h.fillRect(30, 100, 140, 120);
  // Pale "spectacles" around the eye.
  blob(h, 34, 117, 30, 24, "#eef0f1");

  const [ink, k] = canvas(W / 2, H);
  // The M: inner strokes down to between the eyes, outer legs down to the inner corners of the eyes.
  stroke(k, 7, [3, 92, 5, 60, 6, 18]);
  stroke(k, 7, [3, 92, 14, 70, 24, 46]);
  stroke(k, 7, [24, 46, 26, 70, 22, 96]);
  stroke(k, 6, [24, 46, 30, 30, 32, 6]);
  stroke(k, 5, [16, 38, 15, 18, 14, 2]);
  // ...on over the crown and down the nape.
  stroke(k, 8, [248, 0, 247, 60, 250, 118]);
  stroke(k, 7, [232, 0, 230, 60, 232, 112]);
  stroke(k, 6, [218, 0, 212, 50, 208, 100]);
  stroke(k, 10, [190, 60, 170, 100, 150, 130]);
  // The line running back from the outer corner of the eye, and the swirls over the cheek below it.
  stroke(k, 7, [58, 118, 82, 122, 110, 120, 140, 108]);
  stroke(k, 7, [50, 146, 80, 164, 112, 162, 140, 142]);
  stroke(k, 5, [78, 182, 100, 192, 122, 190, 140, 176]);
  stroke(k, 4, [36, 98, 48, 94, 60, 104]);
  h.filter = "blur(1.5px)";
  h.drawImage(ink, 0, 0);
  h.filter = "none";
  hairs(h, W / 2, H, 1500, 7);

  const [c, g] = canvas(W, H);
  mirror(g, half, W, true);

  const [mhalf, m] = canvas(W / 2, H);
  m.fillStyle = "#b0b0b0";
  m.fillRect(0, 0, W / 2, H);
  m.filter = "blur(10px)";
  blob(m, 0, 140, 60, 80, "#555");
  blob(m, 110, 175, 70, 60, "#fff");
  blob(m, 200, 200, 70, 60, "#fff");
  m.filter = "blur(2px)";
  blob(m, 34, 117, 24, 20, "#000");
  blob(m, 0, 140, 14, 14, "#000");
  m.filter = "none";
  const [mc, mg] = canvas(W, H);
  mirror(mg, mhalf, W, true);
  furLength(c, mc);
  return texture(c);
}

/** The tail: silver with dark rings, darker over the top, and a dark tip. Root at the top of the sheet. */
function tailCoat() {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = SILVER;
  g.fillRect(0, 0, W, H);
  // u = 0.25 is the underside, 0.75 the top.
  const under = g.createLinearGradient(0, 0, W, 0);
  under.addColorStop(0, "rgba(236,238,240,0.3)");
  under.addColorStop(0.25, "rgba(240,241,242,0.85)");
  under.addColorStop(0.5, "rgba(236,238,240,0.3)");
  under.addColorStop(0.75, "rgba(90,92,96,0.25)");
  under.addColorStop(1, "rgba(236,238,240,0.3)");
  g.fillStyle = under;
  g.fillRect(0, 0, W, H);
  const [ink, k] = canvas(W, H);
  for (const r of [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.81]) {
    for (let x = 0; x < W; x += 2) {
      const u = x / W;
      const top = 0.5 + 0.5 * Math.cos((u - 0.75) * TAU);
      k.fillStyle = `rgba(24,25,28,${0.6 + 0.4 * top})`;
      k.fillRect(x, r * H + Math.sin(u * TAU * 2) * 3, 2, 20 + top * 8);
    }
  }
  k.fillStyle = INK;
  k.fillRect(0, 0.9 * H, W, 0.1 * H);
  g.filter = "blur(2px)";
  g.drawImage(ink, 0, 0);
  g.filter = "none";
  hairs(g, W, H, 7000, 9);
  return texture(c);
}

/** Legs: silver with dark bars round the front, fading behind, and white boots (hip at the top of the sheet). */
function legCoat() {
  const W = 128;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = SILVER;
  g.fillRect(0, 0, W, H);
  // u = 0 is the front of the leg, 0.5 the back.
  const back = g.createLinearGradient(0, 0, W, 0);
  back.addColorStop(0, "rgba(230,232,234,0)");
  back.addColorStop(0.5, "rgba(232,234,236,0.8)");
  back.addColorStop(1, "rgba(230,232,234,0)");
  g.fillStyle = back;
  g.fillRect(0, 0, W, H);
  const [ink, k] = canvas(W, H);
  for (const y of [0.1, 0.25, 0.4, 0.55, 0.68]) {
    for (let x = 0; x < W; x += 2) {
      const front = 0.5 + 0.5 * Math.cos((x / W) * TAU);
      if (front < 0.15) continue;
      k.fillStyle = `rgba(24,25,28,${front})`;
      k.fillRect(x, y * H + Math.sin((x / W) * TAU) * 4, 2, 14 * front + 3);
    }
  }
  g.filter = "blur(2px)";
  g.drawImage(ink, 0, 0);
  g.filter = "none";
  const boot = g.createLinearGradient(0, H * 0.72, 0, H * 0.82);
  boot.addColorStop(0, "rgba(242,243,244,0)");
  boot.addColorStop(1, "#f2f3f4");
  g.fillStyle = boot;
  g.fillRect(0, H * 0.72, W, H * 0.28);
  hairs(g, W, H, 1200, 13);
  return texture(c);
}

/** White fur for the ruff, muzzle and paws, with a little silver running through it. */
function whiteCoat() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#f1f2f2";
  g.fillRect(0, 0, 128, 128);
  const rnd = rng(17);
  for (let i = 0; i < 900; i++) {
    const v = Math.round(170 + rnd() * 70);
    g.strokeStyle = `rgba(${v},${v + 2},${v + 5},0.5)`;
    g.lineWidth = 0.8;
    const x = rnd() * 128;
    const y = rnd() * 128;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 2, y + 4 + rnd() * 10);
    g.stroke();
  }
  return texture(c);
}

/** Eyes: green, deepening to the rim, a touch of gold round a slit pupil. The iris faces u = 0.25 (+z). */
function eyeTexture() {
  const [c, g] = canvas(128, 64);
  g.fillStyle = "#3f5a22";
  g.fillRect(0, 0, 128, 64);
  const iris = g.createRadialGradient(32, 32, 2, 32, 32, 26);
  iris.addColorStop(0, "#c2c45a");
  iris.addColorStop(0.3, "#9cbb4c");
  iris.addColorStop(0.75, "#5f8f34");
  iris.addColorStop(1, "#2c4318");
  g.fillStyle = iris;
  g.beginPath();
  g.ellipse(32, 32, 27, 27, 0, 0, TAU);
  g.fill();
  const rnd = rng(23);
  for (let i = 0; i < 80; i++) {
    const a = rnd() * TAU;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? "220,214,120" : "40,70,30"},0.25)`;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    g.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24);
    g.stroke();
  }
  blob(g, 32, 32, 3.2, 17, "#050506");
  blob(g, 25, 24, 3, 2.5, "rgba(255,255,255,0.9)");
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Strand noise for the shells: fine random hairs, gathered a little into locks. */
function strandNoise() {
  const N = 128;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const rnd = rng(31);
  const lock = Array.from({ length: 32 * 32 }, () => rnd());
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = lock[(y >> 2) * 32 + (x >> 2)]!;
      const v = Math.min(1, rnd() * 0.55 + l * 0.5);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Materials

/** Turns a material into a shell-fur coat: shells grow along the normal and thin out towards the tips. */
function furry(m: MeshPhysicalMaterial, noise: CanvasTexture) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.furNoise = { value: noise };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 fur;\nattribute vec2 fuv;\nvarying float vFur;\nvarying vec2 vFuv;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFur = fur.x;\nvFuv = fuv;\ntransformed += normalize(objectNormal) * fur.y;\ntransformed.y -= fur.y * fur.x * 0.25;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D furNoise;\nvarying float vFur;\nvarying vec2 vFuv;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (vFur > 0.0) {
          float strand = texture2D(furNoise, vFuv).r;
          if (vFur > sampledDiffuseColor.a * 1.02 || strand < 0.22 + 0.72 * vFur) discard;
        }
        diffuseColor.rgb *= mix(0.5, 1.06, vFur);`,
      );
  };
  m.customProgramCacheKey = () => "myshka-fur";
  return m;
}

interface Mats {
  body: MeshPhysicalMaterial;
  head: MeshPhysicalMaterial;
  tail: MeshPhysicalMaterial;
  leg: MeshPhysicalMaterial;
  white: MeshPhysicalMaterial;
  eye: MeshPhysicalMaterial;
  detail: MeshStandardMaterial;
}

let mats: Mats | null = null;
function materials(): Mats {
  if (mats) return mats;
  const noise = strandNoise();
  const coat = (map: CanvasTexture, sheen = "#f4f6f9") =>
    furry(new MeshPhysicalMaterial({ map, roughness: 0.92, sheen: 0.8, sheenRoughness: 0.5, sheenColor: sheen }), noise);
  const eyeMap = eyeTexture();
  mats = {
    body: coat(bodyCoat()),
    head: coat(headCoat()),
    tail: coat(tailCoat()),
    leg: coat(legCoat()),
    white: coat(whiteCoat(), "#ffffff"),
    eye: new MeshPhysicalMaterial({
      map: eyeMap,
      emissiveMap: eyeMap,
      emissive: "#ffffff",
      emissiveIntensity: 0.22,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    }),
    detail: new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
  };
  return mats;
}

// ---------------------------------------------------------------------------------------------------------
// Geometry

const mtx = new Matrix4();
const quat = new Quaternion();
const euler = new Euler();

function place<G extends BufferGeometry>(g: G, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): G {
  g.applyMatrix4(mtx.compose(v3(at), quat.setFromEuler(euler.set(rot[0], rot[1], rot[2])), v3(scale)));
  return g;
}

function tint<G extends BufferGeometry>(g: G, color: string): G {
  const c = new Color(color);
  const n = g.attributes.position!.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new BufferAttribute(a, 3));
  return g;
}

/** A tapering rod from `from` along `dir`. */
function rod(from: V3, dir: V3, len: number, r: number, color: string, tip = r * 0.3) {
  const g = new CylinderGeometry(tip, r, len, 5, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), v3(dir).normalize()));
  g.translate(from[0], from[1], from[2]);
  return tint(g, color);
}

/**
 * Sphere-maps `g` as a SphereGeometry turned by `q` would be, seen from `center` through `radii`. Lets bumps
 * merged into a part (cheeks, haunches) carry on the coat of the part they grow from.
 */
function projectUV(g: BufferGeometry, center: V3, radii: V3, q: Quaternion) {
  const p = g.attributes.position!;
  const uv = g.attributes.uv!;
  const inv = q.clone().invert();
  const c = v3(center);
  const r = v3(radii);
  const d = new Vector3();
  const map = (x: Vector3): [number, number] => {
    d.copy(x).sub(c).divide(r).normalize().applyQuaternion(inv);
    return [Math.atan2(d.z, -d.x) / TAU, 1 - Math.acos(Math.max(-1, Math.min(1, d.y))) / Math.PI];
  };
  // Keep the whole bump on one side of the seam, so no triangle wraps all the way round the sheet.
  g.computeBoundingBox();
  const u0 = map(g.boundingBox!.getCenter(new Vector3()))[0];
  const x = new Vector3();
  for (let i = 0; i < p.count; i++) {
    const [u, v] = map(x.fromBufferAttribute(p, i));
    uv.setXY(i, u - Math.round(u - u0), v);
  }
  return g;
}

/** A furry part: an ellipsoid (turned by `q` to place its seam), plus bumps that wear the same coat. */
function part(radii: V3, q: Quaternion, bumps: [V3, V3][]) {
  const base = place(new SphereGeometry(1, 40, 28).applyQuaternion(q), [0, 0, 0], [0, 0, 0], radii);
  const extra = bumps.map(([at, r]) => projectUV(place(new SphereGeometry(1, 20, 14), at, [0, 0, 0], r), [0, 0, 0], radii, q));
  return mergeGeometries([base, ...extra])!;
}

/**
 * Shell fur: `n` copies of `base`, the k-th pushed out by k/(n-1) of `len`. Adds `fur` = (fraction, offset) and
 * `fuv` = the UVs scaled by `rep`, for looking up the strand noise.
 */
function shells(base: BufferGeometry, n: number, len: number, rep: [number, number]) {
  const out = new BufferGeometry();
  const count = base.attributes.position!.count;
  for (const name of Object.keys(base.attributes)) {
    const a = base.attributes[name] as BufferAttribute;
    const arr = new Float32Array(count * n * a.itemSize);
    for (let k = 0; k < n; k++) arr.set(a.array as Float32Array, k * count * a.itemSize);
    out.setAttribute(name, new BufferAttribute(arr, a.itemSize));
  }
  const fur = new Float32Array(count * n * 2);
  const fuv = new Float32Array(count * n * 2);
  const uv = base.attributes.uv!;
  for (let k = 0; k < n; k++) {
    const f = n > 1 ? k / (n - 1) : 0;
    for (let i = 0; i < count; i++) {
      const j = (k * count + i) * 2;
      fur[j] = f;
      fur[j + 1] = f * len;
      fuv[j] = uv.getX(i) * rep[0];
      fuv[j + 1] = uv.getY(i) * rep[1];
    }
  }
  out.setAttribute("fur", new BufferAttribute(fur, 2));
  out.setAttribute("fuv", new BufferAttribute(fuv, 2));
  const idx = base.index!.array;
  const index = new Uint32Array(idx.length * n);
  for (let k = 0; k < n; k++) for (let i = 0; i < idx.length; i++) index[k * idx.length + i] = idx[i]! + k * count;
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

// Mappings: the body's sphere has its poles nose and tail and its seam under the belly; the others face forward
// with the seam behind.
const qBody = new Quaternion().setFromEuler(new Euler(Math.PI / 2, Math.PI / 2, 0, "XYZ"));
const qFront = new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0));

// Proportions, in metres. He stands about half a metre to the top of his head.
const BODY: V3 = [0.125, 0.125, 0.25];
const BODY_Y = 0.3;
const HEAD: V3 = [0.104, 0.088, 0.094];
const EYE_AT: V3 = [0.042, 0.011, 0.077];
const EYE_YAW = 0.32;
const EYE: V3 = [0.027, 0.02, 0.013];
const LEG_TOP = -0.04;
const TAIL_LEN = 0.47;
const TAIL_PTS = 9;
const RINGS = 28;
const SIDES = 14;
const TAIL_SHELLS = 12;
const TAIL_FUR = 0.05;
const LID_REST = 0.14;
const HEAD_SCALE = 1.08;

interface Geoms {
  body: BufferGeometry;
  ruff: BufferGeometry;
  head: BufferGeometry;
  muzzle: BufferGeometry;
  eyes: BufferGeometry;
  lids: BufferGeometry;
  ear: BufferGeometry;
  earBack: BufferGeometry;
  face: BufferGeometry;
  leg: BufferGeometry;
  paw: BufferGeometry;
}

let geoms: Geoms | null = null;
function geometries(): Geoms {
  if (geoms) return geoms;
  // Body: a long barrel with heavy haunches and shoulders.
  const body = part(BODY, qBody, [
    [[0.068, -0.01, -0.14], [0.075, 0.105, 0.115]],
    [[-0.068, -0.01, -0.14], [0.075, 0.105, 0.115]],
    [[0.055, -0.01, 0.13], [0.07, 0.1, 0.09]],
    [[-0.055, -0.01, 0.13], [0.07, 0.1, 0.09]],
  ]);
  // The ruff: a deep bib down the chest and a collar round the throat that frames the face.
  const ruff = mergeGeometries(
    [
      place(new SphereGeometry(1, 28, 20), [0, -0.02, 0.205], [0, 0, 0], [0.095, 0.11, 0.075]),
      place(new SphereGeometry(1, 28, 20), [0, 0.045, 0.225], [-0.5, 0, 0], [0.108, 0.078, 0.088]),
      place(new SphereGeometry(1, 20, 14), [0, -0.1, 0.205], [0, 0, 0], [0.07, 0.07, 0.07]),
    ].map((p) => projectUV(p, [0, 0.02, 0.2], [0.12, 0.12, 0.1], qFront)),
  )!;
  // Head: broad, with full cheeks.
  const head = part(HEAD, qFront, [
    [[0.066, -0.03, 0.022], [0.058, 0.05, 0.056]],
    [[-0.066, -0.03, 0.022], [0.058, 0.05, 0.056]],
  ]);
  // A square muzzle: two whisker pads, a strong chin, a bridge up to the nose.
  const muzzle = mergeGeometries(
    [
      place(new SphereGeometry(1, 18, 12), [0.02, -0.034, 0.083], [0, 0, 0], [0.027, 0.021, 0.024]),
      place(new SphereGeometry(1, 18, 12), [-0.02, -0.034, 0.083], [0, 0, 0], [0.027, 0.021, 0.024]),
      place(new SphereGeometry(1, 18, 12), [0, -0.055, 0.07], [0, 0, 0], [0.026, 0.018, 0.022]),
      place(new SphereGeometry(1, 14, 10), [0, -0.008, 0.088], [0.3, 0, 0], [0.018, 0.026, 0.018]),
    ].map((p) => projectUV(p, [0, -0.035, 0.07], [0.05, 0.04, 0.04], qFront)),
  )!;
  // Eyes, turned a little outwards with the curve of the face.
  const eyeball = (x: number) => place(new SphereGeometry(1, 20, 14), [x * EYE_AT[0], EYE_AT[1], EYE_AT[2]], [0, x * EYE_YAW, 0], EYE);
  const eyes = mergeGeometries([eyeball(-1), eyeball(1)])!;
  // Upper lids hang from the top of the eye; scaling the mesh in y lowers them (calm, half-hooded at rest).
  const lid = (x: number) =>
    place(place(new SphereGeometry(1, 18, 10), [0, -1, 0]), [x * EYE_AT[0], 0, EYE_AT[2] + 0.0012], [0, x * EYE_YAW, 0], [
      EYE[0] * 1.1,
      EYE[1] * 1.05,
      EYE[2] * 1.03,
    ]);
  const lids = tint(mergeGeometries([lid(-1), lid(1)])!, "#a7abb0");
  // An ear: a tall flattened cone, pink inside, white furnishings sprouting from it, a black lynx tuft on top.
  // The back of the ear wears a plain silver patch of the head's coat (the sheet's upper right side).
  const earBack = place(new ConeGeometry(0.052, 0.12, 20, 1), [0, 0.06, 0], [0, 0, 0], [1, 1, 0.55]);
  const euv = earBack.attributes.uv!;
  for (let i = 0; i < euv.count; i++) euv.setXY(i, 0.7 + euv.getX(i) * 0.07, 0.78 + euv.getY(i) * 0.14);
  const furnish = rng(41);
  const ear = mergeGeometries([
    tint(place(new ConeGeometry(0.04, 0.095, 16, 1), [0, 0.05, 0.02], [0, 0, 0], [1, 1, 0.25]), "#d6a8a2"),
    ...Array.from({ length: 11 }, (_, i) => {
      const a = (i / 10 - 0.5) * 1.6;
      return rod([a * 0.03, 0.006 + furnish() * 0.03, 0.026], [a * 0.5, 1, 0.45], 0.034 + furnish() * 0.022, 0.0025, "#e8eaec", 0.0004);
    }),
    ...[-0.45, -0.22, 0, 0.22, 0.45].map((a) => rod([a * 0.008, 0.108, 0], [a, 1, -0.08], 0.042 - Math.abs(a) * 0.03, 0.0035, "#1e1f22", 0.0003)),
  ])!;
  // Nose, eye rims, mouth and whiskers: small things that share one vertex-coloured material.
  const face = mergeGeometries([
    tint(place(new SphereGeometry(1, 14, 10), [0, -0.008, 0.106], [0.5, 0, 0], [0.012, 0.008, 0.008]), "#c99a8d"),
    tint(place(new ConeGeometry(0.012, 0.011, 3, 1), [0, -0.013, 0.107], [Math.PI + 0.5, 0, 0], [1, 1, 0.5]), "#c4958a"),
    ...[-1, 1].map((x) =>
      tint(
        place(new TorusGeometry(1, 0.12, 6, 28), [x * EYE_AT[0], EYE_AT[1], EYE_AT[2] + 0.002], [0, x * EYE_YAW, 0], [EYE[0] * 1.02, EYE[1] * 1.02, 0.02]),
        "#1b1b1d",
      ),
    ),
    rod([0, -0.017, 0.108], [0, -1, 0.25], 0.007, 0.0008, "#3b3133", 0.0008),
    ...[-1, 1].flatMap((x) =>
      [0, 1, 2, 3, 4].map((k) => rod([x * 0.03, -0.03 - k * 0.004, 0.104], [x, 0.12 - k * 0.11, 0.35 - k * 0.04], 0.14 - k * 0.008, 0.0011, "#f6f7f8", 0.0004)),
    ),
    ...[-1, 1].flatMap((x) => [0, 1].map((k) => rod([x * (0.03 + k * 0.015), 0.04, 0.08], [x * 0.6, 1, 0.5], 0.05, 0.0009, "#f0f1f2", 0.0003))),
  ])!;
  // Legs: thick at the top, tapering to the ankle. u = 0 at the front.
  const leg = new LatheGeometry(
    [
      [0.0, -0.22],
      [0.032, -0.22],
      [0.037, -0.18],
      [0.04, -0.1],
      [0.047, -0.04],
      [0.05, 0.0],
      [0.032, 0.03],
      [0.0, 0.035],
    ].map(([r, y]) => new Vector2(r, y)),
    16,
  );
  // Paws: big round mittens with four toes and tufts between them.
  const paw = mergeGeometries(
    [
      place(new SphereGeometry(1, 20, 12), [0, -0.236, 0.01], [0, 0, 0], [0.04, 0.024, 0.047]),
      ...[-1.5, -0.5, 0.5, 1.5].map((k) =>
        place(new SphereGeometry(1, 12, 8), [k * 0.017, -0.244, 0.042 - Math.abs(k) * 0.007], [0, 0, 0], [0.014, 0.014, 0.016]),
      ),
      ...[-1, 0, 1].map((k) => place(new ConeGeometry(0.006, 0.026, 6), [k * 0.017, -0.234, 0.058], [1.2, 0, 0])),
    ].map((p) => projectUV(p, [0, -0.236, 0.02], [0.05, 0.03, 0.06], qFront)),
  )!;
  geoms = {
    body: shells(body, 8, 0.022, [3, 3]),
    ruff: shells(ruff, 12, 0.032, [3, 2]),
    head: shells(head, 9, 0.014, [4, 2]),
    muzzle: shells(muzzle, 5, 0.005, [4, 2]),
    eyes,
    lids,
    ear,
    earBack: shells(earBack, 4, 0.006, [2, 1]),
    face,
    leg: shells(leg, 6, 0.012, [1, 2]),
    paw: shells(paw, 5, 0.006, [1, 1]),
  };
  return geoms;
}

/** The tail's tube, shells and all; its positions and normals are rewritten every frame by bendTail. */
function tailGeometry() {
  const n = RINGS * (SIDES + 1);
  const base = new BufferGeometry();
  const uv = new Float32Array(n * 2);
  for (let j = 0; j < RINGS; j++) for (let i = 0; i <= SIDES; i++) uv.set([i / SIDES, 1 - j / (RINGS - 1)], (j * (SIDES + 1) + i) * 2);
  const idx: number[] = [];
  for (let j = 0; j < RINGS - 1; j++)
    for (let i = 0; i < SIDES; i++) {
      const a = j * (SIDES + 1) + i;
      const b = a + SIDES + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  base.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
  base.setAttribute("normal", new BufferAttribute(new Float32Array(n * 3), 3));
  base.setAttribute("uv", new BufferAttribute(uv, 2));
  base.setIndex(idx);
  return shells(base, TAIL_SHELLS, TAIL_FUR, [1, 2]);
}

/** Tail radius (under the fur) along its length: a plume, fullest past the middle, closing at the tip. */
const tailRadius = (s: number) => (0.026 + 0.026 * Math.sin(Math.PI * Math.min(1, s * 0.95 + 0.05))) * Math.sqrt(Math.max(0, 1 - s ** 10));

const tp = new Vector3();
const tt = new Vector3();
const tn = new Vector3();
const tb = new Vector3();
const td = new Vector3();

/** Lays the tail tube along `curve`, carrying a frame down it so the rings don't twist. */
function bendTail(geo: BufferGeometry, curve: CatmullRomCurve3) {
  const pos = geo.attributes.position as BufferAttribute;
  const nor = geo.attributes.normal as BufferAttribute;
  const per = RINGS * (SIDES + 1);
  tn.set(1, 0, 0);
  for (let j = 0; j < RINGS; j++) {
    const s = j / (RINGS - 1);
    curve.getPoint(s, tp);
    curve.getTangent(s, tt);
    tn.addScaledVector(tt, -tn.dot(tt)).normalize();
    tb.crossVectors(tt, tn);
    const r = tailRadius(s);
    // How fast the radius changes along the tail tips the normals towards (or away from) the tip.
    const slope = (tailRadius(Math.min(1, s + 0.01)) - tailRadius(Math.max(0, s - 0.01))) / (0.02 * TAIL_LEN);
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * TAU;
      td.copy(tn).multiplyScalar(Math.cos(a)).addScaledVector(tb, Math.sin(a));
      const x = tp.x + td.x * r;
      const y = tp.y + td.y * r;
      const z = tp.z + td.z * r;
      td.addScaledVector(tt, -slope).normalize();
      for (let k = 0; k < TAIL_SHELLS; k++) {
        const v = k * per + j * (SIDES + 1) + i;
        pos.setXYZ(v, x, y, z);
        nor.setXYZ(v, td.x, td.y, td.z);
      }
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

/**
 * Myshka: a grown silver classic-tabby Maine Coon. A black M on his brow, bullseyes on his flanks, a white ruff
 * like a magistrate's collar, lynx tufts on his ears and a ringed plume of a tail he carries like a banner. His
 * green eyes decided long ago that the Lattice is his, and that you may stay.
 */
export function Kitten({ drive }: { drive: React.RefObject<PetDrive> }) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const ears = useRef<(Group | null)[]>([]);
  const lids = useRef<Mesh>(null);
  const m = materials();
  const g = geometries();
  const tail = useMemo(() => {
    const points = Array.from({ length: TAIL_PTS }, (_, i) => new Vector3(0, 0, -0.22 - i * 0.05));
    return { geo: tailGeometry(), points, curve: new CatmullRomCurve3(points, false, "centripetal") };
  }, []);

  useFrame(() => {
    const d = drive.current;
    if (!d || !body.current || !head.current) return;
    const { t, mode } = d;
    const walk = mode === "walk";
    const sit = mode === "sit" || mode === "groom";
    const nap = mode === "nap";
    const s = t * 9;
    const tilt = sit ? -0.6 : 0;
    const squash = nap ? 0.8 : 1;
    const bodyY = nap ? 0.13 : sit ? 0.205 : walk ? BODY_Y + Math.abs(Math.sin(s)) * 0.014 : BODY_Y;
    body.current.position.y = bodyY;
    body.current.rotation.x = tilt;
    body.current.scale.y = squash;

    head.current.position.set(nap ? 0.03 : 0, nap ? 0.02 : sit ? 0.205 : 0.15, nap ? 0.3 : sit ? 0.27 : 0.29);
    head.current.scale.set(HEAD_SCALE, HEAD_SCALE / squash, HEAD_SCALE);
    const pitch = mode === "groom" ? 0.75 + Math.sin(t * 9) * 0.15 : nap ? 0.3 : -0.05 + Math.sin(t * 0.7) * 0.06;
    head.current.rotation.x = pitch - tilt;
    head.current.rotation.y = nap ? 0.55 : Math.sin(t * 0.45) * 0.4;
    head.current.rotation.z = nap ? 0.15 : Math.sin(t * 0.3) * 0.1;

    legs.current.forEach((leg, i) => {
      if (!leg) return;
      const front = i < 2;
      const phase = (i === 0 || i === 3 ? 0 : Math.PI) + (front ? 0 : 0.4);
      leg.rotation.x = walk ? Math.sin(s + phase) * 0.5 : nap ? (front ? -1.35 : 1.3) : sit ? (front ? -tilt : -1.25 - tilt) : 0;
    });
    ears.current.forEach((ear, i) => {
      if (!ear) return;
      // The occasional twitch.
      const twitch = Math.max(0, Math.sin(t * 0.9 + i * 2.1) - 0.97) * 20;
      ear.rotation.z = (i === 0 ? 0.2 : -0.2) + (i === 0 ? twitch : -twitch) * 0.3;
    });
    if (lids.current) {
      const blink = Math.max(0, Math.sin(t * 0.8) - 0.985) * 60;
      lids.current.scale.y = nap ? 1.05 : Math.min(1.05, LID_REST + blink);
    }

    // The tail: a chain of segments, each pitched up from straight back and yawed round to his right, laid out
    // level (so it can rest on the floor) and then turned into the body's frame.
    const seg = TAIL_LEN / (TAIL_PTS - 1);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    let px = 0;
    let py = 0.05 * cos + 0.22 * sin;
    let pz = 0.05 * sin - 0.22 * cos;
    const floor = -bodyY + 0.03;
    tail.points.forEach((p, i) => {
      const k = i / (TAIL_PTS - 1);
      if (i > 0) {
        const sway = Math.sin(t * (walk ? 4 : 1.4) - i * 0.6) * (0.03 + k * 0.14) * (nap ? 0.3 : 1);
        const up = walk ? 0.45 + 0.55 * k : sit ? -1.3 + Math.min(1, k * 2.2) * 1.3 : nap ? -0.7 + Math.min(1, k * 2.5) * 0.7 : -0.85 + 1.25 * k * k;
        const yaw = (sit ? 3.0 * Math.max(0, k - 0.1) : nap ? 3.2 * k : 0) + sway;
        px += Math.sin(yaw) * Math.cos(up) * seg;
        py = Math.max(py + Math.sin(up) * seg, floor);
        pz -= Math.cos(yaw) * Math.cos(up) * seg;
      }
      p.set(px, (py * cos + pz * sin) / squash, -py * sin + pz * cos);
    });
    bendTail(tail.geo, tail.curve);
  });

  return (
    <group>
      <group ref={body} position={[0, BODY_Y, 0]}>
        <mesh geometry={g.body} material={m.body} castShadow receiveShadow />
        <mesh geometry={g.ruff} material={m.white} castShadow />
        <mesh geometry={tail.geo} material={m.tail} castShadow frustumCulled={false} />
        {[-1, 1].flatMap((x) =>
          [1, -1].map((z) => {
            const i = (z === 1 ? 0 : 2) + (x === -1 ? 0 : 1);
            return (
              <group key={`${x}${z}`} ref={(l) => void (legs.current[i] = l)} position={[x * 0.07, LEG_TOP, z > 0 ? 0.16 : -0.15]}>
                <mesh geometry={g.leg} material={m.leg} castShadow />
                <mesh geometry={g.paw} material={m.white} castShadow />
              </group>
            );
          }),
        )}
        <group ref={head} position={[0, 0.15, 0.29]} scale={HEAD_SCALE}>
          <mesh geometry={g.head} material={m.head} castShadow />
          <mesh geometry={g.muzzle} material={m.white} />
          <mesh geometry={g.eyes} material={m.eye} />
          <mesh ref={lids} geometry={g.lids} material={m.detail} position={[0, EYE_AT[1] + EYE[1], 0]} scale={[1, LID_REST, 1]} />
          <mesh geometry={g.face} material={m.detail} />
          {[-1, 1].map((x, i) => (
            <group key={x} ref={(e) => void (ears.current[i] = e)} position={[x * 0.058, 0.064, -0.012]} rotation={[-0.12, x * 0.25, 0]}>
              <mesh geometry={g.earBack} material={m.head} castShadow />
              <mesh geometry={g.ear} material={m.detail} />
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}
