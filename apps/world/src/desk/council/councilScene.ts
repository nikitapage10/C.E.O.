import {
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
  WebGLRenderer,
  AdditiveBlending,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type SkinnedMesh,
  type Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { recolor } from "../../agents/bodies/recolor.ts";
import { modelUrl } from "../../modelUrl.ts";
import { drawFace, FACE_H, FACE_W } from "../hologram/face.ts";
import { ARMS, CHILD, fitCap, HEAD, NAVY, PHI, POSES, TH0, TH1, type Aims } from "../hologram/rig.ts";
import type { IrisLayout } from "./layout.ts";
import { drawMark } from "./marks.ts";
import { STILL_MANNER as STILL, type CouncilPose, type Manner } from "./manner.ts";

/**
 * The Council of Skippies in 3D (#666), Today's Iris: Skippy's own model, the admiral can (lib/custom/Skippy.glb, the
 * Lattice's and the hologram's), loaded once and shown eleven times. Skippy floats large in the middle in his own navy;
 * each submind is a clone (SkeletonUtils) with the coat repainted in its room's colour (recolor.ts, the Lattice's
 * band swap), its room's sigil glowing on its coat, a face of its own (face.ts, on a cap fitted over the painted one
 * as the hologram does), and its own way of moving (manner.ts): the model's clips where they fit, upper body only,
 * since he floats, and poses and procedural motion for the rest. The camera is orthographic in the stage's own CSS
 * pixels, so the seats in layout.ts are where the cans stand and the buttons over them line up exactly. Lazy loaded
 * with three.js (Iris.tsx), never in the Desk's first load.
 */

export interface CouncilMember {
  id: string;
  /** The coat's colour, hex; null for Skippy's own navy. */
  colour: string | null;
  manner: Manner;
  /** False: dim and still (a submind that isn't active). */
  alive: boolean;
}

export interface Council {
  layout: (L: IrisLayout, dpr: number) => void;
  setMembers: (m: CouncilMember[]) => void;
  setHot: (id: string | null) => void;
  /** Advances the motion by dt seconds (0 holds every one in its pose) and draws. */
  frame: (dt: number) => void;
  dispose: () => void;
}

const MODEL = "lib/custom/Skippy.glb";
/** The extra poses the Council strikes, on top of the hologram's: each bone aims its child along a direction. */
const COUNCIL_POSES: Record<Exclude<CouncilPose, keyof typeof POSES>, Aims> = {
  // The party: one arm up, one low, then swapped.
  dance: { LeftArm: [0.75, 0.6, 0.25], LeftForeArm: [0.15, 1, 0.2], RightArm: [-0.75, -0.55, 0.35], RightForeArm: [-0.2, 0.35, 0.9] },
  danceB: { LeftArm: [0.75, -0.55, 0.35], LeftForeArm: [0.2, 0.35, 0.9], RightArm: [-0.75, 0.6, 0.25], RightForeArm: [-0.15, 1, 0.2] },
  // The Director's frame: both hands up before his face, then out at arm's length.
  frame: { LeftArm: [0.5, -0.25, 0.85], LeftForeArm: [-0.25, 0.85, 0.5], RightArm: [-0.5, -0.25, 0.85], RightForeArm: [0.25, 0.85, 0.5] },
  frameB: { LeftArm: [0.35, 0.05, 1], LeftForeArm: [0.05, 0.6, 1], RightArm: [-0.35, 0.05, 1], RightForeArm: [-0.05, 0.6, 1] },
  // The Artiste's sweep: one arm raised out, the other at his front, then the sweep comes round.
  flourish: { LeftArm: [0.55, -0.6, 0.5], LeftForeArm: [-0.55, -0.05, 0.8], RightArm: [-0.85, 0.5, 0.3], RightForeArm: [-0.45, 0.85, 0.35] },
  flourishB: { LeftArm: [0.55, -0.6, 0.5], LeftForeArm: [-0.55, -0.05, 0.8], RightArm: [-0.55, 0.05, 0.85], RightForeArm: [0.3, 0.3, 0.9] },
  // The Executive: hands clasped behind his back.
  behind: { LeftArm: [0.25, -0.95, -0.45], LeftForeArm: [-0.6, -0.25, -0.75], RightArm: [-0.25, -0.95, -0.45], RightForeArm: [0.6, -0.25, -0.75] },
  // The Bookie: a hand at his chest, counting it out.
  tap: { LeftArm: [0.35, -1, 0.3], LeftForeArm: [0.1, -1, 0.45], RightArm: [-0.3, -0.8, 0.55], RightForeArm: [0.6, 0.15, 0.8] },
  // The Builder: the hammer raised, and down on the anvil before him.
  hammerUp: { LeftArm: [0.35, -0.75, 0.55], LeftForeArm: [-0.35, -0.1, 1], RightArm: [-0.55, -0.15, 0.8], RightForeArm: [-0.05, 1, 0.25] },
  hammerDown: { LeftArm: [0.35, -0.75, 0.55], LeftForeArm: [-0.35, -0.1, 1], RightArm: [-0.4, -0.55, 0.75], RightForeArm: [0.05, -0.55, 1] },
  // The Commentator pointing at the play.
  point: { LeftArm: [0.8, -0.2, 0.4], LeftForeArm: [0.2, 0.6, 0.8], RightArm: [-0.35, 0.15, 1], RightForeArm: [-0.15, 0.25, 1] },
};
const ALL_POSES: Record<CouncilPose, Aims> = { ...POSES, ...COUNCIL_POSES };

/** Leg tracks and the hips' bounce go: he floats (Library.tsx does the same for the Lattice). */
const LEGS = /(UpLeg|Leg|Foot|Toe)[^.]*\.|Hips\.position/;
const upperBody = (clip: AnimationClip) => {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => !LEGS.test(t.name));
  return c;
};

