import { getStation, type RoomId } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ComponentType, type ReactNode } from "react";
import type { Group, Mesh } from "three";
import { kernelMaterial, screenMaterial } from "../fx/materials.ts";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { Block, FONTS, ahead } from "./primitives.tsx";

/**
 * Easter eggs: legally distinct nods to things the C.E.O. loves, layered over each room without changing it.
 * Each carries a small brass plaque, because Counsel.exe insists.
 */

type V3 = [number, number, number];

/** A small brass museum plaque on a post. */
function Plaque({ position, rotation = 0, children, width = 1.1 }: { position: V3; rotation?: number; children: ReactNode; width?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block size={[0.04, 0.85, 0.04]} position={[0, 0.42, 0]} material={PBR.blackMetal()} radius={0.01} />
      <Block size={[width, 0.26, 0.03]} position={[0, 0.92, 0]} rotation={[-0.35, 0, 0]} material={PBR.brass()} radius={0.01} />
      <Text font={FONTS.mono} fontSize={0.045} maxWidth={width - 0.08} textAlign="center" anchorX="center" anchorY="middle" position={[0, 0.93, 0.025]} rotation={[-0.35, 0, 0]} color="#2a2114" lineHeight={1.3}>
        {children}
      </Text>
    </group>
  );
}

// ── Foundry: a slab of rock-planet stone and a chord translator ───────────────────────────────
function FoundryEggs() {
  const stone = useMemo(() => PBR.matte("#4a4540", 0.95), []);
  const prisms = useMemo(
    () => Array.from({ length: 11 }, (_, i) => ({ x: (i % 4) * 0.42 + (Math.floor(i / 4) % 2) * 0.21, y: 0.4 + Math.floor(i / 4) * 0.72, h: 0.7 + (i % 3) * 0.12 })),
    [],
  );
  const notes = useRef<Group>(null);
  useFrame(({ clock }) => {
    notes.current?.children.forEach((n, i) => {
      const u = (clock.elapsedTime * 0.4 + i * 0.33) % 1;
      n.position.set(Math.sin(u * 6 + i) * 0.15, 1.5 + u * 1.2, 0);
      n.scale.setScalar(Math.sin(u * Math.PI) * 1 + 0.001);
    });
  });
  return (
    <group position={[-7.6, 0, 2.4]} rotation={[0, Math.PI / 2, 0]}>
      {prisms.map((p, i) => (
        <mesh key={i} position={[p.x - 0.7, p.y, -0.2]} rotation={[Math.PI / 2, 0, 0]} material={stone} castShadow>
          <cylinderGeometry args={[0.24, 0.24, p.h, 6]} />
        </mesh>
      ))}
      {/* The translator: speaker grille, a little screen, notes drifting up. */}
      <group position={[1.4, 0, 0.2]}>
        <Block size={[0.7, 1.1, 0.5]} position={[0, 0.55, 0]} material={PBR.lacquer("#2b2f36", 0.4)} radius={0.06} />
        <mesh position={[0, 0.72, 0.26]}>
          <planeGeometry args={[0.5, 0.26]} />
          <meshBasicMaterial color={[0.6, 1.4, 1.2]} toneMapped={false} />
        </mesh>
        <Text font={FONTS.mono} fontSize={0.05} position={[0, 0.72, 0.27]} color="#062018" maxWidth={0.46} textAlign="center">
          {"♪♫♩ → \"Fist my bump.\""}
        </Text>
        <group ref={notes}>
          {["♪", "♫", "♩"].map((n) => (
            <Text key={n} font={FONTS.mono} fontSize={0.16}>
              {n}
              <meshBasicMaterial color={[1.4, 2, 1.8]} toneMapped={false} />
            </Text>
          ))}
        </group>
      </group>
      <Plaque position={[0.2, 0, 0.9]}>{"STONE SAMPLE FROM A ROCKY PLANET · DO NOT LICK · PROPERTY OF A VERY SMALL ENGINEER"}</Plaque>
    </group>
  );
}

