import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, Mesh, PointLight } from "three";
import { screenMaterial } from "../fx/materials.ts";
import { PBR } from "../fx/pbr.ts";
import { Club, show } from "./Club.tsx";
import { Block, FONTS, Plant, Plinth, ahead } from "./primitives.tsx";

const MACHINE_MOODS = ["NO.", "LATER.", "WHY?", "BUSY.", "...", "ASK KEVIN."];
const NEON = "#ff7aa8";
const BOTTLES = ["#2a6a4a", "#7a3a1a", "#c9a25c", "#3a4a8a", "#8a2a3a", "#e8e4dc", "#4a8a6a"];

/** The bar down the left wall: a long counter, stools, a back bar of lit bottles, and the coffee machine at the end. */
function Bar() {
  const machine = ahead(getStation("breakroom", "coffee-machine"), 0.75);
  const [mood, setMood] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMood((m) => (m + 1) % MACHINE_MOODS.length), 4000);
    return () => clearInterval(id);
  }, []);
  const walnut = PBR.wood("walnut");
  const brass = PBR.brass();
  const backlight = useMemo(() => PBR.light("#ffb36b", 1.4), []);
  return (
    <group>
      {/* Back wall of the bar, with a mirror and shelves of bottles. */}
      <Block size={[0.25, 3.6, 8]} position={[-8.05, 1.8, -2.4]} material={PBR.matte("#1c1618", 0.9)} radius={0.03} />
      <mesh position={[-7.9, 2.1, -1.4]} rotation={[0, Math.PI / 2, 0]} material={PBR.chrome()}>
        <planeGeometry args={[4.2, 1.1]} />
      </mesh>
      {[1.35, 2.8].map((y) => (
        <group key={y}>
          <Block size={[0.3, 0.04, 4.6]} position={[-7.78, y, -1.4]} material={walnut} radius={0.01} />
          <mesh position={[-7.9, y + 0.02, -1.4]} rotation={[0, Math.PI / 2, 0]} material={backlight}>
            <planeGeometry args={[4.6, 0.02]} />
          </mesh>
          {Array.from({ length: 16 }, (_, i) => (
            <mesh key={i} position={[-7.78, y + 0.17 + (i % 3) * 0.02, -3.5 + i * 0.28]} material={PBR.glass(BOTTLES[i % BOTTLES.length]!, 0.75)} castShadow>
              <cylinderGeometry args={[0.04, 0.045, 0.3 + (i % 3) * 0.05, 10]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* The counter: walnut front, brass foot rail, a lit edge. */}
      <group position={[-7.0, 0, -1.4]}>
        <Block size={[0.7, 1.05, 4.4]} position={[0, 0.525, 0]} material={walnut} radius={0.04} />
        <Block size={[0.85, 0.06, 4.55]} position={[0.05, 1.08, 0]} material={PBR.terrazzoFloor([1, 2])} radius={0.02} />
        <mesh position={[0.45, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]} material={brass}>
          <cylinderGeometry args={[0.025, 0.025, 4.3, 10]} />
        </mesh>
        <mesh position={[0.38, 1.0, 0]} rotation={[0, Math.PI / 2, 0]} material={PBR.light(NEON, 1.6)}>
          <planeGeometry args={[4.3, 0.02]} />
        </mesh>
        {/* Glasses and a cocktail shaker. */}
        {[-1.4, -1.25, 0.4, 1.6].map((z, i) => (
          <mesh key={z} position={[0.1, 1.15, z]} material={PBR.glass("#e8f0ff", 0.3)}>
            <cylinderGeometry args={[0.035, 0.03, 0.1 + (i % 2) * 0.05, 12]} />
          </mesh>
        ))}
        <mesh position={[0.05, 1.2, 0.9]} material={PBR.chrome()}>
          <cylinderGeometry args={[0.045, 0.05, 0.22, 14]} />
        </mesh>
      </group>
      {/* Stools. */}
      {[-3.0, -2.0, -1.0, 0.0].map((z) => (
        <group key={z} position={[-6.2, 0, z + 0.2]}>
          <mesh position={[0, 0.38, 0]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.025, 0.025, 0.76, 8]} />
          </mesh>
          <mesh position={[0, 0.78, 0]} material={PBR.lacquer("#5a1f2a", 0.4)} castShadow>
            <cylinderGeometry args={[0.2, 0.18, 0.08, 20]} />
          </mesh>
          <mesh position={[0, 0.02, 0]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.18, 0.2, 0.03, 20]} />
          </mesh>
        </group>
      ))}
      {/* The coffee machine holds court at the end of the bar: retro, red, opinionated. */}
      <group position={[machine.pos[0], 0, machine.pos[1]]} rotation={[0, machine.yaw, 0]}>
        <Block size={[1, 0.95, 0.65]} position={[0, 0.48, 0]} material={PBR.wood("oak")} radius={0.03} />
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
      {/* Neon over the bar. */}
      <Text font={FONTS.serif} fontSize={0.7} position={[-7.88, 3.3, -1.4]} rotation={[0, Math.PI / 2, -0.05]}>
        brb
        <meshBasicMaterial color={[3, 1.1, 1.8]} toneMapped={false} />
      </Text>
      <Text font={FONTS.mono} fontSize={0.11} position={[-7.88, 2.92, -1.4]} rotation={[0, Math.PI / 2, 0]} letterSpacing={0.2}>
        (FOREVER)
        <meshBasicMaterial color={[1.8, 0.8, 1.2]} toneMapped={false} />
      </Text>
      <pointLight position={[-6.6, 2.6, -1.4]} color="#ffb36b" intensity={5} distance={5} decay={2} />
    </group>
  );
}

/** The lounge at the front: a low velvet sofa, a coffee table with a candle, a beanbag. */
function Lounge() {
  const couch = getStation("breakroom", "couch");
  const velvet = PBR.fabric("#3a1f4a");
  return (
    <group position={[couch.x, 0, couch.z]}>
      {/* The agent sits facing the room (+z); the backrest is behind them. */}
      <group position={[0, 0, -0.45]}>
        <Block size={[2.8, 0.42, 1]} position={[0, 0.3, 0]} material={velvet} radius={0.14} />
        <Block size={[2.8, 0.7, 0.28]} position={[0, 0.72, -0.42]} material={velvet} radius={0.13} />
        {[-1.4, 1.4].map((x) => (
          <Block key={x} size={[0.26, 0.62, 1]} position={[x, 0.42, 0]} material={velvet} radius={0.12} />
        ))}
        <Block size={[0.5, 0.42, 0.16]} position={[-0.85, 0.68, -0.22]} rotation={[0.2, 0.2, 0.1]} material={PBR.fabric("#c27a5a")} radius={0.12} />
        <Block size={[0.5, 0.42, 0.16]} position={[0.9, 0.68, -0.22]} rotation={[0.2, -0.3, -0.12]} material={PBR.fabric("#6a7a8c")} radius={0.12} />
      </group>
      <group position={[0, 0, 1.1]}>
        <Block size={[1.4, 0.06, 0.7]} position={[0, 0.42, 0]} material={PBR.lacquer("#141217", 0.2)} radius={0.03} />
        {[-0.55, 0.55].map((x) => (
          <Block key={x} size={[0.05, 0.4, 0.6]} position={[x, 0.2, 0]} material={PBR.brass()} radius={0.01} />
        ))}
        <mesh position={[0.3, 0.52, 0]} material={PBR.glass("#ff7aa8", 0.5)}>
          <cylinderGeometry args={[0.05, 0.05, 0.12, 14]} />
        </mesh>
        <mesh position={[0.3, 0.6, 0]} material={PBR.light("#ffcf8a", 4)}>
          <sphereGeometry args={[0.018, 8, 8]} />
        </mesh>
      </group>
      <mesh position={[-2.1, 0.32, 0.5]} scale={[1, 0.62, 1]} material={PBR.fabric("#3f5a6a")} castShadow receiveShadow>
        <sphereGeometry args={[0.6, 32, 24]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.5]} material={PBR.carpet("#2a1f2a", [2, 2])} receiveShadow>
        <circleGeometry args={[2.3, 64]} />
      </mesh>
    </group>
  );
}

function PingPong() {
  const ball = useRef<Mesh>(null);
  const a = getStation("breakroom", "pong-a");
  const b = getStation("breakroom", "pong-b");
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ball.current) {
      const u = (Math.sin(t * 2.4) + 1) / 2;
      ball.current.position.set(-1.1 + u * 2.2, 0.86 + Math.abs(Math.cos(t * 2.4)) * 0.4, 0);
    }
  });
  return (
    <group position={[(a.x + b.x) / 2, 0, a.z]}>
      <Block size={[2.7, 0.05, 1.5]} position={[0, 0.76, 0]} material={PBR.lacquer("#24465a", 0.35)} radius={0.02} />
      <mesh position={[0, 0.7865, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.matte("#f2f2f2", 0.8)}>
        <planeGeometry args={[2.6, 0.02]} />
      </mesh>
      <Block size={[0.02, 0.14, 1.6]} position={[0, 0.86, 0]} material={PBR.matte("#f2f2f2", 0.6)} radius={0.005} />
      {[-1.1, 1.1].map((x) =>
        [-0.6, 0.6].map((z) => <Block key={`${x}${z}`} size={[0.05, 0.74, 0.05]} position={[x, 0.37, z]} material={PBR.blackMetal()} radius={0.01} />),
      )}
      <mesh ref={ball} material={PBR.lacquer("#ffffff", 0.3)} castShadow>
        <sphereGeometry args={[0.035, 16, 12]} />
      </mesh>
    </group>
  );
}

