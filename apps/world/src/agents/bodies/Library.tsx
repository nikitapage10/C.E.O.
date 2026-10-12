import type { Body, Look } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, Color, type AnimationClip, type Group, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../../fx/library.ts";
import { recolor, type Band } from "./recolor.ts";
import { synthesizeClips } from "./synthClips.ts";
import { LineageMark, findBone, fitScale, original, useClips, type ClipMap } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

/**
 * Bodies from the model library: the House frames (Quaternius robots), human disguises (Ultimate Modular
 * Men/Women, one shared clip file) and the creatures the icon costumes now wear (Ultimate Monsters, Sci-Fi
 * Essentials). Each says how it takes the look's colours.
 */

const ROBOT_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walk" },
  carrying: { clip: "Walk_Holding" },
  typing: { clip: "Yes", speed: 0.5 },
  working: { clip: "Pickup", speed: 0.6 },
  celebrating: { clip: "Dance" },
  slumped: { clip: "No", speed: 0.4 },
  napping: { clip: "Death", speed: 0.6, once: true },
  waiting: { clip: "Hello", speed: 0.7 },
  staring: { clip: "Idle" },
  stare: { clip: "Idle", speed: 0.25 },
};

const HUMAN_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walk" },
  carrying: { clip: "Walk", speed: 0.9 },
  typing: { clip: "Interact", speed: 0.7 },
  working: { clip: "Interact", speed: 0.5 },
  celebrating: { clip: "Wave" },
  slumped: { clip: "HitRecieve_2", speed: 0.4, once: true },
  napping: { clip: "Death", speed: 0.6, once: true },
  waiting: { clip: "Idle_Neutral" },
  staring: { clip: "Idle_Neutral" },
  stare: { clip: "Idle_Neutral", speed: 0.3 },
};

const MONSTER_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walk" },
  carrying: { clip: "Walk", speed: 0.85 },
  typing: { clip: "Yes", speed: 0.7 },
  working: { clip: "Punch", speed: 0.5 },
  celebrating: { clip: "Jump" },
  slumped: { clip: "Duck", speed: 0.5, once: true },
  napping: { clip: "Death", speed: 0.6, once: true },
  waiting: { clip: "Wave", speed: 0.7 },
  staring: { clip: "Idle" },
  stare: { clip: "Idle", speed: 0.3 },
};

const CRAWLER_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walk" },
  carrying: { clip: "Walk", speed: 0.85 },
  typing: { clip: "Look", speed: 0.8 },
  working: { clip: "AttackAuto", speed: 0.45 },
  celebrating: { clip: "Look", speed: 1.6 },
  slumped: { clip: "TurnOff", speed: 0.5, once: true },
  napping: { clip: "TurnOff", speed: 0.7, once: true },
  waiting: { clip: "Look", speed: 0.5 },
  staring: { clip: "Idle" },
  stare: { clip: "Look", speed: 0.25 },
};

/** For the walk-only Mixamo models: everything but walking comes from synthesizeClips. */
const SYNTH_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walking" },
  carrying: { clip: "Walking", speed: 0.85 },
  typing: { clip: "Type" },
  working: { clip: "Work" },
  celebrating: { clip: "Cheer" },
  slumped: { clip: "Slump" },
  napping: { clip: "Nap" },
  waiting: { clip: "Wait" },
  staring: { clip: "Stare" },
  stare: { clip: "Stare", speed: 0.3 },
};

/** Skippy keeps the watch: he never lies down. Resting is a slow, low hover with his eyes on the room. */
const SKIPPY_CLIPS: ClipMap = { ...SYNTH_CLIPS, slumped: { clip: "Wait", speed: 0.5 }, napping: { clip: "Stare", speed: 0.25 } };

const FLYING_CLIPS: ClipMap = {
  idle: { clip: "Flying_Idle" },
  walking: { clip: "Fast_Flying", speed: 0.7 },
  carrying: { clip: "Fast_Flying", speed: 0.6 },
  typing: { clip: "Yes", speed: 0.6 },
  working: { clip: "Punch", speed: 0.5 },
  celebrating: { clip: "Yes", speed: 1.5 },
  slumped: { clip: "No", speed: 0.4 },
  napping: { clip: "Death", speed: 0.6, once: true },
  waiting: { clip: "Flying_Idle", speed: 0.7 },
  staring: { clip: "Flying_Idle" },
  stare: { clip: "Flying_Idle", speed: 0.3 },
};