// ── Spire: a spinning top that never quite falls ──────────────────────────────────────────────
function SpireEggs() {
  const top = useRef<Group>(null);
  const desk = ahead(getStation("spire", "desk-2"), 0.8);
  useFrame(({ clock }) => {
    if (!top.current) return;
    const t = clock.elapsedTime;
    top.current.rotation.y = t * 22;
    // It wobbles toward falling… then doesn't.
    const wobble = 0.05 + Math.max(0, Math.sin(t * 0.35)) * 0.16;
    top.current.rotation.x = Math.sin(t * 22) * wobble;
    top.current.rotation.z = Math.cos(t * 22) * wobble;
  });
  return (
    <group position={[desk.pos[0] - 0.55, 0.79, desk.pos[1] + 0.05]}>
      <group ref={top}>
        <mesh position={[0, 0.05, 0]} rotation={[Math.PI, 0, 0]} material={PBR.chrome()} castShadow>
          <coneGeometry args={[0.05, 0.08, 24]} />
        </mesh>
        <mesh position={[0, 0.1, 0]} material={PBR.chrome()}>
          <cylinderGeometry args={[0.012, 0.012, 0.05, 10]} />
        </mesh>
      </group>
    </group>
  );
}

// ── Exchange: the card table, a bull, a holo-rare under glass ─────────────────────────────────
function ExchangeEggs() {
  const card = useRef<Mesh>(null);
  const holo = useMemo(() => screenMaterial("#ff9ad0", { speed: 0.6, density: 4 }), []);
  useFrame(({ clock }) => {
    if (card.current) card.current.rotation.y = Math.sin(clock.elapsedTime * 0.6) * 0.6;
  });
  const gold = PBR.brass();
  return (
    <group>
      {/* Card table on the pit's dais */}
      <group position={[0, 0.12, 0.4]}>
        <mesh position={[0, 0.66, 0]} material={PBR.felt("#14402c")} castShadow receiveShadow>
          <cylinderGeometry args={[1.05, 1.05, 0.05, 64]} />
        </mesh>
        <mesh position={[0, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.wood("walnut")}>
          <torusGeometry args={[1.07, 0.05, 10, 64]} />
        </mesh>
        <mesh position={[0, 0.32, 0]} material={PBR.blackMetal()} castShadow>
          <cylinderGeometry args={[0.1, 0.3, 0.64, 24]} />
        </mesh>
        {[
          [0.3, 0.1, "#d23a2e"],
          [-0.25, -0.2, "#efe9dc"],
          [0.05, 0.35, "#2b4fa8"],
        ].map(([x, z, c], i) => (
          <mesh key={i} position={[x as number, 0.72 + 0.03, z as number]} material={PBR.lacquer(c as string, 0.4)} castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.06 + i * 0.03, 20]} />
          </mesh>
        ))}
      </group>
      {/* A bull. Bronze. Charging, generically. */}
      <group position={[-6.6, 0, -4.4]} rotation={[0, 0.7, 0]}>
        <Block size={[0.75, 0.55, 1.6]} position={[0, 0.275, 0]} material={PBR.matte("#26262a", 0.6)} radius={0.04} />
        <Model id="animals/Bull" fit={{ length: 1.55 }} position={[0, 0.55, 0]} pose="Idle_Headlow" material={gold} cast />
      </group>
      <Plaque position={[-5.6, 0, -3.6]} rotation={0.4}>
        {"A BULL · MARKET · (NOT THAT BULL)"}
      </Plaque>
      {/* Holo-rare vitrine */}
      <group position={[6.7, 0, -4.6]}>
        <Block size={[0.7, 1, 0.7]} position={[0, 0.5, 0]} material={PBR.blackMetal()} radius={0.03} />
        <mesh position={[0, 1.4, 0]} material={PBR.glass("#e8f0ff", 0.12)}>
          <boxGeometry args={[0.62, 0.8, 0.62]} />
        </mesh>
        <mesh ref={card} position={[0, 1.4, 0]} material={holo}>
          <planeGeometry args={[0.32, 0.45]} />
        </mesh>
      </group>
      <Plaque position={[5.7, 0, -3.8]} rotation={-0.4}>
        {"HOLO RARE · 1ST EDITION · SHADOWLESS · PRICELESS (TO US)"}
      </Plaque>
    </group>
  );
}

