import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, MeshStandardMaterial, Object3D, PlaneGeometry, type InstancedMesh, type Mesh } from "three";
import { Beam, Dust, Haze } from "../fx/atmos.tsx";
import { Model, ModelInstances } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { claimWaiting, scoreboardLine, startGreen, useGreen } from "../desk/green/league.ts";
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
  // The league is real (#252): the scoreboard, the depth chart's week and the mailbox flag read Nikita's Sleeper league.
  useEffect(() => startGreen(), []);
  const board = useGreen((s) => s.board);
  const claim = claimWaiting(board);
  const waiverPending =
    useWorld((s) => Object.values(s.lattice.approvals).some((a) => a.status === "pending" && (a.request.action === "waiver.claim" || a.request.action === "lineup.set"))) || claim;
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
          DEPTH CHART · WEEK {board ? board.week : "??"}
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
          {scoreboardLine(board)}
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

      {/* Planting: three park trees, flowering shrubs along the balustrade, a stone path to the bench */}
      <Model id="nature/CommonTree_1" fit={{ height: 4.4 }} position={[-6.8, 0, 4.6]} rotation={0.6} cast />
      <Model id="nature/CommonTree_2" fit={{ height: 4 }} position={[7, 0, 4.4]} rotation={2.1} cast />
      <Model id="nature/CommonTree_3" fit={{ height: 3.8 }} position={[6.9, 0, -5.4]} rotation={4} cast />
      <ModelInstances
        id="nature/Bush_Common_Flowers"
        fit={{ length: 1.2 }}
        at={[{ position: [-7.5, 0, -4.4] }, { position: [-7.6, 0, 1.6], rotation: 1.4 }, { position: [7.5, 0, -2.6], rotation: 2.6 }, { position: [-2.8, 0, -6.1], rotation: 0.4, scale: 0.85 }, { position: [2.9, 0, -6.1], rotation: 3.3, scale: 0.85 }]}
      />
      <ModelInstances
        id="nature/Flower_3_Group"
        fit={{ height: 0.75 }}
        at={[{ position: [-6.3, 0, 5.6] }, { position: [7.6, 0, 3.1], rotation: 1 }, { position: [-7.6, 0, -2.6], rotation: 2 }]}
      />
      <ModelInstances id="nature/Flower_4_Group" fit={{ height: 0.8 }} at={[{ position: [6.1, 0, 5.5], rotation: 0.5 }, { position: [-7.5, 0, 3.2], rotation: 2.4 }]} />
      <ModelInstances id="nature/Fern_1" fit={{ length: 1.3 }} at={[{ position: [-4.3, 0, 4.5] }, { position: [7.6, 0, -3.1], rotation: 1.2 }]} />
      <ModelInstances
        id="nature/RockPath_Square_Wide"
        fit={{ length: 1.25 }}
        at={[{ position: [-6.9, 0.01, 2.2] }, { position: [-6.9, 0.01, 0.9], rotation: Math.PI / 2 }, { position: [-6.9, 0.01, -0.4] }, { position: [-6.9, 0.01, -1.7], rotation: Math.PI / 2 }]}
      />
      {/* A split-rail fence behind the waiver mailbox, and bollards at the gate */}
      <ModelInstances id="medieval/Prop_WoodenFence_Single" fit={{ length: 1.7 }} at={[{ position: [4.75, 0, -5.75] }, { position: [6.5, 0, -5.75] }]} cast />
      <ModelInstances id="downtown/Prop_Bollard" fit={{ height: 0.75 }} at={[{ position: [-0.9, 0, 6.15] }, { position: [0.9, 0, 6.15] }]} />
      <LampPost position={[-7.5, 0, -1]} />
      <LampPost position={[7.5, 0, 1.4]} />
      <GreenEvening />
      <pointLight position={[2, 5, 2]} color="#ffdcb0" intensity={24} distance={18} decay={1.6} />
    </group>
  );
}

/** A floodlight tower: a lattice mast and a bank of lamps, throwing a beam down onto the pitch. */
function Floodlight({ position, aim }: { position: [number, number, number]; aim: [number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 3.1, 0]} material={PBR.steel()} castShadow>
        <cylinderGeometry args={[0.07, 0.12, 6.2, 10]} />
      </mesh>
      <group position={[0, 6.2, 0]} rotation={[aim[0], aim[1], 0, "YXZ"]}>
        <Block size={[1.0, 0.6, 0.12]} material={PBR.blackMetal()} radius={0.02} />
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} position={[-0.32 + (i % 3) * 0.32, i < 3 ? 0.14 : -0.14, 0.07]} material={PBR.light("#fff3dc", 5)}>
            <circleGeometry args={[0.1, 16]} />
          </mesh>
        ))}
        <group position={[0, 0, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
          <Beam length={9} radius={2.2} color="#fff1d8" opacity={0.06} />
        </group>
      </group>
    </group>
  );
}

/** Evening on the Green: floodlights, mist settling on the grass, fireflies by the trees, pines behind the fence. */
function GreenEvening() {
  return (
    <group>
      <Floodlight position={[-7.7, 0, -6.0]} aim={[0.75, 0.75]} />
      <Floodlight position={[7.7, 0, 6.0]} aim={[0.75, Math.PI + 0.75]} />
      <Haze min={[-7.5, 0.02, -5.8]} size={[15, 0.5, 11.6]} count={30} puff={2.6} color="#dfe8ef" opacity={0.07} drift={0.5} />
      <Dust min={[-7.6, 0.3, -5.8]} size={[15, 2.2, 11.6]} count={45} color="#e8ff8a" opacity={0.9} />
      <ModelInstances id="nature/Pine_2" fit={{ height: 3.6 }} at={[{ position: [-6.4, 0, -6.1], rotation: 0.4 }, { position: [-4.9, 0, -6.2], rotation: 2, scale: 0.85 }, { position: [5.3, 0, 6.1], rotation: 1.1, scale: 0.9 }]} cast />
      <ModelInstances id="nature/Rock_Medium_2" fit={{ length: 0.9 }} at={[{ position: [-7.3, 0, 5.6], rotation: 0.7 }, { position: [7.5, 0, -0.6], rotation: 2.2 }]} cast />
      <ModelInstances id="nature/Rock_Medium_3" fit={{ length: 0.7 }} at={[{ position: [6.6, 0, 5.9], rotation: 1.5 }]} cast />
      <ModelInstances id="nature/Mushroom_Common" fit={{ height: 0.25 }} at={[{ position: [-6.2, 0, 4.0], rotation: 0.3 }, { position: [-6.0, 0, 4.2], rotation: 1.9, scale: 0.7 }, { position: [6.6, 0, 3.8] }]} />
      <ModelInstances id="nature/Grass_Wispy_Tall" fit={{ height: 0.6 }} at={[{ position: [-7.5, 0, 0.2] }, { position: [7.6, 0, 2.4], rotation: 1 }, { position: [-3.6, 0, -6.2], rotation: 2 }, { position: [3.8, 0, 6.2], rotation: 3 }]} />
    </group>
  );
}

