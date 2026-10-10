import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { emissive, glassMaterial } from "../fx/materials.ts";
import { PALETTE } from "../theme.ts";

const suit = glassMaterial({ base: "#05070c", rim: PALETTE.danger, rimIntensity: 1.6, opacity: 0.95, power: 1.8 });

/** Counsel.exe: the Lattice's entire legal department. Tiny, briefcase-wielding, permanently worried. */
export function CounselExe({ scale = 0.8 }: { scale?: number }) {
  const ref = useRef<Group>(null);
  const brief = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ref.current) ref.current.position.y = Math.abs(Math.sin(t * 8)) * 0.06;
    if (brief.current) brief.current.rotation.z = Math.sin(t * 8) * 0.25;
  });
  return (
    <group scale={scale}>
      <group ref={ref}>
        <mesh position={[0, 0.6, 0]} material={suit}>
          <capsuleGeometry args={[0.24, 0.5, 6, 14]} />
        </mesh>
        {/* Tie */}
        <mesh position={[0, 0.78, 0.23]} rotation={[0, 0, Math.PI / 4]} material={emissive(PALETTE.danger, 2)}>
          <boxGeometry args={[0.07, 0.07, 0.02]} />
        </mesh>
        <mesh position={[0, 0.6, 0.235]} material={emissive(PALETTE.danger, 2)}>
          <boxGeometry args={[0.06, 0.28, 0.02]} />
        </mesh>
        {/* Head with spectacles */}
        <mesh position={[0, 1.18, 0]} material={suit}>
          <octahedronGeometry args={[0.18, 0]} />
        </mesh>
        {[-0.07, 0.07].map((x) => (
          <mesh key={x} position={[x, 1.2, 0.13]} material={emissive(PALETTE.silver, 2.6)}>
            <torusGeometry args={[0.045, 0.01, 6, 16]} />
          </mesh>
        ))}
        {/* Briefcase */}
        <group ref={brief} position={[0.38, 0.5, 0.05]}>
          <mesh material={suit}>
            <boxGeometry args={[0.32, 0.24, 0.08]} />
          </mesh>
          <mesh position={[0, 0.15, 0]} material={emissive(PALETTE.amber, 1.6)}>
            <torusGeometry args={[0.05, 0.012, 6, 12, Math.PI]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** The same character for the HUD, as an SVG. */
export function CounselAvatar({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="#0b0f18" />
      <path d="M20 6 L27 13 L20 20 L13 13 Z" fill="none" stroke="#e8f1ff" strokeWidth="1.2" />
      <circle cx="17" cy="13" r="2.2" fill="none" stroke="#e8f1ff" strokeWidth="1" />
      <circle cx="23" cy="13" r="2.2" fill="none" stroke="#e8f1ff" strokeWidth="1" />
      <rect x="13" y="21" width="14" height="14" rx="6" fill="#05070c" stroke="#ff6b8b" strokeWidth="1" />
      <path d="M20 22 l2 2 -2 7 -2 -7z" fill="#ff6b8b" />
      <rect x="28" y="27" width="8" height="6" rx="1" fill="#05070c" stroke="#ffd08f" strokeWidth="1" />
    </svg>
  );
}