// ── Green: blue-and-white Saturday energy, and a stone mountain cat ──────────────────────────
function GreenEggs() {
  const stone = PBR.matte("#b9b6ae", 0.9);
  const navy = PBR.matte("#1e3a6e", 0.8);
  return (
    <group>
      {/* Blue-and-white end-zone banners */}
      {[-1, 1].map((sd) => (
        <group key={sd} position={[sd * 6.4, 0, 0.5]} rotation={[0, sd * Math.PI / 2, 0]}>
          {[-1.4, 1.4].map((z) => (
            <mesh key={z} position={[z, 1.2, 0]} material={PBR.chrome()}>
              <cylinderGeometry args={[0.025, 0.025, 2.4, 8]} />
            </mesh>
          ))}
          <Block size={[2.8, 0.9, 0.03]} position={[0, 1.9, 0]} material={navy} radius={0.01} />
          <Block size={[2.8, 0.1, 0.035]} position={[0, 1.5, 0]} material={PBR.matte("#f2efe6", 0.8)} radius={0.01} />
          <Text font={FONTS.serifUpright} fontSize={0.36} position={[0, 1.95, 0.025]} color="#f2efe6" letterSpacing={0.3}>
            WE ARE
          </Text>
        </group>
      ))}
      {/* The shrine: a crouching mountain cat on a rock */}
      <group position={[6.3, 0, 2.6]} rotation={[0, -2.2, 0]}>
        <mesh position={[0, 0.3, 0]} material={PBR.matte("#8a857c", 0.95)} castShadow receiveShadow>
          <dodecahedronGeometry args={[0.62, 0]} />
        </mesh>
        <group position={[0, 0.82, 0]}>
          <mesh scale={[1.4, 0.7, 0.62]} material={stone} castShadow>
            <sphereGeometry args={[0.36, 24, 16]} />
          </mesh>
          <mesh position={[0.48, 0.18, 0]} material={stone} castShadow>
            <sphereGeometry args={[0.2, 20, 16]} />
          </mesh>
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[0.5, 0.36, sd * 0.1]} material={stone}>
              <coneGeometry args={[0.05, 0.1, 8]} />
            </mesh>
          ))}
          <mesh position={[0.65, 0.14, 0]} scale={[1, 0.7, 0.9]} material={stone}>
            <sphereGeometry args={[0.09, 14, 10]} />
          </mesh>
          {[-1, 1].map((sd) => (
            <Block key={sd} size={[0.34, 0.12, 0.1]} position={[0.32, -0.2, sd * 0.16]} material={stone} radius={0.04} />
          ))}
          <mesh position={[-0.6, -0.05, 0]} rotation={[0, 0, 0.9]} material={stone}>
            <capsuleGeometry args={[0.04, 0.5, 4, 8]} />
          </mesh>
        </group>
      </group>
      <Plaque position={[5.3, 0, 3.6]} rotation={-0.5}>
        {"SHRINE OF A MOUNTAIN CAT · ROAR RESPONSIBLY · WE ARE…"}
      </Plaque>
    </group>
  );
}

