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
  Euler,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PlaneGeometry,
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
  Vector2,
  Vector3,
  WebGLRenderer,
  type Bone,
  type SkinnedMesh,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { recolor } from "../../../world/src/agents/bodies/recolor.ts";
import { modelUrl } from "../../../world/src/modelUrl.ts";
import { cachedModel } from "../modelCache.ts";
import { wasdPan } from "@ceo/engine/web/wasdPan.ts";
import { ARMS, CHILD, fitCap, HEAD, NAVY, PHI, POSES, TH0, TH1 } from "../hologram/rig.ts";
import type { Pose } from "../hologram/persona.ts";
import { SKIPPY_MODEL } from "../council/live.ts";
import { yieldNow } from "@ceo/engine/web/roomReady.ts";
import {
  chairLine,
  COUNTER_COLOUR,
  FLY_MS,
  ITEM_END_MS,
  ITEM_GAP_MS,
  freshMurmur,
  MURMUR_MAX,
  murmurVoice,
  readMs,
  spoken,
  SPOKEN_BEAT_MS,
  TURN_GAP_MS,
  type RiteItem,
  type RiteKind,
  type RiteLine,
} from "./rite.ts";
import type { RotundaVoice } from "./voice.ts";
import { makeActor, onSpeaker, startTalk, stepActor, type Actor, type SenateRig } from "./senateActor.ts";
import { senatePoses, senatorOf } from "./senators.ts";
import { debateLines, debateOpen } from "./debates.ts";
import type { FloorTopic, Joined, RecessSource } from "./liveTalk.ts";
import { CAMERA_MAX_R, GALLERY_FADE, GALLERY_R0, KEEP_OUT, YAW_ARC, ZOOM, keepOutScale, softStep } from "./clearance.ts";
import { ambientKey } from "./heard.ts";
import { whereClause } from "./floorSteer.ts";

/**
 * The Senate in 3D (#740), Today's chamber: the round 3 concept (concepts/2026-11-04-today-boiler, r3/rotunda.js)
 * ported to the Desk. Skippy presides on the podium in a shaft of light; the Council's subminds sit round the bowl on
 * identical bronze pods, each floating on a short field of sigil glyphs and motes in its room's colour that sinks out of
 * the keel and fades well above the floor (no tethers). Pods are lit from real state (Rotunda.tsx): dim and sparse when
 * the submind isn't active, brighter when it is, brightest while its room is at work. The docket's items (rite.ts) play
 * in turn: a pod flies in to the floor when it speaks and glides home after. The gallery is hundreds of instanced pods
 * with a pinprick light each, and now and then one murmurs a canned line (at most three at once, none under reduced
 * motion). With the sound on (#755, voice.ts) every line is spoken and the session waits for it to finish, plus a beat;
 * with it off each caption holds for its reading time (rite.ts, `readMs`). Haze drifts through the bowl and up the podium's shaft; sigil nanites drift in the air and gather at the
 * podium when the chair speaks. Phones get fewer particles and 30 frames a second; reduced motion slows everything to a
 * near stop. Lazy loaded with three.js, never in the Desk's first load.
 *
 * Since #856 the gallery's shadow Skippies are flat silhouettes in the back tiers' haze, only the line being heard is
 * written large (the rest whisper), and the frame's edges come undone into gold wire and code nanites.
 * Since #878 the gallery is twice as full of them and each reads as Skippy (can, arms and bicorne in a line of light),
 * the gold grid sheds faint nanites as it comes undone, the faces glow back the light they're drawn in, and with nothing
 * on the docket the members argue a topic of their own (debates.ts) until real business takes the floor.
 * Since #910 those arguments are made live, a new motion every time (liveTalk.ts), the gallery's murmurs are each said
 * once, and when nothing new is left the chamber keeps quiet rather than say anything again.
 * Since #925 Nikita's words on the floor join the argument that's on (`join`): the members who were speaking answer him
 * and it carries on from there. No podium ever comes into the camera's face (clearance.ts: the gallery stands beyond the
 * camera's reach, the keys keep to an arc and a tight zoom, and a member's podium inside the keep-out shrinks away), the
 * gallery is far denser, darker and further back, each figure a shimmer of gold sigil nanites, and the room is darker.
 *
 * Every Skippy in it is its own self (#775): its own idle, gestures, faces and reactions, played from senators.ts by
 * senateActor.ts, with a moving face cast over the front of each can's head.
 *
 * Since #948 (Nikita, 2026-11-06: "even darker", a middle layer of "higher-fidelity Skippies", "fog ... so it doesn't look
 * too clear") the room is darker still, a ring of full 3D Skippies stands on raised plinths between the members and the
 * gallery (the bench: real cans, dim bronze in the haze, each turning toward whoever speaks), and the bowl fills with
 * drifting ground fog and a veil of mist in front of the gallery. Whoever answers Nikita rises on his podium to do it.
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
  /** The voices (#755): the choreography waits on each spoken line; without one (or with the sound off) it reads. */
  voice?: RotundaVoice;
  /** What this viewer has already heard (#900, heard.ts): each item and status line is said once, never looped. */
  memory?: SenateMemoryLink;
  /** The recess's arguments (#910, liveTalk.ts): made live, a new one each time; without it the recess is quiet. */
  recess?: RecessSource;
}

/** The scene's view of the Senate's memory. Without one, the scene still never repeats itself within a visit. */
export interface SenateMemoryLink {
  /** Not yet said at this version (and not put away). */
  fresh: (key: string, ver: string) => boolean;
  /** An interlude's line by its key (heard.ts, `ambientKey`): said yet? */
  heard: (key: string) => boolean;
  /** Marks an interlude's line said. */
  hear: (key: string) => void;
}

export interface Rotunda {
  setSeats: (seats: RotundaSeat[]) => void;
  setDocket: (items: RiteItem[]) => void;
  /** Real lines for the interludes between items: a lit member's status, from the Council's feed. */
  setAmbient: (lines: { by: string; text: string }[]) => void;
  /** Bring an item to the floor now. */
  bring: (key: string) => void;
  setHot: (id: string | null) => void;
  /**
   * Nikita has the floor (#905): the session holds where it is (its clock and its voice stop), and picks up the same
   * line when he gives it back.
   */
  hold: (on: boolean) => void;
  /** A member (or "kernel", the chair) talks for this many seconds while it answers him; 0 stops it. */
  talk: (by: string, seconds: number) => void;
  /** The argument on the floor now and what has been said in it (#910), so the members answer him in its context. */
  topic: () => FloorTopic | null;
  /**
   * Nikita's words join the argument on the floor (#925): the members who were speaking answer him on the floor
   * (senateFloor.ts, #948), and once the session picks up, the argument goes on with his point in it. False when no
   * argument is on.
   */
  join: (said: string, j: Joined) => boolean;
  /** Raises a member (or "kernel", the chair) on his podium to answer Nikita (#948); null steps whoever is up back down. */
  rise: (id: string | null) => void;
  /** What the chamber was on, as the chair's clause for the steer back (#948, floorSteer.ts); null when it was on nothing. */
  where: () => string | null;
  dispose: () => void;
}

const COUNTER_LIGHT = new Color(COUNTER_COLOUR);
const TYPE_LIGHT: Record<RiteKind | "idle", Color> = { duty: new Color("#dfe9ff"), decision: new Color("#ffe7b8"), repair: new Color("#ffc2a8"), idle: new Color("#fff4e0") };
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];
const PHONE_W = 760;
/** The gallery's tiers (#925): how many, and how far out and up each steps from the last. */
const TIERS = 14;
const TIER_DR = 1.05;
const TIER_DY = 1.2;
/** With nothing new to argue (#910), the chamber keeps quiet this long before it looks again. */
const QUIET_MS = 20_000;

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
  /** Risen on its podium to answer Nikita (#948): 0 down, 1 up, eased. */
  lift: number;
  liftTo: number;
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

/**
 * The can's outline, drawn once into a small texture that every shadow senator in the gallery is cut from (#856), with
 * the texture's width over its height. Since #878 it is the can as it stands in the chamber, not at its bind pose (whose
 * arms stuck straight out and made a strange cross of it): skinned in the pose `body`'s bones hold when this is called,
 * turned a little off the front (`yaw`) so the bicorne's two horns and the can's round shoulder both read, and lifted a
 * touch so the hat sits on top rather than flat. Null where a 2D canvas isn't available.
 *
 * Three masks in one opaque texture (no premultiplied edges): red is the figure, edge barely softened so it stays crisp;
 * green is a wide glow round it, the backlight that lifts a dark figure off the dark wall; blue is a thin rim just
 * inside the outline, the line of light that draws the can, its hat and its arms.
 */