/** Along the right wall: the server rack (the premium nap spot) and two arcade cabinets. */
function RightWall() {
  const rack = ahead(getStation("breakroom", "server-rack"), 0.9);
  const leds = useRef<Group>(null);
  const arcades = useMemo(
    () => [
      { z: 1.0, screen: screenMaterial("#ff9ad0", { speed: 2, density: 10 }), glow: NEON },
      { z: 2.1, screen: screenMaterial("#7fd4ff", { speed: 1.4, density: 14, seed: 3 }), glow: "#7fd4ff" },
    ],
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    leds.current?.children.forEach((l, i) => {
      l.visible = Math.sin(t * 6 + i * 1.9) > -0.3;
    });
  });
  return (
    <group>
      <Block size={[0.25, 3.6, 5]} position={[8.05, 1.8, -0.3]} material={PBR.matte("#1c1618", 0.9)} radius={0.03} />
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
      {arcades.map(({ z, screen, glow }) => (
        <group key={z} position={[7.35, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
          <Block size={[0.9, 1.9, 0.8]} position={[0, 0.95, 0]} material={PBR.lacquer("#141217", 0.3)} radius={0.04} />
          <mesh position={[0, 1.45, 0.38]} rotation={[-0.25, 0, 0]} material={screen}>
            <planeGeometry args={[0.66, 0.5]} />
          </mesh>
          <Block size={[0.86, 0.06, 0.36]} position={[0, 1.08, 0.5]} rotation={[0.25, 0, 0]} material={PBR.lacquer("#141217", 0.3)} radius={0.02} />
          <mesh position={[-0.2, 1.14, 0.55]} material={PBR.lacquer("#d33", 0.3)}>
            <sphereGeometry args={[0.045, 16, 12]} />
          </mesh>
          <mesh position={[0, 1.95, 0.36]} material={PBR.light(glow, 2.2)}>
            <boxGeometry args={[0.8, 0.12, 0.04]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** House lights: warm and low, dimming further when the show starts. */
function HouseLights() {
  const warm = useRef<PointLight>(null);
  useFrame(() => {
    if (warm.current) warm.current.intensity = 16 - show.level * 11;
  });
  return <pointLight ref={warm} position={[-1, 4.2, 3]} color="#ffc9b0" intensity={16} distance={14} decay={1.6} />;
}

/** The Break Room: a club with a view of the city. A stage under the skyline, a bar, a lounge, and Kevin. */
export function BreakRoom() {
  const wall = PBR.matte("#1c1618", 0.9);
  return (
    <group>
      <Plinth floor={PBR.blackFloor([5, 4])} edge={PBR.lacquer("#1a1418", 0.5)} accent={NEON} />
      {/* Back wall around the skyline window. */}
      <group position={[0, 0, -6.55]}>
        <Block size={[1.5, 5.6, 0.3]} position={[-7.35, 2.8, 0]} material={wall} radius={0.04} />
        <Block size={[1.5, 5.6, 0.3]} position={[7.35, 2.8, 0]} material={wall} radius={0.04} />
        <Block size={[16.2, 0.55, 0.3]} position={[0, 5.33, 0]} material={wall} radius={0.04} />
        <Block size={[16.2, 0.45, 0.3]} position={[0, 0.22, 0]} material={wall} radius={0.04} />
      </group>
      <Club />
      <Bar />
      <Lounge />
      <PingPong />
      <RightWall />
      <Plant position={[7.2, 0, 5.4]} scale={1.5} pot={PBR.lacquer("#d8c6b2", 0.5)} />
      <Plant position={[-7.3, 0, 5.3]} scale={1.2} />
      <HouseLights />
    </group>
  );
}
