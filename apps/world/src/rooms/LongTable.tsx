import { getStation, type Station } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh } from "three";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { gatheringIn, useWorld } from "../store.ts";
import { Block, FONTS, facingDir } from "./primitives.tsx";

/**
 * The Archive's long table for campaigns: walnut and green felt, benches down both sides, a map with painted
 * miniatures, and the DM's three-panel screen at the head. Players' dice tumble onto the felt in front of them
 * and show what they rolled.
 */

const TABLE = { x: 2.4, z: 2.3, length: 4.4, width: 1.3, top: 0.78 };
const SEATS = ["seat-w", "seat-nm", "seat-e", "seat-sw", "seat-sm", "seat-se", "dice-table"];
const DIE_COLORS = ["#6a2a8a", "#1f5a8a", "#8a2a2a", "#2a6a4a", "#8a6a1f", "#3a3a4a", "#b08a2a"];

/** One die per seat: thrown when its player rolls, then it sits showing the number for a while. */
function SeatDie({ station, color }: { station: Station; color: string }) {
  const die = useRef<Mesh>(null);
  const label = useRef<Group>(null);
  const text = useRef<{ text: string; color: string; sync?: () => void } & Mesh>(null);
  const mat = useMemo(() => new MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1, emissive: "#000" }), [color]);
  const [fx, fz] = facingDir(station.facing);
  // Lands a little way onto the felt in front of the seat (the DM's lands behind the screen).
  const reach = station.id === "dice-table" ? 0.6 : 0.75;
  const rest: [number, number] = [station.x + fx * reach, station.z + fz * reach];
  const shown = useRef(-1);
  useFrame(({ clock }) => {
    const s = useWorld.getState();
    const g = gatheringIn(s, "archive");
    let roll = null;
    if (g?.live) {
      const who = [g.host, ...g.guests].find((id) => s.lattice.agents[id]?.place.station === station.id);
      roll = who ? s.rolls[who] : undefined;
    }
    const age = roll ? (performance.now() - roll.at) / 1000 : Infinity;
    const on = age < 7;
    if (!die.current || !label.current) return;
    die.current.visible = on;
    label.current.visible = on && age > 0.7;
    if (!on || !roll) return;
    // A short arc from the player's hand to the felt, spinning, then a couple of small bounces.
    const u = Math.min(1, age / 0.7);
    const hop = u < 1 ? Math.sin(u * Math.PI) * 0.35 : Math.abs(Math.sin(Math.min(age - 0.7, 0.5) * 18)) * 0.04 * (1 - Math.min(1, (age - 0.7) * 2));
    die.current.position.set(station.x + (rest[0] - station.x) * u, TABLE.top + 0.07 + hop + (1 - u) * 0.3, station.z + (rest[1] - station.z) * u);
    const spin = (1 - u) * 14 + 0.3;
    die.current.rotation.set(age * spin, age * spin * 0.7, 0.4);
    const crit = roll.value === roll.sides;
    const fumble = roll.value === 1;
    mat.emissive.set(crit ? "#ffcc55" : fumble ? "#ff3322" : "#000000");
    mat.emissiveIntensity = crit || fumble ? 1.5 + Math.sin(clock.elapsedTime * 10) * 0.5 : 0;
    label.current.position.set(rest[0], TABLE.top + 0.42 + Math.min(0.15, (age - 0.7) * 0.2), rest[1]);
    if (shown.current !== roll.at && text.current) {
      shown.current = roll.at;
      text.current.text = String(roll.value);
      text.current.color = crit ? "#ffd27a" : fumble ? "#ff6b5a" : "#f2e6dc";
      text.current.sync?.();
    }
  });
  return (
    <group>
      <mesh ref={die} material={mat} castShadow visible={false}>
        <icosahedronGeometry args={[0.07, 0]} />
      </mesh>
      <group ref={label} visible={false}>
        <Text ref={text} font={FONTS.serifUpright} fontSize={0.16} anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#1a1020">
          20
        </Text>
      </group>
    </group>
  );
}

