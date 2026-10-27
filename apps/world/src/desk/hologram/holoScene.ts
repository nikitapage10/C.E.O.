import {
  AmbientLight,
  Bone,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type Object3D,
  type Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { recolor, type Band } from "../../agents/bodies/recolor.ts";
import { modelUrl } from "../../modelUrl.ts";
import { FACE_H, FACE_W, drawFace } from "./face.ts";
import type { Expression } from "./signal.ts";

/**
 * Skippy as a hologram (#481): his own Lattice model (the admiral can, lib/custom/Skippy.glb), posed per expression,
 * with a face that moves, drawn through a hologram pass (cyan, scanlines, a soft edge glow, the odd glitch band).
 * Loaded only once Talk is tapped (HologramStage.tsx), so none of three.js is in the Desk's first load.
 *
 * The model has no face rig: his eyes and mouth are painted into the texture and the head carries only a Head bone.
 * So a thin cap is fitted over the front of his head once, by casting from the head's centre onto the real surface
 * (smoothed so the modelled brow ridges don't print through), and parented to the Head bone; it carries the face from
 * face.ts on a canvas, redrawn when his expression or his mouth changes.
 */

export interface HoloFrame {
  expr: Expression;
  /** The call's level, 0 to 1. */
  level: number;
  speaking: boolean;
  /** Holds the flicker and glitch bands still. */
  still: boolean;
}

export interface Holo {
  frame: (dt: number, f: HoloFrame) => void;
  /** The hologram's colour and the can's navy: Skippy's own (null) or a submind's. */
  setColour: (colour: string | null) => void;
  resize: (w: number, h: number, dpr: number) => void;
  dispose: () => void;
}

const MODEL = "lib/custom/Skippy.glb";
/** The admiral can's navy (Library.tsx, SKIPPY_NAVY): the band a submind repaints in its room's colour. */
const NAVY: Band = { hue: 212, width: 24, minSat: 0.25, refL: 0.21 };
/** Skippy's own hologram cyan. */
export const SKIPPY_HOLO = "#6fe3ff";

/** His head, in the model's own space: found by probing the model (the face cap is cast onto it from here). */
const HEAD = { c: new Vector3(0, 0.468, 0.005), r: 0.134 };
/** The cap's span: around the head (radians) and from the top (polar range, radians). */
const PHI = 1.9;
const TH0 = 1.05;
const TH1 = 2.3;

type Aims = Partial<Record<"LeftArm" | "LeftForeArm" | "RightArm" | "RightForeArm", [number, number, number]>>;
const CHILD = { LeftArm: "LeftForeArm", LeftForeArm: "LeftHand", RightArm: "RightForeArm", RightForeArm: "RightHand" } as const;
const ARMS = ["LeftArm", "LeftForeArm", "RightArm", "RightForeArm"] as const;

/** Where his arms point for each face: each bone aims its child along a direction, as synthClips.ts does. */
const POSES: Record<"rest" | "talk" | "smug" | "laugh" | "think" | "annoyed", Aims> = {
  rest: { LeftArm: [0.35, -1, 0.3], LeftForeArm: [0.1, -1, 0.45], RightArm: [-0.35, -1, 0.3], RightForeArm: [-0.1, -1, 0.45] },
  // the admiral's baton beat: right hand up, conducting
  talk: { LeftArm: [0.45, -0.85, 0.35], LeftForeArm: [0.1, -0.5, 1], RightArm: [-0.55, -0.35, 0.6], RightForeArm: [-0.2, 0.75, 0.75] },
  smug: { LeftArm: [0.7, -0.75, -0.05], LeftForeArm: [-0.6, -0.4, 0.4], RightArm: [-0.7, -0.75, -0.05], RightForeArm: [0.6, -0.4, 0.4] },
  // laughing: hands on his belly (the can), head thrown back
  laugh: { LeftArm: [0.55, -0.8, 0.3], LeftForeArm: [-0.5, -0.15, 0.85], RightArm: [-0.55, -0.8, 0.3], RightForeArm: [0.5, -0.15, 0.85] },
  think: { LeftArm: [0.4, -1, 0.3], LeftForeArm: [0.1, -1, 0.45], RightArm: [-0.3, -0.8, 0.5], RightForeArm: [0.55, 0.55, 0.8] },
  annoyed: { LeftArm: [0.5, -0.8, 0.45], LeftForeArm: [-0.75, 0.05, 0.75], RightArm: [-0.5, -0.8, 0.45], RightForeArm: [0.75, 0.05, 0.75] },
};
const POSE_OF: Record<Expression, keyof typeof POSES> = { listening: "rest", thinking: "think", smug: "talk", laughing: "laugh", annoyed: "annoyed" };
const HEAD_TURN: Record<Expression, [number, number, number]> = {
  listening: [0.02, 0, 0.04],
  thinking: [-0.1, 0.2, 0.12],
  smug: [-0.04, -0.12, 0.05],
  laughing: [-0.22, 0, 0.08],
  annoyed: [0.08, -0.05, 0],
};

const VERT = "varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0., 1.); }";
const FRAG = `
uniform sampler2D t; uniform vec2 res; uniform float time; uniform float still; uniform vec3 tint; varying vec2 v;
float h(float n){ return fract(sin(n * 91.345) * 43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 S(vec2 p){ return texture2D(t, p); }
void main(){
  vec2 p = v;
  float y = p.y * res.y;
  float tick = floor(time * 7.0) * (1.0 - still);
  float band = floor(p.y * 60.0);
  p.x += step(0.965, h(band + tick * 13.1)) * (h(band + 1.7 + tick) - 0.5) * 0.04 * (1.0 - still);
  vec4 c = S(p);
  c.r = S(p + vec2(0.002, 0.0)).r; c.b = S(p - vec2(0.002, 0.0)).b;
  float a = c.a, glow = 0.0, ring = 0.0;
  for (int i = 0; i < 12; i++) {
    float an = float(i) * 0.5236; vec2 o = vec2(cos(an), sin(an));
    glow += S(p + o * 0.012).a + S(p + o * 0.026).a * 0.6;
    ring += S(p + o * 0.004).a;
  }
  glow /= 19.2; ring = clamp(1.0 - ring / 12.0, 0.0, 1.0) * a;
  float l = dot(c.rgb, vec3(0.3, 0.55, 0.15));
  vec3 bright = mix(tint, vec3(1.0), 0.6), dark = tint * 0.42;
  vec3 col = mix(dark, bright, pow(clamp(l * 1.35, 0.0, 1.0), 0.65)) * 1.3;
  col = mix(col, c.rgb * mix(vec3(1.0), tint, 0.5), 0.12);
  float sl = 0.72 + 0.28 * sin((y + time * 40.0 * (1.0 - still)) * 1.15);
  col *= sl;
  col += bright * ring * 1.1;
  col += (h2(p * res + time) - 0.5) * 0.1;
  float flick = 1.0 - (1.0 - still) * 0.08 * step(0.9, h(floor(time * 12.0)));
  float alpha = a * 0.8 * (0.82 + 0.18 * sl) * flick;
  alpha *= mix(0.25, 1.0, smoothstep(0.06, 0.3, v.y));
  float ga = glow * (1.0 - a) * 0.7;
  vec3 outc = (col * alpha + mix(tint, vec3(1.0), 0.2) * ga) / max(alpha + ga, 1e-4);
  gl_FragColor = vec4(outc, clamp(alpha + ga, 0.0, 1.0));
}`;

/** Fits the face cap onto his head: cast from the head's centre through each vertex, then smooth, never dipping under a hit. */
function fitCap(geo: SphereGeometry, mesh: SkinnedMesh, wSeg: number, hSeg: number) {
  const src = mesh.geometry;
  const sp = src.getAttribute("position");
  const idx = src.getIndex();
  const v = new Vector3();
  const world = new Float32Array(sp.count * 3);
  for (let i = 0; i < sp.count; i++) {
    mesh.getVertexPosition(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    world[i * 3] = v.x;
    world[i * 3 + 1] = v.y;
    world[i * 3 + 2] = v.z;
  }
  // Only the head's front: a static copy, since casting against a skinned mesh re-skins every vertex per ray.
  const near = (i: number) => {
    const dx = world[i * 3]! - HEAD.c.x;
    const dy = world[i * 3 + 1]! - HEAD.c.y;
    const dz = world[i * 3 + 2]! - HEAD.c.z;
    return dx * dx + dy * dy + dz * dz < 0.04 && dz > -0.02;
  };
  const keep: number[] = [];
  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      if (near(a) && near(b) && near(c)) keep.push(a, b, c);
    }
  }
  const bg = new BufferGeometry();
  bg.setAttribute("position", new BufferAttribute(world, 3));
  bg.setIndex(keep);
  const baked = new Mesh(bg, new MeshBasicMaterial({ side: DoubleSide }));
  baked.updateMatrixWorld(true);

  const pos = geo.getAttribute("position");
  const NX = wSeg + 1;
  const NY = hSeg + 1;
  const rc = new Raycaster();
  rc.far = 0.4;
  const hit = new Float32Array(pos.count);
  const dirs: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const d = new Vector3().fromBufferAttribute(pos, i).normalize();
    dirs.push(d);
    rc.set(HEAD.c, d);
    hit[i] = rc.intersectObject(baked, false)[0]?.distance ?? HEAD.r;
  }
  let cur = Float32Array.from(hit);
  for (let k = 0; k < 30; k++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= NY || xx < 0 || xx >= NX) continue;
            sum += cur[yy * NX + xx]!;
            n++;
          }
        next[y * NX + x] = Math.max(sum / n, hit[y * NX + x]!);
      }
    cur = next;
  }
  for (let i = 0; i < pos.count; i++) {
    const L = cur[i]! + 0.005;
    const d = dirs[i]!;
    pos.setXYZ(i, d.x * L, d.y * L, d.z * L);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  bg.dispose();
}

