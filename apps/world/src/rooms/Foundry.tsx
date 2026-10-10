import { ROOMS } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, Object3D, type Group, type InstancedMesh, type Mesh } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { Block, LightBar, Plinth, Workstation } from "./primitives.tsx";

const CONVEYOR_Z = -2.6;
const BELT_Y = 0.86;
const CRATES = 8;
const dummy = new Object3D();
/** Industrial-robot orange: the one loud colour in the room, on the machine that earns it. */
const ROBOT = "#d8662c";
const SAFETY = "#c9a227";

function IBeam({ length, position, rotation }: { length: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const m = PBR.steel();
  return (
    <group position={position} rotation={rotation}>
      <Block size={[length, 0.06, 0.34]} position={[0, 0.2, 0]} material={m} radius={0.01} />
      <Block size={[length, 0.06, 0.34]} position={[0, -0.2, 0]} material={m} radius={0.01} />
      <Block size={[length, 0.4, 0.06]} material={m} radius={0.01} />
    </group>
  );
}

function HangingLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.012, 0.012, 1.8, 6]} />
      </mesh>
      <mesh material={PBR.steel()} castShadow>
        <coneGeometry args={[0.42, 0.34, 32, 1, true]} />
      </mesh>
      <mesh position={[0, -0.12, 0]} material={PBR.light("#ffd7a0", 5)}>
        <sphereGeometry args={[0.1, 16, 16]} />
      </mesh>
    </group>
  );
}

/** A six-axis robot arm, procedurally animated: it picks, turns, places. */
function RobotArm({ position }: { position: [number, number, number] }) {
  const base = useRef<Group>(null);
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const wrist = useRef<Group>(null);
  const paint = PBR.lacquer(ROBOT, 0.3);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const cycle = (t * 0.35) % 1;
    const swing = Math.sin(cycle * Math.PI * 2);
    if (base.current) base.current.rotation.y = 0.9 + swing * 0.8;
    if (shoulder.current) shoulder.current.rotation.z = -0.55 + Math.sin(cycle * Math.PI * 4) * 0.18;
    if (elbow.current) elbow.current.rotation.z = 1.2 + Math.sin(cycle * Math.PI * 4 + 1) * 0.25;
    if (wrist.current) wrist.current.rotation.x = t * 1.5;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.12, 0]} material={PBR.steel()} castShadow receiveShadow>
        <cylinderGeometry args={[0.45, 0.55, 0.24, 32]} />
      </mesh>
      <group ref={base} position={[0, 0.24, 0]}>
        <mesh position={[0, 0.25, 0]} material={paint} castShadow>
          <cylinderGeometry args={[0.32, 0.38, 0.5, 32]} />
        </mesh>
        <group ref={shoulder} position={[0, 0.62, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={PBR.blackMetal()} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.5, 24]} />
          </mesh>
          <Block size={[0.28, 1.5, 0.3]} position={[0, 0.75, 0]} material={paint} radius={0.1} />
          <group ref={elbow} position={[0, 1.5, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} material={PBR.blackMetal()} castShadow>
              <cylinderGeometry args={[0.16, 0.16, 0.42, 24]} />
            </mesh>
            <Block size={[0.22, 1.2, 0.24]} position={[0, 0.6, 0]} material={paint} radius={0.08} />
            <group ref={wrist} position={[0, 1.22, 0]}>
              <mesh material={PBR.chrome()} castShadow>
                <cylinderGeometry args={[0.1, 0.1, 0.18, 20]} />
              </mesh>
              {[-1, 1].map((s) => (
                <Block key={s} size={[0.04, 0.24, 0.1]} position={[s * 0.08, 0.18, 0]} material={PBR.aluminium()} radius={0.01} />
              ))}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/** The test furnace. Its glow is the last test result in this room: cool green for pass, hot red for fail. */
function Furnace({ position }: { position: [number, number, number] }) {
  const glowMat = useMemo(() => new MeshStandardMaterial({ color: "#000", emissive: PALETTE.mint, emissiveIntensity: 3, toneMapped: false }), []);
  const core = useRef<Mesh>(null);
  const lastResult = useWorld((s) => {
    for (const e of s.lattice.feed) {
      if (e.type === "task.completed" && s.lattice.tasks[e.taskId]?.room === "foundry") return e.outcome;
    }
    return "success";
  });
  useFrame(({ clock }) => {
    const target = lastResult === "failure" ? [1, 0.25, 0.18] : [0.35, 1, 0.75];
    const c = glowMat.emissive;
    c.r += (target[0]! - c.r) * 0.05;
    c.g += (target[1]! - c.g) * 0.05;
    c.b += (target[2]! - c.b) * 0.05;
    glowMat.emissiveIntensity = 2.6 + Math.sin(clock.elapsedTime * 5) * 0.4;
    if (core.current) core.current.rotation.y = clock.elapsedTime * 0.6;
  });
  return (
    <group position={position}>
      <Block size={[2.3, 2.7, 2]} position={[0, 1.35, 0]} material={PBR.steel()} radius={0.12} />
      {/* Inspection window */}
      <mesh position={[0, 1.4, 1.005]} material={glowMat}>
        <planeGeometry args={[1.3, 1.1]} />
      </mesh>
      <Block size={[1.5, 0.1, 0.1]} position={[0, 2.02, 1.02]} material={PBR.blackMetal()} radius={0.02} />
      <Block size={[1.5, 0.1, 0.1]} position={[0, 0.8, 1.02]} material={PBR.blackMetal()} radius={0.02} />
      {/* Vents */}
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} size={[0.9, 0.04, 0.06]} position={[0, 2.35 - i * 0.08, 1.02]} material={PBR.blackMetal()} radius={0.01} />
      ))}
      {/* Exhaust stack */}
      <mesh position={[0.6, 3.4, -0.4]} material={PBR.steel()} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 1.6, 24]} />
      </mesh>
      <mesh ref={core} position={[0, 1.4, 0.6]} material={glowMat}>
        <octahedronGeometry args={[0.18, 0]} />
      </mesh>
    </group>
  );
}

