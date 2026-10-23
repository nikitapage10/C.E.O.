import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { smooth } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

const R = 0.42;
const FLOAT = 1.12;

/**
 * The host orb (Dot, the Studio's host): a Claudari's own frame, only rounder. A big ivory ceramic ball with a brass
 * halo floating about head high, a soft face screen with two eyes and a smile, and two small floating hands. It bobs,
 * blinks, squashes a little on every word, gestures with both hands when it explains, and bounces at the good part.
 */
export function Orb({ look, drive, phase }: BodyProps) {
  const whole = useRef<Group>(null);
  const ball = useRef<Group>(null);
  const hands = useRef<(Group | null)[]>([]);
  const eyes = useRef<(Mesh | null)[]>([]);
  const mouth = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  const sink = useRef(0);
  const ceramic = useMemo(() => new MeshStandardMaterial({ color: look.shell, roughness: 0.28, metalness: 0.05 }), [look.shell]);
  const face = useMemo(() => new MeshStandardMaterial({ color: "#10161f", roughness: 0.35, metalness: 0.2 }), []);
  const glow = useMemo(() => new MeshStandardMaterial({ color: "#000000", emissive: look.accent, emissiveIntensity: 2.2, toneMapped: false }), [look.accent]);
  const brass = useMemo(() => PBR.lacquer(look.trim, 0.3), [look.trim]);

  useFrame(() => {
    const d = drive.current;
    if (!d || !whole.current || !ball.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    sink.current = smooth(sink.current, mode === "napping" ? 1 : mode === "slumped" ? 0.4 : 0, 0.05);
    const bounce = mode === "celebrating" ? Math.abs(Math.sin(t * 6)) * 0.22 : 0;
    ball.current.position.y = FLOAT - sink.current * 0.62 + Math.sin(t * 1.8 + phase) * 0.04 + bounce;
    ball.current.rotation.x = walking ? 0.12 : sink.current * 0.25;
    ball.current.rotation.z = walking ? Math.sin(t * 3 + phase) * 0.05 : 0;
    // A little squash and stretch on every word.
    const talk = d.speaking ? Math.abs(Math.sin(t * 14)) * 0.05 : 0;
    ball.current.scale.set(1 + talk, 1 - talk, 1 + talk);
    if (halo.current) halo.current.rotation.z = t * 0.6;
    // Blink every few seconds; eyes closed asleep.
    const blink = mode === "napping" ? 0.1 : (t + phase) % 4 < 0.12 ? 0.15 : 1;
    for (const e of eyes.current) if (e) e.scale.y = smooth(e.scale.y, blink, 0.5);
    if (mouth.current) mouth.current.scale.set(1, d.speaking ? 0.6 + Math.abs(Math.sin(t * 14)) * 1.2 : mode === "napping" ? 0.3 : 1, 1);
    glow.emissiveIntensity = mode === "napping" ? 0.5 : 2.2;
    hands.current.forEach((g, i) => {
      if (!g) return;
      const side = i ? -1 : 1;
      const explaining = d.speaking || mode === "working" || mode === "typing";
      const y = mode === "celebrating" ? 0.55 : explaining ? 0.05 + Math.sin(t * 4 + i * 1.7) * 0.1 : -0.22 + Math.sin(t * 1.8 + phase + i) * 0.03;
      const x = side * (explaining ? 0.56 + Math.sin(t * 3 + i) * 0.05 : 0.52);
      g.position.x = smooth(g.position.x, x, 0.12);
      g.position.y = smooth(g.position.y, y, 0.12);
      g.position.z = smooth(g.position.z, explaining ? 0.22 : 0.05, 0.12);
    });
  });

  return (
    <group ref={whole}>
      {/* A soft shadow-catching puck under it, so it reads as floating over the floor. */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light(look.accent, 0.35)}>
        <circleGeometry args={[0.22, 20]} />
      </mesh>
      <group ref={ball}>
        <mesh material={ceramic} castShadow>
          <sphereGeometry args={[R, 28, 20]} />
        </mesh>
        {/* The face screen, set into the front. */}
        <mesh position={[0, 0.02, R - 0.11]} scale={[1, 0.72, 0.4]} material={face}>
          <sphereGeometry args={[0.27, 20, 14]} />
        </mesh>
        {[-0.09, 0.09].map((x, i) => (
          <mesh key={x} ref={(m) => void (eyes.current[i] = m)} position={[x, 0.07, R - 0.005]} material={glow}>
            <capsuleGeometry args={[0.028, 0.05, 4, 8]} />
          </mesh>
        ))}
        <mesh ref={mouth} position={[0, -0.07, R - 0.01]} rotation={[0, 0, Math.PI]} material={glow}>
          <torusGeometry args={[0.06, 0.012, 6, 14, Math.PI]} />
        </mesh>
        {/* The brass halo, the House's mark. */}
        <mesh ref={halo} position={[0, R + 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} material={brass}>
          <torusGeometry args={[0.2, 0.022, 8, 28]} />
        </mesh>
        {/* Two small floating hands. */}
        {[0, 1].map((i) => (
          <group key={i} ref={(g) => void (hands.current[i] = g)} position={[i ? -0.52 : 0.52, -0.22, 0.05]}>
            <mesh material={ceramic} castShadow>
              <sphereGeometry args={[0.075, 12, 10]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