const BLOB_CLIPS: ClipMap = {
  idle: { clip: "Idle" },
  walking: { clip: "Walk" },
  carrying: { clip: "Walk", speed: 0.85 },
  typing: { clip: "Yes", speed: 0.7 },
  working: { clip: "Yes", speed: 0.45 },
  celebrating: { clip: "Dance" },
  slumped: { clip: "No", speed: 0.4 },
  napping: { clip: "Death", speed: 0.6, once: true },
  waiting: { clip: "Idle", speed: 0.7 },
  staring: { clip: "Idle" },
  stare: { clip: "Idle", speed: 0.3 },
};

type Slot = "shell" | "trim";

/** How a body takes the look's colours. */
type Dress =
  /** Flat-colour models: these named materials take these look colours. */
  | { kind: "materials"; slots: Record<string, Slot> }
  /** Textured models: hue bands of the texture are repainted (see recolor.ts). */
  | { kind: "bands"; shell?: Band; trim?: Band }
  /** Textured models: the texture is multiplied by the shell colour, for stone and fur. */
  | { kind: "tint"; roughness?: number; metalness?: number }
  /** Worn as made: the look's colours don't apply. */
  | { kind: "none" };

interface LibDef {
  model: string;
  /** A shared clip file (models/lib/anims/<name>.glb) when the model ships without its own. */
  anims?: string;
  clips: ClipMap;
  dress: Dress;
  /** Wears its lineage's mark when the look is the plain House frame. */
  frame?: boolean;
  /** Ships with only a walk cycle ("Walking"); the other clips are synthesized from it. */
  synth?: boolean;
  /**
   * Has no legs and floats this high (metres, before `size`): the leg and hip-bounce tracks are dropped so only
   * the upper body animates, and the body bobs over a soft glow in the look's accent.
   */
  float?: number;
  /** Model height for scaling, when BODY_HEIGHT (the label's height) also counts the float. */
  height?: number;
}

const ROBOT_TRIM: Band = { hue: 32, width: 16, minSat: 0.3, refL: 0.3 };

