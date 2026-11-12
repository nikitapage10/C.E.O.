import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  LatheGeometry,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SpotLight,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  WireframeGeometry,
  type Material,
  type Object3D,
} from "three";
import { SIGILS } from "@ceo/engine/sigils/sigils.ts";
import { goldVault } from "@ceo/engine/sigils/vault.ts";
import { edgeFactor, isTyping, SOFT, wasdPan, type Typable } from "@ceo/engine/web/wasdPan.ts";
import { LAYER_MM, PAWN, slice, STAGES, type FlowView, type Stage } from "./flow.ts";
import { dprGuard, sceneDpr } from "@ceo/engine/web/phone.ts";

/**
 * The Workshop's flow in 3D (#989): one long walnut bench and Nikita's four stages along it, left to right, joined by a
 * gold line inlaid in the bench's edge. 1, the easel: a standing screen where the design (an image made in ChatGPT)
 * shows. 2, the mould: a plinth with an empty gold cage where the image becomes a mesh (Meshy). 3, the slicer: a build
 * plate where the model is stood, checked and cut into layers, its layer preview running up and down the piece. 4, the
 * one Bambu Lab printer, its chamber lit. Solid and lit in the middle of the frame, overlaid with gold wire and sigil
 * nanites, and coming undone into wire, grid and code toward the frame's edges the way the Senate's chamber does
 * (apps/desk/src/rotunda/rotundaScene.ts, #856, #878), inside the gold vault (#932).
 *
 * What it shows is only what's true (flow.ts): the easel is blank, the cage is empty with nanites settling on its wires,
 * the slicer holds the Workshop's own check piece (a 40 mm pawn) and its real 0.2 mm layers, and the printer waits with
 * its plate empty and its head parked. Pick a station (or its tag) and the camera steps up to it. Phones get fewer
 * particles and 30 frames a second; reduced motion holds the room nearly still. WASD swivels the camera round what it
 * looks at (the shared wasdPan helper's orbit mode): A/D within a set arc, W/S in and out within tight bounds, soft edges
 * that ease back, Home or Escape for the composed view; ignored while typing, Space left to hold-to-talk. Lazy loaded
 * with three.js, never in the Desk's first load. Replaces the print farm (#827, #983).
 */

export interface FlowOpts {
  phone: boolean;
  reduce: boolean;
  /** A station was picked in the scene. */
  onPick: (v: FlowView) => void;
  /** Where each tag's anchor ("stage-1".."stage-4") is in the host's CSS pixels, every frame it moves. */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
  /** The first frame is drawn. */
  onReady: () => void;
  /** The share of the frame's height, from the top, that the page's head sits over: the flow is fitted below it. */
  headroom?: () => number;
}

export interface Flow {
  setView(v: FlowView): void;
  dispose(): void;
}

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const GOLD = new Color(0xc9a85c);
const GOLD_HI = new Color(0xe8c77a);
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** The bench's top, its depth line, and where each station stands along it. */
const TOP = 0.8;
const BENCH_Z = -0.6;
const STAGE_X = (n: number) => (n - 2.5) * 2.3;
/** The flow line, inlaid along the bench's front edge. */
const LINE_Z = BENCH_Z + 0.62;
/** The check piece's scale on the slicer's plate: 40 mm stands about 0.6 units tall. */
const MM = 0.015;
/** How tall over the bench each station's tag rides. */
const TAG_Y = [1.38, 1.02, 0.98, 1.3];
const GLYPHS = SIGILS.filter((g) => g.length === 1).slice(0, 64);

interface Pose {
  pos: Vector3;
  look: Vector3;
  fov: number;
}

