import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointsMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type Group,
  type InstancedMesh,
  type LineSegments,
  type Points,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { Beam, Dust } from "../fx/atmos.tsx";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { Block, FONTS, LightBar, Plinth, ahead } from "./primitives.tsx";

/**
 * The Workshop: where new things for the Lattice are made. The line runs left to right along the back, one
 * station per step: Daub paints the idea at the easel, the figure gathers in the mould out of a cloud of points,
 * its frame of bones is fitted on the turntable, and it walks the little rehearsal stage before it goes in the crate
 * by the exit. A craftsman's room: walnut, oak, linen, brass and terracotta, under warm hanging lamps.
 */

type V3 = [number, number, number];

/** The room's own colours: warm and handmade, nothing industrial. */
const CLAY = "#c98f6b";
const TERRACOTTA = "#e07a5f";
const SAGE = "#8fae7e";
const LINEN = "#efe6d4";
const LAMP = "#ffd39a";
const dummy = new Object3D();

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A small maquette of a figure, about a metre tall at scale 1: head, body, arms, legs. One merged, low-poly mesh. */
function figureGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, x: number, y: number, rz = 0) => {
    g.rotateZ(rz);
    g.translate(x, y, 0);
    parts.push(g);
  };
  add(new SphereGeometry(0.11, 12, 9), 0, 0.87);
  add(new CapsuleGeometry(0.12, 0.24, 4, 10), 0, 0.57);
  add(new CapsuleGeometry(0.042, 0.26, 3, 8), -0.17, 0.56, 0.2);
  add(new CapsuleGeometry(0.042, 0.26, 3, 8), 0.17, 0.56, -0.2);
  add(new CapsuleGeometry(0.052, 0.28, 3, 8), -0.065, 0.2);
  add(new CapsuleGeometry(0.052, 0.28, 3, 8), 0.065, 0.2);
  const g = mergeGeometries(parts) ?? new SphereGeometry(0.3);
  for (const p of parts) p.dispose();
  return g;
}

let sharedFigure: BufferGeometry | null = null;
const figure = () => (sharedFigure ??= figureGeometry());

/** A brass lamp on a long cord, with a warm bulb. */
function HangingLamp({ position, drop = 1.4 }: { position: V3; drop?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, drop / 2, 0]} material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.01, 0.01, drop, 5]} />
      </mesh>
      <mesh material={PBR.brass()} castShadow>
        <coneGeometry args={[0.32, 0.3, 20, 1, true]} />
      </mesh>
      <mesh position={[0, -0.1, 0]} material={PBR.light(LAMP, 5)}>
        <sphereGeometry args={[0.08, 12, 10]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The concept easel: a sketch draws itself, stroke by stroke, then the washes go on, then Daub's paw signature.
// ---------------------------------------------------------------------------------------------------------------

interface Stroke {
  color: string;
  width: number;
  pts: [number, number][];
}

const CANVAS_W = 256;
const CANVAS_H = 320;
const SKETCH_PALETTES = [
  { body: TERRACOTTA, trim: SAGE, skin: "#f1d9b5" },
  { body: "#6a8fb5", trim: "#e8c27a", skin: "#e8d2c0" },
  { body: "#8a5a9e", trim: "#f2b5a0", skin: "#efe0c8" },
];

function ring(cx: number, cy: number, r: number, n = 18): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as [number, number]);
}

/** Back-and-forth wash strokes filling a box. */
function wash(x0: number, y0: number, x1: number, y1: number, rows: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    pts.push(i % 2 ? [x1, y] : [x0, y], i % 2 ? [x0, y] : [x1, y]);
  }
  return pts;
}

function sketchStrokes(p: (typeof SKETCH_PALETTES)[number]): Stroke[] {
  const ink = "#4a3326";
  const cx = CANVAS_W / 2;
  return [
    // Pencil: head, body, arms, legs.
    { color: ink, width: 3, pts: ring(cx, 70, 28) },
    { color: ink, width: 3, pts: [[cx - 34, 108], [cx - 40, 190], [cx + 40, 190], [cx + 34, 108], [cx - 34, 108]] },
    { color: ink, width: 3, pts: [[cx - 36, 114], [cx - 62, 160], [cx - 70, 200]] },
    { color: ink, width: 3, pts: [[cx + 36, 114], [cx + 62, 160], [cx + 70, 200]] },
    { color: ink, width: 3, pts: [[cx - 20, 190], [cx - 26, 250], [cx - 30, 290]] },
    { color: ink, width: 3, pts: [[cx + 20, 190], [cx + 26, 250], [cx + 30, 290]] },
    // Washes: skin, body, a scarf in the trim colour.
    { color: p.skin, width: 14, pts: wash(cx - 22, 52, cx + 22, 90, 5) },
    { color: p.body, width: 16, pts: wash(cx - 32, 116, cx + 32, 184, 7) },
    { color: p.body, width: 9, pts: [[cx - 26, 196], [cx - 28, 280], [cx + 28, 280], [cx + 26, 196]] },
    { color: p.trim, width: 10, pts: [[cx - 36, 108], [cx, 118], [cx + 36, 108], [cx + 30, 140]] },
    // Eyes, then the paw signature, bottom right.
    { color: ink, width: 4, pts: [[cx - 10, 68], [cx - 8, 70]] },
    { color: ink, width: 4, pts: [[cx + 8, 68], [cx + 10, 70]] },
    { color: "#5fbf4a", width: 7, pts: ring(214, 296, 4, 8) },
    ...[-9, -3, 3, 9].map((dx): Stroke => ({ color: "#5fbf4a", width: 4, pts: ring(214 + dx, 284 - Math.abs(dx) * 0.4, 1.5, 6) })),
  ];
}