function silhouette(body: SkinnedMesh, yaw = 0.3, pitch = 0.04): { tex: CanvasTexture; aspect: number } | null {
  const pos = body.geometry.getAttribute("position");
  const idx = body.geometry.index;
  if (!pos || !pos.count) return null;
  const skinned = !!body.geometry.getAttribute("skinIndex") && !!body.skeleton;
  const turn = new Matrix4().makeRotationX(pitch).multiply(new Matrix4().makeRotationY(yaw));
  const xy = new Float32Array(pos.count * 2);
  const v = new Vector3();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (skinned) body.applyBoneTransform(i, v);
    v.applyMatrix4(body.matrixWorld).applyMatrix4(turn);
    xy[i * 2] = v.x;
    xy[i * 2 + 1] = v.y;
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  }
  const h = y1 - y0;
  const w = x1 - x0;
  if (!(h > 0) || !(w > 0)) return null;
  const H = 160;
  const PAD = 16;
  const W = Math.max(16, Math.ceil((H * w) / h));
  const hard = document.createElement("canvas");
  hard.width = W + PAD * 2;
  hard.height = H + PAD * 2;
  const hx = hard.getContext("2d");
  if (!hx) return null;
  const px = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    px[i * 2] = PAD + ((xy[i * 2]! - x0) / w) * W;
    px[i * 2 + 1] = PAD + H - ((xy[i * 2 + 1]! - y0) / h) * H;
  }
  hx.fillStyle = "#fff";
  // Slightly fat strokes as well as fills, so hairline triangles (the hat's thin horns) don't drop out of the mask.
  hx.strokeStyle = "#fff";
  hx.lineWidth = 0.6;
  hx.lineJoin = "round";
  hx.beginPath();
  const tris = idx ? idx.count : pos.count;
  for (let t = 0; t + 2 < tris; t += 3) {
    const a = idx ? idx.getX(t) : t;
    const b = idx ? idx.getX(t + 1) : t + 1;
    const c = idx ? idx.getX(t + 2) : t + 2;
    const [ax, ay, bx, by, cx, cy] = [px[a * 2]!, px[a * 2 + 1]!, px[b * 2]!, px[b * 2 + 1]!, px[c * 2]!, px[c * 2 + 1]!];
    // Every triangle wound the same way round, so a back face over a front one adds to the fill instead of cancelling it
    // (with mixed windings the overlaps punched holes all through the figure).
    hx.moveTo(ax, ay);
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0) {
      hx.lineTo(bx, by);
      hx.lineTo(cx, cy);
    } else {
      hx.lineTo(cx, cy);
      hx.lineTo(bx, by);
    }
    hx.closePath();
  }
  hx.fill("nonzero");
  hx.stroke();
  const W2 = hard.width;
  const H2 = hard.height;
  const blurred = (src: HTMLCanvasElement, px: number) => {
    const c = document.createElement("canvas");
    c.width = W2;
    c.height = H2;
    const x = c.getContext("2d");
    if (!x) return null;
    x.filter = `blur(${px}px)`;
    x.drawImage(src, 0, 0);
    return x.getImageData(0, 0, W2, H2).data;
  };
  const sharp = hx.getImageData(0, 0, W2, H2).data;
  // The rim: inside the figure, within two pixels of its edge.
  const rimC = document.createElement("canvas");
  rimC.width = W2;
  rimC.height = H2;
  const rx = rimC.getContext("2d");
  if (!rx) return null;
  const rimD = rx.createImageData(W2, H2);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W2 && y < H2 && sharp[(y * W2 + x) * 4 + 3]! > 127;
  const R = 2;
  for (let y = 0; y < H2; y++)
    for (let x = 0; x < W2; x++) {
      if (!inside(x, y)) continue;
      let edge = false;
      for (let dy = -R; dy <= R && !edge; dy++) for (let dx = -R; dx <= R && !edge; dx++) if (dx * dx + dy * dy <= R * R && !inside(x + dx, y + dy)) edge = true;
      if (edge) rimD.data[(y * W2 + x) * 4 + 3] = 255;
    }
  rx.putImageData(rimD, 0, 0);
  const fig = blurred(hard, 0.5);
  const glow = blurred(hard, 6);
  const rim = blurred(rimC, 0.6);
  if (!fig || !glow || !rim) return null;
  const out = new ImageData(W2, H2);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = fig[i + 3]!;
    out.data[i + 1] = glow[i + 3]!;
    out.data[i + 2] = rim[i + 3]!;
    out.data[i + 3] = 255;
  }
  const done = document.createElement("canvas");
  done.width = W2;
  done.height = H2;
  done.getContext("2d")?.putImageData(out, 0, 0);
  return { tex: new CanvasTexture(done), aspect: W2 / H2 };
}

