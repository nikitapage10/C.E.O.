import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
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
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { comeUndone, glyphMaterial, sigilAtlas, SIGIL_GLYPHS } from "@ceo/engine/sigils/undone.ts";
import { edgeFactor, SOFT, wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import type { BowlMan, BowlView } from "./bowlView.ts";

/**
 * The Green as the bowl (#824, concept 01, picked by Nikita 2026-11-05): a football stadium at night, seen from high on
 * the sideline (from behind your end zone on a phone). A horseshoe of solid stands round a lit field, open on the near
 * side so the field reads; floodlight towers at the corners, a ribbon board along the fascia and a jumbotron over the
 * far stands. One section of the upper deck is still being raised: only its gold wire stands there, with sigil
 * nanites streaming up off the ground into it. The crowd in the stands is sigils.
 *
 * Everything that moves is the league's own (bowlView.ts): both lineups stand on the turf in formation, each starter a
 * pillar, solid gold for what he has scored and wire for what FantasyPros still has him for (yours gold, theirs
 * steel); the ball sits on the yard line of the win chance with the line of scrimmage across the field; the team names
 * are painted in the end zones and run on the ribbon; the jumbotron carries the score. An empty board is an empty
 * field.
 *
 * The Senate's look (#856, #878): solid models with a gold wire skin and the frame's edges coming undone into gold wire
 * and code (`@ceo/engine/sigils/undone.ts`). The second pass (#987) keeps the design and fills it in: denser wire on
 * the stands, every solid edge traced in brighter gold, the facades and the masts cross-braced, a shimmer sweeping the
 * wire, sigil nanites orbiting the rims and skimming the field's boundary, the edges dissolving upward into nanites,
 * motes in the floodlights, and sparks off a starter's pillar when his points go up in a live game. A/D (or a drag) swivel the view round the field within a set arc, W/S
 * dolly in and out a little, Escape snaps back (wasdPan's orbit mode). Phones get fewer particles and 30 frames a
 * second; reduced motion holds it still. Lazy loaded with three.js, never in the Desk's first load.
 */

export interface BowlOpts {
  phone: boolean;
  reduce: boolean;
  view: BowlView;
  /** Where each anchor is on screen (host CSS pixels): each starter by his id, and `ball`. */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
}

export interface Bowl {
  set: (view: BowlView) => void;
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

const PHONE_W = 760;
/** The field: 120 yards by 53⅓, five yards to a unit. Length runs along x (your end at −x), across along z (far side −z). */
const FL = 24;
const FW = 10.667;
/** The bowl's ellipse at radius 1; each tier scales it. */
const SX = 15.5;
const SZ = 9.6;
/** Tiers: inner and outer radius (in ellipse units), and the height of each edge. */
const LOWER = { r0: 1, r1: 1.42, y0: 0.5, y1: 3.4 };
const UPPER = { r0: 1.5, r1: 1.9, y0: 4.6, y1: 10.5 };
const TAU = Math.PI * 2;
/** The upper deck is open over the near stand (theta round 0, toward the camera) so the field reads. */
const NEAR_GAP = 1.7;
/** The section still being raised: wire only. */
const RAISE = [2.05, 2.8] as const;
const GOLD = 0xc9a85c;
const GOLD_HI = 0xe8c77a;
const STEEL = 0xaeb6c8;
const AMBER = 0xf0a050;
/** The swivel: how far either way the view turns from home (rad), and how far it dollies (share). */
const ARC = 0.6;
const ZOOM_ARC = 0.16;
/** Points to height on a pillar, and the tallest one. */
const PER_PT = 0.13;
const TALL = 4.2;
const MAX_MEN = 24;

function swing(v: number, d: number, lim: number): number {
  const out = d !== 0 && Math.sign(d) === Math.sign(v);
  return Math.max(-lim, Math.min(lim, v + (out ? d * edgeFactor(Math.abs(v) / lim) : d)));
}
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
/** A seeded random, so the bowl is built the same way every visit. */
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

/** A point on the bowl's ellipse at radius r (ellipse units) and angle th (0 toward the near side, +z). */
const ell = (r: number, th: number, y: number): [number, number, number] => [Math.sin(th) * r * SX, y, Math.cos(th) * r * SZ];
/** Where a share of the field lands in the world. */
const fieldX = (along: number) => (along - 0.5) * FL;
const fieldZ = (across: number) => (across - 0.5) * FW;
/** The stands' arcs (start, length), leaving out the near gap and, for the upper deck, the section being raised. */
const LOWER_ARCS: [number, number][] = [[0, TAU]];
const UPPER_ARCS: [number, number][] = [
  [NEAR_GAP / 2, RAISE[0] - NEAR_GAP / 2],
  [RAISE[1], TAU - NEAR_GAP / 2 - RAISE[1]],
];
const inArcs = (th: number, arcs: [number, number][]) => {
  const t = ((th % TAU) + TAU) % TAU;
  return arcs.some(([a, l]) => t >= a && t <= a + l);
};

const short = (team: string, n = 22) => (team.length > n ? `${team.slice(0, n - 1)}…` : team);
const fmt = (n: number) => n.toFixed(1);

/* ── painted textures: the turf, the seats, the ribbon, the jumbotron ── */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

const SANS = `"Barlow Condensed","Oswald","Jost Variable",system-ui,sans-serif`;

/** The field: mown stripes, white lines every five yards, numbers, hash marks, the end zones with each team's name. */
function paintField(g: CanvasRenderingContext2D, W: number, H: number, view: BowlView) {
  const px = W / 120;
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? "#1f4a1c" : "#24531f";
    g.fillRect(i * 5 * px, 0, 5 * px + 1, H);
  }
  // End zones: yours in gold, theirs in steel, each with its team's name.
  const zone = (x0: number, tint: string, name: string, flip: boolean) => {
    g.fillStyle = "#173a16";
    g.fillRect(x0, 0, 10 * px, H);
    g.fillStyle = tint;
    g.globalAlpha = 0.16;
    g.fillRect(x0, 0, 10 * px, H);
    g.globalAlpha = 1;
    if (!name) return;
    g.save();
    g.translate(x0 + 5 * px, H / 2);
    g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    g.textAlign = "center";
    g.textBaseline = "middle";
    let size = 6.2 * px;
    g.font = `800 ${size}px ${SANS}`;
    const max = H * 0.86;
    const w = g.measureText(name.toUpperCase()).width;
    if (w > max) {
      size *= max / w;
      g.font = `800 ${size}px ${SANS}`;
    }
    g.fillStyle = tint;
    g.globalAlpha = 0.85;
    g.fillText(name.toUpperCase(), 0, 0);
    g.globalAlpha = 1;
    g.restore();
  };
  zone(0, "#e8c77a", view.me?.team ?? "", false);
  zone(110 * px, "#c8d0de", view.them?.team ?? "", true);
  g.strokeStyle = "rgba(245,245,240,.9)";
  g.lineWidth = Math.max(2, px * 0.35);
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = (10 + yd) * px;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  g.lineWidth = Math.max(3, px * 0.6);
  g.strokeRect(1, 1, W - 2, H - 2);
  // Hash marks every yard: along both sidelines and at the hashes.
  g.lineWidth = Math.max(1.5, px * 0.22);
  const hashes = [0.012, 0.36, 0.64, 0.988];
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = (10 + yd) * px;
    for (const h of hashes) {
      g.beginPath();
      g.moveTo(x, h * H - px * 0.55);
      g.lineTo(x, h * H + px * 0.55);
      g.stroke();
    }
  }
  // Numbers every ten, both sidelines, facing their own sideline.
  g.fillStyle = "rgba(245,245,240,.88)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 ${3.2 * px}px ${SANS}`;
  for (let yd = 10; yd < 100; yd += 10) {
    const n = String(yd <= 50 ? yd : 100 - yd);
    const x = (10 + yd) * px;
    g.save();
    g.translate(x, H * 0.84);
    g.fillText(n, 0, 0);
    g.restore();
    g.save();
    g.translate(x, H * 0.16);
    g.rotate(Math.PI);
    g.fillText(n, 0, 0);
    g.restore();
  }
  // Midfield: a gold ring with the league's name.
  g.strokeStyle = "rgba(232,199,122,.75)";
  g.lineWidth = px * 0.4;
  g.beginPath();
  g.ellipse(60 * px, H / 2, 6 * px, 6 * px, 0, 0, TAU);
  g.stroke();
  if (view.league) {
    g.fillStyle = "rgba(232,199,122,.85)";
    g.font = `700 ${1.7 * px}px ${SANS}`;
    g.fillText(short(view.league.toUpperCase(), 18), 60 * px, H / 2);
  }
}