function ConceptEasel({ position, yaw }: { position: V3; yaw: number }) {
  const { canvas, ctx, tex } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return { canvas, ctx, tex };
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const canvasMat = useMemo(() => new MeshStandardMaterial({ map: tex, roughness: 0.92 }), [tex]);
  const brush = useRef<Group>(null);
  const state = useRef({ cycle: -1, drawn: 0, strokes: [] as Stroke[], segs: [] as { s: number; i: number }[] });

  useFrame(({ clock }) => {
    if (!ctx) return;
    const PERIOD = 18;
    const t = clock.elapsedTime / PERIOD;
    const cycle = Math.floor(t);
    const u = t - cycle;
    const st = state.current;
    if (cycle !== st.cycle) {
      // A fresh canvas: linen ground, a faint pencil border.
      st.cycle = cycle;
      st.strokes = sketchStrokes(SKETCH_PALETTES[cycle % SKETCH_PALETTES.length]!);
      st.segs = st.strokes.flatMap((s, si) => s.pts.slice(1).map((_, i) => ({ s: si, i })));
      st.drawn = 0;
      ctx.fillStyle = LINEN;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#d8ccb4";
      ctx.lineWidth = 2;
      ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
      tex.needsUpdate = true;
    }
    // Draw for three quarters of the cycle, then hold the finished piece.
    const want = Math.floor(smooth(0.04, 0.75, u) * st.segs.length);
    if (want > st.drawn) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let k = st.drawn; k < want; k++) {
        const seg = st.segs[k]!;
        const stroke = st.strokes[seg.s]!;
        const a = stroke.pts[seg.i]!;
        const b = stroke.pts[seg.i + 1]!;
        ctx.globalAlpha = stroke.width > 6 ? 0.78 : 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      st.drawn = want;
      tex.needsUpdate = true;
    }
    // The brush tip follows the stroke being painted; it rests on the ledge once the piece is done.
    if (brush.current) {
      const seg = st.segs[Math.min(st.drawn, st.segs.length - 1)];
      const p: [number, number] = seg ? st.strokes[seg.s]!.pts[seg.i + 1]! : [CANVAS_W / 2, CANVAS_H];
      const done = st.drawn >= st.segs.length;
      const x = done ? 0.42 : (p[0] / CANVAS_W - 0.5) * 1.1;
      const y = done ? 0.86 : 1.62 + (0.5 - p[1] / CANVAS_H) * 1.36;
      brush.current.position.x += (x - brush.current.position.x) * 0.3;
      brush.current.position.y += (y - brush.current.position.y) * 0.3;
    }
  });

  const oak = PBR.wood("oak");
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* A-frame: two front legs and a back prop. */}
      {[-1, 1].map((s) => (
        <Block key={s} size={[0.06, 2.6, 0.06]} position={[s * 0.5, 1.28, 0.02]} rotation={[0.08, 0, s * -0.12]} material={oak} radius={0.015} />
      ))}
      <Block size={[0.06, 2.5, 0.06]} position={[0, 1.2, -0.5]} rotation={[-0.38, 0, 0]} material={oak} radius={0.015} />
      <Block size={[1.3, 0.06, 0.14]} position={[0, 0.88, 0.1]} material={oak} radius={0.015} />
      <Block size={[0.3, 0.05, 0.08]} position={[0, 2.36, 0.08]} material={oak} radius={0.012} />
      {/* The canvas, stretched on a frame. */}
      <Block size={[1.22, 1.5, 0.04]} position={[0, 1.62, 0.07]} rotation={[-0.08, 0, 0]} material={PBR.wood("walnut")} radius={0.01} />
      <mesh position={[0, 1.62, 0.1]} rotation={[-0.08, 0, 0]} material={canvasMat}>
        <planeGeometry args={[1.12, 1.4]} />
      </mesh>
      <group ref={brush} position={[0.42, 0.86, 0.2]}>
        <mesh rotation={[0.9, 0, 0.3]} material={PBR.wood("walnut")}>
          <cylinderGeometry args={[0.012, 0.016, 0.34, 6]} />
        </mesh>
        <mesh position={[0, 0.12, 0.1]} material={PBR.matte("#5fbf4a", 0.6)}>
          <sphereGeometry args={[0.024, 8, 6]} />
        </mesh>
      </group>
      {/* Paint pots and a palette on a stool beside it. */}
      <group position={[0.95, 0, 0.4]}>
        <Model id="fantasy-props/Stool" fit={{ height: 0.55 }} />
        <mesh position={[0, 0.58, 0]} rotation={[-Math.PI / 2, 0, 0.4]} material={PBR.wood("oak")}>
          <circleGeometry args={[0.2, 18]} />
        </mesh>
        {[TERRACOTTA, SAGE, "#6a8fb5", "#f2d06b"].map((c, i) => (
          <mesh key={c} position={[Math.cos(i * 1.3) * 0.12, 0.6, Math.sin(i * 1.3) * 0.12]} material={PBR.matte(c, 0.5)}>
            <sphereGeometry args={[0.03, 8, 6]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The mould: points gather into a figure, it holds as a wireframe, turns solid and lifts out of the pod.
// ---------------------------------------------------------------------------------------------------------------

const MOULD_POINTS = 520;
const MOULD_SCALE = 1.15;

function Mould({ position, yaw }: { position: V3; yaw: number }) {
  const geo = figure();
  const { cloud, target, pointsGeo, delay } = useMemo(() => {
    const sampler = new MeshSurfaceSampler(new Mesh(geo)).build();
    const v = new Vector3();
    const target = new Float32Array(MOULD_POINTS * 3);
    const cloud = new Float32Array(MOULD_POINTS * 3);
    const delay = new Float32Array(MOULD_POINTS);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < MOULD_POINTS; i++) {
      sampler.sample(v);
      target.set([v.x * MOULD_SCALE, v.y * MOULD_SCALE, v.z * MOULD_SCALE], i * 3);
      const a = rnd() * Math.PI * 2;
      const r = 0.15 + rnd() * 0.32;
      cloud.set([Math.cos(a) * r, 0.1 + rnd() * 1.35, Math.sin(a) * r], i * 3);
      delay[i] = rnd() * 0.12;
    }
    const pointsGeo = new BufferGeometry();
    pointsGeo.setAttribute("position", new BufferAttribute(cloud.slice(), 3));
    return { cloud, target, pointsGeo, delay };
  }, [geo]);
  const mats = useMemo(
    () => ({
      points: new PointsMaterial({ color: "#ffdcae", size: 0.028, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      wire: new MeshBasicMaterial({ color: "#ffc98a", wireframe: true, transparent: true, opacity: 0, toneMapped: false }),
      solid: new MeshStandardMaterial({ color: CLAY, roughness: 0.62, transparent: true, opacity: 0 }),
      ring: new MeshStandardMaterial({ color: "#000", emissive: LAMP, emissiveIntensity: 2, toneMapped: false }),
    }),
    [],
  );
  const points = useRef<Points>(null);
  const wire = useRef<Mesh>(null);
  const solid = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const PERIOD = 14;
    const u = (clock.elapsedTime / PERIOD) % 1;
    const pos = pointsGeo.getAttribute("position") as BufferAttribute;
    const arr = pos.array as Float32Array;
    // Gather: each point drifts in from the cloud, with a little swirl, a beat apart.
    for (let i = 0; i < MOULD_POINTS; i++) {
      const k = smooth(0.02 + delay[i]!, 0.3 + delay[i]!, u);
      const swirl = (1 - k) * 1.6;
      const cx = cloud[i * 3]!;
      const cz = cloud[i * 3 + 2]!;
      const c = Math.cos(swirl + u * 4);
      const s = Math.sin(swirl + u * 4);
      const sx = cx * c - cz * s;
      const sz = cx * s + cz * c;
      arr[i * 3] = sx + (target[i * 3]! - sx) * k;
      arr[i * 3 + 1] = cloud[i * 3 + 1]! + (target[i * 3 + 1]! - cloud[i * 3 + 1]!) * k;
      arr[i * 3 + 2] = sz + (target[i * 3 + 2]! - sz) * k;
    }
    pos.needsUpdate = true;
    mats.points.opacity = smooth(0, 0.06, u) * (1 - smooth(0.42, 0.55, u));
    mats.wire.opacity = smooth(0.3, 0.42, u) * (1 - smooth(0.55, 0.68, u)) * 0.85;
    mats.solid.opacity = smooth(0.5, 0.64, u) * (1 - smooth(0.9, 0.97, u));
    const lift = smooth(0.74, 0.95, u) * 1.1;
    if (solid.current) {
      solid.current.position.y = 0.26 + lift;
      solid.current.rotation.y = lift * 2;
    }
    if (wire.current) wire.current.rotation.y = Math.sin(clock.elapsedTime * 0.5) * 0.05;
    if (points.current) points.current.visible = mats.points.opacity > 0.01;
    // The rings glow brightest while the figure forms.
    mats.ring.emissiveIntensity = 1.4 + smooth(0.02, 0.3, u) * (1 - smooth(0.6, 0.75, u)) * 2.6 + Math.sin(clock.elapsedTime * 3) * 0.2;
  });

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Walnut base with a brass collar, a glass pod, a brass crown open to the air. */}
      <mesh position={[0, 0.1, 0]} material={PBR.wood("walnut")} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.8, 0.2, 28]} />
      </mesh>
      <mesh position={[0, 0.23, 0]} material={PBR.brass()}>
        <cylinderGeometry args={[0.62, 0.66, 0.06, 28]} />
      </mesh>
      <mesh position={[0, 0.27, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.ring}>
        <torusGeometry args={[0.56, 0.018, 8, 40]} />
      </mesh>
      <mesh position={[0, 1.06, 0]} material={PBR.glass("#ffe8c8", 0.14)}>
        <cylinderGeometry args={[0.6, 0.6, 1.6, 32, 1, true]} />
      </mesh>
      <mesh position={[0, 1.86, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()}>
        <torusGeometry args={[0.6, 0.035, 8, 40]} />
      </mesh>
      <mesh position={[0, 1.83, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.ring}>
        <torusGeometry args={[0.55, 0.012, 6, 40]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} size={[0.05, 1.62, 0.05]} position={[Math.cos(i * (Math.PI / 2) + 0.78) * 0.62, 1.06, Math.sin(i * (Math.PI / 2) + 0.78) * 0.62]} material={PBR.brass()} radius={0.012} shadows={false} />
      ))}
      <group position={[0, 0.26, 0]}>
        <points ref={points} geometry={pointsGeo} material={mats.points} frustumCulled={false} />
        <mesh ref={wire} geometry={geo} material={mats.wire} scale={MOULD_SCALE} />
      </group>
      <mesh ref={solid} geometry={geo} material={mats.solid} scale={MOULD_SCALE} position={[0, 0.26, 0]} castShadow />
      <pointLight position={[0, 1.0, 0.4]} color={LAMP} intensity={3} distance={3.2} decay={2} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 3. The fitting stand: the figure turns on a turntable while a ring scans it and its bones are fitted, one by one.
// ---------------------------------------------------------------------------------------------------------------

/** The frame of bones, in figure space: pairs of joints. */
const BONES: [V3, V3][] = [
  [[0, 0.36, 0], [0, 0.66, 0]],
  [[0, 0.66, 0], [0, 0.78, 0]],
  [[0, 0.78, 0], [0, 0.94, 0]],
  [[0, 0.68, 0], [-0.14, 0.7, 0]],
  [[-0.14, 0.7, 0], [-0.19, 0.56, 0]],
  [[-0.19, 0.56, 0], [-0.23, 0.42, 0]],
  [[0, 0.68, 0], [0.14, 0.7, 0]],
  [[0.14, 0.7, 0], [0.19, 0.56, 0]],
  [[0.19, 0.56, 0], [0.23, 0.42, 0]],
  [[0, 0.36, 0], [-0.065, 0.34, 0]],
  [[-0.065, 0.34, 0], [-0.065, 0.2, 0]],
  [[-0.065, 0.2, 0], [-0.065, 0.05, 0]],
  [[0, 0.36, 0], [0.065, 0.34, 0]],
  [[0.065, 0.34, 0], [0.065, 0.2, 0]],
  [[0.065, 0.2, 0], [0.065, 0.05, 0]],
];

function FittingStand({ position, yaw }: { position: V3; yaw: number }) {
  const geo = figure();
  const SCALE = 1.25;
  const { bonesGeo, jointsGeo } = useMemo(() => {
    const bonesGeo = new BufferGeometry();
    bonesGeo.setAttribute("position", new Float32BufferAttribute(BONES.flatMap(([a, b]) => [...a, ...b].map((n) => n * SCALE)), 3));
    const jointsGeo = new BufferGeometry();
    jointsGeo.setAttribute("position", new Float32BufferAttribute(BONES.flatMap(([, b]) => b.map((n) => n * SCALE)), 3));
    return { bonesGeo, jointsGeo };
  }, []);
  const mats = useMemo(
    () => ({
      figure: new MeshStandardMaterial({ color: "#d9a77f", roughness: 0.55, transparent: true, opacity: 0.55, depthWrite: false }),
      bone: new MeshBasicMaterial({ color: "#ffe7a3", transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }),
      joint: new PointsMaterial({ color: "#fff2c8", size: 0.06, transparent: true, depthTest: false, toneMapped: false }),
      scan: new MeshStandardMaterial({ color: "#000", emissive: "#ffcf8a", emissiveIntensity: 2.4, transparent: true, opacity: 0.8, toneMapped: false }),
    }),
    [],
  );
  const table = useRef<Group>(null);
  const bones = useRef<LineSegments>(null);
  const joints = useRef<Points>(null);
  const scan = useRef<Mesh>(null);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (table.current) table.current.rotation.y += dt * 0.5;
    const u = (t / 10) % 1;
    const n = Math.floor(smooth(0.05, 0.7, u) * BONES.length + 0.001);
    bonesGeo.setDrawRange(0, n * 2);
    jointsGeo.setDrawRange(0, n);
    mats.bone.opacity = 0.65 + Math.sin(t * 6) * 0.25;
    if (scan.current) {
      scan.current.position.y = 0.3 + (0.5 + Math.sin(t * 1.4) * 0.5) * 1.15 * SCALE * 0.9;
    }
    mats.scan.opacity = u < 0.75 ? 0.75 : 0.25;
  });

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* A low walnut plinth, the brass turntable on it. */}
      <Block size={[1.3, 0.22, 1.3]} position={[0, 0.11, 0]} material={PBR.wood("walnut")} radius={0.05} />
      <group ref={table} position={[0, 0.22, 0]}>
        <mesh position={[0, 0.03, 0]} material={PBR.brass()} castShadow receiveShadow>
          <cylinderGeometry args={[0.55, 0.57, 0.06, 32]} />
        </mesh>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[Math.cos((i / 12) * Math.PI * 2) * 0.5, 0.065, Math.sin((i / 12) * Math.PI * 2) * 0.5]} material={PBR.blackMetal()}>
            <boxGeometry args={[0.04, 0.008, 0.012]} />
          </mesh>
        ))}
        <group position={[0, 0.06, 0]}>
          <mesh geometry={geo} material={mats.figure} scale={SCALE} castShadow />
          <lineSegments ref={bones} geometry={bonesGeo} material={mats.bone} renderOrder={6} />
          <points ref={joints} geometry={jointsGeo} material={mats.joint} renderOrder={7} />
        </group>
      </group>
      {/* The fitting ring rides up and down the figure, and an arm lamp leans in. */}
      <mesh ref={scan} rotation={[Math.PI / 2, 0, 0]} material={mats.scan}>
        <torusGeometry args={[0.36, 0.01, 6, 36]} />
      </mesh>
      {[-1, 1].map((s) => (
        <Block key={s} size={[0.05, 1.8, 0.05]} position={[s * 0.62, 0.9 + 0.22, -0.5]} material={PBR.brass()} radius={0.012} />
      ))}
      <Block size={[1.3, 0.05, 0.05]} position={[0, 2.02, -0.5]} material={PBR.brass()} radius={0.012} />
      <group position={[0.8, 0, 0.45]}>
        <mesh position={[0, 0.6, 0]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
        </mesh>
        <group position={[0, 1.2, 0]} rotation={[0, 0, 0.9]}>
          <mesh position={[0, 0.25, 0]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.015, 0.015, 0.5, 6]} />
          </mesh>
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, 0.6]} material={PBR.brass()}>
            <coneGeometry args={[0.1, 0.14, 14, 1, true]} />
          </mesh>
          <mesh position={[-0.02, 0.47, 0]} material={PBR.light(LAMP, 4)}>
            <sphereGeometry args={[0.035, 8, 6]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 4. The rehearsal stage: the finished figure walks a little circle under the lights, stops, turns, bows.
// ---------------------------------------------------------------------------------------------------------------

function Walker() {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const skin = PBR.matte("#e6c6a4", 0.6);
  const coat = PBR.matte(TERRACOTTA, 0.7);
  const trim = PBR.matte(SAGE, 0.7);
  const angle = useRef(0);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const u = (t / 12) % 1;
    // Walk for most of the loop; stop at the front to turn to the audience and bow.
    const walking = u < 0.72;
    if (walking) angle.current += dt * 0.9;
    const a = angle.current;
    const r = 0.62;
    if (root.current) {
      root.current.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      // Walking: face along the circle (anticlockwise from above). Stopped: face the audience.
      const face = walking ? -a : 0;
      const turn = Math.atan2(Math.sin(face - root.current.rotation.y), Math.cos(face - root.current.rotation.y));
      root.current.rotation.y += turn * 0.12;
    }
    const swing = walking ? Math.sin(t * 7) * 0.5 : 0;
    const bow = !walking ? Math.sin(smooth(0.78, 0.9, u) * Math.PI) * 0.5 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.8;
    if (armR.current) armR.current.rotation.x = swing * 0.8;
    if (body.current) {
      body.current.rotation.x = bow;
      body.current.position.y = 0.4 + (walking ? Math.abs(Math.sin(t * 7)) * 0.025 : 0);
    }
  });
  return (
    <group ref={root}>
      <group ref={body} position={[0, 0.4, 0]}>
        <mesh position={[0, 0.22, 0]} material={coat} castShadow>
          <capsuleGeometry args={[0.12, 0.22, 4, 10]} />
        </mesh>
        <mesh position={[0, 0.36, 0.02]} rotation={[0.3, 0, 0]} material={trim}>
          <torusGeometry args={[0.1, 0.03, 6, 14]} />
        </mesh>
        <mesh position={[0, 0.5, 0]} material={skin} castShadow>
          <sphereGeometry args={[0.11, 14, 10]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s} ref={s < 0 ? armL : armR} position={[s * 0.16, 0.32, 0]}>
            <mesh position={[0, -0.14, 0]} material={coat} castShadow>
              <capsuleGeometry args={[0.04, 0.22, 3, 8]} />
            </mesh>
          </group>
        ))}
      </group>
      {[-1, 1].map((s) => (
        <group key={s} ref={s < 0 ? legL : legR} position={[s * 0.065, 0.42, 0]}>
          <mesh position={[0, -0.21, 0]} material={trim} castShadow>
            <capsuleGeometry args={[0.05, 0.3, 3, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RehearsalStage({ position, yaw }: { position: V3; yaw: number }) {
  const curtain = PBR.fabric("#7a2430");
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.15, 0]} material={PBR.wood("walnut")} castShadow receiveShadow>
        <cylinderGeometry args={[1.25, 1.3, 0.3, 36]} />
      </mesh>
      <mesh position={[0, 0.305, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.wood("oak", [2, 2])} receiveShadow>
        <circleGeometry args={[1.22, 36]} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()}>
        <torusGeometry args={[1.26, 0.025, 6, 48]} />
      </mesh>
      {/* Footlights along the front arc. */}
      {Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI * 0.25 + (i / 6) * Math.PI * 0.5;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.18, 0.33, Math.sin(a) * 1.18]} material={PBR.light(LAMP, 4)}>
            <sphereGeometry args={[0.035, 8, 6]} />
          </mesh>
        );
      })}
      <group position={[0, 0.3, 0]}>
        <Walker />
      </group>
      {/* Curtain folds behind, on a brass rail. */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-1.2 + i * 0.3, 1.45, -1.25 - (i % 2) * 0.06]} material={curtain} castShadow>
          <cylinderGeometry args={[0.13, 0.15, 2.9, 10, 1, true]} />
        </mesh>
      ))}
      <mesh position={[0, 2.95, -1.28]} rotation={[0, 0, Math.PI / 2]} material={PBR.brass()}>
        <cylinderGeometry args={[0.03, 0.03, 2.9, 8]} />
      </mesh>
      {/* Two spotlights from the rafters. */}
      {[-0.9, 0.9].map((x) => (
        <group key={x} position={[x, 3.4, 0.9]} rotation={[0.45, 0, x > 0 ? 0.28 : -0.28]}>
          <mesh material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.1, 0.13, 0.22, 12]} />
          </mesh>
          <Beam length={3.4} radius={0.75} color="#ffe2b8" opacity={0.1} />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Props: the shelves of past figures, the workbench, the crate of finished pieces by the exit.
// ---------------------------------------------------------------------------------------------------------------

const MAQUETTE_COLOURS = ["#c98f6b", "#e07a5f", "#8fae7e", "#6a8fb5", "#8a5a9e", "#f2d06b", "#d9c4a8", "#a3542e"];

/** Rows of small figures, one instanced mesh: every piece the Workshop has made, in order of making. */
function Maquettes({ at, scale }: { at: { position: V3; yaw: number }[]; scale: number }) {
  const ref = useRef<InstancedMesh>(null);
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }), []);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new Color();
    at.forEach((p, i) => {
      dummy.position.set(...p.position);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(scale * (0.85 + ((i * 37) % 10) / 33));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, c.set(MAQUETTE_COLOURS[(i * 5) % MAQUETTE_COLOURS.length]!));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [at, scale]);
  return <instancedMesh ref={ref} args={[figure(), mat, at.length]} castShadow receiveShadow />;
}

