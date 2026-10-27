import { useGLTF } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";
import { Fragment, useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh, type Object3D } from "three";
import { modelUrl } from "../../fx/library.ts";
import { protocolPose } from "./droidPose.ts";
import { fitScale } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

/** Built from its Meshy sculpt by scripts/build-droids.mjs (not a library model: vendor-models never touches it). */
export const PROTOCOL_URL = modelUrl("droids/protocol.glb");

const NAMES = ["torso", "head", "armL", "armR", "legL", "legR", "eyeL", "eyeR"] as const;
type Parts = Record<(typeof NAMES)[number], Object3D>;

function partsOf(model: Object3D): Parts {
  return Object.fromEntries(
    NAMES.map((n) => {
      const o = model.getObjectByName(n);
      if (!o) throw new Error(`protocol droid: no ${n}`);
      return [n, o];
    }),
  ) as Parts;
}

/**
 * Clause: a gold protocol droid with knees that don't bend. Worn as built (gold; the look's accent lights its eyes).
 * droidPose.ts moves it: the stiff-legged walk, the free arm swinging like a rod, the servo head, the fussing.
 */
export function ProtocolDroid({ look, drive, phase }: BodyProps) {
  const gltf = useGLTF(PROTOCOL_URL, false, true);
  const model = useMemo(() => {
    const m = gltf.scene.clone(true);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const parts = useMemo(() => partsOf(model), [model]);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.protocol);
  const eyeMat = useMemo(() => new MeshStandardMaterial({ color: "#2a1a00", emissive: look.accent, emissiveIntensity: 1.6, toneMapped: false }), [look.accent]);
  const root = useRef<Group>(null);
  const clock = useRef(phase * 3);

  useFrame((_, dt) => {
    const d = drive.current;
    const g = root.current;
    if (!d || !g) return;
    clock.current += dt * (d.rate ?? 1);
    const p = protocolPose(d.mode, clock.current, phase, d.speaking);
    g.position.y = p.lift * scale;
    const { torso, head, armL, armR, legL, legR } = parts;
    // It rocks as a whole, over onto each foot; the torso twists and stoops on the hips.
    g.rotation.z = p.roll;
    torso.rotation.set(p.pitch, p.yaw, 0);
    // A positive swing or raise sends the foot or hand forward (+Z): a negative turn about X.
    legL.rotation.set(-p.legL, 0, 0);
    legR.rotation.set(-p.legR, 0, 0);
    armL.rotation.set(-p.armL, 0, p.armLOut);
    armR.rotation.set(-p.armR, 0, p.armROut);
    head.rotation.set(p.headPitch, p.headYaw, p.headTilt);
    eyeMat.emissiveIntensity = p.eye;
  });

  return (
    <group ref={root}>
      <primitive object={model} scale={scale} />
      {(["eyeL", "eyeR"] as const).map((k) => (
        <Fragment key={k}>
          {createPortal(
            <mesh material={eyeMat}>
              <sphereGeometry args={[0.014, 12, 8]} />
            </mesh>,
            parts[k],
          )}
        </Fragment>
      ))}
    </group>
  );
}

useGLTF.preload(PROTOCOL_URL, false, true);
