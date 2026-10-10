import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Vector3, type Group, type Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { fitScale } from "../agents/bodies/Rigged.tsx";
import { preloadLib, useLib } from "../fx/library.ts";
import { MyshkaRig } from "./myshkaPose.ts";
import type { PetDrive } from "./types.ts";

const MODEL = "custom/Myshka";
/** Ear tips to the floor, in metres. A Maine Coon, so a big cat: his back comes up to an agent's knee. */
export const MYSHKA_HEIGHT = 0.72;

/** Myshka. The body is a Meshy export with retargeted cat clips; myshkaPose.ts plays them and does the rest. */
export function Myshka({ drive }: { drive: RefObject<PetDrive> }) {
  const gltf = useLib(MODEL);
  const holder = useRef<Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = mesh.receiveShadow = true;
        // He's one skinned mesh; the bounds of the bind pose don't cover a stretch or a gallop.
        mesh.frustumCulled = false;
      }
    });
    return m;
  }, [gltf.scene]);
  const scale = fitScale(gltf.scene, MYSHKA_HEIGHT);
  const rig = useMemo(() => new MyshkaRig(model, gltf.animations), [model, gltf.animations]);
  useEffect(() => () => rig.dispose(), [rig]);
  const last = useRef<Vector3 | null>(null);
  const here = useMemo(() => new Vector3(), []);
  const speed = useRef(0);

  useFrame((_, dt) => {
    const d = drive.current;
    if (!d || !holder.current) return;
    dt = Math.min(dt, 0.1);
    holder.current.getWorldPosition(here);
    const moved = last.current ? here.distanceTo(last.current) : 0;
    (last.current ??= new Vector3()).copy(here);
    // A jump (crossing rooms on the stream) isn't walking. Smooth the reading so the gait doesn't flicker.
    const raw = dt > 0 && moved < 1 ? moved / dt / scale : 0;
    speed.current += (raw - speed.current) * (1 - Math.exp(-dt * 10));
    rig.update(d.mode, d.t, dt, speed.current);
  });

  return (
    <group ref={holder} scale={scale}>
      <primitive object={model} />
    </group>
  );
}

preloadLib(MODEL);
