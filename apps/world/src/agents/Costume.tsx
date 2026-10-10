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
  // ── The Hallowed Veil ──
  // A wide-brimmed witch's hat, bent at the tip, with a purple band.
  "witch-hat": () => (
    <group>
      <mesh position={[0, 0.01, 0]} material={PBR.fabric("#16121c")} castShadow>
        <cylinderGeometry args={[0.34, 0.34, 0.02, 32]} />
      </mesh>
      <mesh position={[0, 0.2, 0]} material={PBR.fabric("#16121c")} castShadow>
        <coneGeometry args={[0.15, 0.4, 24]} />
      </mesh>
      <mesh position={[0.05, 0.42, 0]} rotation={[0, 0, -0.9]} material={PBR.fabric("#16121c")}>
        <coneGeometry args={[0.05, 0.14, 12]} />
      </mesh>
      <mesh position={[0, 0.05, 0]} material={PBR.fabric("#6a2aa8")}>
        <cylinderGeometry args={[0.152, 0.152, 0.05, 24]} />
      </mesh>
    </group>
  ),
  // A small jack-o'-lantern worn like a hat, its grin lit from inside.
  pumpkin: () => (
    <group position={[0, 0.13, 0]}>
      <mesh scale={[1, 0.8, 1]} material={PBR.lacquer("#e8701e", 0.45)} castShadow>
        <sphereGeometry args={[0.17, 16, 12]} />
      </mesh>
      <mesh position={[0, 0.15, 0]} rotation={[0, 0, 0.2]} material={PBR.matte("#3d5a1e", 0.8)}>
        <cylinderGeometry args={[0.018, 0.026, 0.08, 8]} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x * 0.055, 0.03, 0.155]} rotation={[0, 0, Math.PI]} material={PBR.light("#ffb54a", 3)}>
          <coneGeometry args={[0.025, 0.04, 3]} />
        </mesh>
      ))}
      <mesh position={[0, -0.04, 0.158]} scale={[1, 0.35, 0.3]} material={PBR.light("#ffb54a", 3)}>
        <sphereGeometry args={[0.07, 12, 6]} />
      </mesh>
    </group>
  ),
  // Two little red horns on a band.
  "devil-horns": () => (
    <group>
      <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.matte("#1a1a1a", 0.6)}>
        <torusGeometry args={[0.15, 0.012, 6, 24, Math.PI]} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x * 0.1, 0.09, 0.03]} rotation={[0.1, 0, -x * 0.35]} material={PBR.lacquer("#c8221e", 0.25)} castShadow>
          <coneGeometry args={[0.035, 0.14, 12]} />
        </mesh>
      ))}
    </group>
  ),
  // Bat ears and folded wings on a headband.
  "bat-band": () => (
    <group>
      <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.matte("#1a1a1a", 0.6)}>
        <torusGeometry args={[0.15, 0.012, 6, 24, Math.PI]} />
      </mesh>
      {[-1, 1].map((x) => (
        <group key={x} position={[x * 0.11, 0.08, 0]} rotation={[0, 0, -x * 0.5]}>
          <mesh scale={[1, 1, 0.25]} material={PBR.matte("#241a2e", 0.7)} castShadow>
            <coneGeometry args={[0.06, 0.16, 3]} />
          </mesh>
          <mesh position={[x * 0.09, -0.02, -0.02]} rotation={[0, 0, -x * 0.9]} scale={[1.6, 0.6, 0.15]} material={PBR.matte("#241a2e", 0.7)}>
            <coneGeometry args={[0.06, 0.16, 3]} />
          </mesh>
        </group>
      ))}
    </group>
  ),
  // A bedsheet ghost hood with two eye holes.
  "ghost-sheet": () => (
    <group>
      <mesh position={[0, -0.04, 0]} scale={[1, 1.2, 1]} material={PBR.fabric("#f2f0ea")} castShadow>
        <sphereGeometry args={[0.23, 24, 14, 0, Math.PI * 2, 0, Math.PI / 1.6]} />
      </mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[x * 0.07, 0.02, 0.215]} scale={[1, 1.4, 0.4]} material={PBR.matte("#0b0b0b", 0.9)}>
          <sphereGeometry args={[0.032, 10, 8]} />
        </mesh>
      ))}
    </group>
  ),
};
