import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  EdgesGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  QuadraticBezierCurve3,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { comeUndone, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { groundOf, heightAt, MAP_D, MAP_W, PLACES, surfaceAt, type ModelKind, type Place, type PlaceId } from "../data/warTable.ts";

/**
 * The war table in 3D (#826; re-skinned in the Tide's look in #937).
 *
 * Nikita, 2026-11-05: "the war table itself to be bigger and take up most of the screen ... mostly physical with actual
 * 3D models of the cities and worlds ... a physical 3D model with wireframe and nano stuff overlays". And 2026-11-06,
 * with nine references: "this looks more like a fantasy world. The tide is more of like a futuristic post-apocalyptic
 * sci-fi with a little arcane world ... Still do like the table with the map ... but change some of the colors, some of
 * the feel, the look, the maps, the locations".
 *
 * So, near monochrome: black, graphite and silver-white light. An obsidian table on veined glass legs stands on a wet
 * black floor in a drift of mist; its top is a drowned world's atlas in relief (data/warTable.ts): an archipelago in
 * black water, contour lines on every slope, rivers of white light running down to the sea, storm spirals out on the
 * deep, and the Tide's corner open water in a storm's eye. The places are the Undertow's leftovers: a drowned beacon,
 * an hourglass spire in a broken ring, a drowned citadel round a stasis monolith, twin stasis monoliths with figures
 * asleep in the glass, the glass stacks, a sunken amphitheatre under a floating sphere, a drowned harbour and its
 * glass-sailed skiffs, the glass lab on its piers, and the Tide's isle, shattered rock hanging in the air, still only
 * wire until its feed is connected. Silver light threads run between the places and off the table into the dark,
 * toward a planet's limb. Over the solids, the overlays: each model's edges as silver wire that wakes under the
 * pointer, silver sigil nanites rising off the places, and the frame's edges coming undone (engine/sigils/undone.ts)
 * into silver wire and code. Gold is left to the shared site chrome.
 *
 * The camera stands still at rest (the pins over the models stay put); drag or A/D to swivel a little, W/S to lean in,
 * and opening a place eases the view toward it. Phones get fewer glyphs and threads, no shadows and 30 frames a second;
 * reduced motion holds the water, the threads and the glyphs still. Lazy loaded with three.js, never in the Desk's
 * first load.
 */

export interface PlaceState {
  /** Real data behind it: the model is lit; without, it stands dim. */
  lit: boolean;
  /** 0..1, how busy: windows, cores, figures and nanites. */
  level: number;
}

export interface WarTableOpts {
  phone: boolean;
  reduce: boolean;
  /** Where each place's pin goes, in the host's CSS pixels; called when it moves. */
  onPlace: (id: PlaceId, x: number, y: number, visible: boolean) => void;
  onHover: (id: PlaceId | null) => void;
  onPick: (id: PlaceId) => void;
}

export interface WarTable {
  setStates: (s: Partial<Record<PlaceId, PlaceState>>) => void;
  /** The place open in the panel (the view eases toward it), and how many pixels of the frame's right the panel covers. */
  setOpen: (id: PlaceId | null, coverPx: number) => void;
  setHover: (id: PlaceId | null) => void;
  dispose: () => void;
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const SILVER = new Color(0xdfe6ef);
/** The silver the wire and the nanites are drawn in, 0..1, and its bright end. */
const WIRE: [number, number, number] = [0.66, 0.72, 0.8];
const HI: [number, number, number] = [0.93, 0.96, 1.0];
const FLOOR = -6.6;

/** stone: wet basalt ruins; metal: brushed steel; glass: stasis glass; glow: cold light; figure: the sleepers; vein: the glass's smoke. */
type Mat = "stone" | "metal" | "glass" | "glow" | "figure" | "vein";
interface Part {
  geo: BufferGeometry;
  mat: Mat;
}

/** A part placed: its geometry moved into the model's space. */
function put(geo: BufferGeometry, mat: Mat, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): Part {
  const m = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  geo.applyMatrix4(m);
  return { geo, mat };
}

/** A local offset turned by ry, as put() turns a part. */
const turn = (x: number, z: number, lx: number, lz: number, ry: number): [number, number] => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)];

/** A broken basalt tower from below the water (y0) to about h, its top snapped off unevenly. */
function ruin(P: Part[], x: number, z: number, w: number, h: number, d: number, seed: number, y0 = -0.3, ry = 0) {
  const tall = h - y0;
  const g = new BoxGeometry(w, tall, d, 2, 1, 2);
  const pos = g.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < tall / 2 - 1e-4) continue;
    // A jag from where the corner sits, so the faces that share it stay closed.
    const j = Math.sin(pos.getX(i) * 91.7 + pos.getZ(i) * 47.3 + seed * 13.1) * 0.5 + 0.5;
    pos.setY(i, tall / 2 - j * Math.min(0.32, tall * 0.28));
  }
  g.computeVertexNormals();
  P.push(put(g, "stone", x, y0 + tall / 2, z, ry));
}

/** A drowned arch: two piers and the half ring over them. */
function arch(P: Part[], x: number, z: number, span: number, h: number, ry: number, y0 = -0.3) {
  for (const s of [-1, 1]) {
    const [px, pz] = turn(x, z, (s * span) / 2, 0, ry);
    P.push(put(new BoxGeometry(0.08, h - y0, 0.08), "stone", px, y0 + (h - y0) / 2, pz, ry));
  }
  P.push(put(new TorusGeometry(span / 2, 0.04, 5, 14, Math.PI), "stone", x, h, z, ry));
}

/** A sleeper: a figure standing in the glass, feet at y, about s tall. */
function figure(P: Part[], x: number, y: number, z: number, s: number, ry: number) {
  const at = (g: BufferGeometry, lx: number, ly: number, rz = 0) => {
    const [px, pz] = turn(x, z, lx * s, 0, ry);
    P.push(put(g, "figure", px, y + ly * s, pz, ry, 0, rz));
  };
  at(new SphereGeometry(0.06 * s, 10, 8), 0, 0.9);
  at(new CapsuleGeometry(0.075 * s, 0.22 * s, 3, 8), 0, 0.62);
  for (const k of [-1, 1]) {
    at(new CapsuleGeometry(0.032 * s, 0.32 * s, 3, 6), k * 0.045, 0.24, k * 0.03);
    at(new CapsuleGeometry(0.024 * s, 0.26 * s, 3, 6), k * 0.11, 0.6, k * 0.14);
  }
}

/** A stasis monolith: a slab of glass on a steel foot, smoke in it, and a sleeper inside. */
function monolith(P: Part[], x: number, z: number, w: number, h: number, d: number, ry: number, y0 = 0, sleeper = true) {
  P.push(put(new BoxGeometry(w * 1.18, 0.05, d * 1.6), "metal", x, y0 + 0.025, z, ry));
  P.push(put(new BoxGeometry(w, h, d), "glass", x, y0 + 0.05 + h / 2, z, ry));
  P.push(put(new PlaneGeometry(w * 0.9, h * 0.94), "vein", x, y0 + 0.05 + h / 2, z, ry));
  if (sleeper) figure(P, x, y0 + 0.09, z, h * 0.86, ry);
}

