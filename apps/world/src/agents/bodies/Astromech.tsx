import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MeshStandardMaterial, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { Block } from "../../rooms/primitives.tsx";
import { astromechState, stepAstromech } from "./droidPose.ts";
import type { BodyProps } from "./types.ts";

/** The shoulder pins the barrel pivots on, metres above the floor. */
const SHOULDER = 0.8;
/** The barrel: radius, and how far its top and bottom sit from the pins. */
const R = 0.235;
const TOP = 0.07;
const BOTTOM = -0.5;
/** Where the third leg comes out of the barrel's belly, from the pins. */
const HATCH = BOTTOM - 0.04;
/** The two outer legs, out from the barrel. */
const LEG_X = R + 0.075;

/**
 * Drop (DR-0P): an astromech, built from primitives. A white barrel on two outer legs that hold it by the shoulder
 * pins, a domed head that turns all the way round, a radar eye and a lamp, blue panels, and a third leg that drops
 * out of its belly when it wants to go. droidPose.ts moves it: the leg drops, the barrel leans back onto it and it
 * rolls, rocking side to side, the feet's wheels turning; when it stops the barrel swings upright past the vertical
 * and settles before the leg tucks away. The dome glances, sweeps the room on a security pass and spins when it's
 * pleased, and the lights flare every few seconds. The look's shell is the barrel, its trim the panels, its accent the eye.
 */
