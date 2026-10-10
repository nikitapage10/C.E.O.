import { RoundedBox } from "@react-three/drei";
import { useMemo, type ReactNode } from "react";
import type { Material } from "three";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { screenMaterial } from "../fx/materials.ts";
import { PALETTE } from "../theme.ts";
import monoFont from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff?url";
import serifFont from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff?url";
import serifUpright from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-300-normal.woff?url";

export const FONTS = { mono: monoFont, serif: serifFont, serifUpright };

type V3 = [number, number, number];

export const ROOM_W = 16.6;
export const ROOM_D = 13.6;

/** Unit direction an agent at a station faces, in room-local xz. */
export function facingDir(facing: number): [number, number] {
  return [-Math.sin(facing), -Math.cos(facing)];
}

/** A point `dist` in front of a station, plus the yaw that makes a prop face back at the agent. */
export function ahead(st: { x: number; z: number; facing: number }, dist: number): { pos: [number, number]; yaw: number } {
  const [dx, dz] = facingDir(st.facing);
  return { pos: [st.x + dx * dist, st.z + dz * dist], yaw: Math.atan2(-dx, -dz) };
}

/** A beveled box that casts and receives shadows. The basic unit of everything solid. */
export function Block({
  size,
  position,
  rotation,
  material,
  radius = 0.03,
  shadows = true,
  children,
}: {
  size: V3;
  position?: V3;
  rotation?: V3;
  material: Material;
  radius?: number;
  shadows?: boolean;
  children?: ReactNode;
}) {
  return (
    <RoundedBox
      args={size}
      radius={Math.max(0.001, Math.min(radius, Math.min(...size) / 2 - 0.001))}
      smoothness={3}
      position={position}
      rotation={rotation}
      material={material}
      castShadow={shadows}
      receiveShadow={shadows}
    >
      {children}
    </RoundedBox>
  );
}

/**
 * The room's floor slab: a thick beveled plinth with the room's own floor finish on top and
 * a single hairline of light tucked under its lip. No grids, no glowing outlines.
 */
export function Plinth({ floor, edge, accent }: { floor: Material; edge?: Material; accent: string }) {
  return (
    <group>
      <Block size={[ROOM_W, 0.7, ROOM_D]} position={[0, -0.36, 0]} material={edge ?? PBR.blackMetal()} radius={0.12} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={floor} receiveShadow>
        <planeGeometry args={[ROOM_W - 0.3, ROOM_D - 0.3]} />
      </mesh>
      <mesh position={[0, -0.74, 0]} material={PBR.light(accent, 2.2)}>
        <boxGeometry args={[ROOM_W - 0.6, 0.02, ROOM_D - 0.6]} />
      </mesh>
    </group>
  );
}

/** A solid wall segment along local x. */
export function Wall({
  length,
  height,
  position,
  rotation = 0,
  material,
  thickness = 0.25,
}: {
  length: number;
  height: number;
  position: V3;
  rotation?: number;
  material: Material;
  thickness?: number;
}) {
  return (
    <Block
      size={[length, height, thickness]}
      position={[position[0], position[1] + height / 2, position[2]]}
      rotation={[0, rotation, 0]}
      material={material}
      radius={0.04}
    />
  );
}

/** A curtain wall: mullions and glass panes. */
export function GlassWall({
  length,
  height,
  position,
  rotation = 0,
  panes = 6,
  frame,
}: {
  length: number;
  height: number;
  position: V3;
  rotation?: number;
  panes?: number;
  frame?: Material;
}) {
  const f = frame ?? PBR.blackMetal();
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, height / 2, 0]} material={PBR.glass()}>
        <boxGeometry args={[length, height, 0.04]} />
      </mesh>
      {Array.from({ length: panes + 1 }, (_, i) => (
        <Block key={i} size={[0.08, height, 0.12]} position={[-length / 2 + (i * length) / panes, height / 2, 0]} material={f} radius={0.01} />
      ))}
      <Block size={[length, 0.1, 0.14]} position={[0, height, 0]} material={f} radius={0.01} />
      <Block size={[length, 0.1, 0.14]} position={[0, 0.05, 0]} material={f} radius={0.01} />
    </group>
  );
}

/** A slim line of real light (a strip LED, a lamp tube). */
export function LightBar({
  length,
  position,
  rotation,
  color = PALETTE.silver,
  intensity = 3,
  thickness = 0.035,
}: {
  length: number;
  position: V3;
  rotation?: V3;
  color?: string;
  intensity?: number;
  thickness?: number;
}) {
  return (
    <mesh position={position} rotation={rotation} material={PBR.light(color, intensity)}>
      <boxGeometry args={[length, thickness, thickness]} />
    </mesh>
  );
}

