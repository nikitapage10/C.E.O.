import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { poseCompactor, rigCompactor, type CompactorRig } from "./compactorPose.ts";
import { fitScale } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

/** Rebuilt from its Meshy export by scripts/rig-tessellate.mjs. */
const URL = `${import.meta.env.BASE_URL}models/compactor.glb`;

/**
 * A salvage compactor on treads: a rusted box with a neck, a pair of binocular eyes and two claw arms. Worn as
 * made (the look's colours don't apply; the rust is the point). It ships without animation, so compactorPose.ts
 * moves its rigid parts.
 */
export function Compactor({ drive, phase }: BodyProps) {
  const gltf = useGLTF(URL, false, true);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const rig = useRef<CompactorRig | null>(null);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.compactor);

  useFrame((_, dt) => {
    const d = drive.current;
    if (!d) return;
    rig.current ??= rigCompactor(model);
    if (rig.current) poseCompactor(rig.current, d.mode, d.t, dt, phase, d.speaking);
  });

  return <primitive object={model} scale={scale} />;
}

useGLTF.preload(URL, false, true);