const SHELF_LEVELS = [0.35, 0.85, 1.35, 1.85];
const SHELF_FIGURES = SHELF_LEVELS.flatMap((y, row) =>
  Array.from({ length: 6 }, (_, i) => ({ position: [-1.0 + i * 0.4 + (row % 2) * 0.1, y + 0.03, 0.02] as V3, yaw: ((i + row) % 3) * 0.4 - 0.4 })),
);

function Shelves({ position, yaw }: { position: V3; yaw: number }) {
  const oak = PBR.wood("oak");
  const LEVELS = SHELF_LEVELS;
  const figures = SHELF_FIGURES;
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[-1.25, 1.25].map((x) => (
        <Block key={x} size={[0.07, 2.3, 0.42]} position={[x, 1.15, 0]} material={oak} radius={0.015} />
      ))}
      {LEVELS.map((y) => (
        <Block key={y} size={[2.56, 0.05, 0.42]} position={[0, y, 0]} material={oak} radius={0.012} shadows={false} />
      ))}
      <Block size={[2.56, 2.3, 0.03]} position={[0, 1.15, -0.2]} material={PBR.matte("#4a3426", 0.9)} radius={0.01} shadows={false} />
      <Maquettes at={figures} scale={0.3} />
    </group>
  );
}

function Workbench({ position, yaw }: { position: V3; yaw: number }) {
  const walnut = PBR.wood("walnut");
  const maquettes = useMemo(
    () => [
      { position: [-0.7, 0.86, 0.05] as V3, yaw: 0.4 },
      { position: [0.55, 0.86, -0.1] as V3, yaw: -0.3 },
      { position: [0.8, 0.86, 0.15] as V3, yaw: 0.9 },
    ],
    [],
  );
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <Block size={[2.6, 0.09, 0.95]} position={[0, 0.82, 0]} material={walnut} radius={0.02} />
      {[-1.15, 1.15].map((x) =>
        [-0.36, 0.36].map((z) => <Block key={`${x}${z}`} size={[0.09, 0.78, 0.09]} position={[x, 0.39, z]} material={walnut} radius={0.015} />),
      )}
      <Block size={[2.4, 0.04, 0.8]} position={[0, 0.22, 0]} material={PBR.wood("oak")} radius={0.01} shadows={false} />
      {/* Clay, tools, tea, a book of sketches, a candle. */}
      <mesh position={[-0.2, 0.92, 0.1]} material={PBR.matte(CLAY, 0.8)} castShadow>
        <sphereGeometry args={[0.12, 10, 8]} />
      </mesh>
      <mesh position={[-0.05, 0.9, -0.12]} material={PBR.matte(CLAY, 0.8)}>
        <sphereGeometry args={[0.07, 8, 6]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <Block key={i} size={[0.26, 0.02, 0.03]} position={[0.15 + i * 0.05, 0.875, 0.28 - i * 0.07]} rotation={[0, 0.3 + i * 0.2, 0]} material={i === 1 ? PBR.brass() : PBR.wood("oak")} radius={0.008} shadows={false} />
      ))}
      <Model id="scifi-essentials/Prop_Mug" fit={{ height: 0.12 }} position={[1.05, 0.865, -0.25]} />
      <Model id="fantasy-props/Book_Stack_1" fit={{ height: 0.16 }} position={[-1.0, 0.865, -0.22]} rotation={0.3} />
      <Model id="fantasy-props/Candle_1" fit={{ height: 0.2 }} position={[-1.12, 0.865, 0.25]} />
      <Maquettes at={maquettes} scale={0.26} />
    </group>
  );
}