/** A thin-bezel monitor on a stand, with a live screen. */
export function Monitor({
  position,
  rotation = 0,
  size = [1.1, 0.62],
  color = PALETTE.ice,
  seed,
}: {
  position: V3;
  rotation?: number;
  size?: [number, number];
  color?: string;
  seed?: number;
}) {
  const screen = useMemo(() => screenMaterial(color, { seed, speed: 0.8 }), [color, seed]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block size={[size[0] + 0.05, size[1] + 0.05, 0.04]} position={[0, 0, -0.025]} material={PBR.blackMetal()} radius={0.012} />
      <mesh material={screen}>
        <planeGeometry args={size} />
      </mesh>
      <Block size={[0.05, 0.36, 0.05]} position={[0, -size[1] / 2 - 0.16, -0.06]} material={PBR.aluminium()} radius={0.01} />
      <Block size={[0.3, 0.02, 0.2]} position={[0, -size[1] / 2 - 0.34, -0.04]} material={PBR.aluminium()} radius={0.008} />
    </group>
  );
}

/** A desk, finished per room. */
export function Desk({
  position,
  rotation = 0,
  w = 1.8,
  d = 0.8,
  top,
  legs,
}: {
  position: V3;
  rotation?: number;
  w?: number;
  d?: number;
  top: Material;
  legs?: Material;
}) {
  const l = legs ?? PBR.aluminium();
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block size={[w, 0.05, d]} position={[0, 0.76, 0]} material={top} radius={0.02} />
      {[-1, 1].map((s) => (
        <Block key={s} size={[0.05, 0.74, d * 0.85]} position={[s * (w / 2 - 0.12), 0.37, 0]} material={l} radius={0.015} />
      ))}
    </group>
  );
}

/** Desk + monitors, oriented so an agent standing at `stand` facing `facing` is at the keyboard. */
export function Workstation({
  stand,
  facing,
  top,
  color,
  seed,
  monitors = 1,
  chair = true,
  desk,
  seat,
}: {
  stand: [number, number];
  facing: number;
  top: Material;
  color?: string;
  seed?: number;
  monitors?: number;
  chair?: boolean;
  /** A model to use instead of the plain desk; its top should sit at 0.78. */
  desk?: ReactNode;
  /** A model to use instead of the office chair, placed where the chair goes. */
  seat?: ReactNode;
}) {
  const [dx, dz] = facingDir(facing);
  const yaw = Math.atan2(dx, dz);
  return (
    <group position={[stand[0] + dx * 0.8, 0, stand[1] + dz * 0.8]} rotation={[0, yaw, 0]}>
      {desk ?? <Desk position={[0, 0, 0]} top={top} />}
      {Array.from({ length: monitors }, (_, i) => {
        const off = (i - (monitors - 1) / 2) * 0.82;
        return <Monitor key={i} position={[off, 1.22, 0.2]} rotation={Math.PI - off * 0.35} color={color} seed={(seed ?? 0) + i} size={[0.78, 0.46]} />;
      })}
      <Block size={[0.5, 0.02, 0.16]} position={[0, 0.8, -0.12]} material={PBR.blackMetal()} radius={0.008} />
      {chair && (seat ? <group position={[0.9, 0, -0.9]} rotation={[0, 0.5, 0]}>{seat}</group> : <Chair position={[0.9, 0, -0.9]} rotation={0.5} />)}
    </group>
  );
}

/** A potted plant: matte pot, a leafy library plant growing out of it. */
export function Plant({ position, scale = 1, pot }: { position: V3; scale?: number; pot?: Material }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]} material={pot ?? PBR.matte("#d8d4cc")} castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.5, 24]} />
      </mesh>
      <Model id="nature/Plant_1_Big" fit={{ height: 0.75 }} position={[0, 0.44, 0]} rotation={position[0] + position[2]} cast />
    </group>
  );
}

/** An office chair: five-star base, seat, back. */
export function Chair({ position, rotation = 0, seat }: { position: V3; rotation?: number; seat?: Material }) {
  const s = seat ?? PBR.fabric("#2a2f38");
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block size={[0.5, 0.08, 0.5]} position={[0, 0.48, 0]} material={s} radius={0.035} />
      <Block size={[0.48, 0.55, 0.06]} position={[0, 0.82, -0.24]} rotation={[-0.08, 0, 0]} material={s} radius={0.025} />
      <mesh position={[0, 0.26, 0]} material={PBR.chrome()} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.44, 10]} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <Block
          key={i}
          size={[0.32, 0.03, 0.04]}
          position={[Math.cos((i / 5) * Math.PI * 2) * 0.16, 0.04, Math.sin((i / 5) * Math.PI * 2) * 0.16]}
          rotation={[0, -(i / 5) * Math.PI * 2, 0]}
          material={PBR.blackMetal()}
          radius={0.01}
        />
      ))}
    </group>
  );
}