/** A rock shard: a rough ball, pulled long and pointed down, as the Tide's broken isles hang. */
function shard(r: number, stretch: number, rnd: () => number): BufferGeometry {
  const g = new IcosahedronGeometry(r, 0);
  const pos = g.attributes.position as BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    const f = seen.get(key) ?? 0.75 + rnd() * 0.5;
    seen.set(key, f);
    const y = pos.getY(i);
    pos.setXYZ(i, pos.getX(i) * f, y < 0 ? y * stretch * f : y * 0.55 * f, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

/** An hourglass, as a lathe: wide at both ends, a waist in the middle. */
function hourglass(r: number, h: number): BufferGeometry {
  const pts: Vector2[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const w = 0.12 + 0.88 * Math.pow(Math.abs(t - 0.5) * 2, 1.6);
    pts.push(new Vector2(r * w, -h / 2 + t * h));
  }
  return new LatheGeometry(pts, 16);
}

/** The miniatures, built in place-local space, standing on y = 0 (the sea is at the place's -ground). */
function modelOf(kind: ModelKind, rnd: () => number): Part[] {
  const P: Part[] = [];
  switch (kind) {
    case "beacon": {
      // A drowned beacon: a crystal spire on a basalt crag, the walls of its keepers' houses broken round it.
      P.push(put(new CylinderGeometry(0.42, 0.58, 0.3, 7), "stone", 0, 0.1, 0));
      ruin(P, 0.42, 0.22, 0.14, 0.5, 0.12, 1, 0);
      ruin(P, -0.4, 0.28, 0.12, 0.38, 0.16, 2, 0);
      ruin(P, 0.12, -0.46, 0.18, 0.32, 0.1, 3, 0);
      P.push(put(new CylinderGeometry(0.21, 0.23, 0.05, 6), "metal", 0, 0.28, 0));
      P.push(put(new CylinderGeometry(0.1, 0.19, 1.45, 6), "glass", 0, 1.0, 0));
      P.push(put(new PlaneGeometry(0.26, 1.3), "vein", 0, 0.98, 0, 0.5));
      P.push(put(new CylinderGeometry(0.04, 0.04, 1.2, 8), "glow", 0, 0.92, 0));
      P.push(put(new CylinderGeometry(0.13, 0.13, 0.035, 6), "metal", 0, 1.22, 0));
      P.push(put(new ConeGeometry(0.1, 0.32, 6), "glass", 0, 1.88, 0));
      break;
    }
    case "hourglass": {
      // The Book of Hours: an hourglass held in a glass tube, a broken ring of pillars round it, the town's stumps beyond.
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        if (k === 4) continue;
        ruin(P, Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.08, 0.2 + rnd() * 0.4, 0.08, k, -0.05, -a);
      }
      P.push(put(new CylinderGeometry(0.24, 0.24, 0.07, 20), "metal", 0, 0.035, 0));
      P.push(put(new CylinderGeometry(0.17, 0.17, 1.1, 20), "glass", 0, 0.62, 0));
      P.push(put(hourglass(0.15, 0.98), "glow", 0, 0.62, 0));
      P.push(put(new CylinderGeometry(0.21, 0.21, 0.06, 20), "metal", 0, 1.2, 0));
      P.push(put(new ConeGeometry(0.06, 0.2, 6), "metal", 0, 1.33, 0));
      const spots: [number, number][] = [
        [-0.95, 0.35],
        [-0.85, -0.4],
        [0.95, 0.3],
        [0.9, -0.42],
        [0.05, 0.95],
        [-0.4, -0.9],
      ];
      for (const [i, [x, z]] of spots.entries()) ruin(P, x, z, 0.16 + rnd() * 0.08, 0.18 + rnd() * 0.24, 0.14 + rnd() * 0.06, 10 + i, -0.05, rnd() * 3);
      break;
    }
    case "citadel": {
      // The drowned citadel: snapped basalt towers and arches standing out of the water round a stasis monolith.
      const R = 0.62;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const h = 0.55 + rnd() * 0.7;
        ruin(P, Math.cos(a) * R, Math.sin(a) * R, 0.17, h, 0.17, 20 + k, -0.3, -a);
        // A lit slit window high on each tower, toward the middle.
        P.push(put(new BoxGeometry(0.035, 0.12, 0.01), "glow", Math.cos(a) * (R - 0.09), h * 0.62, Math.sin(a) * (R - 0.09), Math.PI / 2 - a));
        if (k % 2 === 0) {
          const b = a + Math.PI / 6;
          arch(P, Math.cos(b) * R * 0.98, Math.sin(b) * R * 0.98, 0.3, 0.32 + rnd() * 0.12, Math.PI / 2 - b);
        }
      }
      monolith(P, 0, 0, 0.32, 1.2, 0.14, 0.4, -0.02);
      for (let k = 0; k < 7; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.3 + rnd() * 0.55;
        P.push(put(new BoxGeometry(0.08 + rnd() * 0.1, 0.12, 0.07 + rnd() * 0.08), "stone", Math.cos(a) * r, 0.0, Math.sin(a) * r, rnd() * 3, rnd() * 0.5, rnd() * 0.5));
      }
      break;
    }
    case "monoliths": {
      // Bonds: two stasis monoliths turned toward each other, a thread of light strung between the sleepers.
      monolith(P, -0.48, 0, 0.3, 1.05, 0.11, 0.42, 0.04);
      monolith(P, 0.48, 0, 0.3, 1.22, 0.11, -0.42, 0.04);
      const arc = new QuadraticBezierCurve3(new Vector3(-0.42, 0.95, 0), new Vector3(0, 1.45, 0.05), new Vector3(0.42, 1.08, 0));
      P.push({ geo: new TubeGeometry(arc, 24, 0.012, 5), mat: "glow" });
      ruin(P, 0.15, -0.55, 0.12, 0.22, 0.1, 31, 0);
      ruin(P, -0.2, 0.6, 0.1, 0.16, 0.14, 32, 0);
      break;
    }
    case "stacks": {
      // Past days: glass shelves on a steel frame, a veined glass leaf standing on them for every day on file.
      P.push(put(new BoxGeometry(1.3, 0.14, 0.56), "stone", 0, 0.05, 0));
      for (const [x, z] of [
        [-0.6, -0.2],
        [0.6, -0.2],
        [-0.6, 0.2],
        [0.6, 0.2],
      ] as const)
        P.push(put(new BoxGeometry(0.025, 0.95, 0.025), "metal", x, 0.6, z));
      for (const y of [0.16, 0.46, 0.76, 1.06]) P.push(put(new BoxGeometry(1.26, 0.022, 0.46), "glass", 0, y, 0));
      for (const y of [0.16, 0.46, 0.76]) {
        let x = -0.54;
        while (x < 0.5) {
          const hh = 0.14 + rnd() * 0.12;
          const dd = 0.22 + rnd() * 0.14;
          P.push(put(new BoxGeometry(0.03, hh, dd), "glass", x, y + 0.012 + hh / 2, 0));
          P.push(put(new PlaneGeometry(dd * 0.9, hh * 0.9), "vein", x, y + 0.012 + hh / 2, 0, Math.PI / 2));
          x += 0.08 + rnd() * 0.07;
        }
      }
      break;
    }
    case "amphitheatre": {
      // The week told: a sunken ring of steps, a curtain of veined glass panels, and a sphere hung over the stage.
      const prof = [
        [0.24, -0.12],
        [0.24, -0.06],
        [0.36, -0.06],
        [0.36, 0.0],
        [0.48, 0.0],
        [0.48, 0.07],
        [0.6, 0.07],
        [0.6, 0.15],
        [0.72, 0.15],
        [0.72, -0.12],
      ]
        .reverse()
        .map(([r, y]) => new Vector2(r!, y!));
      P.push(put(new LatheGeometry(prof, 28, Math.PI / 2, Math.PI), "stone"));
      P.push(put(new CylinderGeometry(0.24, 0.24, 0.02, 24), "glow", 0, -0.08, 0));
      for (let k = 0; k < 5; k++) {
        const a = Math.PI * (0.18 + (k / 4) * 0.64);
        const h = 0.42 + (k % 2) * 0.16 + (k === 2 ? 0.14 : 0);
        P.push(put(new BoxGeometry(0.16, h, 0.025), "glass", Math.cos(a) * 0.82, 0.15 + h / 2, -Math.sin(a) * 0.82, Math.PI / 2 - a));
        P.push(put(new PlaneGeometry(0.14, h * 0.92), "vein", Math.cos(a) * 0.82, 0.15 + h / 2, -Math.sin(a) * 0.82, Math.PI / 2 - a));
      }
      P.push(put(new SphereGeometry(0.15, 20, 14), "glass", 0, 0.72, 0));
      P.push(put(new SphereGeometry(0.05, 10, 8), "glow", 0, 0.72, 0));
      P.push(put(new TorusGeometry(0.3, 0.006, 4, 56), "metal", 0, 0.72, 0, 0.3, Math.PI / 2 - 0.35));
      break;
    }
    case "harbour": {
      // What shipped: a drowned quay, its arches under the waterline, and a signal tower still lit.
      P.push(put(new BoxGeometry(1.25, 0.38, 0.3), "stone", 0, -0.1, -0.1));
      P.push(put(new BoxGeometry(0.15, 0.32, 0.95), "stone", 0.45, -0.13, -0.6));
      arch(P, -0.3, 0.2, 0.3, 0.3, 0);
      arch(P, 0.12, 0.24, 0.26, 0.24, 0);
      ruin(P, 0.38, 0.22, 0.14, 0.42, 0.14, 41);
      ruin(P, -0.62, -0.12, 0.15, 0.62, 0.15, 42);
      P.push(put(new CylinderGeometry(0.05, 0.05, 0.1, 8), "glow", -0.62, 0.6, -0.12));
      P.push(put(new ConeGeometry(0.08, 0.16, 6), "glass", -0.62, 0.73, -0.12));
      break;
    }
    case "lab": {
      // How it's written: a glass lab on piers out on the water, a crystal being drawn up under a beam of light.
      for (const [x, z] of [
        [-0.4, -0.3],
        [0.4, -0.3],
        [-0.4, 0.3],
        [0.4, 0.3],
      ] as const)
        P.push(put(new CylinderGeometry(0.05, 0.065, 0.45, 8), "stone", x, -0.12, z));
      P.push(put(new BoxGeometry(1.0, 0.06, 0.78), "metal", 0, 0.12, 0));
      const [fw, fh, fd] = [0.8, 0.78, 0.6];
      const y0 = 0.15;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) P.push(put(new BoxGeometry(0.022, fh, 0.022), "metal", (sx * fw) / 2, y0 + fh / 2, (sz * fd) / 2));
      for (const y of [y0, y0 + fh]) {
        for (const sz of [-1, 1]) P.push(put(new BoxGeometry(fw, 0.022, 0.022), "metal", 0, y, (sz * fd) / 2));
        for (const sx of [-1, 1]) P.push(put(new BoxGeometry(0.022, 0.022, fd), "metal", (sx * fw) / 2, y, 0));
      }
      P.push(put(new BoxGeometry(fw, fh, fd), "glass", 0, y0 + fh / 2, 0));
      P.push(put(new BoxGeometry(0.12, 0.08, 0.12), "metal", 0, y0 + fh - 0.06, 0));
      P.push(put(new CylinderGeometry(0.006, 0.006, 0.42, 6), "glow", 0, y0 + fh - 0.32, 0));
      P.push(put(new ConeGeometry(0.17, 0.3, 6), "glass", 0, y0 + 0.17, 0));
      P.push(put(new SphereGeometry(0.06, 10, 8), "glow", 0, y0 + 0.12, 0));
      for (const [x, z, h] of [
        [0.6, 0.18, 0.5],
        [-0.62, -0.1, 0.36],
      ] as const) {
        P.push(put(new CylinderGeometry(0.07, 0.07, h, 14), "glass", x, 0.15 + h / 2, z));
        P.push(put(new CylinderGeometry(0.012, 0.012, h * 0.8, 6), "glow", x, 0.15 + h / 2, z));
        P.push(put(new CylinderGeometry(0.08, 0.08, 0.04, 14), "metal", x, 0.17 + h, z));
      }
      break;
    }
    case "ghost": {
      // The Tide's isle: rock shattered and hanging over the storm's eye, a monolith split among it. Wire only.
      P.push(put(shard(0.42, 2.2, rnd), "stone", 0.05, 0.85, 0.02));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + rnd();
        const r = 0.45 + rnd() * 0.5;
        P.push(put(shard(0.08 + rnd() * 0.14, 1.6, rnd), "stone", Math.cos(a) * r, 0.35 + rnd() * 1.1, Math.sin(a) * r, rnd() * 3));
      }
      P.push(put(new BoxGeometry(0.2, 0.55, 0.08), "glass", 0.12, 1.42, 0.05, 0.4, 0, 0.12));
      P.push(put(new BoxGeometry(0.2, 0.38, 0.08), "glass", -0.04, 1.86, 0.02, 0.4, 0, -0.2));
      break;
    }
  }
  return P;
}

