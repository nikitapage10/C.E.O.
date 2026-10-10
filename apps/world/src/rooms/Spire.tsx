import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { screenMaterial } from "../fx/materials.ts";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { PALETTE } from "../theme.ts";
import { Block, FONTS, GlassWall, LightBar, Plant, Plinth, Workstation, ahead } from "./primitives.tsx";

const MOODS = ["NO.", "LATER.", "DECAF?", "…"];

/** The Spire: a penthouse office in pale stone and glass, for the small-business agents. */
export function Spire() {
  const kpi = useMemo(() => screenMaterial(PALETTE.violet, { speed: 0.25, density: 6 }), []);
  const bars = useRef<Group>(null);
  const [mood, setMood] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMood((m) => (m + 1) % MOODS.length), 5000);
    return () => clearInterval(id);
  }, []);
  const desks = ["desk-1", "desk-2", "desk-3"].map((id) => getStation("spire", id));
  const wb = ahead(getStation("spire", "whiteboard"), 0.9);
  const coffee = ahead(getStation("spire", "coffee"), 0.75);
  const meeting = getStation("spire", "meeting");
  const oak = PBR.wood("oak");
  const white = PBR.lacquer("#eceae6", 0.4);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    bars.current?.children.forEach((b, i) => {
      b.scale.y = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.5 + i * 1.3));
    });
  });

  return (
    <group>
      <Plinth floor={PBR.terrazzoFloor([4, 3])} edge={PBR.aluminium()} accent={PALETTE.silver} />
      {/* Curtain wall at the back, solid plaster on the left with a long artwork */}
      <GlassWall length={16.2} height={6} position={[0, 0, -6.5]} panes={8} frame={PBR.aluminium()} />
      <group position={[-8.05, 0, -0.8]} rotation={[0, Math.PI / 2, 0]}>
        <Block size={[11.4, 6, 0.3]} position={[0, 3, 0]} material={PBR.matte("#e3e1dc", 0.9)} radius={0.04} />
        <Block size={[4.6, 1.8, 0.04]} position={[0, 3.2, 0.18]} material={PBR.lacquer("#1f2a3a", 0.25)} radius={0.01} />
        <Block size={[1.4, 1.2, 0.03]} position={[-1, 3.4, 0.21]} material={PBR.lacquer("#c86f4b", 0.35)} radius={0.01} />
        <Block size={[0.8, 0.8, 0.03]} position={[1.2, 2.9, 0.21]} material={PBR.lacquer("#d9c9a4", 0.35)} radius={0.01} />
      </group>
      {/* Ceiling soffit with linear pendants */}
      <Block size={[9, 0.2, 5]} position={[-3.6, 6.1, -3.8]} material={PBR.matte("#f1f0ec", 0.9)} radius={0.04} />
      {[-3.6, -0.6].map((x) => (
        <group key={x} position={[x - 1.4, 3.4, -1.6]}>
          <mesh position={[0, 1.3, 0]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.006, 0.006, 2.6, 4]} />
          </mesh>
          <Block size={[2.4, 0.06, 0.12]} material={PBR.blackMetal()} radius={0.02} />
          <LightBar length={2.3} position={[0, -0.04, 0]} color="#fff3e2" intensity={4} thickness={0.03} />
        </group>
      ))}

      {desks.map((d, i) => (
        <Workstation
          key={d.id}
          stand={[d.x, d.z]}
          facing={d.facing}
          top={oak}
          color={PALETTE.ice}
          seed={10 + i}
          desk={<Model id="scifi-essentials/Prop_Desk_Small" fit={{ height: 0.78 }} rotation={Math.PI} cast />}
          seat={<Model id="scifi-essentials/Prop_Chair" fit={{ height: 1.15 }} cast />}
        />
      ))}

      {/* KPI board on an easel */}
      <group position={[wb.pos[0], 0, wb.pos[1]]} rotation={[0, wb.yaw, 0]}>
        <Block size={[2.7, 1.6, 0.05]} position={[0, 1.75, -0.03]} material={white} radius={0.02} />
        <mesh position={[0, 1.75, 0.0]} material={kpi}>
          <planeGeometry args={[2.5, 1.4]} />
        </mesh>
        <group ref={bars} position={[-0.95, 1.12, 0.02]}>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[i * 0.38, 0.5, 0]} material={PBR.light(i % 2 ? PALETTE.ice : PALETTE.violet, 1.6)}>
              <boxGeometry args={[0.16, 1, 0.01]} />
            </mesh>
          ))}
        </group>
        {[-1, 1].map((s) => (
          <Block key={s} size={[0.05, 1.9, 0.05]} position={[s * 1.1, 0.95, -0.15]} rotation={[0.12, 0, 0]} material={PBR.aluminium()} radius={0.01} />
        ))}
        <Text font={FONTS.mono} fontSize={0.11} position={[0, 2.62, 0.01]} letterSpacing={0.18} color="#2a2f38">
          Q4 SYNERGY (UP, PROBABLY)
        </Text>
      </group>

      {/* Meeting pod: round glass table, four chairs */}
      <group position={[meeting.x, 0, meeting.z + 1.3]}>
        <mesh position={[0, 0.74, 0]} material={PBR.glass("#dfeefa", 0.35)}>
          <cylinderGeometry args={[0.9, 0.9, 0.04, 48]} />
        </mesh>
        <mesh position={[0, 0.37, 0]} material={PBR.chrome()} castShadow>
          <cylinderGeometry args={[0.05, 0.25, 0.74, 24]} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <Model key={i} id="scifi-essentials/Prop_Chair" fit={{ height: 1.15 }} position={[Math.sin(i * 1.57 + 0.6) * 1.3, 0, Math.cos(i * 1.57 + 0.6) * 1.3]} rotation={i * 1.57 + 0.6 + Math.PI} cast />
        ))}
      </group>

      {/* Espresso machine: sentient, unmotivated */}
      <group position={[coffee.pos[0], 0, coffee.pos[1]]} rotation={[0, coffee.yaw, 0]}>
        <Block size={[1, 0.9, 0.6]} position={[0, 0.45, 0]} material={oak} radius={0.03} />
        <Block size={[0.6, 0.55, 0.45]} position={[0, 1.18, 0]} material={PBR.chrome()} radius={0.06} />
        <Block size={[0.3, 0.12, 0.02]} position={[0, 1.3, 0.235]} material={PBR.blackMetal()} radius={0.01} />
        <Model id="scifi-essentials/Prop_Mug" fit={{ height: 0.11 }} position={[-0.32, 0.9, 0.12]} rotation={0.8} />
        <Model id="scifi-essentials/Prop_Mug" fit={{ height: 0.11 }} position={[0.34, 0.9, 0.05]} rotation={2.2} />
        <Text font={FONTS.mono} fontSize={0.07} position={[0, 1.3, 0.25]}>
          {MOODS[mood]}
          <meshBasicMaterial color={[2.2, 0.7, 0.9]} toneMapped={false} />
        </Text>
      </group>

      {/* Lounge: a low sofa on a wool rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-4, 0.006, 3.6]} material={PBR.carpet("#8e8a84", [2, 2])} receiveShadow>
        <planeGeometry args={[5, 2.6]} />
      </mesh>
      <group position={[-4, 0, 4.3]}>
        <Block size={[2.8, 0.36, 0.9]} position={[0, 0.26, 0]} material={PBR.fabric("#3b414b")} radius={0.12} />
        <Block size={[2.8, 0.5, 0.22]} position={[0, 0.6, 0.36]} material={PBR.fabric("#3b414b")} radius={0.1} />
        <Block size={[1.1, 0.05, 0.6]} position={[0, 0.38, -1.05]} material={oak} radius={0.02} />
        <Block size={[0.9, 0.34, 0.5]} position={[0, 0.17, -1.05]} material={PBR.blackMetal()} radius={0.02} />
      </group>
      <Plant position={[-7.2, 0, 4.8]} scale={1.6} />
      <Plant position={[6.8, 0, -5.4]} scale={1.3} />
      <Plant position={[-7.2, 0, -5.4]} scale={1.1} pot={PBR.lacquer("#2b2f36", 0.4)} />
      <pointLight position={[0, 5, 1]} color="#f4f1ea" intensity={26} distance={18} decay={1.6} />
    </group>
  );
}
