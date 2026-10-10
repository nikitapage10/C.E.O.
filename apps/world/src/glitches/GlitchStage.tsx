import { roomAngle, roomCenter } from "@ceo/core";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { DoubleSide, type Group } from "three";
import { useWorld, type ActiveGlitch } from "../store.ts";
import { CounselExe } from "./Counsel.tsx";
import { INTRUSIONS, WORLD_SPACE, progressOf } from "./intrusions.tsx";
import { COUNSEL_STAMP, COUNSEL_YANK, TARP_LABELS } from "./lines.ts";
import { GLITCH_BY_ID } from "./registry.ts";
import { LEGAL_AT } from "./scheduler.ts";

function pick<T>(items: readonly T[], seed: number): T {
  return items[Math.abs(Math.floor(seed)) % items.length]!;
}

/** Plays the active 3D glitch: the intrusion itself, its sticky-note disclaimer and any legal intervention. */
function Staged({ g }: { g: ActiveGlitch }) {
  const def = GLITCH_BY_ID[g.id]!;
  const Intrusion = INTRUSIONS[g.id];
  const wrapper = useRef<Group>(null);
  const counsel = useRef<Group>(null);
  const tarp = useRef<Group>(null);
  const [phase, setPhase] = useState<"play" | "legal">("play");
  const seed = g.startedAt;
  const legalLine = useMemo(
    () => (g.legal === "yank" ? pick(COUNSEL_YANK, seed) : g.legal === "stamp" ? pick(COUNSEL_STAMP, seed) : pick(TARP_LABELS, seed)),
    [g.legal, seed],
  );

  // Where it happens: over the room you're looking at, or above the Kernel from the overview.
  const sky = def.where === "sky";
  const center = g.room ? roomCenter(g.room) : null;
  const anchor: { pos: [number, number, number]; yaw: number; scale: number } =
    g.room && center
      ? { pos: [center[0], center[1] + (sky ? 5 : 2.2), center[2]], yaw: roomAngle(g.room), scale: 1 }
      : { pos: [0, sky ? 16 : 10, 0], yaw: 0, scale: 3 };

  useFrame(() => {
    const p = progressOf(g);
    const legalAt = g.legal ? LEGAL_AT[g.legal] : 2;
    if (p >= legalAt && phase === "play") setPhase("legal");
    const lp = Math.max(0, (p - legalAt) / (1 - legalAt));
    if (g.legal === "yank" && wrapper.current) {
      // Counsel.exe drags it off stage left, mid-joke.
      const k = Math.min(1, lp * 2.2);
      wrapper.current.position.set(-k * k * 14, k * 2, 0);
      wrapper.current.rotation.z = k * 0.6;
    }
    if (counsel.current) {
      const k = Math.min(1, lp * 4);
      counsel.current.position.set(g.legal === "yank" ? 4 - k * 3 - Math.max(0, lp - 0.25) * 18 : 1.6, -1.6, 2 - k * 0.6);
    }
    if (tarp.current) {
      const k = Math.min(1, lp * 3);
      tarp.current.position.y = 4 - k * 3.6;
      tarp.current.rotation.z = Math.sin(performance.now() / 300) * 0.04 * (1 - k * 0.5);
    }
  });

  const content = Intrusion ? <Intrusion g={g} /> : null;
  if (Intrusion && WORLD_SPACE.has(g.id)) return content;

  return (
    <group position={anchor.pos} rotation={[0, anchor.yaw, 0]} scale={anchor.scale}>
      <group ref={wrapper}>{content}</group>
      {def.disclaimer && (
        <Html position={[0, -1.5, 2.2]} center zIndexRange={[55, 0]}>
          <div className="sticky-note">{def.disclaimer}</div>
        </Html>
      )}
      {phase === "legal" && g.legal && (
        <>
          <group ref={counsel}>
            <CounselExe />
            <Html position={[0, 1.7, 0]} center zIndexRange={[58, 0]}>
              <div className="counsel-says">{g.legal === "tarp" ? "Covering this. For reasons." : g.legal === "yank" ? legalLine : "Stamped. You're welcome."}</div>
            </Html>
          </group>
          {g.legal === "stamp" && (
            <Html position={[0, -0.7, 1.6]} center zIndexRange={[61, 0]}>
              <div className="legal-stamp">{legalLine}</div>
            </Html>
          )}
          {g.legal === "tarp" && (
            <group ref={tarp} position={[0, 4, 0]}>
              <mesh>
                <planeGeometry args={[3.4, 3, 8, 8]} />
                <meshStandardMaterial color="#5a6372" roughness={1} side={DoubleSide} />
              </mesh>
              <Html position={[0, 0, 0.1]} center zIndexRange={[57, 0]}>
                <div className="tarp-label">{legalLine}</div>
              </Html>
            </group>
          )}
        </>
      )}
    </group>
  );
}

export function GlitchStage() {
  const g = useWorld((s) => s.activeGlitch);
  if (!g) return null;
  const def = GLITCH_BY_ID[g.id];
  if (!def || def.overlay || !INTRUSIONS[g.id]) return null;
  return <Staged key={g.startedAt} g={g} />;
}