export async function createRotunda(host: HTMLElement, canvas: HTMLCanvasElement, opts: RotundaOpts): Promise<Rotunda> {
  const { reduce } = opts;
  const voice = opts.voice ?? null;
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
  // Darker overall (#925, Nikita: "darken the room overall"): the spotlights, the gold and the captions carry it.
  // Darker again (#948, Nikita: "the background even darker").
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = !PH0;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(0x010103);
  // A thicker haze (#948, "so it isn't too clear"): the members still read; the bench softens; the gallery sinks into it.
  scene.fog = new FogExp2(0x04050a, 0.038);
  const cam = new PerspectiveCamera(40, 1, 0.1, 120);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  // ---- the chamber ------------------------------------------------------------------------------------------------
  scene.add(new HemisphereLight(0x9aa4d0, 0x06060a, 0.3));
  const moon = new DirectionalLight(0xbfc8ff, 0.24);
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
  const floor = new Mesh(keep(new CircleGeometry(44, 96)), keep(new MeshStandardMaterial({ color: 0x050609, roughness: 0.5, metalness: 0.4 })));
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
        void main(){ float h = vU.y; vec3 deep = vec3(.004,.005,.01), haze = vec3(.016,.02,.038);
          vec3 c = mix(deep, haze, smoothstep(.05,.75,h)); c = mix(c, vec3(.007,.008,.015), smoothstep(.8,1.,h));
          float tier = smoothstep(.0,.5,fract(h*14.)) * smoothstep(1.,.86,fract(h*14.)); c += vec3(.008,.007,.005)*(1.-tier)*smoothstep(.05,.7,h);
          float win = step(.82, fract(vU.x*220.)) * step(.6, fract(h*14.+.3)) * step(fract(sin(floor(vU.x*220.)*12.9+floor(h*14.)*78.2)*43758.5),.35);
          c += vec3(1.,.8,.5)*win*.04*(.6+.4*sin(t*.7+vU.x*90.))*smoothstep(.15,.7,h);
          gl_FragColor = vec4(c,1.); }`,
    }),
  );
  // Since #925 the bowl stands well back: its first tier beyond the furthest the camera ever goes (clearance.ts), so no
  // gallery podium is ever between the camera and the floor.
  const wall = new Mesh(keep(new CylinderGeometry(GALLERY_R0 + 25, GALLERY_R0 + 1, 26, 128, 1, true)), wallMat);
  wall.position.y = 12.5;
  scene.add(wall);
  for (let k = 0; k < TIERS; k++) gold(GALLERY_R0 - 0.5 + k * TIER_DR, 0.6 + k * TIER_DY, 0.2 - k * 0.011, 0.02);
  // No light slants in from the oculus any more (Nikita, 2026-11-05): the only beams are the chair's shaft and a
  // spotlight on whoever has the floor.

  // The gallery: hundreds of pods, instanced silhouettes with a pinprick light each. Since #925 (Nikita: "too sparse and a
  // little too fake", "darken the background more and add many more of them") it is far denser, deeper and further back.
  const N = PH0 ? 900 : 2200;
  const crowd = new InstancedMesh(keep(new CylinderGeometry(0.34, 0.2, 0.18, 8)), keep(new MeshStandardMaterial({ color: 0x0e0f15, metalness: 0.5, roughness: 0.6, emissive: 0x05060b })), N);
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
      const tier = i % TIERS;
      const r = GALLERY_R0 + tier * TIER_DR + Math.random() * 0.3;
      const a = (i / N) * Math.PI * 2 * (TIERS + 0.13) + Math.random() * 0.05;
      const y = 0.9 + tier * TIER_DY + Math.random() * 0.25;
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
            vec4 mv = modelViewMatrix*vec4(position,1.); vA *= smoothstep(${GALLERY_FADE.to.toFixed(1)}, ${GALLERY_FADE.from.toFixed(1)}, -mv.z) * (.55 + .45 * exp(-max(0., -mv.z - 30.) * .03));
            gl_PointSize = (aye ? 2.2 + vote*1.6 : 2.0) * px * (24./-mv.z); gl_Position = projectionMatrix*mv; }`,
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
  for (const id of new Set<Pose>([...senatePoses(), "rest"])) {
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
  // The gallery's silhouette (#878) is cut from the can standing as the members do, arms down at its sides.
  let shade: { tex: CanvasTexture; aspect: number } | null = null;
  if (body) {
    const P = poses.get("rest");
    if (P) for (const n of ARMS) bones.get(n)?.quaternion.copy(P.get(n)!);
    proto.updateMatrixWorld(true);
    try {
      shade = silhouette(body as SkinnedMesh);
    } catch {
      shade = null;
    }
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
  // the can: an audience of shadowy Skippies, never members. Since #856 they are flat (Nikita: "just 2D shadow model,
  // like silhouettes on the podiums in the background ... far enough that you can't tell that they're 2D"): the can's
  // outline is drawn once into a small texture from the model already loaded for the senators, and every figure is one
  // instanced quad that turns to face the camera, set on the back tiers and sunk into the chamber's haze. No extra
  // model, no mesh per figure, no per-figure work on the CPU.
  //
  // Since #878 (Nikita: "add even more of the background skippies", "I can't really tell that they're skippies") the
  // gallery is about twice as full, and each figure reads as Skippy: the can as it stands, arms down, turned a little
  // off the front so the admiral's bicorne shows both horns, drawn as a crisp line of light round a faint dark fill. Each
  // floats a hand above its podium with a bob, a lean and a size of its own, all in the shader.
  //
  // Since #925 (Nikita: they look "so blatantly not real, especially the closer ones") none is close: the gallery stands
  // beyond the furthest the camera goes (clearance.ts), deeper and darker, many more of them, small and dim. Each figure
  // is no longer a flat cut-out but a shimmer of gold sigil nanites in the can's shape: specks of light that flicker on
  // and off, thicker along the outline, the edges dissolving into loose specks and the fill only a dark breath. Each sways
  // a little, now and then turns its head, and stands at its own size, width and hat (some face the other way), all in
  // the shader. Any that came within GALLERY_FADE of the camera would fade out entirely.
  if (shade) {
    const tex = keep(shade.tex);
    const g = keep(new PlaneGeometry(shade.aspect, 1));
    g.translate(0, 0.5, 0);
    const NS = PH0 ? 360 : 1100;
    const fog = scene.fog as FogExp2;
    const shadowU = { t: { value: 0 }, map: { value: tex }, fogC: { value: fog.color }, dens: { value: fog.density } };
    const shadowMat = keep(
      new ShaderMaterial({
        uniforms: shadowU,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `uniform float t; varying vec2 vU; varying float vD; varying float vId; varying float vNear;
          void main(){ float id = float(gl_InstanceID); vId = id;
            float h1 = fract(sin(id * 12.9898) * 43758.5453), h2 = fract(sin(id * 78.233) * 24634.6345), h3 = fract(sin(id * 39.425) * 15731.743);
            // Some face the other way; each its own width and its own hat.
            vU = vec2(h3 < .5 ? uv.x : 1. - uv.x, uv.y);
            vec3 o = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz; float s = length(instanceMatrix[1].xyz);
            vec3 to = cameraPosition - o; to.y = 0.; vec3 right = normalize(vec3(to.z, 0., -to.x) + vec3(1e-5, 0., 0.));
            float sway = (h1 - .5) * .12 + sin(t * (.3 + h2 * .25) + id * 1.73) * .03;
            float bob = sin(t * (.6 + h1 * .4) + id * 2.31) * .03 + .07;
            vec2 p = position.xy; p.x *= .86 + h2 * .3;
            // The head and hat: wider or narrower, and now and then a turn of the head (a slide and a squeeze of the top).
            float head = smoothstep(.62, .74, p.y);
            float turn = smoothstep(.82, 1., sin(t * (.11 + h1 * .07) + id * 4.7));
            p.x = p.x * (1. + head * ((h1 - .5) * .4 - turn * .22)) + head * turn * (h2 < .5 ? -.06 : .06);
            vec2 q = vec2(p.x * cos(sway) - (p.y - .5) * sin(sway), p.x * sin(sway) + (p.y - .5) * cos(sway) + .5);
            vec3 w = o + right * q.x * s + vec3(0., (q.y + bob) * s, 0.);
            vec4 mv = viewMatrix * vec4(w, 1.); vD = -mv.z;
            vNear = smoothstep(${GALLERY_FADE.to.toFixed(1)}, ${GALLERY_FADE.from.toFixed(1)}, length(cameraPosition - o));
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 fogC; uniform float dens, t; varying vec2 vU; varying float vD; varying float vId; varying float vNear;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main(){ vec3 m = texture2D(map, vU).rgb; float body = m.r, halo = max(m.g - m.r, 0.), rim = m.b;
            if (body < .02 && halo < .05) discard;
            // The nanites: a fine grid of specks over the figure, each flickering on its own beat.
            vec2 cell = floor(vU * vec2(16., 32.)); float r = hash(cell + vId * 7.13);
            float beat = .5 + .5 * sin(t * (1.2 + r * 2.4) + r * 40.);
            vec2 f = fract(vU * vec2(16., 32.)) - .5; float pip = smoothstep(.5, .15, length(f));
            // Thick along the outline, sparse inside, loose and dissolving at the edges (the halo).
            float keep = rim * .85 + body * .22 + halo * .18;
            float speck = step(1. - keep, r) * pip * (.35 + .65 * beat);
            vec3 gold = mix(vec3(.85, .62, .3), vec3(1., .86, .55), smoothstep(.6, .72, vU.y));
            float haze = 1. - exp(-pow(dens * .8 * vD, 2.));
            float a = (speck * (.7 + rim * .5) + body * .05) * (1. - haze * .7) * vNear;
            gl_FragColor = vec4(mix(gold, fogC * 3., haze * .5) * a, 1.); }`,
      }),
    );
    // Additive light: the dark fill is the bowl behind it, never a flat dark card.
    shadowMat.premultipliedAlpha = true;
    const shadows = new InstancedMesh(g, shadowMat, NS);
    // Each stands on a podium of its own (Nikita: "they should be on a podium and a Skippy silhouette"): a small copy of
    // the members' bronze pod and its gold rim, two instanced draws for the whole gallery, in place of the plain seat.
    // Since #925 dark bronze, its rim a faint line of gold, sunk in the haze.
    const PS = 0.5;
    const stands = new InstancedMesh(keep(new CylinderGeometry(0.78, 0.42, 0.42, 12)), keep(new MeshStandardMaterial({ color: 0x17130f, metalness: 0.8, roughness: 0.45 })), NS);
    const rims = new InstancedMesh(keep(new TorusGeometry(0.78, 0.035, 4, 24)), keep(new MeshBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: 0.32 })), NS);
    const M = new Matrix4();
    const q = new Quaternion();
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const V = new Vector3();
    const S = new Vector3();
    const ZERO = new Vector3(0, 0, 0);
    let n = 0;
    // Spread across the tiers, two seats in three filled, picked by a hash so no tier is left bare; bigger further up,
    // so the back rows still read at their distance.
    for (let i = 0; i < N && n < NS; i++) {
      const tier = i % TIERS;
      const pick = (Math.imul(i, 0x9e3779b1) >>> 16) % 3;
      if (pick === 0) continue;
      crowd.getMatrixAt(i, M);
      V.setFromMatrixPosition(M);
      // None on the camera's own side of the bowl: behind it, it would never be seen.
      const off = Math.atan2(Math.sin(Math.atan2(V.z, V.x) - Math.PI / 2), Math.cos(Math.atan2(V.z, V.x) - Math.PI / 2));
      if (Math.abs(off) < 0.9) continue;
      // The plain seat gives way to the podium.
      crowd.setMatrixAt(i, M.compose(V, q, ZERO));
      stands.setMatrixAt(n, M.compose(V, q, S.setScalar(PS)));
      V.y += 0.21 * PS;
      rims.setMatrixAt(n, M.compose(V, flat, S.setScalar(PS)));
      S.setScalar((0.8 + tier * 0.035) * (0.82 + ((Math.imul(i, 0x85ebca6b) >>> 20) % 13) * 0.03));
      V.y += 0.01;
      shadows.setMatrixAt(n++, M.compose(V, q, S));
    }
    crowd.instanceMatrix.needsUpdate = true;
    for (const m of [shadows, stands, rims]) {
      m.count = n;
      m.frustumCulled = false;
      scene.add(m);
    }
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
    return { s, g, shell, ring, glow, mat: can.mat, pad, home, at: home.clone(), prev: home.clone(), vel: new Vector3(), tw: null, lit: base, litTo: base, base, dis: 0, disTo: 0, phase: Math.random() * 6, speaking: false, hot: false, light: null, lift: 0, liftTo: 0, a: can.a };
  });
  const actors: Actor[] = [sk.a, ...pods.map((p) => p.a)];

  // The bench (#948). Nikita, 2026-11-06: a middle layer of "higher-fidelity Skippies" between the glowing gallery at the
  // back and the members' podiums in front. Real cans this time, the same model as the members, on tall bronze plinths
  // with a gold rim, in a ring behind the members and above them, never on the camera's side of the bowl (it keeps 1.6
  // rad clear of the camera's own bearing, beyond the A/D arc and the chamber's sway). Dim bronze, a faint warm glow, sunk
  // in the haze: they don't speak, they watch, each turning its head toward whoever has the floor, bobbing a little on
  // its own beat. No faces, no shadows, no per-figure lights; a phone gets half as many. Any that came into the camera's
  // keep-out (clearance.ts) would shrink away like a member's podium.
  interface Bencher {
    g: Group;
    inner: Group;
    head: Bone | null;
    bind: Quaternion;
    y0: number;
    seed: number;
    hy: number;
  }
  const bench: Bencher[] = [];
  {
    const BN = PH0 ? 7 : 14;
    const BR = 10.6;
    const ARC = Math.PI * 2 - 3.2;
    // A slim stem and a small bronze cup like the members' own pods: a podium, never a column across the view.
    const stemG = keep(new CylinderGeometry(0.05, 0.09, 1, 10));
    const cupG = keep(new CylinderGeometry(0.48, 0.26, 0.26, 28));
    const plinthM = keep(new MeshStandardMaterial({ color: 0x1d1813, metalness: 0.8, roughness: 0.42 }));
    const rimG2 = keep(new TorusGeometry(0.48, 0.014, 6, 64));
    const rimM2 = keep(new MeshBasicMaterial({ color: 0xc9a85c, transparent: true, opacity: 0.42 }));
    let benchMat: MeshStandardMaterial | null = null;
    const rest = poses.get("rest");
    for (let i = 0; i < BN; i++) {
      const a = Math.PI / 2 + 1.6 + ((i + 0.5) / BN) * ARC;
      const r = BR + (i % 2) * 0.7;
      const top = 3.2 + (i % 2) * 0.6;
      const g = new Group();
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.rotation.y = Math.atan2(-g.position.x, -g.position.z);
      const stem = new Mesh(stemG, plinthM);
      stem.scale.y = top - 0.2;
      stem.position.y = (top - 0.2) / 2;
      const cup = new Mesh(cupG, plinthM);
      cup.position.y = top - 0.13;
      const rim = new Mesh(rimG2, rimM2);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = top + 0.004;
      const model = cloneSkinned(proto);
      let mesh: SkinnedMesh | null = null;
      let head: Bone | null = null;
      model.traverse((o) => {
        if ((o as Bone).isBone) {
          const n = o.name.replace(/^mixamorig:?/, "");
          if (rest?.has(n)) (o as Bone).quaternion.copy(rest.get(n)!);
          if (n === "Head") head = o as Bone;
        }
        if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
      });
      const sm = mesh as SkinnedMesh | null;
      if (sm) {
        if (!benchMat) {
          benchMat = keep(((sm.material as MeshStandardMaterial).clone() as MeshStandardMaterial));
          benchMat.color.setScalar(0.5);
          benchMat.emissive = new Color(0x3a2a12);
          benchMat.emissiveMap = benchMat.map;
          benchMat.emissiveIntensity = 0.55;
        }
        sm.material = benchMat;
        sm.castShadow = false;
        sm.frustumCulled = false;
      }
      model.position.copy(centre).multiplyScalar(-1);
      const inner = new Group();
      inner.add(model);
      const size = 0.92;
      inner.scale.setScalar(size / height);
      const y0 = top + size / 2 + 0.02;
      inner.position.y = y0;
      g.add(stem, cup, rim, inner);
      scene.add(g);
      const hb = head as Bone | null;
      bench.push({ g, inner, head: hb, bind: hb ? hb.quaternion.clone() : new Quaternion(), y0, seed: Math.random(), hy: 0 });
    }
  }
  const benchQ = new Quaternion();
  const benchE = new Euler();
  const benchSpot = new Vector3();
  /** One frame of the bench: a bob, and each head turning toward whoever has the floor. */
  const stepBench = (dt: number, T: number, speaker: Vector3 | null, camAt: Vector3, camDirN: Vector3) => {
    const hk = reduce ? 1 : 1 - Math.exp(-dt * 2.5);
    for (const b of bench) {
      b.inner.position.y = b.y0 + (reduce ? 0 : Math.sin(T * (0.5 + b.seed * 0.3) + b.seed * 9) * 0.035);
      let want = reduce ? 0 : Math.sin(T * (0.13 + b.seed * 0.08) + b.seed * 20) * 0.25;
      if (speaker) {
        let d = Math.atan2(speaker.x - b.g.position.x, speaker.z - b.g.position.z) - b.g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        want = Math.max(-0.75, Math.min(0.75, d));
      }
      b.hy += (want - b.hy) * hk;
      if (b.head) b.head.quaternion.copy(b.bind).multiply(benchQ.setFromEuler(benchE.set(0.06, b.hy, 0)));
      benchSpot.set(b.g.position.x, b.y0, b.g.position.z);
      const clear = keepOutScale(benchSpot, camAt, camDirN, KEEP_OUT);
      b.g.scale.setScalar(Math.max(1e-3, clear));
      b.g.visible = clear > 0.01;
    }
  };
  /** Who has the floor: the last to start a line that is still going. */
  let talker: Actor | null = null;
  let heldTalker: { a: Actor; left: number } | null = null;
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
  // The session's own clock (#905): it stops while Nikita has the floor, so the session picks up where it was.
  const sclock = { t: 0 };
  let floorHeld = false;
  // Whose line is being heard (or read) now (#856). Nikita: "the primary text ... should only be the one talking. Any other
  // text, like anyone concurring or dissent or anything like that, should be very minimal, subliminal, kind of in the
  // background." Only that line is written large; every other caption still up, and the chair's line while a member
  // speaks, drops to a faint whisper (`.bg`). The same with the sound off: one primary line at a time.
  let primary: Slot | "chair" | null = null;
  const mark = () => {
    chairEl.classList.toggle("bg", primary !== null && primary !== "chair");
    for (const k of SLOTS) caps[k].c.classList.toggle("bg", primary !== null && k !== primary);
  };
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
    mark();
  };
  const clearCaps = () => {
    primary = null;
    SLOTS.forEach((k) => say(k, null));
  };
  /** Gives the floor's primary line to whoever is about to be heard: the chair, or the newest caption of that member. */
  const lead = (by: string) => {
    if (by === "kernel") primary = "chair";
    else {
      const p = byId(by);
      const mine = p ? SLOTS.filter((k) => capOf[k] === p).sort((x, y) => capT[y] - capT[x])[0] : undefined;
      primary = mine ?? null;
    }
    mark();
  };
  const proj = new Vector3();
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const placeCaps = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const ph = phone();
    const bottom = opts.safeBottom();
    placed.length = 0;
    const live = SLOTS.filter((k) => capOf[k]).sort((x, y) => capT[x] - capT[y]);
    // On a phone only the primary line shows (none while the chair has it); elsewhere it is placed first, so the faint
    // ones find room around it.
    const shown = primary ?? live[live.length - 1];
    const order = primary && primary !== "chair" ? [primary, ...SLOTS.filter((k) => k !== primary)] : SLOTS;
    for (const k of order) {
      const p = capOf[k];
      const c = caps[k].c;
      if (!p) continue;
      if (ph) {
        c.style.opacity = k === shown ? "" : "0";
        const y = Math.max(96, h - bottom - c.offsetHeight - 12);
        c.style.transform = `translate(10px,${y}px)`;
        if (k === shown) placed.push({ x: 10, y, w: c.offsetWidth, h: c.offsetHeight });
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
  const murSaid = new Set<string>();
  const murmur = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const ph = phone();
    const cap = ph ? MURMUR_MAX.phone : MURMUR_MAX.wide;
    const free = murEls.filter((m) => m.i < 0);
    if (murEls.length - free.length >= cap || !free.length) return;
    // Each said once (#910): a live argument's new murmur first, then a written one not heard yet; none left, none said.
    const text = opts.recess?.murmur() ?? freshMurmur(kind, (t) => murSaid.has(t) || (opts.memory?.heard(ambientKey("gallery", t)) ?? false));
    if (!text) return;
    murSaid.add(text);
    opts.memory?.hear(ambientKey("gallery", text));
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
      // With the sound on, a murmur is heard quietly when no one has the floor, and stays up while it is (#755).
      const by = voice ? murmurVoice(text) : null;
      if (voice && by)
        void voice.murmur(by, text).then((d) => {
          if (d !== null && m.d.textContent === text) m.until = Math.max(m.until, clock.t + d + 0.8);
        });
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
  // Said this visit (#900): a safety net under the viewer's memory, so nothing loops even if it can't be kept.
  const saidHere = new Set<string>();
  const fresh = (m: RiteItem) => !saidHere.has(`${m.key}@${m.ver}`) && (opts.memory?.fresh(m.key, m.ver) ?? true);
  const ambientFresh = (a: { by: string; text: string }) => {
    const k = ambientKey(a.by, a.text);
    return !saidHere.has(k) && !(opts.memory?.heard(k) ?? false);
  };
  /** The item on the floor now, if one is. */
  let floorKey: string | null = null;
  let token = 0;
  let dead = false;
  // The session runs on the scene's own clock, so it pauses with the chamber (out of view, a hidden tab) and picks up where it was.
  const sleep = (ms: number, tk: number) =>
    new Promise<void>((res, rej) => {
      const end = sclock.t + (reduce ? ms * 0.6 : ms) / 1000;
      const f = () => {
        if (tk !== token || dead) return rej(new Error("cancel"));
        if (sclock.t >= end) return res();
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
    spotOn(p, counter ? COUNTER_LIGHT : TYPE_LIGHT[kind]);
  };
  /** A spotlight on a pod: its own if it already has one (it used to take a second and leave the first on over an empty
   * seat); else a free one, or the one that has been fading longest. */
  function spotOn(p: Pod, colour: Color) {
    let L = p.light;
    if (!L) {
      L = lightPool.find((x) => !x.pod) ?? lightPool.reduce((a, b) => (b.to === 0 && b.on < a.on ? b : a));
      if (L.pod && L.pod !== p) L.pod.light = null;
    }
    L.pod = p;
    L.to = 1;
    L.l.target = p.g;
    L.l.color.copy(colour);
    p.light = L;
  }
  // Rising to answer Nikita (#948): the one he addressed lifts on his podium in a light of his own, and the camera leans
  // toward him; stepping down gives the view back to the session.
  let skLift = 0;
  let skLiftTo = 0;
  let viewWas: { look: Vector3; dolly: number; focus: Pod | null } | null = null;
  function rise(id: string | null) {
    const p = id && id !== "kernel" ? byId(id) : null;
    for (const q of pods) {
      if (q === p || !q.liftTo) continue;
      q.liftTo = 0;
      if (!q.speaking) {
        q.litTo = q.base;
        if (q.light) q.light.to = 0;
      }
    }
    skLiftTo = id === "kernel" ? 1 : 0;
    if (id && !viewWas) viewWas = { look: lookTo.clone(), dolly: dollyTo, focus };
    if (p) {
      p.liftTo = 1;
      p.litTo = 1;
      spotOn(p, TYPE_LIGHT.idle);
      focus = p;
      lookTo.set(p.at.x * 0.35, 2.7, p.at.z * 0.35);
      dollyTo = 0.96;
    } else if (id === "kernel") {
      onChair();
      focus = null;
      lookTo.set(0, 2.8, 0);
      dollyTo = 0.95;
    } else if (viewWas) {
      lookTo.copy(viewWas.look);
      dollyTo = viewWas.dolly;
      focus = viewWas.focus;
      viewWas = null;
    }
  }
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

  // One line on the floor (#755): with the sound on, held while it is spoken and a beat after; otherwise (or when it
  // can't be spoken) held for its reading time. Then the gap before the next move.
  const line = async (by: string, text: string, tk: number, gap = TURN_GAP_MS) => {
    lead(by);
    if (!text) return;
    // Its mouth moves for as long as the line is heard (#775); unspoken, for its reading time.
    const a = by === "kernel" ? sk.a : (byId(by)?.a ?? null);
    if (a && voice) {
      startTalk(a, clock.t, clock.t + 30);
      talker = a;
    }
    const spoke = voice ? await voice.say(by, text) : false;
    if (a && voice) a.talkUntil = spoke ? clock.t : clock.t + talkFor(text);
    if (tk !== token || dead) throw new Error("cancel");
    await sleep((spoke ? SPOKEN_BEAT_MS : readMs(text)) + gap, tk);
  };
  /** A pod flying in while the chair speaks: whichever takes longer. */
  const both = (a: Promise<void>, b: Promise<void>) => Promise.all([a, b]).then(() => undefined);
  /** Every line an item will say, so the voices are fetched before they're needed. */
  const linesOf = (m: RiteItem) => [
    { by: "kernel", text: m.clerk },
    ...(m.say ? [{ by: m.by, text: spoken(m.say) }] : []),
    ...(m.options ?? []).flatMap((o, k) => [
      { by: "kernel", text: chairLine.recognize(o.by, o.label) },
      { by: o.by, text: spoken(o.say) },
      ...(m.counter && m.counter.on === k ? [{ by: "kernel", text: chairLine.tradeoff(m.counter.by) }, { by: m.counter.by, text: spoken(m.counter.say) }] : []),
    ]),
    ...(m.report ? [{ by: "kernel", text: chairLine.report(m.by) }, { by: m.by, text: spoken(m.report, true) }] : []),
    ...(m.risk ? [{ by: "kernel", text: chairLine.risk() }, { by: m.risk.by, text: spoken(m.risk.say) }] : []),
    { by: "kernel", text: m.done },
  ];

  async function runItem(m: RiteItem, tk: number) {
    floorKey = m.key;
    kind = m.kind;
    opts.onFloor(m.key);
    clearCaps();
    shareTo = 0;
    voteTo = 0;
    voice?.prefetch(linesOf(m));
    chair(m.clerk);
    lookTo.set(0, 2.4, 0.8);
    dollyTo = 1;
    await line("kernel", m.clerk, tk);
    if (m.kind === "duty") {
      const p = podOr(m.by);
      if (p) {
        goIn(p, "u");
        focus = p;
        lookTo.set(-1, 2.3, 1.4);
        dollyTo = 0.92;
        await sleep(FLY_MS, tk);
        say("a", p, m.say);
      } else chair(m.say?.text ?? "");
      await line(p ? m.by : "kernel", spoken(m.say), tk);
      chair(m.done);
      saidHere.add(`${m.key}@${m.ver}`);
      opts.onDone(m.key);
      voteTo = 1;
      shareTo = 0.85;
      await line("kernel", m.done, tk, ITEM_END_MS);
    } else if (m.kind === "decision") {
      const slots: [Slot, SpotId][] = [["a", "a"], ["c", "c"], ["b", "b"]];
      const opts2 = m.options ?? [];
      for (let k = 0; k < opts2.length; k++) {
        const o = opts2[k]!;
        const p = podOr(o.by);
        const [slot, spot] = slots[k % slots.length]!;
        const rec = chairLine.recognize(o.by, o.label);
        chair(rec);
        if (p) {
          goIn(p, spot);
          focus = p;
          lookTo.set(SPOT[spot].x * 0.4, 2.6, 0.8);
          dollyTo = 0.95;
        }
        await both(line("kernel", rec, tk, 0), sleep(FLY_MS, tk));
        say(slot, p, o.say);
        await line(o.by, spoken(o.say), tk);
        if (m.counter && m.counter.on === k) {
          const c = podOr(m.counter.by);
          const tr = chairLine.tradeoff(m.counter.by);
          chair(tr);
          if (c) {
            goIn(c, "d", true);
            focus = c;
          }
          await both(line("kernel", tr, tk, 0), sleep(FLY_MS, tk));
          say("d", c, m.counter.say, true);
          await line(m.counter.by, spoken(m.counter.say), tk);
        }
      }
      chair(m.done);
      saidHere.add(`${m.key}@${m.ver}`);
      opts.onDone(m.key);
      voteTo = 1;
      shareTo = 0.5;
      lookTo.set(0, 2.6, 0.4);
      dollyTo = 1.04;
      focus = null;
      await line("kernel", m.done, tk, ITEM_END_MS + 1_200);
    } else {
      const p = podOr(m.by);
      const rep = chairLine.report(m.by);
      chair(rep);
      if (p) {
        goIn(p, "r");
        focus = p;
        lookTo.set(1, 2.5, 1.2);
        dollyTo = 0.93;
      }
      await both(line("kernel", rep, tk, 0), sleep(FLY_MS, tk));
      say("b", p, m.report, false, true);
      await line(m.by, spoken(m.report, true), tk);
      if (m.risk) {
        const c = podOr(m.risk.by);
        const rk = chairLine.risk();
        chair(rk);
        if (c) {
          goIn(c, "a", true);
          focus = c;
          lookTo.set(-0.4, 2.5, 1.2);
        }
        await both(line("kernel", rk, tk, 0), sleep(FLY_MS, tk));
        say("a", c, m.risk.say, true);
        await line(m.risk.by, spoken(m.risk.say), tk);
      }
      chair(m.done);
      saidHere.add(`${m.key}@${m.ver}`);
      opts.onDone(m.key);
      lookTo.set(0, 2.4, 0.6);
      dollyTo = 1;
      focus = null;
      await line("kernel", m.done, tk, ITEM_END_MS);
    }
    clearCaps();
    allHome();
    voteTo = 0;
    shareTo = 0;
    kind = "idle";
    floorKey = null;
    opts.onFloor(null);
    await sleep(ITEM_GAP_MS, tk);
  }
  /** The next status line not yet said, from a member with a seat. */
  const nextAmbient = () => ambient.find((a) => byId(a.by) && ambientFresh(a)) ?? null;
  async function interlude(it: { by: string; text: string }, tk: number) {
    chair("");
    opts.onFloor(null);
    kind = "idle";
    // Said once (#900): marked as it starts, so a cut-off line isn't tried again and again.
    const ak = ambientKey(it.by, it.text);
    saidHere.add(ak);
    opts.memory?.hear(ak);
    const p = byId(it.by);
    if (!p) return;
    voice?.prefetch([{ by: it.by, text: it.text }]);
    goIn(p, "u");
    focus = p;
    lookTo.set(-1, 2.3, 1.3);
    dollyTo = 0.95;
    await sleep(FLY_MS, tk);
    say("a", p, { text: it.text });
    await line(it.by, it.text, tk, 0);
    say("a", null);
    goHome(p);
    focus = null;
    lookTo.set(0, 2.2, 0);
    dollyTo = 1;
    await sleep(ITEM_GAP_MS, tk);
  }
  // The recess (#878): with nothing on the docket, the members argue a topic of their own (debates.ts), more of them on
  // the floor than any item brings. The opener and those who concur take the a, c and b spots; the dissent takes the red
  // counter spot. Each stays on the floor until its spot is wanted again, so the floor fills as the argument grows. Real
  // business preempts it: a docket that fills starts a new session, which cancels this one mid-line.
  // Since #910 each argument is new (liveTalk.ts): made live as the chamber runs, or a written one this viewer hasn't
  // heard; with nothing new, the chamber keeps quiet a while and asks again. Nothing is argued twice.
  let topic: FloorTopic | null = null;
  // Nikita's words joined to the argument (#925, senateFloor.ts). Since #948 the members who were speaking answer him on
  // the floor itself, risen on their podiums, while the session is held; once it picks up, the line he cut into finishes
  // and the argument carries on from there with his point in it and a new ruling.
  let joinQ: Joined | null = null;
  const dropJoin = () => {
    joinQ = null;
  };
  async function debate(tk: number) {
    const d = opts.recess ? await opts.recess.peek() : null;
    if (tk !== token || dead) throw new Error("cancel");
    if (!d) {
      chair("");
      await sleep(QUIET_MS, tk);
      return;
    }
    opts.recess?.take(d);
    topic = { motion: d.motion, lines: [], cast: [...new Set(d.lines.map((l) => l.by).filter((b) => b !== "kernel"))] };
    kind = "decision";
    opts.onFloor(null);
    clearCaps();
    voice?.prefetch(debateLines(d));
    const open = debateOpen(d);
    chair(open);
    lookTo.set(0, 2.5, 0.8);
    dollyTo = 1;
    await line("kernel", open, tk);
    const spots: [Slot, SpotId][] = [["a", "a"], ["c", "c"], ["b", "b"]];
    const held = new Map<SpotId, Pod>();
    let s = 0;
    /** One member's line: from the spot it already stands on, or the next free one (the dissent takes the counter spot). */
    const speak = async (by: string, text: string, nay: boolean) => {
      const p = podOr(by);
      const mine = p ? [...held].find(([, q]) => q === p)?.[0] : undefined;
      const [slot, spot]: [Slot, SpotId] = mine ? [mine as Slot, mine] : nay ? ["d", "d"] : spots[s++ % spots.length]!;
      const was = held.get(spot);
      if (was && was !== p) {
        say(slot, null);
        goHome(was);
      }
      if (p) {
        if (!mine) {
          goIn(p, spot, nay);
          held.set(spot, p);
        }
        focus = p;
        lookTo.set(SPOT[spot].x * 0.4, 2.6, 0.8);
        dollyTo = 0.96;
        if (!mine) await sleep(FLY_MS, tk);
      }
      if (p) say(slot, p, { text }, spot === "d");
      else chair(text);
      topic?.lines.push({ by, text });
      await line(p ? by : "kernel", text, tk);
    };
    let queue = [...d.lines];
    let close = d.close;
    let closed = false;
    for (;;) {
      const jq = joinQ;
      if (jq) {
        joinQ = null;
        // The argument goes on from here, his point (and the answers he had) in it, to a new ruling.
        voice?.prefetch([...jq.rest, { by: "kernel", text: jq.close }]);
        queue = [...jq.rest];
        if (jq.close !== close) {
          close = jq.close;
          closed = false;
        }
        continue;
      }
      const l = queue.shift();
      if (l) {
        await speak(l.by, l.text, l.stance === "nay");
        continue;
      }
      if (closed) break;
      chair(close);
      voteTo = 1;
      shareTo = 0.6;
      focus = null;
      lookTo.set(0, 2.6, 0.4);
      dollyTo = 1.04;
      await line("kernel", close, tk, ITEM_END_MS);
      closed = true;
    }
    topic = null;
    dropJoin();
    chair("");
    clearCaps();
    allHome();
    voteTo = 0;
    shareTo = 0;
    kind = "idle";
    await sleep(ITEM_GAP_MS, tk);
  }
  async function session(startKey: string | null) {
    const tk = ++token;
    topic = null;
    dropJoin();
    voice?.stop();
    allHome();
    clearCaps();
    floorKey = null;
    // Each item is said once (#900): a card brought to the floor first, then whatever is new, in docket order, with a
    // new status line between; once nothing new is left, the recess. Nothing already said is read out again.
    let first = startKey ? (docket.find((m) => m.key === startKey) ?? null) : null;
    try {
      for (;;) {
        const m = first ?? docket.find(fresh) ?? null;
        first = null;
        if (m) {
          await runItem(m, tk);
          const a = nextAmbient();
          if (a) await interlude(a, tk);
          continue;
        }
        const a = nextAmbient();
        if (a) await interlude(a, tk);
        else await debate(tk);
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
  // More of it since #948, and further out, round the bench too.
  const haze = Array.from({ length: PH0 ? 12 : 26 }, (_, i) => {
    const inShaft = i % 3 === 0;
    const s = new Sprite(keep(new SpriteMaterial({ map: hazeTex, color: inShaft ? 0xffe9c8 : 0x7f90bb, transparent: true, opacity: inShaft ? 0.09 : 0.07, depthWrite: false })));
    const r = inShaft ? Math.random() * 0.8 : 3 + Math.random() * 9;
    const a = Math.random() * 6.28;
    s.position.set(Math.cos(a) * r, inShaft ? Math.random() * 10 : 0.8 + Math.random() * 6, Math.sin(a) * r);
    s.scale.setScalar(inShaft ? 2.4 + Math.random() * 1.5 : 5 + Math.random() * 6);
    s.userData = { inShaft, a, r, w: (Math.random() - 0.5) * 0.04, rot: (Math.random() - 0.5) * 0.05 };
    scene.add(s);
    return s;
  });

  // The fog (#948, Nikita: "fog and atmospheric effects so it isn't too clear"). Ground fog: a few sheets of slow, drifting
  // noise low over the floor, thin round the podium so the chair stays clear, thickening out past the members and the
  // bench. And a veil of mist hung in front of the gallery, just beyond the furthest the camera goes (clearance.ts), so
  // the gallery's tiers sink into it and the bowl has depth. All in the shaders: no per-frame work but a clock.
  const NOISE = `float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(h2(i), h2(i+vec2(1.,0.)), f.x), mix(h2(i+vec2(0.,1.)), h2(i+vec2(1.,1.)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0., a = .5; for (int o = 0; o < ${PH0 ? 3 : 4}; o++){ v += a*vn(p); p = p*2.03 + 17.1; a *= .5; } return v; }`;
  const fogT = { value: 0 };
  // Raw display values, as the chamber's other shaders write them (no tone mapping on a ShaderMaterial).
  const fogC = new Color().setRGB(0.15, 0.17, 0.235);
  const fogSheet = (y: number, strength: number, off: number) => {
    const m = new Mesh(
      keep(new PlaneGeometry(90, 90)),
      keep(
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          uniforms: { t: fogT, col: { value: fogC }, k: { value: strength }, off: { value: off } },
          vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
          fragmentShader: `uniform float t, k, off; uniform vec3 col; varying vec3 vW; ${NOISE}
            void main(){ float r = length(vW.xz);
              vec2 p = vW.xz*.11 + vec2(t*.018 + off, -t*.011 + off*1.7);
              float n = fbm(p + fbm(p*1.6 - t*.01)*1.3);
              float a = smoothstep(.36, .82, n) * k * smoothstep(2.4, 7.5, r) * (1. - smoothstep(28., 42., r));
              gl_FragColor = vec4(col, a); }`,
        }),
      ),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = 3;
    scene.add(m);
  };
  fogSheet(0.28, 0.6, 0);
  fogSheet(0.85, 0.42, 3.1);
  if (!PH0) fogSheet(1.6, 0.24, 7.4);
  const VEIL_R = (CAMERA_MAX_R + GALLERY_R0) / 2;
  const mist = new Mesh(
    keep(new CylinderGeometry(VEIL_R, VEIL_R, 16, 96, 1, true)),
    keep(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: BackSide,
        uniforms: { t: fogT, col: { value: fogC } },
        vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform float t; uniform vec3 col; varying vec2 vU; ${NOISE}
          void main(){ float n = fbm(vec2(vU.x*38. + t*.02, vU.y*4.5 - t*.012));
            float a = (.18 + .5*smoothstep(.3, .85, n)) * (1. - smoothstep(.15, .9, vU.y)) * .55;
            gl_FragColor = vec4(col*.8, a); }`,
      }),
    ),
  );
  mist.position.y = 7.6;
  mist.renderOrder = 1;
  scene.add(mist);

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

  // The chamber's edges come undone into code (#856). Nikita, 2026-11-05: "the middle and the center edge and most of the
  // screen should be pretty solid, once you start getting to the edges, that's where it starts to get in this wireframe
  // ... like a mixture of nanites and wires ... kind of being turned into code", and "the primary color for nanites and
  // wireframe should be gold", the Desk's accent (the Rotunda's --rt-brass and --rt-gold, rotunda.css). Three cheap
  // layers, all weighted by how far a pixel sits from the middle of the frame: a veil that lets the solid chamber fall
  // away toward the corners, a gold wire grid laid over the bowl's wall and floor that breaks into dashes and flickers,
  // and sigil glyphs from the nanites' atlas scattered along the same surfaces, drifting up as if the walls were
  // dissolving. No extra pass and no extra model; fewer of each on a phone; held still under reduced motion.
  const edgeU = { t: { value: 0 }, res: { value: new Vector2(1, 1) }, atlas: { value: atlas }, px: nU.px };
  // 0 in the middle of the frame, 1 at the corners (a touch wider than tall, so the sides go before the top).
  const EDGE = `uniform vec2 res; float edgeOf(){ vec2 q = gl_FragCoord.xy / res * 2. - 1.; return length(q * vec2(.84, 1.)) / 1.31; }
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
            vec3 c = vec3(.03, .026, .02) + vec3(.79, .66, .36) * e * .05 * scan;
            gl_FragColor = vec4(c, e * (.62 + .14 * g)); }`,
      }),
    ),
  );
  veil.frustumCulled = false;
  veil.renderOrder = 20;
  scene.add(veil);
  // The wires: the wall's verticals and tier rings, the floor's rings and spokes, a little inside the surfaces they trace.
  const wire: number[] = [];
  const wallR = (y: number) => 13 + ((y + 0.5) / 22) * 11;
  const VERT = PH0 ? 40 : 72;
  const RING = PH0 ? 64 : 128;
  for (let k = 0; k < VERT; k++) {
    const a = (k / VERT) * Math.PI * 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    wire.push(c * wallR(0.2) * 0.99, 0.2, s * wallR(0.2) * 0.99, c * wallR(16) * 0.99, 16, s * wallR(16) * 0.99);
  }
  const ring = (r: number, y: number) => {
    for (let k = 0; k < RING; k++) {
      const a0 = (k / RING) * Math.PI * 2;
      const a1 = ((k + 1) / RING) * Math.PI * 2;
      wire.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
    }
  };
  for (let k = 0; k < 12; k++) {
    const y = 0.6 + k * 1.35;
    ring(wallR(y) * 0.99, y);
  }
  for (let r = 6; r < 13; r += 1.4) ring(r, 0.02);
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    wire.push(Math.cos(a) * 5.6, 0.02, Math.sin(a) * 5.6, Math.cos(a) * 13, 0.02, Math.sin(a) * 13);
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
          void main(){ float e = smoothstep(.42, .95, edgeOf()); if (e < .01) discard;
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
  // The code nanites: glyphs strewn along the same wall and floor, rising slowly and winking in and out.
  const NE = PH0 ? 420 : 1200;
  const ep = new Float32Array(NE * 3);
  const eg = new Float32Array(NE);
  const er = new Float32Array(NE);
  for (let i = 0; i < NE; i++) {
    const a = Math.random() * Math.PI * 2;
    const onWall = Math.random() < 0.7;
    const y = onWall ? 0.3 + Math.random() * 15 : 0.05;
    const r = onWall ? wallR(y) * 0.985 : 6 + Math.random() * 7;
    ep.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
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
            vec3 p = position; p.y += fract(t * .03 + rnd) * 1.2;
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.6 + rnd * .6) * 24. * px * (6. / -mv.z); gl_Position = projectionMatrix * mv; }`,
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
  // The grid turning into nanites (#878). Nikita: "some really dimmed, faded nanites ... as if the grid is kind of turning
  // into the nanites." Faint sigils born on the wires themselves, each on a point of a real segment: it shows as a
  // glint of the wire's gold, peels away from it (off the wall toward the floor's middle, up off the floor) and fades as
  // it drifts, then is born again somewhere else on the grid. Sparse and dim, only where the grid shows (the frame's
  // edges), fewer on a phone, and held still under reduced motion (its clock stops with the rest of the edge).
  const NP = PH0 ? 140 : 420;
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
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (.45 + rnd * .35) * 22. * px * (6. / -mv.z) * (1. - ph * .35);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D atlas; varying vec2 vCell; varying float vL; ${EDGE}
          void main(){ float e = smoothstep(.42, .95, edgeOf()); if (e < .01) discard;
            vec2 uv = (vCell + gl_PointCoord) / 8.; uv.y = 1. - uv.y; float m = texture2D(atlas, uv).a; if (m < .05) discard;
            float life = smoothstep(0., .12, vL) * (1. - smoothstep(.45, 1., vL));
            vec3 c = mix(vec3(.89, .79, .55), vec3(.79, .66, .36), smoothstep(0., .5, vL));
            gl_FragColor = vec4(c, m * e * life * .32); }`,
      }),
    ),
  );
  peel.frustumCulled = false;
  peel.renderOrder = 22;
  scene.add(peel);
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
    fogT.value = reduce ? 0 : T;
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
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((en) => {
          visible = en[en.length - 1]!.isIntersecting;
          // The voices hold with the chamber, as its clock does.
          voice?.hold(!visible);
        })
      : null;
  io?.observe(host);
  let last = performance.now();
  let T = 0;
  let raf = 0;
  const tmp = new Vector3();
  const camDir = new Vector3();
  const shaftCol = new Color(0xffe6b8);
  const IDLE_SHAFT = new Color(0xffe6b8);
  const minStep = PH0 ? 1000 / 30 - 2 : 0;
  // WASD to look around the floor (#776); idle or Escape, it eases back to the session's own camera.
  // WASD round the Senate (#802): A/D orbit the camera round the chamber, W/S zoom in and out a little, both eased
  // and the zoom held to sensible limits; Escape brings the session's own view back. The shared helper (#776) keeps
  // the keys off while anything is typed into.
  // Since #925 the turn keeps to an arc either side of the session's view and the zoom to a tight range, each with a soft
  // edge (clearance.ts), so the camera never swings round onto a member's podium; Escape (and the idle return) bring the
  // session's own view back.
  let yaw = 0;
  let yawTo = 0;
  let zoom = 1;
  let zoomTo = 1;
  const pan = wasdPan({
    el: host,
    reduce,
    bounds: () => ({ kind: "disc", cx: 0, cz: 0, r: R + 1 }),
    origin: () => [look.x, look.z],
    forward: () => [look.x - cam.position.x, look.z - cam.position.z],
    orbit: {
      turn: (r) => (yawTo = softStep(yawTo, r, -YAW_ARC, YAW_ARC)),
      zoom: (a) => (zoomTo = softStep(zoomTo, -a * 0.3, ZOOM.in, ZOOM.out)),
      home: () => {
        yawTo = 0;
        zoomTo = 1;
      },
    },
  });
  // A hidden tab gets no frames, but the session goes on (#898): Nikita can switch windows and still hear the
  // Senate. The browser runs this at most once a second in the background; it moves only the session's clock.
  let bgAt = performance.now();
  const bg = window.setInterval(() => {
    const now = performance.now();
    if (document.visibilityState === "hidden" && visible) {
      const step = Math.min(2, Math.max(0, (now - bgAt) / 1000));
      clock.t += step;
      if (!floorHeld) sclock.t += step;
    }
    bgAt = now;
  }, 1000);
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
    if (!floorHeld) sclock.t += Math.min(0.5, raw);
    const k = 1 - Math.pow(0.04, dt);
    // The camera first (#925), so every podium can be kept clear of it this same frame.
    look.lerp(lookTo, k * 0.35);
    dolly += (dollyTo - dolly) * k * 0.35;
    const ph = phone();
    const ek = reduce ? 1 : 1 - Math.exp(-dt * 5);
    yaw += (yawTo - yaw) * ek;
    zoom += (zoomTo - zoom) * ek;
    const orbit = Math.PI / 2 + yaw + (reduce ? 0 : Math.sin(T * 0.06) * 0.32);
    // A tall phone stands further back, so the whole bowl fits across it.
    const rad = (ph ? (cam.aspect < 0.95 ? 17.5 : 15.5) : 13.2) * dolly * zoom;
    const camY = (ph ? 7.4 : 5.0) * (0.8 + dolly * 0.2);
    pan.step(dt);
    cam.position.set(Math.cos(orbit) * rad + pan.x, camY, Math.sin(orbit) * rad + pan.z);
    tmp.copy(look);
    tmp.x += pan.x;
    tmp.z += pan.z;
    if (ph) tmp.y += 1.1;
    cam.lookAt(tmp);
    camDir.copy(tmp).sub(cam.position).normalize();
    for (const p of pods) {
      if (p.tw) {
        const u = Math.min(1, (clock.t - p.tw.t0) / p.tw.dur);
        p.at.lerpVectors(p.tw.from, p.tw.to, ease(u));
        if (u >= 1) p.tw = null;
      }
      const target = p.hot ? Math.max(p.litTo, 0.95) : p.litTo;
      p.lit += (target - p.lit) * k;
      p.dis += (p.disTo - p.dis) * k;
      const bob = reduce ? 0 : Math.sin(T * 1.2 + p.phase) * (p.speaking || p.liftTo ? 0.08 : 0.04);
      p.lift += (p.liftTo - p.lift) * (reduce ? 1 : k * 0.5);
      p.g.position.set(p.at.x, p.at.y + bob + ease(p.lift) * 0.85, p.at.z);
      // Never in the camera's face (#925): one that comes into the keep-out round it and its line of sight shrinks away.
      const clear = keepOutScale(p.g.position, cam.position, camDir, KEEP_OUT);
      p.g.scale.setScalar(Math.max(1e-3, clear));
      p.g.visible = clear > 0.01;
      const face = p.speaking || p.liftTo ? Math.atan2(cam.position.x - p.at.x, cam.position.z - p.at.z) : Math.atan2(-p.at.x, -p.at.z);
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
    skLift += (skLiftTo - skLift) * (reduce ? 1 : k * 0.5);
    skG.position.y = 2.0 + ease(skLift) * 0.4 + (reduce ? 0 : Math.sin(T * 0.9) * 0.05);
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
    edgeU.t.value = reduce ? 0 : T;
    renderer.getDrawingBufferSize(edgeU.res.value);
    stepAtmos(dt, T);
    renderer.render(scene, cam);
    placeCaps();
    place();
    if (!reduce) {
      if (clock.t > nextMur && !floorHeld) {
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
  const speakAt = new Vector3();
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
    speakAt.set(sx, 0, sz);
    stepBench(dt, T, cur ? speakAt : null, cam.position, camDir);
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
      docket = items;
      // New business preempts the recess or an interlude at once; an item put away while on the floor leaves it. An item
      // already being said finishes, and the next new one follows it.
      const gone = floorKey !== null && !items.some((m) => m.key === floorKey);
      if (gone || (floorKey === null && items.some(fresh))) void session(null);
    },
    setAmbient: (lines) => {
      ambient = lines;
    },
    bring: (key) => void session(key),
    setHot: (id) => pods.forEach((p) => (p.hot = p.s.id === id)),
    hold: (on) => {
      if (on === floorHeld) return;
      floorHeld = on;
      voice?.hold(on, "floor");
      if (on) {
        // Whoever was mid-line stops talking; the rest of the line is theirs again on the way back.
        heldTalker = talker && clock.t < talker.talkUntil ? { a: talker, left: talker.talkUntil - clock.t } : null;
        for (const a of actors) a.talkUntil = Math.min(a.talkUntil, clock.t);
      } else if (heldTalker) {
        startTalk(heldTalker.a, clock.t, clock.t + heldTalker.left);
        talker = heldTalker.a;
        heldTalker = null;
      }
    },
    talk: (by, seconds) => {
      const a = by === "kernel" ? sk.a : (byId(by)?.a ?? null);
      if (!a) return;
      if (seconds > 0) {
        startTalk(a, clock.t, clock.t + seconds);
        talker = a;
      } else a.talkUntil = Math.min(a.talkUntil, clock.t);
    },
    topic: () => (topic ? { motion: topic.motion, lines: [...topic.lines], cast: [...(topic.cast ?? [])] } : null),
    join: (said, j) => {
      if (!topic || dead) return false;
      topic.lines.push({ by: "floor", text: said }, ...j.answers);
      joinQ = j;
      return true;
    },
    rise,
    where: () => {
      if (topic) return whereClause({ motion: topic.motion });
      const m = floorKey ? docket.find((x) => x.key === floorKey) : undefined;
      return m ? whereClause({ item: m.n }) : null;
    },
    dispose: () => {
      dead = true;
      token++;
      dropJoin();
      voice?.stop();
      cancelAnimationFrame(raf);
      window.clearInterval(bg);
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