/** The Foundry: an industrial hall. Code arrives as crates, the arm assembles it, the furnace tests it. */
export function Foundry() {
  const crates = useRef<InstancedMesh>(null);
  const crateGeo = useMemo(() => new RoundedBoxGeometry(0.62, 0.48, 0.48, 2, 0.04), []);
  const trolley = useRef<Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (crates.current) {
      for (let i = 0; i < CRATES; i++) {
        const u = ((t * 0.07 + i / CRATES) % 1) * 13.6 - 6.8;
        dummy.position.set(u, BELT_Y + 0.27, CONVEYOR_Z);
        dummy.rotation.set(0, (i % 3) * 0.04, 0);
        const fade = Math.min(1, (6.8 - Math.abs(u)) * 1.5);
        dummy.scale.setScalar(Math.max(0.001, fade));
        dummy.updateMatrix();
        crates.current.setMatrixAt(i, dummy.matrix);
      }
      crates.current.instanceMatrix.needsUpdate = true;
    }
    if (trolley.current) trolley.current.position.x = Math.sin(t * 0.18) * 5.5;
  });

  const benches = ROOMS.foundry.stations.filter((s) => s.id.startsWith("bench"));
  const bench = PBR.lacquer("#2c333d", 0.5);

  return (
    <group>
      <Plinth floor={PBR.concreteFloor([3, 3])} edge={PBR.steel()} accent="#ffb067" />
      {/* Grated service lane under the conveyor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, CONVEYOR_Z]} material={PBR.gratingFloor([14, 2])} receiveShadow>
        <planeGeometry args={[15.6, 2.2]} />
      </mesh>
      {/* Safety lines */}
      {[-1.25, 1.25].map((dz) => (
        <mesh key={dz} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, CONVEYOR_Z + dz]} material={PBR.matte(SAFETY, 0.7)}>
          <planeGeometry args={[15.6, 0.08]} />
        </mesh>
      ))}

      {/* Back wall: ribbed steel cladding with a clerestory light band */}
      <group position={[0, 0, -6.55]}>
        <Block size={[16.4, 5.6, 0.3]} position={[0, 2.8, 0]} material={PBR.matte("#1b1f25", 0.7)} radius={0.04} />
        {Array.from({ length: 28 }, (_, i) => (
          <Block key={i} size={[0.07, 5.4, 0.1]} position={[-7.9 + i * 0.585, 2.8, 0.18]} material={PBR.steel()} radius={0.01} shadows={false} />
        ))}
        <LightBar length={15.6} position={[0, 4.9, 0.3]} color="#ffe4c2" intensity={2.2} thickness={0.06} />
      </group>

      {/* Gantry: two portal frames and a running crane */}
      {[-7.6, 7.6].map((x) => (
        <group key={x}>
          <Block size={[0.4, 6, 0.4]} position={[x, 3, -5.8]} material={PBR.steel()} radius={0.03} />
          <Block size={[0.4, 6, 0.4]} position={[x, 3, 1.2]} material={PBR.steel()} radius={0.03} />
          <IBeam length={7.4} position={[x, 5.9, -2.3]} rotation={[0, Math.PI / 2, 0]} />
        </group>
      ))}
      <IBeam length={15.6} position={[0, 6.2, -2.6]} />
      <group ref={trolley} position={[0, 5.85, -2.6]}>
        <Block size={[0.8, 0.35, 0.6]} material={PBR.lacquer(SAFETY, 0.4)} radius={0.05} />
        <mesh position={[0, -1.1, 0]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.015, 0.015, 1.9, 6]} />
        </mesh>
        <mesh position={[0, -2.1, 0]} rotation={[0, 0, Math.PI]} material={PBR.steel()} castShadow>
          <torusGeometry args={[0.12, 0.035, 10, 24, Math.PI * 1.4]} />
        </mesh>
      </group>
      {[-4.5, 0, 4.5].map((x) => (
        <HangingLamp key={x} position={[x, 4.1, 0.6]} />
      ))}

      {/* Conveyor: frame, legs, rollers, belt, rails */}
      <group position={[0, 0, CONVEYOR_Z]}>
        <Block size={[14.4, 0.14, 1.3]} position={[0, BELT_Y - 0.1, 0]} material={PBR.steel()} radius={0.03} />
        <mesh position={[0, BELT_Y, 0]} material={PBR.matte("#16181b", 0.95)} receiveShadow>
          <boxGeometry args={[14, 0.04, 1.1]} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i} position={[-6.6 + i * 1.88, 0, 0]}>
            {[-0.55, 0.55].map((z) => (
              <Block key={z} size={[0.1, BELT_Y - 0.15, 0.1]} position={[0, (BELT_Y - 0.15) / 2, z]} material={PBR.steel()} radius={0.01} />
            ))}
          </group>
        ))}
        {Array.from({ length: 29 }, (_, i) => (
          <mesh key={i} position={[-7 + i * 0.5, BELT_Y - 0.06, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.chrome()}>
            <cylinderGeometry args={[0.05, 0.05, 1.22, 12]} />
          </mesh>
        ))}
        {[-0.62, 0.62].map((z) => (
          <Block key={z} size={[14.2, 0.1, 0.05]} position={[0, BELT_Y + 0.18, z]} material={PBR.lacquer(SAFETY, 0.45)} radius={0.015} />
        ))}
        <instancedMesh ref={crates} args={[crateGeo, PBR.wood("oak"), CRATES]} castShadow receiveShadow frustumCulled={false} />
      </group>

      {/* Intake hopper */}
      <group position={[-6.9, 0, CONVEYOR_Z]}>
        <Block size={[1.4, 1.2, 1.6]} position={[0, 2.2, 0]} material={PBR.steel()} radius={0.08} />
        <mesh position={[0, 1.45, 0]} rotation={[Math.PI, 0, 0]} material={PBR.steel()} castShadow>
          <cylinderGeometry args={[0.7, 0.25, 0.5, 4, 1, true]} />
        </mesh>
      </group>

      <RobotArm position={[-1.2, 0, CONVEYOR_Z - 1.3]} />
      <Furnace position={[3.4, 0, CONVEYOR_Z - 0.2]} />

      {/* Shipping dock: roller door and a pallet stack */}
      <group position={[7.6, 0, 2.6]}>
        <Block size={[0.3, 3.4, 3]} position={[0.3, 1.7, 0]} material={PBR.steel()} radius={0.03} />
        {Array.from({ length: 12 }, (_, i) => (
          <Block key={i} size={[0.06, 0.22, 2.5]} position={[0.1, 0.3 + i * 0.24, 0]} material={PBR.aluminium()} radius={0.01} shadows={false} />
        ))}
        <LightBar length={2.6} position={[0, 3.3, 0]} rotation={[0, Math.PI / 2, 0]} color={PALETTE.mint} intensity={2.4} />
        <group position={[-0.9, 0, -0.7]}>
          <Block size={[1.1, 0.14, 1.1]} position={[0, 0.07, 0]} material={PBR.wood("oak")} radius={0.01} />
          <Block size={[0.62, 0.48, 0.48]} position={[-0.2, 0.38, -0.2]} material={PBR.wood("oak")} radius={0.04} />
          <Block size={[0.62, 0.48, 0.48]} position={[0.2, 0.38, 0.25]} material={PBR.wood("oak")} radius={0.04} />
        </group>
      </group>

      {benches.map((b, i) => (
        <group key={b.id}>
          <Workstation stand={[b.x, b.z]} facing={b.facing} top={bench} color={PALETTE.ice} seed={i * 3} monitors={2} chair={false} />
        </group>
      ))}
      {/* Pegboard of tools behind the benches (toward the camera, low) */}
      <Block size={[1.4, 0.9, 0.9]} position={[3, 0.45, 4.4]} material={PBR.lacquer("#a83a2a", 0.4)} radius={0.06} />
      <Block size={[1.4, 0.05, 0.9]} position={[3, 0.62, 4.4]} material={PBR.blackMetal()} radius={0.01} shadows={false} />

      <pointLight position={[0, 4, 1]} color="#ffc48a" intensity={30} distance={18} decay={1.6} />
    </group>
  );
}
