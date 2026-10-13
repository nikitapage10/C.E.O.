import type { Body, LineageId, Look } from "@ceo/core";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AnimationMixer,
  Box3,
  LoopOnce,
  LoopRepeat,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Group,
  type Mesh,
  type Object3D,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { modelUrl, preloadLater } from "../../fx/library.ts";
import { PBR } from "../../fx/pbr.ts";
import type { PoseMode } from "../behavior.ts";
import { recolor, type Band } from "./recolor.ts";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

export const url = (file: string) => modelUrl(file);
export const ROBOT_URL = url("robot.glb");
export const KAYKIT_ANIMS_URL = url("kaykit-anims.glb");

type Rigged = Extract<Body, "robot" | "mage" | "rogue" | "hooded" | "knight" | "barbarian">;
export const RIGGED: ReadonlySet<Body> = new Set<Rigged>(["robot", "mage", "rogue", "hooded", "knight", "barbarian"]);

/** A clip per mode, with playback speed. `once` clips play through and hold their last frame. */
export type ClipPlan = { clip: string; speed?: number; once?: boolean };
export type ClipMap = Record<PoseMode, ClipPlan> & { dance?: ClipPlan };

const KAYKIT_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walking_A", speed: 1.05 },
  carrying: { clip: "Walking_C" },
  typing: { clip: "Use_Item", speed: 0.8 },
  working: { clip: "Interact", speed: 0.7 },
  celebrating: { clip: "Cheer" },
  slumped: { clip: "Sit_Floor_Idle" },
  napping: { clip: "Lie_Idle" },
  waiting: { clip: "Unarmed_Idle" },
  staring: { clip: "Idle" },
  stare: { clip: "Unarmed_Idle", speed: 0.4 },
};

const ROBOT_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walking", speed: 1.1 },
  carrying: { clip: "Walking" },
  typing: { clip: "Yes", speed: 0.55 },
  working: { clip: "Punch", speed: 0.45 },
  celebrating: { clip: "Dance" },
  slumped: { clip: "Sitting", once: true },
  napping: { clip: "Death", speed: 0.7, once: true },
  waiting: { clip: "Wave", speed: 0.7 },
  staring: { clip: "Idle" },
  stare: { clip: "Idle", speed: 0.2 },
};

interface KayKitDef {
  file: string;
  /** Meshes to keep visible: the outfit. Everything else in the hand slots (weapons) is hidden. */
  keep: RegExp;
  primary?: Band;
  secondary?: Band;
  /** Override clips for this character. */
  clips?: Partial<ClipMap>;
}

const ROGUE_BANDS = { primary: { hue: 163, width: 24, minSat: 0.45, refL: 0.25 }, secondary: { hue: 279, width: 16, minSat: 0.45, refL: 0.55 } };
export const KAYKIT: Record<Exclude<Rigged, "robot">, KayKitDef> = {
  mage: {
    file: "mage.glb",
    keep: /^(Mage_|2H_Staff)/,
    primary: { hue: 245, width: 22, minSat: 0.1, refL: 0.33 },
    secondary: { hue: 331, width: 16, minSat: 0.4, refL: 0.36 },
    clips: { working: { clip: "Spellcasting", speed: 0.6 } },
  },
  rogue: { file: "rogue.glb", keep: /^Rogue_/, ...ROGUE_BANDS },
  hooded: { file: "hooded.glb", keep: /^Rogue_/, ...ROGUE_BANDS },
  knight: { file: "knight.glb", keep: /^(Knight_|Round_Shield)/, primary: { hue: 355, width: 14, minSat: 0.45, refL: 0.5 } },
  barbarian: { file: "barbarian.glb", keep: /^(Barbarian_|Mug)/, primary: { hue: 205, width: 9, minSat: 0.2, refL: 0.42 } },
};

/** Scale that brings a model's bind pose to `height`. Cached per source scene. */
const scaleCache = new WeakMap<Object3D, number>();
export function fitScale(scene: Object3D, height: number) {
  let s = scaleCache.get(scene);
  if (s === undefined) {
    const box = new Box3().setFromObject(scene, true);
    s = height / Math.max(0.01, box.max.y - box.min.y);
    scaleCache.set(scene, s);
  }
  return s;
}

