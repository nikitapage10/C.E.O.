import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Quaternion, Vector3, type Group, type Mesh } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../../fx/library.ts";
import { fitScale } from "./Rigged.tsx";
import { legFrames, legsOf, poseRocky, rockyState, type LegFrame } from "./rockyPose.ts";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

const MODEL = "custom/Rocky";
const wq = new Quaternion();
const fwd = new Vector3();
function lerpYaw(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/**
 * An Eridian engineer: a stone carapace on five legs, the front pair doubling as hands. The model ships without
 * animation, so rockyPose.ts walks it and puts its hands to work.
 */
export function Rocky({ drive, phase }: BodyProps) {
  const gltf = useLib(MODEL);
  const body = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const legs = useMemo(() => legsOf(model), [model]);
  const frames = useRef<LegFrame[] | null>(null);
  const state = useRef(rockyState());
  const scale = fitScale(gltf.scene, BODY_HEIGHT.rocky);
  /** The way the carapace faces, in the world. Radially symmetric, it scuttles any direction without turning. */
  const facing = useRef<number | null>(null);

  useFrame(() => {
    const d = drive.current;
    const g = body.current;
    const turner = spin.current;
    if (!d || !g || !turner) return;
    // The agent turns towards where it's going; an Eridian doesn't need to. Hold the facing while moving,
    // and only turn to the station once settled.
    turner.parent!.getWorldQuaternion(wq);
    const yaw = Math.atan2(fwd.set(0, 0, 1).applyQuaternion(wq).x, fwd.z);
    if (facing.current === null) facing.current = yaw;
    else if (!d.moving) facing.current = lerpYaw(facing.current, yaw, 0.08);
    turner.rotation.y = facing.current - yaw;
    frames.current ??= legFrames(g, legs);
    const { y, roll } = poseRocky(g, legs, frames.current, state.current, d.mode, d.t, phase);
    g.position.y = y;
    g.rotation.z = roll;
  });

  return (
    <group ref={spin}>
      <group ref={body}>
        <primitive object={model} scale={scale} />
      </group>
    </group>
  );
}

preloadLib(MODEL);