/** The view from a little above: the hat's top shows and the face still meets you. */
const PITCH = 0.14;
const FACE_SCALE = 0.5;

interface Fig {
  id: string;
  m: CouncilMember;
  root: Group;
  model: Object3D;
  bones: Map<string, Bone>;
  mat: MeshStandardMaterial;
  baseMap: Texture | null;
  face: { ctx: CanvasRenderingContext2D; tex: CanvasTexture; mat: MeshStandardMaterial; drawn: string } | null;
  emblem: { tex: CanvasTexture; mat: MeshBasicMaterial } | null;
  mixer: AnimationMixer | null;
  action: AnimationAction | null;
  /** Its own clock, scaled by its tempo, and its seat. */
  pt: number;
  x: number;
  y: number;
  size: number;
  yaw: number;
  glow: number;
  hot: boolean;
  /** Set when its pose must land at once (the first frame, reduced motion). */
  snap: boolean;
}

export async function createCouncil(canvas: HTMLCanvasElement, opts: { phone: boolean }): Promise<Council> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(modelUrl(MODEL));

  const renderer = new WebGLRenderer({ canvas, antialias: !opts.phone, alpha: true, powerPreference: "low-power" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  // A dim chamber: moonlight from above, cool silver and violet, almost nothing from below.
  scene.add(new HemisphereLight(0xc9c4ff, 0x0c0b14, 1.1));
  const over = new DirectionalLight(0xe6e2ff, 2.1);
  scene.add(over);
  scene.add(over.target);
  const front = new DirectionalLight(0x9aa6d6, 0.55);
  scene.add(front);
  scene.add(front.target);
  // The hover's light from above (the cone itself is drawn over the page in Iris.tsx).
  const spot = new SpotLight(0xffffff, 0, 0, 0.16, 0.55, 0);
  scene.add(spot);
  scene.add(spot.target);

  const camera = new OrthographicCamera(0, 2, 0, -2, 1, 6000);
  camera.position.set(0, 0, 3000);

  // The prototype: his bind pose, measured once.
  const proto = gltf.scene;
  proto.updateMatrixWorld(true);
  let body: SkinnedMesh | null = null;
  proto.traverse((o) => {
    if (!body && (o as SkinnedMesh).isSkinnedMesh) body = o as SkinnedMesh;
  });
  if (!body) throw new Error("Skippy's model has no skinned mesh");
  const protoBody: SkinnedMesh = body;
  const box = new Box3().setFromObject(proto);
  const centre = box.getCenter(new Vector3());
  const height = box.max.y - box.min.y || 0.8;
  const protoMap: Texture | null = (protoBody.material as MeshStandardMaterial).map;

  // The face cap (holoScene.ts): fitted once on the prototype, shared by every clone.
  const W_SEG = 40;
  const H_SEG = 20;
  const capGeo = new SphereGeometry(HEAD.r, W_SEG, H_SEG, Math.PI / 2 - PHI / 2, PHI, TH0, TH1 - TH0);
  fitCap(capGeo, protoBody, W_SEG, H_SEG);

  // Where the coat's front is, at chest height: one ray onto the real surface.
  const chestY = box.min.y + (HEAD.c.y - HEAD.r - box.min.y) * 0.5;
  const rc = new Raycaster(new Vector3(0, chestY, 2), new Vector3(0, 0, -1));
  const hitZ = rc.intersectObject(protoBody, false)[0]?.point.z ?? box.max.z * 0.8;
  const emblemGeo = new PlaneGeometry(0.15, 0.15);

  // Every pose's arm rotations, worked out once on the prototype from its bind pose.
  const protoBones = new Map<string, Bone>();
  proto.traverse((o) => {
    if ((o as Bone).isBone) protoBones.set(o.name.replace(/^mixamorig:?/, ""), o as Bone);
  });
  const bind = new Map<string, Quaternion>();
  for (const [name, b] of protoBones) bind.set(name, b.quaternion.clone());
  const aim = (name: (typeof ARMS)[number], dir: [number, number, number]) => {
    const b = protoBones.get(name);
    const c = protoBones.get(CHILD[name]);
    if (!b || !c || !b.parent) return;
    proto.updateMatrixWorld(true);
    const from = c.getWorldPosition(new Vector3()).sub(b.getWorldPosition(new Vector3())).normalize();
    const q = new Quaternion().setFromUnitVectors(from, new Vector3(...dir).normalize());
    const wq = b.getWorldQuaternion(new Quaternion());
    const pq = b.parent.getWorldQuaternion(new Quaternion()).invert();
    b.quaternion.copy(pq.multiply(q.multiply(wq)));
  };
  const poses = new Map<CouncilPose, Map<string, Quaternion>>();
  for (const [id, aims] of Object.entries(ALL_POSES) as [CouncilPose, Aims][]) {
    for (const n of ARMS) protoBones.get(n)?.quaternion.copy(bind.get(n) ?? new Quaternion());
    for (const n of ARMS) {
      const d = aims[n];
      if (d) aim(n, d);
    }
    poses.set(id, new Map(ARMS.map((n) => [n, protoBones.get(n)?.quaternion.clone() ?? new Quaternion()])));
  }
  for (const n of ARMS) protoBones.get(n)?.quaternion.copy(bind.get(n) ?? new Quaternion());
  proto.updateMatrixWorld(true);

  const clips = new Map(gltf.animations.map((c) => [c.name, upperBody(c)]));

  const figs = new Map<string, Fig>();
  let L: IrisLayout | null = null;
  let hot: string | null = null;

  const make = (m: CouncilMember): Fig => {
    const model = cloneSkinned(proto);
    model.position.copy(centre).multiplyScalar(-1);
    const bones = new Map<string, Bone>();
    let mesh: SkinnedMesh | null = null;
    model.traverse((o) => {
      if ((o as Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ""), o as Bone);
      if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
    });
    const sk = mesh as SkinnedMesh | null;
    const mat = ((sk?.material as MeshStandardMaterial | undefined) ?? new MeshStandardMaterial()).clone();
    if (sk) {
      sk.material = mat;
      sk.frustumCulled = false;
    }
    const root = new Group();
    const inner = new Group();
    inner.add(model);
    root.add(inner);
    root.userData.inner = inner;
    scene.add(root);

    // The face, on the cap over the painted one, riding the Head bone.
    let face: Fig["face"] = null;
    const head = bones.get("Head");
    if (head) {
      const fc = document.createElement("canvas");
      fc.width = FACE_W * FACE_SCALE;
      fc.height = FACE_H * FACE_SCALE;
      const ctx = fc.getContext("2d");
      if (ctx) {
        ctx.scale(FACE_SCALE, FACE_SCALE);
        const tex = new CanvasTexture(fc);
        tex.colorSpace = SRGBColorSpace;
        const fmat = new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0, depthWrite: false });
        const cap = new Mesh(capGeo, fmat);
        cap.renderOrder = 2;
        model.add(cap);
        cap.position.copy(HEAD.c);
        model.updateMatrixWorld(true);
        head.attach(cap);
        face = { ctx, tex, mat: fmat, drawn: "" };
      }
    }

    // The room's sigil, glowing on the coat; Skippy wears none.
    let emblem: Fig["emblem"] = null;
    if (m.colour) {
      const ec = document.createElement("canvas");
      ec.width = 128;
      ec.height = 128;
      const g = ec.getContext("2d");
      if (g) {
        const c = new Color(m.colour);
        const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
        drawMark(g, m.id, 64, 64, 40, rgb, 1, 5);
        drawMark(g, m.id, 64, 64, 40, "255,255,255", 0.55, 1.6);
        const tex = new CanvasTexture(ec);
        tex.colorSpace = SRGBColorSpace;
        const emat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false });
        const plane = new Mesh(emblemGeo, emat);
        plane.renderOrder = 3;
        model.add(plane);
        plane.position.set(0, chestY, hitZ + 0.006);
        model.updateMatrixWorld(true);
        const spine = bones.get("Spine2") ?? bones.get("Spine1") ?? bones.get("Spine");
        if (spine) spine.attach(plane);
        emblem = { tex, mat: emat };
      }
    }

    const fig: Fig = { id: m.id, m, root, model, bones, mat, baseMap: protoMap, face, emblem, mixer: null, action: null, pt: hash(m.id) * 10, x: 0, y: 0, size: 100, yaw: 0, glow: 0, hot: false, snap: true };
    dress(fig, m);
    return fig;
  };

  /** Its coat, its brightness and its clip, from what it is and whether it's active. */
  const dress = (f: Fig, m: CouncilMember) => {
    f.m = m;
    if (f.baseMap && m.colour) f.mat.map = recolor(`council-${m.colour}`, f.baseMap, [{ band: NAVY, color: m.colour }]);
    f.mat.color.setScalar(m.alive ? 1 : 0.34);
    f.mat.emissive = new Color(m.colour ?? "#8f9cff");
    f.mat.emissiveIntensity = 0;
    f.mat.needsUpdate = true;
    if (f.emblem) f.emblem.mat.opacity = m.alive ? 1 : 0.3;
    if (f.face) f.face.mat.color.setScalar(m.alive ? 1 : 0.4);
    const clip = m.alive && m.manner.clip ? clips.get(m.manner.clip) : undefined;
    if (clip && !f.action) {
      f.mixer = new AnimationMixer(f.model);
      f.action = f.mixer.clipAction(clip);
      f.action.setLoop(LoopRepeat, Infinity);
      f.action.timeScale = m.manner.clipSpeed ?? 1;
      f.action.play();
    } else if (!clip && f.action) {
      f.action.stop();
      f.mixer?.stopAllAction();
      f.action = null;
      f.mixer = null;
    }
    f.snap = true;
  };

  const place = () => {
    if (!L) return;
    for (const f of figs.values()) {
      if (f.id === "kernel") {
        f.x = L.cx;
        f.y = L.cy;
        f.size = L.skippy;
        f.yaw = 0;
      } else {
        const seat = L.seats.find((s) => s.id === f.id);
        if (!seat) continue;
        f.x = seat.x;
        f.y = seat.y;
        f.size = L.member;
        // Each turns a little toward the pupil.
        f.yaw = -Math.sin(seat.a) * 0.35;
      }
    }
    over.position.set(L.cx, 1200, 900);
    over.target.position.set(L.cx, -L.cy, 0);
    front.position.set(L.cx, -L.cy + 200, 1500);
    front.target.position.set(L.cx, -L.cy, 0);
  };

  const tq = new Quaternion();
  const tq2 = new Quaternion();
  const eu = new Euler();

  const animate = (f: Fig, dt: number) => {
    const M = f.m.alive ? f.m.manner : STILL;
    const still = dt === 0;
    f.pt += dt * M.tempo;
    const pt = f.pt;
    const move = still || !f.m.alive ? 0 : 1;
    const k = f.snap ? 1 : 1 - Math.exp(-dt * 9);

    // The Pessimist's sigh: a slow drop and back.
    const sighT = M.sighEvery ? (pt % M.sighEvery) / M.sighEvery : 1;
    const sigh = M.sighEvery && sighT < 0.35 ? Math.sin((sighT / 0.35) * Math.PI) * move : 0;

    // Arms: the clip, or the pose and its swing.
    if (f.mixer && move) f.mixer.update(dt);
    else {
      const A = poses.get(M.pose);
      const B = M.poseB ? poses.get(M.poseB) : undefined;
      let w = 0;
      if (B) {
        if (still) w = M.swing === "strike" ? 0.15 : 0.35;
        else if (M.swing === "strike") {
          const ph = (pt * 0.85) % 1;
          w = ph < 0.16 ? Math.pow(ph / 0.16, 2) : Math.max(0, 1 - (ph - 0.16) / 0.5);
        } else if (M.swing === "snap") w = (pt * 0.22) % 1 < 0.5 ? 0 : 1;
        else w = 0.5 + 0.5 * Math.sin(pt * 2.2);
      }
      const strike = M.swing === "strike";
      for (const n of ARMS) {
        const b = f.bones.get(n);
        const a = A?.get(n);
        if (!b || !a) continue;
        tq.copy(a);
        const bb = B?.get(n);
        if (bb) tq.slerp(bb, w);
        // The Bookie's tapping finger, the Builder's working left hand.
        if (move && f.id === "exchange" && n === "RightForeArm") tq.multiply(tq2.setFromEuler(eu.set(Math.sin(pt * 16) * 0.16, 0, 0)));
        if (move && sigh && (n === "LeftArm" || n === "RightArm")) tq.multiply(tq2.setFromEuler(eu.set(0, 0, (n === "LeftArm" ? -1 : 1) * 0.1 * sigh)));
        b.quaternion.slerp(tq, strike && move ? Math.min(1, k * 2.5) : k);
      }
    }

    // The head: its own tilt, its glances, a slow drift, the sigh.
    const H = f.bones.get("Head");
    const hq = bind.get("Head");
    if (H && hq) {
      const glance = M.glance && move ? Math.sign(Math.sin(pt * Math.PI * M.glanceRate)) * M.glance * (0.6 + 0.4 * Math.abs(Math.sin(pt * 1.7))) : 0;
      const nod = M.head[0] + sigh * 0.3 + (f.id === "foundry" && move ? Math.max(0, Math.sin(pt * 0.85 * Math.PI * 2)) * 0.1 : 0);
      tq.setFromEuler(eu.set(nod, M.head[1] + glance + Math.sin(pt * 0.7) * 0.07 * move, M.head[2] + Math.sin(pt * 0.5) * 0.05 * move));
      tq2.copy(hq).multiply(tq);
      H.quaternion.slerp(tq2, f.snap ? 1 : Math.min(1, k * (M.glance ? 2.2 : 1)));
    }

    // The body: float, hop, darts, sway, spin, lean, squash.
    const s = f.size / height;
    const bob = Math.sin(pt * 1.3) * M.bob * f.size * move;
    const hop = Math.abs(Math.sin(pt * 3)) * M.bounce * f.size * move;
    const dx = M.dart ? (Math.sin(pt * 2.3) + 0.6 * Math.sin(pt * 5.7 + 1)) * M.dart * f.size * 0.6 * move : 0;
    const dy = M.dart ? Math.sin(pt * 3.1 + 2) * M.dart * f.size * 0.35 * move : 0;
    f.root.position.set(f.x + dx, -(f.y - bob - hop - dy) + sigh * -0.02 * f.size, f.id === "kernel" ? 0 : 40);
    const spin = M.spinEvery && move ? (pt / M.spinEvery) * Math.PI * 2 : 0;
    const inner = f.root.userData.inner as Group;
    inner.rotation.set(PITCH + M.lean + sigh * 0.12, f.yaw + Math.sin(pt * M.swayRate * Math.PI * 2) * M.sway * move + spin, Math.sin(pt * 0.9) * M.roll * move, "YXZ");
    const sq = (Math.abs(Math.sin(pt * 3)) * M.squash + sigh * 0.04) * move;
    f.glow += ((f.hot ? 1 : 0) - f.glow) * (still ? 1 : Math.min(1, dt * 8));
    const grow = 1 + f.glow * 0.08;
    f.root.scale.set(s * grow * (1 + sq * 0.5), s * grow * (1 - sq), s * grow * (1 + sq * 0.5));
    f.mat.emissiveIntensity = f.glow * 0.22 + (f.id === "kernel" ? 0.04 : 0);

    // Its face: drawn when it changes; the Commentator and the party keep talking.
    if (f.face) {
      const talk = move && (f.id === "green" || f.id === "breakroom" || f.id === "kernel") ? Math.round(Math.abs(Math.sin(pt * (f.id === "kernel" ? 2.6 : 4.5))) * (f.id === "kernel" ? 2 : 4)) : 0;
      const key = `${M.face}:${talk}`;
      if (key !== f.face.drawn) {
        drawFace(f.face.ctx, M.face, talk / 6);
        f.face.tex.needsUpdate = true;
        f.face.drawn = key;
      }
    }
    f.snap = false;
  };

  const render = () => renderer.render(scene, camera);

  return {
    layout: (next, dpr) => {
      L = next;
      renderer.setPixelRatio(dpr);
      renderer.setSize(next.w, next.h, false);
      camera.left = 0;
      camera.right = next.w;
      camera.top = 0;
      camera.bottom = -next.h;
      camera.updateProjectionMatrix();
      place();
      for (const f of figs.values()) f.snap = true;
    },
    setMembers: (ms) => {
      for (const m of ms) {
        const had = figs.get(m.id);
        if (had) dress(had, m);
        else figs.set(m.id, make(m));
      }
      place();
    },
    setHot: (id) => {
      hot = id;
      for (const f of figs.values()) f.hot = f.id === id;
      const f = id ? figs.get(id) : undefined;
      if (f) {
        spot.position.set(f.x, -f.y + 900, 260);
        spot.target.position.set(f.x, -f.y, 0);
        spot.angle = Math.atan((f.size * 0.9) / 900);
        spot.intensity = 5;
      } else spot.intensity = 0;
    },
    frame: (dt) => {
      for (const f of figs.values()) animate(f, dt);
      if (hot) {
        const f = figs.get(hot);
        if (f) spot.target.position.set(f.root.position.x, f.root.position.y, 0);
      }
      render();
    },
    dispose: () => {
      for (const f of figs.values()) {
        f.mixer?.stopAllAction();
        f.mat.dispose();
        f.face?.tex.dispose();
        f.face?.mat.dispose();
        f.emblem?.tex.dispose();
        f.emblem?.mat.dispose();
      }
      capGeo.dispose();
      emblemGeo.dispose();
      proto.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}


/** A steady 0..1 from an id, so each member starts at its own point in its cycle. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
