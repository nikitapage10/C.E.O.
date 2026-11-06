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
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
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
  type Material,
} from "three";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { SHAFT, type CoilState } from "../data/furnace.ts";

/**
 * The Deep Furnace in 3D (#813, concept 02 of the Foundry's round 4): a forge shaft sunk into the floor of an old lab,
 * drawn the way the Senate draws its chamber (apps/desk/src/rotunda/rotundaScene.ts). Solid models in the middle (the
 * crucible of molten work on its pedestal, the deck, the four slots with their anvils and crew, the chains, the cooling
 * coils, the hatch to the surface) with a wire skin and gold sigil nanites over them, and the frame's edges coming
 * undone into gold wire and code, as the Senate's do.
 *
 * Every job starts in the crucible and rises on its builder's chain as it gets built: hammered on the anvils (Work),
 * up through the Pictures ring and the five coils (the checks), and out of the hatch (Ship). Height is real progress
 * (data/furnace.ts) and heat is how far it has to go: white-hot at the bottom, gold as it cools. A red check turns its
 * ingot red and drops it back under the coils; a free slot's dock crew member sleeps on its charging ring. Rivet works
 * outside the four on her own hoist by the alarm post; the queue waits as raw ore in the cart by the crucible.
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
  /** On the anvil now: the hand hammers. */
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
  /** main's own checks, on the hatch's ring. */
  main: CoilState;
}

export interface FurnaceOpts {
  phone: boolean;
  reduce: boolean;
  view: FurnaceView;
  /** Where each anchor is on screen (host CSS pixels), every frame it moves: s0..s3, rivet, queue, ship, z-*, c0..c4. */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
  /** The pointer is over a slot, Rivet, the cart or the hatch (or nothing). */
  onPoint: (id: string | null) => void;
  onPick: (id: string) => void;
}

export interface Furnace {
  set: (view: FurnaceView) => void;
  setHot: (id: string | null) => void;
  dispose: () => void;
}

const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴λΣ#*+:[]()&|$%!?~^"];
const PHONE_W = 760;
/** The crucible's mouth and the hatch, in world units: the shaft between them is SHAFT's 0..1. */
const Y0 = 1.9;
const Y1 = 19.4;
const yAt = (u: number) => Y0 + u * (Y1 - Y0);
/** The chains' x, left to right; Rivet's hoist stands apart. */
const CHAIN_X = [-2.4, -0.8, 0.8, 2.4];
const RIVET_AT = new Vector3(7.6, 0, -1.2);
const COIL_R = 3.7;
const WALL_R = 11;
const GOLD = new Color(0xc9a85c);
const GOLD_HI = new Color(0xe8c77a);
const WHITE_HOT = new Color(0xffd27a);
const EMBER = new Color(0xff6a1a);
const AMBER = new Color(0xff9a2a);
const COOL = new Color(0xe8b04e);
const RED = new Color(0xff3b2a);
const PASS = new Color(0x5fe08f);
const RUN = new Color(0xf2c230);
const COOLANT = new Color(0x3fc6d0);
const COIL_COL: Record<CoilState, Color> = { wait: COOLANT, run: RUN, pass: PASS, fail: RED };

/** Heat for a height: white-hot in the crucible, ember, amber, cooled gold near the hatch. */
function heatCol(u: number, out: Color) {
  const h = Math.max(0, Math.min(1, u / SHAFT.ship));
  if (h < 0.25) return out.copy(WHITE_HOT).lerp(EMBER, h / 0.25);
  if (h < 0.6) return out.copy(EMBER).lerp(AMBER, (h - 0.25) / 0.35);
  return out.copy(AMBER).lerp(COOL, (h - 0.6) / 0.4);
}

