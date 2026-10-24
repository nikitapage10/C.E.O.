import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3, type Group, type Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { poseCompactor, rigCompactor, type CompactorRig } from "./compactorPose.ts";
import { modelUrl } from "../../fx/library.ts";
import { fitScale } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

/** Rebuilt from its Meshy export by scripts/rig-tessellate.mjs. */
const URL = modelUrl("compactor.glb");

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
  const root = useRef<Group>(null);
  const last = useRef<Vector3 | null>(null);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.compactor);

  useFrame((_, dt) => {
    const d = drive.current;
    const g = root.current;
    if (!d || !g) return;
    rig.current ??= rigCompactor(model);
    // How far he rolled since the last frame, along the way he faces, in the model's own units.
    g.getWorldPosition(here);
    const moved = last.current ? step.copy(here).sub(last.current).setY(0) : null;
    last.current = (last.current ?? new Vector3()).copy(here);
    let travel = 0;
    if (moved && moved.lengthSq() < 1) {
      g.getWorldDirection(facing);
      travel = moved.dot(facing) / model.getWorldScale(scaled).x;
    }
    if (rig.current) poseCompactor(rig.current, d.mode, d.t, dt, phase, d.speaking, travel);
  });

  return (
    <group ref={root}>
      <primitive object={model} scale={scale} />
    </group>
  );
}

const here = new Vector3();
const step = new Vector3();
const facing = new Vector3();
const scaled = new Vector3();

useGLTF.preload(URL, false, true);
