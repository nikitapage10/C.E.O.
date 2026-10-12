import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { Block } from "../../rooms/primitives.tsx";
import { smooth } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

const LEG = 0.32;
const BOX: [number, number, number] = [0.56, 0.62, 0.46];

/**
 * A walking power unit: a battery box on two stubby legs. It waddles, honks (its top lamp blinks), opens the
 * hatch in its chest to work, crouches to nap, and hops on the spot to celebrate.
 */
export function PowerBox({ look, drive, phase }: BodyProps) {
  const whole = useRef<Group>(null);
  const box = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const hatch = useRef<Group>(null);
  const lampRef = useRef<Mesh>(null);
  const shell = useMemo(() => PBR.lacquer(look.shell, 0.55), [look.shell]);
  const trim = useMemo(() => PBR.lacquer(look.trim, 0.5), [look.trim]);
  const lamp = useMemo(() => new MeshStandardMaterial({ color: "#000000", emissive: look.accent, emissiveIntensity: 1.2, toneMapped: false }), [look.accent]);
  const crouch = useRef(0);

  useFrame(() => {
    const d = drive.current;
    if (!d || !whole.current || !box.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const s = t * 7 + phase;
    crouch.current = smooth(crouch.current, mode === "napping" ? 1 : mode === "slumped" ? 0.5 : 0, 0.08);
    // Waddle: side-to-side roll, a bob on each step; a hop when celebrating.
    box.current.rotation.z = walking ? Math.sin(s) * 0.12 : mode === "staring" ? Math.sin(t * 0.8) * 0.03 : 0;
    box.current.rotation.x = mode === "slumped" ? 0.18 : 0;
    const hop = mode === "celebrating" ? Math.abs(Math.sin(t * 6)) * 0.18 : 0;
    box.current.position.y = LEG * (1 - crouch.current * 0.85) + BOX[1] / 2 + (walking ? Math.abs(Math.cos(s)) * 0.035 : 0) + hop;
    legs.current.forEach((g, i) => {
      if (!g) return;
      const sign = i === 0 ? 1 : -1;
      g.rotation.x = smooth(g.rotation.x, walking ? Math.sin(s) * 0.5 * sign : 0, 0.3);
      g.scale.y = smooth(g.scale.y, 1 - crouch.current * 0.85, 0.2);
      g.position.y = hop;
    });
    if (hatch.current) {
      const open = mode === "working" || mode === "typing" ? 1.2 + Math.sin(t * 4) * 0.05 : 0;
      hatch.current.rotation.x = smooth(hatch.current.rotation.x, open, 0.12);
    }
    // The lamp blinks with every honk (speaking), glows steady otherwise, and dims to a slow pulse asleep.
    lamp.emissiveIntensity = d.speaking ? (Math.sin(t * 22) > 0 ? 4 : 0.6) : mode === "napping" ? 0.3 + Math.sin(t * 1.5) * 0.25 : 1.4;
    if (lampRef.current) lampRef.current.scale.y = d.speaking ? 1 + Math.abs(Math.sin(t * 22)) * 0.3 : 1;
  });

  return (
    <group ref={whole}>
      {[-0.15, 0.15].map((x, i) => (
        <group key={x} ref={(g) => void (legs.current[i] = g)} position={[x, 0, 0]}>
          {/* Hip at the top, so the leg swings from under the box. */}
          <group position={[0, LEG, 0]}>
            <mesh position={[0, -LEG / 2, 0]} material={trim} castShadow>
              <cylinderGeometry args={[0.05, 0.06, LEG, 12]} />
            </mesh>
            <Block size={[0.14, 0.05, 0.2]} position={[0, -LEG + 0.025, 0.03]} material={trim} radius={0.02} />
          </group>
        </group>
      ))}
      <group ref={box}>
        <Block size={BOX} material={shell} radius={0.05} />
        {/* Ribbed sides and a band of trim. */}
        {[-0.12, 0, 0.12].map((y) => (
          <Block key={y} size={[BOX[0] + 0.02, 0.025, BOX[2] + 0.02]} position={[0, y, 0]} material={trim} radius={0.01} />
        ))}
        {/* Front panel: indicator lights and the hatch where every spare part lives. */}
        <Block size={[0.36, 0.2, 0.02]} position={[0, 0.17, BOX[2] / 2 + 0.006]} material={PBR.blackMetal()} radius={0.01} />
        {[-0.1, 0, 0.1].map((x, i) => (
          <mesh key={x} position={[x, 0.17, BOX[2] / 2 + 0.018]} material={PBR.light(i === 1 ? look.accent : "#9fe3c9", 2)}>
            <circleGeometry args={[0.022, 12]} />
          </mesh>
        ))}
        <group ref={hatch} position={[0, -0.04, BOX[2] / 2 + 0.01]}>
          <Block size={[0.3, 0.2, 0.02]} position={[0, -0.1, 0]} material={trim} radius={0.01} />
        </group>
        {/* The lamp on top, and a stubby vent. */}
        <mesh ref={lampRef} position={[0.12, BOX[1] / 2 + 0.05, 0.05]} material={lamp}>
          <cylinderGeometry args={[0.045, 0.05, 0.08, 16]} />
        </mesh>
        <mesh position={[-0.14, BOX[1] / 2 + 0.03, -0.08]} material={PBR.steel()}>
          <cylinderGeometry args={[0.03, 0.03, 0.06, 10]} />
        </mesh>
      </group>
    </group>
  );
}
