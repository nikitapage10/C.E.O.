import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, MeshStandardMaterial, Object3D, PlaneGeometry, type InstancedMesh, type Mesh } from "three";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { Block, FONTS, Plinth, ROOM_D, ROOM_W, ahead } from "./primitives.tsx";

const BLADES = 9000;
const dummy = new Object3D();

/** Thousands of instanced grass blades that sway in a vertex-shader breeze. */
function Grass() {
  const ref = useRef<InstancedMesh>(null);
  const time = useRef({ value: 0 });
  const { geometry, material } = useMemo(() => {
    const geometry = new PlaneGeometry(0.05, 0.32, 1, 3);
    geometry.translate(0, 0.16, 0);
    const material = new MeshStandardMaterial({ color: "#5d8a4a", roughness: 0.85, side: DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time.current;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float h = position.y / 0.32;
          vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.6 + wp.x * 0.7 + wp.z * 0.5) * 0.5 + sin(uTime * 3.1 + wp.x * 2.1) * 0.15;
          transformed.x += sway * h * h * 0.12;
          transformed.z += sway * h * h * 0.06;`,
        );
    };
    return { geometry, material };
  }, []);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new Color();
    for (let i = 0; i < BLADES; i++) {
      const x = (Math.random() - 0.5) * (ROOM_W - 0.6);
      const z = (Math.random() - 0.5) * (ROOM_D - 0.6);
      dummy.position.set(x, 0, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
      dummy.scale.set(1, 0.5 + Math.random() * 0.9, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.27 + Math.random() * 0.05, 0.38 + Math.random() * 0.15, 0.22 + Math.random() * 0.14);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useFrame(({ clock }) => {
    time.current.value = clock.elapsedTime;
  });

  return <instancedMesh ref={ref} args={[geometry, material, BLADES]} receiveShadow frustumCulled={false} />;
}

function Tree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const leaf = PBR.matte("#3e6b3c", 0.8);
  const clusters = useMemo(
    () => [
      [0, 2.6, 0, 0.9],
      [0.55, 2.3, 0.2, 0.65],
      [-0.5, 2.25, -0.15, 0.7],
      [0.1, 3.1, -0.3, 0.6],
      [-0.2, 2.9, 0.45, 0.55],
    ],
    [],
  );
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.1, 0]} material={PBR.wood("walnut")} castShadow>
        <cylinderGeometry args={[0.08, 0.14, 2.2, 12]} />
      </mesh>
      {clusters.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x!, y!, z!]} material={leaf} castShadow receiveShadow>
          <icosahedronGeometry args={[r!, 2]} />
        </mesh>
      ))}
    </group>
  );
}

function LampPost({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.3, 0]} material={PBR.blackMetal()} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 2.6, 12]} />
      </mesh>
      <mesh position={[0, 2.7, 0]} material={PBR.light("#ffd9a6", 4)}>
        <sphereGeometry args={[0.16, 24, 16]} />
      </mesh>
    </group>
  );
}

function Goalpost({ x }: { x: number }) {
  const m = PBR.lacquer("#f2efe6", 0.35);
  return (
    <group position={[x, 0, 0.5]}>
      <mesh position={[0, 0.75, 0]} material={m} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 1.5, 12]} />
      </mesh>
      <mesh position={[0, 1.5, 0]} rotation={[Math.PI / 2, 0, 0]} material={m} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 1.8, 12]} />
      </mesh>
      {[-0.9, 0.9].map((z) => (
        <mesh key={z} position={[0, 2.25, z]} material={m} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 1.5, 12]} />
        </mesh>
      ))}
    </group>
  );
}

/** The Green: a rooftop park with a pitch in it, where the fantasy football agents deliberate. */
export function Green() {
  const ball = useRef<Mesh>(null);
  const flag = useRef<Mesh>(null);
  const waiverPending = useWorld((s) =>
    Object.values(s.lattice.approvals).some((a) => a.status === "pending" && (a.request.action === "waiver.claim" || a.request.action === "lineup.set")),
  );
  const chart = ahead(getStation("green", "depth-chart"), 0.95);
  const mailbox = ahead(getStation("green", "mailbox"), 0.8);
  const bench = getStation("green", "bench");
  const chalk = PBR.matte("#e9e6dc", 0.9);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ball.current) {
      const u = (t * 0.3) % 1;
      ball.current.position.set(-3.6 + u * 7.2, 0.2 + Math.sin(u * Math.PI) * 3, 0.5 + Math.sin(t) * 0.3);
      ball.current.rotation.set(0, 0, -u * Math.PI * 6);
    }
    if (flag.current) {
      const target = waiverPending ? -Math.PI / 2 : 0;
      flag.current.rotation.z += (target - flag.current.rotation.z) * 0.08;
    }
  });

  const pitch: [number, number, number, number][] = [
    [0, -2.2, 9, 0.06],
    [0, 3.2, 9, 0.06],
    [-4.5, 0.5, 0.06, 5.4],
    [4.5, 0.5, 0.06, 5.4],
    ...Array.from({ length: 8 }, (_, i) => [-3.5 + i, 0.5, 0.04, 5.4] as [number, number, number, number]),
  ];

  return (
    <group>
      <Plinth floor={PBR.matte("#2c3a24", 1)} edge={PBR.lacquer("#d8d3c8", 0.6)} accent="#ffd9a6" />
      <Grass />
      {pitch.map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, z]} material={chalk}>
          <planeGeometry args={[w, d]} />
        </mesh>
      ))}
      <Goalpost x={-4.9} />
      <Goalpost x={4.9} />
      <mesh ref={ball} material={PBR.lacquer("#7a3f22", 0.5)} scale={[1, 0.62, 0.62]} castShadow>
        <sphereGeometry args={[0.16, 20, 14]} />
      </mesh>

      {/* Glass balustrade around the roof edge, with a timber handrail */}
      {[
        { p: [0, 0, -6.6] as [number, number, number], r: 0, l: 16.4 },
        { p: [-8.2, 0, 0] as [number, number, number], r: Math.PI / 2, l: 13.2 },
        { p: [8.2, 0, 0] as [number, number, number], r: Math.PI / 2, l: 13.2 },
      ].map((b, i) => (
        <group key={i} position={b.p} rotation={[0, b.r, 0]}>
          <mesh position={[0, 0.55, 0]} material={PBR.glass("#d8ecff", 0.14)}>
            <boxGeometry args={[b.l, 1.1, 0.03]} />
          </mesh>
          <Block size={[b.l, 0.07, 0.12]} position={[0, 1.12, 0]} material={PBR.wood("oak")} radius={0.03} />
        </group>
      ))}

      {/* Depth chart: a chalkboard on an easel */}
      <group position={[chart.pos[0], 0, chart.pos[1]]} rotation={[0, chart.yaw, 0]}>
        <Block size={[2.2, 1.5, 0.06]} position={[0, 1.65, 0]} material={PBR.matte("#1f2a22", 0.95)} radius={0.02} />
        <Block size={[2.34, 1.64, 0.04]} position={[0, 1.65, -0.03]} material={PBR.wood("oak")} radius={0.02} />
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[-0.3 + (i % 2) * 0.2, 2.1 - i * 0.2, 0.035]} material={chalk}>
            <planeGeometry args={[1.2 - i * 0.1, 0.04]} />
          </mesh>
        ))}
        <Text font={FONTS.mono} fontSize={0.1} position={[0, 2.3, 0.04]} letterSpacing={0.15} color="#e9e6dc">
          DEPTH CHART · WEEK ??
        </Text>
        {[-1, 1].map((s) => (
          <Block key={s} size={[0.05, 2.3, 0.05]} position={[s * 0.95, 1.1, -0.2]} rotation={[0.15, 0, 0]} material={PBR.wood("oak")} radius={0.01} />
        ))}
      </group>

      {/* Waiver mailbox: the flag goes up when a claim is waiting on you */}
      <group position={[mailbox.pos[0], 0, mailbox.pos[1]]} rotation={[0, mailbox.yaw, 0]}>
        <Block size={[0.1, 1.05, 0.1]} position={[0, 0.52, 0]} material={PBR.wood("oak")} radius={0.01} />
        <Block size={[0.5, 0.36, 0.8]} position={[0, 1.2, 0]} material={PBR.lacquer("#2c4a7a", 0.3)} radius={0.05} />
        <mesh position={[0, 1.38, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.lacquer("#2c4a7a", 0.3)} castShadow>
          <cylinderGeometry args={[0.25, 0.25, 0.8, 24, 1, false, -Math.PI / 2, Math.PI]} />
        </mesh>
        <mesh ref={flag} position={[0.27, 1.25, -0.2]} material={PBR.lacquer("#c23b3b", 0.4)} castShadow>
          <boxGeometry args={[0.03, 0.42, 0.1]} />
        </mesh>
      </group>

      {/* Scoreboard */}
      <group position={[0, 0, -6]}>
        <Block size={[3.4, 1.3, 0.25]} position={[0, 3.2, 0]} material={PBR.blackMetal()} radius={0.05} />
        <Text font={FONTS.mono} fontSize={0.36} position={[0, 3.25, 0.14]} letterSpacing={0.1}>
          HOME 24 · AWAY 17
          <meshBasicMaterial color={[2.2, 1.7, 0.8]} toneMapped={false} />
        </Text>
        {[-1.2, 1.2].map((x) => (
          <Block key={x} size={[0.12, 2.6, 0.12]} position={[x, 1.3, 0]} material={PBR.blackMetal()} radius={0.02} />
        ))}
      </group>

      {/* Park bench: timber slats on cast iron */}
      <group position={[bench.x, 0, bench.z - 0.35]}>
        {[0, 1, 2].map((i) => (
          <Block key={i} size={[1.8, 0.04, 0.12]} position={[0, 0.46, -0.16 + i * 0.15]} material={PBR.wood("oak")} radius={0.01} />
        ))}
        {[0, 1].map((i) => (
          <Block key={i} size={[1.8, 0.12, 0.04]} position={[0, 0.66 + i * 0.16, -0.26]} rotation={[-0.15, 0, 0]} material={PBR.wood("oak")} radius={0.01} />
        ))}
        {[-0.8, 0.8].map((x) => (
          <Block key={x} size={[0.06, 0.46, 0.5]} position={[x, 0.23, -0.05]} material={PBR.blackMetal()} radius={0.01} />
        ))}
      </group>

      <Tree position={[-6.8, 0, 4.6]} scale={1.05} />
      <Tree position={[7, 0, 4.4]} scale={0.9} />
      <Tree position={[6.9, 0, -5.4]} scale={0.8} />
      <LampPost position={[-7.5, 0, -1]} />
      <LampPost position={[7.5, 0, 1.4]} />
      <pointLight position={[2, 5, 2]} color="#ffdcb0" intensity={24} distance={18} decay={1.6} />
    </group>
  );
}