/** Plays the clip for the current mode, cross-fading between them. */
export function useClips(model: Object3D, clips: AnimationClip[], map: ClipMap, drive: BodyProps["drive"], phase: number) {
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  const actions = useMemo(() => {
    const byName = new Map(clips.map((c) => [c.name, c]));
    const out = new Map<string, AnimationAction>();
    for (const plan of Object.values(map)) {
      const clip = byName.get(plan.clip);
      if (clip && !out.has(plan.clip)) out.set(plan.clip, mixer.clipAction(clip));
    }
    return out;
  }, [clips, map, mixer]);
  const current = useRef<string | null>(null);
  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  useFrame((_, dt) => {
    const d = drive.current;
    if (!d) return;
    const plan = map[d.mode] ?? map.idle;
    const key = `${d.mode}:${plan.clip}`;
    if (current.current !== key) {
      const next = actions.get(plan.clip) ?? actions.get(map.idle.clip);
      const prev = current.current ? actions.get(current.current.split(":")[1]!) : undefined;
      if (next) {
        next.reset();
        next.setLoop(plan.once ? LoopOnce : LoopRepeat, Infinity);
        next.clampWhenFinished = !!plan.once;
        next.timeScale = plan.speed ?? 1;
        // De-sync agents doing the same thing.
        if (!plan.once) next.time = (phase / (Math.PI * 2)) * next.getClip().duration;
        next.play();
        if (prev && prev !== next) next.crossFadeFrom(prev, 0.3, true);
      }
      current.current = key;
    }
    // Walk cycles keep pace with the ground covered, so feet don't skate when the Lattice runs fast.
    mixer.update(Math.min(dt, 0.1) * (d.rate ?? 1));
  });
}

/** The material a mesh was loaded with, remembered so a re-dress starts from the original. */
export function original<T>(m: Mesh): T {
  return (m.userData.orig ??= m.material) as T;
}

/** Material swaps for the native frame: the yellow shell takes the agent's colour, the grey its trim. */
function dressRobot(model: Object3D, look: Look) {
  const shell = new MeshPhysicalMaterial({ color: look.shell, roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 });
  const trim = new MeshStandardMaterial({ color: look.trim, roughness: 0.32, metalness: 0.85 });
  const dark = new MeshPhysicalMaterial({ color: "#0a0c10", roughness: 0.18, metalness: 0.3, clearcoat: 1 });
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const name = original<MeshStandardMaterial>(m).name;
    m.material = name === "Main" ? shell : name === "Grey" ? trim : dark;
  });
}

function dressKayKit(model: Object3D, def: KayKitDef, body: string, look: Look) {
  const swaps = [
    ...(def.primary ? [{ band: def.primary, color: look.shell }] : []),
    ...(def.secondary ? [{ band: def.secondary, color: look.trim }] : []),
  ];
  const mats = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    // Hand-slot items (weapons, books) are separate meshes; keep the outfit, hide the arsenal.
    if (!(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh && !def.keep.test(m.name)) {
      m.visible = false;
      return;
    }
    m.castShadow = true;
    m.receiveShadow = true;
    const src = original<MeshStandardMaterial>(m);
    let mat = mats.get(src);
    if (!mat) {
      mat = src.clone();
      if (src.map && swaps.length) mat.map = recolor(body, src.map, swaps);
      mat.roughness = 0.62;
      mat.metalness = 0;
      mat.envMapIntensity = 0.9;
      mats.set(src, mat);
    }
    m.material = mat;
  });
}

const headWorld = new Vector3();

