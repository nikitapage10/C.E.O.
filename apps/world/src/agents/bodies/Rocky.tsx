import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { IcosahedronGeometry, MeshStandardMaterial, Vector3, type Group, type Mesh } from "three";
import { PBR } from "../../fx/pbr.ts";
import { roughnessNoise } from "../../fx/textures.ts";
import { knee, SEGMENT, smooth, span } from "./limbs.ts";
import type { BodyProps } from "./types.ts";

/** A rough, faceted carapace: an icosphere pushed about by a cheap deterministic noise. */
function carapace() {
  const g = new IcosahedronGeometry(0.4, 3);
  const p = g.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 11.3) * Math.cos(v.z * 9.7) * Math.sin(v.y * 13.1 + v.x * 3);
    const ridge = Math.abs(Math.sin(Math.atan2(v.z, v.x) * 2.5)) * 0.04; // five lobes, one per leg
    v.multiplyScalar(1 + n * 0.07 + ridge);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
const CARAPACE = carapace();

const LEGS = 5;
const UPPER = 0.36;
const LOWER = 0.5;
const HIP_R = 0.3;
const HIP_Y = 0.6;
const FOOT_R = 0.62;

const hip = new Vector3();
const foot = new Vector3();
const kn = new Vector3();
const out = new Vector3();

/**
 * The Engineer from a Rocky Planet: a stone carapace on five jointed legs, each ending in a three-fingered
 * hand. No eyes, no face. Talks through a vent on top, in chords.
 */
export function Rocky({ look, drive, phase }: BodyProps) {
  const body = useRef<Group>(null);
  const vent = useRef<Mesh>(null);
  const uppers = useRef<(Mesh | null)[]>([]);
  const lowers = useRef<(Mesh | null)[]>([]);
  const knees = useRef<(Mesh | null)[]>([]);
  const hands = useRef<(Group | null)[]>([]);
  const lift = useRef(0);
  const stone = useMemo(
    () => new MeshStandardMaterial({ color: look.shell, roughness: 0.92, metalness: 0.05, roughnessMap: roughnessNoise([2, 2]), flatShading: true }),
    [look.shell],
  );
  const limb = useMemo(() => new MeshStandardMaterial({ color: look.trim, roughness: 0.85, metalness: 0.05, flatShading: true }), [look.trim]);
  const glow = useMemo(() => PBR.light(look.accent, 2), [look.accent]);

  useFrame(() => {
    const d = drive.current;
    if (!d || !body.current) return;
    const { t, mode } = d;
    const walking = mode === "walking" || mode === "carrying";
    const resting = mode === "napping" || mode === "slumped";
    const cheering = mode === "celebrating";
    lift.current = smooth(lift.current, resting ? -0.32 : cheering ? Math.abs(Math.sin(t * 6)) * 0.12 : 0, 0.12);
    const bob = walking ? Math.abs(Math.sin(t * 8 + phase)) * 0.03 : Math.sin(t * 1.5 + phase) * 0.01;
    body.current.position.y = HIP_Y + lift.current + bob;
    body.current.rotation.y = mode === "working" || mode === "typing" ? Math.sin(t * 0.8 + phase) * 0.25 : 0;
    if (vent.current) vent.current.scale.setScalar(d.speaking ? 1 + Math.abs(Math.sin(t * 14)) * 0.5 : 0.8);

    for (let i = 0; i < LEGS; i++) {
      const a = (i / LEGS) * Math.PI * 2 + Math.PI / 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      hip.set(cx * HIP_R, body.current.position.y - 0.04, cz * HIP_R);
      // A five-beat gait: each foot steps in turn, swinging along the direction of travel (+z).
      const beat = t * 7 + (i * Math.PI * 4) / LEGS + phase;
      let fx = cx * FOOT_R;
      let fz = cz * FOOT_R;
      let fy = 0;
      if (walking) {
        fz += Math.sin(beat) * 0.14;
        fy = Math.max(0, Math.cos(beat)) * 0.12;
      }
      if (resting) {
        fx = cx * (FOOT_R + 0.12);
        fz = cz * (FOOT_R + 0.12);
      }
      // Fist my bump: the front leg comes up and forward.
      if ((cheering || mode === "waiting") && i === 0) {
        fx = 0;
        fz = 0.7;
        fy = 0.75 + (cheering ? Math.sin(t * 6) * 0.08 : Math.sin(t * 3) * 0.04);
      }
      if ((mode === "typing" || mode === "working") && i === 0) {
        fx = 0.05;
        fz = 0.6;
        fy = 0.35 + Math.max(0, Math.sin(t * (mode === "typing" ? 14 : 5) + phase)) * 0.08;
      }
      foot.set(fx, fy, fz);
      out.set(cx, 1.4, cz);
      knee(hip, foot, UPPER, LOWER, out, kn);
      span(uppers.current[i]!, hip, kn, 0.05);
      span(lowers.current[i]!, kn, foot, 0.04);
      knees.current[i]?.position.copy(kn);
      const h = hands.current[i];
      if (h) {
        h.position.copy(foot);
        h.rotation.y = -a + Math.PI / 2;
      }
    }
  });

  return (
    <group>
      <group ref={body} position={[0, HIP_Y, 0]}>
        <mesh geometry={CARAPACE} material={stone} castShadow receiveShadow position={[0, 0.06, 0]} />
        {/* The vent: where the music comes out. */}
        <mesh ref={vent} position={[0, 0.31, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow}>
          <ringGeometry args={[0.035, 0.06, 20]} />
        </mesh>
        <mesh position={[0, 0.305, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.blackMetal()}>
          <circleGeometry args={[0.035, 20]} />
        </mesh>
      </group>
      {Array.from({ length: LEGS }, (_, i) => (
        <group key={i}>
          <mesh ref={(m) => void (uppers.current[i] = m)} geometry={SEGMENT} material={limb} castShadow />
          <mesh ref={(m) => void (lowers.current[i] = m)} geometry={SEGMENT} material={limb} castShadow />
          <mesh ref={(m) => void (knees.current[i] = m)} material={stone} castShadow>
            <dodecahedronGeometry args={[0.065, 0]} />
          </mesh>
          <group ref={(g) => void (hands.current[i] = g)}>
            {[-1, 0, 1].map((f) => (
              <mesh key={f} position={[f * 0.035, 0.02, 0.03]} rotation={[Math.PI / 2.4, 0, f * 0.35]} material={limb} castShadow>
                <coneGeometry args={[0.02, 0.09, 6]} />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </group>
  );
}
