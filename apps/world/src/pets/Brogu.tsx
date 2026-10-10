import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Vector3, type Group, type Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../fx/library.ts";
import { fitScale } from "../agents/bodies/Rigged.tsx";
import { poseBrogu, rigBrogu, type BroguRig } from "./broguPose.ts";
import type { PetDrive } from "./types.ts";

const MODEL = "custom/Brogu";
/** Head to the floor, in metres. He comes up to an agent's hip, ears and all. */
export const BROGU_HEIGHT = 0.8;

/** Brogu. The model has no clips, so broguPose.ts walks him like a toddler. */
export function Brogu({ drive }: { drive: RefObject<PetDrive> }) {
  const gltf = useLib(MODEL);
  const holder = useRef<Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const scale = fitScale(gltf.scene, BROGU_HEIGHT);
  const rig = useRef<BroguRig | null>(null);
  const last = useRef<Vector3 | null>(null);
  const here = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    const d = drive.current;
    if (!d || !holder.current) return;
    dt = Math.min(dt, 0.1);
    rig.current ??= rigBrogu(model);
    holder.current.getWorldPosition(here);
    const moved = last.current ? here.distanceTo(last.current) : 0;
    (last.current ??= new Vector3()).copy(here);
    // A jump (crossing rooms on the stream) isn't walking.
    const speed = dt > 0 && moved < 1 ? moved / dt / scale : 0;
    poseBrogu(rig.current, d.mode, d.t, dt, speed);
  });

  return (
    <group ref={holder} scale={scale}>
      <primitive object={model} />
    </group>
  );
}

preloadLib(MODEL);
