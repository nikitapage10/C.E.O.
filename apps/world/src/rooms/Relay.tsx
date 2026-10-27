import { getStation } from "@ceo/core";
import { Text } from "../fx/Text.tsx";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CatmullRomCurve3, Object3D, TubeGeometry, Vector3, type Group, type InstancedMesh, type Mesh } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Dust, Haze } from "../fx/atmos.tsx";
import { Model, ModelInstances } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { emailLine, startEmail, useEmail } from "../desk/email/email.ts";
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

/**
 * Copper pneumatic tubes with glass windows. Since the inbox went live (#322) nothing practised rides them: a canister
 * drops into the receiving station only when a real new mail is counted (the public `newToday` count goes up), one per
 * mail, up to four at once. Between mails the tubes stand still, which is the honest state of a quiet inbox.
 */
function Tubes({ position }: { position: [number, number] }) {
  const canisters = useRef<Group>(null);
  const newToday = useEmail((s) => s.status?.newToday ?? null);
  const seen = useRef<number | null>(null);
  /** When each canister was sent down (seconds on the frame clock), or null while it waits at the top. */
  const sent = useRef<(number | null)[]>([null, null, null, null]);
  const owed = useRef(0);
  useEffect(() => {
    if (newToday === null) return;
    // The first answer only sets the mark; a lower count is the day turning over (Mountain midnight).
    if (seen.current !== null && newToday > seen.current) owed.current = Math.min(4, owed.current + newToday - seen.current);
    seen.current = newToday;
  }, [newToday]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const slots = sent.current;
    // Release what's owed, one tube at a time, a beat apart.
    if (owed.current > 0) {
      const last = Math.max(-1, ...slots.map((v) => v ?? -1));
      const free = slots.findIndex((v) => v === null);
      if (free >= 0 && t - last > 0.45) {
        slots[free] = t;
        owed.current--;
      }
    }
    canisters.current?.children.forEach((c, i) => {
      const at = slots[i] ?? null;
      const u = at === null ? 0 : Math.min(1, (t - at) / 1.4);
      // Ease in: the canister falls, then thumps into the station and sits a moment before it's taken.
      c.position.y = 5.6 - u * u * 4.4;
      c.visible = at !== null;
      if (at !== null && t - at > 2.4) slots[i] = null;
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
          <mesh key={x} position={[x, 5.6, 0]} material={PBR.brass()} visible={false}>
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

/** "40s ago", "3 min ago", "2 h ago": how long since Dialtone last checked the line. */
function sinceCheck(lastCheck: number | null, now: number): string {
  if (lastCheck === null) return "NOT YET";
  const s = Math.max(0, Math.round((now - lastCheck) / 1000));
  if (s < 60) return `${s}S AGO`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} MIN AGO` : `${Math.round(m / 60)} H AGO`;
}

/** The board's three counters: what Dialtone sorted, as numbers and nothing else. */
const COUNTERS = [
  { key: "needsYou", label: "NEEDS YOU", x: -0.5 },
  { key: "fyi", label: "CAN WAIT", x: 0 },
  { key: "noise", label: "NOISE", x: 0.5 },
] as const;

/** A counter: a dark window in a brass rim, the figure lit when it isn't zero. */
function Counter({ label, value, x, hot }: { label: string; value: number | null; x: number; hot: boolean }) {
  return (
    <group position={[x, 2.88, 0.09]}>
      <Block size={[0.44, 0.36, 0.02]} position={[0, 0, -0.01]} material={PBR.brass()} radius={0.012} />
      <Block size={[0.38, 0.3, 0.02]} position={[0, 0, 0]} material={PBR.matte("#0d0a07", 0.85)} radius={0.008} />
      <Text font={FONTS.serifUpright} fontSize={0.2} position={[0, 0.01, 0.015]} anchorY="middle" color={value === null ? "#5a4a30" : hot ? "#ffcf8a" : value > 0 ? "#e8d4a8" : "#8a7a60"}>
        {value === null ? "–" : String(value)}
      </Text>
      <Text font={FONTS.mono} fontSize={0.045} position={[0, -0.24, 0.015]} letterSpacing={0.16} color="#c9a25c">
        {label}
      </Text>
    </group>
  );
}

/**
 * The inbox board (#263, live since #322): a brass telegraph board by the post-office boxes, driven by the email
 * agent's public counts (desk/email/email.ts, ?view=status). Three counters (needs the C.E.O., FYI, noise today), the
 * line's state, and when Dialtone last checked: a sweep dial runs round once a minute from the last check, and the
 * sounder taps out a short click each time a new check lands. Counts only: no subject or sender ever reaches the
 * Lattice. The lamp burns while something needs the C.E.O.
 */
function InboxBoard() {
  const load = useEmail((s) => s.load);
  const status = useEmail((s) => s.status);
  const lamp = useRef<Mesh>(null);
  const needle = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const tapAt = useRef<number | null>(null);
  const seenCheck = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => startEmail(), []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const lastCheck = status?.lastCheck ?? null;
  // A new check: the sounder taps (the first reading only sets the mark).
  useEffect(() => {
    if (lastCheck !== null && seenCheck.current !== null && lastCheck !== seenCheck.current) tapAt.current = -1;
    seenCheck.current = lastCheck;
  }, [lastCheck]);
  const needs = status?.needsYou ?? 0;
  const live = status?.gmail === "connected" && (status.agent === "listening" || status.agent === "paused");
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (lamp.current) lamp.current.scale.setScalar(needs > 0 ? 1 + Math.sin(t * 3) * 0.15 : 0.6);
    // The dial: once round per minute since the last check; it rests at twelve when nothing has been checked.
    if (needle.current) {
      const f = lastCheck === null || !live ? 0 : ((Date.now() - lastCheck) % 60_000) / 60_000;
      needle.current.rotation.z = -f * Math.PI * 2;
    }
    if (tapAt.current === -1) tapAt.current = t;
    if (arm.current) {
      const since = tapAt.current === null ? 99 : t - tapAt.current;
      // Dot, dot, dash: the sounder's arm snaps down and back.
      const down = since < 0.08 || (since > 0.2 && since < 0.28) || (since > 0.4 && since < 0.62);
      arm.current.rotation.z = down ? -0.22 : 0;
      if (since > 1) tapAt.current = null;
    }
  });
  const headline = !status ? emailLine(load, status) : status.agent === "paused" ? "PAUSED · CAP REACHED" : live ? (needs > 0 ? "NEED THE C.E.O." : "ALL QUIET") : emailLine(load, status);
  const line = headline.replace(/^Email(?: agent)?:?\s*/i, "").toUpperCase();
  const counts = COUNTERS.map((c) => ({ ...c, value: status ? status[c.key] : null }));
  return (
    <group position={[6.55, 0, -5.92]}>
      <Block size={[1.7, 1.55, 0.12]} position={[0, 2.8, 0]} material={PBR.wood("walnut")} radius={0.03} />
      <Block size={[1.54, 1.38, 0.02]} position={[0, 2.8, 0.07]} material={PBR.matte("#14100c", 0.8)} radius={0.01} />
      <Text font={FONTS.mono} fontSize={0.07} position={[-0.06, 3.38, 0.09]} letterSpacing={0.2} color="#c9a25c">
        INBOX · BY TELEGRAPH
      </Text>
      <mesh ref={lamp} position={[0.66, 3.38, 0.1]} material={PBR.light(needs > 0 ? "#ffb347" : "#5a4a30", needs > 0 ? 4 : 0.6)}>
        <sphereGeometry args={[0.05, 16, 12]} />
      </mesh>
      <Text font={FONTS.mono} fontSize={0.06} maxWidth={1.4} textAlign="center" position={[0, 3.21, 0.09]} letterSpacing={0.12} color={needs > 0 ? "#ffcf8a" : "#8a7a60"}>
        {line}
      </Text>
      {counts.map((c) => (
        <Counter key={c.key} label={c.label} value={c.value} x={c.x} hot={c.key === "needsYou" && (c.value ?? 0) > 0} />
      ))}
      {/* The last check: a sweep dial, the time, and the sounder that clicks when a check lands. */}
      <group position={[-0.5, 2.3, 0.09]}>
        <mesh material={PBR.brass()}>
          <torusGeometry args={[0.11, 0.012, 8, 32]} />
        </mesh>
        <mesh position={[0, 0, -0.005]} material={PBR.matte("#efe3c4", 0.7)}>
          <circleGeometry args={[0.105, 32]} />
        </mesh>
        <group ref={needle} position={[0, 0, 0.006]}>
          <mesh position={[0, 0.045, 0]} material={PBR.matte("#8c2f2f", 0.5)}>
            <planeGeometry args={[0.012, 0.09]} />
          </mesh>
        </group>
        <mesh position={[0, 0, 0.008]} material={PBR.brass()}>
          <circleGeometry args={[0.014, 12]} />
        </mesh>
      </group>
      <Text font={FONTS.mono} fontSize={0.045} position={[-0.3, 2.34, 0.09]} anchorX="left" letterSpacing={0.14} color="#8a7a60">
        LAST CHECK
      </Text>
      <Text font={FONTS.mono} fontSize={0.06} position={[-0.3, 2.26, 0.09]} anchorX="left" letterSpacing={0.1} color={live ? "#e8d4a8" : "#8a7a60"}>
        {sinceCheck(lastCheck, now)}
      </Text>
      {/* The sounder: a brass bar on a pivot that snaps down onto its anvil. */}
      <group position={[0.5, 2.24, 0.1]}>
        <Block size={[0.36, 0.04, 0.06]} position={[0, -0.02, 0]} material={PBR.wood("walnut")} radius={0.01} />
        <Block size={[0.04, 0.1, 0.04]} position={[-0.14, 0.05, 0]} material={PBR.brass()} radius={0.006} />
        <Block size={[0.04, 0.04, 0.04]} position={[0.12, 0.02, 0]} material={PBR.steel()} radius={0.006} />
        <group ref={arm} position={[-0.14, 0.1, 0.01]}>
          <Block size={[0.3, 0.025, 0.03]} position={[0.14, 0, 0]} material={PBR.brass()} radius={0.006} />
        </group>
      </group>
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
      <InboxBoard />
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
