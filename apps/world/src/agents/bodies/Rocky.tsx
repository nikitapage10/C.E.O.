import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../../fx/library.ts";
import { fitScale } from "./Rigged.tsx";
import { legsOf, poseRocky, rigRocky, type RockyRig } from "./rockyPose.ts";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

export const MODEL = "custom/Rocky";

/**
 * An Eridian engineer: a stone carapace on five legs, the front pair doubling as hands. The model ships without
 * animation, so rockyPose.ts walks it on planted feet and puts its hands to work.
 */
export function Rocky({ drive, phase }: BodyProps) {
  const gltf = useLib(MODEL);
  const ground = useRef<Group>(null);
  const body = useRef<Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const legs = useMemo(() => legsOf(model), [model]);
  const rig = useRef<RockyRig | null>(null);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.rocky);

  useFrame((_, dt) => {
    const d = drive.current;
    const g = ground.current;
    const b = body.current;
    if (!d || !g || !b) return;
    rig.current ??= rigRocky(g, legs);
    const held = poseRocky(g, b, rig.current, d.mode, d.t, dt, phase);
    d.hold = held ? (d.hold ?? held.clone()).copy(held) : null;
  });

  return (
    <group ref={ground}>
      <group ref={body}>
        <primitive object={model} scale={scale} />
      </group>
    </group>
  );
}

preloadLib(MODEL);