export async function createHolo(canvas: HTMLCanvasElement): Promise<Holo> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(modelUrl(MODEL));

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: "low-power" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const rt = new WebGLRenderTarget(2, 2, { samples: 4, colorSpace: SRGBColorSpace });

  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x445066, 2.2));
  scene.add(new AmbientLight(0xffffff, 0.2));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(1.2, 2, 3);
  scene.add(key);
  const rim = new DirectionalLight(0xbfe6ff, 1.5);
  rim.position.set(-2, 1, -2);
  scene.add(rim);

  const root = new Group();
  scene.add(root);
  const model: Object3D = gltf.scene;
  root.add(model);
  model.updateMatrixWorld(true);
  const bones = new Map<string, Bone>();
  model.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ""), o as Bone);
  });
  const bone = (n: string) => bones.get(n);
  let mesh: SkinnedMesh | null = null;
  model.traverse((o) => {
    if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error("Skippy's model has no skinned mesh");
  const body: SkinnedMesh = mesh;
  body.frustumCulled = false;
  const ownMat = (body.material as MeshStandardMaterial).clone();
  body.material = ownMat;
  const ownMap: Texture | null = ownMat.map;

  // The face cap, fitted at the bind pose and riding the Head bone from then on.
  const W_SEG = 48;
  const H_SEG = 24;
  const capGeo = new SphereGeometry(HEAD.r, W_SEG, H_SEG, Math.PI / 2 - PHI / 2, PHI, TH0, TH1 - TH0);
  fitCap(capGeo, body, W_SEG, H_SEG);
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = FACE_W;
  faceCanvas.height = FACE_H;
  const faceCtx = faceCanvas.getContext("2d")!;
  const faceTex = new CanvasTexture(faceCanvas);
  faceTex.colorSpace = SRGBColorSpace;
  const capMat = new MeshStandardMaterial({ map: faceTex, transparent: true, roughness: 0.35, metalness: 0, depthWrite: false });
  const cap = new Mesh(capGeo, capMat);
  cap.renderOrder = 2;
  cap.position.copy(HEAD.c);
  cap.updateMatrixWorld(true);
  const head = bone("Head");
  if (head) head.attach(cap);
  else root.add(cap);

  // Each pose's bone rotations, worked out once from the bind pose.
  const bind = new Map<string, Quaternion>();
  for (const [name, b] of bones) bind.set(name, b.quaternion.clone());
  const aim = (name: (typeof ARMS)[number], dir: [number, number, number]) => {
    const b = bone(name);
    const c = bone(CHILD[name]);
    if (!b || !c || !b.parent) return;
    model.updateMatrixWorld(true);
    const from = c.getWorldPosition(new Vector3()).sub(b.getWorldPosition(new Vector3())).normalize();
    const q = new Quaternion().setFromUnitVectors(from, new Vector3(...dir).normalize());
    const wq = b.getWorldQuaternion(new Quaternion());
    const pq = b.parent.getWorldQuaternion(new Quaternion()).invert();
    b.quaternion.copy(pq.multiply(q.multiply(wq)));
  };
  const poses = new Map<string, Map<string, Quaternion>>();
  for (const [id, aims] of Object.entries(POSES)) {
    for (const n of ARMS) bone(n)?.quaternion.copy(bind.get(n) ?? new Quaternion());
    for (const n of ARMS) {
      const d = aims[n];
      if (d) aim(n, d);
    }
    poses.set(id, new Map(ARMS.map((n) => [n, bone(n)?.quaternion.clone() ?? new Quaternion()])));
  }
  for (const n of ARMS) {
    const p = poses.get("rest")?.get(n);
    if (p) bone(n)?.quaternion.copy(p);
  }

  const camera = new PerspectiveCamera(26, 1, 0.01, 50);
  const quadMat = new ShaderMaterial({
    transparent: true,
    uniforms: { t: { value: rt.texture }, res: { value: new Vector2(2, 2) }, time: { value: 0 }, still: { value: 0 }, tint: { value: new Color(SKIPPY_HOLO) } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), quadMat);
  const post = new Scene();
  post.add(quad);
  const postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let time = 0;
  let open = 0;
  let drawn = "";
  const headTurn = new Vector3();
  const euler = new Euler();
  const tmpQ = new Quaternion();
  const beat = new Quaternion();

  const resize = (w: number, h: number, dpr: number) => {
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    rt.setSize(Math.round(w * dpr), Math.round(h * dpr));
    (quadMat.uniforms.res!.value as Vector2).set(w * dpr, h * dpr);
    camera.aspect = w / h;
    // Keep his whole height in frame whatever the aspect: the can is about 0.8 tall with the hat.
    const look = new Vector3(0, 0.42, 0);
    const dist = 2.05;
    camera.fov = 26;
    camera.position.set(0, look.y + 0.06, dist);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  };

  return {
    frame: (dt, f) => {
      time += dt;
      const k = 1 - Math.exp(-dt * 7);
      // The mouth follows his voice, opening fast and closing a touch slower.
      const want = f.speaking ? Math.min(1, Math.max(0, (f.level - 0.03) * 2.6)) : 0;
      open += (want - open) * (want > open ? Math.min(1, dt * 22) : Math.min(1, dt * 12));
      const q = Math.round(open * 8);
      const key2 = `${f.expr}:${q}`;
      if (key2 !== drawn) {
        drawFace(faceCtx, f.expr, q / 8);
        faceTex.needsUpdate = true;
        drawn = key2;
      }
      // Arms ease toward the face's pose; while he talks, the baton hand beats with his voice.
      const pose = poses.get(POSE_OF[f.expr]);
      for (const n of ARMS) {
        const target = pose?.get(n);
        const b = bone(n);
        if (!target || !b) continue;
        tmpQ.copy(target);
        if (n === "RightForeArm" && f.speaking && !f.still) {
          beat.setFromEuler(euler.set(Math.sin(time * 5.5) * 0.25 * (0.3 + open), 0, 0));
          tmpQ.multiply(beat);
        }
        b.quaternion.slerp(tmpQ, k);
      }
      // The head: the face's own tilt, a nod with the words, a slow drift.
      const turn = HEAD_TURN[f.expr];
      const drift = f.still ? 0 : 1;
      headTurn.lerp(new Vector3(turn[0] + Math.sin(time * 9) * 0.05 * open * drift, turn[1] + Math.sin(time * 0.7) * 0.06 * drift, turn[2] + Math.sin(time * 0.5) * 0.03 * drift), k);
      const hb = bone("Head");
      const hq = bind.get("Head");
      if (hb && hq) hb.quaternion.copy(hq).multiply(tmpQ.setFromEuler(euler.set(headTurn.x, headTurn.y, headTurn.z)));
      // He floats: a slow bob, a little more when he laughs.
      root.position.y = f.still ? 0 : Math.sin(time * 1.3) * 0.012 + (f.expr === "laughing" ? Math.abs(Math.sin(time * 9)) * 0.012 : 0);

      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      quadMat.uniforms.time!.value = time;
      quadMat.uniforms.still!.value = f.still ? 1 : 0;
      renderer.clear();
      renderer.render(post, postCam);
    },
    setColour: (colour) => {
      (quadMat.uniforms.tint!.value as Color).set(colour ? new Color(colour).lerp(new Color(SKIPPY_HOLO), 0.08) : new Color(SKIPPY_HOLO));
      if (!ownMap) return;
      ownMat.map = colour ? recolor("skippy-holo", ownMap, [{ band: NAVY, color: colour }]) : ownMap;
      ownMat.needsUpdate = true;
    },
    resize,
    dispose: () => {
      renderer.dispose();
      rt.dispose();
      faceTex.dispose();
      capGeo.dispose();
      capMat.dispose();
      quadMat.dispose();
      ownMat.dispose();
      model.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      renderer.forceContextLoss();
    },
  };
}
