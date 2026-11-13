import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type SkinnedMesh, type SphereGeometry } from "three";
import type { Band } from "../../../world/src/agents/bodies/recolor.ts";
import type { Pose } from "./persona.ts";

/**
 * Skippy's rig, shared by the Talk hologram (holoScene.ts) and the Senate on Today (rotunda/rotundaScene.ts,
 * #666): the can's navy band, his head and face cap, and the arm poses. Kept apart so Today never loads the hologram.
 */
/** The admiral can's navy (Library.tsx, SKIPPY_NAVY): the band a submind repaints in its room's colour. */
export const NAVY: Band = { hue: 212, width: 24, minSat: 0.25, refL: 0.21 };

/** His head, in the model's own space: found by probing the model (the face cap is cast onto it from here). */
export const HEAD = { c: new Vector3(0, 0.468, 0.005), r: 0.134 };
/** The cap's span: around the head (radians) and from the top (polar range, radians). */
export const PHI = 1.9;
export const TH0 = 1.05;
export const TH1 = 2.3;

export type Aims = Partial<Record<"LeftArm" | "LeftForeArm" | "RightArm" | "RightForeArm", [number, number, number]>>;
export const CHILD = { LeftArm: "LeftForeArm", LeftForeArm: "LeftHand", RightArm: "RightForeArm", RightForeArm: "RightHand" } as const;
export const ARMS = ["LeftArm", "LeftForeArm", "RightArm", "RightForeArm"] as const;

/** Where his arms point for each face: each bone aims its child along a direction, as synthClips.ts does. */
export const POSES: Record<Pose, Aims> = {
  rest: { LeftArm: [0.35, -1, 0.3], LeftForeArm: [0.1, -1, 0.45], RightArm: [-0.35, -1, 0.3], RightForeArm: [-0.1, -1, 0.45] },
  // the admiral's baton beat: right hand up, conducting
  talk: { LeftArm: [0.45, -0.85, 0.35], LeftForeArm: [0.1, -0.5, 1], RightArm: [-0.55, -0.35, 0.6], RightForeArm: [-0.2, 0.75, 0.75] },
  smug: { LeftArm: [0.7, -0.75, -0.05], LeftForeArm: [-0.6, -0.4, 0.4], RightArm: [-0.7, -0.75, -0.05], RightForeArm: [0.6, -0.4, 0.4] },
  // laughing: hands on his belly (the can), head thrown back
  laugh: { LeftArm: [0.55, -0.8, 0.3], LeftForeArm: [-0.5, -0.15, 0.85], RightArm: [-0.55, -0.8, 0.3], RightForeArm: [0.5, -0.15, 0.85] },
  think: { LeftArm: [0.4, -1, 0.3], LeftForeArm: [0.1, -1, 0.45], RightArm: [-0.3, -0.8, 0.5], RightForeArm: [0.55, 0.55, 0.8] },
  annoyed: { LeftArm: [0.5, -0.8, 0.45], LeftForeArm: [-0.75, 0.05, 0.75], RightArm: [-0.5, -0.8, 0.45], RightForeArm: [0.75, 0.05, 0.75] },
  // The subminds' own (#490, persona.ts). The Pessimist's slump: arms hanging dead straight, a touch behind him.
  slump: { LeftArm: [0.12, -1, -0.12], LeftForeArm: [0.04, -1, -0.05], RightArm: [-0.12, -1, -0.12], RightForeArm: [-0.04, -1, -0.05] },
  // The Commentator calling the play: both arms up and out.
  cheer: { LeftArm: [0.9, 0.35, 0.3], LeftForeArm: [0.35, 1, 0.25], RightArm: [-0.9, 0.35, 0.3], RightForeArm: [-0.35, 1, 0.25] },
  // The Builder's hands at work in front of him.
  hands: { LeftArm: [0.35, -0.75, 0.55], LeftForeArm: [-0.35, -0.1, 1], RightArm: [-0.35, -0.75, 0.55], RightForeArm: [0.35, -0.1, 1] },
  // Leaning in, hands up and ready (the Messenger, the Commentator thinking).
  ready: { LeftArm: [0.5, -0.7, 0.5], LeftForeArm: [0.05, 0.4, 1], RightArm: [-0.5, -0.7, 0.5], RightForeArm: [-0.05, 0.4, 1] },
  // The Senate's gestures (#775, rotunda/senators.ts). The Director framing a shot: both hands up before its eyes.
  frame: { LeftArm: [0.55, -0.2, 0.8], LeftForeArm: [-0.45, 0.75, 0.5], RightArm: [-0.55, -0.2, 0.8], RightForeArm: [0.45, 0.75, 0.5] },
  // The Bookie counting it off: one hand across the can like a ledger, the other up, ticking.
  count: { LeftArm: [0.45, -0.8, 0.45], LeftForeArm: [-0.55, -0.05, 0.85], RightArm: [-0.45, -0.55, 0.6], RightForeArm: [0.05, 0.9, 0.45] },
  // The Executive presenting: one open hand out to the side, the other easy.
  present: { LeftArm: [0.38, -1, 0.25], LeftForeArm: [0.12, -1, 0.4], RightArm: [-0.85, -0.3, 0.5], RightForeArm: [-0.7, 0.15, 0.75] },
  // The Stagehand calling a cue: one hand at the headset, the other pointing out. "Go."
  cue: { LeftArm: [0.55, -0.15, 0.15], LeftForeArm: [-0.35, 0.9, -0.15], RightArm: [-0.75, 0.05, 0.65], RightForeArm: [-0.65, 0.12, 0.75] },
  // The Historian lecturing: a book held before it, one finger raised.
  lecture: { LeftArm: [0.4, -0.9, 0.4], LeftForeArm: [-0.25, -0.2, 1], RightArm: [-0.45, -0.65, 0.4], RightForeArm: [-0.05, 1, 0.2] },
  // The Artiste's flourish: one arm swept up and out, the other trailing.
  flourish: { LeftArm: [0.5, -0.85, 0.2], LeftForeArm: [0.25, -0.55, 0.8], RightArm: [-0.85, 0.5, 0.25], RightForeArm: [-0.45, 0.9, 0.15] },
  // The Steward's hands folded low before it, at service.
  clasp: { LeftArm: [0.3, -0.9, 0.45], LeftForeArm: [-0.75, -0.3, 0.6], RightArm: [-0.3, -0.9, 0.45], RightForeArm: [0.75, -0.3, 0.6] },
  // The Commentator pointing at the play, the other hand up at its mic.
  point: { LeftArm: [0.5, -0.6, 0.5], LeftForeArm: [-0.2, 0.6, 0.8], RightArm: [-0.6, 0.25, 0.8], RightForeArm: [-0.3, 0.35, 1] },
  // The Life of the Party waving one arm high, the other on its hip.
  wave: { LeftArm: [0.95, 0.5, 0.1], LeftForeArm: [0.2, 1, 0.05], RightArm: [-0.6, -0.8, 0.1], RightForeArm: [0.55, -0.2, 0.5] },
  // A shrug: arms out low, palms up. Who could say.
  shrug: { LeftArm: [0.75, -0.65, 0.2], LeftForeArm: [0.6, 0.3, 0.75], RightArm: [-0.75, -0.65, 0.2], RightForeArm: [-0.6, 0.3, 0.75] },
};

