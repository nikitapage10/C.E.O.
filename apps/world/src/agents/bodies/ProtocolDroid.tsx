import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group } from "three";
import { PBR } from "../../fx/pbr.ts";
import { Block } from "../../rooms/primitives.tsx";
import { PROTOCOL_HIP, protocolPose } from "./droidPose.ts";
import type { BodyProps } from "./types.ts";

const HIP = PROTOCOL_HIP;
const THIGH = 0.4;
const SHIN = HIP - THIGH - 0.04;
/** The waist the torso pivots on, its shoulders, and the neck, above the floor. */
const WAIST = HIP + 0.08;
const SHOULDER = 1.34;
const NECK = 1.45;
const UPPER = 0.27;
const FORE = 0.24;
/** The hand-on-hip arm's resting angles: out from the body, elbow bent back in. */
const HIP_ARM = { out: -0.45, elbow: 1.35, twist: -0.25 };

/**
 * Clause (CL-4U5): a tall gold protocol droid, built from primitives. Legs that never bend at the knee, a ribbed
 * midriff of bare wiring under a gold chest plate, one hand fixed on its hip ("a policy"), the other free to fuss,
 * and a round head with two glowing eyes and a small round mouth. droidPose.ts moves it: stiff-legged swings from the
 * hip with a dip and a rock onto each foot, the free arm swinging like a rod, the head snapping between angles like a
 * servo, and an "oh my" every few seconds when it's idle. The look's shell is the plating, its trim the joints and
 * wiring, its accent the eyes.
 */
