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
  ExtrudeGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Shape,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Bone,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { cachedModel } from "@ceo/desk/modelCache.ts";
import { ARMS, CHILD, NAVY, POSES } from "@ceo/desk/hologram/rig.ts";
import { comeUndone, glyphMaterial, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { goldVault } from "@ceo/engine/sigils/vault.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { edgeFactor, SOFT, wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { modelUrl } from "../../../apps/world/src/modelUrl.ts";
import { recolor } from "../../../apps/world/src/agents/bodies/recolor.ts";
import { foldersOf, type BoardView, type Pile } from "../data/boardroom.ts";

/**
 * The Spire's boardroom in three.js (#825; Nikita, 2026-11-05: "the boardroom, a Spire and boardroom hybrid with the
 * Spire's models in it"). The top floor of a tower at night: polished black stone inlaid with gold, a horseshoe table in
 * black lacquer with a gold rim (the Senate's ring, cut open toward the C.E.O.), high-backed chairs round it, and a
 * curved wall of glass behind with the city's lights far below and the other towers' tops sunk in the haze. Over the
 * middle of the table a gilded model of the Spire turns in a column of light.
 *
 * The Spire's own sit at the table in their real Lattice bodies: Ledger in his suit (the Gepetti's human suit, strings
 * in the cuffs), seated with his forearms on the table over the drafts; Memo, the skull spirit, bobbing over the chair
 * across from him above the overdue pile; and the Executive, the admiral's can in gold, floating at the head of the
 * table on its can-throne with one open hand out to its easel. The table carries the room's real numbers and nothing
 * else: a pile of folders for each state (drafts, open, overdue, paid; one folder per invoice up to a dozen) and the
 * easel's open-invoice count. Counts only, never a client or a sum, the same as the Lattice sees.
 *
 * Partly built: the right of the glass wall, its ceiling beams and the two chairs beside it are still gold wire, with
 * sigil nanites streaming into them. Toward the frame's edges the stone and the glass come undone into gold wire and
 * nanites (undone.ts), the Senate's language, and the gold vault (vault.ts) stands behind the night.
 *
 * WASD swivels the view round the table within a set arc and dollies it a little (the shared helper's orbit mode);
 * dragging swivels it too. Each seat, pile and the easel report where they sit on screen for the page's tags. Loaded
 * lazily (Boardroom.tsx); under reduced motion nothing moves.
 */

export interface BoardOpts {
  phone: boolean;
  reduce: boolean;
  view: BoardView;
  /** How many px the page's panel covers on the right, so the table centres in what's left. */
  inset: () => number;
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
}

export interface Board {
  set: (view: BoardView) => void;
  /** Light one seat or pile (from the page's tags), or none. */
  focus: (id: string | null) => void;
  dispose: () => void;
}

const GOLD = 0xc9a85c;
const GOLD_HI = 0xe8c77a;
const PHONE_W = 760;
/** The Executive's gold (subminds.ts "gilt"). */
const GILT = "#e8b84a";
/** Ledger's suit and tie (cast.ts). */
const LEDGER_SUIT = "#21282e";
const LEDGER_TIE = "#e8b07a";
/** The folders' colours, by pile. */
const PILE_TINT: Record<Pile["id"], number> = { drafts: 0xe9dfc6, open: 0xd9b45e, overdue: 0xc9576a, paid: 0x8fbf8a };

/** Round the table: θ = 0 is its head (far side), + to the right. x = sin θ · r, z = −cos θ · r. */
const at = (th: number, r: number, y = 0) => new Vector3(Math.sin(th) * r, y, -Math.cos(th) * r);
const faceIn = (p: Vector3) => Math.atan2(-p.x, -p.z);

const TABLE = { r0: 2.55, r1: 4.15, half: 2.3, top: 0.81 };
const CHAIR_R = 4.78;
/** The chairs round the table; the head (θ 0) is the Executive's throne. The last two stand only as wire. */
const CHAIRS = [-2.0, -1.5, -1.0, -0.5, 0.5, 1.0, 1.5, 2.0];
const WIRE_CHAIRS = new Set([1.5, 2.0]);
const SEAT: Record<"ledger" | "memo" | "gilt", number> = { ledger: -1.0, memo: 1.0, gilt: 0 };
const PILE_AT: Record<Pile["id"], number> = { drafts: -1.0, paid: -0.5, open: 0.45, overdue: 1.0 };
const EASEL_TH = 0.36;
/** The glass wall: its radius and height, and the stretch still only wire. */
const WALL = { r: 11, h: 9, from: -1.85, to: 1.85, gap0: 0.75, gap1: 1.55 };
/** The swivel: how far either way the view turns (rad), and how far it dollies in or out (share). */
const ARC = 0.5;
const ZOOM_ARC = 0.2;

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function swing(v: number, d: number, lim: number): number {
  const out = d !== 0 && Math.sign(d) === Math.sign(v);
  return Math.max(-lim, Math.min(lim, v + (out ? d * edgeFactor(Math.abs(v) / lim) : d)));
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The Spire's agents' bodies and their clips, as the Lattice wears them (Library.tsx: suit, ghost, skippy). */
const MODELS = {
  suit: "lib/men/Suit.glb",
  humans: "lib/anims/humans.glb",
  ghost: "lib/monsters/Flying/Ghost_Skull.glb",
  flying: "lib/anims/monster-flying.glb",
  can: "lib/custom/Skippy.glb",
} as const;
function loadModel(path: string): Promise<GLTF | null> {
  return cachedModel<GLTF>(path, () => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(modelUrl(path));
  }).catch(() => null);
}

/** A bone's name without the rig's prefix or the dots the loader strips ("UpperLeg.L" arrives as "UpperLegL"). */
const boneKey = (n: string) => n.replace(/^mixamorig:?/, "").replace(/[.:]/g, "");
function bonesOf(root: Object3D): Map<string, Bone> {
  const m = new Map<string, Bone>();
  root.traverse((o) => {
    if ((o as Bone).isBone) m.set(boneKey(o.name), o as Bone);
  });
  return m;
}

/** Turn each bone so its child points along an aim (in the model's own space, facing +z), the way rig.ts poses the can. */
function aimBones(root: Object3D, bones: Map<string, Bone>, aims: [string, string, [number, number, number]][]) {
  const a = new Vector3();
  const b = new Vector3();
  const q = new Quaternion();
  const pq = new Quaternion();
  const wq = new Quaternion();
  for (const [name, child, dir] of aims) {
    const bone = bones.get(name);
    const c = bones.get(child);
    if (!bone || !c || !bone.parent) continue;
    root.updateMatrixWorld(true);
    const from = c.getWorldPosition(a).sub(bone.getWorldPosition(b)).normalize();
    q.setFromUnitVectors(from, new Vector3(...dir).normalize());
    bone.parent.getWorldQuaternion(pq).invert();
    bone.getWorldQuaternion(wq);
    bone.quaternion.copy(pq.multiply(q.multiply(wq)));
  }
  root.updateMatrixWorld(true);
}

/** Scale a model to `height` and say where its lowest point sits (before any pose). */
function fit(model: Object3D, height: number): number {
  const box = new Box3().setFromObject(model, true);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const s = height / h;
  model.scale.multiplyScalar(s);
  return box.min.y * s;
}

const SERIF = `"Bodoni Moda Variable","Bodoni Moda",Didot,Georgia,serif`;
const SANS = `"Jost Variable",Jost,Futura,system-ui,sans-serif`;

/** The easel's board: the open-invoice count, big, and the word under it. */
function drawEasel(g: CanvasRenderingContext2D, w: number, h: number, [big, small]: [string, string]) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#17140f");
  bg.addColorStop(1, "#0b0a08");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(232,199,122,.85)";
  g.lineWidth = 6;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.strokeStyle = "rgba(232,199,122,.3)";
  g.lineWidth = 2;
  g.strokeRect(24, 24, w - 48, h - 48);
  g.textAlign = "center";
  g.fillStyle = "rgba(236,228,210,.7)";
  g.font = `500 26px ${SANS}`;
  g.fillText("THE PIPELINE", w / 2, 74);
  g.fillStyle = "#f3dea3";
  g.font = `500 ${big.length > 3 ? 120 : 170}px ${SERIF}`;
  g.textBaseline = "middle";
  g.fillText(big, w / 2, h / 2 + 18);
  g.textBaseline = "alphabetic";
  g.fillStyle = "rgba(236,228,210,.8)";
  g.font = `italic 400 34px ${SERIF}`;
  g.fillText(small.length > 26 ? `${small.slice(0, 25)}…` : small, w / 2, h - 52);
}

