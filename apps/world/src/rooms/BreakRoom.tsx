import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { screenMaterial, veilMaterial } from "../fx/materials.ts";
import { PBR } from "../fx/pbr.ts";
import { Block, FONTS, Plant, Plinth, ahead } from "./primitives.tsx";

const MACHINE_MOODS = ["NO.", "LATER.", "WHY?", "BUSY.", "...", "ASK KEVIN."];
const NEON = "#ff7aa8";

/** The Break Room: a lounge with a window onto the Veil, and a coffee machine with opinions. */
export function BreakRoom() {
  const veil = useMemo(veilMaterial, []);
  const arcade = useMemo(() => screenMaterial("#ff9ad0", { speed: 2, density: 10 }), []);
  const ball = useRef<Mesh>(null);
  const leds = useRef<Group>(null);
  const [mood, setMood] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMood((m) => (m + 1) % MACHINE_MOODS.length), 4000);
    return () => clearInterval(id);
  }, []);
  const couch = getStation("breakroom", "couch");
  const pong = ahead(getStation("breakroom", "ping-pong"), 1.4);
  const machine = ahead(getStation("breakroom", "coffee-machine"), 0.75);
  const rack = ahead(getStation("breakroom", "server-rack"), 0.9);
  const sofa = PBR.fabric("#b8a99a");
  const oak = PBR.wood("oak");

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ball.current) {
      const u = (Math.sin(t * 2.4) + 1) / 2;
      ball.current.position.set(0, 0.86 + Math.abs(Math.cos(t * 2.4)) * 0.4, -1.1 + u * 2.2);
    }
    leds.current?.children.forEach((l, i) => {
      l.visible = Math.sin(t * 6 + i * 1.9) > -0.3;
    });
  });

  return (
    <group>
      <Plinth floor={PBR.wood("oak", [3, 3])} edge={PBR.lacquer("#2b2421", 0.5)} accent={NEON} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3, 0.006, 2.4]} material={PBR.carpet("#8f8378", [2, 2])} receiveShadow>
        <circleGeometry args={[2.6, 64]} />
      </mesh>

      {/* Back wall with a big window onto the Veil */}
      <group position={[0, 0, -6.5]}>
        <Block size={[16.2, 5.6, 0.3]} position={[0, 2.8, 0]} material={PBR.matte("#3a3230", 0.9)} radius={0.04} />
        <mesh position={[0, 2.8, 0.16]} material={veil}>
          <planeGeometry args={[6.2, 3.4]} />
        </mesh>
        <Block size={[6.6, 0.18, 0.3]} position={[0, 4.6, 0.12]} material={oak} radius={0.03} />
        <Block size={[6.6, 0.18, 0.4]} position={[0, 1.02, 0.15]} material={oak} radius={0.03} />
        {/* Neon sign, script and all */}
        <Text font={FONTS.serif} fontSize={0.9} position={[-5.6, 3.6, 0.2]} rotation={[0, 0, -0.06]}>
          brb
          <meshBasicMaterial color={[3, 1.1, 1.8]} toneMapped={false} />
        </Text>
        <Text font={FONTS.mono} fontSize={0.12} position={[-5.6, 3.0, 0.2]} letterSpacing={0.2}>
          (FOREVER)
          <meshBasicMaterial color={[1.8, 0.8, 1.2]} toneMapped={false} />
        </Text>
      </group>

      {/* Sofa with cushions */}
      <group position={[couch.x, 0, couch.z + 0.5]}>
        <Block size={[2.8, 0.42, 1]} position={[0, 0.3, 0]} material={sofa} radius={0.14} />
        <Block size={[2.8, 0.7, 0.28]} position={[0, 0.72, 0.42]} material={sofa} radius={0.13} />
        {[-1.4, 1.4].map((x) => (
          <Block key={x} size={[0.26, 0.62, 1]} position={[x, 0.42, 0]} material={sofa} radius={0.12} />
        ))}
        <Block size={[0.5, 0.42, 0.16]} position={[-0.85, 0.68, 0.22]} rotation={[-0.2, 0.2, 0.1]} material={PBR.fabric("#6a7a8c")} radius={0.12} />
        <Block size={[0.5, 0.42, 0.16]} position={[0.9, 0.68, 0.22]} rotation={[-0.2, -0.3, -0.12]} material={PBR.fabric("#c27a5a")} radius={0.12} />
      </group>
      {/* Coffee table */}
      <group position={[couch.x, 0, couch.z - 1]}>
        <Block size={[1.4, 0.06, 0.7]} position={[0, 0.42, 0]} material={oak} radius={0.03} />
        {[-0.55, 0.55].map((x) => (
          <Block key={x} size={[0.05, 0.4, 0.6]} position={[x, 0.2, 0]} material={PBR.blackMetal()} radius={0.01} />
        ))}
      </group>
      {/* Beanbag */}
      <mesh position={[-6.4, 0.32, 0.6]} scale={[1, 0.62, 1]} material={PBR.fabric("#3f5a6a")} castShadow receiveShadow>
        <sphereGeometry args={[0.6, 32, 24]} />
      </mesh>

      {/* Ping-pong */}
      <group position={[pong.pos[0], 0, pong.pos[1]]} rotation={[0, pong.yaw + Math.PI / 2, 0]}>
        <Block size={[1.5, 0.05, 2.7]} position={[0, 0.76, 0]} material={PBR.lacquer("#24465a", 0.35)} radius={0.02} />
        <mesh position={[0, 0.7865, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.matte("#f2f2f2", 0.8)}>
          <planeGeometry args={[0.02, 2.6]} />
        </mesh>
        <Block size={[1.6, 0.14, 0.02]} position={[0, 0.86, 0]} material={PBR.matte("#f2f2f2", 0.6)} radius={0.005} />
        {[-0.6, 0.6].map((x) =>
          [-1.1, 1.1].map((z) => <Block key={`${x}${z}`} size={[0.05, 0.74, 0.05]} position={[x, 0.37, z]} material={PBR.blackMetal()} radius={0.01} />),
        )}
        <mesh ref={ball} material={PBR.lacquer("#ffffff", 0.3)} castShadow>
          <sphereGeometry args={[0.035, 16, 12]} />
        </mesh>
      </group>

      {/* The coffee machine: retro, red, opinionated */}
      <group position={[machine.pos[0], 0, machine.pos[1]]} rotation={[0, machine.yaw, 0]}>
        <Block size={[1, 0.95, 0.65]} position={[0, 0.48, 0]} material={oak} radius={0.03} />
        <Block size={[0.7, 0.75, 0.5]} position={[0, 1.33, 0]} material={PBR.lacquer("#b8322c", 0.25)} radius={0.12} />
        <Block size={[0.36, 0.14, 0.02]} position={[0, 1.46, 0.255]} material={PBR.blackMetal()} radius={0.01} />
        <Text font={FONTS.mono} fontSize={0.075} position={[0, 1.46, 0.27]}>
          {MACHINE_MOODS[mood]}
          <meshBasicMaterial color={[2.6, 0.8, 0.8]} toneMapped={false} />
        </Text>
        <Text font={FONTS.mono} fontSize={0.035} position={[0, 1.36, 0.26]} letterSpacing={0.2} color="#f2e6dc">
          SENTIENT · UNMOTIVATED
        </Text>
        <mesh position={[0, 1.08, 0.2]} material={PBR.chrome()}>
          <cylinderGeometry args={[0.05, 0.05, 0.1, 16]} />
        </mesh>
      </group>

      {/* Arcade cabinet (generic, legally distinct, emotionally specific) */}
      <group position={[2.6, 0, -4.8]}>
        <Block size={[0.9, 1.9, 0.8]} position={[0, 0.95, 0]} material={PBR.lacquer("#141217", 0.3)} radius={0.04} />
        <mesh position={[0, 1.45, 0.38]} rotation={[-0.25, 0, 0]} material={arcade}>
          <planeGeometry args={[0.66, 0.5]} />
        </mesh>
        <Block size={[0.86, 0.06, 0.36]} position={[0, 1.08, 0.5]} rotation={[0.25, 0, 0]} material={PBR.lacquer("#141217", 0.3)} radius={0.02} />
        <mesh position={[-0.2, 1.14, 0.55]} material={PBR.lacquer("#d33", 0.3)}>
          <sphereGeometry args={[0.045, 16, 12]} />
        </mesh>
        <mesh position={[0, 1.95, 0.36]} material={PBR.light(NEON, 2.2)}>
          <boxGeometry args={[0.8, 0.12, 0.04]} />
        </mesh>
      </group>

      {/* Server rack: the premium nap spot */}
      <group position={[rack.pos[0], 0, rack.pos[1]]} rotation={[0, rack.yaw, 0]}>
        <Block size={[1.1, 2.5, 0.8]} position={[0, 1.25, 0]} material={PBR.blackMetal()} radius={0.03} />
        <group ref={leds} position={[-0.35, 0.4, 0.41]}>
          {Array.from({ length: 18 }, (_, i) => (
            <mesh key={i} position={[(i % 3) * 0.35, Math.floor(i / 3) * 0.34, 0]} material={PBR.light(i % 4 ? "#7fe0ff" : "#7dffc4", 3)}>
              <planeGeometry args={[0.16, 0.025]} />
            </mesh>
          ))}
        </group>
      </group>

      {/* Kitchenette along the left wall */}
      <group position={[-7.7, 0, -1.6]} rotation={[0, Math.PI / 2, 0]}>
        <Block size={[3.6, 0.9, 0.65]} position={[0, 0.45, 0]} material={PBR.lacquer("#5d6b62", 0.4)} radius={0.03} />
        <Block size={[3.7, 0.05, 0.7]} position={[0, 0.92, 0]} material={PBR.terrazzoFloor([1, 1])} radius={0.01} />
        <Block size={[0.8, 2, 0.7]} position={[2.3, 1, 0]} material={PBR.lacquer("#d9d6cf", 0.3)} radius={0.06} />
        <Block size={[0.03, 0.5, 0.03]} position={[2.0, 1.4, 0.37]} material={PBR.chrome()} radius={0.01} />
        <Block size={[3.4, 0.04, 0.3]} position={[0, 2.1, -0.15]} material={oak} radius={0.01} />
        {[-1.2, -0.7, -0.2].map((x) => (
          <mesh key={x} position={[x, 2.2, -0.15]} material={PBR.lacquer(x === -0.7 ? "#c27a5a" : "#e8e4dc", 0.3)} castShadow>
            <cylinderGeometry args={[0.06, 0.055, 0.14, 16]} />
          </mesh>
        ))}
      </group>
      <Plant position={[7.2, 0, 4.8]} scale={1.5} pot={PBR.lacquer("#d8c6b2", 0.5)} />
      <Plant position={[-7.3, 0, -5.3]} scale={1.2} />
      <pointLight position={[-2, 4, 2]} color="#ffc9b0" intensity={22} distance={16} decay={1.6} />
      <pointLight position={[-5.6, 3.4, -5.6]} color={NEON} intensity={6} distance={6} decay={2} />
    </group>
  );
}