/** The seats: rows of seat backs over treads, an aisle at the left of each tile. */
function seatTexture(): CanvasTexture {
  const [c, g] = canvas(64, 512);
  if (g) {
    const rows = 22;
    const rh = 512 / rows;
    for (let i = 0; i < rows; i++) {
      const y = i * rh;
      g.fillStyle = "#1c1f25";
      g.fillRect(0, y, 64, rh);
      g.fillStyle = i % 2 ? "#3c4354" : "#363c4c";
      g.fillRect(0, y + rh * 0.38, 64, rh * 0.5);
      g.fillStyle = "rgba(232,199,122,.3)";
      g.fillRect(0, y + rh * 0.38, 64, 1.5);
    }
    g.fillStyle = "#0d0e11";
    g.fillRect(0, 0, 5, 512);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** The ribbon board's line: the score, the chance, the week, the league; it scrolls round the fascia. */
function paintRibbon(g: CanvasRenderingContext2D, W: number, H: number, view: BowlView) {
  g.fillStyle = "#07070a";
  g.fillRect(0, 0, W, H);
  const bits: string[] = [];
  if (view.me) bits.push(`${view.me.team.toUpperCase()} ${fmt(view.me.score)}`);
  if (view.them) bits.push(`${view.them.team.toUpperCase()} ${fmt(view.them.score)}`);
  else if (view.me) bits.push("BYE WEEK");
  if (view.win !== null) bits.push(`WIN ${Math.round(view.win * 100)}%`);
  if (view.week) bits.push(`WEEK ${view.week}${view.live ? " · LIVE" : ""}`);
  if (view.league) bits.push(view.league.toUpperCase());
  const line = bits.length ? bits.join("   ◆   ") + "   ◆   " : "THE GREEN   ◆   ";
  g.font = `700 ${H * 0.62}px ${SANS}`;
  g.textBaseline = "middle";
  g.fillStyle = "#f2d38e";
  const w = Math.max(1, g.measureText(line).width);
  for (let x = 0; x < W; x += w) g.fillText(line, x, H * 0.54);
}

/** The jumbotron: the week, both teams, the score, and the win chance as a bar. */
function paintBoard(g: CanvasRenderingContext2D, W: number, H: number, view: BowlView) {
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#0d0c0a");
  grd.addColorStop(1, "#050506");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(232,199,122,.55)";
  g.lineWidth = 4;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillStyle = "#e8c77a";
  g.font = `600 ${H * 0.09}px ${SANS}`;
  const head = view.me ? `WEEK ${view.week || "–"} · ${view.live ? "LIVE" : view.them ? "PROJECTED" : "BYE WEEK"}` : "THE GREEN";
  g.fillText(head, W / 2, H * 0.13);
  if (!view.me) {
    g.fillStyle = "rgba(242,234,214,.6)";
    g.font = `600 ${H * 0.12}px ${SANS}`;
    g.fillText("NO GAME ON THE BOARD", W / 2, H * 0.5);
    return;
  }
  const side = (x: number, name: string, score: string, tint: string) => {
    g.fillStyle = "rgba(242,234,214,.86)";
    let size = H * 0.1;
    g.font = `700 ${size}px ${SANS}`;
    const w = g.measureText(name).width;
    if (w > W * 0.42) {
      size *= (W * 0.42) / w;
      g.font = `700 ${size}px ${SANS}`;
    }
    g.fillText(name, x, H * 0.3);
    g.fillStyle = tint;
    g.font = `800 ${H * 0.34}px ${SANS}`;
    g.fillText(score, x, H * 0.56);
  };
  side(W * 0.26, view.me.team.toUpperCase(), fmt(view.me.score), "#f6e2ae");
  side(W * 0.74, view.them ? view.them.team.toUpperCase() : "BYE", view.them ? fmt(view.them.score) : "–", "#dfe4ee");
  g.fillStyle = "rgba(232,199,122,.6)";
  g.font = `600 ${H * 0.08}px ${SANS}`;
  g.fillText(view.live ? "SO FAR" : "PROJ", W / 2, H * 0.56);
  if (view.win !== null) {
    const x0 = W * 0.08;
    const bw = W * 0.84;
    const y = H * 0.82;
    const bh = H * 0.075;
    g.fillStyle = "#2b2e36";
    g.fillRect(x0, y, bw, bh);
    g.fillStyle = "#e8c77a";
    g.fillRect(x0, y, bw * view.win, bh);
    g.fillStyle = "#f6e2ae";
    g.textAlign = "left";
    g.font = `700 ${H * 0.07}px ${SANS}`;
    g.fillText(`WIN ${Math.round(view.win * 100)}%`, x0, y - H * 0.06);
    g.textAlign = "right";
    g.fillStyle = "rgba(223,228,238,.75)";
    g.fillText(`${Math.round((1 - view.win) * 100)}%`, x0 + bw, y - H * 0.06);
  }
}

/* ── the scene ── */

interface Pillar {
  g: Group;
  disc: Mesh<CircleGeometry, MeshBasicMaterial>;
  core: Mesh<CylinderGeometry, MeshStandardMaterial>;
  wire: LineSegments<EdgesGeometry, LineBasicMaterial>;
  cap: Mesh<OctahedronGeometry, MeshBasicMaterial>;
  /** Shown heights, eased toward the man's. */
  hb: number;
  hp: number;
  man: BowlMan | null;
}

export async function createBowl(host: HTMLElement, cv: HTMLCanvasElement, opts: BowlOpts): Promise<Bowl> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  const renderer = new WebGLRenderer({ canvas: cv, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.25 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new Scene();
  scene.background = new Color(0x040508);
  scene.fog = new FogExp2(0x07080c, 0.0085);
  const cam = new PerspectiveCamera(40, 1, 0.1, 500);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const px = { value: renderer.getPixelRatio() };
  const atlas = keep(await sigilAtlas());
  const NG = SIGIL_GLYPHS.length;
  const rnd = rng(824);
  /** The scene's clock for the shader-driven layers (wire shimmer, nanite streams, motes): stops under reduced motion. */
  const clock = { value: 0 };
  /** Phones and small machines get fewer of every particle (#987). */
  const LITE = PH || (typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4);
  /** The glyph points' material for the bowl's distances: like the engine's, but sized to stay legible across the far stands. */
  const farGlyphs = (size: number) => {
    const m = glyphMaterial(atlas, px, size);
    m.vertexShader = m.vertexShader.replace(/gl_PointSize = [^;]+;/, `gl_PointSize = min(sz * ${size.toFixed(1)} * px * (6. / pow(-mv.z, .7)), 40. * px);`);
    return m;
  };

  // ---- light: the floodlights' warm white over a cold night ------------------------------------------------------
  scene.add(new HemisphereLight(0x9aa6c4, 0x0a0a0c, 0.8));
  const key1 = new DirectionalLight(0xfff1d8, 1.6);
  key1.position.set(-20, 26, 14);
  scene.add(key1);
  const key2 = new DirectionalLight(0xfff1d8, 1.1);
  key2.position.set(22, 24, -14);
  scene.add(key2);

  // ---- the sky: night, the floodlights' haze low over the rim, a few stars ----------------------------------------
  const sky = new Mesh(
    keep(new SphereGeometry(220, 32, 16)),
    keep(
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `varying vec3 vP; void main(){ float h = vP.y; vec3 top = vec3(.012,.016,.035); vec3 low = vec3(.06,.05,.035);
          vec3 c = mix(low, top, smoothstep(-.02, .35, h)); c += vec3(.09,.075,.04) * exp(-abs(h - .04) * 14.) * .6; gl_FragColor = vec4(c, 1.); }`,
      }),
    ),
  );
  scene.add(sky);
  {
    const N = PH ? 220 : 520;
    const p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rnd() * TAU;
      const e = 0.12 + rnd() * 1.3;
      p.set([Math.cos(a) * Math.cos(e) * 200, Math.sin(e) * 200, Math.sin(a) * Math.cos(e) * 200], i * 3);
    }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(p, 3));
    const stars = new Points(g, keep(new ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: { px }, vertexShader: `uniform float px; void main(){ gl_PointSize = 1.6 * px; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`, fragmentShader: `void main(){ gl_FragColor = vec4(.85,.86,.95,.55); }` })));
    scene.add(stars);
  }

  // ---- the ground and the field -------------------------------------------------------------------------------------
  const ground = new Mesh(keep(new CircleGeometry(90, 64)), keep(new MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.95 })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  // The apron round the field: darker turf out to the stands.
  const apron = new Mesh(keep(new CircleGeometry(1, 96)), keep(new MeshStandardMaterial({ color: 0x14261a, roughness: 0.95 })));
  apron.rotation.x = -Math.PI / 2;
  apron.scale.set(SX * LOWER.r0, SZ * LOWER.r0, 1);
  apron.position.y = -0.01;
  scene.add(apron);
  const [fc, fg] = canvas(PH ? 1536 : 2400, PH ? 683 : 1067);
  const fieldTex = keep(new CanvasTexture(fc));
  fieldTex.colorSpace = SRGBColorSpace;
  fieldTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const field = new Mesh(keep(new PlaneGeometry(FL, FW)), keep(new MeshStandardMaterial({ map: fieldTex, roughness: 0.9, emissive: 0xffffff, emissiveMap: fieldTex, emissiveIntensity: 0.32 })));
  field.rotation.x = -Math.PI / 2;
  scene.add(field);
  let paintedField = "";
  const repaintField = () => {
    const sig = JSON.stringify([view.me?.team, view.them?.team, view.league]);
    if (sig === paintedField || !fg) return;
    paintedField = sig;
    paintField(fg, fc.width, fc.height, view);
    fieldTex.needsUpdate = true;
  };

  // Goalposts at the back of each end zone, in gold.
  {
    const mat = keep(new MeshStandardMaterial({ color: GOLD_HI, emissive: GOLD, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.35 }));
    const post = keep(new CylinderGeometry(0.05, 0.05, 1, 8));
    for (const s of [-1, 1]) {
      const g = new Group();
      g.position.set((s * FL) / 2 + s * 0.3, 0, 0);
      const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
        const m = new Mesh(post, mat);
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        m.rotation.z = rz;
        m.rotation.x = rx;
        g.add(m);
      };
      add(1.4, 1.9, 1.4, 0, 0.95, 0);
      add(1, 0.5, 1, (-s * 0.5) / 2, 1.9, 0, Math.PI / 2);
      add(0.9, 1.25, 0.9, -s * 0.5, 1.9, 0, 0, Math.PI / 2);
      add(0.8, 2.2, 0.8, -s * 0.5, 3, -0.62);
      add(0.8, 2.2, 0.8, -s * 0.5, 3, 0.62);
      scene.add(g);
    }
  }

  // ---- the stands: a lower bowl all the way round, the upper deck a horseshoe, one section still going up ----------
  const seats = keep(seatTexture());
  const wallMat = keep(new MeshStandardMaterial({ color: 0x22242b, roughness: 0.8, metalness: 0.25, side: DoubleSide }));
  const tier = (t: typeof LOWER, arcs: [number, number][], rep: number) => {
    for (const [a, l] of arcs) {
      const n = Math.max(8, Math.round((l / TAU) * 128));
      // The raked seating: a frustum widening upward, squashed into the bowl's ellipse.
      const geo = keep(new CylinderGeometry(t.r1, t.r0, t.y1 - t.y0, n, 1, true, a, l));
      const tex = seats.clone();
      tex.repeat.set(Math.max(2, Math.round((rep * l) / TAU)), 1);
      tex.needsUpdate = true;
      keep(tex);
      const m = new Mesh(geo, keep(new MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.08, side: DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14 })));
      m.scale.set(SX, 1, SZ);
      m.position.y = (t.y0 + t.y1) / 2;
      scene.add(m);
      // The back wall from the ground to the top row.
      const back = new Mesh(keep(new CylinderGeometry(t.r1 + 0.01, t.r1 + 0.01, t.y1 + 0.35, n, 1, true, a, l)), wallMat);
      back.scale.set(SX, 1, SZ);
      back.position.y = (t.y1 + 0.35) / 2;
      scene.add(back);
    }
  };
  tier(LOWER, LOWER_ARCS, 56);
  tier(UPPER, UPPER_ARCS, 64);
  // The front wall of the lower bowl, round the apron.
  {
    const wall = new Mesh(keep(new CylinderGeometry(LOWER.r0, LOWER.r0, LOWER.y0 + 0.1, 128, 1, true)), wallMat);
    wall.scale.set(SX, 1, SZ);
    wall.position.y = (LOWER.y0 + 0.1) / 2;
    scene.add(wall);
    // The concourse between the decks.
    const deck = new Mesh(keep(new RingGeometry(LOWER.r1, UPPER.r0 + 0.02, 128, 1)), wallMat);
    deck.rotation.x = -Math.PI / 2;
    deck.scale.set(SX, SZ, 1);
    deck.position.y = LOWER.y1 + 0.02;
    scene.add(deck);
  }
  // The ribbon board along the fascia under the upper deck, the league's line scrolling round it.
  const [rc, rg] = canvas(2048, 64);
  const ribbonTex = keep(new CanvasTexture(rc));
  ribbonTex.colorSpace = SRGBColorSpace;
  ribbonTex.wrapS = RepeatWrapping;
  ribbonTex.repeat.set(-3, 1);
  const ribbonMat = keep(new MeshBasicMaterial({ map: ribbonTex, side: DoubleSide, toneMapped: false, color: 0xd9d0bc }));
  for (const [a, l] of UPPER_ARCS) {
    const r = new Mesh(keep(new CylinderGeometry(UPPER.r0 - 0.004, UPPER.r0 - 0.004, 0.62, 96, 1, true, a, l)), ribbonMat);
    r.scale.set(SX, 1, SZ);
    r.position.y = UPPER.y0 - 0.2;
    scene.add(r);
  }
  let paintedRibbon = "";
  const repaintRibbon = () => {
    const sig = JSON.stringify([view.me, view.them, view.win, view.week, view.live, view.league]);
    if (sig === paintedRibbon || !rg) return;
    paintedRibbon = sig;
    paintRibbon(rg, rc.width, rc.height, view);
    ribbonTex.needsUpdate = true;
  };

  // The gold wire skin over the stands: every few rows and the aisles. The section being raised is wire alone, brighter.
  const skin: number[] = [];
  const raised: number[] = [];
  const rowRings = (t: typeof LOWER, arcs: [number, number][], rows: number, out: number[]) => {
    for (let k = 0; k <= rows; k++) {
      const f = k / rows;
      const r = t.r0 + (t.r1 - t.r0) * f;
      const y = t.y0 + (t.y1 - t.y0) * f;
      for (const [a, l] of arcs) {
        const n = Math.max(4, Math.round((l / TAU) * 140));
        for (let i = 0; i < n; i++) out.push(...ell(r, a + (l * i) / n, y), ...ell(r, a + (l * (i + 1)) / n, y));
      }
    }
  };
  const rakers = (t: typeof LOWER, arcs: [number, number][], step: number, out: number[]) => {
    for (const [a, l] of arcs) for (let th = a; th <= a + l + 1e-6; th += step) out.push(...ell(t.r0, th, t.y0), ...ell(t.r1, th, t.y1));
  };
  rowRings(LOWER, LOWER_ARCS, 9, skin);
  rowRings(UPPER, UPPER_ARCS, 9, skin);
  rakers(LOWER, LOWER_ARCS, 0.12, skin);
  rakers(UPPER, UPPER_ARCS, 0.12, skin);
  // The solid edges traced in brighter gold (#987): every tier's lip and top row, the back walls' crowns and feet, the
  // cut ends of the upper deck, the fascia's ribbon, the field's boundary and goal lines.
  const rims: number[] = [];
  const ring = (r: number, y: number, arcs: [number, number][], out: number[]) => {
    for (const [a, l] of arcs) {
      const n = Math.max(4, Math.round((l / TAU) * 160));
      for (let i = 0; i < n; i++) out.push(...ell(r, a + (l * i) / n, y), ...ell(r, a + (l * (i + 1)) / n, y));
    }
  };
  for (const [t, arcs] of [
    [LOWER, LOWER_ARCS],
    [UPPER, UPPER_ARCS],
  ] as const) {
    ring(t.r0, t.y0, arcs, rims);
    ring(t.r1, t.y1, arcs, rims);
    ring(t.r1 + 0.012, t.y1 + 0.35, arcs, rims);
    ring(t.r1 + 0.012, 0.03, arcs, rims);
  }
  ring(LOWER.r0, LOWER.y0 + 0.1, LOWER_ARCS, rims);
  ring(UPPER.r0 - 0.006, UPPER.y0 + 0.11, UPPER_ARCS, rims);
  ring(UPPER.r0 - 0.006, UPPER.y0 - 0.51, UPPER_ARCS, rims);
  for (const [a, l] of UPPER_ARCS)
    for (const th of [a, a + l]) {
      rims.push(...ell(UPPER.r0, UPPER.y0, th), ...ell(UPPER.r1, UPPER.y1, th));
      rims.push(...ell(UPPER.r1 + 0.012, UPPER.y1 + 0.35, th), ...ell(UPPER.r1 + 0.012, 0.03, th));
      rims.push(...ell(UPPER.r0, UPPER.y0, th), ...ell(UPPER.r0, LOWER.y1, th));
      rims.push(...ell(UPPER.r1, UPPER.y1, th), ...ell(UPPER.r1 + 0.012, UPPER.y1 + 0.35, th));
    }
  rims.push(-FL / 2, 0.035, -FW / 2, FL / 2, 0.035, -FW / 2, FL / 2, 0.035, -FW / 2, FL / 2, 0.035, FW / 2);
  rims.push(FL / 2, 0.035, FW / 2, -FL / 2, 0.035, FW / 2, -FL / 2, 0.035, FW / 2, -FL / 2, 0.035, -FW / 2);
  for (const s of [-1, 1]) rims.push((s * FL * 5) / 12, 0.035, -FW / 2, (s * FL * 5) / 12, 0.035, FW / 2);
  // The facade: the outer walls cross-braced in gold, the upper deck's all round and the lower bowl's under the gap.
  const truss: number[] = [];
  const brace = (r: number, top: number, arcs: [number, number][], step: number) => {
    for (const [a, l] of arcs) {
      const n = Math.max(1, Math.round(l / step));
      for (let i = 0; i < n; i++) {
        const t0 = a + (l * i) / n;
        const t1 = a + (l * (i + 1)) / n;
        truss.push(...ell(r, t0, 0.03), ...ell(r, t1, top), ...ell(r, t1, 0.03), ...ell(r, t0, top));
        truss.push(...ell(r, t0, 0.03), ...ell(r, t0, top));
        truss.push(...ell(r, t0, top * 0.5), ...ell(r, t1, top * 0.5));
      }
    }
  };
  brace(UPPER.r1 + 0.02, UPPER.y1 + 0.35, UPPER_ARCS, 0.09);
  brace(LOWER.r1 + 0.02, LOWER.y1 + 0.35, [[-NEAR_GAP / 2, NEAR_GAP]], 0.07);
  const raiseArc: [number, number][] = [[RAISE[0], RAISE[1] - RAISE[0]]];
  rowRings(UPPER, raiseArc, 14, raised);
  rakers(UPPER, raiseArc, 0.06, raised);
  // Its scaffold: the back wall's frame from the ground up, and the braces.
  for (let th = RAISE[0]; th <= RAISE[1] + 1e-6; th += 0.12) {
    raised.push(...ell(UPPER.r1, th, 0), ...ell(UPPER.r1, th, UPPER.y1 + 0.35));
    raised.push(...ell(UPPER.r0, th, LOWER.y1), ...ell(UPPER.r0, th, UPPER.y0));
    if (th + 0.12 <= RAISE[1] + 1e-6) raised.push(...ell(UPPER.r1, th, 0), ...ell(UPPER.r1, th + 0.12, UPPER.y1 * 0.6));
  }
  for (let k = 0; k <= 4; k++) {
    const y = (UPPER.y1 + 0.35) * (k / 4);
    for (let i = 0; i < 12; i++) raised.push(...ell(UPPER.r1, RAISE[0] + ((RAISE[1] - RAISE[0]) * i) / 12, y), ...ell(UPPER.r1, RAISE[0] + ((RAISE[1] - RAISE[0]) * (i + 1)) / 12, y));
  }
  const lines = (arr: number[], color: number, opacity: number) => {
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(arr), 3));
    const l = new LineSegments(g, keep(new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending })));
    scene.add(l);
    return l;
  };
  // The wire shimmers (#987): a bright band sweeps round the bowl and a fainter pulse climbs the rows. Held still under
  // reduced motion (the clock stops).
  const shimmer = (arr: number[], rgb: string, base: number, peak: number) => {
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(arr), 3));
    const l = new LineSegments(
      g,
      keep(
        new ShaderMaterial({
          uniforms: { t: clock },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          vertexShader: `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
          fragmentShader: `uniform float t; varying vec3 vW;
            void main(){ float a = atan(vW.x / ${SX.toFixed(2)}, vW.z / ${SZ.toFixed(2)}) / 6.28318;
              float s = fract(a - t * .04); float b1 = exp(-pow(min(s, 1. - s) * 11., 2.));
              float s2 = fract(a + t * .025 + .5); float b2 = exp(-pow(min(s2, 1. - s2) * 16., 2.)) * .6;
              float up = fract(vW.y * .09 - t * .16); float climb = smoothstep(0., .04, up) * (1. - smoothstep(.04, .16, up));
              float band = b1 + b2;
              gl_FragColor = vec4(vec3(${rgb}) * (1. + band * 1.4 + climb * .4), ${base.toFixed(3)} + band * ${peak.toFixed(3)} + climb * .08); }`,
        }),
      ),
    );
    scene.add(l);
    return l;
  };
  shimmer(skin, ".79, .66, .36", 0.3, 0.4);
  shimmer(truss, ".79, .66, .36", 0.2, 0.35);
  shimmer(rims, ".91, .78, .48", 0.55, 0.45);
  const raisedLines = lines(raised, GOLD_HI, 0.55);

  // ---- floodlight towers at the corners, their beams on the field ---------------------------------------------------
  {
    const steel = keep(new MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.6, metalness: 0.7 }));
    const bank = keep(new MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false }));
    const beamMat = keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `varying float vY; void main(){ gl_FragColor = vec4(1., .93, .78, .055 * pow(vY, 1.6)); }`,
      }),
    );
    const mast = keep(new CylinderGeometry(0.22, 0.38, 1, 8));
    const head = keep(new BoxGeometry(3.4, 1.8, 0.35));
    const face = keep(new PlaneGeometry(3.1, 1.5));
    const towers: number[] = [];
    for (const [x, z] of [
      [-26, 15.5],
      [26, 15.5],
      [-26, -15.5],
      [26, -15.5],
    ] as const) {
      const H = 21;
      const m = new Mesh(mast, steel);
      m.scale.y = H;
      m.position.set(x, H / 2, z);
      scene.add(m);
      const g = new Group();
      g.position.set(x, H + 0.6, z);
      g.lookAt(x * 0.15, 0, z * 0.15);
      const hd = new Mesh(head, steel);
      g.add(hd);
      const f = new Mesh(face, bank);
      f.position.z = 0.19;
      g.add(f);
      scene.add(g);
      towers.push(...[x, 0, z, x, H + 1.5, z]);
      // A lattice mast: three rails wound round it, zigzag braces between them (#987).
      for (let k = 0; k < 3; k++) {
        const a0 = (k / 3) * TAU;
        const a1 = ((k + 1) / 3) * TAU;
        for (let y = 0; y < H; y += 1.2) {
          const r0 = 0.62 - (y / H) * 0.3;
          const r1 = 0.62 - ((y + 1.2) / H) * 0.3;
          towers.push(x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0, x + Math.cos(a0) * r1, y + 1.2, z + Math.sin(a0) * r1);
          towers.push(x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0, x + Math.cos(a1) * r1, y + 1.2, z + Math.sin(a1) * r1);
        }
      }
      // Beams: open cones from the bank to spots on the field.
      for (const [tx, tz] of [
        [x * 0.28, z * 0.12],
        [x * 0.05, -z * 0.15],
      ]) {
        const from = new Vector3(x, H + 0.6, z);
        const to = new Vector3(tx, 0, tz);
        const L = from.distanceTo(to);
        const cone = new Mesh(keep(new ConeGeometry(3.2, L, 24, 1, true)), beamMat);
        cone.position.copy(from).add(to).multiplyScalar(0.5);
        cone.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), from.clone().sub(to).normalize()));
        scene.add(cone);
      }
    }
    lines(towers, GOLD, 0.3);
  }

  // ---- the jumbotron, hung over midfield on cables to the four towers: the score on each of its four faces ----------
  const [jc, jg] = canvas(1024, 416);
  const boardTex = keep(new CanvasTexture(jc));
  boardTex.colorSpace = SRGBColorSpace;
  {
    const g = new Group();
    const W = 6.2;
    const H = W * (416 / 1024);
    const frame = new Mesh(keep(new BoxGeometry(W + 0.4, H + 0.5, W + 0.4)), keep(new MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.5, metalness: 0.7 })));
    g.add(frame);
    const screenMat = keep(new MeshBasicMaterial({ map: boardTex, toneMapped: false }));
    const plane = keep(new PlaneGeometry(W, H));
    for (let k = 0; k < 4; k++) {
      const sc = new Mesh(plane, screenMat);
      const a = (k * Math.PI) / 2;
      sc.position.set(Math.sin(a) * (W / 2 + 0.21), 0, Math.cos(a) * (W / 2 + 0.21));
      sc.rotation.y = a;
      g.add(sc);
    }
    // A ring of gold under it, and its edges in gold wire.
    const halo = new Mesh(keep(new BoxGeometry(W + 0.6, 0.12, W + 0.6)), keep(new MeshBasicMaterial({ color: GOLD_HI, toneMapped: false })));
    halo.position.y = -H / 2 - 0.3;
    g.add(halo);
    const edges = new LineSegments(keep(new EdgesGeometry(keep(new BoxGeometry(W + 0.45, H + 0.55, W + 0.45)))), keep(new LineBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.6 })));
    g.add(edges);
    const Y = 9.4;
    g.position.set(0, Y, 0);
    scene.add(g);
    // The cables, from its top corners to the towers' heads.
    const cab: number[] = [];
    const top = Y + H / 2 + 0.25;
    for (const [x, z] of [
      [-26, 15.5],
      [26, 15.5],
      [-26, -15.5],
      [26, -15.5],
    ] as const) {
      const cx = (Math.sign(x) * (W + 0.4)) / 2;
      const cz = (Math.sign(z) * (W + 0.4)) / 2;
      cab.push(cx, top, cz, x, 21.6, z);
    }
    lines(cab, GOLD, 0.4);
  }
  let paintedBoard = "";
  const repaintBoard = () => {
    const sig = JSON.stringify([view.me, view.them, view.win, view.week, view.live]);
    if (sig === paintedBoard || !jg) return;
    paintedBoard = sig;
    paintBoard(jg, jc.width, jc.height, view);
    boardTex.needsUpdate = true;
  };

  // ---- the ball on the line of the win chance ----------------------------------------------------------------------
  const ball = new Group();
  {
    const leather = new Mesh(keep(new SphereGeometry(0.2, 24, 16)), keep(new MeshStandardMaterial({ color: 0x7a4322, roughness: 0.55 })));
    leather.scale.set(1.7, 1, 1);
    ball.add(leather);
    const lace = new Mesh(keep(new BoxGeometry(0.22, 0.02, 0.03)), keep(new MeshBasicMaterial({ color: 0xf4efe4 })));
    lace.position.y = 0.2;
    ball.add(lace);
    ball.position.y = 0.2;
    ball.rotation.y = 0.35;
  }
  scene.add(ball);
  const losMat = keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  const los = new Mesh(keep(new PlaneGeometry(0.09, FW)), losMat);
  los.rotation.x = -Math.PI / 2;
  los.position.y = 0.02;
  scene.add(los);
  const losGlow = new Mesh(
    keep(new PlaneGeometry(FW, 1.1)),
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `varying vec2 vU; void main(){ float a = (1. - vU.y) * (1. - vU.y) * smoothstep(0., .08, vU.x) * smoothstep(1., .92, vU.x); gl_FragColor = vec4(.91, .78, .48, a * .28); }`,
      }),
    ),
  );
  losGlow.rotation.y = Math.PI / 2;
  losGlow.position.y = 0.55;
  scene.add(losGlow);
  let ballX = fieldX(view.ball);

  // ---- the starters: a pillar each, solid for what he has scored, wire for what is still projected ----------------
  const discGeo = keep(new CircleGeometry(0.36, 28));
  const coreGeo = keep(new CylinderGeometry(0.1, 0.1, 1, 12));
  coreGeo.translate(0, 0.5, 0);
  const wireGeo = keep(new EdgesGeometry(keep(new CylinderGeometry(0.17, 0.17, 1, 6, 1, true))));
  wireGeo.translate(0, 0.5, 0);
  const capGeo = keep(new OctahedronGeometry(0.11, 0));
  const pillars: Pillar[] = [];
  for (let i = 0; i < MAX_MEN; i++) {
    const g = new Group();
    const disc = new Mesh(discGeo, keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false })));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.025;
    g.add(disc);
    const core = new Mesh(coreGeo, keep(new MeshStandardMaterial({ color: GOLD_HI, emissive: GOLD_HI, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4 })));
    g.add(core);
    const wire = new LineSegments(wireGeo, keep(new LineBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.7, depthWrite: false, blending: AdditiveBlending })));
    g.add(wire);
    const cap = new Mesh(capGeo, keep(new MeshBasicMaterial({ color: GOLD_HI, toneMapped: false })));
    g.add(cap);
    g.visible = false;
    scene.add(g);
    pillars.push({ g, disc, core, wire, cap, hb: 0, hp: 0, man: null });
  }
  const height = (pts: number) => Math.min(TALL, Math.max(0, pts) * PER_PT);
  const dress = (p: Pillar, m: BowlMan) => {
    const off = m.state === "bye" || m.state === "out" || m.state === "empty";
    const c = m.state === "sit" ? AMBER : m.mine ? GOLD_HI : STEEL;
    p.disc.material.color.setHex(c);
    p.disc.material.opacity = off ? 0.18 : m.mine ? 0.55 : 0.35;
    p.core.material.color.setHex(c);
    p.core.material.emissive.setHex(c);
    p.wire.material.color.setHex(c);
    p.wire.material.opacity = off ? 0.2 : m.mine ? 0.75 : 0.5;
    p.cap.material.color.setHex(c);
    p.g.position.set(fieldX(m.along), 0, fieldZ(m.across));
  };

  // ---- the crowd: sigils in the stands; the section going up streams nanites off the ground --------------------------
  const crowdN = LITE ? 1300 : 4200;
  const cPos = new Float32Array(crowdN * 3);
  const cTint = new Float32Array(crowdN * 3);
  const cAlpha = new Float32Array(crowdN);
  const cGlyph = new Float32Array(crowdN);
  const cSz = new Float32Array(crowdN);
  const cBase = new Float32Array(crowdN);
  const cPh = new Float32Array(crowdN);
  /** Which end each sigil sits nearer: −1 yours, +1 theirs, 0 along the sides. */
  const cEnd = new Float32Array(crowdN);
  {
    const gold = new Color(GOLD_HI);
    const cream = new Color(0xf2ead6);
    for (let i = 0; i < crowdN; ) {
      const upper = rnd() < 0.5;
      const t = upper ? UPPER : LOWER;
      const th = rnd() * TAU;
      if (!inArcs(th, upper ? UPPER_ARCS : LOWER_ARCS)) continue;
      const f = rnd();
      const [x, y, z] = ell(t.r0 + (t.r1 - t.r0) * f, th, t.y0 + (t.y1 - t.y0) * f + 0.22);
      cPos.set([x, y, z], i * 3);
      const c = rnd() < 0.6 ? gold : cream;
      cTint.set([c.r, c.g, c.b], i * 3);
      cGlyph[i] = Math.floor(rnd() * NG);
      cSz[i] = 0.75 + rnd() * 0.5;
      cBase[i] = 0.3 + rnd() * 0.45;
      cPh[i] = rnd() * TAU;
      cEnd[i] = Math.abs(Math.sin(th)) > 0.75 ? Math.sign(x) : 0;
      i++;
    }
  }
  const crowdGeo = keep(new BufferGeometry());
  crowdGeo.setAttribute("position", new BufferAttribute(cPos, 3));
  crowdGeo.setAttribute("tint", new BufferAttribute(cTint, 3));
  crowdGeo.setAttribute("alpha", new BufferAttribute(cAlpha, 1));
  crowdGeo.setAttribute("glyph", new BufferAttribute(cGlyph, 1));
  crowdGeo.setAttribute("sz", new BufferAttribute(cSz, 1));
  const crowd = new Points(crowdGeo, keep(farGlyphs(22)));
  crowd.frustumCulled = false;
  scene.add(crowd);

  const riseN = LITE ? 240 : 720;
  const rPos = new Float32Array(riseN * 3);
  const rTint = new Float32Array(riseN * 3);
  const rAlpha = new Float32Array(riseN);
  const rGlyph = new Float32Array(riseN);
  const rSz = new Float32Array(riseN);
  /** Each rising nanite: where it starts on the ground, where it settles in the section, its clock. */
  const rFrom = new Float32Array(riseN * 3);
  const rTo = new Float32Array(riseN * 3);
  const rLife = new Float32Array(riseN);
  const rSpeed = new Float32Array(riseN);
  const seedRise = (i: number, life: number) => {
    const th = RAISE[0] + rnd() * (RAISE[1] - RAISE[0]);
    const f = rnd();
    const to = ell(UPPER.r0 + (UPPER.r1 - UPPER.r0) * f, th, UPPER.y0 + (UPPER.y1 - UPPER.y0) * f + 0.2);
    const from = ell(UPPER.r1 + 0.3 + rnd() * 0.5, th + (rnd() - 0.5) * 0.3, 0.1);
    rFrom.set(from, i * 3);
    rTo.set(to, i * 3);
    rLife[i] = life;
    rSpeed[i] = 0.08 + rnd() * 0.1;
    rGlyph[i] = Math.floor(rnd() * NG);
    rSz[i] = 0.6 + rnd() * 0.5;
    rTint.set(rnd() < 0.7 ? [0.91, 0.78, 0.48] : [1, 0.95, 0.82], i * 3);
  };
  for (let i = 0; i < riseN; i++) seedRise(i, rnd());
  const riseGeo = keep(new BufferGeometry());
  riseGeo.setAttribute("position", new BufferAttribute(rPos, 3));
  riseGeo.setAttribute("tint", new BufferAttribute(rTint, 3));
  riseGeo.setAttribute("alpha", new BufferAttribute(rAlpha, 1));
  riseGeo.setAttribute("glyph", new BufferAttribute(rGlyph, 1));
  riseGeo.setAttribute("sz", new BufferAttribute(rSz, 1));
  const rising = new Points(riseGeo, keep(farGlyphs(24)));
  rising.frustumCulled = false;
  scene.add(rising);

  // ---- the nanites alive round the bowl (#987): streams orbiting the rims, the edges dissolving upward, a stream
  // round the field's boundary, motes in the floodlights, and sparks off a starter when his points go up. All but the
  // sparks move on the GPU from a clock (one draw each, no per-frame uploads); the clock stops under reduced motion.
  const NGf = NG.toFixed(1);
  const flowFrag = `uniform sampler2D atlas; varying vec2 vCell; varying vec3 vC; varying float vA;
    void main(){ if (vA < .01) discard; vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard; gl_FragColor = vec4(vC, m * vA); }`;
  /** A glyph stream: `a` and `d` carry each sigil's own numbers, `body` sets its place `p`, alpha `al` and size `sz`. */
  const flow = (n: number, size: number, fill: (i: number, a: Float32Array, d: Float32Array) => void, body: string) => {
    const a = new Float32Array(n * 4);
    const d = new Float32Array(n * 3);
    const gl = new Float32Array(n);
    const rn = new Float32Array(n);
    const tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      fill(i, a, d);
      gl[i] = Math.floor(rnd() * NG);
      rn[i] = rnd();
      tint.set(rnd() < 0.78 ? [0.91, 0.78, 0.48] : rnd() < 0.6 ? [1, 0.93, 0.76] : [0.79, 0.66, 0.36], i * 3);
    }
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("a", new BufferAttribute(a, 4));
    g.setAttribute("d", new BufferAttribute(d, 3));
    g.setAttribute("glyph", new BufferAttribute(gl, 1));
    g.setAttribute("rnd", new BufferAttribute(rn, 1));
    g.setAttribute("tint", new BufferAttribute(tint, 3));
    const pts = new Points(
      g,
      keep(
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { atlas: { value: atlas }, px, t: clock },
          vertexShader: `attribute vec4 a; attribute vec3 d, tint; attribute float glyph, rnd; uniform float t, px; varying vec2 vCell; varying vec3 vC; varying float vA;
            void main(){ vec3 p = vec3(0.); float al = 0.; float sz = 1.; ${body}
              float g = mod(glyph + floor(t * .5 + rnd * 9.), ${NGf}); vCell = vec2(mod(g, 8.), floor(g / 8.)); vC = tint;
              vec4 mv = modelViewMatrix * vec4(p, 1.); vA = al * smoothstep(5., 10., -mv.z);
              gl_PointSize = min(sz * ${size.toFixed(1)} * px * (6. / pow(-mv.z, .7)), 40. * px); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: flowFrag,
        }),
      ),
    );
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  };
  // Orbiting streams skimming the rake of each deck and a low ring round the apron, the bands turning opposite ways.
  const bands = [
    { r: [1.5, 1.9], y: [0.4, 1.5], v: 0.035, share: 0.42, over: UPPER },
    { r: [1, 1.42], y: [0.3, 1.2], v: -0.05, share: 0.38, over: LOWER },
    { r: [0.8, 0.97], y: [0.25, 1.3], v: 0.06, share: 0.2, over: null },
  ];
  flow(
    LITE ? 520 : 1700,
    26,
    (i, a) => {
      let u = rnd();
      const b = bands.find((x) => (u -= x.share) < 0) ?? bands[0]!;
      const r = b.r[0]! + rnd() * (b.r[1]! - b.r[0]!);
      // Over a tier the stream skims its rake: the seats' height at that radius, plus its lift.
      const t = b.over;
      const y = (t ? t.y0 + ((r - t.r0) / (t.r1 - t.r0)) * (t.y1 - t.y0) : 0) + b.y[0]! + rnd() * (b.y[1]! - b.y[0]!);
      a.set([rnd() * TAU, r, y, b.v * (0.6 + rnd() * 0.8)], i * 4);
    },
    `float th = a.x + t * a.w; p = vec3(sin(th) * a.y * ${SX.toFixed(2)}, a.z + sin(t * .7 + rnd * 20.) * .3, cos(th) * a.y * ${SZ.toFixed(2)});
     al = (.5 + .35 * sin(t * 2.1 + rnd * 40.)); sz = .55 + rnd * .55;`,
  );
  // The edges dissolving: sigils born on the rims (the same lines traced in gold) peel off upward and fade.
  {
    const segs = rims.length / 6;
    flow(
      LITE ? 380 : 1200,
      24,
      (i, a, d) => {
        const k = Math.floor(rnd() * segs) * 6;
        const f = rnd();
        const x = rims[k]! + (rims[k + 3]! - rims[k]!) * f;
        const y = rims[k + 1]! + (rims[k + 4]! - rims[k + 1]!) * f;
        const z = rims[k + 2]! + (rims[k + 5]! - rims[k + 2]!) * f;
        const r = Math.hypot(x, z) || 1;
        const out = y < 0.1 ? 0.25 : (rnd() - 0.35) * 0.6;
        a.set([x, y, z, 0.05 + rnd() * 0.07], i * 4);
        d.set([(x / r) * out + (rnd() - 0.5) * 0.25, 0.9 + rnd() * 1.6, (z / r) * out + (rnd() - 0.5) * 0.25], i * 3);
      },
      `float ph = fract(t * a.w + rnd * 7.31); p = a.xyz + d * ph * (1. + ph * .7);
       al = smoothstep(0., .1, ph) * (1. - smoothstep(.45, 1., ph)) * .95; sz = (.5 + rnd * .45) * (1. - ph * .4);`,
    );
  }
  // The field's own stream: sigils skimming round the boundary, two lanes the opposite way round.
  flow(
    LITE ? 260 : 760,
    28,
    (i, a) => {
      const lane = rnd() < 0.5 ? 0 : 1;
      a.set([rnd(), 0.08 + rnd() * 0.5, (lane ? 1 : -1) * (0.012 + rnd() * 0.012), 0.35 + lane * 0.45 + rnd() * 0.2], i * 4);
    },
    `float L = ${FL.toFixed(2)} + a.w * 2.; float W = ${FW.toFixed(3)} + a.w * 2.; float s = fract(a.x + t * a.z) * (L + W) * 2.; vec2 q;
     if (s < L) q = vec2(-L * .5 + s, W * .5); else if (s < L + W) q = vec2(L * .5, W * .5 - (s - L));
     else if (s < L * 2. + W) q = vec2(L * .5 - (s - L - W), -W * .5); else q = vec2(-L * .5, -W * .5 + (s - L * 2. - W));
     p = vec3(q.x, a.y + sin(t * 1.3 + rnd * 30.) * .06, q.y); al = .8 + .2 * sin(t * 2.6 + rnd * 50.); sz = .5 + rnd * .45;`,
  );
  // Motes: soft warm specks drifting up through the floodlights over the field.
  {
    const n = LITE ? 300 : 950;
    const base = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) base.set([(rnd() - 0.5) * (FL + 8), rnd() * 9, (rnd() - 0.5) * (FW + 7), rnd()], i * 4);
    const g = keep(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("a", new BufferAttribute(base, 4));
    const motes = new Points(
      g,
      keep(
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { px, t: clock },
          vertexShader: `attribute vec4 a; uniform float t, px; varying float vA; varying float vW;
            void main(){ float r = a.w; float y = mod(a.y + t * (.12 + r * .2), 9.) + .25;
              vec3 p = vec3(a.x + sin(t * .17 + r * 31.) * 1.2, y, a.z + cos(t * .13 + r * 17.) * .9);
              vec4 mv = modelViewMatrix * vec4(p, 1.); vW = r;
              vA = smoothstep(.25, 1.4, y) * (1. - smoothstep(7.2, 9.2, y)) * (.45 + .4 * sin(t * 1.9 + r * 60.)) * smoothstep(4., 9., -mv.z);
              gl_PointSize = min((2.4 + r * 3.6) * px * (30. / -mv.z), 14. * px); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `varying float vA; varying float vW; void main(){ vec2 q = gl_PointCoord - .5; float m = exp(-dot(q, q) * 22.); if (m * vA < .01) discard;
            gl_FragColor = vec4(mix(vec3(1., .94, .8), vec3(.91, .78, .48), vW), m * vA); }`,
        }),
      ),
    );
    motes.frustumCulled = false;
    scene.add(motes);
  }
  // A slow gold sweep across the turf, the glow of the scan over the field.
  {
    const sweep = new Mesh(
      keep(new PlaneGeometry(FL + 1.2, FW + 1.2)),
      keep(
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { t: clock },
          vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
          fragmentShader: `uniform float t; varying vec2 vU;
            void main(){ float s = fract(t * .045); float d = vU.x - (s * 1.4 - .2); float band = exp(-d * d * 260.);
              float edge = smoothstep(.04, 0., min(min(vU.x, 1. - vU.x), min(vU.y, 1. - vU.y)));
              gl_FragColor = vec4(.91, .78, .48, band * .07 + edge * (.08 + .05 * sin(t * 1.5))); }`,
        }),
      ),
    );
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.y = 0.04;
    scene.add(sweep);
  }
  // Sparks: a burst off a starter's pillar when his points go up in a live game (the board's own numbers, never made up).
  const SPK = reduce ? 0 : LITE ? 160 : 420;
  const sPos = new Float32Array(Math.max(1, SPK) * 3);
  const sVel = new Float32Array(Math.max(1, SPK) * 3);
  const sLife = new Float32Array(Math.max(1, SPK));
  const sAlpha = new Float32Array(Math.max(1, SPK));
  const sTint = new Float32Array(Math.max(1, SPK) * 3);
  const sGlyph = new Float32Array(Math.max(1, SPK));
  const sSz = new Float32Array(Math.max(1, SPK));
  const sparkGeo = keep(new BufferGeometry());
  sparkGeo.setAttribute("position", new BufferAttribute(sPos, 3));
  sparkGeo.setAttribute("alpha", new BufferAttribute(sAlpha, 1));
  sparkGeo.setAttribute("tint", new BufferAttribute(sTint, 3));
  sparkGeo.setAttribute("glyph", new BufferAttribute(sGlyph, 1));
  sparkGeo.setAttribute("sz", new BufferAttribute(sSz, 1));
  const sparks = new Points(sparkGeo, keep(farGlyphs(30)));
  sparks.frustumCulled = false;
  sparks.visible = false;
  scene.add(sparks);
  let sNext = 0;
  let sAlive = 0;
  const burst = (x: number, y: number, z: number, mine: boolean, n: number) => {
    if (!SPK) return;
    const c = mine ? [0.91, 0.78, 0.48] : [0.75, 0.79, 0.86];
    for (let k = 0; k < n; k++) {
      const i = sNext;
      sNext = (sNext + 1) % SPK;
      const a = rnd() * TAU;
      const up = 1.6 + rnd() * 2.6;
      const out = 0.6 + rnd() * 1.6;
      sPos.set([x, y, z], i * 3);
      sVel.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      sLife[i] = 1;
      sTint.set(rnd() < 0.25 ? [1, 0.95, 0.84] : c, i * 3);
      sGlyph[i] = Math.floor(rnd() * NG);
      sSz[i] = 0.6 + rnd() * 0.6;
    }
    sAlive = 1.6;
    sparks.visible = true;
    sparkGeo.attributes.tint!.needsUpdate = true;
    sparkGeo.attributes.glyph!.needsUpdate = true;
    sparkGeo.attributes.sz!.needsUpdate = true;
  };
  const stepSparks = (dt: number) => {
    if (sAlive <= 0) return;
    sAlive -= dt;
    for (let i = 0; i < SPK; i++) {
      if (sLife[i]! <= 0) {
        sAlpha[i] = 0;
        continue;
      }
      const i3 = i * 3;
      sLife[i] = Math.max(0, sLife[i]! - dt * 0.75);
      sVel[i3 + 1] = sVel[i3 + 1]! - dt * 2.4;
      sPos[i3] = sPos[i3]! + sVel[i3]! * dt;
      sPos[i3 + 1] = Math.max(0.05, sPos[i3 + 1]! + sVel[i3 + 1]! * dt);
      sPos[i3 + 2] = sPos[i3 + 2]! + sVel[i3 + 2]! * dt;
      sAlpha[i] = Math.min(1, sLife[i]! * 1.6) * 0.95;
    }
    sparkGeo.attributes.position!.needsUpdate = true;
    sparkGeo.attributes.alpha!.needsUpdate = true;
    if (sAlive <= 0) sparks.visible = false;
  };

  // ---- the frame's edges come undone: the stands, the ground and the field turn to gold wire and code --------------
  let stepUndone: ((t: number, r: WebGLRenderer) => void) | null = null;
  {
    const wire: number[] = [...skin, ...rims];
    // The field's lines, lifted a touch: every ten yards and the sidelines.
    for (let yd = 0; yd <= 100; yd += 10) {
      const x = fieldX((10 + yd) / 120);
      wire.push(x, 0.03, -FW / 2, x, 0.03, FW / 2);
    }
    wire.push(-FL / 2, 0.03, -FW / 2, FL / 2, 0.03, -FW / 2, -FL / 2, 0.03, FW / 2, FL / 2, 0.03, FW / 2);
    // The ground outside the bowl: rings and spokes out into the dark.
    for (let r = UPPER.r1 + 0.2; r < 4.4; r += 0.32) for (let i = 0; i < 96; i++) wire.push(...ell(r, (i / 96) * TAU, 0.03), ...ell(r, ((i + 1) / 96) * TAU, 0.03));
    for (let i = 0; i < 64; i++) wire.push(...ell(UPPER.r1 + 0.1, (i / 64) * TAU, 0.03), ...ell(4.4, (i / 64) * TAU, 0.03));
    const ND = LITE ? 600 : 2000;
    const dust = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) {
      const th = rnd() * TAU;
      if (rnd() < 0.45) {
        const f = rnd();
        const t = rnd() < 0.5 ? LOWER : UPPER;
        dust.set(ell(t.r0 + (t.r1 - t.r0) * f, th, t.y0 + (t.y1 - t.y0) * f + 0.3), i * 3);
      } else dust.set(ell(UPPER.r1 + 0.2 + rnd() * 2.2, th, 0.06), i * 3);
    }
    const undone = comeUndone({
      wire,
      dust,
      atlas,
      px,
      peel: LITE ? 200 : 700,
      keep,
      drift: (x, y, z) => {
        const r = Math.hypot(x, z) || 1;
        if (y < 0.1) return [(rnd() - 0.5) * 0.3, 0.6 + rnd() * 0.8, (rnd() - 0.5) * 0.3];
        return [(-x / r) * (0.3 + rnd() * 0.5), 0.3 + rnd() * 0.6, (-z / r) * (0.3 + rnd() * 0.5)];
      },
    });
    undone.addTo(scene);
    stepUndone = undone.step;
  }

  // ---- sizing, the camera, the keys and the drag --------------------------------------------------------------------
  const phone = () => host.clientWidth < PHONE_W;
  const size = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < PHONE_W ? 52 : 38;
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
  // WASD swivels the view round the field within a set arc (a locked swivel, not free roam): A/D and the arrows orbit,
  // W/S dolly in and out within tight bounds, both resisted past the soft edge and eased back inside it when the keys
  // let go; Escape snaps home. Ignored while typing (the shared helper's rules). Dragging swivels the same arc.
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: 0, cz: 0, r: 1 }),
    origin: () => [0, 0],
    forward: () => [-cam.position.x, -cam.position.z],
    orbit: {
      turn: (r) => (yawTo = swing(yawTo, r, ARC)),
      zoom: (a) => (zoomTo = 1 + swing(zoomTo - 1, -a * 0.3, ZOOM_ARC)),
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  let down = false;
  let lastX = 0;
  const onDown = (e: PointerEvent) => {
    down = true;
    lastX = e.clientX;
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    yawTo = swing(yawTo, -(e.clientX - lastX) * 0.005, ARC);
    lastX = e.clientX;
  };
  const onUp = () => (down = false);
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  cv.addEventListener("pointerleave", onUp);

  // ---- the state: men to pillars, the ball, the boards --------------------------------------------------------------
  /** What each starter had banked when last seen, so a rise in a live game throws sparks off his pillar. */
  const seen = new Map<string, number>();
  const apply = (snap: boolean) => {
    if (!snap && view.live) {
      for (const m of view.men.slice(0, MAX_MEN)) {
        const was = seen.get(m.id);
        if (was !== undefined && m.banked > was + 0.05) burst(fieldX(m.along), Math.max(0.3, height(m.banked)) + 0.2, fieldZ(m.across), m.mine, LITE ? 28 : 64);
      }
    }
    seen.clear();
    for (const m of view.men) seen.set(m.id, m.banked);
    repaintField();
    repaintRibbon();
    repaintBoard();
    const men = view.men.slice(0, MAX_MEN);
    pillars.forEach((p, i) => {
      const m = men[i] ?? null;
      p.man = m;
      p.g.visible = !!m;
      if (!m) return;
      dress(p, m);
      if (snap) {
        p.hb = height(m.banked);
        p.hp = height(m.proj);
      }
    });
    const hasLine = view.win !== null && !!view.them;
    los.visible = losGlow.visible = hasLine;
    ball.visible = !!view.me;
    if (snap) ballX = fieldX(view.ball);
  };
  apply(true);

  const placed = new Map<string, string>();
  const tmp = new Vector3();
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
  const hide = (id: string) => {
    if (placed.get(id) === "off") return;
    placed.set(id, "off");
    opts.onPlace(id, 0, 0, false);
  };
  const tA = new Vector3();
  let T = 0;

  const draw = (dt: number) => {
    if (!reduce) T += dt;
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 3);
    // The pillars grow toward their numbers.
    for (const p of pillars) {
      const m = p.man;
      if (!m) continue;
      p.hb += (height(m.banked) - p.hb) * ek;
      p.hp += (height(m.proj) - p.hp) * ek;
      const b = Math.max(0.001, p.hb);
      const rest = Math.max(0.001, p.hp - p.hb);
      p.core.scale.y = b;
      p.core.visible = p.hb > 0.02;
      p.wire.position.y = p.hb;
      p.wire.scale.y = rest;
      p.wire.visible = p.hp - p.hb > 0.02;
      const top = Math.max(p.hb, p.hp);
      p.cap.position.y = top + 0.18 + (reduce ? 0 : Math.sin(T * 1.6 + p.g.position.x) * 0.04);
      p.cap.rotation.y = T * 0.8;
    }
    // The ball rolls to the line of the win chance.
    ballX += (fieldX(view.ball) - ballX) * ek;
    ball.position.x = ballX;
    los.position.x = ballX;
    losGlow.position.x = ballX;
    // The ribbon scrolls.
    if (!reduce) ribbonTex.offset.x = (T * 0.012) % 1;
    raisedLines.material.opacity = 0.45 + (reduce ? 0 : 0.15 * Math.sin(T * 1.3));
    // The crowd: your end brightens with your chance, theirs with theirs.
    const w = view.win ?? 0.5;
    for (let i = 0; i < crowdN; i++) {
      const lift = cEnd[i]! < 0 ? 0.55 + w * 0.7 : cEnd[i]! > 0 ? 0.55 + (1 - w) * 0.7 : 0.9;
      cAlpha[i] = cBase[i]! * lift * (0.65 + 0.35 * Math.sin(T * 1.4 + cPh[i]!));
    }
    crowdGeo.attributes.alpha!.needsUpdate = true;
    // The section going up: nanites stream off the ground into their seats, and settle.
    for (let i = 0; i < riseN; i++) {
      let l = rLife[i]! + (reduce ? 0 : dt * rSpeed[i]!);
      if (l >= 1) {
        seedRise(i, 0);
        l = 0;
      }
      rLife[i] = l;
      const k = clamp(l / 0.75);
      const e = 1 - Math.pow(1 - k, 3);
      const i3 = i * 3;
      const arc = Math.sin(k * Math.PI) * 1.4;
      rPos[i3] = rFrom[i3]! + (rTo[i3]! - rFrom[i3]!) * e;
      rPos[i3 + 1] = rFrom[i3 + 1]! + (rTo[i3 + 1]! - rFrom[i3 + 1]!) * e + arc;
      rPos[i3 + 2] = rFrom[i3 + 2]! + (rTo[i3 + 2]! - rFrom[i3 + 2]!) * e;
      rAlpha[i] = Math.min(1, l * 8) * (1 - clamp((l - 0.8) / 0.2)) * 0.8;
    }
    riseGeo.attributes.position!.needsUpdate = true;
    riseGeo.attributes.alpha!.needsUpdate = true;
    // The camera: high on the sideline (behind your end zone on a phone), swivelled within its arc.
    pan.step(dt);
    if (!pan.busy && !down) {
      if (Math.abs(yawTo) > ARC * SOFT) yawTo = damp(yawTo, Math.sign(yawTo) * ARC * SOFT, 4, dt);
      if (Math.abs(zoomTo - 1) > ZOOM_ARC * SOFT) zoomTo = damp(zoomTo, 1 + Math.sign(zoomTo - 1) * ZOOM_ARC * SOFT, 4, dt);
    }
    const ck = reduce ? 1 : 1 - Math.exp(-dt * 4);
    yaw += (yawTo - yaw) * ck;
    zoom += (zoomTo - zoom) * ck;
    const ph = phone();
    const home = ph ? -Math.PI / 2 : 0;
    const th = home + yaw + (reduce ? 0 : Math.sin(T * 0.05) * 0.06);
    const D = (ph ? (cam.aspect < 0.7 ? 33 : 29) : 24) * zoom;
    const camY = (ph ? 18 : 11) * (0.65 + 0.35 * zoom);
    cam.position.set(Math.sin(th) * D, camY, Math.cos(th) * D);
    const lk = ph ? 3 : 1;
    cam.lookAt(Math.sin(th) * -lk, ph ? 1.2 : 3, Math.cos(th) * -lk);
    sky.position.copy(cam.position);
    clock.value = T;
    stepSparks(dt);
    stepUndone?.(T, renderer);
    renderer.render(scene, cam);
    // The anchors: each starter's pillar top, and the ball.
    for (const p of pillars) {
      if (!p.man) continue;
      report(p.man.id, p.g.localToWorld(tA.set(0, Math.max(p.hb, p.hp) + 0.42, 0)));
    }
    for (const id of placed.keys()) if (id !== "ball" && !view.men.some((m) => m.id === id)) hide(id);
    if (ball.visible) report("ball", tA.set(ballX, 0.5, 0));
    else hide("ball");
  };

  // ---- the loop -------------------------------------------------------------------------------------------------------
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
      apply(false);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      pan.dispose();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onUp);
      window.removeEventListener("pointerup", onUp);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
