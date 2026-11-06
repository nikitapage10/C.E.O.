import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
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
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Shape,
  ExtrudeGeometry,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { groundOf, heightAt, MAP_D, MAP_W, PLACES, surfaceAt, type ModelKind, type Place, type PlaceId } from "../data/warTable.ts";

/**
 * The war table in 3D (#826; Nikita, 2026-11-05: "the war table itself to be bigger and take up most of the screen ...
 * the map itself is going to be the different features of the archive ... mostly physical with actual 3D models of
 * the cities and worlds ... a physical 3D model with wireframe and nano stuff overlays ... nanite and grid, kind of like
 * we have in the Senate").
 *
 * Physical first: a heavy walnut table with a brass-inlaid rim, a sea chart carved into its top (relief, contours, gold
 * rhumb lines and a compass rose), and on it a pewter-and-brass miniature for each of the Archive's places
 * (data/warTable.ts): the lighthouse, the clock town, the citadel, the twin towers, the library, the theatre, the
 * harbour and its ships, and the compass. The Tide's isle stands only in gold wire: its chart isn't drawn until its
 * feed is connected. A violet d20 rests by the rim. Over the solids, the overlays: each model's edges as faint gold
 * wire that wakes under the pointer, sigil nanites (code and rune glyphs, never dots) rising off the places, and, as
 * in the Senate (desk/rotunda/rotundaScene.ts), the frame's edges coming undone into a gold grid and code.
 *
 * The camera stands still at rest (the pins over the models stay put); drag to walk round a little, and opening a
 * place eases the view toward it. Phones get fewer glyphs, no shadows and 30 frames a second; reduced motion holds the
 * glyphs and the ships still. Lazy loaded with three.js, never in the Desk's first load.
 */

export interface PlaceState {
  /** Real data behind it: the model is lit; without, it stands dim. */
  lit: boolean;
  /** 0..1, how busy: windows, lantern and nanites. */
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

const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];
const GOLD = new Color(0xe2bf72);

type Mat = "stone" | "brass" | "glow" | "sail" | "wood";
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

/** A gabled roof: a three-sided prism lying along x. */
const gable = (w: number, d: number, h: number) => {
  const g = new CylinderGeometry(1, 1, w, 3, 1);
  g.rotateZ(Math.PI / 2);
  g.rotateX(Math.PI / 6 + Math.PI);
  g.scale(1, h / 1.5, d / 1.732);
  return g;
};

/** A small house: walls and a roof. */
function house(parts: Part[], x: number, z: number, y: number, w: number, d: number, h: number, ry: number) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [hx, hz] = at(0, 0);
  parts.push(put(new BoxGeometry(w, h, d), "stone", hx, y + h / 2, hz, ry));
  parts.push(put(gable(w * 1.06, d * 1.1, h * 0.55), "brass", hx, y + h + h * 0.18, hz, ry));
}

