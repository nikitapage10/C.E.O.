import {
  ACESFilmicToneMapping,
  AdditiveBlending,
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
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  RepeatWrapping,
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
  type Material,
} from "three";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { edgeFactor, wasdPan } from "@ceo/engine/web/wasdPan.ts";
import type { Step } from "./line.ts";
import { dprGuard, sceneDpr } from "@ceo/engine/web/phone.ts";

/**
 * The Studio in 3D (#828): an edit suite in the foreground with a sound stage behind it, drawn the way the Senate draws
 * its chamber (apps/desk/src/rotunda/rotundaScene.ts) and the Foundry its furnace (rooms/foundry/web/furnaceScene.ts).
 * Solid models first (the edit desk and its three monitors, the jog controller and speakers; the green cyc, the riser
 * with its tall 9:16 light frame and the host's mark, the truss with its fresnels, a softbox, a ring light and the
 * camera on its tripod), each with a wire skin, gold sigil nanites drifting in the light, and the frame's edges coming
 * undone into gold wire and code as the Senate's do.
 *
 * The monitors show the page's own plan and nothing else: the episode line as a timeline (the selected step under the
 * playhead), that step in the tall preview, and the first episodes in the bin. Nothing is connected, so the camera's
 * tally lamp stays dark and nothing renders.
 *
 * Phones get fewer particles, no shadows, a lower pixel ratio and 30 frames a second; reduced motion holds the scene
 * nearly still. Lazy loaded with three.js (StudioStage.tsx), never in the Desk's first load.
 */

export interface StudioView {
  steps: Step[];
  /** The step under the playhead (the page's selection). */
  sel: number;
  /** The first episodes, planned. */
  episodes: string[];
}

export interface StudioOpts {
  phone: boolean;
  reduce: boolean;
  view: StudioView;
  /** Where each label's anchor is on screen (host CSS pixels), whenever it moves: suite, stage, camera. */
  onPlace: (id: string, x: number, y: number, on: boolean) => void;
}

export interface Soundstage {
  set: (view: StudioView) => void;
  dispose: () => void;
}

const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴λΣ#*+:[]()&|$%!?~^"];
const PHONE_W = 760;
const GOLD = 0xc9a85c;
/** Where the host stands: the mark on the riser, the point every lamp and the camera turn to. */
const MARK = new Vector3(0, 1.45, -3.35);
const SANS = `"IBM Plex Sans", system-ui, sans-serif`;
const MONO = `"IBM Plex Mono", ui-monospace, monospace`;

