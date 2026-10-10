import { getStation } from "@ceo/core";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CatmullRomCurve3, Object3D, TubeGeometry, Vector3, type Group, type InstancedMesh, type Mesh } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Dust, Haze } from "../fx/atmos.tsx";
import { Model, ModelInstances } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { Block, Chair, FONTS, Plinth, ahead } from "./primitives.tsx";

const dummy = new Object3D();
const BOX_COLS = 16;
const BOX_ROWS = 7;

/** A wall of brass post-office boxes. */
function PostBoxes() {
  const doors = useRef<InstancedMesh>(null);
  const windows = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new RoundedBoxGeometry(0.62, 0.5, 0.06, 2, 0.02), []);
  useEffect(() => {
    for (let r = 0; r < BOX_ROWS; r++)
      for (let c = 0; c < BOX_COLS; c++) {
        const i = r * BOX_COLS + c;
        dummy.position.set(-5.2 + c * 0.69, 1.2 + r * 0.56, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        doors.current?.setMatrixAt(i, dummy.matrix);
        dummy.position.z = 0.035;
        dummy.position.y += 0.08;
        dummy.scale.set(0.5, 0.35, 1);
        dummy.updateMatrix();
        windows.current?.setMatrixAt(i, dummy.matrix);
      }
    if (doors.current) doors.current.instanceMatrix.needsUpdate = true;
    if (windows.current) windows.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group position={[0, 0, -6.2]}>
      <Block size={[11.6, 4.6, 0.4]} position={[-0.35, 3, -0.22]} material={PBR.wood("walnut")} radius={0.04} />
      <instancedMesh ref={doors} args={[geo, PBR.brass(), BOX_COLS * BOX_ROWS]} castShadow receiveShadow />
      <instancedMesh ref={windows} args={[undefined, PBR.glass("#30251a", 0.85), BOX_COLS * BOX_ROWS]}>
        <planeGeometry args={[0.5, 0.3]} />
      </instancedMesh>
      <Text font={FONTS.serifUpright} fontSize={0.42} position={[-0.35, 5.5, 0]} letterSpacing={0.3} color="#c9a25c">
        THE RELAY · POSTAL &amp; TELEGRAPH
      </Text>
    </group>
  );
}

/** Copper pneumatic tubes with glass windows; canisters shoot down into the receiving station. */
function Tubes({ position }: { position: [number, number] }) {
  const canisters = useRef<Group>(null);
  useFrame(({ clock }) => {
    canisters.current?.children.forEach((c, i) => {
      const u = (clock.elapsedTime * (0.35 + i * 0.07) + i * 0.4) % 1;
      c.position.y = 5.6 - u * 4.4;
    });
  });
  return (
    <group position={[position[0], 0, position[1] - 1.2]}>
      {[-1.2, -0.4, 0.4, 1.2].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 4.6, 0]} material={PBR.copper()} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 2.4, 24]} />
          </mesh>
          <mesh position={[0, 2.4, 0]} material={PBR.glass("#f4e6d0", 0.25)}>
            <cylinderGeometry args={[0.13, 0.13, 2, 24, 1, true]} />
          </mesh>
          {[1.4, 3.4].map((y) => (
            <mesh key={y} position={[0, y, 0]} material={PBR.brass()}>
              <torusGeometry args={[0.15, 0.03, 10, 24]} />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={canisters}>
        {[-1.2, -0.4, 0.4, 1.2].map((x) => (
          <mesh key={x} position={[x, 3, 0]} material={PBR.brass()}>
            <capsuleGeometry args={[0.09, 0.22, 6, 16]} />
          </mesh>
        ))}
      </group>
      <Block size={[3.4, 1.3, 0.9]} position={[0, 0.65, 0]} material={PBR.wood("walnut")} radius={0.05} />
      <Block size={[3.5, 0.06, 1]} position={[0, 1.33, 0]} material={PBR.brass()} radius={0.02} />
    </group>
  );
}

/** A switchboard: walnut cabinet, jack panel, patch cords looping between sockets. */
function Switchboard({ position, yaw }: { position: [number, number]; yaw: number }) {
  const lamps = useRef<Group>(null);
  const cords = useMemo(
    () =>
      [
        [[-0.6, 1.5], [0.3, 1.9], "#8c2f2f"],
        [[-0.2, 1.7], [0.6, 1.3], "#1f1f22"],
        [[0.1, 2.1], [-0.4, 1.3], "#8c2f2f"],
      ].map(([a, b, color]) => {
        const [ax, ay] = a as number[];
        const [bx, by] = b as number[];
        const curve = new CatmullRomCurve3([
          new Vector3(ax, ay, 0.06),
          new Vector3((ax! + bx!) / 2, Math.min(ay!, by!) - 0.5, 0.35),
          new Vector3(bx, by, 0.06),
        ]);
        return { geo: new TubeGeometry(curve, 32, 0.012, 6, false), color: color as string };
      }),
    [],
  );
  useFrame(({ clock }) => {
    lamps.current?.children.forEach((l, i) => {
      l.visible = Math.sin(clock.elapsedTime * (0.9 + (i % 5) * 0.5) + i * 2.1) > 0.2;
    });
  });
  return (
    <group position={[position[0], 0, position[1]]} rotation={[0, yaw, 0]}>
      <Block size={[2.2, 2.5, 0.6]} position={[0, 1.25, -0.3]} material={PBR.wood("walnut")} radius={0.05} />
      <Block size={[1.8, 1.2, 0.04]} position={[0, 1.7, 0.01]} material={PBR.matte("#14100c", 0.8)} radius={0.01} />
      <group ref={lamps} position={[-0.75, 1.3, 0.04]}>
        {Array.from({ length: 30 }, (_, i) => (
          <mesh key={i} position={[(i % 6) * 0.3, Math.floor(i / 6) * 0.2, 0]} material={PBR.light(i % 4 ? "#ffcf8a" : "#ff8a6a", 3)}>
            <circleGeometry args={[0.03, 16]} />
          </mesh>
        ))}
      </group>
      {cords.map((c, i) => (
        <mesh key={i} geometry={c.geo} material={PBR.lacquer(c.color, 0.5)} castShadow />
      ))}
      <Block size={[2.2, 0.06, 0.5]} position={[0, 1, 0.15]} material={PBR.brass()} radius={0.02} />
    </group>
  );
}

/** A banker's lamp: brass stem, green glass shade, warm pool of light. */
function BankersLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.02, 0]} material={PBR.brass()} castShadow>
        <cylinderGeometry args={[0.1, 0.12, 0.04, 24]} />
      </mesh>
      <mesh position={[0, 0.2, 0]} material={PBR.brass()}>
        <cylinderGeometry args={[0.012, 0.012, 0.36, 8]} />
      </mesh>
      <mesh position={[0, 0.4, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.lacquer("#1f5a3a", 0.15)} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.42, 24, 1, false, 0, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.36, 0]} rotation={[0, 0, Math.PI / 2]} material={PBR.light("#ffd59a", 3.5)}>
        <cylinderGeometry args={[0.02, 0.02, 0.32, 8]} />
      </mesh>
    </group>
  );
}