export function Astromech({ look, drive, phase }: BodyProps) {
  const root = useRef<Group>(null);
  const barrel = useRef<Group>(null);
  const dome = useRef<Group>(null);
  const leg = useRef<Group>(null);
  const strut = useRef<Mesh>(null);
  const foot = useRef<Group>(null);
  const wheels = useRef<(Mesh | null)[]>([]);
  const st = useRef(astromechState());
  const clock = useRef(phase * 3);

  const shell = useMemo(() => PBR.lacquer(look.shell, 0.4), [look.shell]);
  const panel = useMemo(() => PBR.lacquer(look.trim, 0.35), [look.trim]);
  const metal = PBR.aluminium();
  // The dome is polished silver, bright enough to read against the dark bricks.
  const silver = useMemo(() => new MeshStandardMaterial({ color: "#dfe4ea", metalness: 0.55, roughness: 0.3 }), []);
  const dark = PBR.blackMetal();
  const eye = useMemo(() => new MeshStandardMaterial({ color: "#05070c", emissive: look.accent, emissiveIntensity: 1.4, roughness: 0.2, toneMapped: false }), [look.accent]);
  const lamp = useMemo(() => new MeshStandardMaterial({ color: "#1a0606", emissive: "#ff4a5a", emissiveIntensity: 0.5, toneMapped: false }), []);
  const logic = useMemo(() => new MeshStandardMaterial({ color: "#05070c", emissive: "#9fe3ff", emissiveIntensity: 0.8, toneMapped: false }), []);

  useFrame((_, dt) => {
    const d = drive.current;
    const g = root.current;
    if (!d || !g || !barrel.current || !dome.current) return;
    const rate = d.rate ?? 1;
    clock.current += dt * rate;
    const s = clock.current;
    const p = stepAstromech(st.current, d.mode, s, dt, phase, d.speaking);
    g.position.y = p.lift;
    g.rotation.z = p.roll;
    g.rotation.x = p.pitch;
    // The barrel leans back on the pins (its top toward -Z, its belly forward); the dome turns on top of it.
    barrel.current.rotation.x = -p.tilt;
    dome.current.rotation.y = p.dome;
    eye.emissiveIntensity = p.eye;
    lamp.emissiveIntensity = p.lamp;
    logic.emissiveIntensity = d.mode === "napping" ? 0.1 : 0.6 + (Math.sin(s * 5 + phase) > 0.3 ? 0.8 : 0);
    // The wheels in the feet turn while it rolls.
    const rolling = d.mode === "walking" || d.mode === "carrying";
    for (const w of wheels.current) if (w && rolling) w.rotation.x += dt * rate * 9;

    // The third leg hangs straight down from the hatch to the floor, however far the barrel leans, and slides out as
    // it drops. In the barrel's frame the hatch sits HATCH below the pins; leaning moves it up.
    if (leg.current && strut.current && foot.current) {
      leg.current.visible = p.leg > 0.02;
      leg.current.rotation.x = p.tilt;
      const reach = Math.max(0.02, SHOULDER + HATCH * Math.cos(p.tilt));
      const len = reach * p.leg;
      strut.current.scale.y = Math.max(0.001, len);
      strut.current.position.y = -len / 2;
      foot.current.position.y = -len;
    }
  });

  return (
    <group ref={root}>
      {/* The outer legs: a shoulder hub, a tapered strut and a wheeled foot, either side. They don't lean. */}
      {[1, -1].map((side, i) => (
        <group key={side} position={[side * LEG_X, 0, 0]}>
          <mesh position={[0, SHOULDER, 0]} rotation={[0, 0, Math.PI / 2]} material={metal} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 0.07, 18]} />
          </mesh>
          <mesh position={[side * 0.038, SHOULDER, 0]} rotation={[0, 0, Math.PI / 2]} material={panel}>
            <cylinderGeometry args={[0.045, 0.045, 0.012, 16]} />
          </mesh>
          <Block size={[0.075, 0.64, 0.12]} position={[0, SHOULDER - 0.3, 0]} material={shell} radius={0.025} />
          <Block size={[0.08, 0.16, 0.06]} position={[side * 0.003, SHOULDER - 0.26, 0.035]} material={panel} radius={0.015} />
          <Block size={[0.085, 0.07, 0.1]} position={[0, 0.16, 0]} material={metal} radius={0.015} />
          {/* The foot: a wedge of a housing over a drive wheel. */}
          <Block size={[0.12, 0.13, 0.26]} position={[0, 0.075, 0.015]} rotation={[0.05, 0, 0]} material={shell} radius={0.03} />
          <Block size={[0.124, 0.03, 0.2]} position={[0, 0.1, 0.02]} material={panel} radius={0.01} />
          <mesh ref={(m) => void (wheels.current[i] = m)} position={[0, 0.035, 0.02]} rotation={[0, 0, Math.PI / 2]} material={dark}>
            <cylinderGeometry args={[0.035, 0.035, 0.1, 14]} />
          </mesh>
        </group>
      ))}

      {/* The barrel, pivoting on the pins. */}
      <group position={[0, SHOULDER, 0]}>
        <group ref={barrel}>
          <mesh position={[0, (TOP + BOTTOM) / 2, 0]} material={shell} castShadow receiveShadow>
            <cylinderGeometry args={[R, R, TOP - BOTTOM, 28]} />
          </mesh>
          {/* The skirt the barrel tapers into, and the dark hatch the third leg comes out of. */}
          <mesh position={[0, BOTTOM - 0.035, 0]} material={metal} castShadow>
            <cylinderGeometry args={[R * 0.96, R * 0.7, 0.07, 24]} />
          </mesh>
          <mesh position={[0, HATCH - 0.002, 0]} material={dark}>
            <cylinderGeometry args={[0.07, 0.07, 0.01, 16]} />
          </mesh>
          {/* A blue band under the dome's seam, panels and vents on the front, a logic display that flickers. */}
          <mesh position={[0, TOP - 0.02, 0]} material={panel}>
            <cylinderGeometry args={[R + 0.004, R + 0.004, 0.03, 28]} />
          </mesh>
          <Block size={[0.2, 0.14, 0.03]} position={[0, -0.08, R - 0.005]} material={panel} radius={0.012} />
          <Block size={[0.12, 0.05, 0.02]} position={[0, -0.08, R + 0.012]} material={logic} radius={0.008} shadows={false} />
          {[-0.07, 0, 0.07].map((x) => (
            <Block key={x} size={[0.04, 0.16, 0.025]} position={[x, -0.3, R - 0.005]} material={x ? panel : metal} radius={0.01} />
          ))}
          {[1, -1].map((side) => (
            <Block key={side} size={[0.025, 0.24, 0.1]} position={[side * (R - 0.004), -0.2, 0.08]} rotation={[0, side * 0.35, 0]} material={panel} radius={0.01} />
          ))}
          <Block size={[0.1, 0.02, 0.025]} position={[0, -0.42, R - 0.006]} material={dark} radius={0.006} />

          {/* The dome: it turns on its own, all the way round. */}
          <group ref={dome} position={[0, TOP, 0]}>
            <mesh material={silver} castShadow>
              <sphereGeometry args={[R, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            {/* Blue panels set into the dome, the radar eye and its housing, the lamp, and a little periscope. */}
            {[0.6, 1.6, 2.9, 4.1, 5.2].map((a) => (
              <group key={a} rotation={[0, a, 0]}>
                <Block size={[0.08, 0.05, 0.03]} position={[0, 0.07, R - 0.012]} rotation={[-0.3, 0, 0]} material={panel} radius={0.008} shadows={false} />
              </group>
            ))}
            <Block size={[0.11, 0.07, 0.05]} position={[0, 0.12, R * 0.82]} rotation={[-0.62, 0, 0]} material={panel} radius={0.012} />
            <mesh position={[0, 0.125, R * 0.86 + 0.02]} rotation={[Math.PI / 2 - 0.62, 0, 0]} material={eye}>
              <cylinderGeometry args={[0.03, 0.03, 0.02, 18]} />
            </mesh>
            <mesh position={[0.1, 0.05, R * 0.95]} material={lamp}>
              <sphereGeometry args={[0.022, 12, 8]} />
            </mesh>
            <mesh position={[-0.08, 0.035, R * 0.97]} material={dark}>
              <sphereGeometry args={[0.016, 10, 8]} />
            </mesh>
            <mesh position={[0, R - 0.01, -0.06]} material={metal}>
              <cylinderGeometry args={[0.014, 0.014, 0.05, 8]} />
            </mesh>
          </group>

          {/* The third leg, in the barrel's frame at the hatch: counter-turned so it hangs straight down to the floor. */}
          <group position={[0, HATCH, 0]}>
            <group ref={leg} visible={false}>
              <mesh ref={strut} material={shell} castShadow>
                <cylinderGeometry args={[0.04, 0.05, 1, 14]} />
              </mesh>
              <group ref={foot}>
                <Block size={[0.12, 0.06, 0.17]} position={[0, 0.03, 0.01]} material={shell} radius={0.02} />
                <Block size={[0.124, 0.02, 0.12]} position={[0, 0.05, 0.01]} material={panel} radius={0.008} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
