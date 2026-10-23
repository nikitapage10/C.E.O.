import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { smooth } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

const LEG = 0.42;
const RINGS = [0.62, 0.8, 0.98, 1.16, 1.34];

/**
 * The copper coil (Arc, the Studio's editor): a tall copper column wound with rings, on three spindly legs, a glass
 * globe on top where the lightning lives, and two thin arms. It steps on its tripod, its rings turn while it works,
 * and the globe crackles brighter when it concentrates, speaks, or makes a copy.
 */
export function Coil({ look, drive, phase }: BodyProps) {
  const whole = useRef<Group>(null);
  const column = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const rings = useRef<Group>(null);
  const arms = useRef<(Group | null)[]>([]);
  const arc = useRef<Mesh>(null);
  const slump = useRef(0);
  const copper = useMemo(() => new MeshStandardMaterial({ color: look.shell, metalness: 1, roughness: 0.32 }), [look.shell]);
  const dark = useMemo(() => PBR.lacquer(look.trim, 0.45), [look.trim]);
  const spark = useMemo(() => new MeshStandardMaterial({ color: "#000000", emissive: look.accent, emissiveIntensity: 2, toneMapped: false }), [look.accent]);

  useFrame(() => {
    const d = drive.current;
    if (!d || !whole.current || !column.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const working = mode === "working" || mode === "typing";
    const s = t * 6 + phase;
    slump.current = smooth(slump.current, mode === "napping" ? 1 : mode === "slumped" ? 0.5 : 0, 0.06);
    column.current.position.y = LEG * (1 - slump.current * 0.45) + (walking ? Math.abs(Math.sin(s)) * 0.04 : 0);
    column.current.rotation.x = slump.current * 0.15;
    column.current.rotation.z = walking ? Math.sin(s) * 0.05 : mode === "celebrating" ? Math.sin(t * 5) * 0.08 : 0;
    legs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.x = smooth(g.rotation.x, walking ? Math.sin(s + (i * Math.PI * 2) / 3) * 0.4 : 0.32 - slump.current * 0.3, 0.25);
    });
    if (rings.current) rings.current.rotation.y += (working ? 0.06 : mode === "celebrating" ? 0.12 : 0.008) * (d.rate ?? 1);
    arms.current.forEach((g, i) => {
      if (!g) return;
      const side = i ? -1 : 1;
      g.rotation.x = smooth(g.rotation.x, working ? -1.2 + Math.sin(t * 9 + i) * 0.12 : d.speaking && i ? -1.4 : walking ? Math.sin(s) * 0.3 * side : 0, 0.2);
      g.rotation.z = smooth(g.rotation.z, mode === "celebrating" ? side * 2.4 : side * 0.18, 0.15);
    });
    // The globe: a slow glow at rest, a crackle while working or talking, a dim ember asleep.
    const crackle = working || d.speaking || mode === "celebrating";
    spark.emissiveIntensity = mode === "napping" ? 0.25 : crackle ? (Math.sin(t * 31) > 0.2 ? 4.5 : 1.2) : 1.4 + Math.sin(t * 2 + phase) * 0.4;
    if (arc.current) {
      arc.current.visible = crackle && Math.sin(t * 17 + phase) > -0.2;
      arc.current.rotation.y = t * 9;
    }
  });

  return (
    <group ref={whole}>
      <group ref={column}>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <group key={i} rotation={[0, a, 0]}>
              <group ref={(g) => void (legs.current[i] = g)} position={[0, 0, 0.08]}>
                <mesh position={[0, -LEG / 2, 0.06]} rotation={[0.3, 0, 0]} material={dark} castShadow>
                  <cylinderGeometry args={[0.025, 0.02, LEG + 0.05, 8]} />
                </mesh>
                <mesh position={[0, -LEG + 0.02, 0.13]} material={dark}>
                  <sphereGeometry args={[0.045, 8, 6]} />
                </mesh>
              </group>
            </group>
          );
        })}
        {/* The base drum and the copper column. */}
        <mesh position={[0, 0.06, 0]} material={dark} castShadow>
          <cylinderGeometry args={[0.2, 0.24, 0.14, 16]} />
        </mesh>
        <mesh position={[0, 0.62, 0]} material={copper} castShadow>
          <cylinderGeometry args={[0.1, 0.13, 1.0, 16]} />
        </mesh>
        <group ref={rings}>
          {RINGS.map((y, i) => (
            <mesh key={y} position={[0, y - LEG + 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} material={copper}>
              <torusGeometry args={[0.2 - i * 0.012, 0.028, 8, 22]} />
            </mesh>
          ))}
        </group>
        {/* Two thin arms from a collar near the top. */}
        {[0.2, -0.2].map((x, i) => (
          <group key={x} ref={(g) => void (arms.current[i] = g)} position={[x, 1.02, 0]}>
            <mesh position={[0, -0.18, 0]} material={dark}>
              <cylinderGeometry args={[0.02, 0.02, 0.36, 8]} />
            </mesh>
            <mesh position={[0, -0.37, 0]} material={copper}>
              <sphereGeometry args={[0.035, 8, 6]} />
            </mesh>
          </group>
        ))}
        {/* The glass globe on top, with the lightning inside. */}
        <mesh position={[0, 1.27, 0]} material={dark}>
          <cylinderGeometry args={[0.06, 0.12, 0.1, 14]} />
        </mesh>
        <mesh position={[0, 1.42, 0]} material={PBR.glass("#d8f2ff", 0.22)}>
          <sphereGeometry args={[0.15, 18, 14]} />
        </mesh>
        <mesh position={[0, 1.42, 0]} material={spark}>
          <sphereGeometry args={[0.05, 12, 10]} />
        </mesh>
        <mesh ref={arc} position={[0, 1.42, 0]} material={spark}>
          <torusGeometry args={[0.11, 0.006, 4, 10, Math.PI * 1.2]} />
        </mesh>
        {/* A small lens on the front: how it watches the take. */}
        <mesh position={[0, 1.12, 0.12]} rotation={[Math.PI / 2, 0, 0]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.045, 0.05, 0.06, 14]} />
        </mesh>
        <mesh position={[0, 1.12, 0.152]} material={spark}>
          <circleGeometry args={[0.025, 12]} />
        </mesh>
      </group>
    </group>
  );
}
