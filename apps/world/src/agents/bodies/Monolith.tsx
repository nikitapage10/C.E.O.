import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { brushedMetal } from "../../fx/textures.ts";
import { Block } from "../../rooms/primitives.tsx";
import { smooth } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

const H = 1.74;
const W = 0.2;
const D = 0.3;
const GAP = 0.012;
const PIVOT = 0.95;
const xs = [-1.5, -0.5, 0.5, 1.5].map((k) => k * (W + GAP));

/**
 * Monolith Unit, humour setting 75%: four brushed-metal slabs on a shared hinge. It walks by swinging its
 * outer slabs against its inner ones, reaches by unfolding one, and celebrates by fanning out.
 */
export function Monolith({ look, drive, phase }: BodyProps) {
  const slabs = useRef<(Group | null)[]>([]);
  const whole = useRef<Group>(null);
  const screen = useRef<Mesh>(null);
  const tilt = useRef(0);
  const metal = useMemo(
    () => new MeshStandardMaterial({ color: look.shell, metalness: 0.95, roughness: 0.3, roughnessMap: brushedMetal([1, 3]), envMapIntensity: 1.2 }),
    [look.shell],
  );
  const edge = useMemo(() => PBR.lacquer(look.trim, 0.4), [look.trim]);
  const glow = useMemo(() => PBR.light(look.accent, 1.6), [look.accent]);

  useFrame(() => {
    const d = drive.current;
    if (!d || !whole.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const s = t * 5 + phase;
    tilt.current = smooth(tilt.current, mode === "napping" ? -Math.PI / 2 : mode === "slumped" ? 0.25 : 0, 0.06);
    whole.current.rotation.x = tilt.current;
    whole.current.position.y = mode === "napping" ? D / 2 + 0.02 : walking ? Math.abs(Math.sin(s)) * 0.06 : 0;
    whole.current.position.z = mode === "napping" ? -0.2 : 0;
    slabs.current.forEach((g, i) => {
      if (!g) return;
      const outer = i === 0 || i === 3;
      let rx = 0;
      let ry = 0;
      let rz = 0;
      if (walking) rx = (outer ? 1 : -1) * Math.sin(s) * 0.32;
      else if (mode === "celebrating") ry = Math.sin(t * 4 + i) * 0.9;
      else if ((mode === "typing" || mode === "working") && i === 3) {
        // The right slab unfolds into an arm and taps.
        rx = -1.1 + Math.sin(t * (mode === "typing" ? 10 : 3)) * 0.12;
      } else if (mode === "waiting" && i === 3) rz = 0.25 + Math.sin(t * 2) * 0.05;
      else rx = Math.sin(t * 0.7 + i + phase) * 0.015;
      g.rotation.x = smooth(g.rotation.x, rx, 0.2);
      g.rotation.y = smooth(g.rotation.y, ry, 0.15);
      g.rotation.z = smooth(g.rotation.z, rz, 0.2);
    });
    if (screen.current) screen.current.scale.y = d.speaking ? 0.6 + Math.abs(Math.sin(t * 18)) * 0.6 : 1;
  });

  return (
    <group ref={whole}>
      {xs.map((x, i) => (
        <group key={i} ref={(g) => void (slabs.current[i] = g)} position={[x, PIVOT, 0]}>
          <Block size={[W, H, D]} position={[0, H / 2 - PIVOT, 0]} material={metal} radius={0.012} />
          {/* Joint caps and the seam where the slabs meet. */}
          <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={edge}>
            <cylinderGeometry args={[0.03, 0.03, W + 0.004, 16]} />
          </mesh>
          {i === 1 && (
            <>
              <Block size={[W * 0.86, 0.2, 0.01]} position={[0, H - PIVOT - 0.28, D / 2 + 0.002]} material={PBR.blackMetal()} radius={0.006} />
              <mesh ref={screen} position={[0, H - PIVOT - 0.28, D / 2 + 0.009]} material={glow}>
                <planeGeometry args={[W * 0.6, 0.03]} />
              </mesh>
            </>
          )}
          {i === 2 && (
            <mesh position={[0, H - PIVOT - 0.22, D / 2 + 0.004]} material={edge}>
              <planeGeometry args={[W * 0.7, 0.012]} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
