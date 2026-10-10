import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments, Object3D, type InstancedMesh, type Mesh } from "three";
import { kernelMaterial } from "../fx/materials.ts";
import { PBR } from "../fx/pbr.ts";
import { PALETTE } from "../theme.ts";
import { Block, FONTS, Plinth, ahead } from "./primitives.tsx";

const dummy = new Object3D();
const LEATHER = ["#4a1f1c", "#1f2f4a", "#2f3d2a", "#5a4326", "#3a2440", "#6b5a3a", "#232326", "#7a3a24"];

/** Floor-to-ceiling walnut bookcases, filled book by book. */
function Bookcases() {
  const books = useRef<InstancedMesh>(null);
  const SHELVES = 6;
  const BAYS = 4;
  const PER = 15;
  const count = SHELVES * BAYS * PER;
  useEffect(() => {
    const m = books.current;
    if (!m) return;
    const c = new Color();
    let i = 0;
    for (let b = 0; b < BAYS; b++)
      for (let s = 0; s < SHELVES; s++) {
        let x = -1.5;
        for (let k = 0; k < PER; k++) {
          const w = 0.07 + Math.random() * 0.06;
          const h = 0.42 + Math.random() * 0.2;
          const lean = k === PER - 1 ? 0.25 : 0;
          dummy.position.set(-6 + b * 3.3 + x + w / 2, 0.55 + s * 0.78 + h / 2, -6.15);
          dummy.rotation.set(0, 0, lean);
          dummy.scale.set(w, h, 0.3 + Math.random() * 0.06);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          m.setColorAt(i, c.set(LEATHER[Math.floor(Math.random() * LEATHER.length)]!));
          x += w + 0.008;
          i++;
        }
      }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count]);
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
      <instancedMesh ref={books} args={[undefined, PBR.lacquer("#ffffff", 0.6), count]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
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
  const d20 = useRef<Mesh>(null);
  const shelves = ahead(getStation("archive", "shelves"), 1);
  const loom = ahead(getStation("archive", "loom"), 0.95);
  const dice = ahead(getStation("archive", "dice-table"), 0.95);
  const shrine = ahead(getStation("archive", "shrine"), 0.95);
  const reading = getStation("archive", "reading");
  const walnut = PBR.wood("walnut");

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (d20.current) {
      const roll = (t % 4) / 4;
      d20.current.position.y = 0.95 + Math.abs(Math.sin(roll * Math.PI * 3)) * 0.35 * (1 - roll);
      d20.current.rotation.set(t * 2 * (1 - roll), t * 1.3 * (1 - roll), 0);
    }
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

      {/* Dice table: walnut and green felt */}
      <group position={[dice.pos[0], 0, dice.pos[1]]}>
        <mesh position={[0, 0.76, 0]} material={walnut} castShadow receiveShadow>
          <cylinderGeometry args={[0.95, 0.95, 0.07, 64]} />
        </mesh>
        <mesh position={[0, 0.8, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.felt("#1f4a34")} receiveShadow>
          <circleGeometry args={[0.82, 64]} />
        </mesh>
        <mesh position={[0, 0.38, 0]} material={walnut} castShadow>
          <cylinderGeometry args={[0.08, 0.25, 0.76, 24]} />
        </mesh>
        <mesh ref={d20} castShadow material={PBR.lacquer("#3a2a6a", 0.2)}>
          <icosahedronGeometry args={[0.14, 0]} />
        </mesh>
      </group>

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

      {/* Reading nook: leather armchair and a floor lamp */}
      <group position={[reading.x, 0, reading.z - 0.45]}>
        <Block size={[1, 0.45, 0.9]} position={[0, 0.3, 0]} material={PBR.lacquer("#4a2418", 0.55)} radius={0.12} />
        <Block size={[1, 0.8, 0.22]} position={[0, 0.75, -0.38]} material={PBR.lacquer("#4a2418", 0.55)} radius={0.1} />
        {[-0.5, 0.5].map((x) => (
          <Block key={x} size={[0.2, 0.6, 0.9]} position={[x, 0.45, 0]} material={PBR.lacquer("#4a2418", 0.55)} radius={0.08} />
        ))}
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