export function ProtocolDroid({ look, drive, phase }: BodyProps) {
  const root = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const clock = useRef(phase * 3);

  const gold = useMemo(() => new MeshStandardMaterial({ color: look.shell, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.3 }), [look.shell]);
  const joint = useMemo(() => new MeshStandardMaterial({ color: look.trim, metalness: 0.7, roughness: 0.45 }), [look.trim]);
  const wire = PBR.blackMetal();
  const silver = PBR.aluminium();
  const eyes = useMemo(() => new MeshStandardMaterial({ color: "#1a1204", emissive: look.accent, emissiveIntensity: 1.6, toneMapped: false }), [look.accent]);

  useFrame((_, dt) => {
    const d = drive.current;
    if (!d || !root.current || !torso.current || !head.current) return;
    clock.current += dt * (d.rate ?? 1);
    const p = protocolPose(d.mode, clock.current, phase, d.speaking);
    root.current.position.y = p.lift;
    root.current.rotation.z = p.roll;
    torso.current.rotation.set(p.pitch, p.yaw, 0);
    head.current.rotation.set(p.headPitch, p.headYaw, p.headTilt);
    // Forward is +Z: a leg or arm swings forward with a negative turn about X.
    if (legL.current) legL.current.rotation.x = -p.legL;
    if (legR.current) legR.current.rotation.x = -p.legR;
    if (armL.current) armL.current.rotation.set(-p.armL, 0, p.armLOut);
    if (armR.current) armR.current.rotation.set(-p.armR, HIP_ARM.twist, HIP_ARM.out + p.armROut);
    eyes.emissiveIntensity = p.eye;
  });

  /** A leg, hung from its hip: a thigh, a knee that doesn't bend, a shin with its piston, and a flat foot. */
  const legOf = (side: number, ref: typeof legL) => (
    <group ref={ref} position={[side * 0.095, HIP, 0]}>
      <mesh material={joint}>
        <sphereGeometry args={[0.055, 12, 10]} />
      </mesh>
      <mesh position={[0, -THIGH / 2, 0]} material={gold} castShadow>
        <cylinderGeometry args={[0.058, 0.045, THIGH - 0.04, 14]} />
      </mesh>
      <mesh position={[0, -THIGH, 0]} rotation={[0, 0, Math.PI / 2]} material={joint}>
        <cylinderGeometry args={[0.045, 0.045, 0.1, 12]} />
      </mesh>
      <Block size={[0.075, 0.07, 0.04]} position={[0, -THIGH, 0.045]} material={gold} radius={0.015} />
      <mesh position={[0, -THIGH - SHIN / 2, 0]} material={gold} castShadow>
        <cylinderGeometry args={[0.048, 0.038, SHIN - 0.02, 14]} />
      </mesh>
      <mesh position={[side * 0.035, -THIGH - SHIN / 2, -0.03]} material={silver}>
        <cylinderGeometry args={[0.008, 0.008, SHIN * 0.8, 6]} />
      </mesh>
      <Block size={[0.1, 0.05, 0.2]} position={[0, -HIP + 0.025, 0.035]} material={gold} radius={0.02} />
    </group>
  );

  /** An arm from its shoulder: upper arm, elbow, forearm and a hand. `bend` folds the elbow inward (about Z). */
  const armOf = (side: number, ref: typeof armL, bend: number, forward: number) => (
    <group ref={ref} position={[side * 0.215, SHOULDER - WAIST, 0]}>
      <mesh material={gold} castShadow>
        <sphereGeometry args={[0.06, 14, 10]} />
      </mesh>
      <mesh position={[0, -UPPER / 2, 0]} material={gold} castShadow>
        <cylinderGeometry args={[0.042, 0.036, UPPER - 0.03, 12]} />
      </mesh>
      <group position={[0, -UPPER, 0]} rotation={[-forward, 0, bend]}>
        <mesh material={joint}>
          <sphereGeometry args={[0.035, 10, 8]} />
        </mesh>
        <mesh position={[0, -FORE / 2, 0]} material={gold} castShadow>
          <cylinderGeometry args={[0.035, 0.03, FORE - 0.02, 12]} />
        </mesh>
        <Block size={[0.035, 0.09, 0.06]} position={[0, -FORE - 0.04, 0]} material={joint} radius={0.012} />
      </group>
    </group>
  );

  return (
    <group ref={root}>
      {legOf(1, legL)}
      {legOf(-1, legR)}
      {/* The pelvis plate the legs hang from. */}
      <Block size={[0.28, 0.1, 0.17]} position={[0, HIP + 0.03, 0]} material={gold} radius={0.03} />
      <group ref={torso} position={[0, WAIST, 0]}>
        {/* The midriff: bare wiring and a spine, the bit Counsel.exe asked be called "the ventilated section". */}
        <mesh position={[0, 0.09, 0]} material={wire}>
          <cylinderGeometry args={[0.09, 0.11, 0.18, 14]} />
        </mesh>
        {[-0.05, 0, 0.05].map((x) => (
          <mesh key={x} position={[x, 0.09, 0.085]} rotation={[0.1, 0, x * 2]} material={joint}>
            <cylinderGeometry args={[0.012, 0.012, 0.17, 6]} />
          </mesh>
        ))}
        {/* The chest: a gold plate, its collar, a round emblem and a little vent grille. */}
        <Block size={[0.38, 0.3, 0.21]} position={[0, 0.32, 0]} material={gold} radius={0.07} />
        <Block size={[0.3, 0.06, 0.18]} position={[0, 0.18, 0.005]} material={gold} radius={0.025} />
        <mesh position={[0, 0.34, 0.106]} rotation={[Math.PI / 2, 0, 0]} material={joint}>
          <cylinderGeometry args={[0.035, 0.035, 0.012, 18]} />
        </mesh>
        <mesh position={[0, 0.34, 0.11]} rotation={[Math.PI / 2, 0, 0]} material={silver}>
          <cylinderGeometry args={[0.02, 0.02, 0.012, 14]} />
        </mesh>
        {[0.26, 0.24, 0.22].map((y) => (
          <Block key={y} size={[0.1, 0.008, 0.01]} position={[0.09, y, 0.106]} material={joint} radius={0.003} shadows={false} />
        ))}
        <mesh position={[0, NECK - WAIST - 0.05, 0]} material={joint}>
          <cylinderGeometry args={[0.035, 0.045, 0.1, 10]} />
        </mesh>

        {armOf(1, armL, 0, 0.12)}
        {armOf(-1, armR, HIP_ARM.elbow, 0.3)}

        {/* The head, on its neck servo. */}
        <group ref={head} position={[0, NECK - WAIST, 0]}>
          <mesh position={[0, 0.13, 0]} scale={[1, 1.12, 0.98]} material={gold} castShadow>
            <sphereGeometry args={[0.115, 22, 16]} />
          </mesh>
          {/* A brow ridge, the two eyes under it, the small round mouth, and the round ear plates. */}
          <Block size={[0.17, 0.025, 0.05]} position={[0, 0.165, 0.085]} material={gold} radius={0.01} />
          {[-0.042, 0.042].map((x) => (
            <mesh key={x} position={[x, 0.14, 0.1]} rotation={[Math.PI / 2, 0, 0]} material={eyes}>
              <cylinderGeometry args={[0.022, 0.022, 0.02, 16]} />
            </mesh>
          ))}
          <mesh position={[0, 0.075, 0.103]} rotation={[Math.PI / 2, 0, 0]} material={wire}>
            <cylinderGeometry args={[0.012, 0.012, 0.02, 10]} />
          </mesh>
          {[1, -1].map((side) => (
            <mesh key={side} position={[side * 0.112, 0.12, 0]} rotation={[0, 0, Math.PI / 2]} material={joint}>
              <cylinderGeometry args={[0.035, 0.035, 0.02, 16]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