interface Bot {
  g: Group;
  /** The hammer arm's pivot (or Rocky's front leg). */
  arm: Object3D;
  head: Object3D;
  eyes: MeshBasicMaterial;
  paint: MeshStandardMaterial;
  /** The charging ring a sleeping hand stands on. */
  ring: MeshBasicMaterial;
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export async function createFurnace(host: HTMLElement, canvas: HTMLCanvasElement, opts: FurnaceOpts): Promise<Furnace> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.25 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new Scene();
  scene.background = new Color(0x060608);
  scene.fog = new FogExp2(0x07070a, 0.021);
  const cam = new PerspectiveCamera(44, 1, 0.1, 140);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const mesh = <M extends Material>(g: BufferGeometry, m: M) => new Mesh(keep(g), m);

  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x8d9bc4, 0x1c0d05, 0.9));
  const rim = new DirectionalLight(0x9fb4ff, 0.7);
  rim.position.set(-8, 14, -10);
  const fill = new DirectionalLight(0xffd9a8, 1.1);
  fill.position.set(6, 8, 14);
  scene.add(rim, fill);
  const melt = new PointLight(0xff7a2a, 70, 30, 1.7);
  melt.position.set(0, Y0 + 0.9, 0);
  scene.add(melt);
  const sky = new SpotLight(0xfff0d0, 140, 30, 0.42, 0.7, 1.3);
  sky.position.set(0, Y1 + 5, 0);
  sky.target.position.set(0, 4, 0);
  scene.add(sky, sky.target);

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
    t.repeat.set(10, 10);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const deck = mesh(new CircleGeometry(WALL_R + 2, 96), keep(new MeshStandardMaterial({ map: deckTex, color: 0x8a8580, metalness: 0.6, roughness: 0.55 })));
  deck.rotation.x = -Math.PI / 2;
  scene.add(deck);
  const goldRing = (r: number, y: number, op: number, w = 0.012) => {
    const m = mesh(new TorusGeometry(r, w, 6, 160), keep(new MeshBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: op })));
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    scene.add(m);
    return m;
  };
  [4.2, 6.6, 8.8].forEach((r, i) => goldRing(r, 0.015, 0.42 - i * 0.1));

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
    t.repeat.set(8, 4);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const wallMat = keep(new MeshStandardMaterial({ map: rackTex, emissiveMap: rackTex, emissive: 0xffffff, emissiveIntensity: 0.95, color: 0xb0a99e, metalness: 0.5, roughness: 0.7, side: DoubleSide }));
  // The back half of the shaft (the front is open to the deck).
  const wall = mesh(new CylinderGeometry(WALL_R, WALL_R, 30, 72, 1, true, Math.PI / 2 + 0.15, Math.PI - 0.3), wallMat);
  wall.position.y = 13;
  scene.add(wall);
  // Ribs and girders: the shaft's iron, solid, with the wire skin on them.
  {
    const ribG = keep(new BoxGeometry(0.42, 30, 0.5));
    const n = 11;
    const ribs = new InstancedMesh(ribG, ironDark, n);
    const M = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + 0.2 + (k / (n - 1)) * (Math.PI - 0.4);
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      M.compose(new Vector3(Math.sin(a) * (WALL_R - 0.3), 13, Math.cos(a) * (WALL_R - 0.3)), q, new Vector3(1, 1, 1));
      ribs.setMatrixAt(k, M);
    }
    scene.add(ribs);
  }

  // ---- the crucible -----------------------------------------------------------------------------------------------
  // A heavy iron bowl on a stepped pedestal, the molten work churning in it, its lip gold.
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
  // Its wire skin: a coarser lathe a hair outside it, gold.
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
  // Bands round the bowl, riveted iron.
  for (const [y, r] of [
    [1.1, 3.06],
    [1.75, 3.26],
  ] as const) {
    const b = mesh(new TorusGeometry(r, 0.06, 8, 120), steel);
    b.rotation.x = Math.PI / 2;
    b.position.y = y + 0.45 - 0.45;
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

  // ---- the shaft's rings: Pictures, the five coils, the hatch -----------------------------------------------------
  const ringGroup = new Group();
  scene.add(ringGroup);
  // Pictures: a catwalk ring with four lenses looking in, one at each chain.
  const picY = yAt(SHAFT.pictures);
  const walk = mesh(new RingGeometry(COIL_R + 0.05, COIL_R + 0.75, 72, 1), keep(new MeshStandardMaterial({ color: 0x24211e, metalness: 0.7, roughness: 0.5, side: DoubleSide })));
  walk.rotation.x = -Math.PI / 2;
  walk.position.y = picY - 0.08;
  ringGroup.add(walk);
  const rail = mesh(new TorusGeometry(COIL_R + 0.75, 0.04, 6, 96), steel);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = picY + 0.45;
  ringGroup.add(rail);
  const railEdge = mesh(new TorusGeometry(COIL_R + 0.05, 0.05, 6, 96), brass);
  railEdge.rotation.x = Math.PI / 2;
  railEdge.position.y = picY - 0.05;
  ringGroup.add(railEdge);
  const lensMats: MeshBasicMaterial[] = [];
  CHAIN_X.forEach((x) => {
    const z = Math.sqrt(COIL_R * COIL_R - x * x);
    const housing = mesh(new BoxGeometry(0.34, 0.3, 0.42), iron);
    housing.position.set(x * 1.06, picY + 0.22, z * 1.06);
    housing.lookAt(0, picY + 0.22, 0);
    const lm = keep(new MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.35 }));
    lensMats.push(lm);
    const lens = mesh(new CircleGeometry(0.1, 16), lm);
    lens.position.z = 0.215;
    housing.add(lens);
    ringGroup.add(skin(housing, 0.4));
  });
  // The five coils: typecheck at the bottom, boot check at the top. Each has a lamp per chain.
  const coilMats: MeshStandardMaterial[] = [];
  const lampMats: MeshBasicMaterial[][] = [];
  SHAFT.coils.forEach((u) => {
    const y = yAt(u);
    const cm = keep(new MeshStandardMaterial({ color: 0x0f2426, metalness: 0.6, roughness: 0.35, emissive: COOLANT.clone(), emissiveIntensity: 0.6 }));
    coilMats.push(cm);
    const coil = mesh(new TorusGeometry(COIL_R, 0.11, 12, 120), cm);
    coil.rotation.x = Math.PI / 2;
    coil.position.y = y;
    ringGroup.add(coil);
    // Its pipes up to the next, in iron, at the back.
    const lamps = CHAIN_X.map((x) => {
      const z = Math.sqrt(COIL_R * COIL_R - x * x);
      const lm = keep(new MeshBasicMaterial({ color: 0x2a2f33 }));
      const l = mesh(new SphereGeometry(0.13, 12, 8), lm);
      l.position.set(x, y, z);
      ringGroup.add(l);
      return lm;
    });
    lampMats.push(lamps);
  });
  for (const a of [Math.PI * 0.85, Math.PI * 1.15, Math.PI * 1.5]) {
    const p = mesh(new CylinderGeometry(0.07, 0.07, yAt(SHAFT.coils[4]) - yAt(SHAFT.coils[0]) + 0.4, 8), steel);
    p.position.set(Math.sin(a) * COIL_R, (yAt(SHAFT.coils[4]) + yAt(SHAFT.coils[0])) / 2, Math.cos(a) * COIL_R);
    ringGroup.add(p);
  }
  // The hatch: a heavy ring at the top, main's checks in its light, the gantry with the four winches across it.
  const hatchY = yAt(SHAFT.ship);
  const hatchMat = keep(new MeshStandardMaterial({ color: 0x23201c, metalness: 0.8, roughness: 0.35, emissive: PASS.clone(), emissiveIntensity: 0.25 }));
  const hatch = mesh(new TorusGeometry(COIL_R + 0.4, 0.26, 14, 120), hatchMat);
  hatch.rotation.x = Math.PI / 2;
  hatch.position.y = hatchY;
  ringGroup.add(skin(hatch, 0.2, 40));
  const hatchLight = mesh(new TorusGeometry(COIL_R + 0.12, 0.035, 6, 120), keep(new MeshBasicMaterial({ color: PASS.clone() })));
  hatchLight.rotation.x = Math.PI / 2;
  hatchLight.position.y = hatchY - 0.12;
  ringGroup.add(hatchLight);
  const gantryY = Y1 + 1.4;
  const gantry = mesh(new BoxGeometry(COIL_R * 2 + 2.4, 0.38, 0.5), ironDark);
  gantry.position.set(0, gantryY, 0);
  scene.add(skin(gantry, 0.3));
  for (const s of [-1, 1]) {
    const leg = mesh(new BoxGeometry(0.34, gantryY - hatchY + 0.2, 0.34), ironDark);
    leg.position.set(s * (COIL_R + 1.0), (gantryY + hatchY) / 2, 0);
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

  // ---- the crew ---------------------------------------------------------------------------------------------------
  const box = (w: number, h: number, d: number, m: Material, x = 0, y = 0, z = 0) => {
    const b = mesh(new BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    return b;
  };
  const cyl = (r0: number, r1: number, h: number, m: Material, seg = 14) => mesh(new CylinderGeometry(r0, r1, h, seg), m);
  /** A limb from a to b. */
  const limb = (a: Vector3, b: Vector3, r: number, m: Material) => {
    const d = b.clone().sub(a);
    const l = cyl(r, r * 0.8, d.length(), m, 8);
    l.position.copy(a).addScaledVector(d, 0.5);
    l.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
    return l;
  };
  const hammer = (m: Material) => {
    const g = new Group();
    const h = cyl(0.028, 0.028, 0.56, iron, 6);
    h.position.y = -0.28;
    const head = box(0.2, 0.12, 0.12, steel, 0, -0.56, 0);
    head.rotation.y = Math.PI / 2;
    g.add(h, head);
    void m;
    return g;
  };
  const sleepRing = () => {
    const rm = keep(new MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: 0 }));
    const r = mesh(new TorusGeometry(0.62, 0.03, 6, 48), rm);
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.03;
    return { r, rm };
  };
  /** Rusty's frame, and his dock crew's: a salvage compactor on treads, binocular eyes, a hammer in one claw. */
  function compactor(paintHex: string): Bot {
    const g = new Group();
    const paint = keep(new MeshStandardMaterial({ color: new Color(paintHex), metalness: 0.5, roughness: 0.48 }));
    for (const s of [-1, 1]) {
      const t = box(0.24, 0.28, 0.92, ironDark, s * 0.42, 0.15, 0);
      g.add(skin(t, 0.22));
      for (const z of [-0.32, 0, 0.32]) {
        const w = cyl(0.12, 0.12, 0.26, steel, 12);
        w.rotation.z = Math.PI / 2;
        w.position.set(s * 0.42, 0.15, z);
        g.add(w);
      }
    }
    const body = box(0.78, 0.66, 0.7, paint, 0, 0.64, 0);
    g.add(skin(body, 0.3));
    g.add(box(0.5, 0.26, 0.02, ironDark, 0, 0.62, 0.36));
    g.add(box(0.82, 0.05, 0.74, steel, 0, 0.98, 0));
    const neck = cyl(0.05, 0.06, 0.3, steel, 8);
    neck.position.y = 1.12;
    g.add(neck);
    const head = new Group();
    head.position.y = 1.3;
    const eyes = keep(new MeshBasicMaterial({ color: 0xffe2a8 }));
    for (const s of [-1, 1]) {
      const e = cyl(0.11, 0.12, 0.24, paint, 14);
      e.rotation.x = Math.PI / 2;
      e.position.set(s * 0.13, 0, 0.02);
      head.add(skin(e, 0.25));
      const lens = mesh(new CircleGeometry(0.075, 16), eyes);
      lens.position.set(s * 0.13, 0, 0.145);
      head.add(lens);
    }
    g.add(head);
    const left = new Group();
    left.position.set(-0.46, 0.86, 0.05);
    left.add(box(0.08, 0.4, 0.08, steel, 0, -0.2, 0), box(0.14, 0.08, 0.14, paint, 0, -0.42, 0.02));
    left.rotation.x = -0.5;
    const arm = new Group();
    arm.position.set(0.46, 0.86, 0.05);
    arm.add(box(0.08, 0.4, 0.08, steel, 0, -0.2, 0));
    const hm = hammer(steel);
    hm.position.y = -0.4;
    hm.rotation.x = Math.PI / 2;
    arm.add(hm);
    g.add(left, arm);
    const { r, rm } = sleepRing();
    g.add(r);
    return { g, arm, head, eyes, paint, ring: rm };
  }
  /** Rocky: the master builder, a stone carapace on five legs, one of them holding the hammer. */
  function eridian(): Bot {
    const g = new Group();
    const stone = keep(new MeshStandardMaterial({ color: 0x8d7a5c, metalness: 0.15, roughness: 0.85 }));
    const shell = mesh(new SphereGeometry(0.58, 5, 6, 0, Math.PI * 2, 0, Math.PI / 2), stone);
    shell.scale.set(1, 0.72, 1);
    shell.position.y = 0.82;
    g.add(skin(shell, 0.3, 10));
    const under = cyl(0.58, 0.42, 0.18, stone, 5);
    under.position.y = 0.74;
    g.add(under);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
      if (k === 4) continue;
      const hip = new Vector3(Math.sin(a) * 0.45, 0.76, Math.cos(a) * 0.45);
      const knee = new Vector3(Math.sin(a) * 0.95, 1.02, Math.cos(a) * 0.95);
      const foot = new Vector3(Math.sin(a) * 1.08, 0, Math.cos(a) * 1.08);
      g.add(limb(hip, knee, 0.07, stone), limb(knee, foot, 0.055, stone));
    }
    // The fifth leg, at the front, is the hammer arm.
    const arm = new Group();
    arm.position.set(0, 0.8, 0.45);
    arm.add(limb(new Vector3(0, 0, 0), new Vector3(0, -0.5, 0.1), 0.065, stone));
    const hm = hammer(steel);
    hm.position.set(0, -0.5, 0.1);
    hm.rotation.x = Math.PI / 2;
    arm.add(hm);
    g.add(arm);
    const eyes = keep(new MeshBasicMaterial({ color: 0x000000 }));
    const { r, rm } = sleepRing();
    g.add(r);
    return { g, arm, head: shell, eyes, paint: stone, ring: rm };
  }
  /** Rivet: hard hat and hi-vis, by the alarm post. */
  function rivetBody(): Bot {
    const g = new Group();
    const suit = keep(new MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.5, roughness: 0.5 }));
    const vis = keep(new MeshStandardMaterial({ color: 0xd8f23a, metalness: 0.1, roughness: 0.6, emissive: 0x3a4a00, emissiveIntensity: 0.5 }));
    const hat = keep(new MeshStandardMaterial({ color: 0xf2c230, metalness: 0.2, roughness: 0.4 }));
    for (const s of [-1, 1]) {
      const l = cyl(0.07, 0.06, 0.62, suit, 8);
      l.position.set(s * 0.12, 0.31, 0);
      g.add(l);
    }
    const torso = cyl(0.24, 0.2, 0.6, suit, 14);
    torso.position.y = 0.92;
    g.add(torso);
    const vest = cyl(0.265, 0.23, 0.44, vis, 14);
    vest.position.y = 0.95;
    g.add(skin(vest, 0.2));
    for (const y of [0.86, 1.02]) {
      const st = mesh(new TorusGeometry(0.255, 0.018, 4, 24), keep(new MeshBasicMaterial({ color: 0xe8f0f0 })));
      st.rotation.x = Math.PI / 2;
      st.position.y = y;
      g.add(st);
    }
    const head = new Group();
    head.position.y = 1.42;
    const skull = mesh(new SphereGeometry(0.19, 16, 12), suit);
    head.add(skull);
    const eyes = keep(new MeshBasicMaterial({ color: 0x9ff2e0 }));
    head.add(box(0.24, 0.06, 0.02, eyes, 0, 0, 0.18));
    const dome = mesh(new SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat);
    dome.position.y = 0.05;
    const brim = cyl(0.3, 0.3, 0.03, hat, 20);
    brim.position.y = 0.05;
    head.add(skin(dome, 0.3), brim);
    g.add(head);
    const left = new Group();
    left.position.set(-0.3, 1.14, 0);
    left.add(box(0.07, 0.42, 0.07, suit, 0, -0.21, 0));
    left.rotation.z = -0.2;
    const arm = new Group();
    arm.position.set(0.3, 1.14, 0);
    arm.add(box(0.07, 0.42, 0.07, suit, 0, -0.21, 0));
    const wrench = box(0.05, 0.3, 0.05, steel, 0, -0.5, 0.05);
    arm.add(wrench);
    g.add(left, arm);
    const { r, rm } = sleepRing();
    g.add(r);
    return { g, arm, head, eyes, paint: hat, ring: rm };
  }

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
    bot: Bot;
    anvil: ReturnType<typeof anvil>;
    ingot: Mesh<BoxGeometry, MeshStandardMaterial>;
    ingotGlow: Sprite;
    y: number;
    v: FurnaceSlotView | null;
    hammerT: number;
    hit: Mesh;
    botHit: Mesh;
    chainX: number;
    chainZ: number;
    winch: MeshStandardMaterial | null;
    lamps: MeshBasicMaterial[] | null;
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
  const SLOT_ANG = [-1.22, -0.62, 0.62, 1.22];
  const plinthMat = keep(new MeshStandardMaterial({ color: 0x1f1d1b, metalness: 0.75, roughness: 0.4 }));
  const slots: SlotRig[] = SLOT_ANG.map((a, i) => {
    const at = new Vector3(Math.sin(a) * 6.1, 0, Math.cos(a) * 6.1);
    const plinth = mesh(new CylinderGeometry(1.25, 1.38, 0.28, 6), plinthMat);
    plinth.position.set(Math.sin(a) * 5.55, 0.14, Math.cos(a) * 5.55);
    plinth.rotation.y = a;
    scene.add(skin(plinth, 0.4));
    const bot = compactor("#d0844a");
    bot.g.scale.setScalar(1.4);
    bot.g.position.copy(at).setY(0.28);
    bot.g.lookAt(0, 0.28, 0);
    scene.add(bot.g);
    const av = anvil();
    av.g.position.set(Math.sin(a) * 5.1, 0.28, Math.cos(a) * 5.1);
    av.g.lookAt(0, 0.28, 0);
    av.g.rotateY(Math.PI / 2);
    scene.add(av.g);
    const { ing, gl } = makeIngot();
    const hit = mesh(new BoxGeometry(1.3, 0.9, 1), hitMat);
    scene.add(hit);
    const botHit = mesh(new BoxGeometry(1.6, 2, 1.6), hitMat);
    botHit.position.copy(at).setY(1);
    scene.add(botHit);
    return { at, bot, anvil: av, ingot: ing, ingotGlow: gl, y: Y0 - 0.4, v: null, hammerT: Math.random() * 6, hit, botHit, chainX: CHAIN_X[i]!, chainZ: 0, winch: winchMats[i]!, lamps: lampMats.map((l) => l[i]!), lens: lensMats[i]! };
  });
  const rocky = eridian();
  rocky.g.scale.setScalar(1.4);
  rocky.g.visible = false;
  scene.add(rocky.g);
  // Rivet's corner: her plinth, her hoist on its own short frame with five small coils, the alarm post with its lamp.
  const rivet: SlotRig = (() => {
    const at = RIVET_AT.clone();
    const plinth = mesh(new CylinderGeometry(1.1, 1.2, 0.28, 6), plinthMat);
    plinth.position.copy(at).setY(0.14);
    scene.add(skin(plinth, 0.4));
    const bot = rivetBody();
    bot.g.scale.setScalar(1.35);
    bot.g.position.copy(at).setY(0.28);
    bot.g.lookAt(0, 0.28, 2);
    scene.add(bot.g);
    const av = anvil();
    av.g.position.set(at.x - 0.9, 0.28, at.z + 0.6);
    av.g.lookAt(0, 0.28, 0);
    av.g.rotateY(Math.PI / 2);
    scene.add(av.g);
    const { ing, gl } = makeIngot();
    ing.scale.setScalar(0.7);
    const hit = mesh(new BoxGeometry(1, 0.8, 0.8), hitMat);
    scene.add(hit);
    const botHit = mesh(new BoxGeometry(1.4, 2, 1.4), hitMat);
    botHit.position.copy(at).setY(1);
    scene.add(botHit);
    const hx = at.x - 0.2;
    const hz = at.z - 1.4;
    const frameTop = yAt(SHAFT.ship) + 0.6;
    for (const s of [-1, 1]) {
      const post = box(0.16, frameTop, 0.16, ironDark, hx + s * 0.8, frameTop / 2, hz);
      scene.add(skin(post, 0.25));
    }
    scene.add(skin(box(1.9, 0.22, 0.3, ironDark, hx, frameTop, hz), 0.3));
    const lamps = SHAFT.coils.map((u) => {
      const cm = keep(new MeshBasicMaterial({ color: COOLANT.clone() }));
      const c = mesh(new TorusGeometry(0.62, 0.05, 8, 40), cm);
      c.rotation.x = Math.PI / 2;
      c.position.set(hx, yAt(u), hz);
      scene.add(c);
      return cm;
    });
    // The alarm post: main's checks lamp, which Rivet keeps watch from.
    const post = cyl(0.06, 0.08, 2.3, steel, 8);
    post.position.set(at.x + 0.9, 1.15, at.z + 0.3);
    scene.add(post);
    const thermos = cyl(0.06, 0.06, 0.2, keep(new MeshStandardMaterial({ color: 0x8a2a20, metalness: 0.6, roughness: 0.4 })), 10);
    thermos.position.set(at.x + 0.9, 1.1, at.z + 0.42);
    scene.add(thermos);
    return { at, bot, anvil: av, ingot: ing, ingotGlow: gl, y: Y0, v: null, hammerT: 0, hit, botHit, chainX: hx, chainZ: hz, winch: null, lamps, lens: null };
  })();
  const alarmMat = keep(new MeshBasicMaterial({ color: PASS.clone() }));
  const alarm = mesh(new SphereGeometry(0.16, 14, 10), alarmMat);
  alarm.position.set(RIVET_AT.x + 0.9, 2.38, RIVET_AT.z + 0.3);
  scene.add(alarm);
  const alarmGlow = glow(PASS, 1.4, 0.6);
  alarmGlow.position.copy(alarm.position);
  scene.add(alarmGlow);

  // The ore cart: the queue, raw blocks of work waiting at the foot of the shaft.
  const cart = new Group();
  cart.position.set(-6.9, 0, -0.9);
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
    g.font = `42px "Noto Sans Runic","Geist Mono Variable",monospace`;
    GLYPHS.slice(0, 64).forEach((ch, i) => g.fillText(ch, (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34));
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const NG = Math.min(64, GLYPHS.length);
  const px = { value: renderer.getPixelRatio() };
  // The live ones, moved on the CPU: embers rising off the melt, each ingot's swarm, hammer sparks.
  const NE = PH ? 140 : 320;
  const NS = PH ? 14 : 26;
  const NK = PH ? 60 : 140;
  const NN = NE + NS * 5 + NK;
  const gp = new Float32Array(NN * 3);
  const gc = new Float32Array(NN * 3);
  const ga = new Float32Array(NN);
  const gg = new Float32Array(NN);
  const gs = new Float32Array(NN);
  for (let i = 0; i < NN; i++) {
    gg[i] = Math.floor(Math.random() * NG);
    gs[i] = i < NE ? 0.55 + Math.random() * 0.6 : i < NE + NS * 5 ? 0.45 + Math.random() * 0.3 : 0.35 + Math.random() * 0.3;
  }
  const gGeo = keep(new BufferGeometry());
  gGeo.setAttribute("position", new BufferAttribute(gp, 3));
  gGeo.setAttribute("tint", new BufferAttribute(gc, 3));
  gGeo.setAttribute("alpha", new BufferAttribute(ga, 1));
  gGeo.setAttribute("glyph", new BufferAttribute(gg, 1));
  gGeo.setAttribute("sz", new BufferAttribute(gs, 1));
  const glyphs = new Points(
    gGeo,
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { atlas: { value: atlas }, px },
        vertexShader: `attribute vec3 tint; attribute float alpha, glyph, sz; uniform float px; varying vec3 vC; varying float vA; varying vec2 vCell;
          void main(){ vC = tint; vA = alpha; vCell = vec2(mod(glyph, 8.), floor(glyph / 8.)); vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = sz * 26. * px * (8./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec3 vC; varying float vA; varying vec2 vCell;
          void main(){ if (vA < .01) discard; vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard; gl_FragColor = vec4(vC, m*vA); }`,
      }),
    ),
  );
  glyphs.frustumCulled = false;
  glyphs.renderOrder = 6;
  scene.add(glyphs);
  const emb = Array.from({ length: NE }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  const sw = Float32Array.from({ length: NS * 5 * 3 }, () => Math.random() * 2 - 1);
  const spk = Array.from({ length: NK }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 0.6, b: 0.2 }));

  // ---- the edges come undone into gold wire and code (the Senate's language, #856) -------------------------------
  const edgeU = { t: { value: 0 }, res: { value: new Vector2(1, 1) }, atlas: { value: atlas }, px };
  const EDGE = `uniform vec2 res; float edgeOf(){ vec2 q = gl_FragCoord.xy / res * 2. - 1.; return length(q * vec2(.9, 1.)) / 1.32; }
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`;
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
          void main(){ float e = smoothstep(.5, .98, edgeOf()); if (e < .01) discard;
            float g = hash(vec3(floor(gl_FragCoord.xy / 3.), floor(t * 6.)));
            float scan = .5 + .5 * sin(gl_FragCoord.y * .9 + t * 2.);
            vec3 c = vec3(.026, .022, .018) + vec3(.79, .66, .36) * e * .05 * scan;
            gl_FragColor = vec4(c, e * (.6 + .14 * g)); }`,
      }),
    ),
  );
  veil.frustumCulled = false;
  veil.renderOrder = 20;
  scene.add(veil);
  const wire: number[] = [];
  const VERT = PH ? 30 : 56;
  const RING = PH ? 56 : 112;
  for (let k = 0; k <= VERT; k++) {
    const a = Math.PI / 2 + (k / VERT) * Math.PI;
    wire.push(Math.sin(a) * (WALL_R - 0.6), 0, Math.cos(a) * (WALL_R - 0.6), Math.sin(a) * (WALL_R - 0.6), 28, Math.cos(a) * (WALL_R - 0.6));
  }
  for (let y = 0.8; y < 28; y += 1.3)
    for (let k = 0; k < RING / 2; k++) {
      const a0 = Math.PI / 2 + (k / (RING / 2)) * Math.PI;
      const a1 = Math.PI / 2 + ((k + 1) / (RING / 2)) * Math.PI;
      const r = WALL_R - 0.6;
      wire.push(Math.sin(a0) * r, y, Math.cos(a0) * r, Math.sin(a1) * r, y, Math.cos(a1) * r);
    }
  for (let r = 7; r < WALL_R + 2; r += 1.2)
    for (let k = 0; k < RING; k++) {
      const a0 = (k / RING) * Math.PI * 2;
      const a1 = ((k + 1) / RING) * Math.PI * 2;
      wire.push(Math.cos(a0) * r, 0.03, Math.sin(a0) * r, Math.cos(a1) * r, 0.03, Math.sin(a1) * r);
    }
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    wire.push(Math.cos(a) * 7, 0.03, Math.sin(a) * 7, Math.cos(a) * (WALL_R + 2), 0.03, Math.sin(a) * (WALL_R + 2));
  }
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
          void main(){ float e = smoothstep(.36, .92, edgeOf()); if (e < .01) discard;
            vec3 cell = floor(vW * 2.2); float h = hash(cell + floor(t * .7 + hash(cell) * 4.));
            if (h < .35 - e * .2) discard;
            float fl = .75 + .25 * sin(t * 3. + h * 40.);
            gl_FragColor = vec4(vec3(.79, .66, .36) * fl, e * .75); }`,
      }),
    ),
  );
  wires.frustumCulled = false;
  wires.renderOrder = 21;
  scene.add(wires);
  const ND = PH ? 380 : 1100;
  const dp = new Float32Array(ND * 3);
  const dg = new Float32Array(ND);
  const dr = new Float32Array(ND);
  for (let i = 0; i < ND; i++) {
    const onWall = Math.random() < 0.72;
    const a = onWall ? Math.PI / 2 + Math.random() * Math.PI : Math.random() * Math.PI * 2;
    const y = onWall ? 0.3 + Math.random() * 26 : 0.05;
    const r = onWall ? WALL_R - 0.7 : 7 + Math.random() * 5;
    dp.set([Math.sin(a) * r, y, Math.cos(a) * r], i * 3);
    dg[i] = Math.floor(Math.random() * NG);
    dr[i] = Math.random();
  }
  const dGeo = keep(new BufferGeometry());
  dGeo.setAttribute("position", new BufferAttribute(dp, 3));
  dGeo.setAttribute("glyph", new BufferAttribute(dg, 1));
  dGeo.setAttribute("rnd", new BufferAttribute(dr, 1));
  const codeDust = new Points(
    dGeo,
    keep(
      new ShaderMaterial({
        uniforms: edgeU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd; uniform float t, px; varying vec2 vCell; varying float vR;
          void main(){ vR = rnd; float g = mod(glyph + floor(t * .8 + rnd * 9.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position; p.y += fract(t * .03 + rnd) * 1.4;
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.6 + rnd * .6) * 24. * px * (7. / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; uniform float t; varying vec2 vCell; varying float vR; ${EDGE}
          void main(){ float e = smoothstep(.4, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float wink = .45 + .55 * sin(t * 1.7 + vR * 50.);
            gl_FragColor = vec4(mix(vec3(.79, .66, .36), vec3(.89, .79, .55), vR), m * e * wink * .85); }`,
      }),
    ),
  );
  codeDust.frustumCulled = false;
  codeDust.renderOrder = 22;
  scene.add(codeDust);
  // Faint sigils peeling off the wires as the grid turns into nanites (#878).
  const NP = PH ? 120 : 360;
  const pp = new Float32Array(NP * 3);
  const pd = new Float32Array(NP * 3);
  const pg = new Float32Array(NP);
  const pr = new Float32Array(NP);
  const segs = wire.length / 6;
  for (let i = 0; i < NP; i++) {
    const k = Math.floor(Math.random() * segs) * 6;
    const f = Math.random();
    const x = wire[k]! + (wire[k + 3]! - wire[k]!) * f;
    const y = wire[k + 1]! + (wire[k + 4]! - wire[k + 1]!) * f;
    const z = wire[k + 2]! + (wire[k + 5]! - wire[k + 2]!) * f;
    pp.set([x, y, z], i * 3);
    const r = Math.hypot(x, z) || 1;
    const floor = y < 0.1;
    const out = floor ? 0.15 : -(0.5 + Math.random() * 0.9);
    pd.set([(x / r) * out + (Math.random() - 0.5) * 0.3, floor ? 0.6 + Math.random() * 0.8 : 0.25 + Math.random() * 0.6, (z / r) * out + (Math.random() - 0.5) * 0.3], i * 3);
    pg[i] = Math.floor(Math.random() * NG);
    pr[i] = Math.random();
  }
  const pGeo = keep(new BufferGeometry());
  pGeo.setAttribute("position", new BufferAttribute(pp, 3));
  pGeo.setAttribute("drift", new BufferAttribute(pd, 3));
  pGeo.setAttribute("glyph", new BufferAttribute(pg, 1));
  pGeo.setAttribute("rnd", new BufferAttribute(pr, 1));
  const peel = new Points(
    pGeo,
    keep(
      new ShaderMaterial({
        uniforms: edgeU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `attribute float glyph, rnd; attribute vec3 drift; uniform float t, px; varying vec2 vCell; varying float vL;
          void main(){ float ph = fract(t * (.035 + rnd * .03) + rnd * 7.31); vL = ph;
            float g = mod(glyph + floor(ph * 3. + rnd * 5.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
            vec3 p = position + drift * ph * (1. + ph * .6);
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.45 + rnd * .35) * 22. * px * (7. / -mv.z) * (1. - ph * .35);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec2 vCell; varying float vL; ${EDGE}
          void main(){ float e = smoothstep(.38, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float life = smoothstep(0., .12, vL) * (1. - smoothstep(.45, 1., vL));
            vec3 c = mix(vec3(.89, .79, .55), vec3(.79, .66, .36), smoothstep(0., .5, vL));
            gl_FragColor = vec4(c, m * e * life * .34); }`,
      }),
    ),
  );
  peel.frustumCulled = false;
  peel.renderOrder = 22;
  scene.add(peel);

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
      yawTo = Math.max(-0.55, Math.min(0.55, yawTo + (e.clientX - lastX) * 0.004));
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
  const tmpC2 = new Color();
  const tmpV = new Vector3();
  const M = new Matrix4();
  const Q = new Quaternion();
  const Q2 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const ONE = new Vector3(1, 1, 1);
  const anchors: [string, Vector3][] = [
    ["queue", new Vector3()],
    ["ship", new Vector3(-COIL_R - 1.4, gantryY + 0.3, 0)],
    ["rivet", new Vector3()],
    ["z-work", new Vector3(-COIL_R - 0.6, yAt(SHAFT.work[1]) - 0.4, 0)],
    ["z-pictures", new Vector3(-COIL_R - 0.9, picY, 0)],
    ["z-checks", new Vector3(-COIL_R - 0.4, yAt(SHAFT.coils[4]) + 0.9, 0)],
    ["z-ship", new Vector3(-COIL_R - 0.8, hatchY, 0)],
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
    else rv.copy(rivet.at).setY(2.2);
    slots.forEach((s, i) => {
      const a = anchor.get(`s${i}`)!;
      if (s.v?.busy) a.set(s.chainX, s.y + 0.55, s.chainZ);
      else a.copy(s.at).setY(2);
    });
    for (const [id, p] of anchors) {
      tmpV.copy(p).project(cam);
      const x = ((tmpV.x + 1) / 2) * w;
      const y = ((1 - tmpV.y) / 2) * h;
      const on = tmpV.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
      const key = `${Math.round(x)}|${Math.round(y)}|${on}`;
      if (placed.get(id) === key) continue;
      placed.set(id, key);
      opts.onPlace(id, x, y, on);
    }
  };

  // ---- the state each frame ---------------------------------------------------------------------------------------
  const apply = () => {
    const usedRocky = view.slots.findIndex((s) => s.hand === "Rocky");
    rocky.g.visible = usedRocky >= 0;
    slots.forEach((s, i) => {
      const v = view.slots[i] ?? null;
      s.v = v;
      const isRocky = i === usedRocky;
      s.bot.g.visible = !isRocky;
      if (isRocky) {
        rocky.g.position.copy(s.at).setY(0.28);
        rocky.g.lookAt(0, 0.28, 0);
      }
      if (v && !isRocky) s.bot.paint.color.set(v.paint);
      if (v && s.winch) s.winch.color.set(v.paint);
    });
    rivet.v = view.rivet;
    ores.forEach((o, i) => (o.visible = i < Math.min(8, view.queue)));
    plates.forEach((p, i) => (p.visible = i < Math.min(8, view.shipped)));
    const mc = COIL_COL[view.main];
    hatchMat.emissive.copy(view.main === "wait" ? GOLD : mc);
    (hatchLight.material as MeshBasicMaterial).color.copy(view.main === "wait" ? GOLD : mc);
    alarmMat.color.copy(view.main === "wait" ? GOLD : mc);
    alarmGlow.material.color.copy(view.main === "wait" ? GOLD : mc);
  };
  apply();

  const spark = (x: number, y: number, z: number, n: number, col: Color, up = 1) => {
    for (let k = 0; k < n; k++) {
      const p = spk.find((q) => q.life <= 0);
      if (!p) return;
      p.life = p.max = 0.5 + Math.random() * 0.7;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = (Math.random() - 0.5) * 2.4;
      p.vy = (0.6 + Math.random() * 2.2) * up;
      p.vz = (Math.random() - 0.5) * 2.4;
      p.r = col.r;
      p.g = col.g;
      p.b = col.b;
    }
  };

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
    const lit = hot === null || hot === (isRivet ? "rivet" : `s${i}`) ? 1 : 0.55;
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
    s.ingotGlow.scale.setScalar(isRivet ? 1.8 : 2.6 + (hot === (isRivet ? "rivet" : `s${i}`) ? 0.9 : 0));
    // Chain.
    if (busy) chainTo(s.chainX + sway * 0.5, s.chainZ, isRivet ? yAt(SHAFT.ship) + 0.5 : gantryY - 0.5, s.y + 0.22);
    // Coil lamps for this chain.
    if (s.lamps)
      s.lamps.forEach((lm) => {
        lm.color.copy(busy ? COIL_COL[v!.coil] : isRivet ? COOLANT : tmpC2.set(0x2a2f33));
        if (busy && v!.coil === "run" && !reduce) lm.color.multiplyScalar(0.7 + 0.3 * Math.sin(T * 6 + i));
      });
    if (s.lens) s.lens.opacity = busy && v!.u >= SHAFT.pictures - 0.01 ? 0.95 : 0.25;
    // The hand.
    const asleep = !busy && !isRivet;
    const b = s.bot;
    b.ring.opacity = asleep ? 0.55 + (reduce ? 0 : 0.2 * Math.sin(T * 1.3 + i)) : 0;
    b.eyes.color.set(asleep ? 0x2a1610 : isRivet ? 0x9ff2e0 : 0xffe2a8);
    b.head.rotation.x = asleep ? 0.45 : 0;
    const working = busy && v!.hammer && !reduce;
    if (working) {
      s.hammerT += dt * (b === rocky ? 1.25 : 1);
      const ph = s.hammerT % 1.1;
      // Up slowly, down hard.
      const ang = ph < 0.75 ? -0.4 - (ph / 0.75) * 1.9 : -2.3 + ((ph - 0.75) / 0.35) * 1.9;
      b.arm.rotation.x = ang;
      if (ph >= 1.02 && ph - dt * 1 < 1.02) {
        s.anvil.g.getWorldPosition(tmpV);
        spark(tmpV.x, 1.08, tmpV.z, PH ? 4 : 8, tmpC.copy(AMBER));
      }
    } else b.arm.rotation.x += ((asleep ? 0 : -0.4) - b.arm.rotation.x) * 0.1;
    s.anvil.piece.visible = busy && v!.hammer;
    s.anvil.pm.emissiveIntensity = 1.6 + (working ? 0.8 * Math.max(0, Math.sin(s.hammerT * 5.7)) : 0);
  };

  const stepGlyphs = (dt: number, T: number) => {
    const calm = reduce ? 0 : 1;
    // Embers off the melt, rising up the shaft and cooling to gold.
    if (calm)
      for (let k = 0; k < (PH ? 2 : 4); k++) {
        const e = emb[Math.floor(Math.random() * NE)]!;
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
        gg[emb.indexOf(e)] = Math.floor(Math.random() * NG);
      }
    for (let i = 0; i < NE; i++) {
      const e = emb[i]!;
      if (e.life <= 0) {
        ga[i] = reduce && i < 60 ? 0.35 : 0;
        if (reduce && i < 60) {
          const a = (i / 60) * 6.283;
          gp.set([Math.cos(a) * 2, Y0 + 0.6 + (i % 7) * 0.5, Math.sin(a) * 2], i * 3);
          heatCol(0.1, tmpC).toArray(gc, i * 3);
        }
        continue;
      }
      e.life -= dt;
      e.x += (e.vx + Math.sin(T * 0.7 + i) * 0.08) * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      gp.set([e.x, e.y, e.z], i * 3);
      const u = (e.y - Y0) / (Y1 - Y0);
      heatCol(u, tmpC);
      tmpC.lerp(GOLD_HI, Math.min(1, u * 1.4));
      tmpC.toArray(gc, i * 3);
      ga[i] = Math.min(1, e.life / e.max) * Math.min(1, (e.max - e.life) * 3) * 0.95;
    }
    // Each ingot's swarm: sigils clinging to the work, gold as it cools, red when it cracked.
    [...slots, rivet].forEach((s, j) => {
      const base = NE + j * NS;
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
    // Sparks.
    for (let i = 0; i < NK; i++) {
      const p = spk[i]!;
      const q = NE + NS * 5 + i;
      if (p.life <= 0) {
        ga[q] = 0;
        continue;
      }
      p.life -= dt;
      p.vy -= 3.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      gp.set([p.x, Math.max(0.05, p.y), p.z], q * 3);
      gc[q * 3] = p.r;
      gc[q * 3 + 1] = p.g;
      gc[q * 3 + 2] = p.b;
      ga[q] = Math.min(1, (p.life / p.max) * 1.5);
    }
    // A cracked ingot sheds red shards now and then.
    if (calm)
      [...slots, rivet].forEach((s) => {
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
  const draw = (dt: number) => {
    T += dt * (reduce ? 0.12 : 1);
    meltU.t.value = T;
    edgeU.t.value = reduce ? 0 : T;
    renderer.getDrawingBufferSize(edgeU.res.value);
    melt.intensity = 70 + (reduce ? 0 : 10 * Math.sin(T * 3.1) + 5 * Math.sin(T * 7.3));
    meltGlow.material.opacity = 0.5 + (reduce ? 0 : 0.06 * Math.sin(T * 2.3));
    // Coils: amber while any job is in them, red with any cracked, cool otherwise.
    SHAFT.coils.forEach((_, c) => {
      const states = [...slots, rivet].filter((s) => s.v?.busy).map((s) => s.v!.coil);
      // A red job shows on its own lamps and its cracked ingot; the coil itself only runs or rests.
      const st: CoilState = states.includes("run") ? "run" : "wait";
      const m = coilMats[c]!;
      m.emissive.copy(COIL_COL[st]);
      m.emissiveIntensity = (st === "wait" ? 0.45 : 0.55) + (st === "run" && !reduce ? 0.3 * Math.sin(T * 5 - c * 0.9) : 0);
    });
    link = 0;
    slots.forEach((s, i) => stepSlot(s, i, dt, T, false));
    if (rocky.g.visible) {
      const i = view.slots.findIndex((s) => s.hand === "Rocky");
      const s = slots[i];
      if (s) {
        // Rocky's hammer leg keeps time with his slot.
        const working = !!s.v?.busy && s.v.hammer && !reduce;
        const ph = s.hammerT % 1.1;
        rocky.arm.rotation.x = working ? (ph < 0.75 ? -(ph / 0.75) * 1.4 : -1.4 + ((ph - 0.75) / 0.35) * 1.4) : 0;
        rocky.g.position.y = 0.28 + (reduce ? 0 : 0.02 * Math.sin(T * 2));
      }
    }
    stepSlot(rivet, 4, dt, T, true);
    chains.count = link;
    chains.instanceMatrix.needsUpdate = true;
    stepGlyphs(dt, T);
    // The camera: up the shaft from the deck's edge, swaying slowly; a phone stands further back.
    const ph = phone();
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 4);
    yaw += (yawTo - yaw) * ek;
    if (!downAt) yawTo *= 1 - Math.min(1, dt * 0.25);
    const th = yaw + (reduce ? 0 : Math.sin(T * 0.05) * 0.1);
    // A phone stands well back and the frame drops under the headline; a wide screen shows the deck and its crew.
    const D = ph ? (cam.aspect < 0.7 ? 47 : 38) : 31;
    const camY = ph ? 8 : 5.6;
    cam.position.set(Math.sin(th) * D, camY, Math.cos(th) * D);
    look.set(0, ph ? 10.4 : 10, 0);
    cam.lookAt(look);
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (ph) cam.setViewOffset(w, h, 0, -h * 0.15, w, h);
    else cam.setViewOffset(w, h, -w * 0.04, -h * 0.02, w, h);
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