export const LIBRARY_BODIES: Partial<Record<Body, LibDef>> = {
  leela: { model: "robots/Leela", clips: ROBOT_CLIPS, dress: { kind: "bands", trim: ROBOT_TRIM }, frame: true },
  george: { model: "robots/George", clips: ROBOT_CLIPS, dress: { kind: "bands", trim: ROBOT_TRIM }, frame: true },
  mike: { model: "robots/Mike", clips: ROBOT_CLIPS, dress: { kind: "bands", trim: ROBOT_TRIM }, frame: true },
  stan: { model: "robots/Stan", clips: ROBOT_CLIPS, dress: { kind: "bands", shell: { hue: 165, width: 18, minSat: 0.25, refL: 0.34 }, trim: ROBOT_TRIM }, frame: true },

  suit: { model: "men/Suit", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Suit: "shell", Tie: "trim" } } },
  formal: { model: "women/Formal", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { LimeGreen: "shell", Gold: "trim" } } },
  casual: { model: "men/Casual_Hoodie", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Purple: "shell", LightBlue: "trim" } } },
  hardhat: { model: "women/Worker", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Worker_Vest: "shell", Worker_Yellow: "trim" } } },
  punk: { model: "men/Punk", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Black: "shell", Red: "trim" } } },
  medieval: { model: "women/Medieval", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { DarkBrown: "shell", Gold: "trim" } } },
  worker: { model: "men/Worker", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Worker_Vest: "shell", Worker_Yellow: "trim" } } },
  scifi: { model: "women/SciFi", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { LightBlue: "shell", Blue: "trim" } } },
  spacesuit: { model: "men/Spacesuit", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { SciFi_Light: "shell", SciFi_Light_Accent: "trim" } } },
  witch: { model: "women/Witch", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Purple: "shell", Gold: "trim" } } },
  king: { model: "men/King", anims: "humans", clips: HUMAN_CLIPS, dress: { kind: "materials", slots: { Blue: "shell", Gold: "trim" } } },

  gestral: { model: "custom/Gestral", clips: SYNTH_CLIPS, synth: true, dress: { kind: "bands", shell: { hue: 349, width: 18, minSat: 0.35, refL: 0.5 } } },
  // The coat is the navy band; his golden fur stays his own.
  // Nikita's admiral can: rigged with legs he doesn't have, so they stay still and he floats.
  skippy: { model: "custom/Skippy", clips: SKIPPY_CLIPS, synth: true, float: 0.18, height: 0.95, dress: { kind: "none" } },
  yordle: { model: "custom/Heimerdinger", clips: SYNTH_CLIPS, synth: true, dress: { kind: "bands", shell: { hue: 230, width: 20, minSat: 0.3, refL: 0.25 } } },
  crawler: { model: "scifi-essentials/Enemy_Trilobite", clips: CRAWLER_CLIPS, dress: { kind: "tint", roughness: 0.92, metalness: 0.05 } },
  masked: { model: "monsters/Big/Tribal", anims: "monster-big", clips: MONSTER_CLIPS, dress: { kind: "none" } },
  orc: { model: "monsters/Big/Orc", anims: "monster-big", clips: MONSTER_CLIPS, dress: { kind: "none" } },
  bunny: { model: "monsters/Big/Bunny", clips: MONSTER_CLIPS, dress: { kind: "none" } },
  ghost: { model: "monsters/Flying/Ghost_Skull", anims: "monster-flying", clips: FLYING_CLIPS, dress: { kind: "none" } },
  flyer: { model: "monsters/Flying/Tribal", anims: "monster-flying", clips: FLYING_CLIPS, dress: { kind: "none" } },
  wizard: { model: "monsters/Blob/Wizard", clips: BLOB_CLIPS, dress: { kind: "none" } },
  birb: { model: "monsters/Big/Birb", anims: "monster-big", clips: MONSTER_CLIPS, dress: { kind: "bands", shell: { hue: 205, width: 22, minSat: 0.3, refL: 0.5 } } },
  yeti: { model: "monsters/Big/Yeti", anims: "monster-big", clips: MONSTER_CLIPS, dress: { kind: "tint", roughness: 0.95 } },
};

function dress(model: Object3D, body: string, def: LibDef, look: Look) {
  const mats = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  const colour = (slot: Slot) => (slot === "shell" ? look.shell : look.trim);
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const src = original<MeshStandardMaterial>(m);
    let mat = mats.get(src);
    if (!mat) {
      mat = src.clone();
      const d = def.dress;
      if (d.kind === "materials") {
        const slot = d.slots[src.name];
        if (slot) mat.color = new Color(colour(slot));
      } else if (d.kind === "bands" && src.map) {
        const swaps = [...(d.shell ? [{ band: d.shell, color: look.shell }] : []), ...(d.trim ? [{ band: d.trim, color: look.trim }] : [])];
        if (swaps.length) mat.map = recolor(body, src.map, swaps);
      } else if (d.kind === "tint") {
        mat.color = new Color(look.shell).multiplyScalar(1.6);
        if (d.roughness !== undefined) mat.roughness = d.roughness;
        if (d.metalness !== undefined) mat.metalness = d.metalness;
      }
      mat.envMapIntensity = 0.9;
      mats.set(src, mat);
    }
    m.material = mat;
  });
}

const synthCache = new WeakMap<Object3D, AnimationClip[]>();
function clipsOf(def: LibDef, gltf: { scene: Object3D; animations: AnimationClip[] }) {
  if (!def.synth) return gltf.animations;
  let clips = synthCache.get(gltf.scene);
  if (!clips) {
    const walk = gltf.animations.find((c) => c.name === "Walking");
    clips = walk ? [...gltf.animations, ...synthesizeClips(gltf.scene, walk)] : gltf.animations;
    if (def.float) clips = clips.map(upperBody);
    synthCache.set(gltf.scene, clips);
  }
  return clips;
}

/** Everything above the waist: leg tracks and the hips' bounce go, so a legless body keeps a still base. */
const LEGS = /(UpLeg|Leg|Foot|Toe)[^.]*\.|Hips\.position/;
function upperBody(clip: AnimationClip) {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => !LEGS.test(t.name));
  return c;
}