/** Smoke in glass, white on black: wisps rising and a few hairline cracks (ref: the Tide's stasis monoliths). */
function veinTexture(rnd: () => number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 512);
  g.lineCap = "round";
  for (let k = 0; k < 46; k++) {
    let x = rnd() * 256;
    let y = 512 + 20;
    const drift = (rnd() - 0.5) * 3;
    g.strokeStyle = `rgba(235,242,255,${0.05 + rnd() * 0.16})`;
    g.lineWidth = 0.6 + rnd() * 2.4;
    g.shadowColor = "rgba(220,232,255,.9)";
    g.shadowBlur = 6;
    g.beginPath();
    g.moveTo(x, y);
    const ph = rnd() * 9;
    while (y > -20) {
      y -= 10;
      x += Math.sin(y * 0.03 + ph) * 4 + drift;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.shadowBlur = 0;
  for (let k = 0; k < 9; k++) {
    let x = rnd() * 256;
    let y = rnd() * 512;
    g.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.4})`;
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft drift of mist, white on clear. */
function mistTexture(rnd: () => number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 26; k++) {
    const x = 60 + rnd() * 136;
    const y = 90 + rnd() * 76;
    const r = 30 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${0.05 + rnd() * 0.07})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The links the light threads run along, place to place. */
const LINKS: [PlaceId, PlaceId][] = [
  ["today", "week"],
  ["today", "ships"],
  ["week", "day"],
  ["week", "ships"],
  ["day", "bonds"],
  ["day", "shelf"],
  ["shelf", "told"],
  ["told", "day"],
  ["how", "shelf"],
  ["how", "today"],
  ["bonds", "tide"],
];

export async function createWarTable(host: HTMLElement, canvas: HTMLCanvasElement, opts: WarTableOpts): Promise<WarTable> {
  const { reduce } = opts;
  const PH = opts.phone;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: !PH,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.5 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = !PH;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(0x030405);
  scene.fog = new FogExp2(0x040506, 0.016);
  const cam = new PerspectiveCamera(38, 1, 0.1, 320);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  let rs = 1;
  const rnd = () => {
    rs = (rs * 16807) % 2147483647;
    return (rs - 1) / 2147483646;
  };

  // ---- light: one cold lamp over the table, a pale rim from behind, almost no fill --------------------------------
  scene.add(new HemisphereLight(0x8c96a6, 0x020203, 0.42));
  const lamp = new SpotLight(0xe8f0ff, 430, 40, 0.62, 0.7, 1.4);
  lamp.position.set(-1.5, 15, 3);
  lamp.target.position.set(0, 0, 0.2);
  lamp.castShadow = !PH;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.camera.near = 6;
  lamp.shadow.camera.far = 30;
  scene.add(lamp, lamp.target);
  const rim = new DirectionalLight(0xc8d6ff, 0.5);
  rim.position.set(8, 6, -12);
  scene.add(rim);

  const veinTex = keep(veinTexture(rnd));
  const veinMat = (opacity: number) =>
    keep(
      new MeshBasicMaterial({
        map: veinTex,
        color: SILVER,
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
  const glassMat = () =>
    keep(
      new MeshStandardMaterial({
        color: 0xdfe8f2,
        roughness: 0.06,
        metalness: 0.2,
        transparent: true,
        opacity: 0.16,
        emissive: 0x1c232c,
        emissiveIntensity: 1,
        depthWrite: false,
        side: DoubleSide,
      }),
    );

  // ---- the table: an obsidian slab on veined glass legs, a silver inlay round the rim ------------------------------
  const obsidian = keep(new MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.18, metalness: 0.55 }));
  const steel = keep(
    new MeshStandardMaterial({
      color: 0xc9d0d8,
      roughness: 0.25,
      metalness: 0.9,
      emissive: 0x7c8898,
      emissiveIntensity: 0.3,
    }),
  );
  const edgeLine = keep(new LineBasicMaterial({ color: SILVER, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false }));
  const table = new Group();
  scene.add(table);
  const W2 = MAP_W / 2;
  const D2 = MAP_D / 2;
  const RIM = 0.55;
  const slabGeo = keep(new BoxGeometry(MAP_W + RIM * 2 + 0.3, 0.6, MAP_D + RIM * 2 + 0.3));
  const slab = new Mesh(slabGeo, obsidian);
  slab.position.y = -0.36;
  slab.receiveShadow = true;
  table.add(slab);
  const slabEdge = new LineSegments(keep(new EdgesGeometry(slabGeo)), edgeLine);
  slabEdge.position.y = -0.36;
  table.add(slabEdge);
  const rimH = 0.34;
  const rimPart = (w: number, d: number, x: number, z: number) => {
    const g = keep(new BoxGeometry(w, rimH, d));
    const m = new Mesh(g, obsidian);
    m.position.set(x, rimH / 2 - 0.06, z);
    m.castShadow = !PH;
    m.receiveShadow = true;
    table.add(m);
    const e = new LineSegments(keep(new EdgesGeometry(g)), edgeLine);
    e.position.copy(m.position);
    table.add(e);
    const inlay = new Mesh(keep(new BoxGeometry(w - (w > d ? RIM : 0.04) + 0.02, 0.012, d - (d > w ? RIM : 0.04) + 0.02)), steel);
    inlay.scale.set(w > d ? 1 : 0.12, 1, d > w ? 1 : 0.12);
    inlay.position.set(x, rimH - 0.054, z);
    table.add(inlay);
  };
  rimPart(MAP_W + RIM * 2, RIM, 0, -D2 - RIM / 2);
  rimPart(MAP_W + RIM * 2, RIM, 0, D2 + RIM / 2);
  rimPart(RIM, MAP_D, -W2 - RIM / 2, 0);
  rimPart(RIM, MAP_D, W2 + RIM / 2, 0);
  const legGlass = glassMat();
  legGlass.opacity = 0.2;
  const legVein = veinMat(0.5);
  const legH = -0.66 - FLOOR;
  const legGeo = keep(new BoxGeometry(1.15, legH, 1.15));
  const legs: [number, number][] = [];
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const cap = new Mesh(keep(new BoxGeometry(RIM + 0.06, 0.05, RIM + 0.06)), steel);
    cap.position.set(x * (W2 + RIM / 2), rimH - 0.03, z * (D2 + RIM / 2));
    table.add(cap);
    const lx = x * (W2 - 1.2);
    const lz = z * (D2 - 0.9);
    legs.push([lx, lz]);
    const leg = new Mesh(legGeo, legGlass);
    leg.position.set(lx, FLOOR + legH / 2, lz);
    table.add(leg);
    const smoke = new Mesh(legGeo, legVein);
    smoke.scale.setScalar(0.94);
    smoke.position.copy(leg.position);
    table.add(smoke);
    const e = new LineSegments(keep(new EdgesGeometry(legGeo)), edgeLine);
    e.position.copy(leg.position);
    table.add(e);
  }

  // ---- the floor: wet black stone, the legs' light smeared in it, mist lying on it ---------------------------------
  {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 800;
    const g = c.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, 1024, 800);
    const FW = 90;
    const FD = 70;
    const fx = (x: number) => ((x + FW / 2) / FW) * 1024;
    const fz = (z: number) => ((z + FD / 2) / FD) * 800;
    // The table's own glow, pooled under it.
    const pool = g.createRadialGradient(fx(0), fz(1), 0, fx(0), fz(1), (14 / FW) * 1024);
    pool.addColorStop(0, "rgba(150,165,185,.22)");
    pool.addColorStop(1, "rgba(150,165,185,0)");
    g.fillStyle = pool;
    g.fillRect(0, 0, 1024, 800);
    // Streaks: each lit leg reflected toward the viewer, broken by ripples.
    for (const [x, z] of legs) {
      for (let k = 0; k < 14; k++) {
        const sx = fx(x + (rnd() - 0.5) * 1.1);
        const w = 1 + rnd() * 3;
        const top = fz(z + 0.3);
        const len = (4 + rnd() * 6) * (800 / FD);
        const gr = g.createLinearGradient(0, top, 0, top + len);
        gr.addColorStop(0, `rgba(225,235,250,${0.25 + rnd() * 0.3})`);
        gr.addColorStop(1, "rgba(225,235,250,0)");
        g.fillStyle = gr;
        g.fillRect(sx, top, w, len);
      }
    }
    // Fine ripples and grit, so it reads as wet.
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(200,212,230,${rnd() * 0.12})`;
      g.fillRect(rnd() * 1024, rnd() * 800, 1 + rnd() * 6, 1);
    }
    const tex = keep(new CanvasTexture(c));
    tex.colorSpace = SRGBColorSpace;
    // The floor gives out a way past the table: beyond it, the dark, and the world's limb far below.
    const fade = document.createElement("canvas");
    fade.width = 256;
    fade.height = 200;
    const fg = fade.getContext("2d")!;
    const fr = fg.createRadialGradient(128, 100, 0, 128, 100, 128);
    fr.addColorStop(0, "#fff");
    fr.addColorStop(0.3, "#fff");
    fr.addColorStop(0.62, "#000");
    fg.fillStyle = fr;
    fg.fillRect(0, 0, 256, 200);
    const alpha = keep(new CanvasTexture(fade));
    const floor = new Mesh(
      keep(new PlaneGeometry(FW, FD)),
      keep(
        new MeshStandardMaterial({
          color: 0x050607,
          roughness: 0.2,
          metalness: 0.75,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.55,
          alphaMap: alpha,
          transparent: true,
        }),
      ),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // ---- the chart: a drowned world's atlas in relief, painted ---------------------------------------------------------
  const TW = PH ? 1024 : 2048;
  const TH = Math.round((TW * MAP_D) / MAP_W);
  const GW = 320;
  const GH = 200;
  const grid = new Float32Array((GW + 1) * (GH + 1));
  for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) grid[j * (GW + 1) + i] = heightAt(-W2 + (i / GW) * MAP_W, -D2 + (j / GH) * MAP_D);
  const hAt = (u: number, v: number) => {
    const fx = Math.max(0, Math.min(1, u)) * GW;
    const fy = Math.max(0, Math.min(1, v)) * GH;
    const i = Math.min(GW - 1, Math.floor(fx));
    const j = Math.min(GH - 1, Math.floor(fy));
    const a = fx - i;
    const b = fy - j;
    const g = (ii: number, jj: number) => grid[jj * (GW + 1) + ii]!;
    return (g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b;
  };
  await yieldNow();
  const mkCanvas = () => {
    const c = document.createElement("canvas");
    c.width = TW;
    c.height = TH;
    return [c, c.getContext("2d")!] as const;
  };
  const [paint, pg] = mkCanvas();
  const [glow, gg] = mkCanvas();
  const [rough, rg] = mkCanvas();
  const px = (x: number) => ((x + W2) / MAP_W) * TW;
  const pz = (z: number) => ((z + D2) / MAP_D) * TH;
  const S = TW / 2048;
  {
    const img = pg.createImageData(TW, TH);
    const gim = gg.createImageData(TW, TH);
    const rim2 = rg.createImageData(TW, TH);
    const d = img.data;
    const gd = gim.data;
    const rd = rim2.data;
    const du = 1 / TW;
    const dv = 1 / TH;
    // The light the relief is shaded by: from the far left, high.
    const L = new Vector3(-0.55, 0.75, -0.4).normalize();
    for (let y = 0; y < TH; y++) {
      const v = y / (TH - 1);
      for (let x = 0; x < TW; x++) {
        const u = x / (TW - 1);
        const h = hAt(u, v);
        const hx = (hAt(u + du, v) - hAt(u - du, v)) / 2;
        const hz = (hAt(u, v + dv) - hAt(u, v - dv)) / 2;
        // How much the height changes per pixel, so contour lines keep one width on any slope.
        const per = Math.max(1e-5, Math.hypot(hx, hz));
        let r: number, g: number, b: number;
        let e = 0;
        let ro = 22;
        if (h < 0) {
          const k = Math.min(1, -h * 2.2);
          r = 17 + (4 - 17) * k;
          g = 20 + (5 - 20) * k;
          b = 24 + (7 - 24) * k;
          // Drowned contours: the old land's lines, faint under the water.
          const f = -h * 10;
          const dist = (0.5 - Math.abs((f % 1) - 0.5)) / (per * 10);
          if (-h < 0.6 && dist < 0.7) {
            r += 12;
            g += 14;
            b += 17;
            e = 18;
          }
        } else {
          ro = 200;
          // Hillshade: the slope's normal against the light.
          const nx = -hx * TW * 0.06;
          const nz = -hz * TH * 0.06;
          const nl = Math.hypot(nx, 1, nz);
          const shade = Math.max(0, (nx * L.x + L.y + nz * L.z) / nl);
          const k = Math.min(1, h * 1.25);
          const base = 8 + k * 44;
          const lit = base * (0.12 + Math.pow(shade, 3) * 1.7);
          r = lit;
          g = lit * 1.02 + 1;
          b = lit * 1.06 + 3;
          // Contours, dense as a survey's.
          const f = h * 18;
          const dist = (0.5 - Math.abs((f % 1) - 0.5)) / (per * 18);
          if (dist < 0.8) {
            const q = 1 - dist / 0.8;
            r += 46 * q;
            g += 50 * q;
            b += 56 * q;
            e = Math.max(e, 30 * q);
          }
          // The coast, drawn in white light.
          const cd = h / per;
          if (cd < 2.4) {
            const q = 1 - cd / 2.4;
            r += (232 - r) * q;
            g += (238 - g) * q;
            b += (246 - b) * q;
            e = Math.max(e, 230 * q);
          }
        }
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const grain = (n - Math.floor(n) - 0.5) * 7;
        const o = (y * TW + x) * 4;
        d[o] = r + grain;
        d[o + 1] = g + grain;
        d[o + 2] = b + grain;
        d[o + 3] = 255;
        gd[o] = gd[o + 1] = gd[o + 2] = e;
        gd[o + 3] = 255;
        rd[o] = rd[o + 1] = rd[o + 2] = ro;
        rd[o + 3] = 255;
      }
      if (y % 48 === 47) await yieldNow();
    }
    pg.putImageData(img, 0, 0);
    gg.putImageData(gim, 0, 0);
    rg.putImageData(rim2, 0, 0);

    const both = (draw: (g: CanvasRenderingContext2D, onGlow: boolean) => void) => {
      for (const g of [pg, gg]) {
        g.save();
        draw(g, g === gg);
        g.restore();
      }
    };

    // Rivers of white light: from the high ground, down the steepest way to the sea, gathering as they go.
    const near = (x: number, z: number) => PLACES.some((p) => Math.hypot(p.x - x, p.z - z) < 0.75);
    const rivers: [number, number][][] = [];
    for (let tries = 0; tries < 900 && rivers.length < (PH ? 12 : 18); tries++) {
      let x = (rnd() - 0.5) * (MAP_W - 2);
      let z = (rnd() - 0.5) * (MAP_D - 2);
      if (heightAt(x, z) < 0.38 || near(x, z)) continue;
      const path: [number, number][] = [[x, z]];
      let dx = 0;
      let dz = 0;
      for (let s = 0; s < 260; s++) {
        const e = 0.03;
        const gx = heightAt(x + e, z) - heightAt(x - e, z);
        const gz = heightAt(x, z + e) - heightAt(x, z - e);
        const gl = Math.hypot(gx, gz) || 1;
        const wob = Math.sin(s * 0.35 + x * 3) * 0.25;
        dx = dx * 0.55 + (-gx / gl + wob * (-gz / gl)) * 0.45;
        dz = dz * 0.55 + (-gz / gl - wob * (-gx / gl)) * 0.45;
        const dl = Math.hypot(dx, dz) || 1;
        x += (dx / dl) * 0.04;
        z += (dz / dl) * 0.04;
        path.push([x, z]);
        if (heightAt(x, z) < -0.02 || near(x, z)) break;
      }
      if (path.length > 18) rivers.push(path);
    }
    both((g, onGlow) => {
      g.lineCap = "round";
      g.lineJoin = "round";
      for (const path of rivers) {
        for (const [w, a] of [
          [7, onGlow ? 0.16 : 0.08],
          [2.4, onGlow ? 0.7 : 0.5],
          [0.9, 1],
        ] as const) {
          g.strokeStyle = `rgba(236,242,252,${a})`;
          g.beginPath();
          path.forEach(([x, z], i) => {
            g.lineWidth = w * S;
            if (i === 0) g.moveTo(px(x), pz(z));
            else g.lineTo(px(x), pz(z));
          });
          g.stroke();
        }
      }
    });

    // Storms out on the deep: spirals of cloud, the largest round the Tide's isle.
    const storms: [number, number, number, number][] = [
      [6.0, -3.2, 1.55, 1],
      [-6.4, -3.7, 0.9, -1],
      [1.8, -4.1, 0.65, 1],
      [6.4, 3.4, 0.8, -1],
    ];
    both((g, onGlow) => {
      for (const [cx, cz, R, dir] of storms) {
        const halo = g.createRadialGradient(px(cx), pz(cz), 0, px(cx), pz(cz), (R / MAP_W) * TW);
        halo.addColorStop(0, `rgba(220,228,240,${onGlow ? 0.22 : 0.14})`);
        halo.addColorStop(0.25, "rgba(220,228,240,0.02)");
        halo.addColorStop(0.6, `rgba(220,228,240,${onGlow ? 0.07 : 0.05})`);
        halo.addColorStop(1, "rgba(220,228,240,0)");
        g.fillStyle = halo;
        g.fillRect(0, 0, TW, TH);
        for (let arm = 0; arm < 4; arm++) {
          for (let strand = 0; strand < 7; strand++) {
            const off = (arm / 4) * Math.PI * 2 + strand * 0.07;
            g.strokeStyle = `rgba(232,238,248,${(onGlow ? 0.22 : 0.16) * (1 - strand / 9)})`;
            g.lineWidth = (0.7 + rnd() * 1.6) * S;
            g.beginPath();
            for (let k = 0; k <= 80; k++) {
              const th = (k / 80) * Math.PI * 3.2;
              const r = R * Math.exp(-0.3 * th) * (1 + strand * 0.02);
              const a = off + dir * th;
              const X = px(cx + Math.cos(a) * r);
              const Z = pz(cz + Math.sin(a) * r * 0.95);
              if (k === 0) g.moveTo(X, Z);
              else g.lineTo(X, Z);
            }
            g.stroke();
          }
        }
      }
    });

    // The chart's furniture, in silver hairline: a faint graticule, a border inside the rim, the Tide's uncharted ring.
    both((g, onGlow) => {
      g.strokeStyle = onGlow ? "rgba(210,220,235,.22)" : "rgba(210,220,235,.16)";
      g.lineWidth = 1 * S;
      g.setLineDash([3 * S, 9 * S]);
      for (let x = -6; x <= 6; x += 2) {
        g.beginPath();
        g.moveTo(px(x), 0);
        g.lineTo(px(x), TH);
        g.stroke();
      }
      for (let z = -4; z <= 4; z += 2) {
        g.beginPath();
        g.moveTo(0, pz(z));
        g.lineTo(TW, pz(z));
        g.stroke();
      }
      g.setLineDash([16 * S, 10 * S]);
      g.strokeStyle = onGlow ? "rgba(225,232,244,.7)" : "rgba(225,232,244,.5)";
      g.lineWidth = 1.6 * S;
      g.beginPath();
      g.ellipse(px(6.0), pz(-3.2), (1.75 / MAP_W) * TW, (1.75 / MAP_D) * TH, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = onGlow ? "rgba(225,232,244,.55)" : "rgba(225,232,244,.4)";
      g.lineWidth = 2 * S;
      g.strokeRect(14 * S, 14 * S, TW - 28 * S, TH - 28 * S);
      g.lineWidth = 0.8 * S;
      g.strokeRect(24 * S, 24 * S, TW - 48 * S, TH - 48 * S);
      // Tick marks along the border, as a survey's frame has.
      for (let x = 0; x <= 64; x++) {
        const X = 24 * S + (x / 64) * (TW - 48 * S);
        const L2 = (x % 8 === 0 ? 10 : 4) * S;
        g.beginPath();
        g.moveTo(X, 24 * S);
        g.lineTo(X, 24 * S + L2);
        g.moveTo(X, TH - 24 * S);
        g.lineTo(X, TH - 24 * S - L2);
        g.stroke();
      }
    });
  }
  const mapTex = keep(new CanvasTexture(paint));
  mapTex.colorSpace = SRGBColorSpace;
  mapTex.anisotropy = 4;
  const glowTex = keep(new CanvasTexture(glow));
  glowTex.colorSpace = SRGBColorSpace;
  const roughTex = keep(new CanvasTexture(rough));
  const mapGeo = keep(new PlaneGeometry(MAP_W, MAP_D, PH ? 200 : 320, PH ? 125 : 200));
  mapGeo.rotateX(-Math.PI / 2);
  {
    const p = mapGeo.attributes.position as BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, surfaceAt(p.getX(i), p.getZ(i)));
    mapGeo.computeVertexNormals();
  }
  const chart = new Mesh(
    mapGeo,
    keep(
      new MeshStandardMaterial({
        map: mapTex,
        roughness: 1,
        roughnessMap: roughTex,
        metalness: 0.12,
        emissive: 0xdfe8f5,
        emissiveMap: glowTex,
        emissiveIntensity: 0.62,
      }),
    ),
  );
  chart.receiveShadow = true;
  scene.add(chart);

  // The black water over the drowned land: glints and a slow swell, so the sea reads wet.
  const waterU = { t: { value: 0 } };
  const water = new Mesh(
    keep(new PlaneGeometry(MAP_W, MAP_D, 1, 1)),
    keep(
      new ShaderMaterial({
        uniforms: waterU,
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float t; varying vec2 vP;
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
            return mix(mix(h2(i), h2(i + vec2(1., 0.)), u.x), mix(h2(i + vec2(0., 1.)), h2(i + vec2(1., 1.)), u.x), u.y); }
          void main(){
            float n = vn(vP * 2.6 + vec2(t * .12, -t * .08)) * .6 + vn(vP * 6.5 - vec2(t * .18, t * .1)) * .4;
            float glint = pow(n, 7.) * 2.4;
            float sp = step(.993, h2(floor(vP * 36.) + floor(t * 1.5)));
            vec3 c = vec3(.01, .013, .017) + vec3(.78, .84, .92) * (glint * .3 + sp * .55);
            gl_FragColor = vec4(c, .42 + glint * .25 + sp * .3); }`,
      }),
    ),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.004;
  water.renderOrder = 2;
  scene.add(water);
  await yieldNow();

  // ---- the places --------------------------------------------------------------------------------------------------
  interface Mini {
    p: Place;
    g: Group;
    mats: Record<Mat, MeshStandardMaterial | MeshBasicMaterial>;
    wire: LineSegments<BufferGeometry, ShaderMaterial>;
    ring: Mesh<TorusGeometry, MeshBasicMaterial>;
    light: PointLight | null;
    top: number;
    state: PlaceState;
    lit: number;
    level: number;
    hov: number;
  }
  const wireU = { t: { value: 0 }, res: { value: new Vector2(1, 1) } };
  const EDGE = `uniform vec2 res; float edgeOf(){ vec2 q = gl_FragCoord.xy / res * 2. - 1.; return length(q * vec2(.86, 1.)) / 1.31; }
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`;
  const wireMat = (a0: number) =>
    keep(
      new ShaderMaterial({
        uniforms: {
          ...wireU,
          a: { value: a0 },
          top: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float t, a, top; varying vec3 vL; ${EDGE}
          void main(){ float e = smoothstep(.45, .95, edgeOf());
            float scan = smoothstep(.12, 0., abs(fract(t * .22) * (top + .6) - .3 - vL.y));
            float h = hash(floor(vL * 9.) + floor(t * 1.3));
            float fl = .8 + .2 * sin(t * 4. + h * 30.);
            float al = clamp(a + e * .5 + scan * (a * 1.6 + .08), 0., 1.) * fl;
            if (al < .01) discard;
            gl_FragColor = vec4(vec3(.86, .9, .97), al); }`,
      }),
    );
  const minis: Mini[] = [];
  const glassWires: ShaderMaterial[] = [];
  const hits: { id: PlaceId; m: Mesh }[] = [];
  const hitMat = keep(new MeshBasicMaterial());
  for (const p of PLACES) {
    const parts = modelOf(p.kind, rnd);
    const ghost = p.kind === "ghost";
    const mats: Mini["mats"] = {
      stone: keep(new MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.32, metalness: 0.45, side: DoubleSide })),
      metal: keep(steel.clone()),
      glass: glassMat(),
      glow: keep(new MeshStandardMaterial({ color: 0x101418, emissive: 0xe4eeff, emissiveIntensity: 0.4, roughness: 0.4 })),
      figure: keep(new MeshStandardMaterial({ color: 0x14181d, emissive: 0xdfe8f5, emissiveIntensity: 0.3, roughness: 0.6, transparent: true, opacity: 0.6, depthWrite: false })),
      vein: veinMat(0.55),
    };
    const g = new Group();
    g.position.set(p.x, groundOf(p), p.z);
    scene.add(g);
    const byMat = new Map<Mat, BufferGeometry[]>();
    const edges: BufferGeometry[] = [];
    const glassEdges: BufferGeometry[] = [];
    let top = 0;
    for (const part of parts) {
      const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo;
      for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal" && !(k === "uv" && part.mat === "vein")) geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      byMat.set(part.mat, [...(byMat.get(part.mat) ?? []), geo]);
      if (part.mat === "stone" || part.mat === "metal") edges.push(ghost ? new EdgesGeometry(geo, 1) : new EdgesGeometry(geo, 28));
      else if (part.mat === "glass") (ghost ? edges : glassEdges).push(new EdgesGeometry(geo, 28));
      geo.computeBoundingBox();
      top = Math.max(top, geo.boundingBox!.max.y);
    }
    if (!ghost)
      for (const [m, geos] of byMat) {
        const mesh = new Mesh(keep(mergeGeometries(geos)!), mats[m]);
        mesh.castShadow = !PH && (m === "stone" || m === "metal");
        mesh.receiveShadow = m !== "vein" && m !== "glass";
        if (m === "glass" || m === "vein" || m === "figure") mesh.renderOrder = 3;
        g.add(mesh);
      }
    const wire = new LineSegments(keep(mergeGeometries(edges)!), wireMat(ghost ? 0.7 : 0.08));
    wire.material.uniforms.top!.value = top;
    wire.renderOrder = 5;
    g.add(wire);
    if (glassEdges.length) {
      const gw = new LineSegments(keep(mergeGeometries(glassEdges)!), wireMat(0.42));
      gw.material.uniforms.top!.value = top;
      gw.renderOrder = 5;
      g.add(gw);
      glassWires.push(gw.material);
    }
    const ring = new Mesh(
      keep(new TorusGeometry(p.kind === "citadel" || p.kind === "harbour" || p.kind === "hourglass" ? 1.0 : 0.82, 0.01, 6, 72)),
      keep(
        new MeshBasicMaterial({
          color: SILVER,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    let light: PointLight | null = null;
    if (!PH && (p.kind === "beacon" || p.kind === "citadel" || p.kind === "lab")) {
      light = new PointLight(0xdfe9ff, 0, 3.4, 1.6);
      light.position.set(0, top * 0.7, 0);
      g.add(light);
    }
    const hit = new Mesh(keep(new CylinderGeometry(0.85, 0.85, top + 0.4, 10)), hitMat);
    hit.position.set(p.x, groundOf(p) + (top + 0.4) / 2 - 0.1, p.z);
    hit.updateMatrixWorld();
    hits.push({ id: p.id, m: hit });
    minis.push({
      p,
      g,
      mats,
      wire,
      ring,
      light,
      top,
      state: { lit: !ghost, level: 0.3 },
      lit: ghost ? 0 : 1,
      level: 0.3,
      hov: 0,
    });
  }
  const miniOf = (id: PlaceId) => minis.find((m) => m.p.id === id)!;

  // The beacon's beam: a shaft of cold light straight up, as bright as today is busy.
  const beacon = miniOf("today");
  const beamMat = keep(
    new ShaderMaterial({
      uniforms: { k: { value: 0.4 }, t: wireU.t },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float k, t; varying float vY;
        void main(){ float a = (1. - smoothstep(0., 1., vY)) * smoothstep(0., .04, vY) * k * (.85 + .15 * sin(t * 2.3 + vY * 9.));
          gl_FragColor = vec4(vec3(.9, .94, 1.), a * .55); }`,
    }),
  );
  const beam = new Mesh(keep(new CylinderGeometry(0.11, 0.04, 2.6, 16, 1, true)), beamMat);
  beam.position.set(beacon.p.x, groundOf(beacon.p) + 1.9 + 1.3, beacon.p.z);
  beam.renderOrder = 6;
  scene.add(beam);

  // The harbour's skiffs: dark hulls with a lit keel and a glass sail, riding at anchor off the drowned quay.
  const harbour = miniOf("ships");
  const ships: { g: Group; ph: number }[] = [];
  for (const [dx, dz, r] of [
    [-0.2, -1.55, 0.4],
    [0.75, -1.75, -0.3],
    [-1.0, -1.35, 1.1],
  ] as const) {
    const s = new Group();
    // A long low hull, half under the water.
    const hull = new SphereGeometry(1, 16, 8);
    hull.scale(0.25, 0.05, 0.06);
    const hm = new Mesh(keep(hull), harbour.mats.stone);
    hm.position.y = 0.02;
    hm.castShadow = !PH;
    s.add(hm);
    const keel = new Mesh(keep(new BoxGeometry(0.46, 0.008, 0.012)), harbour.mats.glow);
    keel.position.y = 0.072;
    s.add(keel);
    const sailShape = new BufferGeometry();
    sailShape.setAttribute("position", new BufferAttribute(new Float32Array([-0.12, 0.08, 0, 0.1, 0.08, 0, -0.02, 0.36, 0]), 3));
    sailShape.computeVertexNormals();
    const sail = new Mesh(keep(sailShape), harbour.mats.glass);
    sail.renderOrder = 3;
    s.add(sail);
    s.position.set(harbour.p.x + dx, 0.0, harbour.p.z + dz);
    s.rotation.y = r;
    s.scale.setScalar(1.45);
    scene.add(s);
    ships.push({ g: s, ph: rnd() * 6 });
  }

  // The d20, in glass now, resting by the near rim: the game master's hands, whatever the world.
  const d20 = new Mesh(keep(new IcosahedronGeometry(0.3, 0)), glassMat());
  d20.position.set(5.6, surfaceAt(5.6, 3.6) + 0.24, 3.6);
  d20.rotation.set(0.35, 0.6, 0.2);
  d20.renderOrder = 3;
  scene.add(d20);
  const d20w = new LineSegments(keep(new EdgesGeometry(d20.geometry)), edgeLine);
  d20w.scale.setScalar(1.005);
  d20.add(d20w);

  // Glass tubes on the far corners of the rim, an hourglass of light in each, in place of candles.
  const tubes: { core: Mesh; l: PointLight | null; ph: number }[] = [];
  const coreMat = keep(new MeshStandardMaterial({ color: 0x101418, emissive: 0xe4eeff, emissiveIntensity: 1.2 }));
  for (const x of [-1, 1]) {
    const cx = x * (W2 + RIM / 2);
    const cz = -D2 - RIM / 2;
    const tube = new Mesh(keep(new CylinderGeometry(0.15, 0.15, 0.9, 20)), glassMat());
    tube.position.set(cx, rimH + 0.47, cz);
    tube.renderOrder = 3;
    scene.add(tube);
    const te = new LineSegments(keep(new EdgesGeometry(tube.geometry, 20)), edgeLine);
    te.position.copy(tube.position);
    scene.add(te);
    for (const y of [rimH + 0.03, rimH + 0.94]) {
      const c = new Mesh(keep(new CylinderGeometry(0.18, 0.18, 0.05, 20)), steel);
      c.position.set(cx, y, cz);
      scene.add(c);
    }
    const core = new Mesh(keep(hourglass(0.12, 0.78)), coreMat);
    core.position.set(cx, rimH + 0.47, cz);
    scene.add(core);
    const l = PH ? null : new PointLight(0xdfe9ff, 2.2, 7, 1.8);
    l?.position.set(cx, rimH + 0.9, cz);
    if (l) scene.add(l);
    tubes.push({ core, l, ph: rnd() * 6 });
  }

  // The world's limb lies far off beyond the table's far right, where the threads run to.
  const PLANET = new Vector3(99, -9, -124);
  const PLANET_R = 72;
  // Where the threads go in: a point on the limb as the composed view sees it, low on the planet's near edge.
  const limb = new Vector3(47, -42, -87);

  // ---- the light threads: silver strands between the places, and off the table into the dark -----------------------
  const ixOf = (id: PlaceId) => PLACES.findIndex((p) => p.id === id);
  const threadU = {
    t: wireU.t,
    hov: { value: new Array<number>(PLACES.length).fill(0) },
    lit: { value: new Array<number>(PLACES.length).fill(1) },
  };
  {
    const STR = PH ? 2 : 4;
    const SEG = 40;
    const pos: number[] = [];
    const uu: number[] = [];
    const ends: number[] = [];
    const seeds: number[] = [];
    const anchor = (m: Mini) => new Vector3(m.p.x, groundOf(m.p) + Math.min(m.top * 0.75, 1.1), m.p.z);
    const strand = (a: Vector3, b: Vector3, c: Vector3, ia: number, ib: number) => {
      const curve = new QuadraticBezierCurve3(a, c, b);
      const seed = rnd();
      let prev = curve.getPoint(0);
      for (let k = 1; k <= SEG; k++) {
        const cur = curve.getPoint(k / SEG);
        pos.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        uu.push((k - 1) / SEG, k / SEG);
        ends.push(ia, ib, ia, ib);
        seeds.push(seed, seed);
        prev = cur;
      }
    };
    for (const [ida, idb] of LINKS) {
      const A = miniOf(ida);
      const B = miniOf(idb);
      const a = anchor(A);
      const b = anchor(B);
      const len = a.distanceTo(b);
      for (let s = 0; s < STR; s++) {
        const c = a
          .clone()
          .lerp(b, 0.5)
          .add(new Vector3((rnd() - 0.5) * 0.6, 0.9 + len * 0.18 + rnd() * 0.5, (rnd() - 0.5) * 0.6));
        strand(a, b, c, ixOf(ida), ixOf(idb));
      }
    }
    // Off the table: a bundle streaming from the far places away into the dark, toward the world's limb.
    for (const id of ["tide", "bonds", "week", "today"] as PlaceId[]) {
      const A = miniOf(id);
      const a = anchor(A);
      for (let s = 0; s < STR + 1; s++) {
        const b = limb.clone().add(new Vector3((rnd() - 0.5) * 6, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6));
        const c = new Vector3(a.x * 0.3 + 16 + rnd() * 3, 2.5 + rnd() * 1.5, -18 - rnd() * 3);
        strand(a, b, c, ixOf(id), ixOf(id));
      }
    }
    const geo = keep(new BufferGeometry());
    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("u", new BufferAttribute(new Float32Array(uu), 1));
    geo.setAttribute("ends", new BufferAttribute(new Float32Array(ends), 2));
    geo.setAttribute("seed", new BufferAttribute(new Float32Array(seeds), 1));
    const threads = new LineSegments(
      geo,
      keep(
        new ShaderMaterial({
          uniforms: threadU,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          vertexShader: `attribute float u, seed; attribute vec2 ends; uniform float hov[${PLACES.length}], lit[${PLACES.length}];
            varying float vU, vS, vH, vL;
            void main(){ vU = u; vS = seed; int a = int(ends.x + .5); int b = int(ends.y + .5);
              vH = max(hov[a], hov[b]); vL = min(lit[a], lit[b]);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
          fragmentShader: `uniform float t; varying float vU, vS, vH, vL;
            void main(){ float f = fract(vU * 1.6 - t * (.1 + vS * .12) + vS * 7.);
              float pulse = smoothstep(0., .05, f) * (1. - smoothstep(.05, .3, f));
              float tips = smoothstep(0., .05, vU) * smoothstep(1., .9, vU);
              float a = tips * ((.1 + .32 * vH) * (.35 + .65 * vL) + pulse * (.35 + .6 * vH) * (.25 + .75 * vL));
              if (a < .004) discard;
              gl_FragColor = vec4(vec3(.88, .92, 1.), a); }`,
        }),
      ),
    );
    threads.frustumCulled = false;
    threads.renderOrder = 7;
    scene.add(threads);
  }

  // The world's limb, far off in the dark beyond the table: a drowned planet, its storms and its silver rim.
  {
    const planet = new Mesh(
      keep(new SphereGeometry(PLANET_R, PH ? 40 : 72, PH ? 28 : 48)),
      keep(
        new ShaderMaterial({
          uniforms: { t: wireU.t },
          vertexShader: `varying vec3 vN, vV, vO; void main(){ vO = position; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `uniform float t; varying vec3 vN, vV, vO;
            float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
            float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
              return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                         mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
            void main(){ vec3 n = normalize(vN); float f = 1. - max(dot(n, normalize(-vV)), 0.);
              vec3 q = normalize(vO) * 3.2 + vec3(t * .01, 0., 0.);
              float c = n3(q) * .55 + n3(q * 2.3) * .3 + n3(q * 5.1) * .15;
              float cloud = smoothstep(.48, .8, c);
              vec3 body = vec3(.01, .012, .015) + vec3(.34, .37, .42) * cloud * .22 * (.3 + .7 * pow(f, .8));
              float rim = pow(f, 2.6);
              gl_FragColor = vec4(body + vec3(.78, .86, 1.) * rim * 1.15, 1.); }`,
        }),
      ),
    );
    planet.position.copy(PLANET);
    scene.add(planet);
  }

  // Mist: drifting low on the floor round the legs, and thin over the water by the drowned places.
  const mistTex = keep(mistTexture(rnd));
  const mists: { s: Sprite; ph: number; x: number; base: number }[] = [];
  const mistAt = (x: number, y: number, z: number, sc: number, op: number) => {
    const s = new Sprite(keep(new SpriteMaterial({ map: mistTex, transparent: true, opacity: op, depthWrite: false, color: 0xd8e2ee })));
    s.scale.set(sc, sc * 0.45, 1);
    s.position.set(x, y, z);
    s.renderOrder = 4;
    scene.add(s);
    mists.push({ s, ph: rnd() * 6, x, base: op });
  };
  if (!PH) for (const [x, z] of legs) mistAt(x * 1.2, FLOOR + 1.2, z * 1.1, 14, 0.5);
  if (!PH) for (let k = 0; k < 5; k++) mistAt((rnd() - 0.5) * 30, FLOOR + 0.8, (rnd() - 0.5) * 20, 16, 0.4);
  for (const id of ["day", "ships", "tide", "how"] as PlaceId[]) {
    const m = miniOf(id);
    mistAt(m.p.x + 0.3, 0.32, m.p.z + 0.3, 2.6, 0.32);
  }
  await yieldNow();

  // ---- nanites: silver sigils rising off the places -----------------------------------------------------------------
  const atlas = keep(await sigilAtlas());
  const NG = SIGIL_GLYPHS.length;
  const pxU = { value: renderer.getPixelRatio() };
  const PER = PH ? 14 : 30;
  const counts = minis.map((m) => (m.p.kind === "ghost" ? PER * 3 : PER));
  const NN = counts.reduce((a, b) => a + b, 0);
  const np = new Float32Array(NN * 3);
  const ng = new Float32Array(NN);
  const nr = new Float32Array(NN);
  const nw = new Float32Array(NN);
  {
    let i = 0;
    minis.forEach((m, k) => {
      for (let n = 0; n < counts[k]!; n++, i++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.25 + rnd() * (m.p.kind === "ghost" ? 1.1 : 0.75);
        np.set([m.p.x + Math.cos(a) * r, groundOf(m.p) + rnd() * 0.3, m.p.z + Math.sin(a) * r], i * 3);
        ng[i] = Math.floor(rnd() * NG);
        nr[i] = rnd();
      }
    });
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("glyph", new BufferAttribute(ng, 1));
  nGeo.setAttribute("rnd", new BufferAttribute(nr, 1));
  nGeo.setAttribute("w", new BufferAttribute(nw, 1));
  const nanites = new Points(
    nGeo,
    keep(
      new ShaderMaterial({
        uniforms: { t: wireU.t, atlas: { value: atlas }, px: pxU },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd, w; uniform float t, px; varying vec2 vCell; varying float vA;
          void main(){ float ph = fract(t * (.05 + rnd * .05) + rnd * 9.17);
            float g = mod(glyph + floor(ph * 4. + rnd * 7.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position; p.y += ph * (1.1 + rnd * 1.2); p.x += sin(t * .4 + rnd * 20.) * .06 * ph;
            vA = w * smoothstep(0., .15, ph) * (1. - smoothstep(.55, 1., ph));
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.55 + rnd * .45) * 20. * px * (6. / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec2 vCell; varying float vA;
          void main(){ if (vA < .01) discard; vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            gl_FragColor = vec4(vec3(.9, .94, 1.), m * vA); }`,
      }),
    ),
  );
  nanites.frustumCulled = false;
  nanites.renderOrder = 8;
  scene.add(nanites);

  // ---- the edges of the frame come undone: the floor's grid, the table's outline, code on them, in silver -----------
  let stepUndone: (t: number, r: WebGLRenderer) => void = () => undefined;
  {
    const wire: number[] = [];
    const GX = 30;
    const GZ = 22;
    const FY = FLOOR + 0.02;
    for (let x = -GX; x <= GX; x += 1.5) wire.push(x, FY, -GZ, x, FY, GZ);
    for (let z = -GZ; z <= GZ; z += 1.5) wire.push(-GX, FY, z, GX, FY, z);
    const ow = W2 + RIM + 0.15;
    const od = D2 + RIM + 0.15;
    for (const y of [0.3, -0.66]) wire.push(-ow, y, -od, ow, y, -od, ow, y, -od, ow, y, od, ow, y, od, -ow, y, od, -ow, y, od, -ow, y, -od);
    for (const [x, z] of legs) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) wire.push(x + sx * 0.58, -0.66, z + sz * 0.58, x + sx * 0.58, FLOOR, z + sz * 0.58);
    const ND = PH ? 380 : 1100;
    const dust = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) {
      let x = (rnd() - 0.5) * GX * 1.6;
      let z = (rnd() - 0.5) * GZ * 1.6;
      let y = FY;
      if (rnd() < 0.3) {
        const side = Math.floor(rnd() * 4);
        x = side < 2 ? (rnd() - 0.5) * ow * 2 : side === 2 ? -ow : ow;
        z = side >= 2 ? (rnd() - 0.5) * od * 2 : side === 0 ? -od : od;
        y = -0.6 + rnd() * 0.9;
      }
      dust.set([x, y, z], i * 3);
    }
    const undone = comeUndone({
      wire,
      dust,
      atlas,
      px: pxU,
      peel: PH ? 140 : 420,
      shape: [0.86, 1.31],
      tint: { wire: WIRE, hi: HI },
      keep,
    });
    undone.addTo(scene);
    stepUndone = undone.step;
  }

  // ---- the camera ----------------------------------------------------------------------------------------------------
  let phoneView = host.clientWidth < 700;
  // Desktop: from the near long side. A phone, upright: from the short end, so the table's length runs into the screen.
  const home = () => (phoneView ? { yaw: Math.PI / 2, pitch: 0.52, dist: 20.5, fov: 46 } : { yaw: 0, pitch: 0.86, dist: 17.6, fov: 36 });
  let view = home();
  let yaw = view.yaw;
  let yawTo = yaw;
  let pitch = view.pitch;
  let pitchTo = pitch;
  let dist = view.dist;
  let distTo = dist;
  const homeZ = () => (phoneView ? 0.35 : -0.3);
  const look = new Vector3(0, 0, homeZ());
  const lookTo = look.clone();
  let cover = 0;
  let coverTo = 0;
  let W = 1;
  let H = 1;
  const size = () => {
    W = Math.max(1, host.clientWidth);
    H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    cam.aspect = W / H;
    const was = phoneView;
    phoneView = W < 700;
    if (was !== phoneView) {
      view = home();
      yaw = yawTo = view.yaw;
      pitch = pitchTo = view.pitch;
      dist = distTo = view.dist;
      look.set(0, 0, homeZ());
      lookTo.copy(look);
    }
    // Fit the table's width to the frame on a narrow window.
    const fit = phoneView ? 1 : Math.max(1, 1.62 / cam.aspect);
    view.dist = (phoneView ? 20.5 : 17.6) * fit;
    if (!open) distTo = view.dist;
    cam.fov = view.fov;
    cam.updateProjectionMatrix();
    renderer.getDrawingBufferSize(wireU.res.value);
    pxU.value = renderer.getPixelRatio();
    moved = true;
  };
  let open: PlaceId | null = null;
  let moved = true;
  size();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(host);

  // ---- pointing, dragging, picking -------------------------------------------------------------------------------
  const ray = new Raycaster();
  const ndc = new Vector2();
  let hover: PlaceId | null = null;
  let hoverExt: PlaceId | null = null;
  const pickAt = (cx: number, cy: number): PlaceId | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    let best: { id: PlaceId; d: number } | null = null;
    for (const h of hits) {
      const i = ray.intersectObject(h.m, false)[0];
      if (i && (!best || i.distance < best.d)) best = { id: h.id, d: i.distance };
    }
    if (!best && ray.intersectObject(d20, false).length) return "tide";
    return best?.id ?? null;
  };
  let drag: {
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    moved: boolean;
    id: number;
  } | null = null;
  const onDown = (e: PointerEvent) => {
    drag = {
      x: e.clientX,
      y: e.clientY,
      yaw: yawTo,
      pitch: pitchTo,
      moved: false,
      id: e.pointerId,
    };
  };
  const onMove = (e: PointerEvent) => {
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 6) {
        drag.moved = true;
        canvas.setPointerCapture?.(e.pointerId);
      }
      if (drag.moved) {
        const v = home();
        yawTo = Math.max(v.yaw - ARC, Math.min(v.yaw + ARC, drag.yaw - dx * 0.0042));
        pitchTo = Math.max(0.55, Math.min(1.15, drag.pitch - dy * 0.0032));
        moved = true;
        return;
      }
    }
    if (e.pointerType !== "mouse") return;
    const id = pickAt(e.clientX, e.clientY);
    if (id !== hover) {
      hover = id;
      canvas.style.cursor = id ? "pointer" : "grab";
      opts.onHover(id);
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const was = drag;
    drag = null;
    if (!was.moved) {
      const id = pickAt(e.clientX, e.clientY);
      if (id) opts.onPick(id);
    }
  };
  const onLeave = () => {
    if (hover) {
      hover = null;
      opts.onHover(null);
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 4) return;
    e.preventDefault();
    distTo = Math.max(view.dist * 0.62, Math.min(view.dist * 1.2, distTo * (1 + Math.sign(e.deltaY) * 0.08)));
    moved = true;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.style.cursor = "grab";
  // WASD round the table (#826, the shared helper #776; Nikita, 2026-11-06: a set swivel, not free roam). A/D swivel
  // the camera round the table's middle within a short arc, W/S dolly in and out within tight bounds, both eased so the
  // edges are soft; Escape (or the helper's home) comes back to the composed view. Never while something is typed
  // into, and Space stays with hold-to-talk.
  const ARC = 0.5;
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: 0, cz: 0, r: 0.01 }),
    origin: () => [look.x, look.z],
    forward: () => [look.x - cam.position.x, look.z - cam.position.z],
    orbit: {
      turn: (r) => {
        const v = home();
        yawTo = Math.max(v.yaw - ARC, Math.min(v.yaw + ARC, yawTo + r));
        moved = true;
      },
      zoom: (amt) => {
        distTo = Math.max(view.dist * 0.78, Math.min(view.dist * 1.1, distTo - amt * view.dist * 0.35));
        moved = true;
      },
      home: () => {
        const v = home();
        yawTo = v.yaw;
        pitchTo = v.pitch;
        distTo = open ? view.dist * 0.8 : view.dist;
        moved = true;
      },
    },
  });

  // ---- the loop ------------------------------------------------------------------------------------------------------
  let visible = true;
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((en) => {
          visible = en[en.length - 1]!.isIntersecting;
        })
      : null;
  io?.observe(host);
  let raf = 0;
  let last = performance.now();
  // Under reduced motion the clock stands at a moment where the threads and the water read well, and stays there.
  let T = reduce ? 7.3 : 0;
  const minStep = PH ? 1000 / 30 - 2 : 0;
  const placed = new Map<PlaceId, string>();
  const v3 = new Vector3();
  const place = () => {
    for (const m of minis) {
      v3.set(m.p.x, groundOf(m.p) + m.top + 0.18, m.p.z).project(cam);
      const x = ((v3.x + 1) / 2) * W;
      const y = ((1 - v3.y) / 2) * H;
      const vis = v3.z < 1 && x > 4 && x < W - 4 && y > 4 && y < H - 4;
      const key = `${Math.round(x / 2)},${Math.round(y / 2)},${vis}`;
      if (placed.get(m.p.id) === key) continue;
      placed.set(m.p.id, key);
      opts.onPlace(m.p.id, x, y, vis);
    }
  };
  const ghostMini = miniOf("tide");
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.visibilityState === "hidden") {
      last = now;
      return;
    }
    if (now - last < minStep) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!reduce) T += dt;
    wireU.t.value = T;
    waterU.t.value = T;
    for (const m of minis) (m.wire.material.uniforms.t as { value: number }).value = T;
    for (const g of glassWires) (g.uniforms.t as { value: number }).value = T;
    stepUndone(T, renderer);
    // The camera eases, and the pins follow only while it moves.
    const k = reduce ? 1 : 1 - Math.exp(-dt * 4.2);
    const panning = pan.step(dt);
    const before = yaw + pitch + dist + look.x + look.z + cover;
    yaw += (yawTo - yaw) * k;
    pitch += (pitchTo - pitch) * k;
    dist += (distTo - dist) * k;
    look.lerp(lookTo, k);
    cover += (coverTo - cover) * k;
    const changed = panning || Math.abs(before - (yaw + pitch + dist + look.x + look.z + cover)) > 1e-5;
    const lx = look.x + pan.x;
    const lz = look.z + pan.z;
    cam.position.set(lx + Math.sin(yaw) * Math.sin(pitch) * dist, look.y + Math.cos(pitch) * dist, lz + Math.cos(yaw) * Math.sin(pitch) * dist);
    cam.lookAt(lx, look.y, lz);
    if (cover > 0.5) cam.setViewOffset(W, H, cover / 2, 0, W, H);
    else cam.clearViewOffset();
    if (changed || moved) {
      cam.updateMatrixWorld();
      place();
      moved = false;
    }
    // The places: lit from real state, brighter under the pointer and while open.
    let i = 0;
    for (const [mi, m] of minis.entries()) {
      const on = m.p.id === hover || m.p.id === hoverExt || m.p.id === open;
      m.hov += ((on ? 1 : 0) - m.hov) * Math.min(1, dt * 6);
      m.lit += ((m.state.lit ? 1 : 0) - m.lit) * Math.min(1, dt * 3);
      m.level += (m.state.level - m.level) * Math.min(1, dt * 3);
      const ghost = m.p.kind === "ghost";
      const stone = m.mats.stone as MeshStandardMaterial;
      stone.color.setRGB(0.07 + 0.05 * m.lit, 0.075 + 0.055 * m.lit, 0.085 + 0.06 * m.lit);
      stone.emissive.setRGB(0.07 * m.hov, 0.08 * m.hov, 0.1 * m.hov);
      const flick = reduce ? 1 : 0.92 + 0.08 * Math.sin(T * 5 + mi);
      (m.mats.glow as MeshStandardMaterial).emissiveIntensity = (0.2 + m.level * 2.0 * m.lit + m.hov * 0.8) * flick;
      (m.mats.figure as MeshStandardMaterial).emissiveIntensity = 0.12 + m.level * 0.6 * m.lit + m.hov * 0.5;
      (m.mats.glass as MeshStandardMaterial).emissiveIntensity = (0.7 + m.hov * 1.6) * (m.p.kind === "stacks" ? 0.5 : 1);
      // The stacks hold dozens of leaves, so each is fainter.
      m.mats.vein.opacity = (0.22 + 0.4 * m.lit + 0.35 * m.hov) * (0.75 + 0.25 * m.level) * (m.p.kind === "stacks" ? 0.4 : 1);
      if (m.light) m.light.intensity = (m.level * 2.4 + m.hov * 1.5) * m.lit * flick;
      (m.wire.material.uniforms.a as { value: number }).value = ghost ? 0.55 + 0.25 * m.hov + 0.1 * Math.sin(T * 2) : 0.04 + 0.5 * m.hov + (1 - m.lit) * 0.22;
      m.ring.material.opacity = m.hov * 0.85;
      m.ring.scale.setScalar(1 + (reduce ? 0 : Math.sin(T * 2.4) * 0.03 * m.hov));
      const w = ghost ? 0.45 + 0.35 * m.hov : (0.1 + 0.5 * m.level * m.lit + 0.55 * m.hov) * (0.6 + 0.4 * m.lit);
      for (let n = 0; n < counts[mi]!; n++, i++) nw[i] = w * (nr[i]! < 0.35 + 0.65 * Math.max(m.level, m.hov) || ghost ? 1 : 0);
      threadU.hov.value[mi] = m.hov;
      threadU.lit.value[mi] = ghost ? 0.25 : m.lit;
    }
    (nGeo.attributes.w as BufferAttribute).needsUpdate = true;
    (beamMat.uniforms.k as { value: number }).value = (0.25 + beacon.level * 0.9 + beacon.hov * 0.6) * beacon.lit;
    if (!reduce) {
      ghostMini.g.rotation.y = T * 0.06;
      for (const s of ships) {
        s.g.position.y = Math.sin(T * 1.3 + s.ph) * 0.012;
        s.g.rotation.z = Math.sin(T * 1.1 + s.ph) * 0.05;
        s.g.rotation.x = Math.sin(T * 0.9 + s.ph * 2) * 0.03;
      }
      for (const m of mists) {
        m.s.position.x = m.x + Math.sin(T * 0.05 + m.ph) * 0.8;
        m.s.material.opacity = m.base * (0.75 + 0.25 * Math.sin(T * 0.2 + m.ph));
      }
      for (const tb of tubes) {
        const q = 0.88 + 0.12 * Math.sin(T * 1.7 + tb.ph);
        if (tb.l) tb.l.intensity = 2.2 * q;
      }
      coreMat.emissiveIntensity = 1.0 + 0.25 * Math.sin(T * 1.7);
    }
    renderer.render(scene, cam);
  };
  await yieldNow();
  await renderer.compileAsync(scene, cam).catch(() => undefined);
  await yieldNow();
  cam.position.set(Math.sin(yaw) * Math.sin(pitch) * dist, Math.cos(pitch) * dist, look.z + Math.cos(yaw) * Math.sin(pitch) * dist);
  cam.lookAt(look);
  stepUndone(T, renderer);
  renderer.render(scene, cam);
  raf = requestAnimationFrame(frame);

  return {
    setStates: (s) => {
      for (const m of minis) {
        const st = s[m.p.id];
        if (st) m.state = st;
      }
    },
    setOpen: (id, px) => {
      open = id;
      coverTo = phoneView ? 0 : px;
      if (id) {
        const p = PLACES.find((q) => q.id === id)!;
        lookTo.set(p.x * 0.55, 0, p.z * 0.55 + homeZ());
        distTo = view.dist * 0.8;
      } else {
        lookTo.set(0, 0, homeZ());
        distTo = view.dist;
      }
      moved = true;
    },
    setHover: (id) => {
      hoverExt = id;
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      pan.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