/**
 * The fitted cap, kept (#1173): fitting it skins the whole body and casts a ray per vertex of the cap, a few hundred
 * milliseconds of main thread in one go (the Senate's build, the call's hologram). The fit changes only with the model,
 * so it is kept per page and, given a `key` that names the model (its content-hashed URL), in this browser's storage
 * too. Bump CAP_V when the fit changes.
 */
const CAP_V = 1;
const capMemo = new Map<string, Float32Array>();
const capKey = (key: string, wSeg: number, hSeg: number) => `ceo:cap:${CAP_V}:${wSeg}x${hSeg}:${key}`;

function readCap(id: string, n: number): Float32Array | null {
  try {
    const raw = localStorage.getItem(id);
    const a = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(a) && a.length === n && a.every((x) => typeof x === "number" && Number.isFinite(x)) ? Float32Array.from(a as number[]) : null;
  } catch {
    return null;
  }
}

function saveCap(id: string, d: Float32Array, wSeg: number, hSeg: number): void {
  try {
    // One kept fit per cap size: an older model's goes.
    const size = `:${wSeg}x${hSeg}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("ceo:cap:") && k.includes(size) && k !== id) localStorage.removeItem(k);
    }
    localStorage.setItem(id, JSON.stringify(Array.from(d, (x) => Math.round(x * 1e5) / 1e5)));
  } catch {
    /* full or blocked: fitted again next time */
  }
}

/**
 * Fits the face cap onto his head: cast from the head's centre through each vertex, then smooth, never dipping under a
 * hit. With `key` (the model's URL, and who asks), the fit is kept and reused (above).
 */
export function fitCap(geo: SphereGeometry, mesh: SkinnedMesh, wSeg: number, hSeg: number, key?: string) {
  const pos = geo.getAttribute("position");
  const id = key ? capKey(key, wSeg, hSeg) : null;
  let cur = id ? (capMemo.get(id) ?? readCap(id, pos.count)) : null;
  if (!cur) {
    cur = capDistances(geo, mesh, wSeg, hSeg);
    if (id) saveCap(id, cur, wSeg, hSeg);
  }
  if (id) capMemo.set(id, cur);
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const L = cur[i]! + 0.005;
    d.fromBufferAttribute(pos, i).normalize();
    pos.setXYZ(i, d.x * L, d.y * L, d.z * L);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** How far out the cap sits along each of its vertices' directions from the head's centre: the casting and smoothing. */
function capDistances(geo: SphereGeometry, mesh: SkinnedMesh, wSeg: number, hSeg: number): Float32Array {
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
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
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
  bg.dispose();
  (baked.material as MeshBasicMaterial).dispose();
  return cur;
}
