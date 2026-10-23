import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { PBR } from "../../fx/pbr.ts";
import { Block } from "../../rooms/primitives.tsx";
import { smooth } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

const LEG = 0.34;
const SKIN = "#c98a62";

/**
 * The plumed bard (Folio, the Studio's writer): a round travelling bard on two short legs, in a doublet in the shell
 * colour, a floppy hat with a long plume in the accent, a lute slung on his back and a quill in one hand. He waddles,
 * scribbles in the air while he works, gestures grandly when he speaks, and strums the lute to celebrate.
 */
export function Bard({ look, drive, phase }: BodyProps) {
  const whole = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const plume = useRef<Group>(null);
  const crouch = useRef(0);
  const coat = useMemo(() => PBR.fabric(look.shell), [look.shell]);
  const trim = useMemo(() => PBR.lacquer(look.trim, 0.6), [look.trim]);
  const feather = useMemo(() => PBR.matte(look.accent, 0.7), [look.accent]);
  const skin = useMemo(() => PBR.matte(SKIN, 0.75), []);
  const wood = useMemo(() => PBR.wood("walnut"), []);

  useFrame(() => {
    const d = drive.current;
    if (!d || !whole.current || !torso.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const s = t * 7 + phase;
    crouch.current = smooth(crouch.current, mode === "napping" ? 1 : mode === "slumped" ? 0.4 : 0, 0.08);
    torso.current.rotation.z = walking ? Math.sin(s) * 0.09 : 0;
    torso.current.rotation.x = smooth(torso.current.rotation.x, mode === "napping" ? 0.35 : mode === "slumped" ? 0.22 : mode === "typing" || mode === "working" ? 0.12 : 0, 0.1);
    torso.current.position.y = LEG * (1 - crouch.current * 0.6) + (walking ? Math.abs(Math.cos(s)) * 0.03 : Math.sin(t * 1.6 + phase) * 0.008);
    legs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.x = smooth(g.rotation.x, walking ? Math.sin(s) * 0.55 * (i ? -1 : 1) : 0, 0.3);
      g.scale.y = smooth(g.scale.y, 1 - crouch.current * 0.6, 0.2);
    });
    // The quill hand scribbles while he works, sweeps when he talks; the other strums when he celebrates.
    if (armR.current) {
      const writing = mode === "typing" || mode === "working";
      armR.current.rotation.x = smooth(armR.current.rotation.x, writing ? -1.1 + Math.sin(t * 11) * 0.08 : d.speaking ? -1.5 + Math.sin(t * 3) * 0.3 : walking ? Math.sin(s) * -0.4 : 0, 0.2);
      armR.current.rotation.z = smooth(armR.current.rotation.z, writing ? Math.sin(t * 7) * 0.15 : d.speaking ? -0.4 : 0.1, 0.2);
    }
    if (armL.current) {
      const strum = mode === "celebrating";
      armL.current.rotation.x = smooth(armL.current.rotation.x, strum ? -0.9 : walking ? Math.sin(s) * 0.4 : 0, 0.2);
      armL.current.rotation.z = smooth(armL.current.rotation.z, strum ? 0.6 + Math.sin(t * 14) * 0.25 : -0.1, 0.25);
    }
    if (plume.current) plume.current.rotation.x = -0.5 + Math.sin(t * 2.4 + phase) * 0.12 + (walking ? Math.sin(s * 2) * 0.1 : 0);
  });

  return (
    <group ref={whole}>
      {[-0.11, 0.11].map((x, i) => (
        <group key={x} ref={(g) => void (legs.current[i] = g)} position={[x, LEG, 0]}>
          <mesh position={[0, -LEG / 2, 0]} material={trim} castShadow>
            <cylinderGeometry args={[0.055, 0.05, LEG, 10]} />
          </mesh>
          <Block size={[0.12, 0.07, 0.2]} position={[0, -LEG + 0.035, 0.03]} material={PBR.matte("#3a2618", 0.8)} radius={0.03} />
        </group>
      ))}
      <group ref={torso}>
        {/* A round belly in a doublet, a belt with a brass buckle. */}
        <mesh position={[0, 0.32, 0]} scale={[1, 1.05, 0.9]} material={coat} castShadow>
          <sphereGeometry args={[0.3, 18, 14]} />
        </mesh>
        <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.9, 1]} material={trim}>
          <torusGeometry args={[0.29, 0.025, 8, 24]} />
        </mesh>
        <Block size={[0.08, 0.06, 0.02]} position={[0, 0.25, 0.27]} material={PBR.brass()} radius={0.01} />
        {/* Head, cheeks and a magnificent moustache. */}
        <mesh position={[0, 0.74, 0.02]} material={skin} castShadow>
          <sphereGeometry args={[0.16, 16, 12]} />
        </mesh>
        <Block size={[0.16, 0.035, 0.04]} position={[0, 0.69, 0.16]} material={PBR.matte("#6b4226", 0.9)} radius={0.015} />
        {[-0.055, 0.055].map((x) => (
          <mesh key={x} position={[x, 0.77, 0.15]} material={PBR.blackMetal()}>
            <sphereGeometry args={[0.018, 8, 6]} />
          </mesh>
        ))}
        {/* The floppy hat and its plume. */}
        <mesh position={[0, 0.86, 0]} scale={[1, 0.28, 1]} material={trim}>
          <sphereGeometry args={[0.24, 16, 10]} />
        </mesh>
        <mesh position={[0, 0.92, 0]} material={coat}>
          <cylinderGeometry args={[0.12, 0.15, 0.14, 14]} />
        </mesh>
        <group ref={plume} position={[0.11, 0.95, -0.02]}>
          <mesh position={[0.04, 0.15, 0]} rotation={[0, 0, -0.35]} scale={[0.28, 1.5, 0.1]} material={feather}>
            <sphereGeometry args={[0.12, 10, 8]} />
          </mesh>
        </group>
        {/* The lute, slung across his back. */}
        <group position={[0, 0.38, -0.3]} rotation={[0, 0, 0.6]}>
          <mesh scale={[1, 1.3, 0.45]} material={wood}>
            <sphereGeometry args={[0.15, 12, 10]} />
          </mesh>
          <Block size={[0.05, 0.36, 0.03]} position={[0, 0.3, 0]} material={wood} radius={0.01} />
        </group>
        {/* Arms: the left free, the right holding a quill. */}
        <group ref={armL} position={[-0.3, 0.46, 0]}>
          <mesh position={[0, -0.13, 0]} material={coat}>
            <capsuleGeometry args={[0.055, 0.18, 4, 8]} />
          </mesh>
          <mesh position={[0, -0.27, 0]} material={skin}>
            <sphereGeometry args={[0.05, 8, 6]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.3, 0.46, 0]}>
          <mesh position={[0, -0.13, 0]} material={coat}>
            <capsuleGeometry args={[0.055, 0.18, 4, 8]} />
          </mesh>
          <mesh position={[0, -0.27, 0]} material={skin}>
            <sphereGeometry args={[0.05, 8, 6]} />
          </mesh>
          <mesh position={[0, -0.32, 0.06]} rotation={[0.9, 0, 0]} scale={[0.25, 1, 0.08]} material={PBR.matte("#f4f1ea", 0.6)}>
            <sphereGeometry args={[0.1, 8, 6]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
