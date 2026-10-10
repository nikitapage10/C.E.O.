import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { LatheGeometry, MeshPhysicalMaterial, Vector2, type Group, type Mesh } from "three";
import { PBR } from "../fx/pbr.ts";
import type { PetDrive } from "./types.ts";

/** The pod: a smooth, open-topped egg, like a pram designed by someone who'd never seen a pram. */
const POD = new LatheGeometry(
  [
    [0.0, -0.2], [0.12, -0.19], [0.22, -0.13], [0.27, -0.04], [0.28, 0.05], [0.26, 0.11], [0.245, 0.12], [0.255, 0.1], [0.265, 0.04],
  ].map(([x, y]) => new Vector2(x, y)),
  48,
);
POD.computeVertexNormals();

/**
 * The Foundling: small, green, enormously eared, about fifty, and riding a hovering pod that follows
 * whoever has snacks. Occasionally raises one hand, and something across the room moves.
 */
export function Foundling({ drive }: { drive: React.RefObject<PetDrive> }) {
  const pod = useRef<Group>(null);
  const head = useRef<Group>(null);
  const ears = useRef<(Mesh | null)[]>([]);
  const hand = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const skin = useMemo(() => new MeshPhysicalMaterial({ color: "#8aa86a", roughness: 0.6, sheen: 0.6, sheenColor: "#cfe0b0" }), []);
  const ear = useMemo(() => new MeshPhysicalMaterial({ color: "#9cb479", roughness: 0.55, sheen: 0.5, sheenColor: "#e8c9b8" }), []);

  useFrame(() => {
    const d = drive.current;
    if (!d || !pod.current || !head.current) return;
    const { t, mode } = d;
    const nap = mode === "nap";
    pod.current.position.y = 0.62 + Math.sin(t * 1.6) * 0.04 - (nap ? 0.25 : 0);
    pod.current.rotation.z = Math.sin(t * 1.1) * 0.04 + (mode === "walk" ? 0.03 : 0);
    pod.current.rotation.x = mode === "walk" ? 0.08 : 0;
    head.current.position.y = nap ? 0.04 : 0.15;
    head.current.rotation.z = Math.sin(t * 0.6) * 0.25;
    head.current.rotation.x = nap ? 0.5 : 0;
    ears.current.forEach((m, i) => {
      if (!m) return;
      const side = i === 0 ? -1 : 1;
      m.rotation.z = side * (Math.PI / 2 - 0.15 - (nap ? -0.3 : Math.sin(t * 0.8 + i) * 0.08));
    });
    // Every so often: the hand. Somewhere, a cookie levitates.
    const reach = mode === "groom" ? 1 : 0;
    if (hand.current) {
      hand.current.visible = reach > 0;
      hand.current.position.set(0.12, 0.12, 0.16);
    }
    if (glow.current) glow.current.scale.setScalar(1 + Math.sin(t * 1.6) * 0.08);
  });

  return (
    <group ref={pod} position={[0, 0.62, 0]}>
      <mesh geometry={POD} material={PBR.lacquer("#e9e4da", 0.25)} castShadow receiveShadow />
      <mesh position={[0, 0.115, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.fabric("#8a6a4a")}>
        <circleGeometry args={[0.25, 32]} />
      </mesh>
      {/* The hover glow underneath. */}
      <mesh ref={glow} position={[0, -0.21, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light("#bfe8ff", 1.6)}>
        <ringGeometry args={[0.04, 0.09, 24]} />
      </mesh>
      <group ref={head} position={[0, 0.15, 0.02]}>
        {/* Robe collar. */}
        <mesh position={[0, -0.07, 0]} material={PBR.fabric("#a88a62")}>
          <torusGeometry args={[0.08, 0.03, 10, 24]} />
        </mesh>
        <mesh scale={[1.05, 0.95, 1]} material={skin} castShadow>
          <sphereGeometry args={[0.1, 28, 20]} />
        </mesh>
        {[-1, 1].map((x, i) => (
          <mesh key={x} ref={(m) => void (ears.current[i] = m)} position={[x * 0.09, 0.02, -0.01]} scale={[0.5, 1, 0.22]} material={ear} castShadow>
            <coneGeometry args={[0.07, 0.24, 18]} />
          </mesh>
        ))}
        {[-1, 1].map((x) => (
          <group key={x} position={[x * 0.042, 0.015, 0.082]}>
            <mesh material={PBR.lacquer("#0b0a0a", 0.05)} scale={[1, 1, 0.7]}>
              <sphereGeometry args={[0.03, 18, 14]} />
            </mesh>
            <mesh position={[0.008, 0.01, 0.02]} material={PBR.light("#ffffff", 1)}>
              <sphereGeometry args={[0.006, 8, 6]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, -0.035, 0.09]} rotation={[0, 0, Math.PI]} material={PBR.matte("#5a6b46")}>
          <torusGeometry args={[0.012, 0.003, 6, 12, Math.PI]} />
        </mesh>
      </group>
      <group ref={hand} visible={false}>
        <mesh material={skin} rotation={[0.6, 0, -0.4]}>
          <capsuleGeometry args={[0.018, 0.08, 6, 10]} />
        </mesh>
      </group>
    </group>
  );
}
