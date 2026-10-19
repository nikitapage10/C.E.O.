import { ROOMS } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, Object3D, type Group, type InstancedMesh, type Mesh } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Beam, Haze, Smoke, Sparks } from "../fx/atmos.tsx";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { useFoundry } from "../foundry.ts";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { WorkCrates, useHasWork } from "./WorkCrates.tsx";
import { AlarmPost, BenchLight, DraftingTable, SpareDock } from "./FoundryCrew.tsx";
import { Block, LightBar, Plinth, Workstation } from "./primitives.tsx";
import { ShippedWall } from "./ShippedWall.tsx";

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

/** The test furnace. Its glow is the last test result in this room (the real checks on main): cool green for pass, hot red for fail. */
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

const CARD_COLOURS = ["#f4e9c8", "#ffd9a8", "#d8ecf4"];

/**
 * Rusty's idea board, on top of the pegboard: one card for each idea waiting on the C.E.O. (the morning three),
 * pinned with a brass tack. Empty cork when there are none.
 */
function IdeaBoard() {
  const ideas = useFoundry((s) => s.data.crates.filter((c) => c.kind === "idea" && c.state === "queued").length);
  return (
    <group position={[3, 0.9, 4.4]}>
      {[-0.55, 0.55].map((x) => (
        <Block key={x} size={[0.05, 0.85, 0.05]} position={[x, 0.42, 0]} material={PBR.blackMetal()} radius={0.01} />
      ))}
      <Block size={[1.3, 0.72, 0.05]} position={[0, 0.5, 0]} material={PBR.matte("#9a7448", 0.9)} radius={0.02} />
      {Array.from({ length: Math.min(ideas, 6) }, (_, i) => (
        <group key={i} position={[-0.42 + (i % 3) * 0.42, i < 3 ? 0.62 : 0.34, 0.03]} rotation={[0, 0, ((i * 37) % 9) / 60 - 0.07]}>
          <mesh material={PBR.matte(CARD_COLOURS[i % 3]!, 0.95)}>
            <planeGeometry args={[0.32, 0.22]} />
          </mesh>
          <mesh position={[0, 0.08, 0.01]} material={PBR.light("#ffcf6a", 1.5)}>
            <sphereGeometry args={[0.018, 8, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A lamp over the dock that glows amber while finished work waits for the C.E.O.'s OK. */
function DockLamp() {
  const waiting = useFoundry((s) => s.data.crates.some((c) => c.state === "ready"));
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#222", emissive: "#ffb347", emissiveIntensity: 0, toneMapped: false }), []);
  useFrame(({ clock }) => {
    mat.emissiveIntensity = waiting ? 3 + Math.sin(clock.elapsedTime * 3) * 1.2 : 0.05;
  });
  return (
    <group position={[7.3, 3.7, 1.0]}>
      <mesh material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.13, 0.15, 0.08, 16]} />
      </mesh>
      <mesh position={[0, -0.12, 0]} material={mat}>
        <sphereGeometry args={[0.12, 16, 16]} />
      </mesh>
    </group>
  );
}

/** A red alarm at the intake that spins only when a crate is stuck after every rung. */
function StuckAlarm() {
  const stuck = useFoundry((s) => s.data.crates.some((c) => c.state === "stuck"));
  const head = useRef<Group>(null);
  useFrame((_, dt) => {
    if (head.current) head.current.rotation.y += dt * 6;
  });
  if (!stuck) return null;
  return (
    <group position={[-6.9, 2.95, CONVEYOR_Z]}>
      <mesh material={PBR.glass("#ff4a3a", 0.5)}>
        <cylinderGeometry args={[0.1, 0.1, 0.2, 16]} />
      </mesh>
      <group ref={head}>
        <mesh position={[0.04, 0, 0]} material={PBR.light("#ff3b2f", 6)}>
          <boxGeometry args={[0.03, 0.12, 0.08]} />
        </mesh>
        <group rotation={[0, 0, -Math.PI / 2]}>
          <Beam length={2.6} radius={0.5} color="#ff3b2f" opacity={0.16} />
        </group>
      </group>
    </group>
  );
}

/** The Foundry: an industrial hall. Today's work arrives as labelled crates, the arm assembles it, the furnace tests it. */
export function Foundry() {
  const crates = useRef<InstancedMesh>(null);
  const crateGeo = useMemo(() => new RoundedBoxGeometry(0.62, 0.48, 0.48, 2, 0.04), []);
  const trolley = useRef<Group>(null);
  const hasWork = useHasWork();

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
        {/* Today's real work rides the belt; plain crates only when there's none yet. */}
        <instancedMesh ref={crates} args={[crateGeo, PBR.wood("oak"), CRATES]} visible={!hasWork} castShadow receiveShadow frustumCulled={false} />
        <WorkCrates y={BELT_Y + 0.27} z={0} />
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

      {/* Rusty's two workbenches, front and centre: the front left stays clear so the dock is in full view (#110). */}
      {benches.map((b, i) => (
        <group key={b.id}>
          <Workstation stand={[b.x, b.z]} facing={b.facing} top={bench} color={PALETTE.ice} seed={i * 3} monitors={2} chair={false} />
          {/* The bench's work light, in the model of whoever is working here. */}
          <BenchLight station={b.id} position={[b.x + 0.74, 0.785, b.z + 0.62]} />
        </group>
      ))}
      <SpareDock />
      <DraftingTable />
      <AlarmPost />
      {/* Pegboard of tools behind the benches (toward the camera, low) */}
      <Block size={[1.4, 0.9, 0.9]} position={[3, 0.45, 4.4]} material={PBR.lacquer("#a83a2a", 0.4)} radius={0.06} />
      <Block size={[1.4, 0.05, 0.9]} position={[3, 0.62, 4.4]} material={PBR.blackMetal()} radius={0.01} shadows={false} />
      <IdeaBoard />
      <ShippedWall />
      <DockLamp />
      <StuckAlarm />

      <FoundryFloor />
      <FoundryAir />
      <pointLight position={[0, 4, 1]} color="#ffc48a" intensity={30} distance={18} decay={1.6} />
    </group>
  );
}

/** A rotating amber beacon, the kind that lives on a crane. */
function Beacon({ position }: { position: [number, number, number] }) {
  const head = useRef<Group>(null);
  useFrame((_, dt) => {
    if (head.current) head.current.rotation.y += dt * 4;
  });
  return (
    <group position={position}>
      <mesh material={PBR.blackMetal()}>
        <cylinderGeometry args={[0.09, 0.1, 0.06, 16]} />
      </mesh>
      <mesh position={[0, 0.1, 0]} material={PBR.glass("#ffb347", 0.55)}>
        <cylinderGeometry args={[0.07, 0.07, 0.14, 16]} />
      </mesh>
      <group ref={head} position={[0, 0.1, 0]}>
        <mesh position={[0.03, 0, 0]} material={PBR.light("#ffa23a", 5)}>
          <boxGeometry args={[0.02, 0.08, 0.06]} />
        </mesh>
        <group rotation={[0, 0, -Math.PI / 2]}>
          <Beam length={2.2} radius={0.45} color="#ffa23a" opacity={0.12} />
        </group>
      </group>
    </group>
  );
}

/** The working floor: stock, lockers, a workshop corner, cables and vents, so the hall looks lived in. */
function FoundryFloor() {
  return (
    <group>
      {/* Stock along the front wall on the right, beside the big tarped crate. Nothing stands in the front left
          corner, so the dock against the left wall is in full view (Nikita, 2026-10-13). */}
      <Model id="scifi-essentials/Prop_Crate_Tarp" fit={{ height: 0.9 }} position={[3.9, 0, 5.85]} rotation={-0.6} cast />
      <Model id="scifi-essentials/Prop_Crate_Large" fit={{ height: 0.8 }} position={[4.9, 0, 5.85]} rotation={-0.15} cast />
      <Model id="scifi-essentials/Prop_Crate" fit={{ height: 0.55 }} position={[5.65, 0, 5.9]} rotation={0.4} cast />
      <Model id="scifi-essentials/Prop_Crate_Tarp_Large" fit={{ height: 1.3 }} position={[6.6, 0, 5.45]} rotation={-0.2} cast />
      {/* Lockers and tall shelving against the side walls. */}
      {[-0.4, 0.4, 1.2].map((z) => (
        <Model key={z} id="scifi-essentials/Prop_Locker" fit={{ height: 2.0 }} position={[-7.75, 0, z]} rotation={Math.PI / 2} cast />
      ))}
      <Model id="scifi-essentials/Prop_Shelves_WideTall" fit={{ height: 2.6 }} position={[7.6, 0, -4.6]} rotation={-Math.PI / 2} cast />
      <Model id="scifi-essentials/Prop_Shelves_WideTall" fit={{ height: 2.6 }} position={[7.6, 0, -2.4]} rotation={-Math.PI / 2} cast />
      {/* Workshop corner by the pegboard: an anvil, a bucket, a coil of chain. */}
      <Model id="fantasy-props/Anvil" fit={{ height: 0.7 }} position={[1.6, 0, 4.9]} rotation={0.4} cast />
      <Model id="fantasy-props/Bucket_Metal" fit={{ height: 0.35 }} position={[2.1, 0, 5.4]} />
      <Model id="fantasy-props/Chain_Coil" fit={{ scale: 1.2 }} position={[3.9, 0, 5.7]} rotation={1.2} />
      {/* Pipes up the back corners, cables across the floor, vents on the back wall. */}
      {[-7.7, 7.7].map((x) => (
        <Model key={x} id="scifi-modular/Columns/Column_Pipes" fit={{ height: 5.4 }} position={[x, 0, -6.1]} cast />
      ))}
      <Model id="scifi-modular/Props/Prop_Cable_3" fit={{ scale: 1.4 }} position={[-3.4, 0.01, 1.3]} rotation={0.3} />
      <Model id="scifi-modular/Props/Prop_Cable_1" fit={{ scale: 1.4 }} position={[2.4, 0.01, 1.0]} rotation={-0.8} />
      {[-5, -2.5, 5].map((x) => (
        <Model key={x} id="scifi-modular/Props/Prop_Vent_Big" fit={{ length: 1.2 }} position={[x, 3.6, -6.36]} />
      ))}
      {/* Floor lights along the walkway. */}
      {[-6, -3, 0, 3, 6].map((x) => (
        <Model key={x} id="scifi-modular/Props/Prop_Light_Floor" fit={{ length: 0.4 }} position={[x, 0, -0.4]} />
      ))}
      {/* Hazard stripes round the furnace. */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[1.95 + i * 0.36, 0.009, -1.25]} material={PBR.matte(i % 2 ? "#1a1a1a" : SAFETY, 0.7)}>
          <planeGeometry args={[0.24, 0.5]} />
        </mesh>
      ))}
      <Beacon position={[-7.6, 6.05, 1.2]} />
      <Beacon position={[7.6, 6.05, 1.2]} />
    </group>
  );
}

/**
 * The air in the hall: furnace exhaust, sparks where the arm welds, a steam vent at the intake, a warm haze,
 * and shafts of light from the clerestory.
 */
function FoundryAir() {
  return (
    <group>
      <Smoke position={[4.0, 4.25, CONVEYOR_Z - 0.6]} count={26} rate={0.1} height={3.4} spread={1.1} sizes={[0.45, 2.2]} wind={[-1.2, 0, 0.6]} color="#6d6a66" opacity={0.42} />
      <Sparks position={[-1.2, BELT_Y + 0.42, CONVEYOR_Z]} dir={[0.2, 1, 0.5]} count={46} rate={1.6} speed={2.2} cone={0.9} color="#ffb347" intensity={5} />
      <Smoke position={[-6.2, 0.05, -0.7]} count={14} rate={0.22} height={1.6} spread={0.4} sizes={[0.2, 0.9]} wind={[0.4, 0, 0.2]} color="#d8dde4" opacity={0.25} />
      <Haze min={[-7.5, 0.4, -6]} size={[15, 4.6, 11]} count={34} puff={2.8} color="#c4a588" opacity={0.045} />
      {[-4.5, 0, 4.5].map((x) => (
        <group key={x} position={[x, 5.1, -6.2]} rotation={[-0.75, 0, 0.12]}>
          <Beam length={7} radius={0.9} color="#ffd9a8" opacity={0.09} />
        </group>
      ))}
    </group>
  );
}