/** The crate of finished pieces, by the way out: three new figures peeking over the edge, ready to walk out. */
function FinishedCrate({ position, yaw }: { position: V3; yaw: number }) {
  const peeking = useMemo(
    () => [
      { position: [-0.18, 0.42, 0.05] as V3, yaw: 0.3 },
      { position: [0.12, 0.42, -0.1] as V3, yaw: -0.4 },
      { position: [0.2, 0.42, 0.16] as V3, yaw: 1.1 },
    ],
    [],
  );
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <Model id="fantasy-props/Crate_Wooden" fit={{ height: 0.7 }} cast />
      <Maquettes at={peeking} scale={0.42} />
      <mesh position={[0.32, 0.5, 0.36]} rotation={[0, 0.2, 0.1]} material={PBR.matte(LINEN, 0.9)}>
        <planeGeometry args={[0.18, 0.1]} />
      </mesh>
    </group>
  );
}

/** The way out, on the right: a timber door frame onto warm light, a lantern, a little painted sign. */
function ExitDoor() {
  const walnut = PBR.wood("walnut");
  return (
    <group position={[8.0, 0, 5.0]} rotation={[0, -Math.PI / 2, 0]}>
      {[-0.7, 0.7].map((x) => (
        <Block key={x} size={[0.16, 2.6, 0.2]} position={[x, 1.3, 0]} material={walnut} radius={0.02} />
      ))}
      <Block size={[1.6, 0.18, 0.22]} position={[0, 2.62, 0]} material={walnut} radius={0.02} />
      <mesh position={[0, 1.27, -0.05]} material={PBR.light("#ffe3b8", 1.6)}>
        <planeGeometry args={[1.24, 2.5]} />
      </mesh>
      <Model id="fantasy-props/Lantern_Wall" fit={{ height: 0.45 }} position={[0.95, 1.9, 0.05]} />
      <Text font={FONTS.serif} fontSize={0.16} color="#f3e6cc" position={[0, 2.88, 0.12]} anchorX="center" anchorY="middle">
        to the Lattice
      </Text>
    </group>
  );
}

