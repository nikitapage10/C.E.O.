import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { roughnessNoise } from "../../fx/textures.ts";
import { Block } from "../../rooms/primitives.tsx";
import { knee, SEGMENT, smooth, span } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

// Front legs are longer: the shoulders sit high, the hindquarters low.
const LEGS = [
  { x: -0.34, z: 0.42, hipY: 1.32, upper: 0.66, lower: 0.72, front: true },
  { x: 0.34, z: 0.42, hipY: 1.32, upper: 0.66, lower: 0.72, front: true },
  { x: -0.36, z: -0.5, hipY: 1.0, upper: 0.5, lower: 0.56, front: false },
  { x: 0.36, z: -0.5, hipY: 1.0, upper: 0.5, lower: 0.56, front: false },
];
const hip = new Vector3();
const foot = new Vector3();
const kn = new Vector3();
const bendFront = new Vector3(0, 0.2, -1);
const bendBack = new Vector3(0, 0.2, 1);

/**
 * The Emotive Pachyderm Envoy: a great, slow, grey diplomat on four column legs, with a broad low head and
 * a cluster of small eyes. Its people cannot read each other's faces, so it says how it feels before
 * everything it says.
 */
export function Envoy({ look, drive, phase }: BodyProps) {
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const uppers = useRef<(Mesh | null)[]>([]);
  const lowers = useRef<(Mesh | null)[]>([]);
  const feet = useRef<(Mesh | null)[]>([]);
  const down = useRef(0);
  const hide = useMemo(
    () => new MeshPhysicalMaterial({ color: look.shell, roughness: 0.82, roughnessMap: roughnessNoise([3, 3]), sheen: 0.4, sheenRoughness: 0.8, sheenColor: "#c8c2b8" }),
    [look.shell],
  );
  const plate = useMemo(() => new MeshStandardMaterial({ color: look.trim, roughness: 0.6, metalness: 0.1 }), [look.trim]);
  const eyes = useMemo(() => PBR.light(look.accent, 1.8), [look.accent]);

  useFrame(() => {
    const d = drive.current;
    if (!d || !torso.current || !head.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const s = t * 3.6 + phase;
    down.current = smooth(down.current, mode === "napping" ? 0.62 : mode === "slumped" ? 0.25 : 0, 0.05);
    const rear = mode === "celebrating" ? 0.12 + Math.sin(t * 3) * 0.04 : 0;
    torso.current.position.y = -down.current + (walking ? Math.abs(Math.sin(s)) * 0.04 : Math.sin(t * 0.9 + phase) * 0.012);
    torso.current.rotation.x = -rear;
    torso.current.rotation.z = walking ? Math.sin(s) * 0.04 : 0;
    // Slow, sincere nods while speaking.
    head.current.rotation.x = (d.speaking ? Math.sin(t * 2.4) * 0.12 : 0) + (mode === "typing" || mode === "working" ? 0.25 : 0) + down.current * 0.4;
    head.current.rotation.y = Math.sin(t * 0.35 + phase) * 0.18;

    LEGS.forEach((L, i) => {
      // Diagonal pairs move together.
      const beat = s + (i === 0 || i === 3 ? 0 : Math.PI);
      const sway = walking ? Math.sin(beat) * 0.22 : 0;
      const step = walking ? Math.max(0, Math.cos(beat)) * 0.12 : 0;
      const hy = L.hipY + torso.current!.position.y + (L.front ? rear * 2.5 : 0);
      hip.set(L.x, hy, L.z);
      const raised = mode === "celebrating" && L.front && i === 0;
      foot.set(L.x * 1.05, raised ? 0.5 : step, L.z + sway + (raised ? 0.35 : 0) + (down.current > 0.4 ? (L.front ? 0.3 : -0.3) : 0));
      knee(hip, foot, L.upper, L.lower, L.front ? bendFront : bendBack, kn);
      span(uppers.current[i]!, hip, kn, L.front ? 0.15 : 0.16);
      span(lowers.current[i]!, kn, foot, L.front ? 0.12 : 0.13);
      feet.current[i]?.position.set(foot.x, foot.y + 0.05, foot.z);
    });
  });

  return (
    <group>
      <group ref={torso}>
        {/* Shoulders high, back sloping down to the haunches. */}
        <mesh position={[0, 1.42, 0.3]} scale={[0.52, 0.48, 0.6]} material={hide} castShadow receiveShadow>
          <sphereGeometry args={[1, 36, 28]} />
        </mesh>
        <mesh position={[0, 1.12, -0.42]} scale={[0.48, 0.4, 0.5]} material={hide} castShadow receiveShadow>
          <sphereGeometry args={[1, 32, 24]} />
        </mesh>
        <mesh position={[0, 1.27, -0.05]} rotation={[0.35, 0, 0]} scale={[0.5, 0.42, 0.55]} material={hide} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
        </mesh>
        {/* Back plates. */}
        {[0.55, 0.25, -0.05].map((z, i) => (
          <Block key={z} size={[0.5 - i * 0.06, 0.05, 0.22]} position={[0, 1.88 - i * 0.12, z]} rotation={[0.25 + i * 0.12, 0, 0]} material={plate} radius={0.02} />
        ))}
        {/* The diplomatic sash. */}
        <mesh position={[0, 1.36, 0.22]} rotation={[0.3, 0, 0.5]} material={PBR.fabric(look.accent)}>
          <torusGeometry args={[0.5, 0.035, 8, 40]} />
        </mesh>
        <group ref={head} position={[0, 1.52, 0.86]}>
          {/* A broad, low head on a thick neck, set forward of the shoulders. */}
          <mesh position={[0, 0, 0.06]} scale={[0.3, 0.24, 0.3]} material={hide} castShadow>
            <sphereGeometry args={[1, 32, 24]} />
          </mesh>
          <mesh position={[0, -0.12, 0.24]} scale={[0.22, 0.14, 0.18]} material={hide} castShadow>
            <sphereGeometry args={[1, 24, 18]} />
          </mesh>
          <Block size={[0.5, 0.06, 0.14]} position={[0, 0.16, 0.18]} rotation={[0.3, 0, 0]} material={plate} radius={0.025} />
          {[
            [-0.12, 0.06],
            [0.12, 0.06],
            [-0.07, 0.0],
            [0.07, 0.0],
          ].map(([x, y], i) => (
            <mesh key={i} position={[x!, y!, 0.33]} material={eyes}>
              <sphereGeometry args={[0.022, 12, 10]} />
            </mesh>
          ))}
        </group>
      </group>
      {LEGS.map((_, i) => (
        <group key={i}>
          <mesh ref={(m) => void (uppers.current[i] = m)} geometry={SEGMENT} material={hide} castShadow />
          <mesh ref={(m) => void (lowers.current[i] = m)} geometry={SEGMENT} material={hide} castShadow />
          <mesh ref={(m) => void (feet.current[i] = m)} material={plate} castShadow>
            <cylinderGeometry args={[0.15, 0.17, 0.1, 18]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
