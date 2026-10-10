import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MeshPhysicalMaterial, SphereGeometry, Vector3, type Group, type Mesh } from "three";
import { knee, SEGMENT, span } from "../agents/bodies/limbs.ts";
import { PBR } from "../fx/pbr.ts";
import type { PetDrive } from "./types.ts";

/** One hemisphere: a squashed sphere folded with cheap sinusoidal sulci. */
function hemisphere() {
  const g = new SphereGeometry(0.15, 48, 36);
  const p = g.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 70 + Math.sin(v.y * 40) * 2) * Math.cos(v.z * 60 + Math.sin(v.x * 30) * 2);
    v.multiplyScalar(1 + n * 0.035);
    v.set(v.x * 0.55, v.y * 0.8, v.z * 1.25);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
const HEMI = hemisphere();
const brainMat = new MeshPhysicalMaterial({ color: "#d99aa0", roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.5, sheenColor: "#ffd6da" });
const legMat = new MeshPhysicalMaterial({ color: "#b07a7e", roughness: 0.45, clearcoat: 0.4 });

const LEGS = [
  { x: -0.08, z: 0.08, ox: -1, oz: 1 },
  { x: 0.08, z: 0.08, ox: 1, oz: 1 },
  { x: -0.08, z: -0.08, ox: -1, oz: -1 },
  { x: 0.08, z: -0.08, ox: 1, oz: -1 },
];
const hip = new Vector3();
const foot = new Vector3();
const kn = new Vector3();
const out = new Vector3();

/**
 * Gerald: a brain on four clawed legs, from the Archive's research collection. Skitters. Stops. Looks at
 * your head with what can only be described as longing.
 */
export function Brain({ drive }: { drive: React.RefObject<PetDrive> }) {
  const body = useRef<Group>(null);
  const uppers = useRef<(Mesh | null)[]>([]);
  const lowers = useRef<(Mesh | null)[]>([]);
  const claws = useRef<(Mesh | null)[]>([]);

  useFrame(() => {
    const d = drive.current;
    if (!d || !body.current) return;
    const { t, mode } = d;
    const walk = mode === "walk";
    const nap = mode === "nap";
    const s = t * 16;
    const y = nap ? 0.12 : 0.3 + (walk ? Math.abs(Math.sin(s)) * 0.02 : Math.sin(t * 2) * 0.008);
    body.current.position.y = y;
    // A thoughtful pulse.
    body.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.015);
    body.current.rotation.x = mode === "sit" ? -0.25 : 0;
    LEGS.forEach((L, i) => {
      const beat = s + (i === 0 || i === 3 ? 0 : Math.PI);
      hip.set(L.x, y - 0.05, L.z);
      foot.set(L.x + L.ox * 0.14, walk ? Math.max(0, Math.cos(beat)) * 0.06 : 0, L.z + L.oz * 0.14 + (walk ? Math.sin(beat) * 0.07 : 0));
      if (nap) foot.set(L.x + L.ox * 0.22, 0, L.z + L.oz * 0.2);
      out.set(L.ox, 2, L.oz);
      knee(hip, foot, 0.17, 0.2, out, kn);
      span(uppers.current[i]!, hip, kn, 0.016);
      span(lowers.current[i]!, kn, foot, 0.012);
      claws.current[i]?.position.copy(foot);
    });
  });

  return (
    <group>
      <group ref={body} position={[0, 0.3, 0]}>
        <mesh geometry={HEMI} material={brainMat} position={[-0.085, 0, 0]} castShadow receiveShadow />
        <mesh geometry={HEMI} material={brainMat} position={[0.085, 0, 0]} castShadow receiveShadow />
        {/* Brain stem, which is also, somehow, a tail. */}
        <mesh position={[0, -0.08, -0.15]} rotation={[0.9, 0, 0]} material={legMat} castShadow>
          <capsuleGeometry args={[0.03, 0.12, 6, 12]} />
        </mesh>
      </group>
      {LEGS.map((_, i) => (
        <group key={i}>
          <mesh ref={(m) => void (uppers.current[i] = m)} geometry={SEGMENT} material={legMat} castShadow />
          <mesh ref={(m) => void (lowers.current[i] = m)} geometry={SEGMENT} material={legMat} castShadow />
          <mesh ref={(m) => void (claws.current[i] = m)} material={PBR.lacquer("#3a2a2c", 0.3)}>
            <coneGeometry args={[0.015, 0.04, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
