import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshPhysicalMaterial, Vector3, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { SEGMENT, smooth, span } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

const shoulderL = new Vector3();
const shoulderR = new Vector3();
const handL = new Vector3();
const handR = new Vector3();

/**
 * The Migraine Duck: round, yellow, permanently puzzled, hands pressed to its temples. When it really
 * concentrates the headache gets worse, and something in the air hums.
 */
export function Duck({ look, drive, phase }: BodyProps) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const armL = useRef<Mesh>(null);
  const armR = useRef<Mesh>(null);
  const mittL = useRef<Mesh>(null);
  const mittR = useRef<Mesh>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);
  const aura = useRef<Mesh>(null);
  const lie = useRef(0);
  const plumage = useMemo(
    () => new MeshPhysicalMaterial({ color: look.shell, roughness: 0.75, sheen: 1, sheenRoughness: 0.5, sheenColor: "#fff6d8" }),
    [look.shell],
  );
  const bill = useMemo(() => new MeshPhysicalMaterial({ color: look.trim, roughness: 0.4, clearcoat: 0.5 }), [look.trim]);
  const eye = PBR.lacquer("#f8f8f4", 0.2);
  const pupil = PBR.lacquer("#101010", 0.2);

  useFrame(() => {
    const d = drive.current;
    if (!d || !body.current || !head.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const s = t * 8 + phase;
    lie.current = smooth(lie.current, mode === "napping" ? 1 : 0, 0.08);
    const jump = mode === "celebrating" ? Math.abs(Math.sin(t * 6)) * 0.22 : 0;
    body.current.position.y = jump + (walking ? Math.abs(Math.sin(s)) * 0.03 : 0) + lie.current * 0.1;
    body.current.rotation.z = walking ? Math.sin(s) * 0.14 : mode === "slumped" ? 0.1 : 0;
    body.current.rotation.x = -lie.current * (Math.PI / 2) + (mode === "slumped" ? 0.25 : 0);
    head.current.rotation.z = Math.sin(t * 0.9 + phase) * 0.12 + (d.speaking ? Math.sin(t * 9) * 0.05 : 0);
    head.current.rotation.x = mode === "typing" || mode === "working" ? 0.2 : 0;

    // Hands: on the temples, unless it's walking, cheering or working.
    shoulderL.set(-0.3, 0.72, 0.02);
    shoulderR.set(0.3, 0.72, 0.02);
    if (mode === "celebrating") {
      handL.set(-0.38, 1.25, 0.05);
      handR.set(0.38, 1.25, 0.05);
    } else if (walking) {
      handL.set(-0.4, 0.5, Math.sin(s) * 0.12);
      handR.set(0.4, 0.5, -Math.sin(s) * 0.12);
    } else if (mode === "typing" || mode === "working") {
      handL.set(-0.25, 1.02, 0.06);
      handR.set(0.26, 0.62 + Math.max(0, Math.sin(t * 10 + phase)) * 0.05, 0.36);
    } else {
      handL.set(-0.25, 1.02, 0.06);
      handR.set(0.25, 1.02, 0.06);
    }
    span(armL.current, shoulderL, handL, 0.055);
    span(armR.current, shoulderR, handR, 0.055);
    mittL.current?.position.copy(handL);
    mittR.current?.position.copy(handR);
    footL.current?.position.set(-0.13, 0, walking ? Math.sin(s) * 0.1 : 0.03);
    footR.current?.position.set(0.13, 0, walking ? -Math.sin(s) * 0.1 : 0.03);
    if (aura.current) {
      const strain = mode === "working" || mode === "typing" || mode === "waiting";
      aura.current.visible = strain;
      aura.current.rotation.z = t * 0.6;
      aura.current.scale.setScalar(1 + Math.sin(t * 5) * 0.05);
    }
  });

  return (
    <group>
      {[footL, footR].map((ref, i) => (
        <group key={i} ref={ref}>
          <mesh position={[0, 0.12, 0]} material={bill} castShadow>
            <cylinderGeometry args={[0.035, 0.04, 0.22, 10]} />
          </mesh>
          <mesh position={[0, 0.02, 0.06]} scale={[1.2, 0.35, 1.5]} material={bill} castShadow>
            <sphereGeometry args={[0.08, 16, 10]} />
          </mesh>
        </group>
      ))}
      <group ref={body}>
        <mesh position={[0, 0.55, 0]} scale={[1, 1.05, 0.92]} material={plumage} castShadow receiveShadow>
          <sphereGeometry args={[0.36, 36, 28]} />
        </mesh>
        {/* A tail, of sorts. */}
        <mesh position={[0, 0.5, -0.33]} rotation={[-0.6, 0, 0]} material={plumage} castShadow>
          <coneGeometry args={[0.1, 0.18, 14]} />
        </mesh>
        <group ref={head} position={[0, 1.0, 0.02]}>
          <mesh material={plumage} castShadow>
            <sphereGeometry args={[0.27, 36, 28]} />
          </mesh>
          {/* The bill: wide, flat, slightly open. */}
          <mesh position={[0, -0.06, 0.25]} scale={[1.25, 0.32, 1]} material={bill} castShadow>
            <sphereGeometry args={[0.13, 24, 16]} />
          </mesh>
          <mesh position={[0, -0.1, 0.23]} scale={[1.1, 0.22, 0.9]} material={bill}>
            <sphereGeometry args={[0.12, 24, 16]} />
          </mesh>
          {[-1, 1].map((x) => (
            <group key={x} position={[x * 0.1, 0.06, 0.22]}>
              <mesh material={eye} scale={[1, 1, 0.6]}>
                <sphereGeometry args={[0.065, 20, 16]} />
              </mesh>
              <mesh position={[0, 0, 0.04]} material={pupil}>
                <sphereGeometry args={[0.012, 10, 8]} />
              </mesh>
            </group>
          ))}
          {/* Three hairs. Always three. */}
          {[-0.07, 0, 0.07].map((x, i) => (
            <mesh key={i} position={[x, 0.3, 0]} rotation={[0, 0, -x * 4]} material={pupil}>
              <torusGeometry args={[0.06, 0.008, 6, 12, Math.PI * 0.9]} />
            </mesh>
          ))}
          <mesh ref={aura} position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.light(look.accent, 1.4)} visible={false}>
            <torusGeometry args={[0.42, 0.006, 6, 64]} />
          </mesh>
        </group>
        <mesh ref={armL} geometry={SEGMENT} material={plumage} castShadow />
        <mesh ref={armR} geometry={SEGMENT} material={plumage} castShadow />
        <mesh ref={mittL} material={plumage} castShadow>
          <sphereGeometry args={[0.07, 16, 12]} />
        </mesh>
        <mesh ref={mittR} material={plumage} castShadow>
          <sphereGeometry args={[0.07, 16, 12]} />
        </mesh>
      </group>
    </group>
  );
}