/** The miniatures, built in place-local space, standing on y = 0. */
function modelOf(kind: ModelKind, rnd: () => number): Part[] {
  const P: Part[] = [];
  switch (kind) {
    case "lighthouse": {
      P.push(put(new CylinderGeometry(0.36, 0.42, 0.12, 20), "stone", 0, 0.06, 0));
      P.push(put(new CylinderGeometry(0.13, 0.22, 1.25, 18), "stone", 0, 0.12 + 0.625, 0));
      for (const y of [0.45, 0.85]) P.push(put(new CylinderGeometry(0.19 - y * 0.06, 0.2 - y * 0.06, 0.04, 18), "brass", 0, 0.12 + y, 0));
      P.push(put(new CylinderGeometry(0.22, 0.2, 0.05, 18), "brass", 0, 1.39, 0));
      P.push(put(new CylinderGeometry(0.11, 0.11, 0.2, 12), "glow", 0, 1.51, 0));
      P.push(put(new ConeGeometry(0.16, 0.22, 12), "brass", 0, 1.72, 0));
      house(P, 0.36, 0.18, 0.12, 0.28, 0.2, 0.18, 0.5);
      break;
    }
    case "clocktower": {
      P.push(put(new BoxGeometry(0.3, 1.25, 0.3), "stone", 0, 0.625, 0));
      P.push(put(new BoxGeometry(0.36, 0.06, 0.36), "brass", 0, 1.25, 0));
      P.push(put(new ConeGeometry(0.25, 0.55, 4), "brass", 0, 1.55, 0, Math.PI / 4));
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        P.push(put(new CircleGeometry(0.1, 20), "glow", Math.sin(a) * 0.152, 1.02, Math.cos(a) * 0.152, a));
      }
      const spots: [number, number, number][] = [
        [-0.5, 0.2, 0.3],
        [-0.42, -0.3, -0.2],
        [0.48, 0.25, -0.5],
        [0.5, -0.28, 0.1],
        [-0.05, 0.52, 0.9],
        [0.05, -0.55, 1.4],
        [-0.72, 0.0, 1.6],
        [0.74, 0.0, 1.5],
      ];
      for (const [x, z, r] of spots) house(P, x, z, 0, 0.22 + rnd() * 0.08, 0.16 + rnd() * 0.05, 0.16 + rnd() * 0.12, r);
      break;
    }
    case "citadel": {
      const R = 0.68;
      const N = 8;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        P.push(put(new CylinderGeometry(0.085, 0.1, 0.48, 10), "stone", Math.cos(a) * R, 0.24, Math.sin(a) * R));
        P.push(put(new ConeGeometry(0.11, 0.2, 10), "brass", Math.cos(a) * R, 0.58, Math.sin(a) * R));
        const b = a + Math.PI / N;
        const len = 2 * R * Math.sin(Math.PI / N);
        P.push(put(new BoxGeometry(len, 0.28, 0.07), "stone", Math.cos(b) * R * 0.93, 0.14, Math.sin(b) * R * 0.93, -b + Math.PI / 2));
      }
      P.push(put(new BoxGeometry(0.5, 0.55, 0.5), "stone", 0, 0.275, 0));
      for (const [x, z] of [
        [-0.25, -0.25],
        [0.25, -0.25],
        [-0.25, 0.25],
        [0.25, 0.25],
      ] as const) {
        P.push(put(new CylinderGeometry(0.07, 0.07, 0.72, 10), "stone", x, 0.36, z));
        P.push(put(new ConeGeometry(0.09, 0.18, 10), "brass", x, 0.81, z));
      }
      P.push(put(new CylinderGeometry(0.12, 0.15, 1.35, 14), "stone", 0, 0.675, 0));
      P.push(put(new CylinderGeometry(0.135, 0.135, 0.12, 14), "glow", 0, 1.2, 0));
      P.push(put(new ConeGeometry(0.17, 0.45, 14), "brass", 0, 1.57, 0));
      // The windows of the keep, lit by the day's hours.
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        P.push(put(new BoxGeometry(0.06, 0.1, 0.01), "glow", Math.sin(a) * 0.255, 0.38, Math.cos(a) * 0.255, a));
      }
      break;
    }
    case "twin": {
      for (const [x, h] of [
        [-0.55, 1.05],
        [0.55, 1.2],
      ] as const) {
        P.push(put(new CylinderGeometry(0.2, 0.26, 0.12, 14), "stone", x, 0.06, 0));
        P.push(put(new CylinderGeometry(0.1, 0.14, h, 14), "stone", x, 0.12 + h / 2, 0));
        P.push(put(new CylinderGeometry(0.115, 0.115, 0.1, 14), "glow", x, 0.12 + h - 0.05, 0));
        P.push(put(new ConeGeometry(0.15, 0.38, 14), "brass", x, 0.12 + h + 0.19, 0));
      }
      const arc = new QuadraticBezierCurve3(new Vector3(-0.47, 0.82, 0), new Vector3(0, 1.25, 0), new Vector3(0.47, 0.9, 0));
      P.push({ geo: new TubeGeometry(arc, 24, 0.025, 6), mat: "brass" });
      const low = new QuadraticBezierCurve3(new Vector3(-0.45, 0.35, 0), new Vector3(0, 0.6, 0), new Vector3(0.45, 0.35, 0));
      P.push({ geo: new TubeGeometry(low, 20, 0.04, 6), mat: "stone" });
      break;
    }
    case "library": {
      P.push(put(new CylinderGeometry(0.66, 0.7, 0.06, 28), "stone", 0, 0.03, 0));
      P.push(put(new CylinderGeometry(0.6, 0.62, 0.06, 28), "stone", 0, 0.09, 0));
      P.push(put(new CylinderGeometry(0.42, 0.42, 0.42, 28), "stone", 0, 0.33, 0));
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        P.push(put(new CylinderGeometry(0.025, 0.03, 0.42, 6), "stone", Math.cos(a) * 0.53, 0.33, Math.sin(a) * 0.53));
      }
      P.push(put(new CylinderGeometry(0.58, 0.58, 0.05, 28), "brass", 0, 0.565, 0));
      const dome = new SphereGeometry(0.42, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      P.push(put(dome, "brass", 0, 0.59, 0));
      P.push(put(new CylinderGeometry(0.07, 0.07, 0.14, 10), "glow", 0, 1.06, 0));
      P.push(put(new ConeGeometry(0.09, 0.16, 10), "brass", 0, 1.21, 0));
      break;
    }
    case "theatre": {
      const prof = [
        [0.26, 0],
        [0.26, 0.04],
        [0.38, 0.04],
        [0.38, 0.1],
        [0.5, 0.1],
        [0.5, 0.17],
        [0.62, 0.17],
        [0.62, 0.25],
        [0.72, 0.25],
        [0.72, 0],
      ]
        .reverse()
        .map(([r, y]) => new Vector2(r!, y!));
      P.push(put(new LatheGeometry(prof, 28, Math.PI / 2, Math.PI), "stone"));
      P.push(put(new BoxGeometry(0.6, 0.05, 0.26), "stone", 0, 0.025, 0.14));
      P.push(put(new BoxGeometry(0.7, 0.07, 0.05), "brass", 0, 0.035, 0.29));
      for (let k = 0; k < 6; k++) P.push(put(new CylinderGeometry(0.02, 0.02, 0.16, 6), "brass", -0.3 + k * 0.12, 0.08, 0.3));
      P.push(put(new CircleGeometry(0.1, 16), "glow", 0, 0.052, 0.1, 0, -Math.PI / 2));
      break;
    }
    case "harbour": {
      P.push(put(new BoxGeometry(1.2, 0.1, 0.3), "stone", 0, 0.05, -0.1));
      P.push(put(new BoxGeometry(0.16, 0.08, 0.9), "wood", 0.42, 0.04, -0.6));
      house(P, -0.35, 0.18, 0.1, 0.32, 0.22, 0.24, 0);
      house(P, 0.0, 0.2, 0.1, 0.28, 0.22, 0.3, 0);
      house(P, 0.32, 0.2, 0.1, 0.26, 0.2, 0.2, 0);
      P.push(put(new CylinderGeometry(0.07, 0.09, 0.5, 10), "stone", -0.6, 0.35, -0.12));
      P.push(put(new CylinderGeometry(0.06, 0.06, 0.08, 10), "glow", -0.6, 0.64, -0.12));
      P.push(put(new ConeGeometry(0.09, 0.14, 10), "brass", -0.6, 0.75, -0.12));
      break;
    }
    case "compass": {
      P.push(put(new CylinderGeometry(0.6, 0.62, 0.05, 40), "brass", 0, 0.025, 0));
      const star = new Shape();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const r = k % 4 === 0 ? 0.55 : k % 2 === 0 ? 0.34 : 0.13;
        const [x, y] = [Math.cos(a) * r, Math.sin(a) * r];
        if (k === 0) star.moveTo(x, y);
        else star.lineTo(x, y);
      }
      const sg = new ExtrudeGeometry(star, {
        depth: 0.025,
        bevelEnabled: false,
      });
      sg.rotateX(-Math.PI / 2);
      P.push(put(sg, "stone", 0, 0.05, 0));
      P.push(put(new CylinderGeometry(0.05, 0.05, 0.06, 12), "glow", 0, 0.1, 0));
      break;
    }
    case "ghost": {
      const hill = new ConeGeometry(0.95, 0.7, 18, 5);
      const pos = hill.attributes.position as BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 0.34) {
          const f = 1 + (rnd() - 0.5) * 0.35;
          pos.setX(i, pos.getX(i) * f);
          pos.setZ(i, pos.getZ(i) * f);
        }
      }
      P.push(put(hill, "stone", 0, 0.35, 0));
      P.push(put(new CylinderGeometry(0.08, 0.11, 0.7, 8, 3), "stone", 0.18, 0.95, 0.05));
      P.push(put(new ConeGeometry(0.13, 0.26, 8), "stone", 0.18, 1.43, 0.05));
      break;
    }
  }
  return P;
}

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
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !PH;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(0x060508);
  scene.fog = new FogExp2(0x07060a, 0.018);
  const cam = new PerspectiveCamera(38, 1, 0.1, 140);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  let rs = 1;
  const rnd = () => {
    rs = (rs * 16807) % 2147483647;
    return (rs - 1) / 2147483646;
  };

  // ---- light: a hanging lamp over the table, candles at the far corners, a cool fill ---------------------------
  scene.add(new HemisphereLight(0x8f9ac8, 0x0a0806, 0.55));
  const lamp = new SpotLight(0xffe2b0, 420, 40, 0.62, 0.65, 1.4);
  lamp.position.set(-1.5, 15, 3);
  lamp.target.position.set(0, 0, 0.2);
  lamp.castShadow = !PH;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.camera.near = 6;
  lamp.shadow.camera.far = 30;
  scene.add(lamp, lamp.target);
  const rim = new DirectionalLight(0x9fb2ff, 0.35);
  rim.position.set(8, 6, -12);
  scene.add(rim);

  // ---- the table: walnut, a raised rim with a brass inlay, heavy legs ---------------------------------------------
  const woodTex = (() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3a2416";
    g.fillRect(0, 0, 512, 256);
    for (let y = 0; y < 256; y++) {
      const w = Math.sin(y * 0.21 + Math.sin(y * 0.031) * 4) * 0.5 + 0.5;
      g.fillStyle = `rgba(${18 + w * 30},${10 + w * 16},${6 + w * 8},${0.35 + w * 0.3})`;
      g.fillRect(0, y, 512, 1);
    }
    for (let k = 0; k < 140; k++) {
      const y = rnd() * 256;
      g.strokeStyle = `rgba(20,10,5,${0.15 + rnd() * 0.25})`;
      g.lineWidth = 0.6 + rnd();
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + k) * 3);
      g.stroke();
    }
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(2, 1);
    return t;
  })();
  const wood = keep(
    new MeshStandardMaterial({
      color: 0xb08868,
      map: woodTex,
      roughness: 0.55,
      metalness: 0.05,
    }),
  );
  const brassMat = keep(
    new MeshStandardMaterial({
      color: 0xc9a053,
      roughness: 0.32,
      metalness: 0.85,
      emissive: 0x2a1c06,
      emissiveIntensity: 0.6,
    }),
  );
  const table = new Group();
  scene.add(table);
  const W2 = MAP_W / 2;
  const D2 = MAP_D / 2;
  const RIM = 0.55;
  const slab = new Mesh(keep(new BoxGeometry(MAP_W + RIM * 2 + 0.3, 0.6, MAP_D + RIM * 2 + 0.3)), wood);
  slab.position.y = -0.36;
  slab.receiveShadow = true;
  table.add(slab);
  const rimH = 0.34;
  const rimPart = (w: number, d: number, x: number, z: number) => {
    const m = new Mesh(keep(new BoxGeometry(w, rimH, d)), wood);
    m.position.set(x, rimH / 2 - 0.06, z);
    m.castShadow = !PH;
    m.receiveShadow = true;
    table.add(m);
    const inlay = new Mesh(keep(new BoxGeometry(w - (w > d ? RIM : 0.04) + 0.02, 0.012, d - (d > w ? RIM : 0.04) + 0.02)), brassMat);
    inlay.scale.set(w > d ? 1 : 0.18, 1, d > w ? 1 : 0.18);
    inlay.position.set(x, rimH - 0.054, z);
    table.add(inlay);
  };
  rimPart(MAP_W + RIM * 2, RIM, 0, -D2 - RIM / 2);
  rimPart(MAP_W + RIM * 2, RIM, 0, D2 + RIM / 2);
  rimPart(RIM, MAP_D, -W2 - RIM / 2, 0);
  rimPart(RIM, MAP_D, W2 + RIM / 2, 0);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const cap = new Mesh(keep(new BoxGeometry(RIM + 0.06, 0.06, RIM + 0.06)), brassMat);
    cap.position.set(x * (W2 + RIM / 2), rimH - 0.03, z * (D2 + RIM / 2));
    table.add(cap);
    const leg = new Mesh(keep(new CylinderGeometry(0.42, 0.3, 6, 16)), wood);
    leg.position.set(x * (W2 - 0.4), -3.6, z * (D2 - 0.4));
    table.add(leg);
  }

  // ---- the chart: carved relief, painted ---------------------------------------------------------------------------
  const TW = PH ? 1024 : 2048;
  const TH = Math.round((TW * MAP_D) / MAP_W);
  const GW = 320;
  const GH = 200;
  const grid = new Float32Array((GW + 1) * (GH + 1));
  for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) grid[j * (GW + 1) + i] = heightAt(-W2 + (i / GW) * MAP_W, -D2 + (j / GH) * MAP_D);
  const hAt = (u: number, v: number) => {
    const fx = u * GW;
    const fy = v * GH;
    const i = Math.min(GW - 1, Math.floor(fx));
    const j = Math.min(GH - 1, Math.floor(fy));
    const a = fx - i;
    const b = fy - j;
    const g = (ii: number, jj: number) => grid[jj * (GW + 1) + ii]!;
    return (g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b;
  };
  await yieldNow();
  const paint = document.createElement("canvas");
  paint.width = TW;
  paint.height = TH;
  const pg = paint.getContext("2d")!;
  const glow = document.createElement("canvas");
  glow.width = TW;
  glow.height = TH;
  const gg = glow.getContext("2d")!;
  {
    const img = pg.createImageData(TW, TH);
    const d = img.data;
    const sea0 = [20, 34, 42];
    const sea1 = [38, 62, 70];
    const land0 = [150, 122, 80];
    const land1 = [204, 180, 132];
    const high = [140, 124, 98];
    for (let y = 0; y < TH; y++) {
      const v = y / (TH - 1);
      for (let x = 0; x < TW; x++) {
        const u = x / (TW - 1);
        const h = hAt(u, v);
        let r: number, g: number, b: number;
        if (h < 0) {
          const k = Math.min(1, -h * 2.4);
          r = sea1[0]! + (sea0[0]! - sea1[0]!) * k;
          g = sea1[1]! + (sea0[1]! - sea1[1]!) * k;
          b = sea1[2]! + (sea0[2]! - sea1[2]!) * k;
          // Coast-parallel ripples, as engravers drew them.
          const rip = Math.abs(((-h * 14) % 1) - 0.5);
          if (-h < 0.32 && rip < 0.07) {
            r += 26;
            g += 34;
            b += 34;
          }
        } else {
          const k = Math.min(1, h * 1.6);
          r = land0[0]! + (land1[0]! - land0[0]!) * k;
          g = land0[1]! + (land1[1]! - land0[1]!) * k;
          b = land0[2]! + (land1[2]! - land0[2]!) * k;
          if (h > 0.62) {
            const q = Math.min(1, (h - 0.62) * 3);
            r += (high[0]! - r) * q;
            g += (high[1]! - g) * q;
            b += (high[2]! - b) * q;
          }
          // Contours.
          const c = Math.abs(((h * 9) % 1) - 0.5);
          if (c > 0.455) {
            r *= 0.72;
            g *= 0.66;
            b *= 0.58;
          }
          // The coastline, inked.
          if (h < 0.025) {
            r = 52;
            g = 36;
            b = 24;
          }
        }
        const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        const grain = (n - Math.floor(n) - 0.5) * 10;
        const o = (y * TW + x) * 4;
        d[o] = r + grain;
        d[o + 1] = g + grain;
        d[o + 2] = b + grain;
        d[o + 3] = 255;
      }
      if (y % 64 === 63) await yieldNow();
    }
    pg.putImageData(img, 0, 0);
    gg.fillStyle = "#000";
    gg.fillRect(0, 0, TW, TH);
    // The chart's furniture, in gold leaf: a graticule, rhumb lines from two roses, the rose itself.
    const px = (x: number) => ((x + W2) / MAP_W) * TW;
    const pz = (z: number) => ((z + D2) / MAP_D) * TH;
    const s = TW / 2048;
    for (const g of [pg, gg]) {
      g.save();
      g.strokeStyle = g === pg ? "rgba(226,191,114,.42)" : "rgba(226,191,114,.55)";
      g.lineWidth = 1.4 * s;
      for (const [cx, cz] of [
        [-6.5, 3.7],
        [3.4, 3.4],
      ] as const) {
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2;
          g.globalAlpha = k % 4 === 0 ? 0.9 : 0.45;
          g.beginPath();
          g.moveTo(px(cx), pz(cz));
          g.lineTo(px(cx + Math.cos(a) * 30), pz(cz + Math.sin(a) * 30));
          g.stroke();
        }
      }
      g.globalAlpha = 0.5;
      g.setLineDash([10 * s, 8 * s]);
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
      g.setLineDash([]);
      // The Tide's corner: a blank chart in a dashed ring, waiting for its feed.
      g.globalAlpha = 0.85;
      g.lineWidth = 2.2 * s;
      g.setLineDash([16 * s, 10 * s]);
      g.beginPath();
      g.ellipse(px(6.0), pz(-3.2), (1.5 / MAP_W) * TW, (1.5 / MAP_D) * TH, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // A neat border inside the rim.
      g.globalAlpha = 0.9;
      g.lineWidth = 3 * s;
      g.strokeRect(14 * s, 14 * s, TW - 28 * s, TH - 28 * s);
      g.lineWidth = 1 * s;
      g.strokeRect(24 * s, 24 * s, TW - 48 * s, TH - 48 * s);
      g.restore();
    }
  }
  const mapTex = keep(new CanvasTexture(paint));
  mapTex.colorSpace = SRGBColorSpace;
  mapTex.anisotropy = 4;
  const glowTex = keep(new CanvasTexture(glow));
  glowTex.colorSpace = SRGBColorSpace;
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
        roughness: 0.78,
        metalness: 0.02,
        emissive: 0xffffff,
        emissiveMap: glowTex,
        emissiveIntensity: 0.18,
      }),
    ),
  );
  chart.receiveShadow = true;
  scene.add(chart);
  await yieldNow();

  // ---- the miniatures --------------------------------------------------------------------------------------------
  interface Mini {
    p: Place;
    g: Group;
    mats: Record<Mat, MeshStandardMaterial>;
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
  const wireMat = (ghost: boolean) =>
    keep(
      new ShaderMaterial({
        uniforms: {
          ...wireU,
          a: { value: ghost ? 0.7 : 0.1 },
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
            float fl = .78 + .22 * sin(t * 4. + h * 30.);
            float al = clamp(a + e * .55 + scan * (a * 1.6 + .08), 0., 1.) * fl;
            if (al < .01) discard;
            gl_FragColor = vec4(vec3(.89, .75, .45), al); }`,
      }),
    );
  const minis: Mini[] = [];
  const hits: { id: PlaceId; m: Mesh }[] = [];
  const hitMat = keep(new MeshBasicMaterial());
  for (const p of PLACES) {
    const parts = modelOf(p.kind, rnd);
    const ghost = p.kind === "ghost";
    const mats: Record<Mat, MeshStandardMaterial> = {
      stone: keep(
        new MeshStandardMaterial({
          color: 0x77736d,
          roughness: 0.42,
          metalness: 0.62,
          emissive: 0x000000,
          side: DoubleSide,
        }),
      ),
      brass: keep(brassMat.clone()),
      glow: keep(
        new MeshStandardMaterial({
          color: 0x2a2010,
          emissive: 0xffc56a,
          emissiveIntensity: 0.4,
          roughness: 0.4,
        }),
      ),
      sail: keep(
        new MeshStandardMaterial({
          color: 0xe8dcc2,
          roughness: 0.8,
          side: DoubleSide,
        }),
      ),
      wood: keep(new MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.7 })),
    };
    const g = new Group();
    g.position.set(p.x, groundOf(p), p.z);
    scene.add(g);
    const byMat = new Map<Mat, BufferGeometry[]>();
    const edges: BufferGeometry[] = [];
    let top = 0;
    for (const part of parts) {
      const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo;
      for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      byMat.set(part.mat, [...(byMat.get(part.mat) ?? []), geo]);
      edges.push(ghost ? new EdgesGeometry(geo, 1) : new EdgesGeometry(geo, 28));
      geo.computeBoundingBox();
      top = Math.max(top, geo.boundingBox!.max.y);
    }
    if (!ghost)
      for (const [m, geos] of byMat) {
        const mesh = new Mesh(keep(mergeGeometries(geos)!), mats[m]);
        mesh.castShadow = !PH;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
    const wire = new LineSegments(keep(mergeGeometries(edges)!), wireMat(ghost));
    wire.material.uniforms.top!.value = top;
    wire.renderOrder = 5;
    g.add(wire);
    const ring = new Mesh(
      keep(new TorusGeometry(p.kind === "citadel" || p.kind === "harbour" ? 0.95 : 0.8, 0.012, 6, 64)),
      keep(
        new MeshBasicMaterial({
          color: GOLD,
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
    if (!PH && (p.kind === "lighthouse" || p.kind === "citadel")) {
      light = new PointLight(0xffc77a, 0, 3.2, 1.6);
      light.position.set(0, top * 0.85, 0);
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

  // The harbour's ships, riding at anchor off the quay.
  const harbour = miniOf("ships");
  const ships: { g: Group; ph: number; x: number; z: number }[] = [];
  for (const [dx, dz, r] of [
    [-0.2, -1.55, 0.4],
    [0.75, -1.75, -0.3],
    [-1.0, -1.35, 1.1],
  ] as const) {
    const s = new Group();
    const hull = new CylinderGeometry(0.075, 0.075, 0.46, 10, 1, false, Math.PI / 2, Math.PI);
    hull.rotateZ(Math.PI / 2);
    hull.scale(1, 1, 1.25);
    const hm = new Mesh(keep(hull), harbour.mats.wood);
    hm.position.y = 0.075;
    hm.castShadow = !PH;
    s.add(hm);
    const mast = new Mesh(keep(new CylinderGeometry(0.008, 0.01, 0.42, 5)), harbour.mats.brass);
    mast.position.y = 0.26;
    s.add(mast);
    const sail = new Mesh(keep(new PlaneGeometry(0.24, 0.22, 1, 1)), harbour.mats.sail);
    sail.position.set(0, 0.29, 0);
    sail.rotation.y = Math.PI / 2;
    s.add(sail);
    s.position.set(harbour.p.x + dx, 0.0, harbour.p.z + dz);
    s.rotation.y = r;
    s.scale.setScalar(1.45);
    scene.add(s);
    ships.push({ g: s, ph: rnd() * 6, x: s.position.x, z: s.position.z });
  }

  // The d20, Historian violet, resting by the near rim.
  const d20 = new Mesh(
    keep(new IcosahedronGeometry(0.3, 0)),
    keep(
      new MeshStandardMaterial({
        color: 0x5a3c9e,
        roughness: 0.22,
        metalness: 0.15,
        emissive: 0x1a0d36,
        emissiveIntensity: 0.6,
      }),
    ),
  );
  d20.position.set(5.6, surfaceAt(5.6, 3.6) + 0.24, 3.6);
  d20.rotation.set(0.35, 0.6, 0.2);
  d20.castShadow = !PH;
  scene.add(d20);
  const d20w = new LineSegments(
    keep(new EdgesGeometry(d20.geometry)),
    keep(
      new MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ) as unknown as Material,
  );
  d20w.scale.setScalar(1.005);
  d20.add(d20w);
  // Brass dividers left open on the chart.
  const dividers = new Group();
  for (const s of [-1, 1]) {
    const leg = new Mesh(keep(new BoxGeometry(1.3, 0.03, 0.05)), brassMat);
    leg.position.set(0.62, 0, 0);
    const arm = new Group();
    arm.add(leg);
    arm.rotation.y = s * 0.16;
    dividers.add(arm);
  }
  const hinge = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 0.06, 12)), brassMat);
  dividers.add(hinge);
  dividers.position.set(2.7, surfaceAt(2.7, 3.7) + 0.06, 3.7);
  dividers.rotation.y = 2.6;
  scene.add(dividers);
  // Candles on the far corners of the rim.
  const flameTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 38, 0, 32, 34, 30);
    gr.addColorStop(0, "rgba(255,240,200,1)");
    gr.addColorStop(0.3, "rgba(255,190,90,.7)");
    gr.addColorStop(1, "rgba(255,140,40,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const flames: { s: Sprite; l: PointLight | null; ph: number }[] = [];
  for (const x of [-1, 1]) {
    const cx = x * (W2 + RIM / 2);
    const cz = -D2 - RIM / 2;
    const candle = new Mesh(
      keep(new CylinderGeometry(0.11, 0.12, 0.62, 14)),
      keep(
        new MeshStandardMaterial({
          color: 0xe9dcc0,
          roughness: 0.9,
          emissive: 0x3a2208,
          emissiveIntensity: 0.4,
        }),
      ),
    );
    candle.position.set(cx, rimH + 0.31, cz);
    scene.add(candle);
    const s = new Sprite(
      keep(
        new SpriteMaterial({
          map: flameTex,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    s.scale.set(0.3, 0.46, 1);
    s.position.set(cx, rimH + 0.78, cz);
    scene.add(s);
    const l = PH ? null : new PointLight(0xffb060, 3.2, 7, 1.8);
    l?.position.set(cx, rimH + 0.9, cz);
    if (l) scene.add(l);
    flames.push({ s, l, ph: rnd() * 6 });
  }
  await yieldNow();

  // ---- nanites: the sigil atlas -------------------------------------------------------------------------------------
  try {
    await document.fonts.load('40px "Noto Sans Runic"', "ᚠ");
  } catch {
    /* the fallback glyphs are fine */
  }
  const atlas = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `44px "Noto Sans Runic","Geist Mono Variable",monospace`;
    GLYPHS.slice(0, 64).forEach((ch, i) => g.fillText(ch, (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34));
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const NG = GLYPHS.length;
  const edgeU = {
    t: { value: 0 },
    res: wireU.res,
    atlas: { value: atlas },
    px: { value: renderer.getPixelRatio() },
  };

  // Glyphs rising off each place: a loose column that thickens with the place's level, and many more off the Tide.
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
        uniforms: edgeU,
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
            gl_FragColor = vec4(vec3(.93, .79, .5), m * vA); }`,
      }),
    ),
  );
  nanites.frustumCulled = false;
  nanites.renderOrder = 8;
  scene.add(nanites);

  // ---- the edges of the frame come undone: a veil, the gold grid the table stands in, code on it ------------------
  const veil = new Mesh(
    keep(new PlaneGeometry(2, 2)),
    keep(
      new ShaderMaterial({
        uniforms: edgeU,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: `void main(){ gl_Position = vec4(position.xy, 0., 1.); }`,
        fragmentShader: `uniform float t; ${EDGE}
          void main(){ float e = smoothstep(.56, 1.02, edgeOf()); if (e < .01) discard;
            float g = hash(vec3(floor(gl_FragCoord.xy / 3.), floor(t * 6.)));
            float scan = .5 + .5 * sin(gl_FragCoord.y * .9 + t * 2.);
            vec3 c = vec3(.025, .02, .03) + vec3(.79, .66, .36) * e * .05 * scan;
            gl_FragColor = vec4(c, e * (.6 + .14 * g)); }`,
      }),
    ),
  );
  veil.frustumCulled = false;
  veil.renderOrder = 20;
  scene.add(veil);
  const wire: number[] = [];
  const GX = 30;
  const GZ = 22;
  const FY = -0.08;
  for (let x = -GX; x <= GX; x += 1) wire.push(x, FY, -GZ, x, FY, GZ);
  for (let z = -GZ; z <= GZ; z += 1) wire.push(-GX, FY, z, GX, FY, z);
  // The table's own outline and its legs, traced.
  const ow = W2 + RIM + 0.15;
  const od = D2 + RIM + 0.15;
  for (const y of [0.3, -0.66]) wire.push(-ow, y, -od, ow, y, -od, ow, y, -od, ow, y, od, ow, y, od, -ow, y, od, -ow, y, od, -ow, y, -od);
  for (const [x, z] of [
    [-ow, -od],
    [ow, -od],
    [-ow, od],
    [ow, od],
  ] as const)
    wire.push(x, 0.3, z, x, -6, z);
  const wireGeo = keep(new BufferGeometry());
  wireGeo.setAttribute("position", new BufferAttribute(new Float32Array(wire), 3));
  const wires = new LineSegments(
    wireGeo,
    keep(
      new ShaderMaterial({
        uniforms: edgeU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float t; varying vec3 vW; ${EDGE}
          void main(){ float e = smoothstep(.36, .92, edgeOf()); float near = 1. - smoothstep(9., 24., length(vW.xz));
            float a = max(e, near * .22); if (a < .01) discard;
            vec3 cell = floor(vW * 1.6); float h = hash(cell + floor(t * .7 + hash(cell) * 4.));
            if (h < .3 - e * .2) discard;
            float fl = .75 + .25 * sin(t * 3. + h * 40.);
            gl_FragColor = vec4(vec3(.79, .66, .36) * fl, a * .62); }`,
      }),
    ),
  );
  wires.frustumCulled = false;
  wires.renderOrder = 21;
  scene.add(wires);
  // Code on the grid and the rim, rising and winking; and sigils peeling off the wires.
  const NE = PH ? 380 : 1100;
  const ep = new Float32Array(NE * 3);
  const eg = new Float32Array(NE);
  const er = new Float32Array(NE);
  for (let i = 0; i < NE; i++) {
    let x = (rnd() - 0.5) * GX * 1.6;
    let z = (rnd() - 0.5) * GZ * 1.6;
    let y = FY;
    if (rnd() < 0.3) {
      // On the rim and the table's flanks.
      const side = Math.floor(rnd() * 4);
      x = side < 2 ? (rnd() - 0.5) * ow * 2 : side === 2 ? -ow : ow;
      z = side >= 2 ? (rnd() - 0.5) * od * 2 : side === 0 ? -od : od;
      y = -0.6 + rnd() * 0.9;
    }
    ep.set([x, y, z], i * 3);
    eg[i] = Math.floor(rnd() * NG);
    er[i] = rnd();
  }
  const eGeo = keep(new BufferGeometry());
  eGeo.setAttribute("position", new BufferAttribute(ep, 3));
  eGeo.setAttribute("glyph", new BufferAttribute(eg, 1));
  eGeo.setAttribute("rnd", new BufferAttribute(er, 1));
  const codeDust = new Points(
    eGeo,
    keep(
      new ShaderMaterial({
        uniforms: edgeU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd; uniform float t, px; varying vec2 vCell; varying float vR;
          void main(){ vR = rnd; float g = mod(glyph + floor(t * .8 + rnd * 9.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position; p.y += fract(t * .03 + rnd) * 1.4;
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.6 + rnd * .6) * 24. * px * (6. / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; uniform float t; varying vec2 vCell; varying float vR; ${EDGE}
          void main(){ float e = smoothstep(.42, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float wink = .45 + .55 * sin(t * 1.7 + vR * 50.);
            gl_FragColor = vec4(mix(vec3(.79, .66, .36), vec3(.89, .79, .55), vR), m * e * wink * .8); }`,
      }),
    ),
  );
  codeDust.frustumCulled = false;
  codeDust.renderOrder = 22;
  scene.add(codeDust);

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
    renderer.getDrawingBufferSize(edgeU.res.value);
    edgeU.px.value = renderer.getPixelRatio();
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
  let T = 0;
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
    edgeU.t.value = T;
    wireU.t.value = T;
    for (const m of minis) (m.wire.material.uniforms.t as { value: number }).value = T;
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
    // The places: lit from real state, warmer under the pointer and while open.
    let i = 0;
    for (const [mi, m] of minis.entries()) {
      const on = m.p.id === hover || m.p.id === hoverExt || m.p.id === open;
      m.hov += ((on ? 1 : 0) - m.hov) * Math.min(1, dt * 6);
      m.lit += ((m.state.lit ? 1 : 0) - m.lit) * Math.min(1, dt * 3);
      m.level += (m.state.level - m.level) * Math.min(1, dt * 3);
      const ghost = m.p.kind === "ghost";
      m.mats.stone.color.setRGB(0.3 + 0.17 * m.lit, 0.29 + 0.16 * m.lit, 0.28 + 0.15 * m.lit);
      m.mats.stone.emissive.setRGB(0.18 * m.hov, 0.13 * m.hov, 0.05 * m.hov);
      const flick = reduce ? 1 : 0.9 + 0.1 * Math.sin(T * 7 + mi);
      m.mats.glow.emissiveIntensity = (0.15 + m.level * 2.2 * m.lit + m.hov * 0.8) * flick;
      if (m.light) m.light.intensity = (m.level * 2.6 + m.hov * 1.5) * m.lit * flick;
      (m.wire.material.uniforms.a as { value: number }).value = ghost ? 0.55 + 0.25 * m.hov + 0.1 * Math.sin(T * 2) : 0.05 + 0.5 * m.hov + (1 - m.lit) * 0.25;
      m.ring.material.opacity = m.hov * 0.85;
      m.ring.scale.setScalar(1 + (reduce ? 0 : Math.sin(T * 2.4) * 0.03 * m.hov));
      const w = ghost ? 0.45 + 0.35 * m.hov : (0.1 + 0.5 * m.level * m.lit + 0.55 * m.hov) * (0.6 + 0.4 * m.lit);
      for (let n = 0; n < counts[mi]!; n++, i++) nw[i] = w * (nr[i]! < 0.35 + 0.65 * Math.max(m.level, m.hov) || ghost ? 1 : 0);
    }
    (nGeo.attributes.w as BufferAttribute).needsUpdate = true;
    if (!reduce) {
      for (const s of ships) {
        s.g.position.y = Math.sin(T * 1.3 + s.ph) * 0.012;
        s.g.rotation.z = Math.sin(T * 1.1 + s.ph) * 0.05;
        s.g.rotation.x = Math.sin(T * 0.9 + s.ph * 2) * 0.03;
      }
      for (const f of flames) {
        const q = 0.85 + 0.15 * Math.sin(T * 9 + f.ph) * Math.sin(T * 5.3 + f.ph * 2);
        f.s.scale.set(0.3 * q, 0.46 * (0.9 + 0.2 * q), 1);
        if (f.l) f.l.intensity = 3.2 * q;
      }
    }
    renderer.render(scene, cam);
  };
  await yieldNow();
  await renderer.compileAsync(scene, cam).catch(() => undefined);
  await yieldNow();
  cam.position.set(Math.sin(yaw) * Math.sin(pitch) * dist, Math.cos(pitch) * dist, look.z + Math.cos(yaw) * Math.sin(pitch) * dist);
  cam.lookAt(look);
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
