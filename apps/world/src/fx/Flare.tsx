import { Billboard } from "@react-three/drei";
import { useMemo } from "react";
import { haloMaterial } from "./materials.ts";
import { PALETTE } from "../theme.ts";

/** A bright emitter: a soft halo plus an anamorphic streak, always facing the camera. */
export function Flare({
  position,
  color = PALETTE.ice,
  size = 2,
  streak = true,
  intensity = 1.4,
  pulse = 0,
}: {
  position?: [number, number, number];
  color?: string;
  size?: number;
  streak?: boolean;
  intensity?: number;
  pulse?: number;
}) {
  const halo = useMemo(() => haloMaterial(color, { intensity, pulse }), [color, intensity, pulse]);
  const line = useMemo(() => haloMaterial(color, { intensity: intensity * 0.9, streak: true, pulse }), [color, intensity, pulse]);
  return (
    <Billboard position={position}>
      <mesh material={halo} renderOrder={10}>
        <planeGeometry args={[size, size]} />
      </mesh>
      {streak && (
        <mesh material={line} renderOrder={10}>
          <planeGeometry args={[size * 7, size * 0.9]} />
        </mesh>
      )}
    </Billboard>
  );
}