// ── Relay: a street guitar and sheet music ─────────────────────────────────────────────────────
function RelayEggs() {
  return (
    <group position={[-6.1, 0, -0.6]} rotation={[0, 0.9, 0]}>
      <group position={[0, 0.02, 0]} rotation={[0.28, 0, 0]}>
        <mesh position={[0, 0.32, 0]} scale={[1, 1, 0.35]} material={PBR.wood("oak")} castShadow>
          <sphereGeometry args={[0.24, 24, 16]} />
        </mesh>
        <mesh position={[0, 0.62, 0]} scale={[1, 1, 0.35]} material={PBR.wood("oak")} castShadow>
          <sphereGeometry args={[0.18, 24, 16]} />
        </mesh>
        <mesh position={[0, 0.48, 0.09]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.07, 20]} />
          <meshStandardMaterial color="#120c08" />
        </mesh>
        <Block size={[0.07, 0.62, 0.04]} position={[0, 1.06, 0]} material={PBR.wood("walnut")} radius={0.01} />
        <Block size={[0.1, 0.14, 0.04]} position={[0, 1.42, 0]} material={PBR.wood("walnut")} radius={0.01} />
      </group>
      <group position={[0.75, 0, 0.1]}>
        <mesh position={[0, 0.55, 0]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.012, 0.012, 1.1, 6]} />
        </mesh>
        <Block size={[0.42, 0.3, 0.02]} position={[0, 1.15, 0]} rotation={[-0.4, 0, 0]} material={PBR.matte("#efe8d8", 0.9)} radius={0.005} />
        <Text font={FONTS.serif} fontSize={0.045} position={[0, 1.16, 0.02]} rotation={[-0.4, 0, 0]} color="#2a2114" maxWidth={0.38} textAlign="center">
          {"Tapped in G. Played with the palms. With feeling."}
        </Text>
      </group>
      <Plaque position={[0.3, 0, 0.75]}>{"A STREET GUITAR · LEFT BY A PRODIGY · STILL IN TUNE"}</Plaque>
    </group>
  );
}

// ── Archive: half arcane library, half research lab ────────────────────────────────────────────
function ArchiveEggs() {
  const candles = useRef<Group>(null);
  const orb = useMemo(() => kernelMaterial(0.8), []);
  const holo = useMemo(() => screenMaterial("#b9a6ff", { speed: 0.4, density: 12 }), []);
  const rune = useRef<Mesh>(null);
  const spots = useMemo(() => Array.from({ length: 10 }, (_, i) => ({ x: -2 + (i % 5) * 1.3 + Math.sin(i) * 0.3, z: -0.4 + Math.floor(i / 5) * 1.6, y: 3 + (i % 3) * 0.3, p: i * 0.7 })), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    candles.current?.children.forEach((c, i) => {
      c.position.y = spots[i]!.y + Math.sin(t * 0.8 + spots[i]!.p) * 0.08;
    });
    if (rune.current) rune.current.rotation.z = t * 0.08;
  });
  return (
    <group>
      {/* Floating candles over the reading floor */}
      <group ref={candles}>
        {spots.map((s, i) => (
          <group key={i} position={[s.x, s.y, s.z]}>
            <Model id={i % 2 ? "fantasy-props/Candle_1" : "fantasy-props/Candle_2"} fit={{ scale: 1.2 }} position={[0, -0.12, 0]} rotation={i} />
            <mesh position={[0, (i % 2 ? 0.05 : 0.2), 0]} material={PBR.light("#ffcf8a", 4)}>
              <sphereGeometry args={[0.025, 10, 8]} />
            </mesh>
          </group>
        ))}
      </group>
      {/* A rune circle under the long table */}
      <mesh ref={rune} position={[2.5, 0.012, 2.3]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light("#b9a6ff", 1.2)}>
        <ringGeometry args={[2.85, 2.9, 128]} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[2.5 + Math.cos(a) * 2.72, 0.013, 2.3 + Math.sin(a) * 2.72]} rotation={[-Math.PI / 2, 0, a]} material={PBR.light("#b9a6ff", 1.5)}>
            <planeGeometry args={[0.16, 0.03]} />
          </mesh>
        );
      })}
      {/* The sword in the stone */}
      <group position={[-6.6, 0, 1]}>
        <Model id="nature/Rock_Medium_1" fit={{ length: 1.3 }} rotation={0.4} cast />
        <Model id="fantasy-props/Sword_Bronze" fit={{ height: 1.15 }} position={[0.05, 0.55, 0]} rotation={[0, 0.3, 0.06]} cast />
      </group>
      <Plaque position={[-5.6, 0, 1.7]} rotation={-0.6}>
        {"PULL AT YOUR OWN RISK · ARTHURIAN · PUBLIC DOMAIN (WE CHECKED)"}
      </Plaque>
      {/* Scrying orb, and the lab half: holographic shelves */}
      <group position={[-2.6, 0, 0.6]}>
        <mesh position={[0, 0.5, 0]} material={PBR.wood("walnut")} castShadow>
          <cylinderGeometry args={[0.12, 0.22, 1, 16]} />
        </mesh>
        <mesh position={[0, 1.18, 0]} material={orb} castShadow>
          <sphereGeometry args={[0.2, 32, 24]} />
        </mesh>
      </group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[6.9, 1.6 + i * 0.75, 1.2]} rotation={[0, -Math.PI / 2, 0]} material={holo}>
          <planeGeometry args={[1.8, 0.55]} />
        </mesh>
      ))}
    </group>
  );
}

