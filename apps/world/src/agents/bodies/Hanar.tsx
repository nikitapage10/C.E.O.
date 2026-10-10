import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../../fx/library.ts";
import { chainsOf, frontPair, hanarState, poseHanar } from "./hanarPose.ts";
import { fitScale } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

const MODEL = "custom/Blasto";

/**
 * A hanar: a floating jellyfish who drifts rather than walks. The model ships without animation, so hanarPose.ts
 * moves it: six tentacles undulating, the front pair working as hands.
 */
export function Hanar({ drive, phase }: BodyProps) {
  const gltf = useLib(MODEL);
  const float = useRef<Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const chains = useMemo(() => chainsOf(model), [model]);
  const front = useRef<[number, number] | null>(null);
  const state = useRef(hanarState());
  const scale = fitScale(gltf.scene, BODY_HEIGHT.hanar);

  useFrame(() => {
    const d = drive.current;
    const g = float.current;
    if (!d || !g) return;
    front.current ??= frontPair(g, chains);
    const { y, tilt } = poseHanar(g, chains, front.current, state.current, d.mode, d.t, phase);
    g.position.y = y;
    g.rotation.x = tilt;
  });

  return (
    <group ref={float}>
      {/* The model was built facing away from its front. */}
      <primitive object={model} scale={scale} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

preloadLib(MODEL);