export async function createFlow(host: HTMLElement, canvas: HTMLCanvasElement, opts: FlowOpts): Promise<Flow> {
  const { phone: PH, reduce } = opts;
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(sceneDpr()); // 2x on a phone, stepped down while frames run slow (#1070)
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = !PH;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(0x07080d);
  scene.fog = new FogExp2(0x0a0b12, 0.045);
  const cam = new PerspectiveCamera(36, 1, 0.03, 80);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);


  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0xa8b0d0, 0x101016, 1.1));
  const key = new DirectionalLight(0xfff1dc, 2.1);
  key.position.set(-3.5, 7, 5);
  key.castShadow = !PH;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -6.5, right: 6.5, top: 4, bottom: -3, near: 1, far: 20 });
  scene.add(key);
  const rim = new DirectionalLight(0x8fa6ff, 0.45);
  rim.position.set(4, 3, -4);
  scene.add(rim);
  // A warm spot on the slicer's plate, where the one real piece stands.
  const sliceSpot = new SpotLight(0xffe2b0, 26, 7, 0.4, 0.6, 1.4);
  sliceSpot.position.set(STAGE_X(3) + 0.4, 4.2, BENCH_Z + 2.2);
  sliceSpot.target.position.set(STAGE_X(3), TOP, BENCH_Z);
  scene.add(sliceSpot, sliceSpot.target);

  // ---- the room: a dark floor and back wall (their grid comes undone at the frame's edges, below) ------------------
  const floor = new Mesh(keep(new PlaneGeometry(40, 30)), keep(new MeshStandardMaterial({ color: 0x0c0d13, roughness: 0.5, metalness: 0.35 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 4;
  floor.receiveShadow = true;
  scene.add(floor);
  // A low back partition, not a wall to the ceiling: over it the gold vault (below) runs off into the depth (#932).
  const wall = new Mesh(keep(new PlaneGeometry(40, 3.4)), keep(new MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.8, metalness: 0.1 })));
  wall.position.set(0, 1.7, -2.2);
  wall.receiveShadow = true;
  scene.add(wall);


  // ---- the bench: one long walnut top, the flow line inlaid along its front edge -----------------------------------
  const steel = keep(new MeshStandardMaterial({ color: 0x1b1c24, metalness: 0.7, roughness: 0.32 }));
  const walnut = keep(new MeshStandardMaterial({ color: 0x2a1d16, metalness: 0.1, roughness: 0.55 }));
  const goldMat = keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.75 }));
  const solid = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D = scene) => {
    const m = new Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = !PH;
    parent.add(m);
    return m;
  };
  const W = 10.2;
  solid(new BoxGeometry(W, 0.08, 1.4), walnut, 0, TOP - 0.04, BENCH_Z);
  solid(new BoxGeometry(W, 0.012, 0.012), goldMat, 0, TOP - 0.02, BENCH_Z + 0.706);
  solid(new BoxGeometry(W - 0.2, 0.05, 1.25), steel, 0, 0.22, BENCH_Z);
  for (const x of [-W / 2 + 0.1, -1.15, 1.15, W / 2 - 0.1]) for (const z of [BENCH_Z - 0.62, BENCH_Z + 0.62]) solid(new BoxGeometry(0.07, TOP - 0.08, 0.07), steel, x, (TOP - 0.08) / 2, z);
  // Filament on the lower shelf under the printer: spools, standing on edge (props; nothing is loaded or printing).
  const spoolCols = [0xd8d2c4, 0x2b2d36, 0xc9a85c, 0x6a8fb0];
  const spoolMats = spoolCols.map((c) => keep(new MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 })));
  const reel = keep(new CylinderGeometry(0.17, 0.17, 0.02, 32));
  const wind = keep(new CylinderGeometry(0.14, 0.14, 0.09, 32));
  spoolCols.forEach((_, i) => {
    const g = new Group();
    g.position.set(STAGE_X(4) - 0.85 + i * 0.55, 0.42, BENCH_Z - 0.1);
    g.rotation.z = Math.PI / 2;
    const w = new Mesh(wind, spoolMats[i]!);
    const a = new Mesh(reel, steel);
    a.position.y = 0.055;
    const b = new Mesh(reel, steel);
    b.position.y = -0.055;
    for (const m of [w, a, b]) {
      m.castShadow = !PH;
      g.add(m);
    }
    scene.add(g);
  });
  // The flow line: a gold inlay from the first station to the last, a chevron in each gap pointing on to the next.
  const x0 = STAGE_X(1) - 0.7, x1 = STAGE_X(4) + 0.7;
  solid(new BoxGeometry(x1 - x0, 0.006, 0.022), goldMat, (x0 + x1) / 2, TOP + 0.003, LINE_Z);
  const chev = keep(new CylinderGeometry(0.075, 0.075, 0.006, 3));
  for (let n = 1; n < 4; n++) {
    const mx = (STAGE_X(n) + STAGE_X(n + 1)) / 2;
    for (const dx of [-0.2, 0, 0.2]) {
      const c = new Mesh(chev, goldMat);
      c.position.set(mx + dx, TOP + 0.004, LINE_Z);
      c.rotation.y = Math.PI / 2;
      scene.add(c);
    }
  }
  // Each station's stop on the line: a small gold ring flat on the bench.
  const stop = keep(new TorusGeometry(0.06, 0.006, 6, 32));
  for (let n = 1; n <= 4; n++) {
    const r = new Mesh(stop, goldMat);
    r.position.set(STAGE_X(n), TOP + 0.004, LINE_Z);
    r.rotation.x = Math.PI / 2;
    scene.add(r);
  }

  // ---- the wire: one gold line material per station (and one for the room's props), brighter toward the frame's edges --
  const edgeU = { t: { value: 0 }, res: { value: new Vector2(1, 1) }, atlas: { value: null as CanvasTexture | null }, px: { value: renderer.getPixelRatio() } };
  // 0 in the middle of the frame, 1 at the corners (a touch wider than tall, so the sides go before the top).
  const EDGE = `uniform vec2 res; float edgeOf(){ vec2 q = gl_FragCoord.xy / res * 2. - 1.; return length(q * vec2(.84, 1.)) / 1.31; }
    float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`;
  const wireMat = (base: number) =>
    keep(
      new ShaderMaterial({
        uniforms: { ...edgeU, base: { value: base }, hot: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float t, base, hot; varying vec3 vW; ${EDGE}
          void main(){ float e = smoothstep(.35, .95, edgeOf());
            vec3 cell = floor(vW * 9.); float h = hash(cell + floor(t * .6 + hash(cell) * 4.));
            if (h < e * .3) discard;
            float fl = .8 + .2 * sin(t * 2.6 + h * 30.);
            gl_FragColor = vec4(mix(vec3(.79, .66, .36), vec3(.95, .85, .6), hot) * fl, min(1., base + hot * .35 + e * .55)); }`,
      }),
    );
  const overlay = (mesh: Mesh, mat: ShaderMaterial, angle = 25) => {
    const l = new LineSegments(keep(new EdgesGeometry(mesh.geometry, angle)), mat);
    l.renderOrder = 5;
    mesh.add(l);
    return l;
  };
  const propWire = wireMat(0.1);
  scene.traverse((o) => {
    if (o instanceof Mesh && o !== floor && o !== wall) overlay(o, propWire);
  });


  // ---- the stations ---------------------------------------------------------------------------------------------------
  interface Station {
    stage: Stage;
    g: Group;
    wire: ShaderMaterial;
    hit: Mesh;
  }
  const hitMat = keep(new MeshBasicMaterial({ visible: false }));
  const stations: Station[] = STAGES.map((stage) => {
    const g = new Group();
    g.position.set(STAGE_X(stage.n), TOP, BENCH_Z);
    scene.add(g);
    const hit = new Mesh(keep(new BoxGeometry(1.25, 1.35, 1.2)), hitMat);
    hit.position.set(0, 0.65, 0);
    hit.userData.view = { k: "stage", n: stage.n } satisfies FlowView;
    g.add(hit);
    return { stage, g, wire: wireMat(0.14), hit };
  });
  const [s1, s2, s3, s4] = stations as [Station, Station, Station, Station];
  const part = (st: Station, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Object3D = st.g) => {
    const m = solid(geo, mat, x, y, z, parent);
    overlay(m, st.wire);
    return m;
  };
  const body = keep(new MeshStandardMaterial({ color: 0x2a2c36, metalness: 0.55, roughness: 0.36 }));
  const trim = keep(new MeshStandardMaterial({ color: 0x2b2c35, metalness: 0.8, roughness: 0.25 }));
  const rodMat = keep(new MeshStandardMaterial({ color: 0x9aa0ad, metalness: 0.9, roughness: 0.2 }));
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  };

  // 1. The easel: a standing screen where the design shows. Nothing has been designed for it yet, so it is blank: a
  // fine gold rule, the crop marks of an empty frame and its one line, "no design yet".
  const easelTex = canvasTex(512, 328, (g) => {
    g.fillStyle = "#17140e";
    g.fillRect(0, 0, 512, 328);
    g.strokeStyle = "rgba(201,168,92,.12)";
    g.lineWidth = 1;
    for (let k = 16; k < 512; k += 32) {
      g.beginPath();
      g.moveTo(k + 0.5, 0);
      g.lineTo(k + 0.5, 328);
      g.stroke();
    }
    for (let k = 4; k < 328; k += 32) {
      g.beginPath();
      g.moveTo(0, k + 0.5);
      g.lineTo(512, k + 0.5);
      g.stroke();
    }
    g.setLineDash([6, 6]);
    g.strokeStyle = "rgba(232,199,122,.55)";
    g.strokeRect(150.5, 60.5, 211, 207);
    g.setLineDash([]);
    g.strokeStyle = "rgba(232,199,122,.85)";
    g.lineWidth = 2;
    for (const [x, y, dx, dy] of [[150, 60, 1, 1], [362, 60, -1, 1], [150, 268, 1, -1], [362, 268, -1, -1]] as const) {
      g.beginPath();
      g.moveTo(x + dx * 18, y);
      g.lineTo(x, y);
      g.lineTo(x, y + dy * 18);
      g.stroke();
    }
    g.fillStyle = "rgba(240,214,150,.9)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '600 19px "Geist Mono Variable", ui-monospace, monospace';
    g.fillText("NO DESIGN YET", 256, 164);
    g.strokeStyle = "rgba(232,199,122,.7)";
    g.lineWidth = 1;
    g.strokeRect(8.5, 8.5, 495, 311);
  });
  part(s1, new BoxGeometry(0.42, 0.03, 0.26), trim, 0, 0.015, -0.1);
  part(s1, new BoxGeometry(0.05, 0.48, 0.04), trim, 0, 0.26, -0.12);
  const board = new Group();
  board.position.set(0, 0.84, -0.12);
  board.rotation.x = -0.12;
  s1.g.add(board);
  part(s1, new BoxGeometry(1.12, 0.74, 0.045), body, 0, 0, 0, board);
  const face = new Mesh(keep(new PlaneGeometry(1.04, 0.666)), keep(new MeshBasicMaterial({ map: easelTex, toneMapped: false })));
  face.position.z = 0.024;
  board.add(face);
  // The screen's own glow on the bench in front of it.
  const glow = new PointLight(0xffe2b0, 1.4, 2.4, 1.4);
  glow.position.set(0, 0.8, 0.5);
  s1.g.add(glow);
  // A thin gold lip under the screen, where a printed design would be pinned.
  solid(new BoxGeometry(1.0, 0.012, 0.03), goldMat, 0, -0.39, 0.03, board);

  // 2. The mould: a hex plinth and an empty gold cage over it, the size of a model, waiting on one. A scan ring rests
  // at its foot; nanites settle on its wires and fade, nothing gathers into a shape.
  part(s2, new CylinderGeometry(0.38, 0.42, 0.1, 6), trim, 0, 0.05, 0);
  solid(new TorusGeometry(0.36, 0.006, 6, 6), goldMat, 0, 0.102, 0, s2.g).rotation.x = Math.PI / 2;
  const CAGE = { w: 0.58, h: 0.7, y: 0.11 };
  const cageMat = wireMat(0.42);
  const cage = new LineSegments(keep(new EdgesGeometry(keep(new BoxGeometry(CAGE.w, CAGE.h, CAGE.w)))), cageMat);
  cage.position.y = CAGE.y + CAGE.h / 2;
  cage.renderOrder = 5;
  s2.g.add(cage);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) part(s2, new CylinderGeometry(0.008, 0.008, CAGE.h, 6), rodMat, (x * CAGE.w) / 2, CAGE.y + CAGE.h / 2, (z * CAGE.w) / 2);
  const restMat = keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false }));
  const rest = new Mesh(keep(new TorusGeometry(0.3, 0.004, 6, 96)), restMat);
  rest.rotation.x = Math.PI / 2;
  rest.position.y = CAGE.y + 0.03;
  s2.g.add(rest);
  // The cage's corners and edges, in the scene's frame, for the nanites that settle on it.
  const cageAt: number[] = [];
  {
    const p = (cage.geometry as BufferGeometry).attributes.position!.array as ArrayLike<number>;
    for (let k = 0; k < p.length; k += 3) cageAt.push(s2.g.position.x + p[k]!, s2.g.position.y + cage.position.y + p[k + 1]!, s2.g.position.z + p[k + 2]!);
  }

  // 3. The slicer: a build plate on a steel block, turning slowly as the piece is oriented, with the Workshop's check
  // piece on it, its 0.2 mm layers drawn as gold rings, the layer preview running up and down it, and its bounding box.
  const plateTex = canvasTex(256, 256, (g) => {
    g.fillStyle = "#15140f";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(201,168,92,${Math.random() * 0.08})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.2, 1.2);
    }
    g.strokeStyle = "rgba(201,168,92,.28)";
    g.lineWidth = 1;
    for (let k = 0; k <= 256; k += 32) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, 256);
      g.moveTo(0, k);
      g.lineTo(256, k);
      g.stroke();
    }
    g.strokeStyle = "rgba(232,199,122,.7)";
    g.strokeRect(6, 6, 244, 244);
  });
  const plateMat = keep(new MeshStandardMaterial({ map: plateTex, metalness: 0.5, roughness: 0.4 }));
  part(s3, new BoxGeometry(0.98, 0.07, 0.98), trim, 0, 0.035, 0);
  const spin = new Group();
  spin.position.y = 0.07;
  s3.g.add(spin);
  part(s3, new BoxGeometry(0.86, 0.02, 0.86), plateMat, 0, 0.01, 0, spin);
  const profile = PAWN.map(([r, y]) => new Vector2(r * MM, y * MM));
  const pawnMat = keep(new MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.55, metalness: 0.02, transparent: true, opacity: 0.82 }));
  const pawn = solid(new LatheGeometry(profile, 64), pawnMat, 0, 0.02, 0, spin);
  const pawnWire = new LineSegments(keep(new WireframeGeometry(keep(new LatheGeometry(profile, 14)))), wireMat(0.12));
  pawnWire.scale.setScalar(1.004);
  pawn.add(pawnWire);
  const cut = slice(PAWN);
  const pawnH = cut.layers * LAYER_MM * MM;
  const pawnR = Math.max(...PAWN.map(([r]) => r)) * MM;
  // Every few layers drawn (all of them would be a solid gold blur at this size); each ring at its own radius.
  const EVERY = 5;
  const rings: number[] = [];
  const SEG = 40;
  for (let i = 0; i < cut.layers; i += EVERY) {
    const r = cut.rings[i]! * MM * 1.03 + 0.002;
    const y = (i + 0.5) * LAYER_MM * MM;
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * Math.PI * 2, a1 = ((k + 1) / SEG) * Math.PI * 2;
      rings.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
    }
  }
  const ringGeo = keep(new BufferGeometry());
  ringGeo.setAttribute("position", new BufferAttribute(new Float32Array(rings), 3));
  const layerU = { cut: { value: 0 }, top: { value: pawnH } };
  const layers = new LineSegments(
    ringGeo,
    keep(
      new ShaderMaterial({
        uniforms: layerU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float cut, top; varying float vY;
          void main(){ float below = step(vY, cut); float near = 1. - smoothstep(0., top * .08, abs(vY - cut));
            gl_FragColor = vec4(mix(vec3(.79, .66, .36), vec3(1., .92, .7), near), .12 + below * .5 + near * .4); }`,
      }),
    ),
  );
  layers.position.y = 0.02;
  layers.renderOrder = 6;
  spin.add(layers);
  const scanMat = keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
  const scan = new Mesh(keep(new TorusGeometry(pawnR + 0.06, 0.004, 6, 96)), scanMat);
  scan.rotation.x = Math.PI / 2;
  s3.g.add(scan);
  const box = new LineSegments(keep(new EdgesGeometry(keep(new BoxGeometry(pawnR * 2 + 0.04, pawnH + 0.02, pawnR * 2 + 0.04)))), wireMat(0.3));
  box.position.y = 0.09 + pawnH / 2;
  s3.g.add(box);

  // 4. The printer: the one Bambu Lab, its chamber lit, the plate empty and the head parked at the back left.
  {
    const g = s4.g;
    const glass = keep(new MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.13, depthWrite: false }));
    const smoke = keep(new MeshStandardMaterial({ color: 0x0d0f15, metalness: 0.3, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }));
    const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => part(s4, geo, mat, x, y, z);
    add(new BoxGeometry(1, 0.16, 1), body, 0, 0.08, 0);
    add(new BoxGeometry(1, 0.07, 1), body, 0, 1.075, 0);
    for (const [x, z] of [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]] as const) add(new BoxGeometry(0.06, 0.9, 0.06), trim, x, 0.6, z);
    add(new BoxGeometry(0.88, 0.9, 0.025), body, 0, 0.6, -0.48);
    const pane = (w: number, h: number, mat: Material, x: number, y: number, z: number, rx: number, ry: number) => {
      const m = new Mesh(keep(new PlaneGeometry(w, h)), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      g.add(m);
    };
    for (const x of [-0.49, 0.49]) pane(0.9, 0.9, smoke, x, 0.6, 0, 0, Math.PI / 2);
    pane(0.88, 0.88, glass, 0, 0.6, 0.495, 0, 0);
    pane(0.88, 0.88, glass, 0, 1.112, 0, -Math.PI / 2, 0);
    add(new BoxGeometry(0.02, 0.3, 0.03), trim, 0.38, 0.6, 0.51);
    pane(0.2, 0.09, keep(new MeshBasicMaterial({ color: 0x5a4a28 })), -0.3, 0.085, 0.502, 0, 0);
    add(new BoxGeometry(0.78, 0.02, 0.78), keep(new MeshStandardMaterial({ map: plateTex, metalness: 0.5, roughness: 0.4 })), 0, 0.21, 0.02);
    add(new BoxGeometry(0.82, 0.04, 0.82), trim, 0, 0.18, 0.02);
    for (const x of [-0.41, 0.41]) add(new CylinderGeometry(0.012, 0.012, 0.86, 10), rodMat, x, 0.98, 0).rotation.x = Math.PI / 2;
    add(new BoxGeometry(0.86, 0.035, 0.05), trim, 0, 0.98, -0.3);
    const head = add(new BoxGeometry(0.13, 0.15, 0.12), body, -0.3, 0.9, -0.27);
    const nozzle = solid(new CylinderGeometry(0.004, 0.018, 0.04, 10), rodMat, 0, -0.095, 0, head);
    overlay(nozzle, s4.wire);
    add(new CylinderGeometry(0.16, 0.16, 0.08, 32), keep(new MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6 })), 0.56, 0.75, -0.2).rotation.z = Math.PI / 2;
    const lamp = new PointLight(0xffe7c0, 3.2, 2.2, 1.2);
    lamp.position.set(0, 0.95, 0.3);
    g.add(lamp);
    solid(new BoxGeometry(0.6, 0.01, 0.02), keep(new MeshBasicMaterial({ color: 0xffd99a })), 0, 1.03, 0.42, g);
  }

  // ---- nanites --------------------------------------------------------------------------------------------------------
  try {
    await Promise.all(['40px "Noto Sans Runic"', '40px "Noto Sans Symbols"', '40px "Noto Sans Symbols 2"'].map((f) => document.fonts.load(f)));
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
    g.font = `40px "Noto Sans Runic","Noto Sans Symbols","Noto Sans Symbols 2","Geist Mono Variable",monospace`;
    GLYPHS.forEach((ch, i) => g.fillText(ch, (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34));
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  edgeU.atlas.value = atlas;
  // ---- the vault behind the bench (#932): a gold grid and sigil nanites drifting up, fading into the depth -------------
  const vault = goldVault({ atlas, px: edgeU.px, keep, radius: 60, center: [0, 1.5, -2], shell: [9, 40], count: PH ? 220 : 700, lines: [64, 24], horizon: 0.47, base: [0.026, 0.026, 0.034] });
  scene.add(vault.group);
  const NG = GLYPHS.length;
  // Drifters in the air; a few settling on the empty cage's wires; a stream off the slicer's preview ring; and a slow
  // drift along the flow line, the way the work will go once it moves.
  const NA = PH ? 80 : 240;
  const NB = PH ? 30 : 80;
  const NT = PH ? 24 : 60;
  const NF = PH ? 20 : 56;
  const NN = NA + NB + NT + NF;
  const np = new Float32Array(NN * 3);
  const na = new Float32Array(NN);
  const ngl = new Float32Array(NN);
  const nsz = new Float32Array(NN);
  const seed = Float32Array.from({ length: NN * 4 }, () => Math.random());
  for (let i = 0; i < NN; i++) {
    ngl[i] = Math.floor(seed[i * 4]! * NG);
    nsz[i] = 0.55 + seed[i * 4 + 1]! * 0.5;
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("alpha", new BufferAttribute(na, 1));
  nGeo.setAttribute("glyph", new BufferAttribute(ngl, 1));
  nGeo.setAttribute("sz", new BufferAttribute(nsz, 1));
  const nanites = new Points(
    nGeo,
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { atlas: edgeU.atlas, px: edgeU.px },
        vertexShader: `attribute float alpha, glyph, sz; uniform float px; varying float vA; varying vec2 vCell;
          void main(){ vA = alpha; vCell = vec2(mod(glyph, 8.), floor(glyph / 8.)); vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = sz * 15. * px * (4./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying float vA; varying vec2 vCell;
          void main(){ vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard; gl_FragColor = vec4(mix(vec3(.79, .66, .36), vec3(.95, .86, .62), vA), m*vA); }`,
      }),
    ),
  );
  nanites.frustumCulled = false;
  nanites.renderOrder = 8;
  scene.add(nanites);
  const stepNanites = (T: number) => {
    let i = 0;
    for (; i < NA; i++) {
      const s = i * 4;
      const u = (seed[s + 2]! + T * (0.012 + seed[s + 3]! * 0.02)) % 1;
      const a = seed[s]! * 6.283 + T * 0.03 * (seed[s + 1]! - 0.5);
      np[i * 3] = Math.cos(a) * (1.5 + seed[s + 1]! * 7);
      np[i * 3 + 1] = 0.2 + u * 4;
      np[i * 3 + 2] = BENCH_Z + 1.2 + Math.sin(a) * (1 + seed[s + 3]! * 2.4);
      na[i] = Math.sin(Math.PI * u) * 0.5;
    }
    // The cage: each glyph drifts down onto a point of its wire and fades there. Nothing builds up inside.
    const segs = cageAt.length / 3;
    for (let k = 0; k < NB; k++, i++) {
      const s = i * 4;
      const u = (seed[s + 2]! + T * (0.05 + seed[s + 3]! * 0.05)) % 1;
      const j = Math.floor(seed[s + 1]! * segs) * 3;
      const e = ease(u);
      const ox = (seed[s]! - 0.5) * 1.2, oy = 0.3 + seed[s + 3]! * 0.8, oz = (seed[s + 2]! - 0.5) * 1.1;
      np[i * 3] = cageAt[j]! + ox * (1 - e);
      np[i * 3 + 1] = cageAt[j + 1]! + oy * (1 - e);
      np[i * 3 + 2] = cageAt[j + 2]! + oz * (1 - e);
      na[i] = Math.sin(Math.PI * u) * 0.4;
    }
    for (let k = 0; k < NT; k++, i++) {
      const s = i * 4;
      const u = (seed[s + 2]! + T * (0.12 + seed[s + 3]! * 0.1)) % 1;
      const a = seed[s]! * 6.283 + T * 0.4;
      const r = pawnR + 0.06 + u * 0.12;
      np[i * 3] = s3.g.position.x + Math.cos(a) * r;
      np[i * 3 + 1] = TOP + scan.position.y + u * 0.3;
      np[i * 3 + 2] = BENCH_Z + Math.sin(a) * r;
      na[i] = (1 - u) * 0.5;
    }
    for (let k = 0; k < NF; k++, i++) {
      const s = i * 4;
      const u = (seed[s + 2]! + T * (0.018 + seed[s + 3]! * 0.012)) % 1;
      np[i * 3] = x0 + u * (x1 - x0);
      np[i * 3 + 1] = TOP + 0.03 + seed[s + 1]! * 0.08 + Math.sin(T * 1.3 + seed[s]! * 9) * 0.01;
      np[i * 3 + 2] = LINE_Z + (seed[s]! - 0.5) * 0.12;
      na[i] = Math.sin(Math.PI * u) * 0.32;
    }
    nGeo.attributes.position!.needsUpdate = true;
    nGeo.attributes.alpha!.needsUpdate = true;
  };

  // ---- the edges coming undone: veil, gold grid, code dust and glyphs peeling off the grid (after the Senate) ----------
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
            vec3 c = vec3(.03, .026, .02) + vec3(.79, .66, .36) * e * .05 * scan;
            gl_FragColor = vec4(c, e * (.6 + .14 * g)); }`,
      }),
    ),
  );
  veil.frustumCulled = false;
  veil.renderOrder = 20;
  scene.add(veil);
  const grid: number[] = [];
  const GS = PH ? 0.8 : 0.5;
  for (let x = -10; x <= 10.001; x += GS) grid.push(x, 0.005, -2.18, x, 0.005, 9, x, 0, -2.19, x, 6, -2.19);
  for (let z = -2.1; z <= 9; z += GS) grid.push(-10, 0.005, z, 10, 0.005, z);
  for (let y = GS; y <= 6; y += GS) grid.push(-10, y, -2.19, 10, y, -2.19);
  const gridGeo = keep(new BufferGeometry());
  gridGeo.setAttribute("position", new BufferAttribute(new Float32Array(grid), 3));
  const wires = new LineSegments(
    gridGeo,
    keep(
      new ShaderMaterial({
        uniforms: edgeU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float t; varying vec3 vW; ${EDGE}
          void main(){ float e = smoothstep(.3, .95, edgeOf());
            vec3 cell = floor(vW * 2.2); float h = hash(cell + floor(t * .7 + hash(cell) * 4.));
            if (h < .35 - e * .2) discard;
            float fl = .75 + .25 * sin(t * 3. + h * 40.);
            gl_FragColor = vec4(vec3(.79, .66, .36) * fl, .05 + e * .65); }`,
      }),
    ),
  );
  wires.frustumCulled = false;
  wires.renderOrder = 21;
  scene.add(wires);
  const NE = PH ? 360 : 1000;
  const ep = new Float32Array(NE * 3);
  const eg = new Float32Array(NE);
  const er = new Float32Array(NE);
  for (let i = 0; i < NE; i++) {
    const onWall = Math.random() < 0.55;
    ep.set(onWall ? [(Math.random() - 0.5) * 20, Math.random() * 6, -2.17] : [(Math.random() - 0.5) * 20, 0.03, -2 + Math.random() * 11], i * 3);
    eg[i] = Math.floor(Math.random() * NG);
    er[i] = Math.random();
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
            vec3 p = position; p.y += fract(t * .03 + rnd) * .8;
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.6 + rnd * .6) * 20. * px * (5. / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; uniform float t; varying vec2 vCell; varying float vR; ${EDGE}
          void main(){ float e = smoothstep(.45, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float wink = .45 + .55 * sin(t * 1.7 + vR * 50.);
            gl_FragColor = vec4(mix(vec3(.79, .66, .36), vec3(.89, .79, .55), vR), m * e * wink * .8); }`,
      }),
    ),
  );
  codeDust.frustumCulled = false;
  codeDust.renderOrder = 22;
  scene.add(codeDust);
  const NP = PH ? 120 : 360;
  const pp = new Float32Array(NP * 3);
  const pd = new Float32Array(NP * 3);
  const pg = new Float32Array(NP);
  const pr = new Float32Array(NP);
  const segs = grid.length / 6;
  for (let i = 0; i < NP; i++) {
    const k = Math.floor(Math.random() * segs) * 6, f = Math.random();
    const x = grid[k]! + (grid[k + 3]! - grid[k]!) * f, y = grid[k + 1]! + (grid[k + 4]! - grid[k + 1]!) * f, z = grid[k + 2]! + (grid[k + 5]! - grid[k + 2]!) * f;
    pp.set([x, y, z], i * 3);
    const onFloor = y < 0.1;
    pd.set([(Math.random() - 0.5) * 0.3, onFloor ? 0.6 + Math.random() * 0.8 : 0.25 + Math.random() * 0.6, onFloor ? (Math.random() - 0.5) * 0.3 : 0.5 + Math.random() * 0.9], i * 3);
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
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.45 + rnd * .35) * 18. * px * (5. / -mv.z) * (1. - ph * .35);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec2 vCell; varying float vL; ${EDGE}
          void main(){ float e = smoothstep(.42, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float life = smoothstep(0., .12, vL) * (1. - smoothstep(.45, 1., vL));
            gl_FragColor = vec4(mix(vec3(.89, .79, .55), vec3(.79, .66, .36), smoothstep(0., .5, vL)), m * e * life * .32); }`,
      }),
    ),
  );
  peel.frustumCulled = false;
  peel.renderOrder = 22;
  scene.add(peel);


  // ---- the camera: over the whole flow, or stepped up to one station ------------------------------------------------
  const v3 = new Vector3();
  // The bench's ends with headroom over the stations for their tags, and its front edge.
  const FIT = [
    new Vector3(x0 - 0.1, TOP + 1.55, BENCH_Z - 0.4),
    new Vector3(x1 + 0.1, TOP + 1.55, BENCH_Z - 0.4),
    new Vector3(x0 - 0.1, TOP - 0.1, BENCH_Z + 0.75),
    new Vector3(x1 + 0.1, TOP - 0.1, BENCH_Z + 0.75),
  ];
  /** The overview: from the front and a little above, backed off until the bench fits the frame under the head. */
  const flowPose = (): Pose => {
    // Square or tall frames (a phone) see the bench from the front right, so the line recedes and each station stays big.
    const tall = cam.aspect < 1.15;
    const look = new Vector3(0, TOP + 0.5, BENCH_Z);
    const dir = new Vector3(tall ? 0.95 : 0.06, tall ? 0.6 : 0.34, 1).normalize();
    const probe = new PerspectiveCamera(36, cam.aspect, 0.1, 80);
    const lim = tall ? 0.97 : 0.95;
    const top = Math.max(-0.2, Math.min(0.86, 0.9 - 2 * (opts.headroom?.() ?? 0)));
    const bot = -0.82;
    let d = 4;
    const place = () => {
      probe.position.copy(look).addScaledVector(dir, d);
      probe.lookAt(look);
      probe.updateMatrixWorld();
    };
    const fit = () => {
      for (d = 3; d < 30; d += 0.2) {
        place();
        if (FIT.every((p) => (v3.copy(p).project(probe), Math.abs(v3.x) < lim && v3.y < top && v3.y > bot))) break;
      }
    };
    // Fit, then centre what's fitted in the frame, and fit again from there.
    for (let pass = 0; pass < 3; pass++) {
      fit();
      let xa = 9, xb = -9, ya = 9, yb = -9;
      for (const p of FIT) {
        v3.copy(p).project(probe);
        xa = Math.min(xa, v3.x);
        xb = Math.max(xb, v3.x);
        ya = Math.min(ya, v3.y);
        yb = Math.max(yb, v3.y);
      }
      const half = d * Math.tan((36 * Math.PI) / 360);
      const up = new Vector3(0, 1, 0).applyQuaternion(probe.quaternion), right = new Vector3(1, 0, 0).applyQuaternion(probe.quaternion);
      look.addScaledVector(up, ((ya + yb) / 2 - (top + bot) / 2) * half).addScaledVector(right, ((xa + xb) / 2) * half * probe.aspect);
    }
    fit();
    return { pos: look.clone().addScaledVector(dir, d), look, fov: 36 };
  };
  /** A station close up: from the front and a little to the right, the station left of the card that opens beside it. */
  const LOOK_Y = [0.78, 0.45, 0.4, 0.6];
  const DIST = [2.7, 2.3, 2.0, 2.9];
  const stagePose = (n: number): Pose => {
    const wide = cam.aspect >= 1;
    const look = new Vector3(STAGE_X(n) + (wide ? 0.5 : 0), TOP + LOOK_Y[n - 1]! - (wide ? 0 : 0.25), BENCH_Z);
    const d = DIST[n - 1]! * (wide ? 1 : 1.5);
    return { pos: look.clone().add(new Vector3(0.28, 0.36, 1).normalize().multiplyScalar(d)), look, fov: 34 };
  };
  let view: FlowView = { k: "flow" };
  const poseOf = (v: FlowView) => (v.k === "flow" ? flowPose() : stagePose(v.n));
  let from: Pose = poseOf(view);
  let to: Pose = from;
  let flyT = 1;
  const FLY = reduce ? 0.001 : 1.1;
  const cur: Pose = { pos: from.pos.clone(), look: from.look.clone(), fov: from.fov };
  const look = new Vector3();
  // WASD (Nikita, 2026-11-06): no free roam. The camera swivels round what it looks at, the bench or a station: A/D (and
  // the arrows) swing it left and right within a set arc, W/S dolly in and out within tight bounds, both meet a soft
  // edge and ease back inside it, and Home (or Escape) brings back the composed view.
  const ARC = { flow: [0.42, -0.14, 0.28], stage: [0.7, -0.2, 0.32] } as const;
  const orbit = { yaw: 0, zoom: 0, yawT: 0, zoomT: 0 };
  const arc = () => ARC[view.k];
  const push = (v: number, d: number, lo: number, hi: number) => {
    const edge = d > 0 ? hi : lo;
    const f = edge ? Math.max(0, v / edge) : 0;
    return Math.max(lo, Math.min(hi, v + d * edgeFactor(Math.min(1, f))));
  };
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => null,
    origin: () => [to.look.x, to.look.z],
    forward: () => [to.look.x - to.pos.x, to.look.z - to.pos.z],
    orbit: {
      turn: (rad) => {
        const [a] = arc();
        orbit.yawT = push(orbit.yawT, rad * 0.6, -a, a);
      },
      zoom: (amt) => {
        const [, lo, hi] = arc();
        orbit.zoomT = push(orbit.zoomT, amt * 0.35, lo, hi);
      },
      home: () => {
        orbit.yawT = 0;
        orbit.zoomT = 0;
      },
    },
  });
  const onHomeKey = (e: KeyboardEvent) => {
    if (e.code !== "Home" || isTyping(document.activeElement as Typable | null)) return;
    if (!host.matches(":hover") && !host.contains(document.activeElement)) return;
    e.preventDefault();
    pan.home();
  };
  window.addEventListener("keydown", onHomeKey);
  /** The swivel, eased: soft edges pull back inside 80% of the arc once the keys let go. */
  const stepOrbit = (dt: number) => {
    const [a, lo, hi] = arc();
    const k = reduce ? 1 : 1 - Math.exp(-6 * dt);
    if (!pan.busy) {
      orbit.yawT = Math.max(-a * SOFT, Math.min(a * SOFT, orbit.yawT)) * k + orbit.yawT * (1 - k);
      orbit.zoomT = Math.max(lo * SOFT, Math.min(hi * SOFT, orbit.zoomT)) * k + orbit.zoomT * (1 - k);
    }
    orbit.yaw += (orbit.yawT - orbit.yaw) * k;
    orbit.zoom += (orbit.zoomT - orbit.zoom) * k;
  };

  const size = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    renderer.getDrawingBufferSize(edgeU.res.value);
    // Re-fit where the camera is going (it stays put if it has arrived).
    to = poseOf(view);
    if (flyT >= 1) from = to;
  };
  const guard = dprGuard((d) => {
    renderer.setPixelRatio(d);
    edgeU.px.value = d;
    size();
  });
  const ro = new ResizeObserver(size);
  ro.observe(host);

  // ---- picking ------------------------------------------------------------------------------------------------------------
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hits = stations.map((s) => s.hit);
  const pickAt = (e: PointerEvent): FlowView | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const h = ray.intersectObjects(hits, false)[0];
    return (h?.object.userData.view as FlowView | undefined) ?? null;
  };
  let hot: number | null = null;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" || view.k !== "flow") return;
    const v = pickAt(e);
    const k = v?.k === "stage" ? v.n : null;
    if (k !== hot) {
      hot = k;
      canvas.style.cursor = k ? "pointer" : "";
    }
  };
  let down: [number, number] | null = null;
  const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return (down = null);
    down = null;
    const v = pickAt(e);
    if (v) opts.onPick(v);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  const onLeave = () => {
    if (hot) {
      hot = null;
      canvas.style.cursor = "";
    }
  };
  canvas.addEventListener("pointerleave", onLeave);

  // ---- the frame ----------------------------------------------------------------------------------------------------------
  let visible = true;
  const io = new IntersectionObserver(([en]) => (visible = !!en?.isIntersecting));
  io.observe(host);
  const anchors: [string, Vector3][] = stations.map((s, i) => [`stage-${s.stage.n}`, new Vector3(s.g.position.x, TOP + TAG_Y[i]!, BENCH_Z + 0.3)]);
  let raf = 0, last = performance.now(), T = 0, acc = 0, first = true;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    guard.frame(now);
    if (document.hidden || !visible) {
      last = now;
      return;
    }
    const dtRaw = Math.min(0.1, (now - last) / 1000);
    acc += dtRaw;
    last = now;
    if (PH && acc < 1 / 31) return;
    const dt = acc;
    acc = 0;
    const calm = reduce ? 0.08 : 1;
    T += dt * calm;
    edgeU.t.value = T;
    // The slicer: the plate turns as the piece is oriented, and the layer preview runs up the piece and back down.
    spin.rotation.y += dt * 0.35 * calm;
    const c = (0.5 - 0.5 * Math.cos(T * 0.45)) * pawnH;
    layerU.cut.value = c;
    scan.position.y = 0.09 + c;
    // The mould's resting ring breathes; nothing is being meshed.
    restMat.opacity = 0.28 + 0.18 * Math.sin(T * 1.1);
    for (const s of stations) {
      const want = hot === s.stage.n ? 1 : 0;
      const u = s.wire.uniforms.hot!;
      u.value += (want - u.value) * Math.min(1, dt * 8);
    }
    stepNanites(T);
    // The camera's flight, then the swivel round what it looks at.
    pan.step(dt);
    stepOrbit(dt);
    if (flyT < 1) {
      flyT = Math.min(1, flyT + dt / FLY);
      const k = ease(flyT);
      cur.pos.lerpVectors(from.pos, to.pos, k);
      cur.look.lerpVectors(from.look, to.look, k);
      cur.fov = from.fov + (to.fov - from.fov) * k;
      if (flyT >= 1) from = to;
    } else {
      cur.pos.copy(to.pos);
      cur.look.copy(to.look);
      cur.fov = to.fov;
    }
    // Swing the camera round the look point (about the vertical) and dolly it along its line of sight.
    look.copy(cur.look);
    v3.subVectors(cur.pos, cur.look).multiplyScalar(1 - orbit.zoom);
    const co = Math.cos(orbit.yaw), sn = Math.sin(orbit.yaw);
    cam.position.set(look.x + v3.x * co + v3.z * sn, look.y + v3.y, look.z - v3.x * sn + v3.z * co);
    if (cam.fov !== cur.fov) {
      cam.fov = cur.fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const w = host.clientWidth, h = host.clientHeight;
    for (const [id, p] of anchors) {
      v3.copy(p).project(cam);
      opts.onPlace(id, ((v3.x + 1) / 2) * w, ((1 - v3.y) / 2) * h, v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05);
    }
    vault.step(T, cam);
    renderer.render(scene, cam);
    if (first) {
      first = false;
      opts.onReady();
    }
  };
  size();
  raf = requestAnimationFrame(frame);

  return {
    setView(v) {
      if (v.k === view.k && (v.k !== "stage" || (view.k === "stage" && v.n === view.n))) return;
      view = v;
      orbit.yaw = orbit.yawT = orbit.zoom = orbit.zoomT = 0;
      from = { pos: cur.pos.clone(), look: cur.look.clone(), fov: cur.fov };
      to = poseOf(v);
      flyT = 0;
      hot = null;
      canvas.style.cursor = "";
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      pan.dispose();
      window.removeEventListener("keydown", onHomeKey);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
