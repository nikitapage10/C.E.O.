import { getStation } from "@ceo/core";
import { Text } from "../fx/Text.tsx";
import { useMemo } from "react";
import { MeshStandardMaterial } from "three";
import { PBR } from "../fx/pbr.ts";
import { Block, FONTS } from "../rooms/primitives.tsx";
import { ACHIEVEMENTS, useAchievements } from "./achievements.ts";

const COLS = 5;
const W = 1.9;
const H = 2.05;
const D = 0.45;

/** One small cup: a foot, a stem and a bowl. */
function Cup({ lit, x, y }: { lit: boolean; x: number; y: number }) {
  const metal = lit ? PBR.brass() : DIM;
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0.015, 0]} material={metal}>
        <cylinderGeometry args={[0.05, 0.06, 0.03, 12]} />
      </mesh>
      <mesh position={[0, 0.07, 0]} material={metal}>
        <cylinderGeometry args={[0.012, 0.012, 0.08, 8]} />
      </mesh>
      <mesh position={[0, 0.15, 0]} material={metal}>
        <cylinderGeometry args={[0.07, 0.03, 0.1, 14, 1, true]} />
      </mesh>
      {lit && (
        <mesh position={[0, 0.2, 0]} material={GLINT}>
          <octahedronGeometry args={[0.018, 0]} />
        </mesh>
      )}
    </group>
  );
}

const DIM = new MeshStandardMaterial({ color: "#1d2230", metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.55 });
const GLINT = PBR.light("#ffe2a0", 2.5);

/**
 * The C.E.O.'s trophy case in the Archive: one cup per achievement, dark until you earn it. Beside it, the loot
 * box every achievement comes with. Nobody opens it. Myshka sits in it.
 */
export function TrophyCase() {
  const unlocked = useAchievements((s) => s.unlocked);
  const box = getStation("archive", "loot-box");
  const walnut = PBR.wood("walnut");
  const rows = Math.ceil(ACHIEVEMENTS.length / COLS);
  const cups = useMemo(
    () =>
      ACHIEVEMENTS.map((a, i) => ({
        id: a.id,
        x: -W / 2 + (W / COLS) * ((i % COLS) + 0.5),
        y: 0.42 + Math.floor(i / COLS) * 0.5,
      })),
    [],
  );
  const earned = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
  return (
    <group>
      <group position={[-7.5, 0, 0.7]} rotation={[0, Math.PI / 2 - 0.6, 0]}>
        {/* Carcass, shelves and a glass front. */}
        <Block size={[W + 0.1, H, 0.05]} position={[0, H / 2, -D / 2]} material={walnut} radius={0.01} />
        {[-1, 1].map((s) => (
          <Block key={s} size={[0.05, H, D]} position={[(s * (W + 0.05)) / 2, H / 2, 0]} material={walnut} radius={0.01} />
        ))}
        {Array.from({ length: rows + 1 }, (_, r) => (
          <Block key={r} size={[W, 0.04, D]} position={[0, 0.4 + r * 0.5, 0]} material={walnut} radius={0.01} shadows={false} />
        ))}
        <Block size={[W + 0.1, 0.4, D]} position={[0, 0.2, 0]} material={walnut} radius={0.02} />
        <Block size={[W + 0.14, 0.06, D + 0.04]} position={[0, H, 0]} material={walnut} radius={0.02} />
        {cups.map((c) => (
          <group key={c.id} position={[0, 0.02, 0.02]}>
            <Cup lit={!!unlocked[c.id]} x={c.x} y={c.y} />
          </group>
        ))}
        <mesh position={[0, H / 2 + 0.2, D / 2]} material={PBR.glass("#e8f0ff", 0.1)}>
          <planeGeometry args={[W, H - 0.4]} />
        </mesh>
        <Text font={FONTS.mono} fontSize={0.07} position={[0, 0.22, D / 2 + 0.01]} color="#c9a25c" anchorX="center">
          {`THE C.E.O. · ${earned} / ${ACHIEVEMENTS.length}`}
        </Text>
      </group>

      {/* The loot box: open, faintly glowing, entirely unopened in spirit. */}
      <group position={[box.x, 0, box.z]} rotation={[0, 0.3, 0]}>
        <Block size={[0.62, 0.05, 0.46]} position={[0, 0.025, 0]} material={walnut} radius={0.01} />
        {[-1, 1].map((s) => (
          <Block key={`x${s}`} size={[0.04, 0.26, 0.46]} position={[s * 0.29, 0.13, 0]} material={walnut} radius={0.01} />
        ))}
        {[-1, 1].map((s) => (
          <Block key={`z${s}`} size={[0.62, 0.26, 0.04]} position={[0, 0.13, s * 0.21]} material={walnut} radius={0.01} />
        ))}
        <mesh position={[0, 0.27, -0.21]} material={PBR.brass()}>
          <boxGeometry args={[0.64, 0.02, 0.05]} />
        </mesh>
        {/* The lid, thrown back. */}
        <group position={[0, 0.27, -0.23]} rotation={[-1.9, 0, 0]}>
          <Block size={[0.64, 0.04, 0.48]} position={[0, 0, 0.24]} material={walnut} radius={0.01} />
        </group>
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light("#ffd27a", 1.2)}>
          <planeGeometry args={[0.5, 0.36]} />
        </mesh>
      </group>
    </group>
  );
}
