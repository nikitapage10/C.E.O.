import { KERNEL_PORT_RADIUS, KERNEL_PORT_Y, makeLook } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, type Group } from "three";
import { LibraryBody } from "../agents/bodies/Library.tsx";
import type { Drive } from "../agents/bodies/types.ts";
import { Flare } from "../fx/Flare.tsx";
import { emissive, kernelMaterial } from "../fx/materials.ts";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";

const HEIGHT = 18;
/** How many times life size Skippy hovers over the Kernel: about ten metres of can, the old monolith's presence. */
const SKIPPY_SIZE = 11;
/** Skippy as made: navy hat and coat, gold braid. */
const SKIPPY_LOOK = makeLook({ body: "skippy", shell: "#0a2e62", accent: "#7fd8ff", trim: "#e8b84a" });

/**
 * Skippy, the Magnificent, enthroned over the Kernel's port: a giant of the admiral can, turning slowly to keep
 * every room in view, bobbing over his own glow, and gesturing while he's on the PA.
 */
function Magnificent() {
  const turn = useRef<Group>(null);
  const drive = useRef<Drive>({ mode: "idle", moving: false, t: 0, speaking: false });
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const a = useWorld.getState().announcement;
    const speaking = !!a && a.until > performance.now();
    const d = drive.current;
    d.t = t;
    d.speaking = speaking;
    d.mode = speaking ? (a.tone === "praise" ? "celebrating" : "waiting") : "idle";
    const g = turn.current;
    if (g) {
      g.rotation.y = Math.PI + Math.sin(t * 0.05) * Math.PI;
      // On the PA he leans in and swells a little with every syllable; off it, a slow bob.
      const lean = speaking ? 0.08 + Math.sin(t * 5) * 0.03 : 0;
      g.rotation.x += (lean - g.rotation.x) * 0.08;
      const s = SKIPPY_SIZE * (speaking ? 1.04 + Math.abs(Math.sin(t * 7)) * 0.025 : 1);
      g.scale.setScalar(g.scale.x + (s - g.scale.x) * 0.15);
      g.position.y = KERNEL_PORT_Y - 1.2 + Math.sin(t * 0.6) * 0.25;
    }
  });
  return (
    <group ref={turn} position={[0, KERNEL_PORT_Y - 1.2, 0]} scale={SKIPPY_SIZE}>
      <Suspense fallback={null}>
        <LibraryBody look={SKIPPY_LOOK} lineage="cursori" drive={drive} phase={0} />
      </Suspense>
    </group>
  );
}

/** An arc of a circle as a line: the Syntherion sigil, which is (on purpose) never finished. */
function arcGeometry(radius: number, from: number, to: number, segments = 96) {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pts, 3));
  return g;
}

/**
 * The Kernel: the centre of the Lattice where every stream converges. Its unfinished monolith is gone: Skippy,
 * the Magnificent took the seat (Nikita, 2026-10-12) and runs C.E.O. from here. The unfinished glass still rises
 * around him in shards ("empty, unfinished", as the Tide's art brief has it).
 */
export function Kernel() {
  const mat = useMemo(() => kernelMaterial(HEIGHT), []);
  const shards = useRef<Group>(null);
  const sigil = useRef<Group>(null);
  const voice = useRef<Group>(null);
  const shardData = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        x: (Math.random() - 0.5) * 3,
        z: (Math.random() - 0.5) * 1.4,
        y0: HEIGHT * 0.3 + Math.random() * 4,
        s: 0.15 + Math.random() * 0.45,
        speed: 0.25 + Math.random() * 0.4,
        phase: i * 1.7,
      })),
    [],
  );
  const arcs = useMemo(() => {
    const m = new LineBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.8 });
    m.color.setRGB(1.5, 1.6, 1.8);
    return [arcGeometry(6.5, 0.2, Math.PI * 1.55), arcGeometry(7.2, Math.PI * 1.7, Math.PI * 2.6), arcGeometry(5.6, 0.9, 2.4)].map(
      (g, i) => {
        const line = new Line(g, m);
        line.rotation.set(i * 0.25, 0, i * 0.15);
        return line;
      },
    );
  }, []);
  const ring = useMemo(() => arcGeometry(KERNEL_PORT_RADIUS, 0, Math.PI * 2, 128), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (voice.current) {
      // The Kernel's port flares while Skippy is on the PA.
      const a = useWorld.getState().announcement;
      const speaking = a && a.until > performance.now();
      const target = speaking ? 1.5 + Math.abs(Math.sin(t * 9)) * 0.5 : 1;
      voice.current.scale.setScalar(voice.current.scale.x + (target - voice.current.scale.x) * 0.15);
    }
    if (sigil.current) {
      sigil.current.rotation.y = t * 0.12;
      sigil.current.position.y = 8 + Math.sin(t * 0.4) * 0.4;
    }
    shards.current?.children.forEach((child, i) => {
      const d = shardData[i]!;
      const life = (t * d.speed + d.phase) % 6;
      child.position.set(d.x * (1 + life * 0.15), HEIGHT * 0.5 + d.y0 - HEIGHT * 0.3 + life * 1.4, d.z);
      child.rotation.set(t * d.speed, t * d.speed * 0.7, 0);
      const s = d.s * Math.max(0, 1 - life / 6);
      child.scale.setScalar(s);
    });
  });

  return (
    <group>
      <Magnificent />
      <group ref={shards} position={[0, -1, 0]}>
        {shardData.map((_, i) => (
          <mesh key={i} material={mat}>
            <tetrahedronGeometry args={[1, 0]} />
          </mesh>
        ))}
      </group>
      <group ref={sigil}>
        {arcs.map((line, i) => (
          <primitive key={i} object={line} />
        ))}
      </group>
      {/* Port ring where streams arrive. */}
      <lineLoop geometry={ring} position={[0, KERNEL_PORT_Y, 0]}>
        <lineBasicMaterial color={[2.2, 2.3, 2.5]} toneMapped={false} />
      </lineLoop>
      <mesh position={[0, KERNEL_PORT_Y - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={emissive(PALETTE.ice, 0.25)}>
        <ringGeometry args={[KERNEL_PORT_RADIUS - 0.08, KERNEL_PORT_RADIUS + 0.08, 128]} />
      </mesh>
      <group ref={voice} position={[0, KERNEL_PORT_Y + 0.3, 0]}>
        <Flare size={7} intensity={1.1} pulse={1} color={PALETTE.silver} />
      </group>
      <Flare position={[0, HEIGHT * 0.72, 0]} size={4} intensity={0.6} color={PALETTE.violet} />
      <pointLight position={[0, 6, 0]} color={PALETTE.silver} intensity={60} distance={40} decay={1.6} />
    </group>
  );
}
