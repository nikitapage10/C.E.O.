import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AnimationMixer,
  Box3,
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
  EdgesGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PointLight,
  Points,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { cachedModel } from "@ceo/desk/modelCache.ts";
import { comeUndone, glyphMaterial, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { edgeFactor, SOFT, wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { modelUrl } from "../../../apps/world/src/modelUrl.ts";
import { paintDock } from "../../../apps/world/src/agents/dockPaint.ts";
import { poseCompactor, rigCompactor } from "../../../apps/world/src/agents/bodies/compactorPose.ts";
import { legsOf, poseRocky, rigRocky, type RockyRig } from "../../../apps/world/src/agents/bodies/rockyPose.ts";
import { DOCK_CREW } from "../../../apps/world/src/foundry.ts";
import { SHAFT, type CoilState } from "../data/furnace.ts";

/**
 * The Deep Furnace in 3D (#813, second pass #922): a forge shaft sunk into the floor of an old lab, drawn the way the
 * Senate draws its chamber. Solid models in the middle (the crucible of molten work on its pedestal, the deck, the four
 * slots with their anvils, the chains, the sigil rings of the checks, the hatch to the surface) with a gold wire skin
 * and sigil nanites over them, and the frame's edges coming undone into gold wire and code (the shared helper,
 * @ceo/engine/sigils/undone.ts).
 *
 * The crew are their real Lattice bodies, loaded from the same models the Lattice wears: Rusty's salvage compactor
 * (compactor.glb) as made, Dusty, Gusty and Musty in the same frame in their own paint (dockPaint.ts), Rocky's Eridian
 * carapace (Rocky.glb) and Rivet's hard hat and hi-vis (the Worker body with the humans' clips), each posed by the
 * Lattice's own pose code. Rocky keeps his drafting table on the left and, when he takes a slot, comes apart into
 * nanites and puts himself back together at its anvil; Rivet keeps her hoist and alarm post on the right. A body that
 * fails to load is left out, never stood in for.
 *
 * Every job starts in the crucible and rises on its builder's chain as it gets built: worked on the anvils (Work), up
 * through the Pictures ring and the five sigil rings (the checks), and out of the hatch's sigil circle (Ship). Height
 * is real progress (data/furnace.ts) and heat is how far it has to go: white-hot at the bottom, gold as it cools. A red
 * check turns its ingot red and drops it back under the rings; a free slot's hand sleeps on its charging ring.
 *
 * WASD swivels the view round the shaft (#922): A/D orbit within a set arc, W/S dolly within tight bounds, both soft at
 * the edge and eased back inside it, Escape home; never while typing, and Space is left to hold-to-talk.
 *
 * Phones get fewer particles, a lower pixel ratio and 30 frames a second; reduced motion holds the scene nearly still.
 * Lazy loaded with three.js (FurnaceStage.tsx), never in the Desk's first load.
 */

export interface FurnaceSlotView {
  hand: string;
  /** The hand's paint, hex. */
  paint: string;
  /** A job hangs on this chain. */
  busy: boolean;
  /** How high it hangs, 0..1 (data/furnace.ts, heightOf). */
  u: number;
  coil: CoilState;
  /** Something's wrong: checks red or stuck. */
  bad: boolean;
  /** Waiting its turn or paused: in hand, not moving. */
  held: boolean;
  /** On the anvil now: the hand works it. */
  hammer: boolean;
  /** Waiting for Nikita's OK. */
  ready: boolean;
}

export interface FurnaceView {
  /** The four slots, left to right. */
  slots: FurnaceSlotView[];
  /** Rivet's hoist: her first job, or null with nothing on it. */
  rivet: FurnaceSlotView | null;
  queue: number;
  shipped: number;
  /** main's own checks, on the hatch's sigil circle. */
  main: CoilState;
}

export interface FurnaceOpts {
  phone: boolean;
  reduce: boolean;
  view: FurnaceView;
  /**
   * Where each anchor is on screen (host CSS pixels), every frame it moves: s0..s3, rivet, rocky, queue, ship, z-*,
   * c0..c4, and the shaft's two sides (shaft-l, shaft-r) so the overlay can keep its cards off it.
   */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
  /** The pointer is over a slot, Rivet, Rocky, the cart or the hatch (or nothing). */
  onPoint: (id: string | null) => void;
  onPick: (id: string) => void;
}

export interface Furnace {
  set: (view: FurnaceView) => void;
  setHot: (id: string | null) => void;
  dispose: () => void;
}

const PHONE_W = 760;
/** The crucible's mouth and the hatch, in world units: the shaft between them is SHAFT's 0..1. */
const Y0 = 1.9;
const Y1 = 19.4;
const yAt = (u: number) => Y0 + u * (Y1 - Y0);
/** The chains' x, left to right; Rivet's hoist stands apart. */
const CHAIN_X = [-2.4, -0.8, 0.8, 2.4];
const RIVET_AT = new Vector3(9.6, 0, 1.4);
const ROCKY_HOME = new Vector3(-9.4, 0, 1.6);
const COIL_R = 3.7;
const WALL_R = 16;
/** The crew's heights in the furnace: the Lattice's proportions (agents/bodies/types.ts), a size up. */
const H_COMPACTOR = 1.3 * 1.85;
const H_ROCKY = 1.0 * 1.9;
const H_RIVET = 1.76 * 1.6;
const GOLD = new Color(0xc9a85c);
const GOLD_HI = new Color(0xe8c77a);
const GOLD_WHITE = new Color(0xfff0c8);
const GOLD_DIM = new Color(0x6a5428);
const WHITE_HOT = new Color(0xffd27a);
const EMBER = new Color(0xff6a1a);
const AMBER = new Color(0xff9a2a);
const COOL = new Color(0xe8b04e);
const RED = new Color(0xff3b2a);
/** How a ring reads, in the gold of the Lattice: dim at rest, amber while it runs, white-gold once passed, red when cracked. */
const RING_COL: Record<CoilState, Color> = { wait: GOLD_DIM, run: AMBER, pass: GOLD_WHITE, fail: RED };
/** The swivel: how far either way the view turns from its home (rad), and how far it dollies in or out (share). */
const ARC = 0.6;
const ZOOM_ARC = 0.18;
/** A step of a bounded swivel: free inside the soft edge, resisted past it outward, stopped at the limit. */
function swing(v: number, d: number, lim: number): number {
  const out = d !== 0 && Math.sign(d) === Math.sign(v);
  return Math.max(-lim, Math.min(lim, v + (out ? d * edgeFactor(Math.abs(v) / lim) : d)));
}
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/** Heat for a height: white-hot in the crucible, ember, amber, cooled gold near the hatch. */
function heatCol(u: number, out: Color) {
  const h = Math.max(0, Math.min(1, u / SHAFT.ship));
  if (h < 0.25) return out.copy(WHITE_HOT).lerp(EMBER, h / 0.25);
  if (h < 0.6) return out.copy(EMBER).lerp(AMBER, (h - 0.25) / 0.35);
  return out.copy(AMBER).lerp(COOL, (h - 0.6) / 0.4);
}

type Mode = "working" | "idle" | "napping" | "walking";

/** One of the crew in the furnace: their real body, posed by the Lattice's own code. */
interface Bot {
  g: Group;
  pose: (mode: Mode, t: number, dt: number) => void;
  /** The charging ring a sleeping hand stands on. */
  ring: MeshBasicMaterial;
  /** Forget planted feet after a move (Rocky). */
  moved: () => void;
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The crew's models, loaded once per visit (modelCache.ts) and shared with every other Desk scene that wears them. */
const CREW_MODELS = { compactor: "compactor.glb", rocky: "lib/custom/Rocky.glb", rivet: "lib/women/Worker.glb", humans: "lib/anims/humans.glb" } as const;
function loadModel(path: string): Promise<GLTF | null> {
  return cachedModel<GLTF>(path, () => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(modelUrl(path));
  }).catch(() => null);
}

/** A model scaled to stand `height` tall on its own origin. */
function standTall(model: Object3D, height: number) {
  const box = new Box3().setFromObject(model, true);
  const h = Math.max(0.01, box.max.y - box.min.y);
  model.scale.setScalar(height / h);
  model.position.y = -box.min.y * (height / h);
}

export async function createFurnace(host: HTMLElement, canvas: HTMLCanvasElement, opts: FurnaceOpts): Promise<Furnace> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  // The crew's bodies load while the forge is built (each one cached for the visit).
  const models = Promise.all([loadModel(CREW_MODELS.compactor), loadModel(CREW_MODELS.rocky), loadModel(CREW_MODELS.rivet), loadModel(CREW_MODELS.humans)]);
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.25 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new Scene();
  scene.background = new Color(0x060608);
  scene.fog = new FogExp2(0x07070a, 0.017);
  const cam = new PerspectiveCamera(44, 1, 0.1, 160);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const mesh = <M extends Material>(g: BufferGeometry, m: M) => new Mesh(keep(g), m);

  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x8d9bc4, 0x1c0d05, 0.95));
  const rim = new DirectionalLight(0x9fb4ff, 0.75);
  rim.position.set(-8, 14, -10);
  const fill = new DirectionalLight(0xffd9a8, 1.25);
  fill.position.set(6, 8, 14);
  scene.add(rim, fill);
  const melt = new PointLight(0xff7a2a, 80, 34, 1.7);
  melt.position.set(0, Y0 + 0.9, 0);
  scene.add(melt);
  const sky = new SpotLight(0xfff0d0, 140, 30, 0.42, 0.7, 1.3);
  sky.position.set(0, Y1 + 5, 0);
  sky.target.position.set(0, 4, 0);
  scene.add(sky, sky.target);
  // The crew's corners: a warm lamp over each, so the bodies read at the edges of the deck.
  for (const at of [RIVET_AT, ROCKY_HOME]) {
    const l = new PointLight(0xffd9a0, 18, 9, 1.6);
    l.position.set(at.x, 4.2, at.z + 1.4);
    scene.add(l);
  }

  // Shared materials.
  const iron = keep(new MeshStandardMaterial({ color: 0x2a2724, metalness: 0.78, roughness: 0.42 }));
  const ironDark = keep(new MeshStandardMaterial({ color: 0x151414, metalness: 0.7, roughness: 0.55 }));
  const steel = keep(new MeshStandardMaterial({ color: 0x77736c, metalness: 0.9, roughness: 0.3 }));
  const brass = keep(new MeshStandardMaterial({ color: 0x9c7c3c, metalness: 0.9, roughness: 0.32, emissive: 0x2a1e08 }));
  const goldLine = keep(new LineBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: 0.34, depthWrite: false }));
  /** A wire skin over a solid: its hard edges in gold, the Lattice's drawing showing through. */
  const skin = (m: Mesh, op = 0.34, angle = 24) => {
    const e = new LineSegments(keep(new EdgesGeometry(m.geometry, angle)), op === 0.34 ? goldLine : keep(new LineBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: op, depthWrite: false })));
    m.add(e);
    return m;
  };
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.25, "rgba(255,255,255,.45)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const glow = (col: Color | number, size: number, op: number) => {
    const s = new Sprite(keep(new SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: AdditiveBlending })));
    s.scale.setScalar(size);
    return s;
  };

  // ---- the deck and the shaft -----------------------------------------------------------------------------------
  const deckTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1c1a18";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#0d0c0b";
    g.lineWidth = 3;
    for (let i = 0; i <= 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,.035)";
    for (let i = 0; i < 400; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    const t = keep(new CanvasTexture(c));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(14, 14);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const deck = mesh(new CircleGeometry(WALL_R + 2, 120), keep(new MeshStandardMaterial({ map: deckTex, color: 0x8a8580, metalness: 0.6, roughness: 0.55 })));
  deck.rotation.x = -Math.PI / 2;
  scene.add(deck);
  const goldRing = (r: number, y: number, op: number, w = 0.012) => {
    const m = mesh(new TorusGeometry(r, w, 6, 200), keep(new MeshBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: op })));
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    scene.add(m);
    return m;
  };
  [4.2, 8.2, 11.6].forEach((r, i) => goldRing(r, 0.015, 0.42 - i * 0.1));

  // The shaft's back wall: the old lab's server racks, dark, a few lights still blinking in them.
  const rackTex = (() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0e0d0c";
    g.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 64)
      for (let y = 0; y < 512; y += 128) {
        g.fillStyle = "#1a1816";
        g.fillRect(x + 4, y + 4, 56, 120);
        for (let u = 0; u < 13; u++) {
          const yy = y + 9 + u * 9;
          g.fillStyle = Math.random() < 0.5 ? "#24211d" : "#171513";
          g.fillRect(x + 8, yy, 48, 6);
          if (Math.random() < 0.3) {
            g.fillStyle = Math.random() < 0.8 ? "#ffa04a" : "#e3c98d";
            g.globalAlpha = 0.35 + Math.random() * 0.65;
            g.fillRect(x + 10 + Math.random() * 38, yy + 1, 3, 3);
            g.globalAlpha = 1;
          }
        }
      }
    const t = keep(new CanvasTexture(c));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(12, 4);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const wallMat = keep(new MeshStandardMaterial({ map: rackTex, emissiveMap: rackTex, emissive: 0xffffff, emissiveIntensity: 0.95, color: 0xb0a99e, metalness: 0.5, roughness: 0.7, side: DoubleSide }));
  // The back half of the shaft (the front is open to the deck).
  const wall = mesh(new CylinderGeometry(WALL_R, WALL_R, 30, 96, 1, true, Math.PI / 2 + 0.12, Math.PI - 0.24), wallMat);
  wall.position.y = 13;
  scene.add(wall);
  // Ribs: the shaft's iron, solid.
  {
    const ribG = keep(new BoxGeometry(0.46, 30, 0.55));
    const n = 15;
    const ribs = new InstancedMesh(ribG, ironDark, n);
    const M = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + 0.16 + (k / (n - 1)) * (Math.PI - 0.32);
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      M.compose(new Vector3(Math.sin(a) * (WALL_R - 0.3), 13, Math.cos(a) * (WALL_R - 0.3)), q, new Vector3(1, 1, 1));
      ribs.setMatrixAt(k, M);
    }
    scene.add(ribs);
  }

  // ---- the crucible -----------------------------------------------------------------------------------------------
  const pedestal = mesh(new CylinderGeometry(2.2, 2.6, 0.5, 48), iron);
  pedestal.position.y = 0.25;
  scene.add(skin(pedestal, 0.22));
  const bowlPts = [
    [1.2, 0.0],
    [2.2, 0.15],
    [2.95, 0.6],
    [3.25, 1.2],
    [3.2, 1.75],
    [3.35, 1.86],
    [3.36, 1.98],
    [3.0, 1.98],
    [2.85, 1.7],
    [2.5, 1.0],
    [1.4, 0.55],
    [0.2, 0.5],
  ].map(([x, y]) => new Vector2(x!, y!));
  const bowl = mesh(new LatheGeometry(bowlPts, PH ? 48 : 72), keep(new MeshStandardMaterial({ color: 0x2b2522, metalness: 0.82, roughness: 0.36, emissive: 0x2a0c02 })));
  bowl.position.y = 0.45;
  scene.add(bowl);
  {
    const w = new LineSegments(keep(new EdgesGeometry(keep(new LatheGeometry(bowlPts.slice(0, 7), 24)), 1)), keep(new LineBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: 0.16, depthWrite: false })));
    w.position.y = 0.45;
    w.scale.setScalar(1.012);
    scene.add(w);
  }
  const lip = mesh(new TorusGeometry(3.3, 0.07, 10, 120), brass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 2.45;
  scene.add(lip);
  for (const [y, r] of [
    [1.1, 3.06],
    [1.75, 3.26],
  ] as const) {
    const b = mesh(new TorusGeometry(r, 0.06, 8, 120), steel);
    b.rotation.x = Math.PI / 2;
    b.position.y = y;
    scene.add(b);
  }
  // The molten work: a churning surface, white-hot under a crust of gold sigils.
  const meltU = { t: { value: 0 } };
  const molten = mesh(
    new CircleGeometry(2.98, 64),
    keep(
      new ShaderMaterial({
        uniforms: meltU,
        vertexShader: `varying vec2 vU; void main(){ vU = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform float t; varying vec2 vU;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
            return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*n(p); p = p*2.03 + 1.7; a *= .5; } return s; }
          void main(){ float r = length(vU); vec2 p = vU*1.3;
            float a = fbm(p + vec2(t*.12, -t*.09)); float b = fbm(p*1.7 - vec2(t*.07, t*.11) + a);
            float crust = smoothstep(.55, .72, b);
            vec3 hot = mix(vec3(1., .42, .08), vec3(1., .93, .7), smoothstep(.3, .75, a));
            vec3 c = mix(hot, vec3(.42, .12, .02), crust*.75);
            c *= 1.0 + .35*sin(t*1.7 + r*3.);
            c = mix(c, vec3(.9,.35,.06), smoothstep(2.4, 2.98, r));
            gl_FragColor = vec4(c*1.25, 1.); }`,
      }),
    ),
  );
  molten.rotation.x = -Math.PI / 2;
  molten.position.y = Y0 + 0.2;
  scene.add(molten);
  const meltGlow = glow(0xff8a3d, 11, 0.55);
  meltGlow.position.set(0, Y0 + 0.8, 0);
  scene.add(meltGlow);
  const meltGlow2 = glow(0xffd28a, 4.5, 0.5);
  meltGlow2.position.set(0, Y0 + 0.5, 0);
  scene.add(meltGlow2);

  // ---- the shaft's rings: Pictures, the five checks, the hatch, all in brass and sigils -----------------------------
  /** A thin brass band, its glow (the emissive) carrying the ring's state. */
  const band = (r: number, y: number, tube: number) => {
    const m = keep(new MeshStandardMaterial({ color: 0x8a6a30, metalness: 0.92, roughness: 0.28, emissive: GOLD.clone(), emissiveIntensity: 0.25 }));
    const b = mesh(new TorusGeometry(r, tube, 8, 160), m);
    b.rotation.x = Math.PI / 2;
    b.position.y = y;
    scene.add(b);
    return m;
  };
  // Pictures: a double band with four lenses looking in, one at each chain.
  const picY = yAt(SHAFT.pictures);
  band(COIL_R + 0.3, picY + 0.14, 0.035);
  band(COIL_R + 0.3, picY - 0.14, 0.035);
  const lensMats: MeshBasicMaterial[] = [];
  CHAIN_X.forEach((x) => {
    const z = Math.sqrt(COIL_R * COIL_R - x * x);
    const housing = mesh(new BoxGeometry(0.3, 0.26, 0.36), iron);
    housing.position.set(x * 1.08, picY, z * 1.08);
    housing.lookAt(0, picY, 0);
    const lm = keep(new MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.35 }));
    lensMats.push(lm);
    const lens = mesh(new CircleGeometry(0.09, 16), lm);
    lens.position.z = 0.185;
    housing.add(lens);
    scene.add(skin(housing, 0.45));
  });
  // The five checks: a brass band each, typecheck at the bottom, with a sigil bead per chain for that job's state.
  const coilMats: MeshStandardMaterial[] = [];
  const beadMats: MeshBasicMaterial[][] = [];
  const beadG = keep(new OctahedronGeometry(0.11, 0));
  SHAFT.coils.forEach((u) => {
    const y = yAt(u);
    coilMats.push(band(COIL_R, y, 0.04));
    beadMats.push(
      CHAIN_X.map((x) => {
        const z = Math.sqrt(COIL_R * COIL_R - x * x);
        const bm = keep(new MeshBasicMaterial({ color: GOLD_DIM.clone() }));
        const b = new Mesh(beadG, bm);
        b.position.set(x, y, z);
        b.scale.set(1, 1.5, 1);
        scene.add(b);
        return bm;
      }),
    );
  });
  // Three brass struts tie the rings together at the back.
  for (const a of [Math.PI * 0.82, Math.PI * 1.18, Math.PI * 1.5]) {
    const top = yAt(SHAFT.ship);
    const p = mesh(new CylinderGeometry(0.05, 0.05, top - picY + 0.6, 8), brass);
    p.position.set(Math.sin(a) * COIL_R, (top + picY) / 2, Math.cos(a) * COIL_R);
    scene.add(p);
  }
  // The hatch: a sigil circle (two brass bands with runes turning between them), main's checks in its light.
  const hatchY = yAt(SHAFT.ship);
  const hatchIn = band(COIL_R + 0.3, hatchY, 0.07);
  const hatchOut = band(COIL_R + 1.05, hatchY, 0.05);
  const hatchLight = mesh(new TorusGeometry(COIL_R + 0.05, 0.022, 6, 160), keep(new MeshBasicMaterial({ color: GOLD.clone(), transparent: true, opacity: 0.9 })));
  hatchLight.rotation.x = Math.PI / 2;
  hatchLight.position.y = hatchY - 0.06;
  scene.add(hatchLight);
  const gantryY = Y1 + 1.4;
  const gantry = mesh(new BoxGeometry(COIL_R * 2 + 2.4, 0.38, 0.5), ironDark);
  gantry.position.set(0, gantryY, 0);
  scene.add(skin(gantry, 0.3));
  for (const s of [-1, 1]) {
    const leg = mesh(new BoxGeometry(0.34, gantryY - hatchY + 0.2, 0.34), ironDark);
    leg.position.set(s * (COIL_R + 1.25), (gantryY + hatchY) / 2, 0);
    scene.add(skin(leg, 0.25));
  }
  const winchMats: MeshStandardMaterial[] = [];
  CHAIN_X.forEach((x) => {
    const wm = keep(new MeshStandardMaterial({ color: 0xd0844a, metalness: 0.45, roughness: 0.5 }));
    winchMats.push(wm);
    const w = mesh(new CylinderGeometry(0.26, 0.26, 0.5, 18), wm);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, gantryY - 0.4, 0.05);
    scene.add(w);
  });
  // The surface beyond the hatch: pale daylight down the shaft.
  const skyDisc = mesh(new CircleGeometry(COIL_R + 1.2, 48), keep(new MeshBasicMaterial({ color: 0xfff1d2, transparent: true, opacity: 0.16, side: DoubleSide, blending: AdditiveBlending, depthWrite: false })));
  skyDisc.rotation.x = Math.PI / 2;
  skyDisc.position.y = Y1 + 3.6;
  scene.add(skyDisc);
  const beamMat = keep(new MeshBasicMaterial({ color: 0xffe9c0, transparent: true, opacity: 0.05, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  const beam = mesh(new CylinderGeometry(COIL_R + 0.6, 2.6, Y1 - 4, 48, 1, true), beamMat);
  beam.position.y = (Y1 + 3.6 + 6) / 2;
  scene.add(beam);
  const skyGlow = glow(0xfff0d0, 14, PH ? 0.18 : 0.3);
  skyGlow.position.set(0, Y1 + 3, 0);
  scene.add(skyGlow);
  // Today's ships: finished plates stacked on the gantry, one each.
  const plateMat = keep(new MeshStandardMaterial({ color: 0xc9a85c, metalness: 0.95, roughness: 0.22, emissive: 0x6a4a12, emissiveIntensity: 0.6 }));
  const plates = Array.from({ length: 8 }, (_, i) => {
    const p = mesh(new BoxGeometry(0.5, 0.1, 0.32), plateMat);
    p.position.set(COIL_R + 0.95 - (i % 4) * 0.56, gantryY + 0.25 + Math.floor(i / 4) * 0.12, 0);
    p.visible = false;
    scene.add(p);
    return p;
  });

  // ---- the crew: their real bodies ---------------------------------------------------------------------------------
  const box = (w: number, h: number, d: number, m: Material, x = 0, y = 0, z = 0) => {
    const b = mesh(new BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    return b;
  };
  const cyl = (r0: number, r1: number, h: number, m: Material, seg = 14) => mesh(new CylinderGeometry(r0, r1, h, seg), m);
  const sleepRing = () => {
    const rm = keep(new MeshBasicMaterial({ color: GOLD_HI.clone(), transparent: true, opacity: 0 }));
    const r = mesh(new TorusGeometry(0.85, 0.03, 6, 64), rm);
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.03;
    return { r, rm };
  };
  /** A clone of a loaded model with its own materials, so one body can be painted without touching the others. */
  const own = (src: Object3D, paint?: (m: MeshStandardMaterial) => void) => {
    const m = cloneSkinned(src);
    m.traverse((o) => {
      const me = o as Mesh;
      if (!me.isMesh) return;
      // Skinned bodies: the bind pose's bounds don't cover a pose.
      me.frustumCulled = false;
      const mat = keep((me.material as MeshStandardMaterial).clone());
      paint?.(mat);
      me.material = mat;
    });
    return m;
  };
  const [compGl, rockyGl, rivetGl, humansGl] = await models;
  /** Rusty's frame, and his dock crew's: the salvage compactor, Rusty as made, the others in their paint. */
  function compactorBot(paint: string | null, phase: number): Bot | null {
    if (!compGl) return null;
    const model = own(compGl.scene, paint ? (m) => paintDock(m, paint) : undefined);
    standTall(model, H_COMPACTOR);
    const g = new Group();
    g.add(model);
    const rig = rigCompactor(model);
    const { r, rm } = sleepRing();
    g.add(r);
    return { g, ring: rm, moved: () => undefined, pose: (mode, t, dt) => rig && poseCompactor(rig, mode, t, dt, phase, false, 0) };
  }
  /** Rocky: the Eridian carapace on five legs, walked by rockyPose.ts on planted feet. */
  function rockyBot(): Bot | null {
    if (!rockyGl) return null;
    const model = own(rockyGl.scene);
    standTall(model, H_ROCKY);
    const ground = new Group();
    const body = new Group();
    body.add(model);
    ground.add(body);
    const legs = legsOf(model);
    let rig: RockyRig | null = null;
    const { r, rm } = sleepRing();
    ground.add(r);
    return {
      g: ground,
      ring: rm,
      moved: () => (rig = null),
      pose: (mode, t, dt) => {
        rig ??= rigRocky(ground, legs);
        poseRocky(ground, body, rig, mode, t, dt, 1.7);
      },
    };
  }
  /** Rivet: the hard hat and hi-vis she wears on the Lattice (the Worker body, her own colours), on the humans' clips. */
  function rivetBot(): Bot | null {
    if (!rivetGl) return null;
    const SLOTS: Record<string, string> = { Worker_Vest: "#b9642a", Worker_Yellow: "#b49413" };
    const model = own(rivetGl.scene, (m) => {
      const c = SLOTS[m.name];
      if (c) m.color = new Color(c);
    });
    standTall(model, H_RIVET);
    const g = new Group();
    g.add(model);
    const mixer = new AnimationMixer(model);
    const clips = humansGl?.animations ?? [];
    const act = (name: string): AnimationAction | null => {
      const c = clips.find((k) => k.name === name);
      return c ? mixer.clipAction(c) : null;
    };
    const acts: Record<Mode, AnimationAction | null> = { working: act("Interact"), idle: act("Idle_Neutral") ?? act("Idle"), napping: act("Idle"), walking: act("Walk") };
    if (acts.working) acts.working.timeScale = 0.6;
    let on: AnimationAction | null = null;
    const { r, rm } = sleepRing();
    g.add(r);
    return {
      g,
      ring: rm,
      moved: () => undefined,
      pose: (mode, _t, dt) => {
        const a = acts[mode] ?? acts.idle;
        if (a && a !== on) {
          a.reset().fadeIn(on ? 0.4 : 0).play();
          on?.fadeOut(0.4);
          on = a;
        }
        mixer.update(dt);
      },
    };
  }
  disposables.push({ dispose: () => scene.traverse((o) => (o as SkinnedMesh).isSkinnedMesh && (o as SkinnedMesh).skeleton?.dispose()) });

  /** An anvil, solid steel, with the piece being worked on it. */
  const anvil = () => {
    const g = new Group();
    const top = box(0.78, 0.2, 0.36, steel, 0, 0.62, 0);
    const horn = mesh(new ConeGeometry(0.14, 0.42, 10), steel);
    horn.rotation.z = Math.PI / 2;
    horn.position.set(0.58, 0.64, 0);
    const waist = box(0.34, 0.26, 0.26, ironDark, 0, 0.4, 0);
    const foot = box(0.6, 0.27, 0.42, ironDark, 0, 0.135, 0);
    g.add(skin(top, 0.4), horn, skin(waist, 0.25), skin(foot, 0.25));
    const pm = keep(new MeshStandardMaterial({ color: 0x3a1a0a, emissive: EMBER.clone(), emissiveIntensity: 2.2, roughness: 0.5 }));
    const piece = box(0.3, 0.07, 0.16, pm, -0.05, 0.755, 0);
    g.add(piece);
    return { g, piece, pm };
  };

  interface SlotRig {
    at: Vector3;
    /** Where its own hand steps aside to while Rocky works the slot. */
    aside: Vector3;
    bot: Bot | null;
    phase: number;
    anvil: ReturnType<typeof anvil>;
    ingot: Mesh<BoxGeometry, MeshStandardMaterial>;
    ingotGlow: Sprite;
    y: number;
    v: FurnaceSlotView | null;
    workT: number;
    hit: Mesh;
    botHit: Mesh;
    chainX: number;
    chainZ: number;
    winch: MeshStandardMaterial | null;
    beads: MeshBasicMaterial[] | null;
    lens: MeshBasicMaterial | null;
  }
  const hitMat = keep(new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  const ingotG = keep(new BoxGeometry(1.15, 0.52, 0.66));
  const ingotEdges = keep(new EdgesGeometry(ingotG));
  const makeIngot = () => {
    const m = new MeshStandardMaterial({ color: 0x4a2412, emissive: EMBER.clone(), emissiveIntensity: 1.8, metalness: 0.6, roughness: 0.38 });
    keep(m);
    const ing = new Mesh(ingotG, m);
    const e = new LineSegments(ingotEdges, keep(new LineBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.85 })));
    e.scale.setScalar(1.01);
    ing.add(e);
    scene.add(ing);
    const gl = glow(0xff8a3d, 3, 0.6);
    scene.add(gl);
    return { ing, gl };
  };
  // The slots stand on a front arc round the crucible, each on its plinth, facing in, the anvil between it and the bowl.
  const SLOT_ANG = [-1.08, -0.42, 0.42, 1.08];
  const plinthMat = keep(new MeshStandardMaterial({ color: 0x1f1d1b, metalness: 0.75, roughness: 0.4 }));
  const HANDS: (string | null)[] = [null, ...DOCK_CREW.map((d) => d.colour)];
  const slots: SlotRig[] = SLOT_ANG.map((a, i) => {
    const at = new Vector3(Math.sin(a) * 6.9, 0.28, Math.cos(a) * 6.9);
    const aside = new Vector3(Math.sin(a) * 8.6, 0, Math.cos(a) * 8.6).add(new Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(i < 2 ? -1.1 : 1.1));
    const plinth = mesh(new CylinderGeometry(1.35, 1.48, 0.28, 6), plinthMat);
    plinth.position.set(at.x, 0.14, at.z);
    plinth.rotation.y = a;
    scene.add(skin(plinth, 0.4));
    const phase = i * 2.3 + 0.7;
    const bot = compactorBot(HANDS[i] ?? null, phase);
    if (bot) {
      bot.g.position.copy(at);
      bot.g.lookAt(0, at.y, 0);
      scene.add(bot.g);
    }
    const av = anvil();
    av.g.position.set(Math.sin(a) * 5.45, 0.0, Math.cos(a) * 5.45);
    av.g.scale.setScalar(1.15);
    av.g.lookAt(0, 0, 0);
    av.g.rotateY(Math.PI / 2);
    scene.add(av.g);
    const { ing, gl } = makeIngot();
    const hit = mesh(new BoxGeometry(1.3, 0.9, 1), hitMat);
    scene.add(hit);
    const botHit = mesh(new BoxGeometry(1.8, 2.4, 1.8), hitMat);
    botHit.position.copy(at).setY(1.2);
    scene.add(botHit);
    return { at, aside, bot, phase, anvil: av, ingot: ing, ingotGlow: gl, y: Y0 - 0.4, v: null, workT: Math.random() * 6, hit, botHit, chainX: CHAIN_X[i]!, chainZ: 0, winch: winchMats[i]!, beads: beadMats.map((l) => l[i]!), lens: lensMats[i]! };
  });

  // Rocky's corner: his drafting table with the plan glowing on it, where he sleeps over it between builds.
  const rocky = rockyBot();
  const rockyHit = mesh(new BoxGeometry(2.4, 2, 2.4), hitMat);
  rockyHit.position.copy(ROCKY_HOME).setY(1);
  scene.add(rockyHit);
  {
    const t = new Group();
    t.position.set(ROCKY_HOME.x - 1.5, 0, ROCKY_HOME.z - 1.4);
    t.lookAt(ROCKY_HOME.x, 0, ROCKY_HOME.z);
    const top = box(2.0, 0.08, 1.3, iron, 0, 1.15, 0);
    top.rotation.x = -0.35;
    t.add(skin(top, 0.4));
    for (const [x, z] of [
      [-0.85, -0.5],
      [0.85, -0.5],
      [-0.85, 0.5],
      [0.85, 0.5],
    ] as const)
      t.add(box(0.07, 1.1, 0.07, ironDark, x, 0.55, z));
    const planMat = keep(new MeshBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    const plan = mesh(new BoxGeometry(1.7, 0.01, 1.05), planMat);
    plan.position.set(0, 1.2, 0);
    plan.rotation.x = -0.35;
    const lines = new LineSegments(keep(new EdgesGeometry(keep(new BoxGeometry(1.2, 0.01, 0.7)))), keep(new LineBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.8 })));
    plan.add(lines);
    t.add(plan);
    scene.add(t);
    const plinth = mesh(new CylinderGeometry(1.25, 1.35, 0.28, 5), plinthMat);
    plinth.position.copy(ROCKY_HOME).setY(0.14);
    scene.add(skin(plinth, 0.4));
  }
  /** Which slot Rocky works (-1 at his table; -2 before the first look). */
  let rockySlot = -2;

  // Rivet's corner: her plinth, her hoist on its own short frame with five small rings, the alarm post with its lamp.
  const rivet: SlotRig = (() => {
    const at = RIVET_AT.clone().setY(0.28);
    const plinth = mesh(new CylinderGeometry(1.2, 1.3, 0.28, 6), plinthMat);
    plinth.position.copy(at).setY(0.14);
    scene.add(skin(plinth, 0.4));
    const bot = rivetBot();
    if (bot) {
      bot.g.position.copy(at);
      bot.g.lookAt(0, at.y, 4);
      scene.add(bot.g);
    }
    const av = anvil();
    av.g.position.set(at.x - 1.1, 0.0, at.z + 0.7);
    av.g.lookAt(0, 0, 0);
    av.g.rotateY(Math.PI / 2);
    scene.add(av.g);
    const { ing, gl } = makeIngot();
    ing.scale.setScalar(0.7);
    const hit = mesh(new BoxGeometry(1, 0.8, 0.8), hitMat);
    scene.add(hit);
    const botHit = mesh(new BoxGeometry(1.6, 2.8, 1.6), hitMat);
    botHit.position.copy(at).setY(1.4);
    scene.add(botHit);
    const hx = at.x - 0.4;
    const hz = at.z - 1.8;
    const frameTop = yAt(SHAFT.ship) + 0.6;
    for (const s of [-1, 1]) {
      const post = box(0.16, frameTop, 0.16, ironDark, hx + s * 0.8, frameTop / 2, hz);
      scene.add(skin(post, 0.25));
    }
    scene.add(skin(box(1.9, 0.22, 0.3, ironDark, hx, frameTop, hz), 0.3));
    const beads = SHAFT.coils.map((u) => {
      const cm = keep(new MeshBasicMaterial({ color: GOLD_DIM.clone() }));
      const c = mesh(new TorusGeometry(0.62, 0.03, 8, 48), cm);
      c.rotation.x = Math.PI / 2;
      c.position.set(hx, yAt(u), hz);
      scene.add(c);
      return cm;
    });
    // The alarm post: main's checks lamp, which Rivet keeps watch from, and her thermos.
    const post = cyl(0.06, 0.08, 2.6, steel, 8);
    post.position.set(at.x + 1.1, 1.3, at.z + 0.2);
    scene.add(post);
    const thermos = cyl(0.07, 0.07, 0.24, keep(new MeshStandardMaterial({ color: 0x8a2a20, metalness: 0.6, roughness: 0.4 })), 10);
    thermos.position.set(at.x + 1.1, 1.2, at.z + 0.34);
    scene.add(thermos);
    return { at, aside: at.clone(), bot, phase: 0, anvil: av, ingot: ing, ingotGlow: gl, y: Y0, v: null, workT: 0, hit, botHit, chainX: hx, chainZ: hz, winch: null, beads, lens: null };
  })();
  const alarmMat = keep(new MeshBasicMaterial({ color: GOLD.clone() }));
  const alarm = mesh(new SphereGeometry(0.17, 14, 10), alarmMat);
  alarm.position.set(RIVET_AT.x + 1.1, 2.7, RIVET_AT.z + 0.2);
  scene.add(alarm);
  const alarmGlow = glow(GOLD, 1.4, 0.6);
  alarmGlow.position.copy(alarm.position);
  scene.add(alarmGlow);

  // The ore cart: the queue, raw blocks of work waiting at the foot of the shaft.
  const cart = new Group();
  cart.position.set(-6.4, 0, -2.6);
  cart.lookAt(0, 0, 3);
  scene.add(cart);
  cart.add(skin(box(1.9, 0.55, 1.1, iron, 0, 0.55, 0), 0.35));
  for (const x of [-0.65, 0.65])
    for (const z of [-0.56, 0.56]) {
      const w = cyl(0.2, 0.2, 0.1, steel, 14);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.2, z);
      cart.add(w);
    }
  const oreMat = keep(new MeshStandardMaterial({ color: 0x3a342c, metalness: 0.3, roughness: 0.8, emissive: 0x3a1a06, emissiveIntensity: 0.8 }));
  const ores = Array.from({ length: 8 }, (_, i) => {
    const o = box(0.42, 0.26, 0.4, oreMat, -0.62 + (i % 4) * 0.42, 0.95 + Math.floor(i / 4) * 0.27, (Math.floor(i / 4) ? 0.12 : -0.18) + ((i * 37) % 10) / 60);
    o.rotation.y = ((i * 53) % 10) / 20 - 0.25;
    o.visible = false;
    cart.add(skin(o, 0.3));
    return o;
  });
  const cartHit = mesh(new BoxGeometry(2.2, 1.6, 1.4), hitMat);
  cartHit.position.set(0, 0.8, 0);
  cart.add(cartHit);
  const hatchHit = mesh(new BoxGeometry(COIL_R * 2 + 2, 1.6, 2), hitMat);
  hatchHit.position.set(0, hatchY + 0.4, 0);
  scene.add(hatchHit);

  // The chains: solid links, one chain per slot and one on Rivet's hoist, wound off the winches.
  const LINK = PH ? 0.2 : 0.15;
  const maxLinks = Math.ceil((gantryY - Y0 + 1) / LINK);
  const linkG = keep(new TorusGeometry(LINK * 0.52, LINK * 0.15, 5, 10));
  const chains = new InstancedMesh(linkG, keep(new MeshStandardMaterial({ color: 0x8a8378, metalness: 0.92, roughness: 0.3 })), maxLinks * 5);
  chains.frustumCulled = false;
  scene.add(chains);

  // ---- nanites: sigil glyphs from one atlas ----------------------------------------------------------------------
  const atlas = keep(await sigilAtlas());
  const NG = SIGIL_GLYPHS.length;
  const px = { value: renderer.getPixelRatio() };
  // The live ones, moved on the CPU, all in one buffer: embers rising off the melt; each ingot's swarm; sparks (and
  // the nanites Rocky comes apart into); the runes turning in every ring; streams of sigils climbing each busy chain to
  // its ingot; a halo round each hand at work; and motes drifting down the daylight from the hatch.
  const NE = PH ? 200 : 560;
  const NS = PH ? 16 : 30;
  const NK = PH ? 120 : 320;
  const RC = PH ? 30 : 64;
  const RH = PH ? 48 : 120;
  const RP = PH ? 20 : 44;
  const NR = RC * 5 + RH + RP;
  const NC = PH ? 10 : 22;
  const NH = PH ? 8 : 16;
  const NB = PH ? 30 : 90;
  const oE = 0;
  const oS = oE + NE;
  const oK = oS + NS * 5;
  const oR = oK + NK;
  const oC = oR + NR;
  const oH = oC + NC * 5;
  const oB = oH + NH * 5;
  const NN = oB + NB;
  const gp = new Float32Array(NN * 3);
  const gc = new Float32Array(NN * 3);
  const ga = new Float32Array(NN);
  const gg = new Float32Array(NN);
  const gs = new Float32Array(NN);
  for (let i = 0; i < NN; i++) {
    gg[i] = Math.floor(Math.random() * NG);
    gs[i] = i < oS ? 0.55 + Math.random() * 0.6 : i < oK ? 0.45 + Math.random() * 0.3 : i < oR ? 0.35 + Math.random() * 0.3 : i < oC ? (i < oR + RC * 5 ? 0.7 : 0.95) : i < oB ? 0.5 + Math.random() * 0.3 : 0.4 + Math.random() * 0.4;
  }
  const gGeo = keep(new BufferGeometry());
  gGeo.setAttribute("position", new BufferAttribute(gp, 3));
  gGeo.setAttribute("tint", new BufferAttribute(gc, 3));
  gGeo.setAttribute("alpha", new BufferAttribute(ga, 1));
  gGeo.setAttribute("glyph", new BufferAttribute(gg, 1));
  gGeo.setAttribute("sz", new BufferAttribute(gs, 1));
  const glyphs = new Points(gGeo, keep(glyphMaterial(atlas, px, 34)));
  glyphs.frustumCulled = false;
  glyphs.renderOrder = 6;
  scene.add(glyphs);
  const emb = Array.from({ length: NE }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  const sw = Float32Array.from({ length: NS * 5 * 3 }, () => Math.random() * 2 - 1);
  const spk = Array.from({ length: NK }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 0.6, b: 0.2, fall: 3.2 }));
  const motes = Array.from({ length: NB }, () => ({ a: Math.random() * 6.283, r: Math.random() * (COIL_R - 0.4), y: Y0 + 4 + Math.random() * (Y1 - Y0 - 2), s: 0.25 + Math.random() * 0.5 }));

  // ---- the edges come undone into gold wire and code (the shared helper, the Senate's language) -------------------
  const undone = (() => {
    const wire: number[] = [];
    const VERT = PH ? 36 : 72;
    const RING = PH ? 64 : 140;
    const r = WALL_R - 0.6;
    for (let k = 0; k <= VERT; k++) {
      const a = Math.PI / 2 + (k / VERT) * Math.PI;
      wire.push(Math.sin(a) * r, 0, Math.cos(a) * r, Math.sin(a) * r, 28, Math.cos(a) * r);
    }
    for (let y = 0.8; y < 28; y += 1.3)
      for (let k = 0; k < RING / 2; k++) {
        const a0 = Math.PI / 2 + (k / (RING / 2)) * Math.PI;
        const a1 = Math.PI / 2 + ((k + 1) / (RING / 2)) * Math.PI;
        wire.push(Math.sin(a0) * r, y, Math.cos(a0) * r, Math.sin(a1) * r, y, Math.cos(a1) * r);
      }
    for (let rr = 8; rr < WALL_R + 2; rr += 1.3)
      for (let k = 0; k < RING; k++) {
        const a0 = (k / RING) * Math.PI * 2;
        const a1 = ((k + 1) / RING) * Math.PI * 2;
        wire.push(Math.cos(a0) * rr, 0.03, Math.sin(a0) * rr, Math.cos(a1) * rr, 0.03, Math.sin(a1) * rr);
      }
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      wire.push(Math.cos(a) * 8, 0.03, Math.sin(a) * 8, Math.cos(a) * (WALL_R + 2), 0.03, Math.sin(a) * (WALL_R + 2));
    }
    const ND = PH ? 520 : 1800;
    const dust = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) {
      const onWall = Math.random() < 0.7;
      const a = onWall ? Math.PI / 2 + Math.random() * Math.PI : Math.random() * Math.PI * 2;
      const y = onWall ? 0.3 + Math.random() * 26 : 0.05;
      const rr = onWall ? WALL_R - 0.7 : 8 + Math.random() * 9;
      dust.set([Math.sin(a) * rr, y, Math.cos(a) * rr], i * 3);
    }
    const u = comeUndone({ wire, dust, atlas, px, peel: PH ? 160 : 520, shape: [0.9, 1.32], keep });
    u.addTo(scene);
    return u;
  })();

  // ---- sizing, the camera, the pointer ---------------------------------------------------------------------------
  const phone = () => host.clientWidth < PHONE_W;
  const size = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < PHONE_W ? 50 : 44;
    cam.updateProjectionMatrix();
    px.value = renderer.getPixelRatio();
  };
  size();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(host);
  let yaw = 0;
  let yawTo = 0;
  let zoom = 1;
  let zoomTo = 1;
  // WASD swivels the view round the shaft (#922, Nikita 2026-11-06): not free roam. A/D (and the arrows) orbit within
  // a set arc, W/S dolly in and out within tight bounds, both resisted past the soft edge and eased back inside it
  // when the keys let go; Escape snaps home. Ignored while typing; Space is left alone for hold-to-talk (the shared
  // helper's rules). Dragging swivels the same arc.
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: 0, cz: 0, r: 1 }),
    origin: () => [0, 0],
    forward: () => [-cam.position.x, -cam.position.z],
    orbit: {
      turn: (r) => (yawTo = swing(yawTo, r, ARC)),
      zoom: (a) => (zoomTo = 1 + swing(zoomTo - 1, -a * 0.35, ZOOM_ARC)),
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  const ray = new Raycaster();
  const ptr = new Vector2();
  let pointing: string | null = null;
  let downAt: { x: number; y: number } | null = null;
  let lastX = 0;
  const pickables = () => {
    const out: [Mesh, string][] = [];
    slots.forEach((s, i) => {
      out.push([s.botHit, `s${i}`]);
      if (s.v?.busy) out.push([s.hit, `s${i}`]);
    });
    out.push([rivet.botHit, "rivet"], [cartHit, "queue"], [hatchHit, "ship"]);
    if (rockySlot < 0) out.push([rockyHit, "rocky"]);
    if (rivet.v?.busy) out.push([rivet.hit, "rivet"]);
    return out;
  };
  const pickAt = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, cam);
    const list = pickables();
    const hit = ray.intersectObjects(
      list.map(([m]) => m),
      false,
    )[0];
    return hit ? (list.find(([m]) => m === hit.object)?.[1] ?? null) : null;
  };
  const onMove = (e: PointerEvent) => {
    if (downAt && e.pointerType === "mouse") {
      yawTo = swing(yawTo, (e.clientX - lastX) * 0.004, ARC);
      lastX = e.clientX;
    }
    if (e.pointerType !== "mouse") return;
    const id = pickAt(e.clientX, e.clientY);
    if (id !== pointing) {
      pointing = id;
      canvas.style.cursor = id ? "pointer" : "";
      opts.onPoint(id);
    }
  };
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
    lastX = e.clientX;
  };
  const onUp = (e: PointerEvent) => {
    const d = downAt;
    downAt = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) opts.onPick(id);
  };
  const onLeave = () => {
    downAt = null;
    if (pointing) {
      pointing = null;
      opts.onPoint(null);
    }
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  let hot: string | null = null;
  const tmpC = new Color();
  const tmpV = new Vector3();
  const M = new Matrix4();
  const Q = new Quaternion();
  const Q2 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const ONE = new Vector3(1, 1, 1);
  const anchors: [string, Vector3][] = [
    ["queue", new Vector3()],
    ["ship", new Vector3(COIL_R + 3.2, hatchY - 1.6, 0)],
    ["rivet", new Vector3()],
    ["rocky", new Vector3()],
    ["z-work", new Vector3(-COIL_R - 0.6, yAt(SHAFT.work[1]) - 0.4, 0)],
    ["z-pictures", new Vector3(-COIL_R - 0.9, picY, 0)],
    ["z-checks", new Vector3(-COIL_R - 0.4, yAt(SHAFT.coils[4]) + 0.9, 0)],
    ["z-ship", new Vector3(-COIL_R - 1.3, hatchY, 0)],
    ["shaft-l", new Vector3(-COIL_R - 1.6, yAt(0.55), 0)],
    ["shaft-r", new Vector3(COIL_R + 1.6, yAt(0.55), 0)],
    ...SHAFT.coils.map((u, i): [string, Vector3] => [`c${i}`, new Vector3(-COIL_R - 0.3, yAt(u), 0.4)]),
    ...slots.map((_, i): [string, Vector3] => [`s${i}`, new Vector3()]),
  ];
  const anchor = new Map(anchors);
  const placed = new Map<string, string>();
  const place = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    anchor.get("queue")!.copy(cart.position).setY(1.9);
    const rv = anchor.get("rivet")!;
    if (rivet.v?.busy) rv.set(rivet.chainX, rivet.y + 0.55, rivet.chainZ);
    else rv.copy(rivet.at).setY(H_RIVET + 0.5);
    anchor.get("rocky")!.copy(ROCKY_HOME).setY(H_ROCKY + 0.6);
    slots.forEach((s, i) => {
      const a = anchor.get(`s${i}`)!;
      if (s.v?.busy) a.set(s.chainX, s.y + 0.55, s.chainZ);
      else a.copy(s.at).setY(H_COMPACTOR + 0.5);
    });
    for (const [id, p] of anchors) {
      tmpV.copy(p).project(cam);
      const x = ((tmpV.x + 1) / 2) * w;
      const y = ((1 - tmpV.y) / 2) * h;
      const on = tmpV.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20 && (id !== "rocky" || rockySlot < 0);
      const key = `${Math.round(x)}|${Math.round(y)}|${on}`;
      if (placed.get(id) === key) continue;
      placed.set(id, key);
      opts.onPlace(id, x, y, on);
    }
  };

  const spark = (x: number, y: number, z: number, n: number, col: Color, up = 1, fall = 3.2, spread = 2.4) => {
    const cloud = fall < 1;
    for (let k = 0; k < n; k++) {
      const p = spk.find((q) => q.life <= 0);
      if (!p) return;
      p.life = p.max = 0.5 + Math.random() * 0.7 + (cloud ? 0.8 : 0);
      p.x = x + (cloud ? (Math.random() - 0.5) * 1.2 : 0);
      p.y = y + (cloud ? Math.random() * 1.6 : 0);
      p.z = z + (cloud ? (Math.random() - 0.5) * 1.2 : 0);
      p.vx = (Math.random() - 0.5) * spread;
      p.vy = (0.6 + Math.random() * 2.2) * up;
      p.vz = (Math.random() - 0.5) * spread;
      p.fall = fall;
      p.r = col.r;
      p.g = col.g;
      p.b = col.b;
    }
  };

  // ---- the state each frame ---------------------------------------------------------------------------------------
  let shippedWas = view.shipped;
  const apply = () => {
    const usedRocky = view.slots.findIndex((s) => s.hand === "Rocky");
    // Rocky comes apart into nanites where he stood and puts himself back together where he goes.
    if (rocky && usedRocky !== rockySlot) {
      const from = rocky.g.position.clone();
      const to = usedRocky >= 0 ? slots[usedRocky]!.at.clone() : ROCKY_HOME.clone().setY(0.28);
      if (rockySlot !== -2 && !reduce) {
        spark(from.x, 0.1, from.z, PH ? 14 : 34, GOLD_HI, 0.5, 0.2, 1);
        spark(to.x, 0.1, to.z, PH ? 14 : 34, GOLD_WHITE, 0.4, 0.2, 0.8);
      }
      rocky.g.position.copy(to);
      rocky.g.lookAt(usedRocky >= 0 ? 0 : 4, to.y, usedRocky >= 0 ? 0 : 8);
      rocky.moved();
      if (rocky.g.parent !== scene) scene.add(rocky.g);
    }
    rockySlot = usedRocky;
    slots.forEach((s, i) => {
      const v = view.slots[i] ?? null;
      s.v = v;
      // The slot's own hand steps aside while Rocky works it.
      if (s.bot) {
        const p = i === usedRocky ? s.aside : s.at;
        s.bot.g.position.set(p.x, i === usedRocky ? 0 : s.at.y, p.z);
        s.bot.g.lookAt(0, s.bot.g.position.y, 0);
      }
      if (v && s.winch) s.winch.color.set(v.paint);
    });
    rivet.v = view.rivet;
    ores.forEach((o, i) => (o.visible = i < Math.min(8, view.queue)));
    plates.forEach((p, i) => (p.visible = i < Math.min(8, view.shipped)));
    // A ship since the last look: a burst of gold out of the hatch.
    if (view.shipped > shippedWas && !reduce) for (const x of CHAIN_X) spark(x, hatchY + 0.3, 0, PH ? 8 : 18, GOLD_HI, 1.6, 1.4);
    shippedWas = view.shipped;
  };
  apply();

  let link = 0;
  const chainTo = (x: number, z: number, top: number, bottom: number) => {
    const len = top - bottom;
    const n = Math.max(0, Math.floor(len / LINK));
    for (let k = 0; k < n && link < maxLinks * 5; k++) {
      Q.identity();
      if (k % 2) Q.copy(Q2);
      M.compose(tmpV.set(x, top - k * LINK, z), Q, ONE);
      chains.setMatrixAt(link++, M);
    }
  };

  const stepSlot = (s: SlotRig, i: number, dt: number, T: number, isRivet: boolean) => {
    const v = s.v;
    const busy = !!v?.busy;
    const id = isRivet ? "rivet" : `s${i}`;
    const lit = hot === null || hot === id ? 1 : 0.55;
    // Ingot.
    const target = busy ? (v!.u <= 0.001 ? Y0 - 0.05 : yAt(v!.u)) : Y0 - 0.6;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 1.6);
    s.y += (target - s.y) * k;
    const sway = reduce ? 0 : Math.sin(T * 0.8 + i * 1.7) * 0.05;
    const bob = v?.bad && !reduce ? Math.sin(T * 9) * 0.03 : 0;
    s.ingot.visible = busy;
    s.ingotGlow.visible = busy;
    s.ingot.position.set(s.chainX + sway, s.y + bob, s.chainZ);
    s.ingot.rotation.y = isRivet ? 0.3 : 0;
    s.hit.position.copy(s.ingot.position);
    const mat = s.ingot.material;
    const u = busy ? v!.u : 0;
    if (v?.bad) {
      mat.emissive.copy(RED);
      mat.emissiveIntensity = 1.4 + (reduce ? 0 : 0.7 * Math.sin(T * 6));
    } else if (v?.ready) {
      mat.emissive.copy(GOLD_HI);
      mat.emissiveIntensity = 0.9 + (reduce ? 0 : 0.4 * Math.sin(T * 2.4));
    } else {
      heatCol(u, mat.emissive);
      mat.emissiveIntensity = (v?.held ? 0.4 : 0.55 + 0.5 * (1 - u)) * lit;
    }
    mat.color.copy(mat.emissive).multiplyScalar(0.4);
    s.ingotGlow.position.copy(s.ingot.position);
    s.ingotGlow.material.color.copy(mat.emissive);
    s.ingotGlow.material.opacity = (v?.held ? 0.25 : 0.55) * lit;
    s.ingotGlow.scale.setScalar(isRivet ? 1.8 : 2.6 + (hot === id ? 0.9 : 0));
    // Chain.
    if (busy) chainTo(s.chainX + sway * 0.5, s.chainZ, isRivet ? yAt(SHAFT.ship) + 0.5 : gantryY - 0.5, s.y + 0.22);
    // The sigil beads on the rings for this chain: the job's checks.
    if (s.beads)
      s.beads.forEach((bm) => {
        bm.color.copy(busy ? RING_COL[v!.coil] : GOLD_DIM);
        if (busy && v!.coil === "run" && !reduce) bm.color.multiplyScalar(0.7 + 0.3 * Math.sin(T * 6 + i));
      });
    if (s.lens) s.lens.opacity = busy && v!.u >= SHAFT.pictures - 0.01 ? 0.95 : 0.25;
    // The hand: at work on the anvil, awake beside a job that waits, or asleep on its charging ring.
    const isRocky = !isRivet && i === rockySlot;
    const asleep = !busy && !isRivet;
    const working = busy && v!.hammer;
    const mode: Mode = working ? "working" : asleep ? "napping" : "idle";
    if (s.bot) {
      s.bot.ring.opacity = asleep || isRocky ? 0.4 + (reduce ? 0 : 0.15 * Math.sin(T * 1.3 + i)) : 0;
      s.bot.pose(isRocky ? "napping" : mode, T, reduce ? 0 : dt);
    }
    if (isRocky && rocky) {
      rocky.ring.opacity = 0;
      rocky.pose(mode, T, reduce ? 0 : dt);
    }
    if (working && !reduce) {
      // A spark off the anvil on every crush (compactorPose.ts: one each 1.1 s, the low point a quarter in).
      const c = ((T + s.phase) / 1.1) % 1;
      const was = ((T - dt + s.phase) / 1.1) % 1;
      if (was < 0.25 && c >= 0.25) {
        s.anvil.g.getWorldPosition(tmpV);
        spark(tmpV.x, 0.95, tmpV.z, PH ? 4 : 9, tmpC.copy(AMBER));
      }
    }
    s.anvil.piece.visible = busy && v!.hammer;
    s.workT += dt;
    s.anvil.pm.emissiveIntensity = 1.6 + (working && !reduce ? 0.8 * Math.max(0, Math.sin(s.workT * 5.7)) : 0);
  };

  /** The checks' rings: amber while any job is in them, brighter gold once one has passed, gold at rest. */
  const ringColor = (out: Color) => {
    const states = [...slots, rivet].filter((s) => s.v?.busy).map((s) => s.v!.coil);
    return out.copy(states.includes("run") ? AMBER : states.includes("pass") ? GOLD_HI : GOLD);
  };

  const stepGlyphs = (dt: number, T: number) => {
    const calm = reduce ? 0 : 1;
    // Embers off the melt, rising up the shaft and cooling to gold.
    if (calm)
      for (let k = 0; k < (PH ? 3 : 7); k++) {
        const j = Math.floor(Math.random() * NE);
        const e = emb[j]!;
        if (e.life > 0) continue;
        e.life = e.max = 3 + Math.random() * 5;
        const a = Math.random() * 6.283;
        const r = Math.random() * 2.6;
        e.x = Math.cos(a) * r;
        e.z = Math.sin(a) * r;
        e.y = Y0 + 0.3;
        e.vy = 0.7 + Math.random() * 1.5;
        e.vx = (Math.random() - 0.5) * 0.35;
        e.vz = (Math.random() - 0.5) * 0.35;
        gg[oE + j] = Math.floor(Math.random() * NG);
      }
    for (let i = 0; i < NE; i++) {
      const e = emb[i]!;
      const q = oE + i;
      if (e.life <= 0) {
        ga[q] = reduce && i < 60 ? 0.35 : 0;
        if (reduce && i < 60) {
          const a = (i / 60) * 6.283;
          gp.set([Math.cos(a) * 2, Y0 + 0.6 + (i % 7) * 0.5, Math.sin(a) * 2], q * 3);
          heatCol(0.1, tmpC).toArray(gc, q * 3);
        }
        continue;
      }
      e.life -= dt;
      e.x += (e.vx + Math.sin(T * 0.7 + i) * 0.08) * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      gp.set([e.x, e.y, e.z], q * 3);
      const u = (e.y - Y0) / (Y1 - Y0);
      heatCol(u, tmpC);
      tmpC.lerp(GOLD_HI, Math.min(1, u * 1.4));
      tmpC.toArray(gc, q * 3);
      ga[q] = Math.min(1, e.life / e.max) * Math.min(1, (e.max - e.life) * 3) * 0.95;
    }
    const all = [...slots, rivet];
    // Each ingot's swarm: sigils clinging to the work, gold as it cools, red when it cracked.
    all.forEach((s, j) => {
      const base = oS + j * NS;
      const busy = !!s.v?.busy;
      for (let k = 0; k < NS; k++) {
        const q = base + k;
        if (!busy) {
          ga[q] = 0;
          continue;
        }
        const sx = sw[(j * NS + k) * 3]!;
        const sy = sw[(j * NS + k) * 3 + 1]!;
        const sz = sw[(j * NS + k) * 3 + 2]!;
        const a = T * (0.6 + Math.abs(sz) * 0.8) * calm + sx * 6;
        const r = 0.62 + Math.abs(sy) * 0.3;
        const sc = s === rivet ? 0.7 : 1;
        gp.set([s.ingot.position.x + Math.cos(a) * r * sc, s.ingot.position.y + sy * 0.4 * sc + Math.sin(T * 1.3 + k) * 0.08 * calm, s.ingot.position.z + Math.sin(a) * r * 0.7 * sc], q * 3);
        if (s.v!.bad) RED.toArray(gc, q * 3);
        else tmpC.copy(s.ingot.material.emissive).lerp(GOLD_HI, 0.55).toArray(gc, q * 3);
        ga[q] = (0.45 + 0.4 * Math.sin(T * 2 + k * 1.7)) * (s.v!.held ? 0.4 : 1);
        if (calm && Math.random() < 0.01) gg[q] = Math.floor(Math.random() * NG);
      }
    });
    // Sparks, and the nanites Rocky comes apart into.
    for (let i = 0; i < NK; i++) {
      const p = spk[i]!;
      const q = oK + i;
      if (p.life <= 0) {
        ga[q] = 0;
        continue;
      }
      p.life -= dt;
      p.vy -= p.fall * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      gp.set([p.x, Math.max(0.05, p.y), p.z], q * 3);
      gc[q * 3] = p.r;
      gc[q * 3 + 1] = p.g;
      gc[q * 3 + 2] = p.b;
      ga[q] = Math.min(1, (p.life / p.max) * 1.5);
    }
    // The runes in the rings: the five checks, the hatch's circle, the Pictures band. They turn, slower at rest.
    const rc = ringColor(tmpC);
    const running = rc.equals(AMBER);
    for (let c = 0; c < 5; c++) {
      const y = yAt(SHAFT.coils[c]!);
      const dir = c % 2 ? 1 : -1;
      for (let k = 0; k < RC; k++) {
        const q = oR + c * RC + k;
        const a = (k / RC) * 6.283 + T * 0.12 * dir * calm;
        gp.set([Math.cos(a) * (COIL_R + 0.16), y, Math.sin(a) * (COIL_R + 0.16)], q * 3);
        // While a job is in the checks, a bright pulse climbs the rings.
        const pulse = running && calm ? Math.max(0, Math.sin(T * 3 - c * 0.9 + a)) : 0;
        rc.toArray(gc, q * 3);
        ga[q] = 0.32 + pulse * 0.6;
        if (calm && Math.random() < 0.002) gg[q] = Math.floor(Math.random() * NG);
      }
    }
    const mc = view.main === "wait" ? GOLD : RING_COL[view.main];
    for (let k = 0; k < RH; k++) {
      const q = oR + RC * 5 + k;
      const a = (k / RH) * 6.283 - T * 0.08 * calm;
      gp.set([Math.cos(a) * (COIL_R + 0.68), hatchY + 0.02, Math.sin(a) * (COIL_R + 0.68)], q * 3);
      mc.toArray(gc, q * 3);
      ga[q] = 0.55 + (view.main === "run" && calm ? 0.35 * Math.sin(T * 4 + k * 0.5) : 0.15 * Math.sin(T * 1.2 + k));
    }
    for (let k = 0; k < RP; k++) {
      const q = oR + RC * 5 + RH + k;
      const a = (k / RP) * 6.283 + T * 0.05 * calm;
      gp.set([Math.cos(a) * (COIL_R + 0.3), picY, Math.sin(a) * (COIL_R + 0.3)], q * 3);
      GOLD_HI.toArray(gc, q * 3);
      ga[q] = 0.4;
    }
    // Streams of sigils climbing each busy chain from the melt to its ingot: the work being hauled up as code.
    all.forEach((s, j) => {
      const busy = !!s.v?.busy && s.y > Y0 + 0.4;
      for (let k = 0; k < NC; k++) {
        const q = oC + j * NC + k;
        if (!busy) {
          ga[q] = 0;
          continue;
        }
        const f = (k / NC + T * (0.08 + (k % 3) * 0.02) * calm) % 1;
        const bottom = s === rivet ? 0.6 : Y0;
        const y = bottom + f * (s.y - 0.3 - bottom);
        gp.set([s.chainX + Math.sin(T * 2 + k) * 0.18, y, s.chainZ + Math.cos(T * 2 + k) * 0.18], q * 3);
        heatCol((y - Y0) / (Y1 - Y0), tmpC).lerp(GOLD_HI, 0.5).toArray(gc, q * 3);
        ga[q] = (s.v!.held ? 0.25 : 0.7) * Math.sin(f * Math.PI);
      }
    });
    // A halo of nanites round each hand at work (Rocky's when he works a slot).
    all.forEach((s, j) => {
      const working = !!s.v?.busy && s.v.hammer;
      const isRocky = s !== rivet && j === rockySlot;
      const who = isRocky ? rocky?.g : s.bot?.g;
      const h = s === rivet ? H_RIVET : isRocky ? H_ROCKY : H_COMPACTOR;
      for (let k = 0; k < NH; k++) {
        const q = oH + j * NH + k;
        if (!working || !who) {
          ga[q] = 0;
          continue;
        }
        const a = (k / NH) * 6.283 + T * (0.9 + (k % 2) * 0.4) * calm;
        const f = (k * 0.37 + T * 0.25 * calm) % 1;
        gp.set([who.position.x + Math.cos(a) * 1.05, 0.3 + f * h, who.position.z + Math.sin(a) * 1.05], q * 3);
        GOLD_HI.toArray(gc, q * 3);
        ga[q] = 0.5 * Math.sin(f * Math.PI);
      }
    });
    // Motes drifting down the daylight from the hatch.
    for (let k = 0; k < NB; k++) {
      const m = motes[k]!;
      const q = oB + k;
      m.y -= m.s * dt * calm;
      if (m.y < Y0 + 3) m.y = Y1 + 2;
      m.a += dt * 0.1 * calm;
      gp.set([Math.cos(m.a) * m.r, m.y, Math.sin(m.a) * m.r], q * 3);
      GOLD_WHITE.toArray(gc, q * 3);
      ga[q] = 0.28 * Math.min(1, (Y1 + 2 - m.y) / 2) * Math.min(1, (m.y - Y0 - 3) / 3);
    }
    // A cracked ingot sheds red shards now and then.
    if (calm)
      all.forEach((s) => {
        if (s.v?.busy && s.v.bad && Math.random() < dt * 2) spark(s.ingot.position.x, s.ingot.position.y - 0.2, s.ingot.position.z, 2, RED, -0.3);
      });
    for (const k of ["position", "tint", "alpha", "glyph"]) gGeo.attributes[k]!.needsUpdate = true;
  };

  // ---- the loop ---------------------------------------------------------------------------------------------------
  let visible = true;
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((en) => {
          visible = en[en.length - 1]!.isIntersecting;
        })
      : null;
  io?.observe(host);
  let last = performance.now();
  let T = 0;
  let raf = 0;
  const minStep = PH ? 1000 / 30 - 2 : 0;
  const look = new Vector3();
  const rc = new Color();
  const draw = (dt: number) => {
    T += dt * (reduce ? 0.12 : 1);
    meltU.t.value = T;
    undone.step(reduce ? 0 : T, renderer);
    melt.intensity = 80 + (reduce ? 0 : 10 * Math.sin(T * 3.1) + 5 * Math.sin(T * 7.3));
    meltGlow.material.opacity = 0.5 + (reduce ? 0 : 0.06 * Math.sin(T * 2.3));
    // The checks' bands: gold at rest, amber while a job is in them.
    ringColor(rc);
    const running = rc.equals(AMBER);
    coilMats.forEach((m, c) => {
      m.emissive.copy(rc);
      m.emissiveIntensity = (running ? 0.5 : 0.22) + (running && !reduce ? 0.3 * Math.sin(T * 3 - c * 0.9) : 0);
    });
    const mc = view.main === "wait" ? GOLD : RING_COL[view.main];
    hatchIn.emissive.copy(mc);
    hatchOut.emissive.copy(mc);
    hatchIn.emissiveIntensity = 0.45 + (view.main === "run" && !reduce ? 0.25 * Math.sin(T * 4) : 0);
    hatchOut.emissiveIntensity = 0.3;
    (hatchLight.material as MeshBasicMaterial).color.copy(mc);
    alarmMat.color.copy(mc);
    alarmGlow.material.color.copy(mc);
    link = 0;
    slots.forEach((s, i) => stepSlot(s, i, dt, T, false));
    if (rocky && rockySlot < 0) {
      // Asleep over the plan, as he does between builds.
      rocky.ring.opacity = 0.35 + (reduce ? 0 : 0.12 * Math.sin(T * 1.1));
      rocky.pose("napping", T, reduce ? 0 : dt);
    }
    stepSlot(rivet, 4, dt, T, true);
    chains.count = link;
    chains.instanceMatrix.needsUpdate = true;
    stepGlyphs(dt, T);
    // The camera: up the shaft from the deck's edge, swaying slowly, turned and dollied by WASD and a drag.
    pan.step(dt);
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 4);
    if (!pan.busy && !downAt) {
      if (Math.abs(yawTo) > ARC * SOFT) yawTo = damp(yawTo, Math.sign(yawTo) * ARC * SOFT, 4, dt);
      if (Math.abs(zoomTo - 1) > ZOOM_ARC * SOFT) zoomTo = damp(zoomTo, 1 + Math.sign(zoomTo - 1) * ZOOM_ARC * SOFT, 4, dt);
    }
    yaw += (yawTo - yaw) * ek;
    zoom += (zoomTo - zoom) * ek;
    const ph = phone();
    const th = yaw + (reduce ? 0 : Math.sin(T * 0.05) * 0.08);
    // A wide screen stands close and low on the deck, the crew big along the front and the shaft rising to the top of
    // the frame; a squarer one steps back; a phone stands well back with the frame dropped under the headline.
    const wide = cam.aspect >= 1.45;
    const D = (ph ? (cam.aspect < 0.7 ? 47 : 38) : wide ? 26 : 31) * zoom;
    const camY = ph ? 8 : wide ? 3.6 : 4.6;
    cam.position.set(Math.sin(th) * D, camY, Math.cos(th) * D);
    look.set(0, ph ? 10.4 : 9.9, 0);
    cam.lookAt(look);
    const w = host.clientWidth;
    const h = host.clientHeight;
    // Nudged so the crew stand whole along the foot of the frame.
    if (ph) cam.setViewOffset(w, h, 0, -h * 0.1, w, h);
    else cam.setViewOffset(w, h, 0, h * 0.065, w, h);
    renderer.render(scene, cam);
    place();
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
    draw(dt);
  };
  // Compile before the first frame (#759), then one draw, still unseen, so the first frame on screen doesn't stall.
  await yieldNow();
  await renderer.compileAsync(scene, cam).catch(() => undefined);
  await yieldNow();
  // Settle the ingots at their heights at once, so the first frame shows the forge as it is.
  slots.forEach((s) => (s.y = s.v?.busy ? (s.v.u <= 0.001 ? Y0 - 0.05 : yAt(s.v.u)) : Y0 - 0.6));
  rivet.y = rivet.v?.busy ? yAt(rivet.v.u) : Y0;
  draw(0.016);
  raf = requestAnimationFrame(frame);

  return {
    set: (next) => {
      view = next;
      apply();
    },
    setHot: (id) => {
      hot = id;
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      pan.dispose();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      chains.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