/** A brass line inlaid in the floor along the making line, with a chevron between each step. */
function MakingLine() {
  const chevrons = [-3.7, 0, 3.7];
  return (
    <group position={[0, 0.006, 0.1]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={PBR.brass()} receiveShadow>
        <planeGeometry args={[11.6, 0.05]} />
      </mesh>
      {chevrons.map((x) =>
        [-1, 1].map((s) => (
          <mesh key={`${x}${s}`} position={[x, 0.001, s * 0.1]} rotation={[-Math.PI / 2, 0, s * 0.7]} material={PBR.matte(TERRACOTTA, 0.6)}>
            <planeGeometry args={[0.3, 0.05]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** The back wall: warm plaster in a timber frame, Daub's sketches pinned along it, a clerestory of daylight. */
function BackWall() {
  const walnut = PBR.wood("walnut");
  const sketches = [-6.4, -5.6, -4.7, -3.6, 3.4, 4.3];
  return (
    <group position={[0, 0, -6.5]}>
      <Block size={[16.4, 5.2, 0.28]} position={[0, 2.6, 0]} material={PBR.matte("#6b4e3c", 0.92)} radius={0.04} />
      {Array.from({ length: 9 }, (_, i) => (
        <Block key={i} size={[0.22, 5.2, 0.12]} position={[-8 + i * 2, 2.6, 0.18]} material={walnut} radius={0.02} shadows={false} />
      ))}
      <Block size={[16.4, 0.2, 0.14]} position={[0, 3.6, 0.2]} material={walnut} radius={0.02} shadows={false} />
      <LightBar length={15.6} position={[0, 4.8, 0.3]} color="#ffe6c4" intensity={2} thickness={0.06} />
      {sketches.map((x, i) => (
        <group key={x} position={[x, 2.75 + (i % 2) * 0.22, 0.26]} rotation={[0, 0, ((i * 29) % 7) / 50 - 0.06]}>
          <mesh material={PBR.matte(i % 3 === 0 ? LINEN : i % 3 === 1 ? "#f3e2c4" : "#e9dccb", 0.95)}>
            <planeGeometry args={[0.6, 0.78]} />
          </mesh>
          {/* A quick figure in charcoal on each. */}
          <mesh position={[0, 0.12, 0.002]} material={PBR.matte("#4a3326", 0.9)}>
            <ringGeometry args={[0.06, 0.075, 14]} />
          </mesh>
          <mesh position={[0, -0.1, 0.002]} material={PBR.matte(MAQUETTE_COLOURS[(i * 3) % MAQUETTE_COLOURS.length]!, 0.9)}>
            <planeGeometry args={[0.16, 0.28]} />
          </mesh>
          <mesh position={[0, 0.33, 0.004]} material={PBR.brass()}>
            <sphereGeometry args={[0.018, 8, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Rafters across the room, on timber posts, which the lamps hang from. */
function Rafters() {
  const walnut = PBR.wood("walnut");
  return (
    <group>
      {[-7.9, 7.9].map((x) => (
        <Block key={x} size={[0.26, 4.6, 0.26]} position={[x, 2.3, -2.0]} material={walnut} radius={0.03} />
      ))}
      <Block size={[16.1, 0.28, 0.24]} position={[0, 4.5, -2.0]} material={walnut} radius={0.03} />
      {[-7.9, 7.9].map((x) => (
        <Block key={x} size={[0.9, 0.12, 0.14]} position={[x - Math.sign(x) * 0.4, 4.2, -2.0]} rotation={[0, 0, Math.sign(x) * 0.7]} material={walnut} radius={0.02} shadows={false} />
      ))}
    </group>
  );
}

/** The Workshop. */
export function Workshop() {
  const easel = ahead(getStation("workshop", "easel"), 1.1);
  const mould = ahead(getStation("workshop", "mould"), 1.4);
  const fitting = ahead(getStation("workshop", "fitting"), 1.3);
  const stage = ahead(getStation("workshop", "stage"), 1.8);
  const bench = ahead(getStation("workshop", "bench"), 0.85);
  const shelves = ahead(getStation("workshop", "shelves"), 0.85);
  const crate = ahead(getStation("workshop", "crate"), 0.8);

  return (
    <group>
      <Plinth floor={PBR.wood("oak", [5, 5])} edge={PBR.wood("walnut")} accent={TERRACOTTA} />
      {/* A worn rug under the workbench. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.6, 0.008, 3.4]} material={PBR.carpet("#7a3b2e", [2, 1])} receiveShadow>
        <planeGeometry args={[4.2, 2.4]} />
      </mesh>
      <BackWall />
      <Rafters />
      <MakingLine />

      <ConceptEasel position={[easel.pos[0], 0, easel.pos[1]]} yaw={easel.yaw} />
      <Mould position={[mould.pos[0], 0, mould.pos[1]]} yaw={mould.yaw} />
      <FittingStand position={[fitting.pos[0], 0, fitting.pos[1]]} yaw={fitting.yaw} />
      <RehearsalStage position={[stage.pos[0], 0, stage.pos[1]]} yaw={stage.yaw} />

      <Workbench position={[bench.pos[0], 0, bench.pos[1]]} yaw={bench.yaw} />
      <Shelves position={[shelves.pos[0], 0, shelves.pos[1]]} yaw={shelves.yaw} />
      <FinishedCrate position={[crate.pos[0], 0, crate.pos[1]]} yaw={crate.yaw} />
      <ExitDoor />

      {/* Lamps over each step of the line, and over the bench. */}
      {[easel, mould, fitting].map((s, i) => (
        <HangingLamp key={i} position={[s.pos[0], 3.1, s.pos[1] + 0.6]} drop={1.3} />
      ))}
      <HangingLamp position={[bench.pos[0], 3.0, bench.pos[1] - 0.2]} drop={1.5} />

      {/* Stock and clutter: a second bench, barrels of clay, sacks, a cabinet of materials. */}
      <Model id="fantasy-props/Workbench" fit={{ length: 2.0 }} position={[1.4, 0, 4.6]} rotation={Math.PI} cast />
      <Model id="fantasy-props/Barrel" fit={{ height: 0.9 }} position={[-7.2, 0, 5.4]} cast />
      <Model id="fantasy-props/Barrel" fit={{ height: 0.9 }} position={[-6.5, 0, 5.8]} rotation={1.2} cast />
      <Model id="fantasy-props/Bag" fit={{ height: 0.5 }} position={[-5.8, 0, 5.6]} rotation={0.6} />
      <Model id="fantasy-props/Cabinet" fit={{ height: 1.9 }} position={[-7.5, 0, -4.4]} rotation={Math.PI / 2} cast />
      <Model id="fantasy-props/Scroll_1" fit={{ length: 0.4 }} position={[1.2, 0.95, 4.6]} rotation={0.4} />
      <Model id="fantasy-props/Lantern_Wall" fit={{ height: 0.45 }} position={[-7.75, 2.2, 0.4]} rotation={Math.PI / 2} />
      <Model id="nature/Plant_1_Big" fit={{ height: 0.9 }} position={[3.4, 0, -5.8]} />

      <Dust min={[-7.4, 0.4, -5.6]} size={[14.8, 3.8, 10]} count={46} color="#ffe2b0" opacity={0.4} />
      {[-3.5, 3.5].map((x) => (
        <group key={x} position={[x, 5.0, -6.2]} rotation={[-0.8, 0, x > 0 ? -0.1 : 0.1]}>
          <Beam length={6.5} radius={0.85} color="#ffdcb0" opacity={0.08} />
        </group>
      ))}
      <pointLight position={[0, 4, 1.5]} color="#ffc89a" intensity={28} distance={18} decay={1.6} />
    </group>
  );
}
