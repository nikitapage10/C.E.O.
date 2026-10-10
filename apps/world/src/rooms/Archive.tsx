import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, type Group, LineBasicMaterial, LineSegments, MeshStandardMaterial, type Mesh } from "three";
import { kernelMaterial } from "../fx/materials.ts";
import { Model, ModelInstances, type Placement } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { Dust } from "../fx/atmos.tsx";
import { LongTable } from "./LongTable.tsx";
import { Block, FONTS, Plinth, ahead } from "./primitives.tsx";

const SHELVES = 6;
const BAYS = 4;
const BOOK_GROUPS = ["fantasy-props/BookGroup_Medium_1", "fantasy-props/BookGroup_Medium_2", "fantasy-props/BookGroup_Medium_3"];

/** Which book row goes in each half-bay: a fixed shuffle, with the odd gap where a short stack lies flat instead. */
function shelfRows() {
  const rows: Placement[][] = BOOK_GROUPS.map(() => []);
  const stacks: Placement[] = [];
  let k = 7;
  for (let b = 0; b < BAYS; b++)
    for (let sh = 0; sh < SHELVES; sh++)
      for (const half of [-0.8, 0.8]) {
        k = (k * 1103515245 + 12345) % 2147483648;
        const x = -6.25 + b * 3.3 + half;
        const y = 0.525 + sh * 0.78;
        if (k % 9 === 0) stacks.push({ position: [x + 0.2, y, -6.12], rotation: (k % 5) * 0.3 });
        else rows[k % rows.length]!.push({ position: [x, y, -6.12], rotation: k % 2 ? 0 : Math.PI });
      }
  return { rows, stacks };
}

/** Heimerdinger's bench height: low, for a small professor. */
const BENCH = 0.62;

/**
 * The resonance engine: a blue crystal in a brass cradle, two rings turning slowly round it. It hums brighter while
 * Heimerdinger is at work.
 */
function ResonanceEngine({ position }: { position: [number, number, number] }) {
  const glow = useMemo(() => new MeshStandardMaterial({ color: "#000", emissive: "#5fc8ff", emissiveIntensity: 1.5, toneMapped: false }), []);
  const rings = useRef<Group>(null);
  const crystal = useRef<Mesh>(null);
  const busy = useWorld((s) => {
    const a = s.lattice.agents.heimerdinger?.activity;
    return a === "working" || a === "typing";
  });
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const target = busy ? 3.2 + Math.sin(t * 6) * 0.6 : 1.4 + Math.sin(t * 1.2) * 0.2;
    glow.emissiveIntensity += (target - glow.emissiveIntensity) * 0.06;
    if (rings.current) {
      rings.current.children[0]!.rotation.x += dt * (busy ? 1.6 : 0.4);
      rings.current.children[1]!.rotation.z += dt * (busy ? 1.1 : 0.3);
    }
    if (crystal.current) {
      crystal.current.rotation.y = t * 0.5;
      crystal.current.position.y = 0.2 + Math.sin(t * 1.5) * 0.015;
    }
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]} material={PBR.brass()} castShadow>
        <cylinderGeometry args={[0.09, 0.11, 0.06, 24]} />
      </mesh>
      <mesh position={[0, 0.1, 0]} material={PBR.brass()}>
        <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
      </mesh>
      <mesh ref={crystal} position={[0, 0.2, 0]} material={glow}>
        <octahedronGeometry args={[0.06, 0]} />
      </mesh>
      <group ref={rings} position={[0, 0.2, 0]}>
        <mesh material={PBR.brass()}>
          <torusGeometry args={[0.12, 0.006, 8, 48]} />
        </mesh>
        <mesh material={PBR.brass()}>
          <torusGeometry args={[0.15, 0.006, 8, 48]} />
        </mesh>
      </group>
      <pointLight position={[0, 0.25, 0]} color="#7fd4ff" intensity={busy ? 2.5 : 1} distance={2.5} decay={2} />
    </group>
  );
}