/** The DM's screen: three hinged panels, painted on the players' side with a dragon and a lot of stars. */
function DmScreen({ position, yaw }: { position: [number, number, number]; yaw: number }) {
  const board = PBR.lacquer("#3b1f4f", 0.6);
  const art = PBR.light("#c9a25c", 0.6);
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[-1, 0, 1].map((k) => (
        <group key={k} position={[k * 0.33, 0.17, Math.abs(k) * 0.09]} rotation={[0, -k * 0.5, 0]}>
          <Block size={[0.34, 0.34, 0.015]} material={board} radius={0.004} />
          {/* Gilt border and a sigil on the outside (facing the players). */}
          <mesh position={[0, 0, -0.009]} rotation={[0, Math.PI, 0]} material={art}>
            <ringGeometry args={[0.07, 0.085, 6]} />
          </mesh>
          <mesh position={[0, 0.13, -0.009]} rotation={[0, Math.PI, 0]} material={art}>
            <planeGeometry args={[0.28, 0.008]} />
          </mesh>
          <mesh position={[0, -0.13, -0.009]} rotation={[0, Math.PI, 0]} material={art}>
            <planeGeometry args={[0.28, 0.008]} />
          </mesh>
        </group>
      ))}
      {/* The DM's side: notes, a tiny hourglass. */}
      <Model id="fantasy-props/Scroll_1" fit={{ scale: 1 }} position={[0.05, 0, 0.28]} rotation={0.4} />
    </group>
  );
}

/** Painted miniatures on the battle map; they glow faintly while a session is live. */
function Miniatures() {
  const minis = useRef<Group>(null);
  const colors = ["#c94a4a", "#4a7ac9", "#4ac98a", "#c9a24a", "#9a4ac9"];
  const glow = useMemo(() => new MeshStandardMaterial({ color: "#2a1a10", emissive: "#ff6b3a", emissiveIntensity: 0, roughness: 0.6 }), []);
  useFrame(({ clock }) => {
    const live = !!gatheringIn(useWorld.getState(), "archive")?.live;
    glow.emissiveIntensity += ((live ? 1.6 + Math.sin(clock.elapsedTime * 3) * 0.4 : 0) - glow.emissiveIntensity) * 0.05;
    minis.current?.children.forEach((m, i) => {
      if (i < colors.length) m.position.y = live ? Math.abs(Math.sin(clock.elapsedTime * 1.5 + i)) * 0.015 : 0;
    });
  });
  return (
    <group ref={minis} position={[0, TABLE.top + 0.02, 0]}>
      {colors.map((c, i) => (
        <group key={c} position={[-0.9 + i * 0.32, 0, (i % 2) * 0.18 - 0.09]}>
          <mesh position={[0, 0.012, 0]} material={PBR.blackMetal()}>
            <cylinderGeometry args={[0.035, 0.035, 0.012, 16]} />
          </mesh>
          <mesh position={[0, 0.06, 0]} material={PBR.lacquer(c, 0.4)} castShadow>
            <capsuleGeometry args={[0.018, 0.05, 4, 8]} />
          </mesh>
          <mesh position={[0, 0.11, 0]} material={PBR.lacquer("#e8c9a8", 0.5)}>
            <sphereGeometry args={[0.016, 10, 8]} />
          </mesh>
        </group>
      ))}
      {/* The monster: a squat thing with a glowing eye. */}
      <group position={[0.9, 0, 0.05]}>
        <mesh position={[0, 0.07, 0]} material={PBR.lacquer("#3a4a3a", 0.5)} castShadow>
          <sphereGeometry args={[0.08, 16, 12]} />
        </mesh>
        <mesh position={[0, 0.09, 0.07]} material={glow}>
          <sphereGeometry args={[0.02, 10, 8]} />
        </mesh>
      </group>
    </group>
  );
}