/** The Relay: an art-deco post office, where messages arrive by tube and wait in the outbox for your nod. */
export function Relay() {
  const beacon = useRef<Mesh>(null);
  const pendingMsg = useWorld((s) => Object.values(s.lattice.approvals).some((a) => a.status === "pending" && a.request.action === "message.send"));
  const tubes = getStation("relay", "tubes");
  const draft = getStation("relay", "draft-desk");
  const outbox = ahead(getStation("relay", "outbox"), 0.85);
  const board = ahead(getStation("relay", "switchboard"), 0.9);
  const walnut = PBR.wood("walnut");

  useFrame(({ clock }) => {
    if (beacon.current) beacon.current.scale.setScalar(pendingMsg ? 1 + Math.sin(clock.elapsedTime * 5) * 0.2 : 0.0001);
  });

  return (
    <group>
      <Plinth floor={PBR.wood("oak", [3, 3])} edge={PBR.wood("walnut")} accent="#e8c27a" />
      {/* A runner rug down the middle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 1.5]} material={PBR.carpet("#5a1f24", [2, 4])} receiveShadow>
        <planeGeometry args={[3.2, 7.5]} />
      </mesh>
      <PostBoxes />
      {/* Fluted brass pilasters */}
      {[-7.6, 7.6].map((x) => (
        <group key={x} position={[x, 0, -6.1]}>
          {[-0.12, 0, 0.12].map((dx) => (
            <mesh key={dx} position={[dx, 2.8, 0]} material={PBR.brass()} castShadow>
              <cylinderGeometry args={[0.05, 0.05, 5.6, 12]} />
            </mesh>
          ))}
          <Block size={[0.5, 0.3, 0.3]} position={[0, 5.7, 0]} material={PBR.brass()} radius={0.04} />
        </group>
      ))}
      <Tubes position={[tubes.x, tubes.z]} />
      {/* Writing desk with a banker's lamp */}
      <group position={[draft.x, 0, draft.z - 0.85]}>
        <Block size={[2, 0.08, 0.95]} position={[0, 0.78, 0]} material={walnut} radius={0.02} />
        <Block size={[0.6, 0.74, 0.85]} position={[-0.65, 0.37, 0]} material={walnut} radius={0.03} />
        <Block size={[0.6, 0.74, 0.85]} position={[0.65, 0.37, 0]} material={walnut} radius={0.03} />
        <Block size={[0.5, 0.01, 0.35]} position={[0.1, 0.83, 0.1]} material={PBR.matte("#efe8d8", 0.9)} radius={0.002} />
        <BankersLamp position={[-0.6, 0.82, -0.2]} />
      </group>
      <Chair position={[draft.x + 0.7, 0, draft.z + 0.4]} rotation={Math.PI - 0.4} seat={PBR.fabric("#3a2a22")} />
      {/* Outbox: a brass-fronted cabinet with a beacon */}
      <group position={[outbox.pos[0], 0, outbox.pos[1]]} rotation={[0, outbox.yaw, 0]}>
        <Block size={[1.5, 1.1, 0.8]} position={[0, 0.55, 0]} material={walnut} radius={0.04} />
        <Block size={[1.1, 0.12, 0.02]} position={[0, 0.85, 0.41]} material={PBR.brass()} radius={0.01} />
        {[0, 1, 2].map((i) => (
          <Block key={i} size={[0.7, 0.025, 0.45]} position={[0.05 * i, 1.13 + i * 0.03, 0]} rotation={[0, i * 0.15, 0]} material={PBR.matte("#efe8d8", 0.9)} radius={0.004} />
        ))}
        <mesh ref={beacon} position={[0.55, 1.35, 0]} material={PBR.light("#ffb347", 4)}>
          <sphereGeometry args={[0.07, 20, 16]} />
        </mesh>
        <Text font={FONTS.mono} fontSize={0.075} position={[0, 0.65, 0.41]} letterSpacing={0.2} color="#c9a25c">
          OUTBOX · AWAITING THE C.E.O.
        </Text>
      </group>
      <Switchboard position={board.pos} yaw={board.yaw} />
      {/* Deco pendant lamps */}
      {[-3, 3].map((x) => (
        <group key={x} position={[x, 4.2, 1]}>
          <mesh position={[0, 1, 0]} material={PBR.brass()}>
            <cylinderGeometry args={[0.008, 0.008, 2, 6]} />
          </mesh>
          <mesh material={PBR.frosted("#f6ead6")} castShadow>
            <sphereGeometry args={[0.28, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, -0.02, 0]} material={PBR.light("#ffd59a", 4)}>
            <sphereGeometry args={[0.12, 16, 16]} />
          </mesh>
        </group>
      ))}
      <SortingFloor />
      <pointLight position={[0, 4.5, 1]} color="#ffd29a" intensity={24} distance={16} decay={1.6} />
    </group>
  );
}