/** A soft round falloff for the hover shimmer: bright in the middle, gone at the edge (no hard rim). */
let haloTex: CanvasTexture | null = null;
function halo() {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (haloTex = new CanvasTexture(c));
}

/** The hover: a slow bob and sway, lower when resting, over a glow that breathes with it. */
function Float({ height, accent, drive, phase, children }: { height: number; accent: string; drive: BodyProps["drive"]; phase: number; children: React.ReactNode }) {
  const lift = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const level = useRef(height);
  useFrame((_, dt) => {
    const d = drive.current;
    const g = lift.current;
    if (!d || !g) return;
    const resting = d.mode === "napping" || d.mode === "slumped";
    const target = resting ? height * 0.35 : d.mode === "celebrating" ? height * 1.6 : height;
    level.current += (target - level.current) * Math.min(1, dt * 2.5);
    const t = d.t + phase;
    const bob = Math.sin(t * 2.1) * (resting ? 0.01 : 0.03);
    g.position.y = level.current + bob;
    g.rotation.z = Math.sin(t * 1.3) * 0.035;
    g.rotation.x = d.moving ? 0.12 : Math.sin(t * 0.9) * 0.02;
    const gl = glow.current;
    if (gl) {
      const near = 1 - (level.current + bob) / (height * 1.6);
      gl.scale.setScalar(0.8 + near * 0.3);
      (gl.material as MeshBasicMaterial).opacity = 0.06 + near * 0.12;
    }
  });
  return (
    <>
      <mesh ref={glow} rotation-x={-Math.PI / 2} position-y={0.02}>
        <planeGeometry args={[0.5, 0.5]} />
        <meshBasicMaterial color={accent} map={halo()} transparent opacity={0.12} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <group ref={lift}>{children}</group>
    </>
  );
}

function WithAnims({ def, ...props }: BodyProps & { def: LibDef & { anims: string } }) {
  const anims = useLib(`anims/${def.anims}`);
  return <LibraryModel def={def} clips={anims.animations} {...props} />;
}

function LibraryModel({ def, clips, look, lineage, drive, phase }: BodyProps & { def: LibDef; clips?: AnimationClip[] }) {
  const body = look.body;
  const gltf = useLib(def.model);
  const root = useRef<Group>(null);
  const model = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);
  useMemo(() => dress(model, body, def, look), [model, body, def, look]);
  const head = useMemo(() => (def.frame ? findBone(model, /^Head$/) : null), [model, def]);
  const scale = fitScale(gltf.scene, def.height ?? BODY_HEIGHT[body as Exclude<Body, "classic">]);
  useClips(model, clips ?? clipsOf(def, gltf), def.clips, drive, phase);
  const plainFrame = def.frame && (look.preset === undefined || look.preset === "frame");
  const figure = <primitive object={model} scale={scale} />;
  return (
    <group ref={root}>
      {def.float ? (
        <Float height={def.float} accent={look.accent} drive={drive} phase={phase}>
          {figure}
        </Float>
      ) : (
        figure
      )}
      {plainFrame && <LineageMark lineage={lineage} accent={look.accent} head={head} root={root} />}
    </group>
  );
}

export function LibraryBody(props: BodyProps) {
  const def = LIBRARY_BODIES[props.look.body]!;
  return def.anims ? <WithAnims def={def as LibDef & { anims: string }} {...props} /> : <LibraryModel def={def} {...props} />;
}

// The bodies the default cast wears: the four House frames and the costumes in use.
preloadLib("robots/Leela", "robots/George", "robots/Mike", "robots/Stan", "men/Suit", "men/Punk", "women/Worker", "women/Medieval", "anims/humans");
preloadLib("custom/Gestral", "custom/Heimerdinger", "custom/Skippy", "scifi-essentials/Enemy_Trilobite", "monsters/Big/Tribal", "monsters/Big/Orc", "monsters/Big/Bunny", "anims/monster-big");
preloadLib("monsters/Flying/Ghost_Skull", "monsters/Flying/Tribal", "anims/monster-flying", "monsters/Blob/Wizard");
