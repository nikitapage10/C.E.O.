import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type Bone,
  type SkinnedMesh,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { recolor } from "../../agents/bodies/recolor.ts";
import { modelUrl } from "../../modelUrl.ts";
import { cachedModel } from "../modelCache.ts";
import { wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { ARMS, CHILD, fitCap, HEAD, NAVY, PHI, POSES, TH0, TH1 } from "../hologram/rig.ts";
import type { Pose } from "../hologram/persona.ts";
import { SKIPPY_MODEL } from "../council/live.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import { chairLine, COUNTER_COLOUR, MURMUR_MAX, murmurFor, type RiteItem, type RiteKind, type RiteLine } from "./rite.ts";
import { makeActor, onSpeaker, startTalk, stepActor, type Actor, type SenateRig } from "./senateActor.ts";
import { senatePoses, senatorOf } from "./senators.ts";

/**
 * The Senate in 3D (#740), Today's chamber: the round 3 concept (concepts/2026-11-04-today-boiler, r3/rotunda.js)
 * ported to the Desk. Skippy presides on the podium in a shaft of light; the Council's subminds sit round the bowl on
 * identical bronze pods, each floating on a short field of sigil glyphs and motes in its room's colour that sinks out of
 * the keel and fades well above the floor (no tethers). Pods are lit from real state (Rotunda.tsx): dim and sparse when
 * the submind isn't active, brighter when it is, brightest while its room is at work. The docket's items (rite.ts) play
 * in turn: a pod flies in to the floor when it speaks and glides home after. The gallery is hundreds of instanced pods
 * with a pinprick light each, and now and then one murmurs a canned line (at most three at once, none under reduced
 * motion). Haze drifts through the bowl and up the podium's shaft; sigil nanites drift in the air and gather at the
 * podium when the chair speaks. Phones get fewer particles and 30 frames a second; reduced motion slows everything to a
 * near stop. Lazy loaded with three.js, never in the Desk's first load.
 *
 * Every Skippy in it is its own self (#775): its own idle, gestures, faces and reactions, played from senators.ts by
 * senateActor.ts, with a moving face cast over the front of each can's head.
 */

export interface RotundaSeat {
  id: string;
  /** "The Builder". */
  title: string;
  /** "Foundry". */
  room: string;
  /** Hex. */
  colour: string;
  /** Active and connected: its field glows. */
  alive: boolean;
  /** Something real is happening for it now: brighter, denser, faster. */
  working: boolean;
}

export interface RotundaOpts {
  phone: boolean;
  reduce: boolean;
  seats: RotundaSeat[];
  /** The docket item on the floor now (its key), or null between items. */
  onFloor: (key: string | null) => void;
  /** An item's ritual has run: its card takes its stamp. */
  onDone: (key: string) => void;
  /** Where each pod (and "kernel", Skippy) is on screen, in the host's CSS pixels, every frame. */
  onPlace: (id: string, x: number, y: number, visible: boolean) => void;
  /** Pixels at the host's bottom that captions keep clear of (the docket). */
  safeBottom: () => number;
}

export interface Rotunda {
  setSeats: (seats: RotundaSeat[]) => void;
  setDocket: (items: RiteItem[]) => void;
  /** Real lines for the interludes between items: a lit member's status, from the Council's feed. */
  setAmbient: (lines: { by: string; text: string }[]) => void;
  /** Bring an item to the floor now. */
  bring: (key: string) => void;
  setHot: (id: string | null) => void;
  dispose: () => void;
}

const COUNTER_LIGHT = new Color(COUNTER_COLOUR);
const TYPE_LIGHT: Record<RiteKind | "idle", Color> = { duty: new Color("#dfe9ff"), decision: new Color("#ffe7b8"), repair: new Color("#ffc2a8"), idle: new Color("#fff4e0") };
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];
const PHONE_W = 760;

interface Pod {
  s: RotundaSeat;
  g: Group;
  shell: Mesh;
  ring: Mesh<TorusGeometry, MeshBasicMaterial>;
  glow: PointLight;
  mat: MeshStandardMaterial;
  pad: Sprite;
  home: Vector3;
  at: Vector3;
  prev: Vector3;
  vel: Vector3;
  tw: { from: Vector3; to: Vector3; t0: number; dur: number } | null;
  lit: number;
  litTo: number;
  base: number;
  dis: number;
  disTo: number;
  phase: number;
  speaking: boolean;
  hot: boolean;
  light: Spot | null;
  /** The Skippy in it (#775). */
  a: Actor;
}
interface Spot {
  l: SpotLight;
  /** Its visible beam: a soft cone from the light down onto the Skippy it follows. */
  beam: Mesh<CylinderGeometry, MeshBasicMaterial>;
  on: number;
  to: number;
  pod: Pod | null;
}
type Slot = "a" | "b" | "c" | "d";

const baseOf = (s: RotundaSeat) => (s.working ? 0.85 : s.alive ? 0.5 : 0.14);