export async function createBoard(host: HTMLElement, canvas: HTMLCanvasElement, opts: BoardOpts): Promise<Board> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  const models = Promise.all([loadModel(MODELS.suit), loadModel(MODELS.humans), loadModel(MODELS.ghost), loadModel(MODELS.flying), loadModel(MODELS.can)]);
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.25 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new Scene();
  scene.background = new Color(0x040406);
  scene.fog = new FogExp2(0x050508, 0.011);
  const cam = new PerspectiveCamera(40, 1, 0.1, 260);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const mesh = <M extends Material>(g: BufferGeometry, m: M) => new Mesh(keep(g), m);
  const px = { value: renderer.getPixelRatio() };
  const atlas = keep(await sigilAtlas());

  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x9aa6cc, 0x0a0806, 0.55));
  const moon = new DirectionalLight(0xaebbe6, 0.55);
  moon.position.set(-6, 12, -14);
  scene.add(moon);
  const front = new DirectionalLight(0xffe2b8, 0.6);
  front.position.set(4, 9, 12);
  scene.add(front);
  const over = new SpotLight(0xffe7c0, 110, 18, 0.62, 0.65, 1.3);
  over.position.set(0, 8.4, -0.4);
  over.target.position.set(0, 0.8, -0.4);
  scene.add(over, over.target);
  for (const th of [SEAT.ledger, SEAT.memo, SEAT.gilt]) {
    const l = new PointLight(0xffd8a0, th === SEAT.ledger ? 16 : 9, 6, 1.6);
    l.position.copy(at(th, 3.6, 2.6));
    scene.add(l);
  }

  // Shared materials.
  const stone = keep(new MeshStandardMaterial({ color: 0x0d0d10, metalness: 0.55, roughness: 0.32 }));
  const lacquer = keep(new MeshStandardMaterial({ color: 0x0b0a0a, metalness: 0.35, roughness: 0.18 }));
  const iron = keep(new MeshStandardMaterial({ color: 0x1d1b19, metalness: 0.8, roughness: 0.4 }));
  const brass = keep(new MeshStandardMaterial({ color: 0xa8843e, metalness: 0.92, roughness: 0.28, emissive: 0x2a1e08 }));
  const leather = keep(new MeshStandardMaterial({ color: 0x1b1512, metalness: 0.1, roughness: 0.62 }));
  const goldLine = keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.4, depthWrite: false }));
  const goldWire = keep(new LineBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }));
  /** A wire skin over a solid: its hard edges in gold. */
  const skin = (m: Mesh, angle = 28) => {
    m.add(new LineSegments(keep(new EdgesGeometry(m.geometry, angle)), goldLine));
    return m;
  };
  /** Only the wire: a piece still being built. */
  const wireOf = (g: BufferGeometry, angle = 20) => new LineSegments(keep(new EdgesGeometry(keep(g), angle)), goldWire);
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
  const glow = (col: number, size: number, op: number) => {
    const s = new Sprite(keep(new SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: AdditiveBlending })));
    s.scale.setScalar(size);
    return s;
  };

  // ---- the floor: black stone inlaid with gold ---------------------------------------------------------------------
  const floorTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#121216";
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#07070a";
    g.lineWidth = 3;
    for (let i = 0; i <= 512; i += 128) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 512);
      g.moveTo(0, i);
      g.lineTo(512, i);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,.03)";
    for (let i = 0; i < 700; i++) g.fillRect(Math.random() * 512, Math.random() * 512, 2, 1);
    const t = keep(new CanvasTexture(c));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(9, 9);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const floor = mesh(new CircleGeometry(WALL.r + 0.4, 128), keep(new MeshStandardMaterial({ map: floorTex, color: 0x8a8790, metalness: 0.55, roughness: 0.3 })));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // A landing in front of the room, so the near floor doesn't end in the camera's view.
  const apron = mesh(new PlaneGeometry(40, 18), stone);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.005, 15);
  scene.add(apron);
  const inlay = (r: number, op: number, w = 0.014) => {
    const m = mesh(new TorusGeometry(r, w, 6, 220), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: op })));
    m.rotation.x = Math.PI / 2;
    m.position.y = 0.01;
    scene.add(m);
  };
  inlay(1.7, 0.55);
  inlay(5.6, 0.4);
  inlay(5.75, 0.22, 0.008);
  inlay(WALL.r - 0.25, 0.3);
  // The inlaid spokes from the well to the wall.
  {
    const pts: number[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push(Math.cos(a) * 5.75, 0.012, Math.sin(a) * 5.75, Math.cos(a) * (WALL.r - 0.25), 0.012, Math.sin(a) * (WALL.r - 0.25));
    }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    scene.add(new LineSegments(g, keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22 }))));
  }

  // ---- the table: the Senate's ring, cut open toward the C.E.O. ---------------------------------------------------
  const arcShape = (r0: number, r1: number, half: number) => {
    const s = new Shape();
    const p0 = Math.PI / 2 - half;
    const p1 = Math.PI / 2 + half;
    s.absarc(0, 0, r1, p0, p1, false);
    s.absarc(0, 0, r0, p1, p0, true);
    s.closePath();
    return s;
  };
  const top = mesh(new ExtrudeGeometry(arcShape(TABLE.r0, TABLE.r1, TABLE.half), { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 72 }), lacquer);
  top.rotation.x = -Math.PI / 2;
  top.position.y = TABLE.top - 0.085;
  scene.add(skin(top, 35));
  const base = mesh(new ExtrudeGeometry(arcShape(TABLE.r0 + 0.45, TABLE.r1 - 0.45, TABLE.half - 0.06), { depth: TABLE.top - 0.09, bevelEnabled: false, curveSegments: 72 }), iron);
  base.rotation.x = -Math.PI / 2;
  scene.add(base);
  // The gold rim along the table's outer and inner edge, lit.
  const rim = (r: number, op: number) => {
    const m = mesh(new TorusGeometry(r, 0.018, 6, 160, TABLE.half * 2), keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: op })));
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - TABLE.half);
    m.position.y = TABLE.top - 0.03;
    scene.add(m);
  };
  rim(TABLE.r1 + 0.02, 0.85);
  rim(TABLE.r0 - 0.02, 0.6);
  // The seat marks inlaid in the top, one per chair, and the head's.
  for (const th of [...CHAIRS, 0]) {
    const m = mesh(new RingGeometry(0.16, 0.18, 32), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.5, side: DoubleSide })));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at(th, TABLE.r1 - 0.35, TABLE.top + 0.002));
    scene.add(m);
  }

  // ---- the chairs ----------------------------------------------------------------------------------------------------
  const chairParts = () => {
    const seat = new BoxGeometry(0.58, 0.09, 0.54);
    seat.translate(0, 0.5, 0);
    const back = new BoxGeometry(0.6, 1.25, 0.08);
    back.translate(0, 1.13, -0.28);
    const stem = new CylinderGeometry(0.05, 0.06, 0.44, 12);
    stem.translate(0, 0.24, 0);
    const foot = new CylinderGeometry(0.3, 0.34, 0.04, 24);
    foot.translate(0, 0.02, 0);
    return [seat, back, stem, foot];
  };
  for (const th of CHAIRS) {
    const p = at(th, CHAIR_R);
    const g = new Group();
    g.position.copy(p);
    g.rotation.y = faceIn(p);
    const parts = chairParts();
    if (WIRE_CHAIRS.has(th)) for (const part of parts) g.add(wireOf(part, 15));
    else
      parts.forEach((part, i) => {
        const m = mesh(part, i === 1 || i === 0 ? leather : i === 2 ? brass : iron);
        g.add(i === 1 ? skin(m) : m);
      });
    scene.add(g);
  }
  // The Executive's can-throne: a floating disc at the head of the table, ringed in gold.
  const throneAt = at(SEAT.gilt, CHAIR_R + 0.15);
  const throne = new Group();
  throne.position.copy(throneAt);
  {
    const disc = mesh(new CylinderGeometry(0.62, 0.48, 0.12, 48), brass);
    disc.position.y = 0.62;
    throne.add(skin(disc));
    const ring = mesh(new TorusGeometry(0.66, 0.012, 6, 96), keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.9 })));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.62;
    throne.add(ring);
    const pool = glow(GOLD_HI, 2.4, 0.35);
    pool.position.y = 0.05;
    throne.add(pool);
  }
  scene.add(throne);

  // ---- the easel: the open-invoice count ------------------------------------------------------------------------------
  const easelCv = document.createElement("canvas");
  easelCv.width = PH ? 256 : 512;
  easelCv.height = PH ? 192 : 384;
  const easelTex = keep(new CanvasTexture(easelCv));
  easelTex.colorSpace = SRGBColorSpace;
  const easelAt = at(EASEL_TH, CHAIR_R + 0.35);
  const easel = new Group();
  easel.position.copy(easelAt);
  easel.rotation.y = faceIn(easelAt) * 0.55;
  {
    for (const [x, z, tilt] of [
      [-0.42, 0.12, 0.1],
      [0.42, 0.12, -0.1],
      [0, -0.35, 0],
    ] as const) {
      const leg = mesh(new CylinderGeometry(0.018, 0.024, 2.3, 8), brass);
      leg.position.set(x * 0.85, 1.12, z);
      leg.rotation.set(z < 0 ? -0.22 : 0.05, 0, tilt);
      easel.add(leg);
    }
    const board = mesh(new PlaneGeometry(1.3, 0.975), keep(new MeshBasicMaterial({ map: easelTex, toneMapped: false })));
    board.position.set(0, 1.62, 0.16);
    board.rotation.x = -0.08;
    easel.add(board);
    const frame = mesh(new BoxGeometry(1.36, 1.03, 0.03), brass);
    frame.position.set(0, 1.62, 0.14);
    frame.rotation.x = -0.08;
    easel.add(frame);
    const ledge = mesh(new BoxGeometry(1.4, 0.04, 0.12), brass);
    ledge.position.set(0, 1.1, 0.2);
    easel.add(ledge);
  }
  scene.add(easel);
  const paintEasel = () => {
    const g = easelCv.getContext("2d")!;
    g.save();
    if (PH) g.scale(0.5, 0.5);
    drawEasel(g, 512, 384, view.easel);
    g.restore();
    easelTex.needsUpdate = true;
  };

  // ---- the piles: one folder per invoice, by state --------------------------------------------------------------------
  const folderGeo = keep(new BoxGeometry(0.36, 0.014, 0.27));
  const piles = (Object.keys(PILE_AT) as Pile["id"][]).map((id) => {
    const p = at(PILE_AT[id], TABLE.r0 + (TABLE.r1 - TABLE.r0) * 0.48, TABLE.top);
    const g = new Group();
    g.position.copy(p);
    g.rotation.y = faceIn(p);
    const mat = keep(new MeshStandardMaterial({ color: PILE_TINT[id], metalness: 0.15, roughness: 0.6, emissive: PILE_TINT[id], emissiveIntensity: 0 }));
    const folders: Mesh[] = [];
    for (let k = 0; k < 12; k++) {
      const f = new Mesh(folderGeo, mat);
      f.position.y = 0.009 + k * 0.017;
      f.rotation.y = (Math.random() - 0.5) * 0.18;
      f.position.x = (Math.random() - 0.5) * 0.03;
      f.visible = false;
      g.add(f);
      folders.push(f);
    }
    // The pile's place on the table: a gold outline, even when it's empty.
    const plate = mesh(new PlaneGeometry(0.44, 0.34), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.12, depthWrite: false })));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.003;
    g.add(plate);
    plate.add(new LineSegments(keep(new EdgesGeometry(plate.geometry)), goldLine));
    scene.add(g);
    return { id, g, mat, folders, n: 0, lit: 0 };
  });
  const paintPiles = () => {
    const by = new Map(view.piles.map((p) => [p.id, p.n]));
    for (const p of piles) {
      p.n = by.get(p.id) ?? 0;
      const show = foldersOf(p.n);
      p.folders.forEach((f, k) => (f.visible = k < show));
    }
  };

  // ---- the gilded Spire, turning over the well -------------------------------------------------------------------------
  const spire = new Group();
  spire.position.set(0, 0.62, -0.2);
  spire.scale.setScalar(0.62);
  {
    const tiers: [number, number, number][] = [
      [0.52, 0.6, 0.24],
      [0.42, 0.5, 0.34],
      [0.32, 0.4, 0.42],
      [0.22, 0.3, 0.5],
    ];
    let y = 0;
    tiers.forEach(([rt, rb, h], i) => {
      const geo = new CylinderGeometry(rt, rb, h, 8);
      const m = i < 2 ? skin(mesh(geo, brass), 20) : wireOf(geo, 10);
      m.position.y = y + h / 2;
      spire.add(m);
      y += h + 0.04;
    });
    const tip = wireOf(new ConeGeometry(0.2, 1.3, 8), 10);
    tip.position.y = y + 0.65;
    spire.add(tip);
  }
  scene.add(spire);
  const well = mesh(new CylinderGeometry(1.0, 1.25, 0.06, 48), iron);
  well.position.set(0, 0.03, -0.2);
  scene.add(skin(well));
  const beamMat = keep(new MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.06, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  const beam = mesh(new CylinderGeometry(0.45, 1.0, 3.2, 40, 1, true), beamMat);
  beam.position.set(0, 1.66, -0.2);
  scene.add(beam);
  const wellGlow = glow(GOLD_HI, 3.2, 0.3);
  wellGlow.position.set(0, 0.12, -0.2);
  scene.add(wellGlow);

  // ---- the glass wall, the ceiling and the night outside -------------------------------------------------------------
  const glass = keep(new MeshStandardMaterial({ color: 0x8ea3bd, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide }));
  const glassBand = (a: number, b: number) => {
    // The cylinder's angle runs the other way round: θc = π − θ.
    const m = mesh(new CylinderGeometry(WALL.r, WALL.r, WALL.h, 48, 1, true, Math.PI - b, b - a), glass);
    m.position.y = WALL.h / 2;
    scene.add(m);
  };
  glassBand(WALL.from, WALL.gap0);
  glassBand(WALL.gap1, WALL.to);
  const mullion = keep(new BoxGeometry(0.12, WALL.h, 0.22));
  const unbuilt: BufferGeometry[] = [];
  for (let th = WALL.from; th <= WALL.to + 1e-6; th += 0.15) {
    const p = at(th, WALL.r);
    const inGap = th > WALL.gap0 - 1e-6 && th < WALL.gap1 + 1e-6;
    if (inGap) {
      const g = new BoxGeometry(0.12, WALL.h, 0.22);
      g.rotateY(faceIn(p));
      g.translate(p.x, WALL.h / 2, p.z);
      unbuilt.push(g);
      continue;
    }
    const m = new Mesh(mullion, iron);
    m.position.set(p.x, WALL.h / 2, p.z);
    m.rotation.y = faceIn(p);
    scene.add(m);
  }
  // The sill and the head of the glass, in brass, except over the stretch still being built.
  const band = (y: number, a: number, b: number) => {
    const m = mesh(new TorusGeometry(WALL.r - 0.05, 0.05, 6, 120, b - a), brass);
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - b);
    m.position.y = y;
    scene.add(m);
  };
  for (const y of [0.06, 3.0, WALL.h - 0.06]) {
    band(y, WALL.from, WALL.gap0);
    band(y, WALL.gap1, WALL.to);
  }
  // The ceiling: a dark coffered ring, its beams running in to a crown of light over the table.
  const ceilY = WALL.h;
  const ceil = mesh(new RingGeometry(3.4, WALL.r + 0.2, 96, 1), keep(new MeshStandardMaterial({ color: 0x0a0a0d, metalness: 0.5, roughness: 0.6, side: DoubleSide })));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ceilY;
  scene.add(ceil);
  const beamGeo = keep(new BoxGeometry(0.18, 0.3, WALL.r - 3.4));
  for (let k = 0; k < 28; k++) {
    const th = (k / 28) * Math.PI * 2 - Math.PI;
    const mid = at(th, (WALL.r + 3.4) / 2, ceilY - 0.15);
    if (th > WALL.gap0 - 0.05 && th < WALL.gap1 + 0.05) {
      const g = new BoxGeometry(0.18, 0.3, WALL.r - 3.4);
      g.rotateY(faceIn(mid));
      g.translate(mid.x, mid.y, mid.z);
      unbuilt.push(g);
      continue;
    }
    const m = new Mesh(beamGeo, iron);
    m.position.copy(mid);
    m.rotation.y = faceIn(mid);
    scene.add(m);
  }
  for (const g of unbuilt) scene.add(wireOf(g, 15));
  // The unbuilt stretch's panes: gold wire only, a frame every few metres up.
  {
    const pts: number[] = [];
    for (let y = 0; y <= WALL.h; y += 1.5)
      for (let th = WALL.gap0; th < WALL.gap1 - 1e-6; th += 0.05) {
        const a = at(th, WALL.r, y);
        const b = at(th + 0.05, WALL.r, y);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    scene.add(new LineSegments(g, goldWire));
  }
  const crown = mesh(new TorusGeometry(2.3, 0.04, 8, 120), keep(new MeshBasicMaterial({ color: 0xffe9c2 })));
  crown.rotation.x = Math.PI / 2;
  crown.position.set(0, 6.6, -0.3);
  scene.add(crown);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const p = new Vector3(Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3 - 0.3);
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array([p.x, 6.6, p.z, p.x * 1.4, ceilY, p.z * 1.4]), 3));
    scene.add(new LineSegments(g, goldLine));
  }

  // The city far below: its lights strewn on the ground a long way down, and the other towers' tops in the haze.
  {
    const N = PH ? 1400 : 3600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new Color();
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 60 + Math.pow(Math.random(), 0.6) * 220;
      // Streets: most lights fall on a loose grid.
      const grid = Math.random() < 0.7;
      let x = Math.cos(a) * r;
      let z = Math.sin(a) * r;
      if (grid) {
        if (Math.random() < 0.5) x = Math.round(x / 14) * 14;
        else z = Math.round(z / 14) * 14;
      }
      pos.set([x, -90 - Math.random() * 4, z], i * 3);
      c.setHSL(0.09 + Math.random() * 0.05, 0.7, 0.45 + Math.random() * 0.3);
      if (Math.random() < 0.12) c.setHSL(0.58, 0.4, 0.7);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("color", new BufferAttribute(col, 3));
    const m = keep(new PointsMaterial({ size: PH ? 1.6 : 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending }));
    m.fog = false;
    scene.add(new Points(g, m));
  }
  const towerTex = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#060608";
    g.fillRect(0, 0, 64, 256);
    for (let y = 4; y < 256; y += 8)
      for (let x = 4; x < 64; x += 8) {
        if (Math.random() < 0.28) {
          g.fillStyle = Math.random() < 0.8 ? "rgba(255,206,140,.85)" : "rgba(170,200,255,.8)";
          g.fillRect(x, y, 4, 4);
        }
      }
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  })();
  {
    const towerMat = keep(new MeshStandardMaterial({ color: 0x0b0b0f, emissiveMap: towerTex, emissive: 0xffffff, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.5 }));
    const n = PH ? 9 : 16;
    for (let i = 0; i < n; i++) {
      // Behind the glass: spread round the back half, well away from the room.
      const th = -1.9 + (i / (n - 1)) * 3.8 + (Math.random() - 0.5) * 0.15;
      const r = 38 + Math.random() * 70;
      const topY = -14 + Math.random() * 20;
      const w = 5 + Math.random() * 7;
      const h = topY + 100;
      const geo = new BoxGeometry(w, h, w);
      const uv = geo.getAttribute("uv") as BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 8), uv.getY(k) * (h / 32));
      const t = mesh(geo, towerMat);
      const p = at(th, r, topY - h / 2);
      t.position.copy(p);
      t.rotation.y = Math.random();
      scene.add(t);
      const beacon = glow(0xff4a3a, 2.2, 0.55);
      beacon.position.set(p.x, topY + 0.6, p.z);
      scene.add(beacon);
    }
  }
  const vault = goldVault({ atlas, px, keep, radius: 200, center: [0, 6, 0], shell: [20, 80], count: PH ? 220 : 700, lines: [56, 22], horizon: 0.52, base: [0.028, 0.024, 0.024] });
  scene.add(vault.group);

  // ---- the edges come undone ---------------------------------------------------------------------------------------
  let stepUndone: ((t: number, r: WebGLRenderer) => void) | null = null;
  {
    const wire: number[] = [];
    for (let x = -14; x <= 14; x += 1.5) wire.push(x, 0.02, -11, x, 0.02, 14);
    for (let z = -11; z <= 14; z += 1.5) wire.push(-14, 0.02, z, 14, 0.02, z);
    for (let th = WALL.from; th <= WALL.to; th += 0.15) {
      const a = at(th, WALL.r - 0.15);
      wire.push(a.x, 0, a.z, a.x, WALL.h, a.z);
    }
    for (let y = 0; y <= WALL.h; y += 1.5)
      for (let th = WALL.from; th < WALL.to; th += 0.075) {
        const a = at(th, WALL.r - 0.15, y);
        const b = at(th + 0.075, WALL.r - 0.15, y);
        wire.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    for (let k = 0; k < 28; k++) {
      const th = (k / 28) * Math.PI * 2;
      const a = at(th, 3.4, ceilY - 0.02);
      const b = at(th, WALL.r, ceilY - 0.02);
      wire.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const ND = PH ? 380 : 1100;
    const dust = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) {
      const u = Math.random();
      if (u < 0.55) dust.set([(Math.random() - 0.5) * 28, 0.05, -11 + Math.random() * 25], i * 3);
      else {
        const p = at(WALL.from + Math.random() * (WALL.to - WALL.from), WALL.r - 0.2, Math.random() * WALL.h);
        dust.set([p.x, p.y, p.z], i * 3);
      }
    }
    const undone = comeUndone({
      wire,
      dust,
      atlas,
      px,
      peel: PH ? 110 : 340,
      keep,
      shape: [0.84, 1.26],
      drift: (x, y, z) => (y < 0.1 ? [(Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3] : [-x * 0.04, 0.2 + Math.random() * 0.5, -z * 0.04]),
    });
    undone.addTo(scene);
    stepUndone = undone.step;
  }

  // ---- the nanites: streaming into what's still being built, and rising off the Spire --------------------------------
  const NG = SIGIL_GLYPHS.length;
  const NS = PH ? 70 : 180;
  const NR = PH ? 24 : 60;
  const NN = NS + NR;
  const np = new Float32Array(NN * 3);
  const nt = new Float32Array(NN * 3);
  const na = new Float32Array(NN);
  const ng = new Float32Array(NN);
  const nz = new Float32Array(NN);
  for (let i = 0; i < NN; i++) {
    ng[i] = Math.floor(Math.random() * NG);
    nz[i] = i < NS ? 0.7 + Math.random() * 0.7 : 0.5 + Math.random() * 0.5;
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("tint", new BufferAttribute(nt, 3));
  nGeo.setAttribute("alpha", new BufferAttribute(na, 1));
  nGeo.setAttribute("glyph", new BufferAttribute(ng, 1));
  nGeo.setAttribute("sz", new BufferAttribute(nz, 1));
  const nanites = new Points(nGeo, keep(glyphMaterial(atlas, px, 22)));
  nanites.frustumCulled = false;
  nanites.renderOrder = 6;
  scene.add(nanites);
  const streams = Array.from({ length: NS }, () => ({ th: WALL.gap0 + Math.random() * (WALL.gap1 - WALL.gap0), y: Math.random() * WALL.h, k: Math.random(), w: 0.1 + Math.random() * 0.2, from: 4 + Math.random() * 4 }));
  const rises = Array.from({ length: NR }, () => ({ a: Math.random() * Math.PI * 2, r: 0.2 + Math.random() * 0.6, k: Math.random(), w: 0.12 + Math.random() * 0.16 }));
  const goldC = new Color(GOLD_HI);
  const hiC = new Color(0xfff0cc);

  // ---- the Spire's own, in their real bodies ------------------------------------------------------------------------------
  type Agent = { id: "ledger" | "memo" | "gilt"; g: Group; head: Vector3; mixer: AnimationMixer | null; tick: (t: number, dt: number) => void; lit: number; mats: MeshStandardMaterial[] };
  const agents: Agent[] = [];
  const [suit, humans, ghost, flying, can] = await models;
  const clip = (g: GLTF | null, name: string): AnimationClip | null => g?.animations.find((a) => a.name === name) ?? null;
  const own = (root: Object3D) => {
    const mats: MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const mine = list.map((x) => {
        const c = keep((x as MeshStandardMaterial).clone());
        mats.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? mine : mine[0]!;
    });
    return mats;
  };

  // Ledger: the suit, seated, forearms on the table over the drafts. The Lattice's Idle runs his breathing; the legs and
  // arms hold the seat, and now and then he bends to the folders to check them twice.
  if (suit) {
    const model = cloneSkinned(suit.scene);
    model.traverse((o) => {
      if (/pistol/i.test(o.name)) o.visible = false;
    });
    const mats = own(model);
    for (const m of mats) {
      if (m.name === "Suit") m.color.set(LEDGER_SUIT);
      if (m.name === "Tie") m.color.set(LEDGER_TIE);
    }
    const low = fit(model, 1.8);
    model.position.y = -low;
    const bones = bonesOf(model);
    const wrap = new Group();
    wrap.add(model);
    wrap.updateMatrixWorld(true);
    const hips = bones.get("Hips") ?? bones.get("Torso");
    const hipY = hips ? hips.getWorldPosition(new Vector3()).y : 0.9;
    const SIT: [string, string, [number, number, number]][] = [
      ["UpperLegL", "LowerLegL", [0.06, -0.12, 1]],
      ["UpperLegR", "LowerLegR", [-0.06, -0.12, 1]],
      ["LowerLegL", "FootL", [0.02, -1, 0.1]],
      ["LowerLegR", "FootR", [-0.02, -1, 0.1]],
      ["UpperArmL", "LowerArmL", [0.22, -0.72, 0.62]],
      ["UpperArmR", "LowerArmR", [-0.22, -0.72, 0.62]],
      ["LowerArmL", "WristL", [-0.32, -0.06, 1]],
      ["LowerArmR", "WristR", [0.32, -0.06, 1]],
    ];
    aimBones(wrap, bones, SIT);
    const held = SIT.map(([n]) => [bones.get(n), bones.get(n)?.quaternion.clone()] as const).filter((x): x is readonly [Bone, Quaternion] => !!x[0] && !!x[1]);
    const head = bones.get("Head");
    const neck = bones.get("Neck");
    const mixer = new AnimationMixer(model);
    const idle = clip(humans, "Idle");
    const playing = !!idle && !reduce;
    if (playing) mixer.clipAction(idle).play();
    const nodder = neck ?? head;
    const rest = nodder?.quaternion.clone() ?? null;
    const p = at(SEAT.ledger, CHAIR_R + 0.04);
    const g = new Group();
    g.position.set(p.x, 0.58 - hipY, p.z);
    g.rotation.y = faceIn(p);
    g.add(wrap);
    scene.add(g);
    const nod = new Quaternion();
    const ax = new Vector3(1, 0, 0);
    agents.push({
      id: "ledger",
      g,
      head: new Vector3(p.x, 2.0, p.z),
      mixer,
      mats,
      lit: 0,
      tick: (t) => {
        for (const [b, q] of held) b.quaternion.copy(q);
        // Checking twice: two short looks down at the drafts every few seconds.
        const c = (t % 7) / 7;
        const look = c < 0.18 ? Math.sin((c / 0.18) * Math.PI * 2) ** 2 : 0;
        if (!nodder) return;
        // The clip sets the neck each frame; without it (reduced motion) it starts from its rest every time.
        if (!playing && rest) nodder.quaternion.copy(rest);
        nodder.quaternion.multiply(nod.setFromAxisAngle(ax, 0.1 + look * 0.3));
      },
    });
  }

  // Memo: the skull spirit bobbing over the chair across the table, above the overdue pile.
  if (ghost) {
    const model = cloneSkinned(ghost.scene);
    const mats = own(model);
    const low = fit(model, 1.05);
    model.position.y = -low;
    const mixer = new AnimationMixer(model);
    const fly = clip(flying, "Flying_Idle");
    if (fly && !reduce) mixer.clipAction(fly).play();
    const p = at(SEAT.memo, CHAIR_R - 0.05);
    const g = new Group();
    g.position.set(p.x, 0.75, p.z);
    g.rotation.y = faceIn(p);
    g.add(model);
    scene.add(g);
    const shine = glow(0x8fd3ff, 1.4, 0.18);
    shine.position.set(p.x, 0.62, p.z);
    scene.add(shine);
    agents.push({
      id: "memo",
      g,
      head: new Vector3(p.x, 2.05, p.z),
      mixer,
      mats,
      lit: 0,
      tick: (t) => {
        g.position.y = 0.75 + Math.sin(t * 1.3) * 0.08;
        g.rotation.y = faceIn(p) + Math.sin(t * 0.4) * 0.25;
      },
    });
  }

  // The Executive: the admiral's can in gold, floating at the head of the table, one open hand out to the easel.
  if (can) {
    const model = cloneSkinned(can.scene);
    const mats = own(model);
    for (const m of mats) {
      if (m.map) m.map = recolor(`spire-${GILT}`, m.map, [{ band: NAVY, color: GILT }]);
      m.emissive = new Color(GILT);
      m.emissiveIntensity = 0.04;
    }
    const low = fit(model, 1.4);
    model.position.y = -low;
    const bones = bonesOf(model);
    const wrap = new Group();
    wrap.add(model);
    const aims = POSES.present;
    aimBones(
      wrap,
      bones,
      ARMS.map((n) => [n, CHILD[n], aims[n] ?? [0, -1, 0]] as [string, string, [number, number, number]]),
    );
    const g = new Group();
    g.position.set(throneAt.x, 0.78, throneAt.z);
    g.rotation.y = faceIn(throneAt);
    g.add(wrap);
    scene.add(g);
    agents.push({
      id: "gilt",
      g,
      head: new Vector3(throneAt.x, 2.4, throneAt.z),
      mixer: null,
      mats,
      lit: 0,
      tick: (t) => {
        g.position.y = 0.78 + Math.sin(t * 1.1) * 0.05;
        // Working the room: a slow turn from the table to the easel and back.
        g.rotation.y = faceIn(throneAt) + Math.sin(t * 0.35) * 0.32 + 0.12;
      },
    });
  }

  // ---- what the table shows ------------------------------------------------------------------------------------------
  const apply = () => {
    paintEasel();
    paintPiles();
  };
  apply();
  void document.fonts?.ready.then(() => paintEasel());

  // ---- sizing, the camera, the pointer, the keys -------------------------------------------------------------------
  const phone = () => host.clientWidth < PHONE_W;
  const size = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < PHONE_W ? 50 : 38;
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
  const look = new Vector3(0, 1.45, -1.4);
  // WASD swivels the view round the table (not free roam): A/D within a set arc, W/S in and out within tight bounds,
  // both resisted past the soft edge and eased back inside it when the keys let go; Escape snaps home.
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: look.x, cz: look.z, r: 1 }),
    origin: () => [look.x, look.z],
    forward: () => [look.x - cam.position.x, look.z - cam.position.z],
    orbit: {
      turn: (r) => (yawTo = swing(yawTo, r * 0.7, ARC)),
      zoom: (a) => (zoomTo = 1 + swing(zoomTo - 1, -a * 0.3, ZOOM_ARC)),
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  let downAt: { x: number; y: number } | null = null;
  let lastX = 0;
  let focusId: string | null = null;
  const onMove = (e: PointerEvent) => {
    if (!downAt) return;
    yawTo = swing(yawTo, -(e.clientX - lastX) * 0.005, ARC);
    lastX = e.clientX;
  };
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
    lastX = e.clientX;
  };
  const onUp = () => {
    downAt = null;
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onUp);

  // ---- anchors for the tags ----------------------------------------------------------------------------------------
  const placed = new Map<string, string>();
  const tmp = new Vector3();
  const report = (id: string, p: Vector3, show = true) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    tmp.copy(p).project(cam);
    const x = ((tmp.x + 1) / 2) * w;
    const y = ((1 - tmp.y) / 2) * h;
    const on = show && tmp.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
    const k = on ? `${Math.round(x)}|${Math.round(y)}` : "off";
    if (placed.get(id) === k) return;
    placed.set(id, k);
    opts.onPlace(id, x, y, on);
  };

  // ---- each frame ---------------------------------------------------------------------------------------------------
  let T = 0;
  const tA = new Vector3();
  const draw = (dt: number) => {
    T += dt * (reduce ? 0 : 1);
    stepUndone?.(reduce ? 0 : T, renderer);
    vault.step(reduce ? 0 : T, cam);
    spire.rotation.y = T * 0.18;
    beamMat.opacity = 0.055 + (reduce ? 0 : 0.015 * Math.sin(T * 0.8));
    for (const a of agents) {
      a.mixer?.update(dt);
      a.tick(T, dt);
      a.lit = damp(a.lit, focusId === a.id ? 1 : 0, 6, dt);
      for (const m of a.mats) if (a.id !== "gilt") m.emissiveIntensity = a.lit * 0.18;
    }
    for (const p of piles) {
      p.lit = damp(p.lit, focusId === `pile-${p.id}` ? 1 : 0, 6, dt);
      p.mat.emissiveIntensity = p.lit * 0.5 + (p.id === "overdue" && p.n ? 0.12 + (reduce ? 0 : 0.1 * Math.sin(T * 2.2)) : 0);
    }
    // Nanites streaming in to the unbuilt stretch of glass and ceiling, and rising off the turning Spire.
    for (let j = 0; j < NS; j++) {
      const s = streams[j]!;
      s.k += dt * s.w * (reduce ? 0 : 1);
      if (s.k >= 1) {
        s.k -= 1;
        s.th = WALL.gap0 + Math.random() * (WALL.gap1 - WALL.gap0);
        s.y = Math.random() * WALL.h;
        ng[j] = Math.floor(Math.random() * NG);
      }
      const e = ease(Math.min(1, s.k));
      const r = WALL.r - s.from * (1 - e);
      const p = at(s.th + (1 - e) * 0.25, r, s.y - (1 - e) * 1.4);
      np.set([p.x, p.y, p.z], j * 3);
      nt.set([goldC.r, goldC.g, goldC.b], j * 3);
      na[j] = Math.min(1, s.k * 5) * (1 - Math.max(0, (s.k - 0.85) / 0.15)) * 0.8;
    }
    for (let j = 0; j < NR; j++) {
      const q = NS + j;
      const s = rises[j]!;
      s.k += dt * s.w * (reduce ? 0 : 1);
      if (s.k >= 1) {
        s.k -= 1;
        s.a = Math.random() * Math.PI * 2;
        ng[q] = Math.floor(Math.random() * NG);
      }
      const a = s.a + s.k * 1.6;
      np.set([Math.cos(a) * s.r, 0.7 + s.k * 3.2, -0.2 + Math.sin(a) * s.r], q * 3);
      nt.set([hiC.r, hiC.g, hiC.b], q * 3);
      na[q] = Math.min(1, s.k * 6) * (1 - s.k) * 0.75;
    }
    for (const k of ["position", "tint", "alpha", "glyph"]) nGeo.attributes[k]!.needsUpdate = true;
    // The camera: standing at the open end of the table, looking down its length to the glass; it sways a little.
    pan.step(dt);
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 4);
    if (!pan.busy && !downAt) {
      if (Math.abs(yawTo) > ARC * SOFT) yawTo = damp(yawTo, Math.sign(yawTo) * ARC * SOFT, 4, dt);
      if (Math.abs(zoomTo - 1) > ZOOM_ARC * SOFT) zoomTo = damp(zoomTo, 1 + Math.sign(zoomTo - 1) * ZOOM_ARC * SOFT, 4, dt);
    }
    yaw += (yawTo - yaw) * ek;
    zoom += (zoomTo - zoom) * ek;
    const ph = phone();
    const th = Math.PI / 2 + yaw + (reduce ? 0 : Math.sin(T * 0.05) * 0.04);
    const D = (ph ? (cam.aspect < 0.7 ? 13.4 : 13) : 11.4) * zoom;
    const camY = (ph ? 6.4 : 5.3) * (0.7 + 0.3 * zoom);
    cam.position.set(look.x + Math.cos(th) * D, camY, look.z + Math.sin(th) * D);
    cam.lookAt(look.x, look.y, look.z);
    const w = host.clientWidth;
    const h = host.clientHeight;
    const inset = ph ? 0 : opts.inset();
    cam.setViewOffset(w, h, inset / 2, ph ? -h * 0.13 : -h * 0.02, w, h);
    renderer.render(scene, cam);
    for (const a of agents) report(a.id, a.head);
    for (const p of piles) report(`pile-${p.id}`, tA.set(p.g.position.x, TABLE.top + 0.1 + foldersOf(p.n) * 0.017, p.g.position.z), view.piles.length > 0);
    report("easel", tA.set(easelAt.x, 2.25, easelAt.z));
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
      apply();
    },
    focus: (id) => {
      focusId = id;
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      pan.dispose();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onUp);
      for (const a of agents) a.mixer?.stopAllAction();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