// ── Break Room → the club's walls: the Groove Canoe poster, a little shrine, the open-mic sign ──────────

function BreakRoomEggs() {
  return (
    <group>
      {/* Posters on the right wall, beside the arcade. */}
      <group position={[7.9, 2.4, -2.2]} rotation={[0, -Math.PI / 2, 0]}>
        <Block size={[1.4, 1.9, 0.03]} material={PBR.matte("#1a1033", 0.9)} radius={0.01} />
        <Text font={FONTS.serifUpright} fontSize={0.2} position={[0, 0.5, 0.02]} color="#ffb347" letterSpacing={0.1}>
          GROOVE CANOE
        </Text>
        <Text font={FONTS.mono} fontSize={0.06} position={[0, 0.25, 0.02]} color="#f2e6dc" maxWidth={1.2} textAlign="center">
          {"THE BOAT PARTY · ON A CANOE · BYO PADDLE"}
        </Text>
        <mesh position={[0, -0.35, 0.02]}>
          <circleGeometry args={[0.35, 32]} />
          <meshBasicMaterial color={[1.6, 0.7, 1.1]} toneMapped={false} />
        </mesh>
      </group>
      <group position={[7.88, 3.0, 1.55]} rotation={[0, -Math.PI / 2, 0]}>
        <Block size={[1.2, 0.06, 0.3]} material={PBR.wood("walnut")} radius={0.01} />
        {[-0.4, -0.15, 0.3, 0.45].map((x, i) => (
          <group key={x} position={[x, 0.12 + (i % 2) * 0.04, 0]}>
            <mesh material={PBR.matte("#efe6d4", 0.7)}>
              <cylinderGeometry args={[0.035, 0.035, 0.18 + (i % 2) * 0.08, 12]} />
            </mesh>
            <mesh position={[0, 0.13 + (i % 2) * 0.04, 0]} material={PBR.light("#ffcf8a", 4)}>
              <sphereGeometry args={[0.02, 8, 8]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0.07, 0.28, 0]} material={PBR.lacquer("#e8e4dc", 0.2)}>
          <sphereGeometry args={[0.13, 24, 16, 0, Math.PI]} />
        </mesh>
      </group>
      {/* Open-mic sign by the stage steps. */}
      <group position={[-4.2, 0, -2.7]} rotation={[0, 0.5, 0]}>
        <Block size={[0.04, 1.1, 0.04]} position={[0, 0.55, 0]} material={PBR.brass()} radius={0.01} />
        <Block size={[0.8, 0.5, 0.03]} position={[0, 1.25, 0]} material={PBR.matte("#141018", 0.9)} radius={0.01} />
        <Text font={FONTS.serif} fontSize={0.1} position={[0, 1.3, 0.02]} color="#ffd08f">
          This Is Me
        </Text>
        <Text font={FONTS.mono} fontSize={0.04} position={[0, 1.15, 0.02]} color="#f2e6dc" letterSpacing={0.2}>
          OPEN MIC · EVERYONE WELCOME
        </Text>
      </group>
    </group>
  );
}

export const EASTER_EGGS: Record<RoomId, ComponentType> = {
  foundry: FoundryEggs,
  spire: SpireEggs,
  exchange: ExchangeEggs,
  green: GreenEggs,
  relay: RelayEggs,
  archive: ArchiveEggs,
  breakroom: BreakRoomEggs,
  // The Boiler Room is its own joke.
  boiler: () => null,
};
