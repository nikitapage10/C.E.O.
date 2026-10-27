import { useGLTF } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, Vector3, type Group, type Mesh, type Object3D } from "three";
import { modelUrl } from "../../fx/library.ts";
import { PBR } from "../../fx/pbr.ts";
import { Block } from "../../rooms/primitives.tsx";
import { astromechState, stepAstromech } from "./droidPose.ts";
import { fitScale } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

/** Built from its Meshy sculpt by scripts/build-droids.mjs (not a library model: vendor-models never touches it). */
export const ASTROMECH_URL = modelUrl("droids/astromech.glb");

const at = new Vector3();
const floor = new Vector3();
const scaled = new Vector3();

interface Parts {
  body: Object3D;
  dome: Object3D;
  eye: Object3D;
  lamp: Object3D;
  hatch: Object3D;
}

function partsOf(model: Object3D): Parts {
  const get = (name: string) => {
    const o = model.getObjectByName(name);
    if (!o) throw new Error(`astromech: no ${name}`);
    return o;
  };
  return { body: get("body"), dome: get("dome"), eye: get("eye"), lamp: get("lamp"), hatch: get("hatch") };
}

/**
 * Drop: an astromech on two legs and a third that folds down out of its belly. Worn as built (white and blue; the
 * look's accent lights its eye). droidPose.ts moves it: it rolls, leans back on its third leg, swings upright when
 * it stops, turns its dome, and flares its lights now and then.
 */
export function Astromech({ look, drive, phase }: BodyProps) {
  const gltf = useGLTF(ASTROMECH_URL, false, true);
  const model = useMemo(() => {
    const m = gltf.scene.clone(true);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const parts = useMemo(() => partsOf(model), [model]);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.astromech);
  const eyeMat = useMemo(() => new MeshStandardMaterial({ color: "#05070c", emissive: look.accent, emissiveIntensity: 1.4, roughness: 0.2, toneMapped: false }), [look.accent]);
  const lampMat = useMemo(() => new MeshStandardMaterial({ color: "#1a0606", emissive: "#ff4a5a", emissiveIntensity: 0.5, toneMapped: false }), []);
  const root = useRef<Group>(null);
  const leg = useRef<Group>(null);
  const strut = useRef<Mesh>(null);
  const foot = useRef<Group>(null);
  const st = useRef(astromechState());
  const clock = useRef(phase * 3);

  useFrame((_, dt) => {
    const d = drive.current;
    const g = root.current;
    if (!d || !g) return;
    clock.current += dt * (d.rate ?? 1);
    const p = stepAstromech(st.current, d.mode, clock.current, dt, phase, d.speaking);
    g.position.y = p.lift;
    g.rotation.z = p.roll;
    g.rotation.x = p.pitch;
    // The body leans back on the shoulder pins (its top toward -Z); the dome turns on top.
    parts.body.rotation.x = -p.tilt;
    parts.dome.rotation.y = p.dome;
    eyeMat.emissiveIntensity = p.eye;
    lampMat.emissiveIntensity = p.lamp;

    // The third leg hangs straight down from the hatch to the floor, however far the body leans, and slides out
    // of the hatch as it drops.
    const l = leg.current;
    if (l && strut.current && foot.current && g.parent) {
      l.visible = p.leg > 0.02;
      l.rotation.x = p.tilt;
      g.updateWorldMatrix(true, true);
      parts.hatch.getWorldPosition(at);
      g.parent.getWorldPosition(floor);
      const reach = Math.max(0.02, (at.y - floor.y) / parts.hatch.getWorldScale(scaled).y);
      const len = reach * p.leg;
      strut.current.scale.y = Math.max(0.001, len);
      strut.current.position.y = -len / 2;
      foot.current.position.y = -len;
    }
  });

  return (
    <group ref={root}>
      <group scale={scale}>
        <primitive object={model} />
        {/* The lights: the radar eye up front and the round lamp beside it. */}
        {createPortal(
          <mesh material={eyeMat} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.02, 20]} />
          </mesh>,
          parts.eye,
        )}
        {createPortal(
          <mesh material={lampMat}>
            <sphereGeometry args={[0.028, 14, 10]} />
          </mesh>,
          parts.lamp,
        )}
        {createPortal(
          <group ref={leg} visible={false}>
            <mesh ref={strut} material={PBR.lacquer("#eef0f3", 0.45)} castShadow>
              <cylinderGeometry args={[0.05, 0.06, 1, 14]} />
            </mesh>
            <group ref={foot}>
              <Block size={[0.15, 0.05, 0.2]} position={[0, 0.025, 0.02]} material={PBR.matte("#8e959e", 0.6)} radius={0.015} />
            </group>
          </group>,
          parts.hatch,
        )}
      </group>
    </group>
  );
}

useGLTF.preload(ASTROMECH_URL, false, true);
