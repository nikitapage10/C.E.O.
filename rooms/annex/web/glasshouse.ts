import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Euler,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
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
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { comeUndone, glyphMaterial, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { edgeFactor, SOFT, wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";

/**
 * The Annex as the Glasshouse (#829, concept 3, picked by Nikita 2026-11-05): a round crystal nursery under an Ilyr
 * twilight sky. The pop-ups that are running grow in beds on a slow-turning carousel, each under its own lamp and glass
 * cloche, its crop drawn from its own feed (Election night: one crystal per race civicAPI has called, in the party's
 * colour). The Shelf is the seed vault under the glass floor: a shelved pop-up pulls back to a seed and sinks into its
 * drawer, and re-spun it rises into the same bed and grows back as it was. Graduation carries the crop out of the door
 * to a plot of its own. Following a race stakes the bed in gold and turns its lamp gold. Nothing here runs on its own:
 * an empty bed stays empty, and every crop and seed is a real pop-up's.
 *
 * The Senate's look (#856, #878): solid models with a gold wire skin, gold sigil nanites in the air, and the frame's
 * edges coming undone into wire and code (`@ceo/engine/sigils/undone.ts`). Foliage in the beds and the planters and
 * out past the door; a skybox of Ilyr at dusk, seen through the glass. A/D (or a drag) swivel the view round the
 * carousel within a set arc, W/S dolly in and out a little, Escape snaps back. Phones get fewer particles and 30 frames a second; reduced motion holds it nearly still.
 * Lazy loaded with three.js, never in the Desk's first load.
 */

export type BedState = "bed" | "vault" | "plot";

export interface GlassPopup {
  id: string;
  name: string;
  /** Running in its bed, a seed on the Shelf, or graduated to its own plot. */
  state: BedState;
  /** Past its run: still in its bed, its lamp low. */
  ended: boolean;
  /** Something in it is followed: a gold stake and a gold lamp. */
  staked: boolean;
  /** What it has grown from its own feed, or null before its first answer (a sprout). */
  growth: { parts: { colour: string; n: number }[]; share: number } | null;
}

export interface GlassView {
  popups: GlassPopup[];
}

export interface GlassOpts {
  phone: boolean;
  reduce: boolean;
  view: GlassView;
  /** Where each anchor is on screen (host CSS pixels): each pop-up by its id, `free-0`..`free-3`, `vault`, `plot`. */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
  /** A bed, seed or plot was tapped: the pop-up's id. */
  onPick: (id: string) => void;
  /** The share of the frame's height, from the top, that the page's head lies over: the house is dropped below it (#932). */
  headroom?: () => number;
}

export interface Glasshouse {
  set: (view: GlassView) => void;
  dispose: () => void;
}

const PHONE_W = 760;
/** The dome. */
const R = 9;
const DH = 0.78;
const WALL_H = 1.2;
/** The carousel and its beds. */
const BEDS = 4;
const BED_R = 3.45;
/** The seed vault's ring of drawers under the glass floor. */
const VAULT_R = 6.65;
const DRAWERS = 12;
/** The door, at +x, and the plot past it. */
const PLOT = new Vector3(17.5, 0, 0);
const GOLD = 0xc9a85c;
const GOLD_HI = 0xe8c77a;
const STAKE = 0xf2dd5c;
const LAMP = 0xffe0b0;
const MAX_CRYSTALS = 64;
/** The swivel: how far either way the view turns from its home (rad), and how far it dollies in or out (share). */
const ARC = 0.75;
const ZOOM_ARC = 0.16;
/** A step of a bounded swivel: free inside the soft edge, resisted past it outward, stopped at the limit. */
function swing(v: number, d: number, lim: number): number {
  const out = d !== 0 && Math.sign(d) === Math.sign(v);
  return Math.max(-lim, Math.min(lim, v + (out ? d * edgeFactor(Math.abs(v) / lim) : d)));
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
/** A seeded random, so the garden grows the same way every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** A blade: tapered, bending forward (+z) as it rises; a fern frond or a blade of grass by how it is scaled. */
function bladeGeometry(): BufferGeometry {
  const seg = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const v = i / seg;
    const w = Math.sin(Math.PI * (0.08 + 0.92 * v)) * 0.18;
    pos.push(-w, v * 0.95, v * v * 0.45, w, v * 0.95, v * v * 0.45);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Glass: clear in the middle, catching the light at its rim (no lighting; it never hides what is under it). */
function glassMaterial(tint: number, rim: number, base: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { tint: { value: new Color(tint) }, rim: { value: rim }, base: { value: base } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 tint; uniform float rim, base; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 3.); gl_FragColor = vec4(tint, base + rim * f); }`,
  });
}

/** Ilyr at dusk: navy overhead, a violet band, the afterglow low past the door, stars, one pale moon, faint meridians. */
function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { t: { value: 0 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform float t; varying vec3 vD;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vD); float h = d.y;
        vec3 top = vec3(.018, .024, .062), mid = vec3(.075, .06, .15), low = vec3(.24, .13, .23), glow = vec3(.86, .5, .36);
        vec3 c = mix(mid, top, smoothstep(.05, .7, h));
        c = mix(low, c, smoothstep(-.02, .2, h));
        float toward = pow(max(0., dot(normalize(vec3(d.x, 0., d.z)), vec3(1., 0., 0.))), 3.);
        c += glow * toward * exp(-max(h, 0.) * 14.) * .55;
        c += vec3(.35, .22, .4) * exp(-abs(h) * 22.) * .25;
        vec3 cell = floor(d * 260.); float s = hash(cell);
        float star = step(.9965, s) * smoothstep(.06, .3, h) * (.55 + .45 * sin(t * (1. + s * 3.) + s * 60.));
        c += vec3(.85, .88, 1.) * star * .9;
        vec3 m = normalize(vec3(.78, .3, -.55)); float md = dot(d, m);
        c += vec3(.9, .9, .85) * smoothstep(.99935, .9995, md) + vec3(.35, .38, .5) * pow(max(md, 0.), 900.) * .9 + vec3(.2, .2, .3) * pow(max(md, 0.), 60.) * .12;
        float az = atan(d.z, d.x) / 6.2831853 * 10.;
        float mer = 1. - smoothstep(0., .012, abs(fract(az) - .5) - .488);
        c += vec3(.79, .66, .36) * mer * .05 * smoothstep(.04, .2, h) * (1. - smoothstep(.5, .9, h));
        gl_FragColor = vec4(c, 1.);
      }`,
  });
}

/** The far hills all round and the towers of Ilyr off one side, a few windows lit, drawn once into a wrap. */
function horizonTexture(): CanvasTexture {
  const W = 2048;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = rng(829);
  const ridge = (amp: number, base: number, k: number[], ph: number[]) => (x: number) => {
    const u = (x / W) * Math.PI * 2;
    return base - amp * k.reduce((s, f, i) => s + Math.sin(u * f + ph[i]!) / (i + 1), 0);
  };
  const layers = [
    { col: "rgba(52,40,74,0.95)", y: ridge(48, 196, [3, 7, 13, 29], [0.3, 1.2, 2.5, 0.7]) },
    { col: "rgb(13,11,26)", y: ridge(22, 222, [5, 11, 19, 41], [1.9, 0.4, 2.2, 1.1]) },
  ];
  for (const l of layers) {
    g.fillStyle = l.col;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, l.y(x));
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }
  // The towers of Ilyr, far off past the moon's side.
  for (let k = 0; k < 26; k++) {
    const x = 1180 + r() * 420;
    const w = 6 + r() * 16;
    const h = 30 + r() * 90 * (1 - Math.abs(x - 1390) / 260);
    const y0 = 222 - h;
    g.fillStyle = "rgb(20,18,32)";
    g.fillRect(x, y0, w, h + 20);
    g.fillStyle = "rgba(255,214,150,0.85)";
    for (let j = 0; j < h / 6; j++) if (r() < 0.12) g.fillRect(x + 1 + r() * (w - 3), y0 + 3 + j * 6, 1.6, 1.6);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
}

/** The glass floor's soil and stone, a little texture so it reads as a floor and not a void. */
function groundTexture(dark: string, speck: string, n: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = dark;
  g.fillRect(0, 0, 256, 256);
  const r = rng(n);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = speck;
    g.globalAlpha = 0.05 + r() * 0.12;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
  }
  g.globalAlpha = 1;
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Bed {
  g: Group;
  planter: Mesh;
  bulb: MeshBasicMaterial;
  shaft: MeshBasicMaterial;
  light: PointLight;
  stake: Group;
  ring: MeshBasicMaterial;
  on: number;
}

interface Crop {
  root: Group;
  crystals: InstancedMesh;
  fronds: InstancedMesh;
  sig: string;
}

interface PopRig {
  p: GlassPopup;
  bed: number;
  drawer: number;
  crop: Crop;
  seed: Mesh<SphereGeometry, MeshStandardMaterial>;
  seedGlow: Sprite;
  /** Where it was before its last change (null: settled), and how far through the change it is. */
  from: BedState | null;
  k: number;
  dur: number;
  grow: number;
  /** The seed's place this frame. */
  seedAt: Vector3;
  seedOn: boolean;
}

export async function createGlasshouse(host: HTMLElement, canvas: HTMLCanvasElement, opts: GlassOpts): Promise<Glasshouse> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.25 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new Scene();
  scene.background = new Color(0x05060c);
  scene.fog = new FogExp2(0x0d0b1a, 0.0115);
  const cam = new PerspectiveCamera(44, 1, 0.1, 400);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const px = { value: renderer.getPixelRatio() };
  const atlas = keep(await sigilAtlas());
  const NG = SIGIL_GLYPHS.length;

  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x8a94cc, 0x0c0906, 0.75));
  const moon = new DirectionalLight(0xbfcfff, 0.75);
  moon.position.set(31, 12, -22);
  scene.add(moon);
  const dusk = new DirectionalLight(0xffb48a, 0.35);
  dusk.position.set(40, 6, 0);
  scene.add(dusk);
  const heart = new PointLight(0xffd9a0, 22, 15, 1.6);
  heart.position.set(0, 5.5, 0);
  scene.add(heart);

  // ---- shared materials -------------------------------------------------------------------------------------------
  const bronze = keep(new MeshStandardMaterial({ color: 0x3a3027, metalness: 0.82, roughness: 0.36 }));
  const brass = keep(new MeshStandardMaterial({ color: 0x9c7c3c, metalness: 0.9, roughness: 0.3, emissive: 0x241a08 }));
  const stone = keep(new MeshStandardMaterial({ map: keep(groundTexture("#1a1b22", "#c9a85c", 3)), color: 0x9a98a4, metalness: 0.35, roughness: 0.7 }));
  const soilMat = keep(new MeshStandardMaterial({ map: keep(groundTexture("#120d09", "#6b5a3e", 7)), color: 0xb0a090, roughness: 1 }));
  const goldLine = keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.34, depthWrite: false }));
  const goldFaint = keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.16, depthWrite: false }));
  /** The Senate's wire skin over a solid: its hard edges in gold. */
  const skin = <M extends Mesh>(m: M, mat = goldLine, angle = 24): M => {
    m.add(new LineSegments(keep(new EdgesGeometry(m.geometry, angle)), mat));
    return m;
  };
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.3, "rgba(255,255,255,.4)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const glow = (col: number, size: number, op: number) => {
    const s = new Sprite(keep(new SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: AdditiveBlending })));
    s.scale.setScalar(size);
    return s;
  };
  const blade = keep(bladeGeometry());
  const leafMat = keep(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.05, side: DoubleSide, emissive: 0x0b1712 }));

  // ---- the sky ----------------------------------------------------------------------------------------------------
  const skyMat = keep(skyMaterial());
  const sky = new Mesh(keep(new SphereGeometry(200, 48, 24)), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);
  const hills = new Mesh(keep(new CylinderGeometry(170, 170, 42, 96, 1, true)), keep(new MeshBasicMaterial({ map: keep(horizonTexture()), transparent: true, side: BackSide, depthWrite: false, fog: false })));
  hills.position.y = 14;
  hills.renderOrder = -9;
  scene.add(hills);

  // ---- the ground outside -----------------------------------------------------------------------------------------
  const lawnTex = keep(groundTexture("#0c130f", "#3d5a3a", 11));
  lawnTex.repeat.set(26, 26);
  const lawn = new Mesh(keep(new CircleGeometry(170, 96)), keep(new MeshStandardMaterial({ map: lawnTex, color: 0x8fa08c, roughness: 0.95 })));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  scene.add(lawn);
  // The path from the door out to the plot, and the plot itself.
  const path = skin(new Mesh(keep(new BoxGeometry(6.4, 0.08, 1.9)), stone), goldFaint);
  path.position.set(12.4, 0.03, 0);
  scene.add(path);
  const plot = skin(new Mesh(keep(new CylinderGeometry(2.4, 2.55, 0.26, 48)), stone), goldFaint);
  plot.position.copy(PLOT).setY(0.12);
  scene.add(plot);
  const plotRim = new Mesh(keep(new TorusGeometry(2.45, 0.035, 4, 96)), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.55 })));
  plotRim.rotation.x = Math.PI / 2;
  plotRim.position.copy(PLOT).setY(0.26);
  scene.add(plotRim);
  const plotSoil = new Mesh(keep(new CircleGeometry(2.2, 40)), soilMat);
  plotSoil.rotation.x = -Math.PI / 2;
  plotSoil.position.copy(PLOT).setY(0.255);
  scene.add(plotSoil);
  const plotGroup = new Group();
  plotGroup.position.copy(PLOT).setY(0.26);
  scene.add(plotGroup);
  // Lanterns along the path.
  for (const z of [-1.35, 1.35])
    for (const x of [10.6, 13.4]) {
      const post = new Mesh(keep(new CylinderGeometry(0.05, 0.07, 1.1, 8)), brass);
      post.position.set(x, 0.55, z);
      scene.add(post);
      const l = glow(LAMP, 0.9, 0.85);
      l.position.set(x, 1.18, z);
      scene.add(l);
    }

  // ---- the house: base wall, glass dome, ribs, door -----------------------------------------------------------------
  const wall = skin(new Mesh(keep(new CylinderGeometry(R, R + 0.1, WALL_H, 96, 1, true, Math.PI / 2 + 0.24, Math.PI * 2 - 0.48)), bronze));
  wall.position.y = WALL_H / 2;
  scene.add(wall);
  const sill = new Mesh(keep(new TorusGeometry(R + 0.04, 0.07, 6, 160)), brass);
  sill.rotation.x = Math.PI / 2;
  sill.position.y = WALL_H;
  scene.add(sill);
  const dome = new Mesh(keep(new SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2)), keep(glassMaterial(0xb8d0ff, 0.34, 0.035)));
  dome.scale.y = DH;
  dome.position.y = WALL_H;
  dome.renderOrder = 5;
  scene.add(dome);
  const domeAt = (a: number, th: number, r = R) => new Vector3(Math.cos(a) * Math.cos(th) * r, WALL_H + Math.sin(th) * r * DH, Math.sin(a) * Math.cos(th) * r);
  // Ribs: solid brass tubes from the sill to the crown (none across the door).
  const RIBS = 16;
  const ribs: Vector3[][] = [];
  for (let k = 0; k < RIBS; k++) {
    const a = (k / RIBS) * Math.PI * 2 + Math.PI / RIBS;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.26) continue;
    const pts = Array.from({ length: 13 }, (_, j) => domeAt(a, (j / 12) * (Math.PI / 2 - 0.09)));
    ribs.push(pts);
    scene.add(new Mesh(keep(new TubeGeometry(new CatmullRomCurve3(pts), 24, 0.065, 5)), brass));
  }
  for (const f of [0.28, 0.56, 0.8]) {
    const th = (f * Math.PI) / 2;
    const t = new Mesh(keep(new TorusGeometry(Math.cos(th) * R, 0.05, 5, 128)), brass);
    t.rotation.x = Math.PI / 2;
    t.position.y = WALL_H + Math.sin(th) * R * DH;
    scene.add(t);
  }
  // The panes' leading: thin gold lines over the glass.
  {
    const w: number[] = [];
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      for (let j = 0; j < 10; j++) {
        const p0 = domeAt(a, (j / 10) * (Math.PI / 2), R + 0.01);
        const p1 = domeAt(a, ((j + 1) / 10) * (Math.PI / 2), R + 0.01);
        w.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }
    }
    for (let j = 1; j < 9; j++) {
      const th = (j / 9) * (Math.PI / 2);
      for (let k = 0; k < 96; k++) {
        const p0 = domeAt((k / 96) * Math.PI * 2, th, R + 0.01);
        const p1 = domeAt(((k + 1) / 96) * Math.PI * 2, th, R + 0.01);
        w.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }
    }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(w), 3));
    const lead = new LineSegments(g, keep(new LineBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.2, depthWrite: false })));
    lead.renderOrder = 6;
    scene.add(lead);
  }
  // The crown: an oculus ring and the seed dispenser hanging from it.
  const apexY = WALL_H + R * DH;
  const crown = new Mesh(keep(new TorusGeometry(0.9, 0.1, 8, 48)), brass);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = apexY - 0.04;
  scene.add(crown);
  const disp = skin(new Mesh(keep(new CylinderGeometry(0.32, 0.55, 0.85, 20)), bronze));
  disp.position.y = apexY - 0.55;
  scene.add(disp);
  const dispGlow = glow(STAKE, 1.4, 0.35);
  dispGlow.position.y = apexY - 1.0;
  scene.add(dispGlow);
  // The door at +x: two posts, an arch, a warm wash in the opening.
  const doorL = skin(new Mesh(keep(new BoxGeometry(0.42, 4.1, 0.42)), bronze));
  doorL.position.set(R, 2.05, -1.45);
  const doorR = doorL.clone();
  doorR.position.z = 1.45;
  const arch = new Mesh(keep(new TorusGeometry(1.45, 0.2, 8, 28, Math.PI)), brass);
  arch.rotation.y = Math.PI / 2;
  arch.position.set(R, 4.1, 0);
  const threshold = new Mesh(keep(new BoxGeometry(0.9, 0.08, 2.9)), brass);
  threshold.position.set(R, 0.04, 0);
  scene.add(doorL, doorR, arch, threshold);
  const doorWash = new Mesh(keep(new PlaneGeometry(2.5, 4)), keep(new MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.06, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })));
  doorWash.rotation.y = Math.PI / 2;
  doorWash.position.set(R + 0.02, 2, 0);
  scene.add(doorWash);

  // ---- the floor: stone, the glass ring over the vault, the vault's drawers --------------------------------------
  const ringFloor = (r0: number, r1: number, m: MeshStandardMaterial, y: number) => {
    const f = new Mesh(keep(new RingGeometry(r0, r1, 96)), m);
    f.rotation.x = -Math.PI / 2;
    f.position.y = y;
    scene.add(f);
    return f;
  };
  ringFloor(7.4, R, stone, 0.01);
  const inner = new Mesh(keep(new CircleGeometry(5.9, 96)), stone);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.01;
  scene.add(inner);
  const glassFloor = new Mesh(keep(new RingGeometry(5.9, 7.4, 96)), keep(new MeshStandardMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.12, metalness: 0.3, roughness: 0.08, depthWrite: false })));
  glassFloor.rotation.x = -Math.PI / 2;
  glassFloor.position.y = 0.03;
  glassFloor.renderOrder = 4;
  scene.add(glassFloor);
  {
    // The glass floor's panes, in gold.
    const w: number[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      w.push(Math.cos(a) * 5.9, 0.04, Math.sin(a) * 5.9, Math.cos(a) * 7.4, 0.04, Math.sin(a) * 7.4);
    }
    for (const r of [5.9, 6.65, 7.4])
      for (let k = 0; k < 96; k++) {
        const a0 = (k / 96) * Math.PI * 2;
        const a1 = ((k + 1) / 96) * Math.PI * 2;
        w.push(Math.cos(a0) * r, 0.04, Math.sin(a0) * r, Math.cos(a1) * r, 0.04, Math.sin(a1) * r);
      }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(w), 3));
    scene.add(new LineSegments(g, keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.45, depthWrite: false }))));
  }
  const trench = new Mesh(keep(new CylinderGeometry(7.4, 7.4, 1.5, 96, 1, true)), keep(new MeshStandardMaterial({ color: 0x0f1118, side: BackSide, metalness: 0.5, roughness: 0.6 })));
  trench.position.y = -0.74;
  const trenchIn = new Mesh(keep(new CylinderGeometry(5.9, 5.9, 1.5, 96, 1, true)), keep(new MeshStandardMaterial({ color: 0x0f1118, metalness: 0.5, roughness: 0.6 })));
  trenchIn.position.y = -0.74;
  scene.add(trench, trenchIn);
  ringFloor(5.9, 7.4, keep(new MeshStandardMaterial({ color: 0x0b0c10, metalness: 0.3, roughness: 0.7 })), -1.48);
  const vaultLight = new PointLight(0xffd28a, 6, 9, 1.8);
  vaultLight.position.set(-VAULT_R, -0.9, 0);
  scene.add(vaultLight);
  const drawerAt: Vector3[] = [];
  const drawerFace: MeshBasicMaterial[] = [];
  for (let i = 0; i < DRAWERS; i++) {
    const a = (i / DRAWERS) * Math.PI * 2 + Math.PI / DRAWERS;
    const d = skin(new Mesh(keep(new BoxGeometry(1.05, 0.55, 0.95)), bronze), goldFaint);
    d.position.set(Math.cos(a) * VAULT_R, -1.12, Math.sin(a) * VAULT_R);
    d.rotation.y = -a;
    scene.add(d);
    const face = keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.3 }));
    const f = new Mesh(keep(new BoxGeometry(0.85, 0.05, 0.05)), face);
    f.position.set(Math.cos(a) * VAULT_R, -0.82, Math.sin(a) * VAULT_R);
    f.rotation.y = -a + Math.PI / 2;
    scene.add(f);
    drawerFace.push(face);
    drawerAt.push(new Vector3(Math.cos(a) * VAULT_R, -0.62, Math.sin(a) * VAULT_R));
  }

  // ---- the carousel and its beds ----------------------------------------------------------------------------------
  const car = new Group();
  // The first bed starts facing the camera, so the room opens on Election night's crop.
  car.rotation.y = Math.PI;
  scene.add(car);
  const disc = skin(new Mesh(keep(new CylinderGeometry(5.3, 5.4, 0.3, 96)), bronze));
  disc.position.y = 0.15;
  car.add(disc);
  const discRim = new Mesh(keep(new TorusGeometry(5.32, 0.035, 4, 160)), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6 })));
  discRim.rotation.x = Math.PI / 2;
  discRim.position.y = 0.31;
  car.add(discRim);
  const column = skin(new Mesh(keep(new CylinderGeometry(0.2, 0.32, 4.9, 16)), brass));
  column.position.y = 2.75;
  car.add(column);
  const planterGeo = keep(new CylinderGeometry(1.25, 1.05, 0.65, 40));
  const clocheGeo = keep(new SphereGeometry(1.22, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2));
  const clocheMat = keep(glassMaterial(0xcfe0ff, 0.42, 0.03));
  const clocheWire = keep(new EdgesGeometry(new SphereGeometry(1.22, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), 1));
  disposables.push(clocheWire);
  const beds: Bed[] = [];
  const fringeR = rng(31);
  for (let i = 0; i < BEDS; i++) {
    const a = (i / BEDS) * Math.PI * 2;
    const g = new Group();
    g.position.set(Math.cos(a) * BED_R, 0.3, -Math.sin(a) * BED_R);
    car.add(g);
    const planter = skin(new Mesh(planterGeo, bronze));
    planter.position.y = 0.33;
    g.add(planter);
    const lip = new Mesh(keep(new TorusGeometry(1.24, 0.045, 6, 64)), brass);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.66;
    g.add(lip);
    const soil = new Mesh(keep(new CircleGeometry(1.18, 32)), soilMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.655;
    g.add(soil);
    // A fringe of moss and low fern round every bed's rim, crop or none.
    const NF = PH ? 22 : 40;
    const fringe = new InstancedMesh(blade, leafMat, NF);
    const M = new Matrix4();
    const Q = new Quaternion();
    const E = new Euler();
    const col = new Color();
    for (let k = 0; k < NF; k++) {
      const b = (k / NF) * Math.PI * 2 + fringeR() * 0.2;
      const rr = 0.95 + fringeR() * 0.2;
      E.set(0.9 + fringeR() * 0.5, -b + Math.PI / 2, 0, "YXZ");
      Q.setFromEuler(E);
      const s = 0.22 + fringeR() * 0.2;
      M.compose(new Vector3(Math.cos(b) * rr, 0.66, Math.sin(b) * rr), Q, new Vector3(s * 1.4, s, s));
      fringe.setMatrixAt(k, M);
      fringe.setColorAt(k, col.setHSL(0.3 + fringeR() * 0.08, 0.45, 0.22 + fringeR() * 0.12));
    }
    g.add(fringe);
    disposables.push(fringe);
    const cloche = new Mesh(clocheGeo, clocheMat);
    cloche.scale.y = 1.3;
    cloche.position.y = 0.66;
    cloche.renderOrder = 7;
    g.add(cloche);
    const cw = new LineSegments(clocheWire, keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22, depthWrite: false })));
    cw.scale.y = 1.3;
    cw.position.y = 0.66;
    g.add(cw);
    // The lamp: an arm from the column, a hood, its bulb, a soft cone of light, and the light itself.
    const arm = new Mesh(keep(new BoxGeometry(BED_R, 0.09, 0.09)), brass);
    arm.position.set(-Math.cos(a) * (BED_R / 2), 4.6, Math.sin(a) * (BED_R / 2));
    arm.rotation.y = a;
    g.add(arm);
    const hood = skin(new Mesh(keep(new ConeGeometry(0.42, 0.38, 18, 1, true)), keep(new MeshStandardMaterial({ color: 0x2a2620, metalness: 0.8, roughness: 0.3, side: DoubleSide }))));
    hood.position.y = 4.38;
    g.add(hood);
    const bulb = keep(new MeshBasicMaterial({ color: LAMP, transparent: true, opacity: 0 }));
    const bm = new Mesh(keep(new CircleGeometry(0.36, 18)), bulb);
    bm.rotation.x = Math.PI / 2;
    bm.position.y = 4.2;
    g.add(bm);
    const shaft = keep(new MeshBasicMaterial({ color: LAMP, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
    const sm = new Mesh(keep(new CylinderGeometry(0.36, 1.2, 3.5, 24, 1, true)), shaft);
    sm.position.y = 2.45;
    g.add(sm);
    const light = new PointLight(LAMP, 0, 6.5, 1.5);
    light.position.y = 3.3;
    g.add(light);
    // Following: a gold stake with its flag, and a gold ring round the planter's foot.
    const stake = new Group();
    const sp = new Mesh(keep(new CylinderGeometry(0.03, 0.03, 1.5, 6)), brass);
    sp.position.y = 0.75;
    const flag = new Mesh(keep(new BoxGeometry(0.46, 0.28, 0.03)), keep(new MeshBasicMaterial({ color: STAKE })));
    flag.position.set(0.24, 1.36, 0);
    stake.add(sp, flag);
    stake.position.set(0.85, 0.66, 0.55);
    stake.visible = false;
    g.add(stake);
    const ring = keep(new MeshBasicMaterial({ color: STAKE, transparent: true, opacity: 0 }));
    const rm = new Mesh(keep(new TorusGeometry(1.4, 0.035, 4, 64)), ring);
    rm.rotation.x = Math.PI / 2;
    rm.position.y = 0.04;
    g.add(rm);
    beds.push({ g, planter, bulb, shaft, light, stake, ring, on: 0 });
  }

  // ---- foliage: planters inside, ferns and grass and trees outside -------------------------------------------------
  {
    const r = rng(77);
    const M = new Matrix4();
    const Q = new Quaternion();
    const E = new Euler();
    const col = new Color();
    const S = new Vector3();
    const P = new Vector3();
    const leaves: { p: Vector3; yaw: number; tilt: number; s: number; w: number; h: number; l: number }[] = [];
    const fern = (x: number, z: number, size: number, n: number, y = 0) => {
      for (let k = 0; k < n; k++) leaves.push({ p: new Vector3(x, y, z), yaw: (k / n) * Math.PI * 2 + r() * 0.4, tilt: 0.45 + r() * 0.65, s: size * (0.7 + r() * 0.5), w: 1.5, h: 0.3 + r() * 0.07, l: 0.18 + r() * 0.14 });
    };
    const grass = (x: number, z: number, n: number, size = 0.5) => {
      for (let k = 0; k < n; k++) leaves.push({ p: new Vector3(x + (r() - 0.5) * 0.6, 0, z + (r() - 0.5) * 0.6), yaw: r() * Math.PI * 2, tilt: 0.1 + r() * 0.35, s: size * (0.6 + r() * 0.7), w: 0.45, h: 0.24 + r() * 0.1, l: 0.16 + r() * 0.16 });
    };
    // Inside: a ring of potted ferns round the wall, clear of the door.
    const pots: Vector3[] = [];
    const NPOT = PH ? 10 : 16;
    for (let k = 0; k < NPOT; k++) {
      const a = (k / NPOT) * Math.PI * 2 + Math.PI / NPOT;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.4) continue;
      const p = new Vector3(Math.cos(a) * 8.25, 0, Math.sin(a) * 8.25);
      pots.push(p);
      fern(p.x, p.z, 0.9 + r() * 0.5, PH ? 7 : 11, 0.5);
    }
    const potGeo = keep(new CylinderGeometry(0.42, 0.32, 0.5, 18));
    for (const p of pots) {
      const m = skin(new Mesh(potGeo, bronze), goldFaint);
      m.position.set(p.x, 0.25, p.z);
      scene.add(m);
    }
    // Outside: ferns and grass along the foot of the wall and both sides of the path, then out into the dusk.
    const NOUT = PH ? 40 : 90;
    for (let k = 0; k < NOUT; k++) {
      const a = r() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.22) continue;
      const rr = R + 0.5 + r() * 2.2;
      if (r() < 0.35) fern(Math.cos(a) * rr, Math.sin(a) * rr, 0.8 + r() * 0.7, 7);
      else grass(Math.cos(a) * rr, Math.sin(a) * rr, 6, 0.6);
    }
    for (let x = 10.2; x < 15; x += PH ? 1.1 : 0.7)
      for (const side of [-1, 1]) {
        if (r() < 0.5) fern(x + r() * 0.3, side * (1.25 + r() * 0.5), 0.6 + r() * 0.4, 6);
        else grass(x, side * (1.3 + r() * 0.4), 5, 0.5);
      }
    const NFAR = PH ? 70 : 170;
    for (let k = 0; k < NFAR; k++) {
      const a = r() * Math.PI * 2;
      const rr = 12 + Math.pow(r(), 0.7) * 30;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (Math.hypot(x - PLOT.x, z - PLOT.z) < 3) continue;
      if (r() < 0.25) fern(x, z, 0.9 + r() * 0.9, 7);
      else grass(x, z, 5, 0.7);
    }
    const n = leaves.length;
    const foliage = new InstancedMesh(blade, leafMat, n);
    leaves.forEach((l, i) => {
      E.set(l.tilt, l.yaw, 0, "YXZ");
      Q.setFromEuler(E);
      S.set(l.s * l.w * 0.6, l.s, l.s);
      P.copy(l.p);
      M.compose(P, Q, S);
      foliage.setMatrixAt(i, M);
      foliage.setColorAt(i, col.setHSL(l.h, 0.42, l.l));
    });
    scene.add(foliage);
    disposables.push(foliage);
    // Trees: solid crowns with the gold wire skin, standing out in the dusk.
    const trunkGeo = keep(new CylinderGeometry(0.1, 0.2, 2.4, 7));
    const crownGeo = keep(new IcosahedronGeometry(1.15, 1));
    const coneGeo = keep(new ConeGeometry(0.95, 3.6, 8));
    const crownEdges = keep(new EdgesGeometry(crownGeo, 20));
    const coneEdges = keep(new EdgesGeometry(coneGeo, 20));
    const bark = keep(new MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }));
    const crownMat = keep(new MeshStandardMaterial({ color: 0x1d3a30, roughness: 0.75, flatShading: true, emissive: 0x06110c }));
    const crownWire = keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.2, depthWrite: false }));
    const NT = PH ? 9 : 18;
    for (let k = 0; k < NT; k++) {
      const a = (k / NT) * Math.PI * 2 + r() * 0.3;
      const off = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (off < 0.3) continue;
      // Never between the camera's swivel and the dome: on that side they stand well back.
      const rr = off > 1.7 ? 40 + r() * 14 : 14 + r() * 16;
      const t = new Group();
      t.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      const tall = 0.8 + r() * 0.8;
      const trunk = new Mesh(trunkGeo, bark);
      trunk.position.y = 1.2;
      t.add(trunk);
      if (r() < 0.4) {
        const c = new Mesh(coneGeo, crownMat);
        c.position.y = 3.6;
        c.add(new LineSegments(coneEdges, crownWire));
        t.add(c);
      } else
        for (let j = 0; j < 3; j++) {
          const c = new Mesh(crownGeo, crownMat);
          c.position.set((r() - 0.5) * 1.1, 2.7 + j * 0.65, (r() - 0.5) * 1.1);
          c.scale.setScalar(0.75 + r() * 0.5);
          c.add(new LineSegments(crownEdges, crownWire));
          t.add(c);
        }
      t.scale.setScalar(tall);
      scene.add(t);
    }
    // Night flowers in the grass: small soft lights.
    const NFL = PH ? 110 : 280;
    const fp = new Float32Array(NFL * 3);
    const fc = new Float32Array(NFL * 3);
    const flowerCols = [new Color(0xe8c77a), new Color(0x9fd8ff), new Color(0xd7a8ff), new Color(0xbff0c8)];
    for (let k = 0; k < NFL; k++) {
      const a = r() * Math.PI * 2;
      const rr = k < NFL * 0.15 ? 7.6 + r() * 1.2 : R + 0.6 + Math.pow(r(), 1.4) * 22;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.12 && rr > R) continue;
      fp.set([Math.cos(a) * rr, 0.12 + r() * 0.35, Math.sin(a) * rr], k * 3);
      flowerCols[Math.floor(r() * flowerCols.length)]!.toArray(fc, k * 3);
    }
    const fGeo = keep(new BufferGeometry());
    fGeo.setAttribute("position", new BufferAttribute(fp, 3));
    fGeo.setAttribute("tint", new BufferAttribute(fc, 3));
    scene.add(new Points(fGeo, keep(dotMaterial(px, 10, 0.75))));
  }

  // ---- the pop-ups: a crop in a bed, a seed in the vault, or the crop out on its plot -------------------------------
  const crystalGeo = keep(new OctahedronGeometry(1, 0));
  crystalGeo.scale(0.1, 0.5, 0.1);
  crystalGeo.translate(0, 0.4, 0);
  const crystalMat = keep(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92 }));
  crystalMat.onBeforeCompile = (sh) => {
    // The crystals give back their own colour, so a called race reads at night.
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance += vColor.rgb * .55;
      #endif`,
    );
  };
  const makeCrop = (): Crop => {
    const root = new Group();
    const crystals = new InstancedMesh(crystalGeo, crystalMat, MAX_CRYSTALS);
    crystals.count = 0;
    crystals.setColorAt(0, new Color(GOLD_HI));
    const NFR = 14;
    const fronds = new InstancedMesh(blade, leafMat, NFR);
    const M = new Matrix4();
    const Q = new Quaternion();
    const E = new Euler();
    const col = new Color();
    const r = rng(5);
    for (let k = 0; k < NFR; k++) {
      E.set(0.35 + r() * 0.6, (k / NFR) * Math.PI * 2, 0, "YXZ");
      Q.setFromEuler(E);
      const s = 0.55 + r() * 0.45;
      M.compose(new Vector3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3), Q, new Vector3(s * 0.9, s, s));
      fronds.setMatrixAt(k, M);
      fronds.setColorAt(k, col.setHSL(0.27 + r() * 0.1, 0.5, 0.26 + r() * 0.12));
    }
    root.add(crystals, fronds);
    disposables.push(crystals, fronds);
    return { root, crystals, fronds, sig: "" };
  };
  /** One crystal per part (capped, shared out by share), in a spiral from the middle: tallest in the middle. */
  const growCrop = (c: Crop, p: GlassPopup) => {
    const parts = p.growth?.parts ?? [];
    const sig = JSON.stringify([parts, Math.round((p.growth?.share ?? 0) * 100)]);
    if (sig === c.sig) return;
    c.sig = sig;
    const total = parts.reduce((n, x) => n + x.n, 0);
    const cols: Color[] = [];
    if (!total) for (let k = 0; k < 5; k++) cols.push(new Color(GOLD_HI));
    else {
      const room = Math.min(MAX_CRYSTALS, total);
      for (const x of parts) {
        const m = Math.max(1, Math.round((x.n / total) * room));
        for (let k = 0; k < m && cols.length < MAX_CRYSTALS; k++) cols.push(new Color(x.colour));
      }
    }
    // Mix the parties through the bed rather than in wedges.
    const r = rng(cols.length * 31 + 7);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [cols[i], cols[j]] = [cols[j]!, cols[i]!];
    }
    const M = new Matrix4();
    const Q = new Quaternion();
    const E = new Euler();
    const share = p.growth?.share ?? 0;
    cols.forEach((col, i) => {
      const a = i * 2.39996;
      const rr = 0.12 + Math.sqrt((i + 0.5) / Math.max(cols.length, 8)) * 0.85;
      const tall = (0.55 + (1 - rr) * 0.9 + r() * 0.35) * (total ? 0.75 + share * 0.6 : 0.5);
      E.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5);
      Q.setFromEuler(E);
      M.compose(new Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), Q, new Vector3(1 + r() * 0.5, tall, 1 + r() * 0.5));
      c.crystals.setMatrixAt(i, M);
      c.crystals.setColorAt(i, col);
    });
    c.crystals.count = cols.length;
    c.crystals.instanceMatrix.needsUpdate = true;
    if (c.crystals.instanceColor) c.crystals.instanceColor.needsUpdate = true;
  };
  const seedGeo = keep(new SphereGeometry(0.22, 16, 12));
  const rigs = new Map<string, PopRig>();
  const rigOf = (p: GlassPopup, i: number): PopRig => {
    const crop = makeCrop();
    const seed = new Mesh(seedGeo, keep(new MeshStandardMaterial({ color: 0x2a1e08, emissive: GOLD_HI, emissiveIntensity: 1.3, metalness: 0.4, roughness: 0.3 })));
    seed.scale.set(1, 1.35, 1);
    scene.add(seed);
    const seedGlow = glow(GOLD_HI, 1.1, 0.6);
    scene.add(seedGlow);
    return { p, bed: i % BEDS, drawer: (3 + i * 5) % DRAWERS, crop, seed, seedGlow, from: null, k: 1, dur: 1, grow: 0, seedAt: new Vector3(), seedOn: false };
  };
  /** Sets a crop where its pop-up is now: in its bed, or on the plot (a seed's crop waits in its bed, grown down). */
  const place = (rig: PopRig) => {
    const atPlot = rig.p.state === "plot";
    const where = atPlot ? plotGroup : beds[rig.bed]!.g;
    if (rig.crop.root.parent !== where) where.add(rig.crop.root);
    rig.crop.root.position.set(0, atPlot ? 0 : 0.66, 0);
    rig.crop.root.rotation.set(0, 0, 0);
  };
  const apply = (first: boolean) => {
    const seen = new Set<string>();
    view.popups.forEach((p, i) => {
      seen.add(p.id);
      let rig = rigs.get(p.id);
      const fresh = !rig;
      if (!rig) {
        rig = rigOf(p, i);
        rigs.set(p.id, rig);
      }
      const was = rig.p.state;
      rig.p = p;
      if (!first && !fresh && was !== p.state && !reduce) {
        rig.from = was;
        rig.k = 0;
        rig.dur = p.state === "plot" ? 5.2 : 3.6;
        if (p.state === "plot" && was === "bed") {
          // The crop leaves the carousel: carried in the world from here.
          scene.attach(rig.crop.root);
        }
      } else {
        rig.from = null;
        rig.k = 1;
      }
      growCrop(rig.crop, p);
      if (!(rig.from === "bed" && p.state === "plot")) place(rig);
      rig.grow = rig.from ? rig.grow : p.state === "vault" ? 0 : 1;
    });
    for (const [id, rig] of rigs)
      if (!seen.has(id)) {
        rig.crop.root.removeFromParent();
        rig.seed.removeFromParent();
        rig.seedGlow.removeFromParent();
        rigs.delete(id);
      }
  };
  apply(true);

  // ---- nanites: gold sigils in the air, motes off each growing bed, a seed's trail ----------------------------------
  const NA = PH ? 90 : 260;
  const NB = PH ? 70 : 180;
  const NN = NA + NB;
  const np = new Float32Array(NN * 3);
  const nc = new Float32Array(NN * 3);
  const na = new Float32Array(NN);
  const ng = new Float32Array(NN);
  const ns = new Float32Array(NN);
  const gold = new Color(GOLD_HI);
  const air = Array.from({ length: NA }, () => ({ r: 1 + Math.random() * 7.5, a: Math.random() * 6.28, y: 0.8 + Math.random() * 6.5, w: (0.02 + Math.random() * 0.05) * (Math.random() < 0.5 ? -1 : 1), up: 0.04 + Math.random() * 0.1, ph: Math.random() * 6.28 }));
  const motes = Array.from({ length: NB }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  for (let i = 0; i < NN; i++) {
    ng[i] = Math.floor(Math.random() * NG);
    ns[i] = i < NA ? 0.55 + Math.random() * 0.5 : 0.45 + Math.random() * 0.35;
    gold.toArray(nc, i * 3);
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("tint", new BufferAttribute(nc, 3));
  nGeo.setAttribute("alpha", new BufferAttribute(na, 1));
  nGeo.setAttribute("glyph", new BufferAttribute(ng, 1));
  nGeo.setAttribute("sz", new BufferAttribute(ns, 1));
  const nanites = new Points(nGeo, keep(glyphMaterial(atlas, px)));
  nanites.frustumCulled = false;
  nanites.renderOrder = 8;
  scene.add(nanites);
  // Fireflies out in the garden.
  const NFF = PH ? 30 : 70;
  const ffp = new Float32Array(NFF * 3);
  const ffc = new Float32Array(NFF * 3);
  const ffa = new Float32Array(NFF);
  const ff = Array.from({ length: NFF }, () => ({ a: Math.random() * 6.28, r: R + 1 + Math.random() * 16, y: 0.4 + Math.random() * 2.2, s: 0.05 + Math.random() * 0.1, ph: Math.random() * 6.28 }));
  for (let k = 0; k < NFF; k++) new Color(Math.random() < 0.5 ? 0xd8f0a0 : 0xe8c77a).toArray(ffc, k * 3);
  const ffGeo = keep(new BufferGeometry());
  ffGeo.setAttribute("position", new BufferAttribute(ffp, 3));
  ffGeo.setAttribute("tint", new BufferAttribute(ffc, 3));
  ffGeo.setAttribute("alpha", new BufferAttribute(ffa, 1));
  const fireflies = new Points(ffGeo, keep(dotMaterial(px, 9, 1, true)));
  fireflies.frustumCulled = false;
  scene.add(fireflies);
  const spawn = (x: number, y: number, z: number, vy: number, col: Color, life: number) => {
    const i = motes.findIndex((m) => m.life <= 0);
    if (i < 0) return;
    const m = motes[i]!;
    m.life = m.max = life;
    m.x = x;
    m.y = y;
    m.z = z;
    m.vx = (Math.random() - 0.5) * 0.15;
    m.vy = vy;
    m.vz = (Math.random() - 0.5) * 0.15;
    col.toArray(nc, (NA + i) * 3);
  };

  // ---- the edges come undone into gold wire and code (the Senate's language) --------------------------------------
  let stepUndone: ((t: number, r: WebGLRenderer) => void) | null = null;
  {
    const wire: number[] = [];
    const VERT = PH ? 28 : 48;
    const RING = PH ? 64 : 112;
    for (let k = 0; k < VERT; k++) {
      const a = (k / VERT) * Math.PI * 2;
      for (let j = 0; j < 8; j++) {
        const p0 = domeAt(a, (j / 8) * (Math.PI / 2), R * 0.985);
        const p1 = domeAt(a, ((j + 1) / 8) * (Math.PI / 2), R * 0.985);
        wire.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }
    }
    const ring = (r: number, y: number) => {
      for (let k = 0; k < RING; k++) {
        const a0 = (k / RING) * Math.PI * 2;
        const a1 = ((k + 1) / RING) * Math.PI * 2;
        wire.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
      }
    };
    for (let j = 1; j < 7; j++) {
      const th = (j / 7) * (Math.PI / 2);
      ring(Math.cos(th) * R * 0.985, WALL_H + Math.sin(th) * R * DH * 0.985);
    }
    for (let r = R + 1.5; r < 34; r += 2.2) ring(r, 0.03);
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      wire.push(Math.cos(a) * (R + 0.6), 0.03, Math.sin(a) * (R + 0.6), Math.cos(a) * 34, 0.03, Math.sin(a) * 34);
    }
    const ND = PH ? 380 : 1100;
    const dust = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) {
      const a = Math.random() * Math.PI * 2;
      if (Math.random() < 0.55) {
        const p = domeAt(a, Math.random() * (Math.PI / 2 - 0.1), R * 0.99);
        dust.set([p.x, p.y, p.z], i * 3);
      } else {
        const rr = R + 1 + Math.random() * 22;
        dust.set([Math.cos(a) * rr, 0.06, Math.sin(a) * rr], i * 3);
      }
    }
    const undone = comeUndone({
      wire,
      dust,
      atlas,
      px,
      peel: PH ? 120 : 380,
      keep,
      drift: (x, y, z) => {
        const r = Math.hypot(x, z) || 1;
        // Off the dome, inward and up a little; off the ground, up.
        if (y < 0.1) return [(Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3];
        return [(-x / r) * (0.4 + Math.random() * 0.7), 0.2 + Math.random() * 0.5, (-z / r) * (0.4 + Math.random() * 0.7)];
      },
    });
    undone.addTo(scene);
    stepUndone = undone.step;
  }

  // ---- sizing, the camera, the pointer, the keys -------------------------------------------------------------------
  const phone = () => host.clientWidth < PHONE_W;
  const size = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < PHONE_W ? 50 : 42;
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
  const look = new Vector3(1.2, 1.4, 0);
  // WASD swivels the view round the carousel (Nikita, 2026-11-06): not free roam. A/D (and the arrows) orbit left and
  // right within a set arc, W/S dolly in and out within tight bounds, both resisted past the soft edge and eased back
  // inside it when the keys let go; Escape snaps home to the composed view. Ignored while typing, and Space is left
  // alone for hold-to-talk (the shared helper's rules). Dragging swivels the same arc.
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: look.x, cz: look.z, r: 1 }),
    origin: () => [look.x, look.z],
    forward: () => [look.x - cam.position.x, look.z - cam.position.z],
    orbit: {
      turn: (r) => (yawTo = swing(yawTo, r, ARC)),
      zoom: (a) => (zoomTo = 1 + swing(zoomTo - 1, -a * 0.3, ZOOM_ARC)),
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  const ray = new Raycaster();
  const ptr = new Vector2();
  let downAt: { x: number; y: number } | null = null;
  let lastX = 0;
  const pickAt = (cx: number, cy: number): string | null => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, cam);
    const list: [Object3D, string][] = [];
    for (const [id, rig] of rigs) {
      if (rig.p.state === "bed") list.push([beds[rig.bed]!.planter, id]);
      if (rig.p.state === "vault") list.push([rig.seed, id]);
      if (rig.p.state === "plot") list.push([plot, id]);
    }
    const hit = ray.intersectObjects(
      list.map(([m]) => m),
      false,
    )[0];
    return hit ? (list.find(([m]) => m === hit.object)?.[1] ?? null) : null;
  };
  const onMove = (e: PointerEvent) => {
    if (downAt) {
      const d = -(e.clientX - lastX) * 0.006;
      yawTo = swing(yawTo, d, ARC);
      lastX = e.clientX;
    }
    if (e.pointerType === "mouse" && !downAt) canvas.style.cursor = pickAt(e.clientX, e.clientY) ? "pointer" : "grab";
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
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  // ---- anchors for the tags ----------------------------------------------------------------------------------------
  const placed = new Map<string, string>();
  const tmp = new Vector3();
  const vaultAnchor = new Vector3();
  const report = (id: string, p: Vector3) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    tmp.copy(p).project(cam);
    const x = ((tmp.x + 1) / 2) * w;
    const y = ((1 - tmp.y) / 2) * h;
    const on = tmp.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
    const key = `${Math.round(x)}|${Math.round(y)}|${on}`;
    if (placed.get(id) === key) return;
    placed.set(id, key);
    opts.onPlace(id, x, y, on);
  };

  // ---- the state each frame ---------------------------------------------------------------------------------------
  const bedTop = (i: number, out: Vector3) => beds[i]!.g.localToWorld(out.set(0, 1.25, 0));
  const tA = new Vector3();
  const tB = new Vector3();
  const goldC = new Color(GOLD_HI);
  const lampC = new Color(LAMP);
  const stakeC = new Color(STAKE);
  const tc = new Color();
  const doorCurve = (from: Vector3) => new CatmullRomCurve3([from.clone(), from.clone().add(new Vector3(0, 1.6, 0)), new Vector3(6, 2, 0), new Vector3(R + 0.4, 1.7, 0), new Vector3(14, 1.4, 0), PLOT.clone().setY(0.26)]);
  const curves = new Map<string, CatmullRomCurve3>();
  const stepPop = (rig: PopRig, dt: number, T: number) => {
    const p = rig.p;
    if (rig.from) rig.k = Math.min(1, rig.k + dt / rig.dur);
    const k = rig.k;
    const moving = !!rig.from && k < 1;
    const drawer = drawerAt[rig.drawer]!;
    rig.seedOn = false;
    if (p.state === "bed") {
      if (moving && rig.from === "vault") {
        // Re-spun: the seed rises from its drawer into its bed, then the crop grows back.
        bedTop(rig.bed, tB);
        if (k < 0.6) {
          const u = ease(k / 0.6);
          rig.seedAt.copy(drawer).lerp(tB, u);
          rig.seedAt.y = drawer.y + (tB.y - drawer.y) * u + Math.sin(u * Math.PI) * 2.2;
          rig.seedOn = true;
        }
        rig.grow = ease(clamp((k - 0.6) / 0.4));
      } else rig.grow = damp(rig.grow, 1, 3, dt);
    } else if (p.state === "vault") {
      if (moving && rig.from === "bed") {
        // Shelved: the crop pulls back to a seed, which sinks through the glass into its drawer.
        rig.grow = 1 - ease(clamp(k / 0.3));
        bedTop(rig.bed, tA);
        if (k > 0.2) {
          const u = ease(clamp((k - 0.35) / 0.65));
          rig.seedAt.copy(tA).lerp(drawer, u);
          rig.seedAt.y = tA.y + (drawer.y - tA.y) * u + Math.sin(u * Math.PI) * 2.2;
          rig.seedOn = true;
        }
      } else {
        rig.grow = 0;
        rig.seedAt.copy(drawer);
        rig.seedAt.y += reduce ? 0 : Math.sin(T * 1.3 + rig.drawer) * 0.04;
        rig.seedOn = true;
      }
    } else {
      // Graduated: carried out through the door to its own plot.
      rig.grow = 1;
      if (moving && rig.from === "bed") {
        let c = curves.get(p.id);
        if (!c) {
          c = doorCurve(rig.crop.root.position.clone());
          curves.set(p.id, c);
        }
        rig.crop.root.position.copy(c.getPoint(ease(clamp(k / 0.85))));
        doorWash.material.opacity = 0.06 + 0.3 * Math.sin(Math.PI * clamp((k - 0.2) / 0.5));
      }
    }
    if (rig.from && k >= 1) {
      rig.from = null;
      curves.delete(p.id);
      doorWash.material.opacity = 0.06;
      place(rig);
    }
    const s = Math.max(0.001, rig.grow) * (p.state === "plot" && !moving ? 1.35 : 1);
    rig.crop.root.scale.setScalar(s);
    rig.crop.root.visible = rig.grow > 0.01;
    rig.seed.visible = rig.seedOn;
    rig.seedGlow.visible = rig.seedOn;
    rig.seed.position.copy(rig.seedAt);
    rig.seedGlow.position.copy(rig.seedAt);
    rig.seed.rotation.y += dt;
    if (rig.seedOn && moving && !reduce && Math.random() < 0.6) spawn(rig.seedAt.x, rig.seedAt.y, rig.seedAt.z, 0.1, goldC, 0.9);
    drawerFace[rig.drawer]!.opacity = p.state === "vault" ? 0.65 + (reduce ? 0 : 0.25 * Math.sin(T * 2 + rig.drawer)) : 0.3;
  };

  const occupant = (i: number): PopRig | null => {
    for (const rig of rigs.values()) if (rig.bed === i && (rig.p.state === "bed" || (rig.from === "bed" && rig.k < 1))) return rig;
    return null;
  };
  const draw = (dt: number) => {
    T += dt * (reduce ? 0.12 : 1);
    skyMat.uniforms.t!.value = T;
    stepUndone?.(reduce ? 0 : T, renderer);
    car.rotation.y += dt * (reduce ? 0.004 : 0.045);
    for (const rig of rigs.values()) stepPop(rig, dt, T);
    // The beds: a lamp over each one with a crop in it (gold when it is staked), dark over a free one.
    beds.forEach((b, i) => {
      const o = occupant(i);
      const staked = !!o && o.p.staked && o.p.state === "bed";
      const want = o ? (o.p.ended ? 0.35 : 1) * Math.max(0.15, o.grow) : 0.06;
      b.on = damp(b.on, want, 3, dt);
      const c = staked ? stakeC : lampC;
      b.light.color.copy(c);
      b.light.intensity = b.on * 9;
      b.bulb.color.copy(c);
      b.bulb.opacity = 0.15 + b.on * 0.85;
      b.shaft.color.copy(c);
      b.shaft.opacity = b.on * 0.06;
      b.stake.visible = staked && o!.grow > 0.9;
      b.ring.opacity = damp(b.ring.opacity, staked ? 0.85 : 0, 4, dt);
      if (o && o.p.state === "bed" && !o.p.ended && o.grow > 0.5 && !reduce) {
        bedTop(i, tA);
        if (Math.random() < dt * 6) {
          const parts = o.p.growth?.parts ?? [];
          const pick = parts.length ? parts[Math.floor(Math.random() * parts.length)]!.colour : GOLD_HI;
          spawn(tA.x + (Math.random() - 0.5) * 1.6, tA.y - 0.4, tA.z + (Math.random() - 0.5) * 1.6, 0.35 + Math.random() * 0.3, tc.set(pick), 2.4);
        }
        if (Math.random() < dt * 2.5) spawn(tA.x + (Math.random() - 0.5) * 0.6, tA.y + 2.7, tA.z + (Math.random() - 0.5) * 0.6, -0.45, staked ? stakeC : goldC, 2.2);
      }
    });
    // The air's sigils drift round the dome; the beds' motes rise and fade.
    const calm = reduce ? 0.12 : 1;
    for (let i = 0; i < NA; i++) {
      const a = air[i]!;
      a.a += a.w * dt * calm;
      a.y += a.up * dt * calm;
      if (a.y > 7.2) a.y = 0.8;
      np.set([Math.cos(a.a) * a.r, a.y, Math.sin(a.a) * a.r], i * 3);
      na[i] = 0.32 * Math.min(1, (a.y - 0.8) * 2) * Math.min(1, (7.2 - a.y) * 1.5) * (0.6 + 0.4 * Math.sin(T * 1.3 + a.ph));
      if (Math.random() < dt * 0.15 * calm) ng[i] = Math.floor(Math.random() * NG);
    }
    for (let i = 0; i < NB; i++) {
      const m = motes[i]!;
      const q = NA + i;
      if (m.life <= 0) {
        na[q] = 0;
        continue;
      }
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      np.set([m.x, m.y, m.z], q * 3);
      const f = m.life / m.max;
      na[q] = Math.max(0, Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 6)) * 0.75;
    }
    for (const k of ["position", "tint", "alpha", "glyph"]) nGeo.attributes[k]!.needsUpdate = true;
    for (let i = 0; i < NFF; i++) {
      const f = ff[i]!;
      f.a += f.s * dt * calm * 0.3;
      const y = f.y + Math.sin(T * 0.7 + f.ph) * 0.3;
      ffp.set([Math.cos(f.a) * f.r + Math.sin(T * 0.4 + f.ph) * 0.5, y, Math.sin(f.a) * f.r], i * 3);
      ffa[i] = 0.25 + 0.75 * Math.max(0, Math.sin(T * 1.1 + f.ph * 3));
    }
    ffGeo.attributes.position!.needsUpdate = true;
    ffGeo.attributes.alpha!.needsUpdate = true;
    dispGlow.material.opacity = 0.25 + (reduce ? 0 : 0.1 * Math.sin(T * 1.7));
    // The camera: high, out past the beds' side, looking across the carousel at the door; it sways a little.
    pan.step(dt);
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 4);
    // Past the soft edge, the view eases back inside once nothing holds it there.
    if (!pan.busy && !downAt) {
      if (Math.abs(yawTo) > ARC * SOFT) yawTo = damp(yawTo, Math.sign(yawTo) * ARC * SOFT, 4, dt);
      if (Math.abs(zoomTo - 1) > ZOOM_ARC * SOFT) zoomTo = damp(zoomTo, 1 + Math.sign(zoomTo - 1) * ZOOM_ARC * SOFT, 4, dt);
    }
    yaw += (yawTo - yaw) * ek;
    zoom += (zoomTo - zoom) * ek;
    const ph = phone();
    const th = Math.PI + yaw + (reduce ? 0 : Math.sin(T * 0.05) * 0.22);
    const D = (ph ? (cam.aspect < 0.7 ? 30 : 25) : 23.5) * zoom;
    const camY = (ph ? 11 : 10.5) * (0.6 + 0.4 * zoom);
    cam.position.set(look.x + Math.cos(th) * D, camY, look.z + Math.sin(th) * D);
    cam.lookAt(look.x, ph ? 1.6 : look.y, look.z);
    const w = host.clientWidth;
    const h = host.clientHeight;
    // Dropped under the page's head now the Glasshouse fills the screen (#932).
    const hr = opts.headroom?.() ?? 0;
    if (ph) cam.setViewOffset(w, h, 0, -h * (0.04 + hr * 0.42), w, h);
    else cam.setViewOffset(w, h, 0, -h * (0.03 + hr * 0.3), w, h);
    sky.position.copy(cam.position);
    hills.position.set(cam.position.x, cam.position.y + 9.4, cam.position.z);
    renderer.render(scene, cam);
    // The tags: each pop-up where it is, each free bed, the vault, the plot.
    for (const [id, rig] of rigs) {
      if (rig.seedOn) report(id, tA.copy(rig.seedAt).setY(rig.seedAt.y + 0.5));
      else if (rig.p.state === "plot" && !(rig.from && rig.k < 1)) report(id, tA.copy(PLOT).setY(2.4));
      else if (rig.p.state === "plot") report(id, rig.crop.root.getWorldPosition(tA).setY(tA.y + 2));
      else report(id, bedTop(rig.bed, tA).setY(tA.y + 1.6));
    }
    for (let i = 0; i < BEDS; i++) {
      if (!occupant(i)) report(`free-${i}`, bedTop(i, tA).setY(tA.y + 0.4));
      else if (placed.get(`free-${i}`) !== "off") {
        placed.set(`free-${i}`, "off");
        opts.onPlace(`free-${i}`, 0, 0, false);
      }
    }
    vaultAnchor.set(Math.cos(th) * VAULT_R, 0.1, Math.sin(th) * VAULT_R);
    report("vault", vaultAnchor);
    report("plot", tB.copy(PLOT).setY(0.4));
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
  draw(0.016);
  raf = requestAnimationFrame(frame);

  return {
    set: (next) => {
      view = next;
      apply(false);
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
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** Soft round points with their own tint (and, when `live`, their own alpha): flowers and fireflies. */
function dotMaterial(px: { value: number }, size: number, alpha: number, live = false): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { px, k: { value: alpha } },
    vertexShader: `attribute vec3 tint; ${live ? "attribute float alpha;" : ""} uniform float px; varying vec3 vC; varying float vA;
      void main(){ vC = tint; vA = ${live ? "alpha" : "1."}; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = ${size.toFixed(1)} * px * (6./-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float k; varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-.5); if (d > .5) discard; float a = 1. - d*2.; gl_FragColor = vec4(mix(vC, vec3(1.), .25), a*a*vA*k); }`,
  });
}