/** Floor-to-ceiling walnut bookcases, filled with rows of library books. */
function Bookcases() {
  const { rows, stacks } = useMemo(shelfRows, []);
  const walnut = PBR.wood("walnut");
  return (
    <group>
      <Block size={[16.2, 5.7, 0.5]} position={[0, 2.85, -6.55]} material={walnut} radius={0.04} />
      {Array.from({ length: SHELVES + 1 }, (_, s) => (
        <Block key={s} size={[13.4, 0.05, 0.42]} position={[-1.25, 0.5 + s * 0.78, -6.15]} material={walnut} radius={0.01} shadows={false} />
      ))}
      {Array.from({ length: BAYS + 1 }, (_, b) => (
        <Block key={b} size={[0.08, 5.2, 0.44]} position={[-7.9 + b * 3.3, 2.75, -6.15]} material={walnut} radius={0.01} />
      ))}
      {BOOK_GROUPS.map((id, i) => (
        <ModelInstances key={id} id={id} fit={{ scale: 1.5 }} at={rows[i]!} />
      ))}
      <ModelInstances id="fantasy-props/Book_Stack_1" fit={{ scale: 1.5 }} at={stacks} />
      {/* Brass rail and rolling ladder */}
      <mesh position={[-1.25, 4.9, -5.8]} rotation={[0, 0, Math.PI / 2]} material={PBR.brass()}>
        <cylinderGeometry args={[0.025, 0.025, 13.4, 12]} />
      </mesh>
      <group position={[-3.4, 0, -5.4]} rotation={[-0.2, 0, 0]}>
        {[-0.28, 0.28].map((x) => (
          <Block key={x} size={[0.06, 5.1, 0.06]} position={[x, 2.55, 0]} material={walnut} radius={0.01} />
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[0, 0.35 + i * 0.4, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.brass()}>
            <cylinderGeometry args={[0.018, 0.018, 0.56, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function loomThreads() {
  const p: number[] = [];
  for (let i = 0; i < 36; i++) {
    const x = -1.3 + (i / 35) * 2.6;
    p.push(x, 0.5, 0, x * 0.12, 2.8, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  const m = new LineBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85 });
  m.color.set(PALETTE.violet).multiplyScalar(2.2);
  return new LineSegments(g, m);
}

/** The Archive: a grand library for The Tide's lore, and a framed legal document the Syntherion are weirdly proud of. */
export function Archive() {
  const threads = useMemo(loomThreads, []);
  const stormBooks = useMemo(() => kernelMaterial(1.2), []);
  const shelves = ahead(getStation("archive", "shelves"), 1);
  const loom = ahead(getStation("archive", "loom"), 0.95);
  const shrine = ahead(getStation("archive", "shrine"), 0.95);
  const reading = getStation("archive", "reading");
  const lab = ahead(getStation("archive", "lab"), 0.75);
  const walnut = PBR.wood("walnut");

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    threads.material.opacity = 0.6 + Math.sin(t * 1.7) * 0.25;
  });

  return (
    <group>
      <Plinth floor={PBR.wood("walnut", [3, 3])} edge={walnut} accent={PALETTE.violet} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.5, 0.006, 0.8]} material={PBR.carpet("#1c2440", [3, 3])} receiveShadow>
        <planeGeometry args={[9, 6.5]} />
      </mesh>
      <Bookcases />

      {/* Glass vitrine of storm-filled volumes: The Tide's own lore, kept apart */}
      <group position={[shelves.pos[0] - 1.8, 0, shelves.pos[1] + 1.4]} rotation={[0, Math.PI / 2, 0]}>
        <Block size={[2.4, 0.9, 0.8]} position={[0, 0.45, 0]} material={walnut} radius={0.04} />
        <mesh position={[0, 1.4, 0]} material={PBR.glass("#e8f0ff", 0.12)}>
          <boxGeometry args={[2.3, 1, 0.7]} />
        </mesh>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} position={[-0.9 + i * 0.36, 1.25, 0]} rotation={[0, 0, (i - 2.5) * 0.04]} material={stormBooks}>
            <boxGeometry args={[0.16, 0.6 + (i % 3) * 0.08, 0.42]} />
          </mesh>
        ))}
      </group>

      {/* The lore loom */}
      <group position={[loom.pos[0], 0, loom.pos[1]]} rotation={[0, loom.yaw, 0]}>
        <primitive object={threads} />
        <Block size={[3, 0.1, 0.3]} position={[0, 0.45, 0]} material={PBR.brass()} radius={0.03} />
        <Block size={[0.5, 0.1, 0.25]} position={[0, 2.85, 0]} material={PBR.brass()} radius={0.03} />
        {[-1.5, 1.5].map((x) => (
          <Block key={x} size={[0.08, 3, 0.08]} position={[x, 1.5, 0]} material={walnut} radius={0.02} />
        ))}
      </group>

      {/* The lectern beside the loom, open at the chapter in progress */}
      <Model id="fantasy-props/BookStand" fit={{ height: 1.35 }} position={[loom.pos[0] + 2.3, 0, loom.pos[1] + 0.4]} rotation={-0.5} cast />
      <Model id="fantasy-props/Book_Stack_2" fit={{ scale: 1.3 }} position={[loom.pos[0] + 2.3, 0, loom.pos[1] + 1.1]} rotation={0.4} />

      {/* Apothecary cabinet and the campaign chest along the east side */}
      <Model id="fantasy-props/Cabinet" fit={{ scale: 1.25 }} position={[7.45, 0, -1.6]} rotation={-Math.PI / 2} cast />
      <Model id="fantasy-props/Potion_2" fit={{ scale: 1.4 }} position={[7.45, 1.25, -2.1]} />
      <Model id="fantasy-props/Potion_4" fit={{ scale: 1.4 }} position={[7.4, 1.25, -1.7]} />
      <Model id="fantasy-props/Potion_1" fit={{ scale: 1.4 }} position={[7.5, 1.25, -1.35]} />
      <Model id="fantasy-props/CandleStick_Triple" fit={{ scale: 1.2 }} position={[7.45, 1.25, -0.95]} rotation={Math.PI / 2} />
      <Model id="fantasy-props/Chest_Wood" fit={{ scale: 1.05 }} position={[-7.1, 0, 4.9]} rotation={Math.PI / 2 - 0.2} cast pose="Chest_Closed" />

      {/* The long table, for campaigns */}
      <LongTable />
      {/* Dust in the lamplight, over the reading floor and the table */}
      <Dust min={[-6, 0.6, -5]} size={[12, 3.2, 9.5]} count={70} />

      {/* The Cease & Desist shrine: marble plinth, gilt frame, museum light */}
      <group position={[shrine.pos[0], 0, shrine.pos[1]]} rotation={[0, shrine.yaw, 0]}>
        <Block size={[0.9, 1.1, 0.9]} position={[0, 0.55, 0]} material={PBR.terrazzoFloor([1, 1])} radius={0.03} />
        <Block size={[1.25, 1.6, 0.08]} position={[0, 2.2, -0.2]} material={PBR.brass()} radius={0.03} />
        <mesh position={[0, 2.2, -0.15]}>
          <planeGeometry args={[1.0, 1.35]} />
          <meshStandardMaterial color="#efe9dc" roughness={0.95} />
        </mesh>
        <Text font={FONTS.serifUpright} fontSize={0.12} position={[0, 2.72, -0.14]} color="#1a1a1a">
          CEASE &amp; DESIST
        </Text>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[0, 2.5 - i * 0.11, -0.14]}>
            <planeGeometry args={[0.75 - (i % 3) * 0.1, 0.022]} />
            <meshBasicMaterial color="#6b6b6b" />
          </mesh>
        ))}
        <Text font={FONTS.mono} fontSize={0.05} position={[0, 1.15, 0.46]} maxWidth={0.8} textAlign="center" color="#c9a25c">
          OUR FIRST C&amp;D · RECEIVED WITH PRIDE · PLEASE DO NOT SEND ANOTHER
        </Text>
        <spotLight position={[0, 4.2, 1.2]} angle={0.35} penumbra={0.6} intensity={30} distance={6} color="#ffe6c4" />
      </group>

      {/* Heimerdinger's workbench: flasks, notes and the resonance engine */}
      <group position={[lab.pos[0], 0, lab.pos[1]]} rotation={[0, lab.yaw, 0]}>
        <Model id="fantasy-props/Workbench" fit={{ height: BENCH }} cast />
        <ResonanceEngine position={[0.45, BENCH, -0.05]} />
        <Model id="fantasy-props/Potion_1" fit={{ scale: 1.1 }} position={[-0.25, BENCH, -0.1]} />
        <Model id="fantasy-props/Potion_4" fit={{ scale: 1.1 }} position={[-0.42, BENCH, 0.02]} />
        <Model id="fantasy-props/Scroll_2" fit={{ scale: 1.2 }} position={[0.05, BENCH, 0.1]} rotation={0.3} />
        <Model id="fantasy-props/Candle_1" fit={{ scale: 1.1 }} position={[-0.6, BENCH, -0.12]} />
        {/* The stack he stands on to reach things */}
        <Model id="fantasy-props/Book_Stack_2" fit={{ scale: 1.2 }} position={[0.95, 0, 0.35]} rotation={0.6} />
      </group>

      {/* Reading nook: leather armchair and a floor lamp */}
      <group position={[reading.x, 0, reading.z - 0.45]}>
        <Block size={[1, 0.45, 0.9]} position={[0, 0.3, 0]} material={PBR.lacquer("#4a2418", 0.55)} radius={0.12} />
        <Block size={[1, 0.8, 0.22]} position={[0, 0.75, -0.38]} material={PBR.lacquer("#4a2418", 0.55)} radius={0.1} />
        {[-0.5, 0.5].map((x) => (
          <Block key={x} size={[0.2, 0.6, 0.9]} position={[x, 0.45, 0]} material={PBR.lacquer("#4a2418", 0.55)} radius={0.08} />
        ))}
        <Model id="fantasy-props/Stool" fit={{ scale: 1 }} position={[-0.95, 0, 0.1]} />
        <Model id="fantasy-props/Book_Stack_1" fit={{ scale: 1.3 }} position={[-0.95, 0.59, 0.1]} rotation={0.7} />
        <Model id="fantasy-props/Scroll_1" fit={{ scale: 1.4 }} position={[-0.9, 0.86, 0.12]} rotation={-0.4} />
        <group position={[0.9, 0, -0.3]}>
          <mesh position={[0, 0.8, 0]} material={PBR.brass()}>
            <cylinderGeometry args={[0.015, 0.015, 1.6, 8]} />
          </mesh>
          <mesh position={[0, 1.65, 0]} material={PBR.fabric("#d9cbb0")} castShadow>
            <cylinderGeometry args={[0.16, 0.24, 0.28, 32, 1, true]} />
          </mesh>
          <mesh position={[0, 1.6, 0]} material={PBR.light("#ffd59a", 3)}>
            <sphereGeometry args={[0.07, 16, 16]} />
          </mesh>
        </group>
      </group>
      <pointLight position={[0, 4.4, 1]} color="#ffcf9a" intensity={20} distance={16} decay={1.6} />
    </group>
  );
}
