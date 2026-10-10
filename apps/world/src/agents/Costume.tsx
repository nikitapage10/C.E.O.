import { PBR } from "../fx/pbr.ts";
import type { Costume } from "../store.ts";

/** Headgear for a campaign at the long table, sized for a head about 0.4 m across. Sits on the head's crown. */
export function CostumePiece({ kind, scale = 1 }: { kind: Costume; scale?: number }) {
  return <group scale={scale}>{PIECES[kind]()}</group>;
}

const PIECES: Record<Costume, () => React.ReactElement> = {
  // A tall, slightly crooked wizard's hat with a gold band and a star.
  "wizard-hat": () => (
    <group>
      <mesh position={[0, 0.01, 0]} material={PBR.fabric("#3b2a7a")} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.02, 32]} />
      </mesh>
      <mesh position={[0, 0.24, 0]} rotation={[0, 0, 0.12]} material={PBR.fabric("#3b2a7a")} castShadow>
        <coneGeometry args={[0.16, 0.48, 24]} />
      </mesh>
      <mesh position={[0, 0.05, 0]} material={PBR.brass()}>
        <cylinderGeometry args={[0.162, 0.162, 0.04, 24]} />
      </mesh>
      <mesh position={[0.06, 0.2, 0.11]} material={PBR.light("#ffd27a", 2)}>
        <octahedronGeometry args={[0.03, 0]} />
      </mesh>
    </group>
  ),
  // A knight's helm: steel dome, a nasal guard and a red plume.
  helm: () => (
    <group>
      <mesh position={[0, 0, 0]} material={PBR.steel()} castShadow>
        <sphereGeometry args={[0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, -0.02, 0.19]} material={PBR.steel()}>
        <boxGeometry args={[0.03, 0.12, 0.02]} />
      </mesh>
      <mesh position={[0, 0.24, -0.02]} rotation={[0.3, 0, 0]} material={PBR.fabric("#b8322c")} castShadow>
        <capsuleGeometry args={[0.03, 0.12, 4, 8]} />
      </mesh>
    </group>
  ),
  // A rogue's deep green cowl.
  hood: () => (
    <group>
      <mesh position={[0, 0.02, -0.02]} scale={[1, 1.15, 1.05]} material={PBR.fabric("#1f4a34")} castShadow>
        <sphereGeometry args={[0.22, 24, 14, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
      </mesh>
      <mesh position={[0, 0.2, -0.12]} rotation={[-0.7, 0, 0]} material={PBR.fabric("#1f4a34")}>
        <coneGeometry args={[0.08, 0.18, 12]} />
      </mesh>
    </group>
  ),
  // A bard's crown: a gold band with points and three stones.
  crown: () => (
    <group>
      <mesh position={[0, 0.04, 0]} material={PBR.brass()} castShadow>
        <cylinderGeometry args={[0.16, 0.15, 0.08, 24, 1, true]} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.155, 0.11, Math.cos(a) * 0.155]} material={PBR.brass()}>
            <coneGeometry args={[0.025, 0.07, 6]} />
          </mesh>
        );
      })}
      {["#c94a4a", "#4a7ac9", "#4ac98a"].map((c, i) => (
        <mesh key={c} position={[Math.sin((i - 1) * 0.6) * 0.16, 0.05, Math.cos((i - 1) * 0.6) * 0.16]} material={PBR.lacquer(c, 0.1)}>
          <sphereGeometry args={[0.018, 10, 8]} />
        </mesh>
      ))}
    </group>
  ),
  // A barbarian's horned cap.
  horns: () => (
    <group>
      <mesh material={PBR.copper()} castShadow>
        <sphereGeometry args={[0.19, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x * 0.2, 0.1, 0]} rotation={[0, 0, -x * 0.9]} material={PBR.matte("#efe6d4", 0.5)} castShadow>
          <coneGeometry args={[0.045, 0.22, 12]} />
        </mesh>
      ))}
    </group>
  ),
  // A ranger's cap with a long feather.
  "feather-cap": () => (
    <group>
      <mesh position={[0, 0.05, 0]} scale={[1, 0.7, 1.25]} material={PBR.fabric("#4a6a2a")} castShadow>
        <sphereGeometry args={[0.18, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 0.05, 0.16]} rotation={[-0.3, 0, 0]} scale={[1.1, 0.12, 0.6]} material={PBR.fabric("#4a6a2a")}>
        <sphereGeometry args={[0.15, 16, 8]} />
      </mesh>
      <mesh position={[0.12, 0.18, -0.05]} rotation={[0.2, 0, -0.6]} scale={[0.25, 1, 0.06]} material={PBR.lacquer("#d94a3a", 0.5)} castShadow>
        <sphereGeometry args={[0.15, 12, 8]} />
      </mesh>
    </group>
  ),
};
