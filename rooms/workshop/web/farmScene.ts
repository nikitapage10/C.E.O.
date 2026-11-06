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
import { edgeFactor, isTyping, SOFT, wasdPan, type Typable } from "@ceo/engine/web/wasdPan.ts";
import { BAYS, PAWN, type Bay, type FarmView } from "./farm.ts";

/**
 * The print farm in 3D (#827), the Workshop's room: printers on a long bench, solid and lit in the middle of the frame,
 * overlaid with gold wire and sigil nanites, and coming undone into wire, grid and code toward the frame's edges the
 * way the Senate's chamber does (apps/desk/src/rotunda/rotundaScene.ts, #856, #878: a veil, a gold grid that breaks
 * into dashes, glyphs strewn along it and glyphs peeling off it). The look is the Senate's; the code is the room's own.
 *
 * What it shows is only what's true (farm.ts): bay 1 holds the Bambu Lab printer, waiting on the LAN, its plate empty
 * and its head parked; the open bays are printers not yet made, mostly wire with nanites still gathering into them.
 * Pick a printer (or its tag) and the camera steps inside its chamber; pick the turntable and it comes round to the
 * pre-print check, where the Workshop's own check piece turns under a scanning ring. Phones get fewer particles and 30
 * frames a second; reduced motion holds the room nearly still. WASD swivels the camera round what it looks at in
 * every view (the shared wasdPan helper's orbit mode): A/D within a set arc, W/S in and out within tight bounds, soft
 * edges that ease back, Home or Escape for the composed view; ignored while typing, Space left to hold-to-talk. Lazy loaded with three.js, never in the Desk's first load.
 */

export interface FarmOpts {
  phone: boolean;
  reduce: boolean;
  /** A printer or the turntable was picked in the scene. */
  onPick: (v: FarmView) => void;
  /** Where each tag's anchor ("bay-1".."bay-4", "table") is in the host's CSS pixels, every frame it moves. */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
  /** The first frame is drawn. */
  onReady: () => void;
}

