import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Vector3, type Group, type Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../fx/library.ts";
import { fitScale } from "../agents/bodies/Rigged.tsx";
import { poseOwlbear, rigOwlbear, type OwlbearRig } from "./owlbearPose.ts";
import type { PetDrive } from "./types.ts";

export const MODEL = "custom/Owlbear";
/** Ear tufts to the floor, in metres. A cub, but a chunky one: he comes up past an agent's waist. */
export const OWLBEAR_HEIGHT = 1.0;

/** The owlbear cub. The model has no clips, so owlbearPose.ts walks him like a bear. */
export function Owlbear({ drive }: { drive: RefObject<PetDrive> }) {
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
  const scale = fitScale(gltf.scene, OWLBEAR_HEIGHT);
  const rig = useRef<OwlbearRig | null>(null);
  const last = useRef<Vector3 | null>(null);
  const here = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    const d = drive.current;
    if (!d || !holder.current) return;
    dt = Math.min(dt, 0.1);
    rig.current ??= rigOwlbear(model);
    holder.current.getWorldPosition(here);
    const moved = last.current ? here.distanceTo(last.current) : 0;
    (last.current ??= new Vector3()).copy(here);
    // A jump (crossing rooms on the stream) isn't walking.
    const speed = dt > 0 && moved < 1 ? moved / dt / scale : 0;
    poseOwlbear(rig.current, d.mode, d.t, dt, speed);
  });

  return (
    <group ref={holder} scale={scale}>
      <primitive object={model} />
    </group>
  );
}

preloadLib(MODEL);