export function LongTable() {
  const walnut = PBR.wood("walnut");
  const stations = useMemo(() => SEATS.map((id) => getStation("archive", id)), []);
  const dm = stations[stations.length - 1]!;
  return (
    <group>
      <group position={[TABLE.x, 0, TABLE.z]}>
        {/* Top, felt inlay and four turned legs. */}
        <Block size={[TABLE.length, 0.08, TABLE.width]} position={[0, TABLE.top - 0.04, 0]} material={walnut} radius={0.03} />
        <mesh position={[0, TABLE.top + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.felt("#1f4a34")} receiveShadow>
          <planeGeometry args={[TABLE.length - 0.25, TABLE.width - 0.25]} />
        </mesh>
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * (TABLE.length / 2 - 0.2), (TABLE.top - 0.08) / 2, sz * (TABLE.width / 2 - 0.15)]} material={walnut} castShadow>
              <cylinderGeometry args={[0.06, 0.045, TABLE.top - 0.08, 12]} />
            </mesh>
          )),
        )}
        {/* The battle map: parchment with ink lines, under the miniatures. */}
        <mesh position={[-0.2, TABLE.top + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0.02]} material={PBR.matte("#d9c49a", 0.9)} receiveShadow>
          <planeGeometry args={[2.3, 0.75]} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[-1.3 + i * 0.3, TABLE.top + 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.matte("#6a5a3a", 0.9)}>
            <planeGeometry args={[0.006, 0.72]} />
          </mesh>
        ))}
        <Miniatures />
        {/* Candles at each end, character sheets and snacks in between. */}
        <Model id="fantasy-props/CandleStick_Triple" fit={{ scale: 0.9 }} position={[-1.95, TABLE.top, 0.3]} rotation={0.6} />
        <Model id="fantasy-props/Candle_1" fit={{ scale: 1 }} position={[1.4, TABLE.top, -0.4]} />
        {[-1.3, 0, 1.3].flatMap((x) =>
          [-1, 1].map((side) => (
            <mesh key={`${x}${side}`} position={[x, TABLE.top + 0.005, side * 0.48]} rotation={[-Math.PI / 2, 0, side * 0.08]} material={PBR.matte("#efe6d4", 0.9)}>
              <planeGeometry args={[0.3, 0.21]} />
            </mesh>
          )),
        )}
        <Model id="fantasy-props/Book_Stack_1" fit={{ scale: 0.9 }} position={[1.85, TABLE.top, 0.35]} rotation={0.3} />
        {/* Benches down both sides. */}
        {[-1, 1].map((side) => (
          <group key={side} position={[0, 0, side * (TABLE.width / 2 + 0.42)]}>
            <Block size={[TABLE.length - 0.4, 0.07, 0.36]} position={[0, 0.45, 0]} material={walnut} radius={0.02} />
            {[-1, 1].map((sx) => (
              <Block key={sx} size={[0.07, 0.42, 0.3]} position={[sx * (TABLE.length / 2 - 0.45), 0.21, 0]} material={walnut} radius={0.01} />
            ))}
          </group>
        ))}
      </group>
      {/* The DM's high-backed chair and screen at the head. */}
      <group position={[dm.x + 0.32, 0, dm.z]}>
        <Block size={[0.6, 0.08, 0.6]} position={[0, 0.5, 0]} material={walnut} radius={0.03} />
        <Block size={[0.08, 1.5, 0.62]} position={[0.3, 0.95, 0]} material={walnut} radius={0.03} />
        <Block size={[0.06, 0.9, 0.5]} position={[0.32, 1.25, 0]} material={PBR.fabric("#5a1f2a")} radius={0.03} />
      </group>
      <DmScreen position={[TABLE.x + TABLE.length / 2 - 0.35, TABLE.top, TABLE.z]} yaw={Math.PI / 2} />
      {stations.map((st, i) => (
        <SeatDie key={st.id} station={st} color={DIE_COLORS[i % DIE_COLORS.length]!} />
      ))}
    </group>
  );
}