export interface Farm {
  setView(v: FarmView): void;
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
/** The bench's top, the bays' spacing and where they stand. */
const TOP = 0.8;
const BAY_X = (n: number) => (n - 2.5) * 1.5;
const BAY_Z = -0.9;
/** The turntable, front and centre. */
const TABLE = new Vector3(0, 0.7, 1.3);
/** The check piece's scale: 40 mm stands about 0.6 units tall on the turntable. */
const MM = 0.015;
/** How much of each open bay is made: the second nearly, the fourth barely. */
const MADE = [1, 0.34, 0.2, 0.1];
const GLYPHS = SIGILS.filter((g) => g.length === 1).slice(0, 64);

interface Pose {
  pos: Vector3;
  look: Vector3;
  fov: number;
}

export async function createFarm(host: HTMLElement, canvas: HTMLCanvasElement, opts: FarmOpts): Promise<Farm> {
  const { phone: PH, reduce } = opts;
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH ? 1.25 : 1.75));
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
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 4, bottom: -3, near: 1, far: 20 });
  scene.add(key);
  const rim = new DirectionalLight(0x8fa6ff, 0.45);
  rim.position.set(4, 3, -4);
  scene.add(rim);
  const tableSpot = new SpotLight(0xffe2b0, 30, 7, 0.42, 0.6, 1.4);
  tableSpot.position.set(0.4, 4.2, 2.6);
  tableSpot.target.position.copy(TABLE);
  scene.add(tableSpot, tableSpot.target);

  // ---- the room: a dark floor and back wall (their grid comes undone at the frame's edges, below) ------------------
  const floor = new Mesh(keep(new PlaneGeometry(40, 30)), keep(new MeshStandardMaterial({ color: 0x0c0d13, roughness: 0.5, metalness: 0.35 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 4;
  floor.receiveShadow = true;
  scene.add(floor);
  const wall = new Mesh(keep(new PlaneGeometry(40, 10)), keep(new MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.8, metalness: 0.1 })));
  wall.position.set(0, 5, -2.2);
  wall.receiveShadow = true;
  scene.add(wall);

  // ---- the bench ----------------------------------------------------------------------------------------------------
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
  solid(new BoxGeometry(6.4, 0.08, 1.4), walnut, 0, TOP - 0.04, BAY_Z);
  solid(new BoxGeometry(6.4, 0.012, 0.012), goldMat, 0, TOP - 0.02, BAY_Z + 0.706);
  solid(new BoxGeometry(6.2, 0.05, 1.25), steel, 0, 0.22, BAY_Z);
  for (const x of [-3.1, 3.1]) for (const z of [BAY_Z - 0.62, BAY_Z + 0.62]) solid(new BoxGeometry(0.07, TOP - 0.08, 0.07), steel, x, (TOP - 0.08) / 2, z);
  // Filament on the lower shelf: spools, standing on edge (props; nothing is loaded or printing).
  const spoolCols = [0xd8d2c4, 0x2b2d36, 0xc9a85c, 0x6a8fb0, 0xa04a3a, 0xd8d2c4];
  const spoolMats = spoolCols.map((c) => keep(new MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 })));
  const reel = keep(new CylinderGeometry(0.17, 0.17, 0.02, 32));
  const wind = keep(new CylinderGeometry(0.14, 0.14, 0.09, 32));
  spoolCols.forEach((_, i) => {
    const g = new Group();
    g.position.set(-2.6 + i * 0.55 + (i > 2 ? 1.6 : 0), 0.42, BAY_Z - 0.1);
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

  // ---- the wire: one gold line material per bay (and one for the room's props), brighter toward the frame's edges --
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

  // ---- the printers ---------------------------------------------------------------------------------------------------
  // A plate texture: textured PEI, dark, with a fine gold grid and the plate's origin mark.
  const plateTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
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
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();

  interface Printer {
    bay: Bay;
    g: Group;
    wire: ShaderMaterial;
    made: number;
    hit: Mesh;
    /** Points on its frame, for the nanites that gather into it. */
    frame: number[];
  }
  const hitMat = keep(new MeshBasicMaterial({ visible: false }));
  const glassGeo = (w: number, h: number) => keep(new PlaneGeometry(w, h));
  const printers: Printer[] = BAYS.map((bay, i) => {
    const made = MADE[i] ?? 0.1;
    const real = bay.state === "waiting";
    const g = new Group();
    g.position.set(BAY_X(bay.n), TOP, BAY_Z);
    scene.add(g);
    const fade = (m: MeshStandardMaterial) => {
      if (real) return m;
      m.transparent = true;
      m.opacity = made;
      m.depthWrite = false;
      return m;
    };
    const body = keep(fade(new MeshStandardMaterial({ color: real ? 0x2a2c36 : 0x1d1e26, metalness: 0.55, roughness: 0.36 })));
    const trim = keep(fade(new MeshStandardMaterial({ color: 0x2b2c35, metalness: 0.8, roughness: 0.25 })));
    const glass = keep(new MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.2, roughness: 0.05, transparent: true, opacity: real ? 0.13 : 0.04 * made, depthWrite: false }));
    const smoke = keep(new MeshStandardMaterial({ color: 0x0d0f15, metalness: 0.3, roughness: 0.2, transparent: true, opacity: real ? 0.55 : 0.12 * made, depthWrite: false }));
    const plateMat = keep(fade(new MeshStandardMaterial({ map: plateTex, metalness: 0.5, roughness: 0.4 })));
    const rodMat = keep(fade(new MeshStandardMaterial({ color: 0x9aa0ad, metalness: 0.9, roughness: 0.2 })));
    const wire = wireMat(real ? 0.14 : 0.16 + (1 - made) * 0.12);
    const parts: Mesh[] = [];
    const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => {
      const m = solid(geo, mat, x, y, z, g);
      if (!real) m.castShadow = false;
      parts.push(m);
      return m;
    };
    // The frame: base, cap, four posts, the back panel; smoked sides, a clear door and lid.
    add(new BoxGeometry(1, 0.16, 1), body, 0, 0.08, 0);
    add(new BoxGeometry(1, 0.07, 1), body, 0, 1.075, 0);
    for (const [x, z] of [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]] as const) add(new BoxGeometry(0.06, 0.9, 0.06), trim, x, 0.6, z);
    add(new BoxGeometry(0.88, 0.9, 0.025), body, 0, 0.6, -0.48);
    for (const x of [-0.49, 0.49]) {
      const s = new Mesh(glassGeo(0.9, 0.9), smoke);
      s.position.set(x, 0.6, 0);
      s.rotation.y = Math.PI / 2;
      g.add(s);
    }
    const door = new Mesh(glassGeo(0.88, 0.88), glass);
    door.position.set(0, 0.6, 0.495);
    g.add(door);
    const lid = new Mesh(glassGeo(0.88, 0.88), glass);
    lid.position.set(0, 1.112, 0);
    lid.rotation.x = -Math.PI / 2;
    g.add(lid);
    // The door's handle and the screen on the base, dim while it waits.
    add(new BoxGeometry(0.02, 0.3, 0.03), trim, 0.38, 0.6, 0.51);
    const screen = new Mesh(glassGeo(0.2, 0.09), keep(new MeshBasicMaterial({ color: real ? 0x5a4a28 : 0x15161c, transparent: !real, opacity: real ? 1 : made })));
    screen.position.set(-0.3, 0.085, 0.502);
    g.add(screen);
    // Inside: the plate, the gantry, the head parked at the back left.
    add(new BoxGeometry(0.78, 0.02, 0.78), plateMat, 0, 0.21, 0.02);
    add(new BoxGeometry(0.82, 0.04, 0.82), trim, 0, 0.18, 0.02);
    for (const x of [-0.41, 0.41]) {
      const r = add(new CylinderGeometry(0.012, 0.012, 0.86, 10), rodMat, x, 0.98, 0);
      r.rotation.x = Math.PI / 2;
    }
    add(new BoxGeometry(0.86, 0.035, 0.05), trim, 0, 0.98, -0.3);
    const head = add(new BoxGeometry(0.13, 0.15, 0.12), body, -0.3, 0.9, -0.27);
    const nozzle = add(new CylinderGeometry(0.004, 0.018, 0.04, 10), rodMat, 0, -0.095, 0.0);
    g.remove(nozzle);
    head.add(nozzle);
    // The spool, hung on the side.
    const spool = add(new CylinderGeometry(0.16, 0.16, 0.08, 32), keep(fade(new MeshStandardMaterial({ color: real ? 0xd8d2c4 : 0x2b2d36, roughness: 0.6 }))), 0.56, 0.75, -0.2);
    spool.rotation.z = Math.PI / 2;
    // The chamber light: on in the printer that's here, none in an open bay.
    if (real) {
      const lamp = new PointLight(0xffe7c0, 3.2, 2.2, 1.2);
      lamp.position.set(0, 0.95, 0.3);
      g.add(lamp);
      add(new BoxGeometry(0.6, 0.01, 0.02), keep(new MeshBasicMaterial({ color: 0xffd99a })), 0, 1.03, 0.42);
    }
    const frame: number[] = [];
    for (const m of parts) {
      const l = overlay(m, wire);
      const p = (l.geometry as BufferGeometry).attributes.position!.array as ArrayLike<number>;
      m.updateMatrix();
      const v = new Vector3();
      for (let k = 0; k < p.length; k += 3) {
        v.set(p[k]!, p[k + 1]!, p[k + 2]!).applyMatrix4(m.matrix);
        frame.push(v.x, v.y, v.z);
      }
    }
    const hit = new Mesh(keep(new BoxGeometry(1.1, 1.2, 1.1)), hitMat);
    hit.position.set(0, 0.6, 0);
    hit.userData.view = { k: "bay", n: bay.n } satisfies FarmView;
    g.add(hit);
    return { bay, g, wire, made, hit, frame };
  });

  // ---- the turntable --------------------------------------------------------------------------------------------------
  const table = new Group();
  table.position.set(TABLE.x, 0, TABLE.z);
  scene.add(table);
  const ped = solid(new CylinderGeometry(0.34, 0.42, TABLE.y - 0.04, 48), steel, 0, (TABLE.y - 0.04) / 2, 0, table);
  overlay(ped, propWire);
  solid(new TorusGeometry(0.42, 0.008, 6, 96), goldMat, 0, 0.02, 0, table).rotation.x = Math.PI / 2;
  const spin = new Group();
  spin.position.y = TABLE.y - 0.04;
  table.add(spin);
  const disc = solid(new CylinderGeometry(0.46, 0.46, 0.04, 64), walnut, 0, 0.02, 0, spin);
  overlay(disc, propWire);
  const ring = solid(new TorusGeometry(0.46, 0.01, 6, 128), goldMat, 0, 0.04, 0, spin);
  ring.rotation.x = Math.PI / 2;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const tick = solid(new BoxGeometry(0.012, 0.012, k % 6 ? 0.03 : 0.06), goldMat, Math.cos(a) * 0.41, 0.045, Math.sin(a) * 0.41, spin);
    tick.rotation.y = -a + Math.PI / 2;
  }
  const profile = PAWN.map(([r, y]) => new Vector2(r * MM, y * MM));
  const pawnMat = keep(new MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.55, metalness: 0.02 }));
  const pawn = solid(new LatheGeometry(profile, 64), pawnMat, 0, 0.04, 0, spin);
  const pawnWireMat = wireMat(0.22);
  const pawnWire = new LineSegments(keep(new WireframeGeometry(keep(new LatheGeometry(profile, 14)))), pawnWireMat);
  pawnWire.scale.setScalar(1.004);
  pawn.add(pawnWire);
  const pawnH = Math.max(...PAWN.map(([, y]) => y)) * MM;
  const pawnR = Math.max(...PAWN.map(([r]) => r)) * MM;
  // The check: a gold ring that scans up and down the piece, and its bounding box in fine gold.
  const scanMat = keep(new MeshBasicMaterial({ color: GOLD_HI, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
  const scan = new Mesh(keep(new TorusGeometry(pawnR + 0.05, 0.004, 6, 96)), scanMat);
  scan.rotation.x = Math.PI / 2;
  table.add(scan);
  const box = new LineSegments(keep(new EdgesGeometry(keep(new BoxGeometry(pawnR * 2 + 0.04, pawnH + 0.02, pawnR * 2 + 0.04)))), wireMat(0.32));
  box.position.y = TABLE.y + pawnH / 2;
  table.add(box);
  const tableHit = new Mesh(keep(new CylinderGeometry(0.5, 0.5, 1.6, 16)), hitMat);
  tableHit.position.y = 0.8;
  tableHit.userData.view = { k: "table" } satisfies FarmView;
  table.add(tableHit);

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
  const NG = GLYPHS.length;
  // Drifters in the air; a share gathering into each open bay's frame; a stream off the turntable's scanning ring.
  const NA = PH ? 80 : 240;
  const NB = PH ? 40 : 110;
  const NT = PH ? 24 : 60;
  const open = printers.filter((p) => p.bay.state === "open");
  const NN = NA + NB * open.length + NT;
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
      np[i * 3] = Math.cos(a) * (1.5 + seed[s + 1]! * 5.5);
      np[i * 3 + 1] = 0.2 + u * 4;
      np[i * 3 + 2] = BAY_Z + 1.2 + Math.sin(a) * (1 + seed[s + 3]! * 2.4);
      na[i] = Math.sin(Math.PI * u) * 0.5;
    }
    for (const p of open) {
      const f = p.frame, segs = f.length / 3;
      for (let k = 0; k < NB; k++, i++) {
        const s = i * 4;
        // Each glyph flies in from a loose cloud round the bay to a point on its frame, fades as it lands, and goes again.
        const u = (seed[s + 2]! + T * (0.08 + seed[s + 3]! * 0.08)) % 1;
        const j = Math.floor(seed[s + 1]! * segs) * 3;
        const e = ease(u);
        const ox = (seed[s]! - 0.5) * 1.8, oy = 0.4 + seed[s + 3]! * 1.2, oz = (seed[s + 2]! - 0.5) * 1.6;
        np[i * 3] = p.g.position.x + f[j]! + ox * (1 - e);
        np[i * 3 + 1] = TOP + f[j + 1]! + oy * (1 - e);
        np[i * 3 + 2] = BAY_Z + f[j + 2]! + oz * (1 - e);
        na[i] = Math.sin(Math.PI * u) * (0.35 + (1 - p.made) * 0.4);
      }
    }
    for (let k = 0; k < NT; k++, i++) {
      const s = i * 4;
      const u = (seed[s + 2]! + T * (0.12 + seed[s + 3]! * 0.1)) % 1;
      const a = seed[s]! * 6.283 + T * 0.4;
      const r = pawnR + 0.05 + u * 0.12;
      np[i * 3] = TABLE.x + Math.cos(a) * r;
      np[i * 3 + 1] = scan.position.y + u * 0.35;
      np[i * 3 + 2] = TABLE.z + Math.sin(a) * r;
      na[i] = (1 - u) * 0.55;
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

  // ---- the camera: over the farm, at the turntable, or inside a chamber ----------------------------------------------
  const v3 = new Vector3();
  // The bench's ends, a little headroom over the printers for their tags, and the turntable's foot.
  const FIT = [new Vector3(-3.2, TOP + 1.6, BAY_Z - 0.5), new Vector3(3.2, TOP + 1.6, BAY_Z - 0.5), new Vector3(-3.2, 0, BAY_Z + 0.7), new Vector3(3.2, 0, BAY_Z + 0.7), new Vector3(-0.5, 0, TABLE.z + 0.5), new Vector3(0.5, 0, TABLE.z + 0.5), new Vector3(-0.75, TABLE.y, TABLE.z - 0.5), new Vector3(-0.75, TABLE.y, TABLE.z + 0.6), new Vector3(-0.75, 0.3, TABLE.z + 0.6)];
  /** The overview: from the front and a little above, backed off until the bench and the turntable fit the frame. */
  const farmPose = (): Pose => {
    // Square or tall frames (a phone) see the bench from the front right, so the row recedes and each printer stays big.
    const tall = cam.aspect < 1.15;
    const look = new Vector3(tall ? -0.3 : 0, 0.85, tall ? -0.3 : 0);
    const dir = new Vector3(tall ? 0.95 : 0.12, tall ? 0.6 : 0.42, 1).normalize();
    const probe = new PerspectiveCamera(36, cam.aspect, 0.1, 80);
    const lim = tall ? 0.97 : 0.94;
    let d = 4;
    const place = () => {
      probe.position.copy(look).addScaledVector(dir, d);
      probe.lookAt(look);
      probe.updateMatrixWorld();
    };
    const fit = () => {
      for (d = 3; d < 24; d += 0.2) {
        place();
        if (FIT.every((p) => (v3.copy(p).project(probe), Math.abs(v3.x) < lim && Math.abs(v3.y) < 0.86))) break;
      }
    };
    // Fit, then centre what's fitted in the frame, and fit again from there.
    for (let pass = 0; pass < 3; pass++) {
      fit();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const p of FIT) {
        v3.copy(p).project(probe);
        x0 = Math.min(x0, v3.x);
        x1 = Math.max(x1, v3.x);
        y0 = Math.min(y0, v3.y);
        y1 = Math.max(y1, v3.y);
      }
      const half = d * Math.tan((36 * Math.PI) / 360);
      const up = new Vector3(0, 1, 0).applyQuaternion(probe.quaternion), right = new Vector3(1, 0, 0).applyQuaternion(probe.quaternion);
      look.addScaledVector(up, ((y0 + y1) / 2) * half).addScaledVector(right, ((x0 + x1) / 2) * half * probe.aspect);
    }
    fit();
    return { pos: look.clone().addScaledVector(dir, d), look, fov: 36 };
  };
  const tablePose = (): Pose => {
    const look = new Vector3(TABLE.x, TABLE.y + pawnH * 0.48, TABLE.z);
    const d = cam.aspect < 1 ? 2.4 : 1.75;
    return { pos: look.clone().add(new Vector3(0.55, 0.32, 1).normalize().multiplyScalar(d)), look, fov: 34 };
  };
  const bayPose = (n: number): Pose => {
    const x = BAY_X(n);
    // Just inside the door, looking down at the plate.
    return { pos: new Vector3(x + 0.08, TOP + 0.78, BAY_Z + 0.4), look: new Vector3(x - 0.02, TOP + 0.2, BAY_Z - 0.06), fov: cam.aspect < 1 ? 78 : 62 };
  };
  let view: FarmView = { k: "farm" };
  const poseOf = (v: FarmView) => (v.k === "farm" ? farmPose() : v.k === "table" ? tablePose() : bayPose(v.n));
  let from: Pose = poseOf(view);
  let to: Pose = from;
  let flyT = 1;
  const FLY = reduce ? 0.001 : 1.1;
  const cur: Pose = { pos: from.pos.clone(), look: from.look.clone(), fov: from.fov };
  const look = new Vector3();
  // WASD (Nikita, 2026-11-06): no free roam. The camera swivels round what it looks at, the bench, the turntable or
  // the chamber's plate: A/D (and the arrows) swing it left and right within a set arc, W/S dolly in and out within
  // tight bounds, both meet a soft edge and ease back inside it, and Home (or Escape) brings back the composed view.
  const ARC = { farm: [0.42, -0.12, 0.28], table: [0.85, -0.2, 0.35], bay: [0.3, -0.08, 0.18] } as const;
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
  const ro = new ResizeObserver(size);
  ro.observe(host);

  // ---- picking ------------------------------------------------------------------------------------------------------------
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hits = [...printers.map((p) => p.hit), tableHit];
  const pickAt = (e: PointerEvent): FarmView | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const h = ray.intersectObjects(hits, false)[0];
    return (h?.object.userData.view as FarmView | undefined) ?? null;
  };
  let hot: string | null = null;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" || view.k !== "farm") return;
    const v = pickAt(e);
    const k = v ? (v.k === "bay" ? `bay-${v.n}` : v.k) : null;
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
  const anchors: [string, Vector3][] = [...printers.map((p) => [`bay-${p.bay.n}`, new Vector3(p.g.position.x, TOP + 1.25, BAY_Z + 0.3)] as [string, Vector3]), ["table", new Vector3(TABLE.x, 0.3, TABLE.z + 0.4)]];
  let raf = 0, last = performance.now(), T = 0, acc = 0, first = true;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
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
    // The turntable turns; the check ring scans the piece, bottom to top and back.
    spin.rotation.y += dt * 0.5 * calm;
    scan.position.y = TABLE.y + 0.01 + (0.5 - 0.5 * Math.cos(T * 0.9)) * pawnH;
    for (const p of printers) {
      const want = hot === `bay-${p.bay.n}` ? 1 : 0;
      const u = p.wire.uniforms.hot!;
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
    const c = Math.cos(orbit.yaw), sn = Math.sin(orbit.yaw);
    cam.position.set(look.x + v3.x * c + v3.z * sn, look.y + v3.y, look.z - v3.x * sn + v3.z * c);
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
      if (v.k === view.k && (v.k !== "bay" || (view.k === "bay" && v.n === view.n))) return;
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