/** The native Syntherion's lineage signature, worn on the frame: halo, strings, caret, orbiting hands, antenna. */
export function LineageMark({ lineage, accent, head, root }: { lineage: LineageId; accent: string; head: Object3D | null; root: React.RefObject<Group | null> }) {
  const mark = useRef<Group>(null);
  const caret = useRef<Mesh>(null);
  const hands = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!mark.current || !head || !root.current) return;
    head.getWorldPosition(headWorld);
    root.current.worldToLocal(headWorld);
    mark.current.position.copy(headWorld);
    const t = clock.elapsedTime;
    if (caret.current) caret.current.visible = Math.floor(t * 2.2) % 2 === 0;
    if (hands.current) hands.current.rotation.y = t * 1.4;
  });
  return (
    <group ref={mark}>
      {lineage === "claudari" && (
        <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2 + 0.2, 0, 0]} material={PBR.light(accent, 3)}>
          <torusGeometry args={[0.2, 0.012, 8, 48]} />
        </mesh>
      )}
      {lineage === "gepetti" && (
        <group position={[0, 0.75, 0]}>
          <mesh material={PBR.wood("oak")}>
            <boxGeometry args={[0.7, 0.035, 0.035]} />
          </mesh>
          <mesh material={PBR.wood("oak")}>
            <boxGeometry args={[0.035, 0.035, 0.45]} />
          </mesh>
          {[-0.33, 0, 0.33].map((x) => (
            <mesh key={x} position={[x, x === 0 ? -0.22 : -0.55, 0]} material={PBR.light(accent, 1.2)}>
              <boxGeometry args={[0.004, x === 0 ? 0.44 : 1.1, 0.004]} />
            </mesh>
          ))}
        </group>
      )}
      {lineage === "cursori" && (
        <mesh ref={caret} position={[0.32, 0.1, 0.05]} material={PBR.light(accent, 4)}>
          <boxGeometry args={[0.022, 0.3, 0.022]} />
        </mesh>
      )}
      {lineage === "manusi" && (
        <group ref={hands} position={[0, -0.45, 0]}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.48, Math.sin(i) * 0.08, Math.sin((i * Math.PI) / 2) * 0.48]} material={PBR.lacquer("#f1eefa", 0.25)} castShadow>
              <sphereGeometry args={[0.05, 16, 12]} />
            </mesh>
          ))}
        </group>
      )}
      {lineage === "unforked" && (
        <group position={[0.08, 0.32, 0]}>
          <mesh material={PBR.chrome()}>
            <cylinderGeometry args={[0.006, 0.006, 0.22, 6]} />
          </mesh>
          <mesh position={[0, 0.12, 0]} material={PBR.light(accent, 3)}>
            <sphereGeometry args={[0.025, 12, 10]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export function findBone(model: Object3D, re: RegExp) {
  let hit: Object3D | null = null;
  model.traverse((o) => {
    if (!hit && (o as unknown as { isBone?: boolean }).isBone && re.test(o.name)) hit = o;
  });
  return hit as Object3D | null;
}

export function RobotBody({ look, lineage, drive, phase }: BodyProps) {
  const gltf = useGLTF(ROBOT_URL);
  const root = useRef<Group>(null);
  const model = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);
  useMemo(() => dressRobot(model, look), [model, look]);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.robot);
  const head = useMemo(() => findBone(model, /^Head/i), [model]);
  useClips(model, gltf.animations, ROBOT_CLIPS, drive, phase);
  return (
    <group ref={root}>
      <primitive object={model} scale={scale} />
      {look.preset === undefined || look.preset === "frame" ? <LineageMark lineage={lineage} accent={look.accent} head={head} root={root} /> : null}
    </group>
  );
}

export function KayKitBody({ look, drive, phase }: BodyProps) {
  const body = look.body as Exclude<Rigged, "robot">;
  const def = KAYKIT[body];
  const gltf = useGLTF(url(def.file));
  const anims = useGLTF(KAYKIT_ANIMS_URL);
  const model = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);
  useMemo(() => dressKayKit(model, def, body, look), [model, def, body, look]);
  const map = useMemo(() => ({ ...KAYKIT_CLIPS, ...def.clips }) as ClipMap, [def]);
  const scale = fitScale(gltf.scene, BODY_HEIGHT[body]);
  useClips(model, anims.animations, map, drive, phase);
  return <primitive object={model} scale={scale} />;
}

// Warm, for a look change in the studio; what the cast wears loads first (scene/streaming.ts).
preloadLater(ROBOT_URL, KAYKIT_ANIMS_URL, ...Object.values(KAYKIT).map((d) => url(d.file)));