export async function createRotunda(host: HTMLElement, canvas: HTMLCanvasElement, opts: RotundaOpts): Promise<Rotunda> {
  const { reduce } = opts;
  const PH0 = opts.phone;
  const gltf = await cachedModel<GLTF>(SKIPPY_MODEL, () => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(modelUrl(SKIPPY_MODEL));
  });

  const renderer = new WebGLRenderer({ canvas, antialias: !PH0, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PH0 ? 1.25 : 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = !PH0;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(0x07080d);
  scene.fog = new FogExp2(0x0a0c16, 0.034);
  const cam = new PerspectiveCamera(40, 1, 0.1, 120);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  // ---- the chamber ------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x9aa4d0, 0x06060a, 0.65));
  const moon = new DirectionalLight(0xbfc8ff, 0.5);
  moon.position.set(-6, 14, 8);
  scene.add(moon);
  const shaft = new SpotLight(0xffefcf, 160, 22, 0.24, 0.55, 1.2);
  shaft.position.set(0, 16, 0);
  shaft.target.position.set(0, 0, 0);
  shaft.castShadow = !PH0;
  scene.add(shaft, shaft.target);
  const beamMat = keep(new MeshBasicMaterial({ color: 0xffe6b8, transparent: true, opacity: 0.045, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  const beam = new Mesh(keep(new CylinderGeometry(0.6, 2.0, 16, 48, 1, true)), beamMat);
  beam.position.y = 8;
  const beam2Mat = keep(beamMat.clone());
  beam2Mat.opacity = 0.05;
  const beam2 = new Mesh(keep(new CylinderGeometry(0.3, 1.2, 16, 48, 1, true)), beam2Mat);
  beam2.position.y = 8;
  scene.add(beam, beam2);
  const floor = new Mesh(keep(new CircleGeometry(30, 96)), keep(new MeshStandardMaterial({ color: 0x0c0d14, roughness: 0.45, metalness: 0.4 })));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const gold = (r: number, y: number, o = 0.5, w = 0.01) => {
    const m = new Mesh(keep(new TorusGeometry(r, w, 6, 220)), keep(new MeshBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: o })));
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    scene.add(m);
    return m;
  };
  // The floor's inlaid rings and the podium's steps.
  [2.2, 3.4, 5.2].forEach((r, i) => gold(r, 0.01, 0.35 - i * 0.08));
  const stepMat = keep(new MeshStandardMaterial({ color: 0x15151d, metalness: 0.65, roughness: 0.32 }));
  const steps: [number, number][] = [[1.9, 0.35], [1.45, 0.75], [1.05, 1.2]];
  steps.forEach(([r, h], i) => {
    const below = i ? steps[i - 1]![1] : 0;
    const s = new Mesh(keep(new CylinderGeometry(r, r + 0.12, h - below, 72)), stepMat);
    s.position.y = (h + below) / 2;
    s.castShadow = s.receiveShadow = true;
    scene.add(s);
    gold(r, h + 0.002, 0.8, 0.012);
  });
  // The bowl's wall: the gallery's tiers, one inner wall with gold tier lines and a few lit windows.
  const wallMat = keep(
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { t: { value: 0 } },
      vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vU; uniform float t;
        void main(){ float h = vU.y; vec3 deep = vec3(.018,.022,.04), haze = vec3(.07,.09,.16);
          vec3 c = mix(deep, haze, smoothstep(.05,.75,h)); c = mix(c, vec3(.03,.035,.06), smoothstep(.8,1.,h));
          float tier = smoothstep(.0,.5,fract(h*14.)) * smoothstep(1.,.86,fract(h*14.)); c += vec3(.025,.022,.016)*(1.-tier)*smoothstep(.05,.7,h);
          float win = step(.82, fract(vU.x*220.)) * step(.6, fract(h*14.+.3)) * step(fract(sin(floor(vU.x*220.)*12.9+floor(h*14.)*78.2)*43758.5),.35);
          c += vec3(1.,.8,.5)*win*.10*(.6+.4*sin(t*.7+vU.x*90.))*smoothstep(.15,.7,h);
          gl_FragColor = vec4(c,1.); }`,
    }),
  );
  const wall = new Mesh(keep(new CylinderGeometry(24, 13, 22, 96, 1, true)), wallMat);
  wall.position.y = 10.5;
  scene.add(wall);
  for (let k = 0; k < 10; k++) gold(9.4 + k * 1.15, 0.6 + k * 1.35, 0.22 - k * 0.018, 0.008);
  // No light slants in from the oculus any more (Nikita, 2026-11-05): the only beams are the chair's shaft and a
  // spotlight on whoever has the floor.

  // The gallery: hundreds of pods, instanced silhouettes with a pinprick light each.
  const N = PH0 ? 420 : 980;
  const crowd = new InstancedMesh(keep(new CylinderGeometry(0.34, 0.2, 0.18, 8)), keep(new MeshStandardMaterial({ color: 0x1a1b24, metalness: 0.5, roughness: 0.6, emissive: 0x0c0e18 })), N);
  const lp = new Float32Array(N * 3);
  const lr = new Float32Array(N);
  const lc = new Float32Array(N * 3);
  {
    const M = new Matrix4();
    const q = new Quaternion();
    const V = new Vector3();
    const S1 = new Vector3(1, 1, 1);
    const UP = new Vector3(0, 1, 0);
    const warm = new Color(0xffcf8a);
    const cool = new Color(0x8fb4ff);
    for (let i = 0; i < N; i++) {
      const tier = i % 10;
      const r = 9.8 + tier * 1.15 + Math.random() * 0.3;
      const a = (i / N) * Math.PI * 2 * 10.13 + Math.random() * 0.05;
      const y = 0.9 + tier * 1.35 + Math.random() * 0.25;
      V.set(Math.cos(a) * r, y, Math.sin(a) * r);
      q.setFromAxisAngle(UP, -a);
      M.compose(V, q, S1);
      crowd.setMatrixAt(i, M);
      lp.set([V.x * 0.985, y + 0.16, V.z * 0.985], i * 3);
      lr[i] = Math.random();
      (Math.random() < 0.7 ? warm : cool).toArray(lc, i * 3);
    }
  }
  scene.add(crowd);
  const cg = keep(new BufferGeometry());
  cg.setAttribute("position", new BufferAttribute(lp, 3));
  cg.setAttribute("rnd", new BufferAttribute(lr, 1));
  cg.setAttribute("tint", new BufferAttribute(lc, 3));
  const crowdU = { t: { value: 0 }, vote: { value: 0 }, share: { value: 0 }, px: { value: renderer.getPixelRatio() } };
  const lights = new Points(
    cg,
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: crowdU,
        vertexShader: `attribute float rnd; attribute vec3 tint; uniform float t, vote, share, px; varying vec3 vC; varying float vA;
          void main(){ bool aye = rnd < share; float tw = .45 + .35*sin(t*1.3 + rnd*40.);
            vC = mix(tint, vec3(1., .82, .45), aye ? vote : 0.); vA = tw * (aye ? 1. + vote*1.4 : 1. - vote*.5);
            vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = (aye ? 2.2 + vote*1.6 : 2.0) * px * (14./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor = vec4(vC, vA*(1.-d*2.)); }`,
      }),
    ),
  );
  scene.add(lights);
  // Dust in the podium's light.
  const D = PH0 ? 120 : 260;
  const dp = new Float32Array(D * 3);
  const ds = new Float32Array(D);
  for (let i = 0; i < D; i++) {
    const r = Math.random() * 1.6;
    const a = Math.random() * 6.28;
    dp.set([Math.cos(a) * r, Math.random() * 12, Math.sin(a) * r], i * 3);
    ds[i] = 0.2 + Math.random() * 0.6;
  }
  const dg = keep(new BufferGeometry());
  dg.setAttribute("position", new BufferAttribute(dp, 3));
  scene.add(new Points(dg, keep(new PointsMaterial({ color: 0xffe4b0, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending }))));

  // ---- the Skippies -----------------------------------------------------------------------------------------------
  let shadowTick: (T: number) => void = () => {};
  const proto = gltf.scene;
  proto.updateMatrixWorld(true);
  let body: SkinnedMesh | null = null;
  proto.traverse((o) => {
    if (!body && (o as SkinnedMesh).isSkinnedMesh) body = o as SkinnedMesh;
  });
  const protoMap: Texture | null = body ? (((body as SkinnedMesh).material as MeshStandardMaterial).map ?? null) : null;
  const box = new Box3().setFromObject(proto);
  const centre = box.getCenter(new Vector3());
  const height = box.max.y - box.min.y || 0.8;
  const bones = new Map<string, Bone>();
  proto.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ""), o as Bone);
  });
  const bind = new Map([...bones].map(([k, b]) => [k, b.quaternion.clone()]));
  const poses = new Map<Pose, Map<string, Quaternion>>();
  for (const id of senatePoses()) {
    const aims = POSES[id];
    for (const n of ARMS) bones.get(n)?.quaternion.copy(bind.get(n) ?? new Quaternion());
    for (const n of ARMS) {
      const b = bones.get(n);
      const c = bones.get(CHILD[n]);
      const d = aims[n];
      if (!b || !c || !b.parent || !d) continue;
      proto.updateMatrixWorld(true);
      const from = c.getWorldPosition(new Vector3()).sub(b.getWorldPosition(new Vector3())).normalize();
      const qq = new Quaternion().setFromUnitVectors(from, new Vector3(...d).normalize());
      b.quaternion.copy(b.parent.getWorldQuaternion(new Quaternion()).invert().multiply(qq.multiply(b.getWorldQuaternion(new Quaternion()))));
    }
    poses.set(id, new Map(ARMS.map((n) => [n, bones.get(n)?.quaternion.clone() ?? new Quaternion()])));
  }
  // The shared model goes back to its bind pose (modelCache.ts): every clone below takes its own.
  for (const [n, q] of bind) bones.get(n)?.quaternion.copy(q);
  proto.updateMatrixWorld(true);
  // Each can's face (#775): the Talk hologram's cap, fitted once to the head at the bind pose and shared by every can.
  let capGeo: SphereGeometry | null = null;
  if (body) {
    try {
      const g = keep(new SphereGeometry(HEAD.r, 32, 16, Math.PI / 2 - PHI / 2, PHI, TH0, TH1 - TH0));
      fitCap(g, body, 32, 16);
      capGeo = g;
    } catch {
      /* no face to move: the painted one stays */
    }
  }
  const rig: SenateRig = { poses, capGeo, faceW: PH0 ? 256 : 512, faceH: PH0 ? 128 : 256, reduce, budget: 0 };

  const makeCan = (id: string, colour: string | null, scale: number, y0: number) => {
    const model = cloneSkinned(proto);
    let mesh: SkinnedMesh | null = null;
    const bs = new Map<string, Bone>();
    model.traverse((o) => {
      if ((o as Bone).isBone) bs.set(o.name.replace(/^mixamorig:?/, ""), o as Bone);
      if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
    });
    const sk = mesh as SkinnedMesh | null;
    const mat = keep(((sk?.material as MeshStandardMaterial | undefined) ?? new MeshStandardMaterial()).clone());
    if (colour && protoMap) mat.map = recolor(`rotunda-${colour}`, protoMap, [{ band: NAVY, color: colour }]);
    mat.emissive = new Color(colour ?? "#8f9cff");
    mat.emissiveIntensity = 0;
    if (sk) {
      sk.material = mat;
      sk.castShadow = !PH0;
      sk.frustumCulled = false;
    }
    const inner = new Group();
    // Its face goes on while the clone still stands at the model's own origin, then it moves into place and takes its pose.
    const a = makeActor(id, model, inner, y0, mat, rig, keep);
    model.position.copy(centre).multiplyScalar(-1);
    const P = poses.get(senatorOf(id).rest);
    if (P) for (const n of ARMS) bs.get(n)?.quaternion.copy(P.get(n)!);
    inner.add(model);
    inner.scale.setScalar(scale / height);
    inner.position.y = y0;
    return { inner, mat, a };
  };
  // Skippy, presiding.
  const sk = makeCan("kernel", null, 1.55, 0);
  const skG = new Group();
  skG.add(sk.inner);
  skG.position.set(0, 2.0, 0);
  scene.add(skG);

  // The shadow senators (Nikita, 2026-11-05): the gallery's pods aren't empty. A share of them hold a dark silhouette of
  // the can, one baked bind-pose geometry drawn instanced, with a faint rim of light and a slow sway in the shader: an
  // audience of shadowy Skippies, never members. No rigs, no per-figure work on the CPU.
  if (body) {
    const src = (body as SkinnedMesh).geometry;
    const g = keep(new BufferGeometry());
    g.setAttribute("position", src.getAttribute("position").clone());
    const nrm = src.getAttribute("normal");
    if (nrm) g.setAttribute("normal", nrm.clone());
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4((body as SkinnedMesh).matrixWorld);
    g.translate(-centre.x, -box.min.y, -centre.z);
    if (!nrm) g.computeVertexNormals();
    const NS = PH0 ? 70 : 190;
    const shadowU = { t: { value: 0 } };
    const shadowMat = keep(
      new ShaderMaterial({
        uniforms: shadowU,
        vertexShader: `uniform float t; varying float vRim; varying float vH;
          void main(){ float id = float(gl_InstanceID); vec3 p = position; float sw = sin(t*.45 + id*1.73)*.05 + sin(t*.21 + id*.61)*.03;
            p.x += sw * p.y; vH = p.y;
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.); vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
            vRim = pow(1. - abs(dot(n, normalize(-mv.xyz))), 2.6); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vRim; varying float vH;
          void main(){ vec3 c = vec3(.028, .03, .045) + vec3(.55, .62, .95) * vRim * .55 * smoothstep(.0, .5, vH); gl_FragColor = vec4(c, 1.); }`,
      }),
    );
    const shadows = new InstancedMesh(g, shadowMat, NS);
    const M = new Matrix4();
    const q = new Quaternion();
    const V = new Vector3();
    const S = new Vector3();
    const UP = new Vector3(0, 1, 0);
    const sc = 0.62 / height;
    let n = 0;
    // Spread across the gallery: every few pods, more on the lower tiers, which the camera sees best.
    for (let i = 0; i < N && n < NS; i++) {
      const tier = i % 10;
      if (tier > 6 || (i * 7919) % (tier < 3 ? 3 : 5) !== 0) continue;
      crowd.getMatrixAt(i, M);
      V.setFromMatrixPosition(M);
      // None on the camera's side of the bowl, where one would loom over the floor.
      const off = Math.atan2(Math.sin(Math.atan2(V.z, V.x) - Math.PI / 2), Math.cos(Math.atan2(V.z, V.x) - Math.PI / 2));
      if (Math.abs(off) < 1.25) continue;
      q.setFromAxisAngle(UP, Math.atan2(-V.x, -V.z));
      S.setScalar(sc * (0.9 + ((i * 31) % 7) * 0.03));
      V.y += 0.09;
      shadows.setMatrixAt(n++, M.compose(V, q, S));
    }
    shadows.count = n;
    shadows.frustumCulled = false;
    scene.add(shadows);
    shadowTick = (T: number) => (shadowU.t.value = T);
  }

  // The pods: identical dark bronze, each floating on a field of particles in its room's colour.
  const R = 7.2;
  const podMat = keep(new MeshStandardMaterial({ color: 0x3a3027, metalness: 0.8, roughness: 0.38 }));
  const rimMat = keep(new MeshStandardMaterial({ color: 0x8a6d43, metalness: 0.9, roughness: 0.3 }));
  const shellG = keep(new CylinderGeometry(0.78, 0.42, 0.42, 40));
  const rimG = keep(new TorusGeometry(0.78, 0.022, 8, 80));
  const ringG = keep(new TorusGeometry(0.98, 0.022, 8, 90));
  const fieldTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.4, "rgba(255,255,255,.35)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const seats = opts.seats;
  // Each pod's recoloured skin is a full pixel pass over the model's texture: done here one at a time, yielding between
  // (#784), so the build is many short tasks instead of one long one. makeCan below finds each in recolor's cache.
  if (protoMap)
    for (const s of seats) {
      recolor(`rotunda-${s.colour}`, protoMap, [{ band: NAVY, color: s.colour }]);
      await yieldNow();
    }
  const pods: Pod[] = seats.map((s, i) => {
    const a = Math.PI / 2 + Math.PI * 0.27 + (i / Math.max(1, seats.length - 1)) * Math.PI * 1.46;
    const home = new Vector3(Math.cos(a) * R, i % 2 ? 2.7 : 1.9, Math.sin(a) * R);
    const g = new Group();
    g.position.copy(home);
    scene.add(g);
    const shell = new Mesh(shellG, podMat);
    shell.castShadow = shell.receiveShadow = !PH0;
    const rim = new Mesh(rimG, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.21;
    const ring = new Mesh(ringG, keep(new MeshBasicMaterial({ color: COUNTER_COLOUR, transparent: true, opacity: 0 })));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    const glow = new PointLight(0xffe2b8, 0, 3.2, 1.6);
    glow.position.y = 0.9;
    const can = makeCan(s.id, s.colour, 0.95, 0.62);
    g.add(shell, rim, ring, glow, can.inner);
    const pad = new Sprite(keep(new SpriteMaterial({ map: fieldTex, color: s.colour, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false })));
    pad.position.y = -0.34;
    pad.scale.set(1.5, 0.75, 1);
    g.add(pad);
    const base = baseOf(s);
    return { s, g, shell, ring, glow, mat: can.mat, pad, home, at: home.clone(), prev: home.clone(), vel: new Vector3(), tw: null, lit: base, litTo: base, base, dis: 0, disTo: 0, phase: Math.random() * 6, speaking: false, hot: false, light: null, a: can.a };
  });
  const actors: Actor[] = [sk.a, ...pods.map((p) => p.a)];
  /** Who has the floor: the last to start a line that is still going. */
  let talker: Actor | null = null;
  let talkerWas: string | null = null;
  const talkFor = (text: string) => Math.min(5, 0.8 + text.length * 0.055);
  const byId = (id: string) => pods.find((p) => p.s.id === id) ?? null;
  // The floor's places: u for a duty, r for a report, a/b/c for advocates, d beside a contested advocate.
  const SPOT = { u: new Vector3(-2.3, 2.4, 2.8), r: new Vector3(2.4, 2.9, 2.4), a: new Vector3(-3.0, 2.7, 2.0), b: new Vector3(3.0, 2.7, 2.0), c: new Vector3(0, 4.7, -1.7), d: new Vector3(-4.7, 3.7, 0.2) };
  type SpotId = keyof typeof SPOT;
  // A unit cone, narrow at the light, wide at the floor, pivoting from its top so it can be pointed and stretched.
  const beamG = keep(new CylinderGeometry(0.12, 0.85, 1, 32, 1, true));
  beamG.translate(0, -0.5, 0);
  const lightPool: Spot[] = [0, 1, 2, 3].map(() => {
    const l = new SpotLight(0xffffff, 0, 12, 0.3, 0.6, 1.3);
    l.visible = false;
    scene.add(l, l.target);
    const beam = new Mesh(beamG, keep(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })));
    beam.visible = false;
    scene.add(beam);
    return { l, beam, on: 0, to: 0, pod: null };
  });
  const beamDir = new Vector3();
  const beamUp = new Vector3(0, -1, 0);

  // ---- sizing and the camera --------------------------------------------------------------------------------------
  const phone = () => host.clientWidth < PHONE_W;
  const size = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < PHONE_W ? 58 : 40;
    cam.updateProjectionMatrix();
    crowdU.px.value = renderer.getPixelRatio();
  };
  size();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(host);
  const look = new Vector3(0, 2.2, 0);
  const lookTo = look.clone();
  let dolly = 1;
  let dollyTo = 1;

  // ---- the overlays: the chair's line, the speakers' captions, the gallery's murmurs ------------------------------
  const div = (cls: string) => {
    const d = document.createElement("div");
    d.className = cls;
    host.append(d);
    return d;
  };
  const chairEl = div("rt-chair");
  chairEl.setAttribute("aria-live", "polite");
  const SLOTS: Slot[] = ["a", "b", "c", "d"];
  const caps = Object.fromEntries(
    SLOTS.map((k) => {
      const c = div("rt-cap");
      c.setAttribute("aria-hidden", "true");
      const who = document.createElement("div");
      who.className = "rt-cap-who";
      const p = document.createElement("p");
      c.append(who, p);
      return [k, { c, who, p }];
    }),
  ) as Record<Slot, { c: HTMLDivElement; who: HTMLDivElement; p: HTMLParagraphElement }>;
  const capOf: Record<Slot, Pod | null> = { a: null, b: null, c: null, d: null };
  const capT: Record<Slot, number> = { a: 0, b: 0, c: 0, d: 0 };
  const clock = { t: 0 };
  let chairTimer = 0;
  const chair = (txt: string) => {
    if (txt) {
      onChair();
      startTalk(sk.a, clock.t, clock.t + 0.25 + talkFor(txt));
      talker = sk.a;
    }
    chairEl.classList.remove("on");
    window.clearTimeout(chairTimer);
    chairTimer = window.setTimeout(
      () => {
        chairEl.textContent = txt;
        if (txt) chairEl.classList.add("on");
      },
      txt ? 250 : 0,
    );
  };
  const say = (slot: Slot, p: Pod | null, line?: RiteLine, counter = false, leadAfter = false) => {
    const { c, who, p: para } = caps[slot];
    c.classList.toggle("ctr", counter);
    who.textContent = p ? `${p.s.title} · ${p.s.room}` : "";
    c.style.color = p?.s.colour ?? "";
    para.replaceChildren();
    if (line) {
      const b = line.lead ? Object.assign(document.createElement("b"), { textContent: line.lead }) : null;
      if (b && !leadAfter) para.append(b, " ");
      para.append(line.text);
      if (b && leadAfter) para.append(document.createElement("br"), b);
    }
    capOf[slot] = line ? p : null;
    capT[slot] = clock.t;
    if (line && p) {
      startTalk(p.a, clock.t, clock.t + talkFor(`${line.lead ?? ""}${line.text}`));
      talker = p.a;
    }
    c.classList.toggle("on", !!line);
  };
  const clearCaps = () => SLOTS.forEach((k) => say(k, null));
  const proj = new Vector3();
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const placeCaps = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const ph = phone();
    const bottom = opts.safeBottom();
    placed.length = 0;
    const live = SLOTS.filter((k) => capOf[k]).sort((x, y) => capT[x] - capT[y]);
    const newest = live[live.length - 1];
    for (const k of SLOTS) {
      const p = capOf[k];
      const c = caps[k].c;
      if (!p) continue;
      if (ph) {
        c.style.opacity = k === newest ? "" : "0";
        const y = Math.max(96, h - bottom - c.offsetHeight - 12);
        c.style.transform = `translate(10px,${y}px)`;
        if (k === newest) placed.push({ x: 10, y, w: c.offsetWidth, h: c.offsetHeight });
        continue;
      }
      c.style.opacity = "";
      proj.set(0, 1.35, 0);
      p.g.localToWorld(proj);
      proj.project(cam);
      let x = ((proj.x + 1) / 2) * w;
      let y = ((1 - proj.y) / 2) * h;
      const cw = c.offsetWidth;
      const chh = c.offsetHeight;
      x = x < w / 2 ? x - cw + 40 : x - 40;
      x = Math.max(10, Math.min(w - cw - 10, x));
      y = Math.max(150, y - chh);
      for (const r of placed) if (x < r.x + r.w && x + cw > r.x && y < r.y + r.h + 8 && y + chh + 8 > r.y) y = r.y + r.h + 10;
      y = Math.min(y, h - bottom - 24 - chh);
      placed.push({ x, y, w: cw, h: chh });
      c.style.transform = `translate(${x}px,${y}px)`;
    }
  };
  const place = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    proj.set(0, skG.position.y + 1.0, 0).project(cam);
    opts.onPlace("kernel", ((proj.x + 1) / 2) * w, ((1 - proj.y) / 2) * h, proj.z < 1);
    for (const p of pods) {
      proj.set(0, 0.55, 0);
      p.g.localToWorld(proj);
      proj.project(cam);
      opts.onPlace(p.s.id, ((proj.x + 1) / 2) * w, ((1 - proj.y) / 2) * h, proj.z < 1);
    }
  };

  // The gallery's murmurs: a few dim lines near crowd pods, clear of the captions, the chair and the docket.
  const murEls = Array.from({ length: MURMUR_MAX.wide }, () => {
    const d = div("rt-mur");
    d.setAttribute("aria-hidden", "true");
    return { d, i: -1, x: 0, y: 0, until: 0 };
  });
  let kind: RiteKind | "idle" = "idle";
  let nextMur = 2;
  const murmur = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const ph = phone();
    const cap = ph ? MURMUR_MAX.phone : MURMUR_MAX.wide;
    const free = murEls.filter((m) => m.i < 0);
    if (murEls.length - free.length >= cap || !free.length) return;
    const text = murmurFor(kind, Math.random(), Math.random());
    const bottom = opts.safeBottom();
    for (let tries = 0; tries < 16; tries++) {
      const i = Math.floor(Math.random() * N);
      proj.set(lp[i * 3]!, lp[i * 3 + 1]! + 0.3, lp[i * 3 + 2]!).project(cam);
      if (proj.z > 1) continue;
      const x = ((proj.x + 1) / 2) * w;
      const y = ((1 - proj.y) / 2) * h;
      if (x < w * 0.06 || x > w * 0.94 || y < (ph ? 120 : 150) || y > h - bottom - 30) continue;
      if (placed.some((r) => x > r.x - 70 && x < r.x + r.w + 70 && y > r.y - 30 && y < r.y + r.h + 30)) continue;
      if (murEls.some((m) => m.i >= 0 && Math.abs(m.x - x) < 140 && Math.abs(m.y - y) < 40)) continue;
      const m = free[0]!;
      m.i = i;
      m.x = x;
      m.y = y;
      m.until = clock.t + 3 + Math.random() * 1.5;
      m.d.textContent = text;
      m.d.classList.add("on");
      return;
    }
  };
  const placeMurs = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    for (const m of murEls) {
      if (m.i < 0) continue;
      if (clock.t > m.until) {
        m.d.classList.remove("on");
        if (clock.t > m.until + 2.6) m.i = -1;
      }
      proj.set(lp[m.i * 3]!, lp[m.i * 3 + 1]! + 0.3, lp[m.i * 3 + 2]!).project(cam);
      m.x = ((proj.x + 1) / 2) * w;
      m.y = ((1 - proj.y) / 2) * h;
      m.d.style.transform = `translate(${m.x}px,${m.y}px) translate(-50%,-100%)`;
    }
  };

  // ---- the session ------------------------------------------------------------------------------------------------
  let docket: RiteItem[] = [];
  let ambient: { by: string; text: string }[] = [];
  let token = 0;
  let dead = false;
  // The session runs on the scene's own clock, so it pauses with the chamber (out of view, a hidden tab) and picks up where it was.
  const sleep = (ms: number, tk: number) =>
    new Promise<void>((res, rej) => {
      const end = clock.t + (reduce ? ms * 0.6 : ms) / 1000;
      const f = () => {
        if (tk !== token || dead) return rej(new Error("cancel"));
        if (clock.t >= end) return res();
        window.setTimeout(f, 50);
      };
      f();
    });
  const glide = (p: Pod, to: Vector3, dur = 2600) => {
    p.tw = { from: p.at.clone(), to: to.clone(), t0: clock.t, dur: (reduce ? 300 : dur) / 1000 };
  };
  const goIn = (p: Pod, spot: SpotId, counter = false) => {
    p.speaking = true;
    glide(p, SPOT[spot]);
    p.litTo = 1;
    p.disTo = counter ? 1 : 0;
    // Its own light if it already has one (it used to take a second and leave the first on over an empty seat); else a
    // free one, or the one that has been fading longest.
    let L = p.light;
    if (!L) {
      L = lightPool.find((x) => !x.pod) ?? lightPool.reduce((a, b) => (b.to === 0 && b.on < a.on ? b : a));
      if (L.pod && L.pod !== p) L.pod.light = null;
    }
    L.pod = p;
    L.to = 1;
    L.l.target = p.g;
    L.l.color.copy(counter ? COUNTER_LIGHT : TYPE_LIGHT[kind]);
    p.light = L;
  };
  const goHome = (p: Pod) => {
    if (!p.speaking) return;
    p.speaking = false;
    glide(p, p.home, 3000);
    p.litTo = p.base;
    p.disTo = 0;
    // Its light fades as it leaves, still on it; it lets go once dark (the frame loop).
    if (p.light) p.light.to = 0;
  };
  const allHome = () => pods.forEach(goHome);
  let shareTo = 0;
  let voteTo = 0;
  let focus: Pod | null = null;
  // A pod that isn't seated (a Desk-only room missing from the Council) speaks through the chair instead.
  const podOr = (id: string) => byId(id);

  async function runItem(m: RiteItem, tk: number) {
    kind = m.kind;
    opts.onFloor(m.key);
    clearCaps();
    shareTo = 0;
    voteTo = 0;
    chair(m.clerk);
    lookTo.set(0, 2.4, 0.8);
    dollyTo = 1;
    await sleep(2200, tk);
    if (m.kind === "duty") {
      const p = podOr(m.by);
      if (p) {
        goIn(p, "u");
        focus = p;
        lookTo.set(-1, 2.3, 1.4);
        dollyTo = 0.92;
        await sleep(2300, tk);
        say("a", p, m.say);
      } else chair(m.say?.text ?? "");
      await sleep(3200, tk);
      chair(m.done);
      opts.onDone(m.key);
      voteTo = 1;
      shareTo = 0.85;
      await sleep(3000, tk);
    } else if (m.kind === "decision") {
      const slots: [Slot, SpotId][] = [["a", "a"], ["c", "c"], ["b", "b"]];
      const opts2 = m.options ?? [];
      for (let k = 0; k < opts2.length; k++) {
        const o = opts2[k]!;
        const p = podOr(o.by);
        const [slot, spot] = slots[k % slots.length]!;
        chair(chairLine.recognize(o.by, o.label));
        if (p) {
          goIn(p, spot);
          focus = p;
          lookTo.set(SPOT[spot].x * 0.4, 2.6, 0.8);
          dollyTo = 0.95;
        }
        await sleep(2200, tk);
        say(slot, p, o.say);
        await sleep(2900, tk);
        if (m.counter && m.counter.on === k) {
          const c = podOr(m.counter.by);
          chair(chairLine.tradeoff(m.counter.by));
          if (c) {
            goIn(c, "d", true);
            focus = c;
          }
          await sleep(2200, tk);
          say("d", c, m.counter.say, true);
          await sleep(3400, tk);
        }
      }
      chair(m.done);
      opts.onDone(m.key);
      voteTo = 1;
      shareTo = 0.5;
      lookTo.set(0, 2.6, 0.4);
      dollyTo = 1.04;
      focus = null;
      await sleep(4600, tk);
    } else {
      const p = podOr(m.by);
      chair(chairLine.report(m.by));
      if (p) {
        goIn(p, "r");
        focus = p;
        lookTo.set(1, 2.5, 1.2);
        dollyTo = 0.93;
      }
      await sleep(2300, tk);
      say("b", p, m.report, false, true);
      await sleep(3600, tk);
      if (m.risk) {
        const c = podOr(m.risk.by);
        chair(chairLine.risk());
        if (c) {
          goIn(c, c === p ? "a" : "a", true);
          focus = c;
          lookTo.set(-0.4, 2.5, 1.2);
        }
        await sleep(2200, tk);
        say("a", c, m.risk.say, true);
        await sleep(3200, tk);
      }
      chair(m.done);
      opts.onDone(m.key);
      lookTo.set(0, 2.4, 0.6);
      dollyTo = 1;
      focus = null;
      await sleep(3400, tk);
    }
    clearCaps();
    allHome();
    voteTo = 0;
    shareTo = 0;
    kind = "idle";
    await sleep(2600, tk);
  }
  async function interlude(k: number, tk: number) {
    chair("");
    opts.onFloor(null);
    kind = "idle";
    const it = ambient.length ? ambient[k % ambient.length]! : null;
    const p = it ? byId(it.by) : null;
    if (!it || !p) {
      await sleep(4000, tk);
      return;
    }
    goIn(p, "u");
    focus = p;
    lookTo.set(-1, 2.3, 1.3);
    dollyTo = 0.95;
    await sleep(2300, tk);
    say("a", p, { text: it.text });
    await sleep(3400, tk);
    say("a", null);
    goHome(p);
    focus = null;
    lookTo.set(0, 2.2, 0);
    dollyTo = 1;
    await sleep(2400, tk);
  }
  async function session(startKey: string | null) {
    const tk = ++token;
    allHome();
    clearCaps();
    try {
      let i = startKey ? Math.max(0, docket.findIndex((m) => m.key === startKey)) : 0;
      for (let k = 0; ; k++) {
        const m = docket.length ? docket[i % docket.length] : null;
        if (m) await runItem(m, tk);
        await interlude(k, tk);
        i = m ? (docket.findIndex((x) => x.key === m.key) + 1 || i + 1) : 0;
      }
    } catch {
      /* a new session took over, or the chamber closed */
    }
  }

  // ---- atmosphere: haze and sigil nanites -------------------------------------------------------------------------
  const hazeTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    for (let k = 0; k < 18; k++) {
      const x = 40 + Math.random() * 48;
      const y = 40 + Math.random() * 48;
      const r = 20 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,.22)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const haze = Array.from({ length: PH0 ? 8 : 16 }, (_, i) => {
    const inShaft = i % 3 === 0;
    const s = new Sprite(keep(new SpriteMaterial({ map: hazeTex, color: inShaft ? 0xffe9c8 : 0x8fa2d0, transparent: true, opacity: inShaft ? 0.09 : 0.06, depthWrite: false })));
    const r = inShaft ? Math.random() * 0.8 : 3 + Math.random() * 6;
    const a = Math.random() * 6.28;
    s.position.set(Math.cos(a) * r, inShaft ? Math.random() * 10 : 0.8 + Math.random() * 6, Math.sin(a) * r);
    s.scale.setScalar(inShaft ? 2.4 + Math.random() * 1.5 : 5 + Math.random() * 4);
    s.userData = { inShaft, a, r, w: (Math.random() - 0.5) * 0.04, rot: (Math.random() - 0.5) * 0.05 };
    scene.add(s);
    return s;
  });

  // Nanites: the sigil glyphs from one atlas. Drifters in the air, a field under each pod, and a share of the drifters
  // that gathers round the podium whenever the chair speaks.
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
  const NA = PH0 ? 110 : 420;
  const NT = PH0 ? 6 : 14;
  const NM = PH0 ? 8 : 22;
  const NN = NA + NT * pods.length;
  const np = new Float32Array(NN * 3);
  const nc = new Float32Array(NN * 3);
  const na = new Float32Array(NN);
  const ng = new Float32Array(NN);
  const ns = new Float32Array(NN);
  const seed = Float32Array.from({ length: NN }, () => Math.random());
  const seed2 = Float32Array.from({ length: NN }, () => Math.random());
  const seed3 = Float32Array.from({ length: NN }, () => Math.random());
  const amb = Array.from({ length: NA }, () => ({ r: 1.5 + Math.random() * 8, a: Math.random() * 6.28, y: 0.6 + Math.random() * 8, w: (0.02 + Math.random() * 0.05) * (Math.random() < 0.5 ? -1 : 1), up: 0.05 + Math.random() * 0.12 }));
  const gold2 = new Color(0xe8c77a);
  const podCol = pods.map((p) => new Color(p.s.colour));
  for (let i = 0; i < NN; i++) {
    ng[i] = Math.floor(Math.random() * NG);
    ns[i] = i < NA ? 0.7 + Math.random() * 0.6 : 0.6 + Math.random() * 0.4;
    (i < NA ? gold2 : podCol[Math.floor((i - NA) / NT)]!).toArray(nc, i * 3);
  }
  const nGeo = keep(new BufferGeometry());
  nGeo.setAttribute("position", new BufferAttribute(np, 3));
  nGeo.setAttribute("tint", new BufferAttribute(nc, 3));
  nGeo.setAttribute("alpha", new BufferAttribute(na, 1));
  nGeo.setAttribute("glyph", new BufferAttribute(ng, 1));
  nGeo.setAttribute("sz", new BufferAttribute(ns, 1));
  const nU = { atlas: { value: atlas }, px: { value: renderer.getPixelRatio() } };
  const nanites = new Points(
    nGeo,
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: nU,
        vertexShader: `attribute vec3 tint; attribute float alpha, glyph, sz; uniform float px; varying vec3 vC; varying float vA; varying vec2 vCell;
          void main(){ vC = tint; vA = alpha; vCell = vec2(mod(glyph, 8.), floor(glyph / 8.)); vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = sz * 24. * px * (6./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec3 vC; varying float vA; varying vec2 vCell;
          void main(){ vec2 uv = (vCell + vec2(gl_PointCoord.x, gl_PointCoord.y)) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard; gl_FragColor = vec4(vC, m*vA); }`,
      }),
    ),
  );
  nanites.frustumCulled = false;
  scene.add(nanites);
  const NMT = NM * pods.length;
  const mp = new Float32Array(NMT * 3);
  const ma = new Float32Array(NMT);
  const mc = new Float32Array(NMT * 3);
  for (let n = 0; n < NMT; n++) podCol[Math.floor(n / NM)]!.toArray(mc, n * 3);
  const mGeo = keep(new BufferGeometry());
  mGeo.setAttribute("position", new BufferAttribute(mp, 3));
  mGeo.setAttribute("alpha", new BufferAttribute(ma, 1));
  mGeo.setAttribute("tint", new BufferAttribute(mc, 3));
  const motes = new Points(
    mGeo,
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: nU,
        vertexShader: `attribute vec3 tint; attribute float alpha; uniform float px; varying vec3 vC; varying float vA; void main(){ vC = tint; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = 15. * px * (6./-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-.5); if (d > .5) discard; float a = 1. - d*2.; gl_FragColor = vec4(mix(vC, vec3(1.), .3), a*a*vA); }`,
      }),
    ),
  );
  motes.frustumCulled = false;
  scene.add(motes);
  // The halo round the Chair's head stays up once formed (Nikita, 2026-11-05): it used to scatter 3.2 s after each
  // line, which read as the nanites exploding every few seconds. A line now only brightens it for a moment.
  let gather = 0;
  const gatherTo = 1;
  let glowUntil = 0;
  function onChair() {
    glowUntil = clock.t + 1.6;
  }
  const tmp3 = new Vector3();
  const stepAtmos = (dt: number, T: number) => {
    const calm = reduce ? 0.15 : 1;
    for (const s of haze) {
      const u = s.userData as { inShaft: boolean; a: number; r: number; w: number; rot: number };
      const mat = s.material;
      if (u.inShaft) {
        s.position.y += dt * 0.35 * calm;
        if (s.position.y > 11) s.position.y = 0.5;
        mat.opacity = 0.09 * Math.sin((Math.PI * s.position.y) / 11.5);
      } else {
        u.a += u.w * dt * calm;
        s.position.x = Math.cos(u.a) * u.r;
        s.position.z = Math.sin(u.a) * u.r;
        s.position.y += Math.sin(T * 0.1 + u.a) * dt * 0.05;
      }
      mat.rotation += u.rot * dt * calm;
    }
    gather += (gatherTo - gather) * (1 - Math.pow(0.6, dt));
    const glow = clock.t < glowUntil ? 1.6 : 1;
    for (let i = 0; i < NA; i++) {
      const m = amb[i]!;
      m.a += m.w * dt * calm;
      m.y += m.up * dt * calm * (m.r < 2.2 ? 3 : 1);
      if (m.y > 9) m.y = 0.6;
      let x = Math.cos(m.a) * m.r;
      let y = m.y + Math.sin(T * 0.4 + i) * 0.15;
      let z = Math.sin(m.a) * m.r;
      const g = seed[i]! < 0.45 ? gather : 0;
      if (g > 0.001) {
        const oa = seed2[i]! * 6.28 + T * (0.6 + seed[i]!) * calm;
        const orr = 1.1 + seed2[i]! * 1.2;
        x += (Math.cos(oa) * orr - x) * g;
        z += (Math.sin(oa) * orr - z) * g;
        y += (2.4 + seed[i]! * 2.2 + Math.sin(oa * 2) * 0.2 - y) * g;
      }
      np[i * 3] = x;
      np[i * 3 + 1] = y;
      np[i * 3 + 2] = z;
      na[i] = (0.3 + 0.18 * Math.sin(T * 1.3 + i)) * (1 + g * 0.9 * glow) * Math.min(1, m.y / 1.2);
    }
    // The suspension fields: glyphs and motes sinking out of each pod's keel in a narrowing cone and fading well above
    // the floor; denser, brighter and faster while the pod works, and left trailing behind a pod in flight.
    for (let pi = 0; pi < pods.length; pi++) {
      const p = pods[pi]!;
      const top = p.g.position;
      if (dt > 0) {
        tmp3.subVectors(top, p.prev).divideScalar(dt);
        p.vel.lerp(tmp3, Math.min(1, dt * 4));
        p.prev.copy(top);
      }
      const depth = 0.6 + p.lit * 0.75;
      const rate = (0.18 + p.lit * (p.speaking ? 0.7 : 0.45)) * calm;
      const dens = 0.3 + 0.7 * p.lit;
      const field = (i: number, n: number, out: Float32Array, alpha: Float32Array, glyph: boolean) => {
        const u = (seed[i]! + T * rate * (glyph ? 0.8 : 1)) % 1;
        const a = seed2[i]! * 6.28 + T * (0.5 + p.lit) * calm + u * 2.5;
        const r = (0.5 - 0.32 * u) * Math.sqrt(seed3[i]!) + 0.04;
        out[n * 3] = top.x + Math.cos(a) * r - p.vel.x * u * 0.35;
        out[n * 3 + 1] = Math.max(0.5, top.y - 0.3 - u * depth - p.vel.y * u * 0.2);
        out[n * 3 + 2] = top.z + Math.sin(a) * r - p.vel.z * u * 0.35;
        alpha[n] = seed3[(i * 7) % NN]! > dens ? 0 : (0.22 + 0.9 * p.lit) * Math.pow(1 - u, 1.3) * Math.min(1, u / 0.06) * (glyph ? 1.5 : 1.2);
      };
      for (let j = 0; j < NT; j++) {
        const i = NA + pi * NT + j;
        field(i, i, np, na, true);
      }
      for (let j = 0; j < NM; j++) {
        const n = pi * NM + j;
        field((n * 13 + 5) % NN, n, mp, ma, false);
      }
    }
    mGeo.attributes.position!.needsUpdate = true;
    mGeo.attributes.alpha!.needsUpdate = true;
    if (!reduce && Math.random() < 0.08) ng[(Math.random() * NN) | 0] = Math.floor(Math.random() * NG);
    nGeo.attributes.position!.needsUpdate = true;
    nGeo.attributes.alpha!.needsUpdate = true;
    nGeo.attributes.glyph!.needsUpdate = true;
  };

  // ---- the loop ---------------------------------------------------------------------------------------------------
  let visible = true;
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((en) => (visible = en[en.length - 1]!.isIntersecting)) : null;
  io?.observe(host);
  let last = performance.now();
  let T = 0;
  let raf = 0;
  const tmp = new Vector3();
  const shaftCol = new Color(0xffe6b8);
  const IDLE_SHAFT = new Color(0xffe6b8);
  const minStep = PH0 ? 1000 / 30 - 2 : 0;
  // WASD to look around the floor (#776); idle or Escape, it eases back to the session's own camera.
  const pan = wasdPan({ el: host, reduce, bounds: () => ({ kind: "disc", cx: 0, cz: 0, r: R + 1 }), origin: () => [look.x, look.z], forward: () => [look.x - cam.position.x, look.z - cam.position.z] });
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.visibilityState === "hidden") {
      last = now;
      return;
    }
    if (now - last < minStep) return;
    const raw = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, raw);
    last = now;
    T += dt;
    // The session's clock keeps near real time on a slow device (a frame counts for up to half a second), so the story
    // still moves; a stall longer than that (a background tab) doesn't skip it ahead.
    clock.t += Math.min(0.5, raw);
    const k = 1 - Math.pow(0.04, dt);
    for (const p of pods) {
      if (p.tw) {
        const u = Math.min(1, (clock.t - p.tw.t0) / p.tw.dur);
        p.at.lerpVectors(p.tw.from, p.tw.to, ease(u));
        if (u >= 1) p.tw = null;
      }
      const target = p.hot ? Math.max(p.litTo, 0.95) : p.litTo;
      p.lit += (target - p.lit) * k;
      p.dis += (p.disTo - p.dis) * k;
      const bob = reduce ? 0 : Math.sin(T * 1.2 + p.phase) * (p.speaking ? 0.08 : 0.04);
      p.g.position.set(p.at.x, p.at.y + bob, p.at.z);
      const face = p.speaking ? Math.atan2(cam.position.x - p.at.x, cam.position.z - p.at.z) : Math.atan2(-p.at.x, -p.at.z);
      let d = face - p.g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.g.rotation.y += d * k * 0.8;
      p.g.rotation.z = reduce ? 0 : Math.sin(T * 0.8 + p.phase) * 0.03;
      p.mat.color.setScalar(0.22 + 0.78 * Math.min(1, p.lit * 1.25));
      p.mat.emissiveIntensity = p.lit * 0.08;
      p.glow.intensity = Math.max(0, p.lit - 0.2) * 2.6;
      p.ring.material.opacity = p.dis * (0.75 + 0.25 * Math.sin(T * 3));
      p.ring.rotation.z += dt * 0.5;
      (p.pad.material as SpriteMaterial).opacity = 0.1 + p.lit * 0.45 + (reduce ? 0 : Math.sin(T * 2.2 + p.phase) * 0.04 * p.lit);
    }
    skG.position.y = 2.0 + (reduce ? 0 : Math.sin(T * 0.9) * 0.05);
    stepSenate(dt);
    const skFace = focus ? Math.atan2(focus.g.position.x, focus.g.position.z) : Math.atan2(cam.position.x, cam.position.z) * 0.8;
    let sd = skFace - skG.rotation.y;
    sd = Math.atan2(Math.sin(sd), Math.cos(sd));
    skG.rotation.y += sd * k * 0.5;
    for (const L of lightPool) {
      L.on += (L.to - L.on) * k;
      const p = L.pod;
      if (p) {
        // Above it and toward the camera, following it wherever it goes.
        L.l.position.set(p.g.position.x * 0.85, p.g.position.y + 6.5, p.g.position.z + 2.2);
        if (L.to === 0 && L.on < 0.02) {
          if (p.light === L) p.light = null;
          L.pod = null;
        }
      }
      L.on = L.pod ? L.on : 0;
      L.l.intensity = L.on * 90;
      L.l.visible = L.on > 0.005;
      L.beam.visible = L.l.visible;
      if (L.beam.visible && L.pod) {
        // The beam runs from the light to just under the pod, in the light's colour.
        beamDir.set(L.pod.g.position.x, L.pod.g.position.y - 0.4, L.pod.g.position.z).sub(L.l.position);
        const len = beamDir.length();
        L.beam.position.copy(L.l.position);
        L.beam.quaternion.setFromUnitVectors(beamUp, beamDir.divideScalar(len));
        L.beam.scale.set(1, len, 1);
        L.beam.material.color.copy(L.l.color);
        L.beam.material.opacity = 0.075 * L.on;
      }
    }
    crowdU.t.value = T;
    crowdU.vote.value += (voteTo - crowdU.vote.value) * k * 0.5;
    crowdU.share.value += (shareTo - crowdU.share.value) * k;
    const calm = reduce ? 0.15 : 1;
    for (let i = 0; i < D; i++) {
      dp[i * 3 + 1] = dp[i * 3 + 1]! + dt * ds[i]! * 0.25 * calm;
      if (dp[i * 3 + 1]! > 12) dp[i * 3 + 1] = 0;
    }
    dg.attributes.position!.needsUpdate = true;
    shaftCol.lerp(kind === "idle" ? IDLE_SHAFT : TYPE_LIGHT[kind], k * 0.5);
    beamMat.color.copy(shaftCol);
    beam2Mat.color.copy(shaftCol);
    shaft.color.copy(shaftCol);
    beamMat.opacity = 0.04 + Math.sin(T * 0.7) * 0.008;
    wallMat.uniforms.t!.value = T;
    shadowTick(reduce ? 0 : T);
    look.lerp(lookTo, k * 0.35);
    dolly += (dollyTo - dolly) * k * 0.35;
    const ph = phone();
    const orbit = Math.PI / 2 + (reduce ? 0 : Math.sin(T * 0.06) * 0.32);
    // A tall phone stands further back, so the whole bowl fits across it.
    const rad = (ph ? (cam.aspect < 0.95 ? 17.5 : 15.5) : 13.2) * dolly;
    const camY = (ph ? 7.4 : 5.0) * (0.8 + dolly * 0.2);
    pan.step(dt);
    cam.position.set(Math.cos(orbit) * rad + pan.x, camY, Math.sin(orbit) * rad + pan.z);
    tmp.copy(look);
    tmp.x += pan.x;
    tmp.z += pan.z;
    if (ph) tmp.y += 1.1;
    cam.lookAt(tmp);
    stepAtmos(dt, T);
    renderer.render(scene, cam);
    placeCaps();
    place();
    if (!reduce) {
      if (clock.t > nextMur) {
        murmur();
        nextMur = clock.t + (kind === "idle" ? 2.6 : 1.4) + Math.random() * 2.2;
      }
      placeMurs();
    }
  };
  // The programs before the first frame (#759): compiled off the main thread where the browser can
  // (KHR_parallel_shader_compile), then one draw, still unseen (the canvas shows at data-gl="on"), so the shadow pass
  // compiles here too and the first frame on screen doesn't stall. A warm build (warm.ts) leaves them in the browser's cache.
  await yieldNow();
  await renderer.compileAsync(scene, cam).catch(() => undefined);
  await yieldNow();
  renderer.render(scene, cam);
  raf = requestAnimationFrame(frame);

  // ---- the Senate's manners (#775) -------------------------------------------------------------------------------
  function stepSenate(dt: number) {
    // Whoever has the floor; when it changes, each other Skippy takes the new speaker its own way.
    let cur = talker && clock.t < talker.talkUntil ? talker : null;
    if (!cur) for (const a of actors) if (clock.t < a.talkUntil) cur = a;
    const id = cur ? cur.id : null;
    if (id !== talkerWas) {
      talkerWas = id;
      if (id) for (const a of actors) onSpeaker(a, id);
    }
    let sx = 0;
    let sz = 0;
    if (cur && cur !== sk.a)
      for (const p of pods)
        if (p.a === cur) {
          sx = p.g.position.x;
          sz = p.g.position.z;
        }
    sk.a.look = 0;
    for (const p of pods) {
      p.a.amp = 0.4 + 0.6 * Math.min(1, p.lit * 1.4);
      if (!cur || cur === p.a) p.a.look = 0;
      else {
        let d = Math.atan2(sx - p.g.position.x, sz - p.g.position.z) - p.g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.a.look = Math.max(-0.7, Math.min(0.7, d)) * 0.85;
      }
    }
    rig.budget = PH0 ? 3 : 6;
    for (const a of actors) stepActor(a, dt, clock.t, rig);
  }

  const setSeats = (next: RotundaSeat[]) => {
    for (const s of next) {
      const p = byId(s.id);
      if (!p) continue;
      p.s = { ...p.s, ...s };
      p.base = baseOf(p.s);
      if (!p.speaking) p.litTo = p.base;
    }
  };

  void session(null);

  return {
    setSeats,
    setDocket: (items) => {
      const was = docket.length;
      docket = items;
      // The first business of the day: start from item one rather than waiting out an interlude.
      if (!was && items.length) void session(null);
    },
    setAmbient: (lines) => {
      ambient = lines;
    },
    bring: (key) => void session(key),
    setHot: (id) => pods.forEach((p) => (p.hot = p.s.id === id)),
    dispose: () => {
      dead = true;
      token++;
      cancelAnimationFrame(raf);
      pan.dispose();
      window.clearTimeout(chairTimer);
      ro?.disconnect();
      io?.disconnect();
      for (const k of SLOTS) caps[k].c.remove();
      chairEl.remove();
      murEls.forEach((m) => m.d.remove());
      for (const d of disposables) d.dispose();
      // The model stays in modelCache.ts for the next visit; this renderer's copies go with it.
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
