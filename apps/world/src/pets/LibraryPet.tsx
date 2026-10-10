import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { AnimationMixer, Box3, type AnimationAction, type Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../fx/library.ts";
import type { PetDrive, PetMode } from "./types.ts";

/** A pet from the model library: a model, how tall it stands, and a clip (with speed) for each mode. */
export interface LibraryPetDef {
  model: string;
  height: number;
  clips: Record<PetMode, { clip: string; speed?: number }>;
}

export const LIBRARY_PETS = {
  shiba: {
    model: "animals/ShibaInu",
    height: 0.55,
    clips: {
      idle: { clip: "Idle" },
      walk: { clip: "Walk", speed: 1.1 },
      sit: { clip: "Idle_2" },
      nap: { clip: "Idle_2", speed: 0.25 },
      groom: { clip: "Eating" },
    },
  },
  mushnub: {
    model: "monsters/Blob/Mushnub",
    height: 0.5,
    clips: {
      idle: { clip: "Idle" },
      walk: { clip: "Walk" },
      sit: { clip: "Idle", speed: 0.6 },
      nap: { clip: "Idle", speed: 0.2 },
      groom: { clip: "Dance" },
    },
  },
} satisfies Record<string, LibraryPetDef>;

export function LibraryPet({ def, drive }: { def: LibraryPetDef; drive: RefObject<PetDrive> }) {
  const gltf = useLib(def.model);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const scale = useMemo(() => {
    const box = new Box3().setFromObject(gltf.scene, true);
    return def.height / Math.max(0.01, box.max.y - box.min.y);
  }, [gltf.scene, def.height]);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  const actions = useMemo(() => {
    const out = new Map<string, AnimationAction>();
    for (const clip of gltf.animations) out.set(clip.name, mixer.clipAction(clip));
    return out;
  }, [gltf.animations, mixer]);
  const current = useRef<PetMode | null>(null);
  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  useFrame((_, dt) => {
    const mode = drive.current?.mode ?? "idle";
    if (current.current !== mode) {
      const plan = def.clips[mode];
      const next = actions.get(plan.clip);
      const prev = current.current ? actions.get(def.clips[current.current].clip) : undefined;
      if (next) {
        if (next !== prev) next.reset().play();
        next.timeScale = plan.speed ?? 1;
        if (prev && prev !== next) next.crossFadeFrom(prev, 0.3, true);
      }
      current.current = mode;
    }
    mixer.update(Math.min(dt, 0.1));
  });

  return <primitive object={model} scale={scale} />;
}

preloadLib(LIBRARY_PETS.shiba.model, LIBRARY_PETS.mushnub.model);