export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Wraps text into lines that fit `w` pixels on a 2D canvas. */
function wrap(g: CanvasRenderingContext2D, text: string, w: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > w && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export async function createSoundstage(host: HTMLElement, canvas: HTMLCanvasElement, opts: StudioOpts): Promise<Soundstage> {
  const { reduce } = opts;
  const PH = opts.phone;
  let view = opts.view;
  const renderer = new WebGLRenderer({ canvas, antialias: !PH, powerPreference: "high-performance" });
  renderer.setPixelRatio(sceneDpr()); // 2x on a phone, stepped down while frames run slow (#1070)
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = !PH;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  scene.background = new Color(0x060608);
  scene.fog = new FogExp2(0x07070a, 0.03);
  const cam = new PerspectiveCamera(40, 1, 0.1, 120);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const mesh = <M extends Material>(g: BufferGeometry, m: M) => new Mesh(keep(g), m);
  const solid = (m: Mesh, cast = true) => {
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  };

  // ---- light ------------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x8d9bc4, 0x140c06, 0.55));
  const rim = new DirectionalLight(0x9fb4ff, 0.55);
  rim.position.set(-6, 9, -12);
  const fill = new DirectionalLight(0xffe2c0, 0.45);
  fill.position.set(5, 6, 12);
  scene.add(rim, fill);
  // The key: one fresnel off the front truss does the real lighting, with the shadows.
  const key = new SpotLight(0xfff0d8, 120, 22, 0.42, 0.6, 1.4);
  key.position.set(-2.6, 6, -0.9);
  key.target.position.copy(MARK).setY(0.6);
  key.castShadow = !PH;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  scene.add(key, key.target);
  const back = new SpotLight(0xd8e4ff, 60, 18, 0.5, 0.8, 1.4);
  back.position.set(2.8, 6.2, -5.4);
  back.target.position.copy(MARK);
  scene.add(back, back.target);
  // The monitors' own glow on the desk.
  const screenGlow = new PointLight(0xbcd0ff, 14, 6, 1.5);
  screenGlow.position.set(0, 1.5, 5.6);
  scene.add(screenGlow);

  // Shared materials.
  const metal = keep(new MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.75, roughness: 0.38 }));
  const black = keep(new MeshStandardMaterial({ color: 0x0f0f12, metalness: 0.35, roughness: 0.5 }));
  const brass = keep(new MeshStandardMaterial({ color: 0x9c7c3c, metalness: 0.9, roughness: 0.32, emissive: 0x1e1506 }));
  const goldLine = keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.26, depthWrite: false }));
  const lineMats = new Map<number, LineBasicMaterial>();
  /** A wire skin over a solid: its hard edges in gold, the Lattice's drawing showing through. */
  const skin = <T extends Mesh>(m: T, op = 0.26, angle = 30): T => {
    let mat = goldLine;
    if (op !== 0.26) {
      mat = lineMats.get(op) ?? keep(new LineBasicMaterial({ color: GOLD, transparent: true, opacity: op, depthWrite: false }));
      lineMats.set(op, mat);
    }
    m.add(new LineSegments(keep(new EdgesGeometry(m.geometry, angle)), mat));
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
  const glow = (col: number, size: number, op: number) => {
    const s = new Sprite(keep(new SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: AdditiveBlending })));
    s.scale.setScalar(size);
    return s;
  };
  /** A rod from a to b (a stand's pole, a truss chord, a tripod leg). */
  const rodG = keep(new CylinderGeometry(1, 1, 1, 10));
  const UP = new Vector3(0, 1, 0);
  const rod = (a: Vector3, b: Vector3, r: number, m: Material = metal) => {
    const d = new Vector3().subVectors(b, a);
    const o = new Mesh(rodG, m);
    o.scale.set(r, d.length(), r);
    o.position.copy(a).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(UP, d.normalize());
    return solid(o);
  };

  // ---- the floor --------------------------------------------------------------------------------------------------
  const floorTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#18181a";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
    const t = keep(new CanvasTexture(c));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(9, 9);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const floor = solid(mesh(new PlaneGeometry(36, 36), keep(new MeshStandardMaterial({ map: floorTex, color: 0x9a9690, metalness: 0.35, roughness: 0.42 }))), false);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // The stage's line on the floor, where the suite ends and the set begins: a gold hairline.
  {
    const l = mesh(new PlaneGeometry(13, 0.025), keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.45 })));
    l.rotation.x = -Math.PI / 2;
    l.position.set(0, 0.006, 2.2);
    scene.add(l);
  }

  // ---- the sound stage: the green cyc ---------------------------------------------------------------------------
  // A floor-to-wall cove, swept across the stage: floor out front, a curve, then the wall.
  const CYC_W = 12.5;
  const cycGeo = (() => {
    const prof: [number, number][] = [];
    const Z0 = 0.6;
    const ZC = -5.4;
    const R = 1.7;
    const steps = 14;
    prof.push([Z0, 0]);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2);
      prof.push([ZC - Math.sin(a) * R, R - Math.cos(a) * R]);
    }
    prof.push([ZC - R, 7.4]);
    const X = 24;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < prof.length; i++)
      for (let j = 0; j <= X; j++) {
        const x = -CYC_W / 2 + (j / X) * CYC_W;
        pos.push(x, prof[i]![1] + 0.004, prof[i]![0]);
        uv.push(j / X, i / (prof.length - 1));
      }
    for (let i = 0; i < prof.length - 1; i++)
      for (let j = 0; j < X; j++) {
        const a = i * (X + 1) + j;
        const b = a + X + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const cyc = solid(mesh(cycGeo, keep(new MeshStandardMaterial({ color: 0x3f8f5c, roughness: 0.92, metalness: 0, side: DoubleSide }))), false);
  scene.add(cyc);
  // The cyc's frame: two flats at its sides, braced from behind.
  for (const s of [-1, 1]) {
    const flat = solid(mesh(new BoxGeometry(0.14, 7.4, 2.6), keep(new MeshStandardMaterial({ color: 0x1b1b1e, metalness: 0.2, roughness: 0.8 }))));
    flat.position.set(s * (CYC_W / 2 + 0.07), 3.7, -6.0);
    scene.add(skin(flat, 0.18));
  }
  // The studio's back wall, dark acoustic panels behind the cyc.
  const panelTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#101012";
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 64)
      for (let y = 0; y < 256; y += 64) {
        const gr = g.createLinearGradient(x, y, x + 64, y + 64);
        gr.addColorStop(0, "#1c1c20");
        gr.addColorStop(1, "#121215");
        g.fillStyle = gr;
        g.fillRect(x + 3, y + 3, 58, 58);
      }
    const t = keep(new CanvasTexture(c));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(10, 5);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const wall = mesh(new PlaneGeometry(30, 14), keep(new MeshStandardMaterial({ map: panelTex, color: 0xaaaaaa, roughness: 0.95 })));
  wall.position.set(0, 7, -7.6);
  scene.add(wall);

  // ---- the set: a riser, the tall frame, the host's mark, a stool -----------------------------------------------
  const riser = solid(mesh(new BoxGeometry(3.4, 0.26, 2.1), keep(new MeshStandardMaterial({ color: 0x1d1c1f, metalness: 0.3, roughness: 0.6 }))));
  riser.position.set(0, 0.13, -3.4);
  scene.add(skin(riser, 0.4));
  const riserLip = mesh(new BoxGeometry(3.42, 0.03, 0.03), brass);
  riserLip.position.set(0, 0.26, -2.35);
  scene.add(riserLip);
  // The tall frame: a 9:16 light box standing on the riser, the shape every short is cut to.
  const FRAME_W = 1.3;
  const FRAME_H = (FRAME_W * 16) / 9;
  const tallFrame = new Group();
  tallFrame.position.set(0, 0.26, -3.95);
  scene.add(tallFrame);
  const frameMat = keep(new MeshStandardMaterial({ color: 0x222226, metalness: 0.7, roughness: 0.3 }));
  const ledMat = keep(new MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffe9c4, emissiveIntensity: 1.6, roughness: 0.4 }));
  for (const [w, h, x, y] of [
    [FRAME_W + 0.16, 0.08, 0, FRAME_H + 0.04],
    [FRAME_W + 0.16, 0.08, 0, -0.04 + 0.08],
    [0.08, FRAME_H, -FRAME_W / 2 - 0.04, FRAME_H / 2 + 0.04],
    [0.08, FRAME_H, FRAME_W / 2 + 0.04, FRAME_H / 2 + 0.04],
  ] as const) {
    const bar = solid(mesh(new BoxGeometry(w, h, 0.14), frameMat));
    bar.position.set(x, y, 0);
    tallFrame.add(skin(bar, 0.4));
    const led = mesh(new BoxGeometry(w > h ? w - 0.1 : 0.025, w > h ? 0.025 : h - 0.06, 0.02), ledMat);
    led.position.set(x, y, 0.075);
    tallFrame.add(led);
  }
  {
    const feet = solid(mesh(new BoxGeometry(FRAME_W + 0.5, 0.06, 0.5), frameMat));
    feet.position.set(0, 0.03, 0);
    tallFrame.add(feet);
    const g1 = glow(0xffe2b0, 4.2, 0.22);
    g1.position.set(0, FRAME_H / 2, 0.2);
    tallFrame.add(g1);
  }
  // The host's mark, taped on the riser: a gold-tape cross.
  for (const r of [Math.PI / 4, -Math.PI / 4]) {
    const t = mesh(new BoxGeometry(0.42, 0.006, 0.05), keep(new MeshStandardMaterial({ color: 0xd9b45e, emissive: 0x3a2a08, roughness: 0.5 })));
    t.rotation.y = r;
    t.position.set(0, 0.263, -3.0);
    scene.add(t);
  }
  // A tall stool by the frame, for the analogy's props.
  {
    const st = new Group();
    st.position.set(1.15, 0.26, -3.1);
    const seat = solid(mesh(new CylinderGeometry(0.22, 0.22, 0.06, 24), keep(new MeshStandardMaterial({ color: 0x3a2618, roughness: 0.55 }))));
    seat.position.y = 0.78;
    st.add(skin(seat, 0.3));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      st.add(rod(new Vector3(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2), new Vector3(Math.cos(a) * 0.12, 0.76, Math.sin(a) * 0.12), 0.016));
    }
    const ring = mesh(new TorusGeometry(0.16, 0.012, 6, 32), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    st.add(ring);
    scene.add(st);
  }

  // ---- the rigging: truss, fresnels, their beams -----------------------------------------------------------------
  const TRUSS_Y = 6.3;
  const T = 0.32;
  const chordM = keep(new MeshStandardMaterial({ color: 0x8c8c92, metalness: 0.9, roughness: 0.28 }));
  const truss = (a: Vector3, b: Vector3) => {
    const d = new Vector3().subVectors(b, a);
    const len = d.length();
    const dir = d.clone().normalize();
    const side = new Vector3().crossVectors(dir, UP).normalize();
    const up = UP.clone();
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([s, u]) => side.clone().multiplyScalar((s! * T) / 2).addScaledVector(up, (u! * T) / 2));
    for (const c of corners) scene.add(rod(a.clone().add(c), b.clone().add(c), 0.022, chordM));
    // The lattice: zigzag braces on every face, one instanced mesh.
    const n = Math.max(2, Math.round(len / T));
    const lat = new InstancedMesh(rodG, chordM, n * 4);
    const M = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    let k = 0;
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f]!;
      const c1 = corners[(f + 1) % 4]!;
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const A = a.clone().addScaledVector(d, t0).add(i % 2 ? c0 : c1);
        const B = a.clone().addScaledVector(d, t1).add(i % 2 ? c1 : c0);
        const e = new Vector3().subVectors(B, A);
        p.copy(A).addScaledVector(e, 0.5);
        s.set(0.011, e.length(), 0.011);
        q.setFromUnitVectors(UP, e.normalize());
        M.compose(p, q, s);
        lat.setMatrixAt(k++, M);
      }
    }
    lat.castShadow = true;
    scene.add(lat);
    disposables.push({ dispose: () => lat.dispose() });
  };
  const tF = new Vector3(-5.6, TRUSS_Y, -1.0);
  const tF2 = new Vector3(5.6, TRUSS_Y, -1.0);
  const tB = new Vector3(-5.6, TRUSS_Y + 0.4, -5.6);
  const tB2 = new Vector3(5.6, TRUSS_Y + 0.4, -5.6);
  truss(tF, tF2);
  truss(tB, tB2);
  truss(tF, tB);
  truss(tF2, tB2);
  // Chain hoists up into the dark: the rig hangs from the grid above.
  for (const p of [tF, tF2, tB, tB2]) scene.add(rod(p.clone().setY(p.y + 0.2), p.clone().setY(p.y + 6), 0.012, metal));

  // A fresnel: can, yoke, barn doors, a warm lens, and a soft beam of haze to the mark.
  const beamMat = keep(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { t: { value: 0 } },
      vertexShader: `varying vec2 vU; varying vec3 vN, vV; void main(){ vU = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float t; varying vec2 vU; varying vec3 vN, vV;
        void main(){ float along = vU.y; float side = pow(abs(dot(vN, vV)), 1.6);
          float a = side * smoothstep(0., .25, along) * (.55 + .45 * along) * (.9 + .1 * sin(t * .7 + along * 6.));
          gl_FragColor = vec4(vec3(1., .91, .74) * a * .085, 1.); }`,
    }),
  );
  const fresnelLens = keep(new MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffe2b0, emissiveIntensity: 2.2, roughness: 0.2 }));
  const canG = keep(new CylinderGeometry(0.17, 0.2, 0.42, 20));
  const doorG = keep(new BoxGeometry(0.34, 0.2, 0.012));
  const fresnel = (at: Vector3, aim: Vector3, beam: boolean) => {
    const g = new Group();
    g.position.copy(at);
    scene.add(g);
    // The yoke hangs from the truss.
    g.add(rod(new Vector3(0, 0.05, 0), new Vector3(0, 0.38, 0), 0.02));
    const head = new Group();
    g.add(head);
    g.updateMatrixWorld(true);
    head.lookAt(aim);
    const can = solid(new Mesh(canG, black));
    can.rotation.x = Math.PI / 2;
    head.add(skin(can, 0.3));
    const lens = new Mesh(keep(new CircleGeometry(0.15, 24)), fresnelLens);
    lens.position.z = 0.215;
    head.add(lens);
    for (let k = 0; k < 4; k++) {
      const d = new Mesh(doorG, black);
      const a = (k / 4) * Math.PI * 2;
      d.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0.3);
      d.rotation.z = a + Math.PI / 2;
      d.rotateX(Math.PI / 2 + 0.35);
      head.add(d);
    }
    const lg = glow(0xffd9a0, 0.9, 0.5);
    lg.position.z = 0.26;
    head.add(lg);
    if (beam) {
      const len = at.distanceTo(aim) * 0.92;
      const cone = new Mesh(keep(new ConeGeometry(0.85, len, 28, 1, true)), beamMat);
      cone.rotation.x = -Math.PI / 2;
      cone.position.z = 0.22 + len / 2;
      // The cone's uv runs tip (0) to base (1) once flipped: the beam brightens away from the lens.
      cone.scale.y = -1;
      head.add(cone);
    }
    return g;
  };
  [-3.3, -1.1, 1.1, 3.3].forEach((x, i) => fresnel(new Vector3(x, TRUSS_Y - 0.62, -1.0), MARK, i === 0 || i === 2 || !PH));
  [-2.2, 2.2].forEach((x) => fresnel(new Vector3(x, TRUSS_Y - 0.22, -5.6), new Vector3(0, 1.8, -3.2), false));

  // ---- stands: a softbox and a ring light, both turned to the mark ---------------------------------------------
  const stand = (x: number, z: number, h: number) => {
    const g = new Group();
    g.position.set(x, 0, z);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      g.add(rod(new Vector3(Math.cos(a) * 0.5, 0.01, Math.sin(a) * 0.5), new Vector3(0, 0.55, 0), 0.016));
    }
    g.add(rod(new Vector3(0, 0.5, 0), new Vector3(0, h, 0), 0.022));
    scene.add(g);
    return g;
  };
  {
    const s = stand(-3.4, -2.0, 2.3);
    const box = new Group();
    box.position.set(0, 2.35, 0);
    s.add(box);
    s.updateMatrixWorld(true);
    box.lookAt(MARK.clone().setY(2.1));
    // A softbox: a four-sided cone, its open face a white diffuser glowing at the mark.
    const sb = solid(mesh(new ConeGeometry(0.75, 0.7, 4, 1, true), keep(new MeshStandardMaterial({ color: 0x141416, roughness: 0.85, side: DoubleSide }))));
    sb.rotation.x = Math.PI / 2;
    sb.rotation.y = Math.PI / 4;
    sb.position.z = 0.3;
    box.add(skin(sb, 0.3));
    const diff = mesh(new PlaneGeometry(1.04, 1.04), keep(new MeshStandardMaterial({ color: 0xfaf5ec, emissive: 0xfff1dc, emissiveIntensity: 1.3, side: DoubleSide })));
    diff.position.z = 0.66;
    box.add(diff);
    const gl = glow(0xfff0d6, 2.6, 0.18);
    gl.position.z = 0.75;
    box.add(gl);
  }
  {
    const s = stand(3.3, -2.2, 1.95);
    const ring = new Group();
    ring.position.set(0, 2.1, 0);
    s.add(ring);
    s.updateMatrixWorld(true);
    ring.lookAt(MARK.clone().setY(1.95));
    const rl = solid(mesh(new TorusGeometry(0.42, 0.06, 14, 64), keep(new MeshStandardMaterial({ color: 0x1a1a1d, metalness: 0.5, roughness: 0.4 }))));
    ring.add(skin(rl, 0.25, 50));
    const ledR = mesh(new TorusGeometry(0.42, 0.028, 8, 64), keep(new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6ea, emissiveIntensity: 1.8 })));
    ledR.position.z = 0.04;
    ring.add(ledR);
    const gl = glow(0xfff6ea, 1.8, 0.2);
    gl.position.z = 0.1;
    ring.add(gl);
  }

  // ---- the camera, on its tripod, turned to the mark --------------------------------------------------------------
  const camRig = new Group();
  camRig.position.set(1.9, 0, 0.4);
  scene.add(camRig);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.6;
    camRig.add(rod(new Vector3(Math.cos(a) * 0.62, 0.01, Math.sin(a) * 0.62), new Vector3(0, 1.22, 0), 0.026, black));
  }
  {
    const spreader = mesh(new TorusGeometry(0.28, 0.012, 6, 3), metal);
    spreader.rotation.x = Math.PI / 2;
    spreader.position.y = 0.42;
    camRig.add(spreader);
  }
  const headPan = new Group();
  headPan.position.y = 1.3;
  camRig.add(headPan);
  camRig.updateMatrixWorld(true);
  headPan.lookAt(MARK.clone().setY(1.3));
  {
    const fluid = solid(mesh(new BoxGeometry(0.22, 0.12, 0.26), black));
    headPan.add(fluid);
    const body = solid(mesh(new BoxGeometry(0.26, 0.28, 0.48), keep(new MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.6, roughness: 0.36 }))));
    body.position.y = 0.21;
    headPan.add(skin(body, 0.34));
    const lens = solid(mesh(new CylinderGeometry(0.085, 0.1, 0.36, 24), keep(new MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.6, roughness: 0.3 }))));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.22, 0.42);
    headPan.add(skin(lens, 0.3));
    const glass = mesh(new CircleGeometry(0.08, 24), keep(new MeshStandardMaterial({ color: 0x0a1020, metalness: 1, roughness: 0.05, emissive: 0x0a1428 })));
    glass.position.set(0, 0.22, 0.601);
    headPan.add(glass);
    const matte = solid(mesh(new BoxGeometry(0.34, 0.26, 0.12), black));
    matte.position.set(0, 0.22, 0.64);
    headPan.add(skin(matte, 0.24));
    const handle = rod(new Vector3(0, 0.36, -0.14), new Vector3(0, 0.36, 0.16), 0.016, metal);
    headPan.add(handle);
    headPan.add(rod(new Vector3(0, 0.35, -0.12), new Vector3(0, 0.42, -0.12), 0.014), rod(new Vector3(0, 0.35, 0.14), new Vector3(0, 0.42, 0.14), 0.014));
    headPan.children.at(-1)!.position.y += 0.04;
    headPan.children.at(-2)!.position.y += 0.04;
    // Its viewfinder: tall, as tall as a phone.
    const vf = solid(mesh(new BoxGeometry(0.13, 0.22, 0.025), black));
    vf.position.set(-0.2, 0.3, -0.12);
    vf.rotation.y = -0.5;
    headPan.add(vf);
    const vfScreen = mesh(new PlaneGeometry(0.11, 0.19), keep(new MeshBasicMaterial({ color: 0x1b2a22 })));
    vfScreen.position.set(-0.2 - Math.sin(0.5) * 0.0135 * -1, 0.3, -0.1335);
    vfScreen.rotation.y = Math.PI - 0.5;
    headPan.add(vfScreen);
    // Pan bar, back to the operator.
    headPan.add(rod(new Vector3(0.05, 0, -0.1), new Vector3(0.22, -0.18, -0.7), 0.014, black));
  }
  // The tally lamp, dark: nothing is rolling.
  const tallyMat = keep(new MeshStandardMaterial({ color: 0x3a1414, emissive: 0x3a0c0c, emissiveIntensity: 0.6, roughness: 0.3 }));
  const tally = mesh(new SphereGeometry(0.035, 12, 10), tallyMat);
  tally.position.set(0.1, 0.4, 0.18);
  headPan.add(tally);

  // ---- the edit suite -------------------------------------------------------------------------------------------
  const DESK_Z = 5.35;
  const DESK_Y = 0.78;
  const walnutTex = (() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#2c1d13";
    g.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? "20,12,6" : "70,46,28"},${0.25 + Math.random() * 0.35})`;
      g.lineWidth = 0.6 + Math.random() * 1.6;
      g.beginPath();
      const y = Math.random() * 128;
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (Math.random() - 0.5) * 2);
      g.stroke();
    }
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const walnut = keep(new MeshStandardMaterial({ map: walnutTex, color: 0xb59a86, roughness: 0.5, metalness: 0.08 }));
  const deskTop = solid(mesh(new BoxGeometry(6.2, 0.08, 1.35), walnut));
  deskTop.position.set(0, DESK_Y, DESK_Z);
  scene.add(skin(deskTop, 0.38));
  const deskEdge = mesh(new BoxGeometry(6.22, 0.02, 0.02), brass);
  deskEdge.position.set(0, DESK_Y - 0.03, DESK_Z - 0.68);
  scene.add(deskEdge);
  for (const x of [-2.55, 2.55]) {
    const ped = solid(mesh(new BoxGeometry(0.9, DESK_Y - 0.04, 1.2), keep(new MeshStandardMaterial({ color: 0x18181b, metalness: 0.4, roughness: 0.55 }))));
    ped.position.set(x, (DESK_Y - 0.04) / 2, DESK_Z + 0.02);
    scene.add(skin(ped, 0.22));
  }
  {
    const modesty = solid(mesh(new BoxGeometry(4.2, 0.46, 0.04), black));
    modesty.position.set(0, DESK_Y - 0.3, DESK_Z - 0.55);
    scene.add(modesty);
  }
  // The monitors: a wide timeline in the middle, the tall preview at its left, the bin at its right.
  const SCREEN_PX = 1024;
  const screens: { canvas: HTMLCanvasElement; tex: CanvasTexture; w: number; h: number }[] = [];
  const monitor = (w: number, h: number, x: number, y: number, z: number, yaw: number, tilt = -0.06) => {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    scene.add(g);
    const bez = solid(mesh(new BoxGeometry(w + 0.06, h + 0.06, 0.05), keep(new MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.5, roughness: 0.35 }))));
    bez.position.y = y;
    bez.rotation.x = tilt;
    g.add(skin(bez, 0.42));
    const backBox = solid(mesh(new BoxGeometry(w * 0.6, h * 0.55, 0.08), metal));
    backBox.position.set(0, y, -0.06);
    backBox.rotation.x = tilt;
    g.add(backBox);
    const c = document.createElement("canvas");
    c.width = SCREEN_PX;
    c.height = Math.round((SCREEN_PX * h) / w);
    const tex = keep(new CanvasTexture(c));
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    const scr = mesh(new PlaneGeometry(w, h), keep(new MeshBasicMaterial({ map: tex, toneMapped: false })));
    scr.position.set(0, y, 0.027);
    scr.rotation.x = tilt;
    // Off the plane's tilt: keep it flush with the bezel's face.
    scr.position.z += Math.sin(-tilt) * 0;
    g.add(scr);
    g.add(rod(new Vector3(0, DESK_Y + 0.04, -0.12), new Vector3(0, y - h * 0.2, -0.1), 0.03, metal));
    const foot = solid(mesh(new BoxGeometry(Math.min(0.5, w * 0.4), 0.025, 0.32), metal));
    foot.position.set(0, DESK_Y + 0.05, -0.1);
    g.add(foot);
    const gl = glow(0x9fb4ff, Math.max(w, h) * 1.6, 0.06);
    gl.position.set(0, y, 0.3);
    g.add(gl);
    screens.push({ canvas: c, tex, w, h });
    return g;
  };
  monitor(2.5, 1.06, 0, 1.62, DESK_Z - 0.32, 0);
  monitor(0.66, 1.17, -1.86, 1.66, DESK_Z - 0.18, 0.34, -0.04);
  monitor(1.36, 0.8, 1.98, 1.52, DESK_Z - 0.16, -0.34);
  // On the desk: keyboard, a jog-and-shuttle controller, a mouse, two speakers.
  {
    const kb = solid(mesh(new BoxGeometry(0.95, 0.03, 0.3), keep(new MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.6 }))));
    kb.position.set(-0.2, DESK_Y + 0.055, DESK_Z + 0.22);
    scene.add(skin(kb, 0.2));
    const ctl = solid(mesh(new BoxGeometry(0.62, 0.06, 0.36), keep(new MeshStandardMaterial({ color: 0x232327, metalness: 0.4, roughness: 0.45 }))));
    ctl.position.set(0.85, DESK_Y + 0.07, DESK_Z + 0.2);
    scene.add(skin(ctl, 0.3));
    const jog = solid(mesh(new CylinderGeometry(0.12, 0.12, 0.04, 32), brass));
    jog.position.set(1.0, DESK_Y + 0.12, DESK_Z + 0.22);
    scene.add(skin(jog, 0.4));
    const shuttle = mesh(new TorusGeometry(0.13, 0.018, 8, 32), metal);
    shuttle.rotation.x = Math.PI / 2;
    shuttle.position.copy(jog.position).setY(DESK_Y + 0.12);
    scene.add(shuttle);
    for (let k = 0; k < 6; k++) {
      const b = mesh(new BoxGeometry(0.06, 0.02, 0.05), k === 2 ? keep(new MeshStandardMaterial({ color: 0x5a1c1c, emissive: 0x200606 })) : black);
      b.position.set(0.62 + (k % 3) * 0.08, DESK_Y + 0.11, DESK_Z + 0.12 + Math.floor(k / 3) * 0.08);
      scene.add(b);
    }
    const mouse = solid(mesh(new SphereGeometry(0.06, 16, 10), black));
    mouse.scale.set(0.8, 0.45, 1.2);
    mouse.position.set(0.42, DESK_Y + 0.06, DESK_Z + 0.25);
    scene.add(mouse);
    for (const x of [-2.75, 2.75]) {
      const sp = solid(mesh(new BoxGeometry(0.34, 0.52, 0.36), keep(new MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.2 }))));
      sp.position.set(x, DESK_Y + 0.3, DESK_Z - 0.2);
      sp.rotation.y = x < 0 ? 0.3 : -0.3;
      scene.add(skin(sp, 0.3));
      for (const [y, r] of [
        [0.1, 0.12],
        [-0.1 + 0.24, 0.04],
      ] as const) {
        const cone = mesh(new CircleGeometry(r, 24), keep(new MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9 })));
        cone.position.set(0, y - 0.05, 0.181);
        sp.add(cone);
        const rim2 = mesh(new TorusGeometry(r, 0.008, 6, 32), brass);
        rim2.position.set(0, y - 0.05, 0.182);
        sp.add(rim2);
      }
    }
  }
  // Cables: from the camera back to the suite, and up into the rig.
  {
    const cableMat = keep(new MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.7 }));
    const runs = [
      [new Vector3(1.9, 0.3, 0.4), new Vector3(2.0, 0.02, 1.6), new Vector3(1.2, 0.02, 3.0), new Vector3(0.6, 0.02, 4.6), new Vector3(0.2, 0.4, 5.4)],
      [new Vector3(-3.4, 0.02, -2.0), new Vector3(-3.0, 0.02, -0.4), new Vector3(-2.2, 0.02, 1.8), new Vector3(-1.5, 0.02, 4.4)],
      [new Vector3(3.3, 0.02, -2.2), new Vector3(4.2, 0.02, -0.8), new Vector3(4.6, 0.02, 2.4)],
    ];
    for (const pts of runs) {
      const c = solid(mesh(new TubeGeometry(new CatmullRomCurve3(pts), 40, 0.022, 6), cableMat), false);
      scene.add(c);
    }
  }

  // ---- the monitors' pictures: the page's own plan ----------------------------------------------------------------
  const drawScreens = () => {
    const { steps, sel, episodes } = view;
    // The timeline.
    {
      const s = screens[0]!;
      const g = s.canvas.getContext("2d")!;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.fillStyle = "#0b0c10";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#13141a";
      g.fillRect(0, 0, W, 52);
      g.font = `600 20px ${MONO}`;
      g.textBaseline = "middle";
      g.fillStyle = "#e3c98d";
      g.fillText("THE EPISODE LINE", 24, 27);
      g.fillStyle = "#8b8f9c";
      g.textAlign = "center";
      g.fillText("00:00:00:00", W / 2, 27);
      g.textAlign = "right";
      g.fillStyle = "#9c6a69";
      g.fillText("NOT ROLLING", W - 24, 27);
      g.beginPath();
      g.fillStyle = "#4a1c1c";
      g.arc(W - 186, 27, 7, 0, Math.PI * 2);
      g.fill();
      g.textAlign = "left";
      // The program view of the step under the playhead.
      const st = steps[sel];
      if (st) {
        g.fillStyle = "#e3c98d";
        g.font = `500 18px ${MONO}`;
        g.fillText(`STEP ${st.k} / ${String(steps.length).padStart(2, "0")}`, 24, 88);
        g.fillStyle = "#eceef3";
        g.font = `500 40px ${SANS}`;
        g.fillText(st.t, 24, 132);
        g.fillStyle = "#a6aab6";
        g.font = `400 21px ${SANS}`;
        wrap(g, st.w, W - 48)
          .slice(0, 1)
          .forEach((l, i) => g.fillText(l, 24, 172 + i * 26));
      }
      // Ruler, track, clips.
      const L = 70;
      const R = W - 24;
      const top = 214;
      g.strokeStyle = "#2a2c35";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 90; i++) {
        const x = L + ((R - L) * i) / 90;
        g.moveTo(x + 0.5, top);
        g.lineTo(x + 0.5, top + (i % 10 ? 7 : 14));
      }
      g.stroke();
      g.font = `500 15px ${MONO}`;
      g.fillStyle = "#6d7180";
      g.fillText("V1", 24, top + 64);
      g.fillText("A1", 24, top + 152);
      g.fillText("C1", 24, top + 210);
      const cw = (R - L) / steps.length;
      steps.forEach((step, i) => {
        const x = L + i * cw + 3;
        const y = top + 26;
        const on = i === sel;
        g.fillStyle = on ? "#3a3020" : "#191b22";
        g.fillRect(x, y, cw - 6, 78);
        g.strokeStyle = on ? "#e3c98d" : "#2c2f3a";
        g.lineWidth = on ? 3 : 1.5;
        g.strokeRect(x + 0.5, y + 0.5, cw - 7, 77);
        g.fillStyle = on ? "#e3c98d" : "#c48a89";
        g.font = `500 15px ${MONO}`;
        g.fillText(step.k, x + 10, y + 20);
        g.fillStyle = on ? "#f3ecdc" : "#9da1ad";
        g.font = `500 16px ${SANS}`;
        wrap(g, step.t, cw - 22)
          .slice(0, 2)
          .forEach((l, k) => g.fillText(l, x + 10, y + 44 + k * 19));
      });
      // Voice and captions: empty tracks, waiting on their keys.
      g.fillStyle = "#12131a";
      g.fillRect(L, top + 128, R - L, 46);
      g.fillRect(L, top + 188, R - L, 40);
      g.fillStyle = "#545866";
      g.font = `400 15px ${MONO}`;
      g.fillText("voice · waits on the ElevenLabs key", L + 14, top + 152);
      g.fillText("captions · waits on the voice", L + 14, top + 209);
      // The playhead, gold, parked on the selected step.
      const px0 = L + sel * cw + 3;
      g.fillStyle = "#e3c98d";
      g.fillRect(px0 - 1, top - 4, 3, H - top);
      g.beginPath();
      g.moveTo(px0 - 9, top - 6);
      g.lineTo(px0 + 10, top - 6);
      g.lineTo(px0 + 0.5, top + 8);
      g.fill();
      s.tex.needsUpdate = true;
    }
    // The tall preview: the selected step in the 9:16 frame.
    {
      const s = screens[1]!;
      const g = s.canvas.getContext("2d")!;
      const W = s.canvas.width;
      const H = s.canvas.height;
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#14151c");
      bg.addColorStop(1, "#0a0a0e");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(227,201,141,.35)";
      g.lineWidth = 3;
      g.strokeRect(40, 40, W - 80, H - 80);
      const st = steps[sel];
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      if (st) {
        g.fillStyle = "#e3c98d";
        g.font = `500 64px ${MONO}`;
        g.fillText(st.k, 96, 240);
        g.fillStyle = "#eceef3";
        g.font = `500 104px ${SANS}`;
        wrap(g, st.t, W - 190)
          .slice(0, 3)
          .forEach((l, i) => g.fillText(l, 96, 400 + i * 116));
        g.fillStyle = "#a6aab6";
        g.font = `400 52px ${SANS}`;
        const body = wrap(g, st.s, W - 190).slice(0, 7);
        body.forEach((l, i) => g.fillText(l, 96, 820 + i * 70));
        g.fillStyle = "#c48a89";
        g.font = `500 42px ${MONO}`;
        wrap(g, st.w, W - 190)
          .slice(0, 3)
          .forEach((l, i) => g.fillText(l, 96, H - 300 + i * 56));
      }
      g.fillStyle = "#6d7180";
      g.font = `500 40px ${MONO}`;
      g.fillText("9:16 · PREVIEW", 96, H - 96);
      s.tex.needsUpdate = true;
    }
    // The bin: the first episodes, planned.
    {
      const s = screens[2]!;
      const g = s.canvas.getContext("2d")!;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.fillStyle = "#0b0c10";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#13141a";
      g.fillRect(0, 0, W, 64);
      g.textBaseline = "middle";
      g.font = `600 26px ${MONO}`;
      g.fillStyle = "#e3c98d";
      g.fillText("BIN · FIRST EPISODES", 28, 33);
      g.textAlign = "right";
      g.fillStyle = "#6d7180";
      g.fillText("PLANNED", W - 28, 33);
      g.textAlign = "left";
      const rowH = (H - 84) / Math.max(1, episodes.length);
      episodes.forEach((t, i) => {
        const y = 76 + i * rowH;
        g.fillStyle = i % 2 ? "#0f1015" : "#121319";
        g.fillRect(16, y, W - 32, rowH - 6);
        g.strokeStyle = "#2c2f3a";
        g.lineWidth = 2;
        g.strokeRect(34, y + 10, (rowH - 26) * (9 / 16), rowH - 26);
        g.fillStyle = "#c48a89";
        g.font = `500 24px ${MONO}`;
        g.fillText(String(i + 1).padStart(2, "0"), 34 + (rowH - 26) * (9 / 16) + 22, y + rowH / 2 - 3);
        g.fillStyle = "#c9ccd6";
        g.font = `400 27px ${SANS}`;
        const line = wrap(g, t, W - 260)[0] ?? t;
        g.fillText(line, 34 + (rowH - 26) * (9 / 16) + 76, y + rowH / 2 - 3);
      });
      s.tex.needsUpdate = true;
    }
  };
  drawScreens();

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
  const nanU = { t: { value: 0 }, atlas: { value: atlas }, px };
  // Gold sigils hanging in the haze: they drift down the fresnels' beams and circle the tall frame.
  const NN = PH ? 160 : 420;
  {
    const p = new Float32Array(NN * 3);
    const r = new Float32Array(NN);
    const gl = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      if (i < NN * 0.6) {
        // In the stage's air, over the set.
        p.set([(Math.random() - 0.5) * 9, 0.4 + Math.random() * 5.6, -1 - Math.random() * 5.2], i * 3);
      } else {
        // Round the tall frame, a loose swarm.
        const a = Math.random() * Math.PI * 2;
        const rr = 0.9 + Math.random() * 0.8;
        p.set([Math.cos(a) * rr, 0.4 + Math.random() * (FRAME_H + 0.4), -3.95 + Math.sin(a) * rr * 0.6], i * 3);
      }
      r[i] = Math.random();
      gl[i] = Math.floor(Math.random() * NG);
    }
    const geo = keep(new BufferGeometry());
    geo.setAttribute("position", new BufferAttribute(p, 3));
    geo.setAttribute("rnd", new BufferAttribute(r, 1));
    geo.setAttribute("glyph", new BufferAttribute(gl, 1));
    const pts = new Points(
      geo,
      keep(
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: nanU,
          vertexShader: `attribute float rnd, glyph; uniform float t, px; varying vec2 vCell; varying float vA;
            void main(){ float g = mod(glyph + floor(t * .4 + rnd * 9.), ${NG.toFixed(1)}); vCell = vec2(mod(g, 8.), floor(g / 8.));
              vec3 p = position; float s = t * (.05 + rnd * .05);
              p.x += sin(s * 6.283 + rnd * 40.) * .35; p.z += cos(s * 6.283 + rnd * 23.) * .25; p.y += sin(t * .2 + rnd * 17.) * .3;
              vA = .35 + .65 * (.5 + .5 * sin(t * (.6 + rnd) + rnd * 60.));
              vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.35 + rnd * .35) * 26. * px * (8. / -mv.z); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `uniform sampler2D atlas; varying vec2 vCell; varying float vA;
            void main(){ vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
              gl_FragColor = vec4(vec3(.89, .79, .55), m * vA * .55); }`,
        }),
      ),
    );
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    scene.add(pts);
  }

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
          void main(){ float e = smoothstep(.52, .98, edgeOf()); if (e < .01) discard;
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
  // The grid the room comes undone into: the floor, the back wall and the side walls, as gold lines.
  const wire: number[] = [];
  const seg = (a: number[], b: number[]) => wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
  const GX = 9;
  const ZB = -7.4;
  const ZF = 11;
  const step = PH ? 1.2 : 0.8;
  for (let x = -GX; x <= GX + 0.001; x += step) seg([x, 0.02, ZB], [x, 0.02, ZF]);
  for (let z = ZB; z <= ZF + 0.001; z += step) seg([-GX, 0.02, z], [GX, 0.02, z]);
  for (let x = -GX; x <= GX + 0.001; x += step) seg([x, 0, ZB], [x, 12, ZB]);
  for (let y = 0; y <= 12.001; y += step) seg([-GX, y, ZB], [GX, y, ZB]);
  for (const sx of [-GX, GX]) {
    for (let z = ZB; z <= ZF + 0.001; z += step * 1.5) seg([sx, 0, z], [sx, 12, z]);
    for (let y = 0; y <= 12.001; y += step) seg([sx, y, ZB], [sx, y, ZF]);
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
            gl_FragColor = vec4(vec3(.79, .66, .36) * fl, e * .7); }`,
      }),
    ),
  );
  wires.frustumCulled = false;
  wires.renderOrder = 21;
  scene.add(wires);
  // Code dust on those planes, and sigils peeling off the wires as the grid turns into nanites (#878).
  const ND = PH ? 380 : 1000;
  const dp = new Float32Array(ND * 3);
  const dg = new Float32Array(ND);
  const dr = new Float32Array(ND);
  for (let i = 0; i < ND; i++) {
    const w = Math.random();
    if (w < 0.4) dp.set([(Math.random() - 0.5) * GX * 2, 0.05, ZB + Math.random() * (ZF - ZB)], i * 3);
    else if (w < 0.7) dp.set([(Math.random() - 0.5) * GX * 2, Math.random() * 11, ZB + 0.05], i * 3);
    else dp.set([(Math.random() < 0.5 ? -1 : 1) * (GX - 0.05), Math.random() * 11, ZB + Math.random() * (ZF - ZB)], i * 3);
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
  const NP = PH ? 120 : 340;
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
    // Off the floor they rise; off a wall they lean into the room.
    const onFloor = y < 0.05;
    const inX = Math.abs(x) > GX - 0.01 ? -Math.sign(x) : 0;
    const inZ = z < ZB + 0.01 ? 1 : 0;
    pd.set([inX * (0.5 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.3, onFloor ? 0.6 + Math.random() * 0.8 : 0.25 + Math.random() * 0.6, inZ * (0.5 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.3], i * 3);
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
    cam.fov = w < PHONE_W ? 52 : 38;
    cam.updateProjectionMatrix();
    px.value = renderer.getPixelRatio();
  };
  size();
  const guard = dprGuard((d) => {
    renderer.setPixelRatio(d);
    size();
  });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(host);
  // The camera swivels round the stage on a set arc, never roams (Nikita, 2026-11-06): A/D (or a mouse drag) turn it
  // within YAW_MAX, W/S dolly in and out a little, both meeting a soft edge past 80% and easing back inside it when
  // let go; Escape snaps home (the shared helper, #776, keeps the keys off while anything is typed into).
  const YAW_MAX = 0.42;
  const ZOOM_IN = 0.8;
  const ZOOM_OUT = 1.12;
  let yaw = 0;
  let yawTo = 0;
  let zoom = 1;
  let zoomTo = 1;
  let held = 0;
  const turn = (d: number) => {
    const out = Math.sign(d) === Math.sign(yawTo) || yawTo === 0;
    yawTo = Math.max(-YAW_MAX, Math.min(YAW_MAX, yawTo + (out ? d * edgeFactor(Math.abs(yawTo) / YAW_MAX) : d)));
    held = 0.25;
  };
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => null,
    origin: () => [0, 0],
    forward: () => [0, -1],
    orbit: {
      turn: (r) => turn(r * 0.6),
      zoom: (a) => {
        zoomTo = Math.max(ZOOM_IN, Math.min(ZOOM_OUT, zoomTo - a * 0.35));
        held = 0.25;
      },
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  let downAt: number | null = null;
  const onMove = (e: PointerEvent) => {
    if (downAt === null || e.pointerType !== "mouse") return;
    turn((e.clientX - downAt) * 0.003);
    downAt = e.clientX;
  };
  const onDown = (e: PointerEvent) => {
    downAt = e.clientX;
  };
  const onUp = () => {
    downAt = null;
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);

  const anchors: [string, Vector3][] = [
    ["suite", new Vector3(-0.55, 2.3, DESK_Z - 0.3)],
    ["stage", new Vector3(0, 0.26 + FRAME_H + 0.55, -3.95)],
    ["camera", new Vector3(1.9, 2.05, 0.4)],
  ];
  const placed = new Map<string, string>();
  const tmpV = new Vector3();
  const place = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    for (const [id, p] of anchors) {
      tmpV.copy(p).project(cam);
      const x = ((tmpV.x + 1) / 2) * w;
      const y = ((1 - tmpV.y) / 2) * h;
      const on = tmpV.z < 1 && x > 20 && x < w - 20 && y > 20 && y < h - 20;
      const key = `${Math.round(x)}|${Math.round(y)}|${on}`;
      if (placed.get(id) === key) continue;
      placed.set(id, key);
      opts.onPlace(id, x, y, on);
    }
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
  let TT = 0;
  let raf = 0;
  const minStep = PH ? 1000 / 30 - 2 : 0;
  const look = new Vector3();
  const pivot = new Vector3(0, 0, 0.8);
  const draw = (dt: number) => {
    TT += dt * (reduce ? 0.12 : 1);
    edgeU.t.value = reduce ? 0 : TT;
    nanU.t.value = TT;
    beamMat.uniforms.t!.value = TT;
    renderer.getDrawingBufferSize(edgeU.res.value);
    const ph = phone();
    pan.step(dt);
    held = Math.max(0, held - dt);
    // Let go: back inside the soft edge of the arc and the dolly.
    if (!held && downAt === null) {
      const sk = reduce ? 1 : 1 - Math.exp(-dt * 3);
      const lim = YAW_MAX * 0.8;
      if (Math.abs(yawTo) > lim) yawTo += (Math.sign(yawTo) * lim - yawTo) * sk;
      const zIn = 1 - (1 - ZOOM_IN) * 0.8;
      const zOut = 1 + (ZOOM_OUT - 1) * 0.8;
      if (zoomTo < zIn) zoomTo += (zIn - zoomTo) * sk;
      if (zoomTo > zOut) zoomTo += (zOut - zoomTo) * sk;
    }
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 4);
    yaw += (yawTo - yaw) * ek;
    zoom += (zoomTo - zoom) * ek;
    const th = yaw + (reduce ? 0 : Math.sin(TT * 0.06) * 0.06);
    // Over the editor's shoulder, across the suite to the stage; a phone stands further back and higher.
    const D = (ph ? (cam.aspect < 0.7 ? 15.5 : 13) : 11.4) * zoom;
    const camY = (ph ? 4.2 : 3.4) * (0.8 + zoom * 0.2);
    cam.position.set(pivot.x + Math.sin(th) * D, camY, pivot.z + Math.cos(th) * D);
    look.set(0, ph ? 2.1 : 1.95, -2.2);
    cam.lookAt(look);
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (ph) cam.setViewOffset(w, h, 0, -h * 0.14, w, h);
    else cam.setViewOffset(w, h, -w * 0.1, -h * 0.03, w, h);
    renderer.render(scene, cam);
    place();
  };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    guard.frame(now);
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
      drawScreens();
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      pan.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