/** The sorting floor: a table heaped with letters and parcels, a mail cart, sacks waiting by the door, lanterns. */
function SortingFloor() {
  const paper = PBR.matte("#efe8d8", 0.9);
  const letters = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        x: -1.1 + ((i * 37) % 22) / 10,
        z: -0.35 + ((i * 53) % 7) / 10,
        r: (i * 0.7) % Math.PI,
        y: (i % 4) * 0.008,
      })),
    [],
  );
  return (
    <group>
      {/* Sorting table, front right. */}
      <group position={[4.8, 0, 4.4]}>
        <Model id="fantasy-props/Table_Large" fit={{ height: 0.8 }} rotation={Math.PI / 2} cast />
        {letters.map((l, i) => (
          <mesh key={i} position={[l.x, 0.81 + l.y, l.z]} rotation={[-Math.PI / 2, 0, l.r]} material={i % 5 ? paper : PBR.matte("#c9a25c", 0.8)}>
            <planeGeometry args={[0.2, 0.12]} />
          </mesh>
        ))}
        <Block size={[0.35, 0.22, 0.28]} position={[0.8, 0.92, 0.1]} material={PBR.matte("#a07a4a", 0.9)} radius={0.01} />
        <Block size={[0.25, 0.16, 0.2]} position={[0.85, 1.11, 0.12]} rotation={[0, 0.4, 0]} material={PBR.matte("#b58c5a", 0.9)} radius={0.01} />
        <Model id="fantasy-props/Chair_1" fit={{ height: 0.95 }} position={[-0.4, 0, 0.95]} rotation={Math.PI + 0.3} cast />
      </group>
      {/* A mail cart loaded with sacks. */}
      <group position={[6.6, 0, 1.6]} rotation={[0, -0.5, 0]}>
        <Model id="fantasy-props/Stall_Cart_Empty" fit={{ length: 1.8 }} cast />
        <Model id="fantasy-props/Bag" fit={{ height: 0.55 }} position={[0.1, 0.55, 0]} rotation={0.6} cast />
        <Model id="fantasy-props/Pouch_Large" fit={{ height: 0.45 }} position={[-0.35, 0.55, 0.1]} rotation={2} cast />
      </group>
      {/* Parcels and sacks stacked by the door, front left. */}
      <ModelInstances id="fantasy-props/Crate_Wooden" fit={{ height: 0.55 }} at={[{ position: [-6.9, 0, 5.3], rotation: 0.2 }, { position: [-6.3, 0, 5.6], rotation: 1.1 }, { position: [-6.8, 0.55, 5.4], rotation: 0.7, scale: 0.8 }]} cast />
      <ModelInstances id="fantasy-props/Bag" fit={{ height: 0.6 }} at={[{ position: [-7.3, 0, 4.4], rotation: 0.4 }, { position: [-5.7, 0, 5.8], rotation: 2.1 }]} cast />
      <Model id="fantasy-props/Barrel" fit={{ height: 0.8 }} position={[-7.4, 0, 3.4]} cast />
      {/* A free-standing pigeonhole cabinet, letters sticking out of some of the slots. */}
      <group position={[-7.25, 0, 3.0]} rotation={[0, Math.PI / 2, 0]}>
        <Block size={[1.8, 2.0, 0.45]} position={[0, 1.0, 0]} material={PBR.wood("walnut")} radius={0.03} />
        {Array.from({ length: 24 }, (_, i) => (
          <group key={i} position={[-0.72 + (i % 6) * 0.29, 1.15 + Math.floor(i / 6) * 0.22, 0.2]}>
            <mesh material={PBR.matte("#1a120c", 0.9)}>
              <boxGeometry args={[0.25, 0.18, 0.02]} />
            </mesh>
            {(i * 7) % 3 === 0 && (
              <mesh position={[0, 0.02, 0.04]} rotation={[-0.3, 0, (i % 2) * 0.1]} material={paper}>
                <planeGeometry args={[0.18, 0.12]} />
              </mesh>
            )}
          </group>
        ))}
        <Model id="fantasy-props/Key_Gold" fit={{ length: 0.18 }} position={[0.6, 0.95, 0.24]} />
      </group>
      <Model id="fantasy-props/Pouch_Large" fit={{ height: 0.5 }} position={[-1.6, 0, -4.2]} rotation={1.2} cast />
      <Model id="fantasy-props/Bag" fit={{ height: 0.55 }} position={[1.5, 0, -4.3]} rotation={-0.6} cast />
      {/* Lanterns on the pilasters. */}
      {[-7.6, 7.6].map((x) => (
        <Model key={x} id="fantasy-props/Lantern_Wall" fit={{ height: 0.6 }} position={[x, 3.2, -5.9]} />
      ))}
      {/* Warm dust in the lamplight and a few flecks of paper drifting about. */}
      <Dust min={[-7, 0.5, -5.5]} size={[14, 4, 11]} count={60} color="#ffd9a0" opacity={0.45} />
      <Haze min={[-6, 0.6, -4]} size={[12, 3, 9]} count={18} puff={0.07} color="#f4ecdc" opacity={0.9} drift={0.6} />
    </group>
  );
}
