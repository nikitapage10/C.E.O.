import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CanvasTexture, MeshPhysicalMaterial, SRGBColorSpace, type Group, type Mesh } from "three";
import { PBR } from "../fx/pbr.ts";
import type { PetDrive } from "./types.ts";

/** Grey tabby fur: soft bands with ragged edges and a little noise, so the coat reads as fluffy, not painted. */
function tabby() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#8b8d92";
  g.fillRect(0, 0, 256, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const x = (i / 14) * 256 + rnd() * 6;
    g.fillStyle = `rgba(52,54,60,${0.35 + rnd() * 0.25})`;
    g.beginPath();
    for (let y = 0; y <= 256; y += 8) g.lineTo(x + Math.sin(y * 0.05 + i) * 5 + rnd() * 3, y);
    for (let y = 256; y >= 0; y -= 8) g.lineTo(x + 6 + rnd() * 5 + Math.sin(y * 0.05 + i) * 5, y);
    g.fill();
  }
  for (let i = 0; i < 6000; i++) {
    const v = 110 + rnd() * 110;
    g.fillStyle = `rgba(${v},${v},${v + 6},0.18)`;
    g.fillRect(rnd() * 256, rnd() * 256, 1, 2 + rnd() * 3);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let furMat: MeshPhysicalMaterial | null = null;
let chestMat: MeshPhysicalMaterial | null = null;
const fur = () => (furMat ??= new MeshPhysicalMaterial({ map: tabby(), roughness: 0.95, sheen: 1, sheenRoughness: 0.45, sheenColor: "#dfe3ea" }));
let darkMat: MeshPhysicalMaterial | null = null;
const dark = () => (darkMat ??= new MeshPhysicalMaterial({ color: "#45474d", roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: "#9a9ea6" }));
const chest = () => (chestMat ??= new MeshPhysicalMaterial({ color: "#cfd2d6", roughness: 0.95, sheen: 1, sheenRoughness: 0.4, sheenColor: "#ffffff" }));

const TAIL = 9;

/**
 * Myshka: a grey Maine Coon kitten. Big tufted ears, a lion's ruff he hasn't grown into, a tail twice as
 * fluffy as it needs to be, and amber eyes that have already decided you're his.
 */
export function Kitten({ drive }: { drive: React.RefObject<PetDrive> }) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const tail = useRef<(Mesh | null)[]>([]);
  const legs = useRef<(Group | null)[]>([]);
  const ears = useRef<(Group | null)[]>([]);
  const lids = useRef<(Mesh | null)[]>([]);
  const eye = useMemo(() => new MeshPhysicalMaterial({ color: "#d99a2b", roughness: 0.05, clearcoat: 1, emissive: "#3a2306", emissiveIntensity: 0.4 }), []);

  useFrame(() => {
    const d = drive.current;
    if (!d || !body.current || !head.current) return;
    const { t, mode } = d;
    const walk = mode === "walk";
    const sit = mode === "sit" || mode === "groom";
    const nap = mode === "nap";
    const s = t * 11;
    body.current.position.y = nap ? 0.1 : walk ? 0.22 + Math.abs(Math.sin(s)) * 0.015 : 0.22;
    body.current.rotation.x = sit ? -0.55 : 0;
    body.current.scale.y = nap ? 0.8 : 1;
    head.current.position.set(0, nap ? 0.04 : sit ? 0.2 : 0.13, nap ? 0.25 : sit ? 0.16 : 0.24);
    head.current.rotation.x = mode === "groom" ? 0.6 + Math.sin(t * 9) * 0.15 : nap ? 0.5 : -0.1 + Math.sin(t * 0.7) * 0.06;
    head.current.rotation.y = nap ? 0.6 : Math.sin(t * 0.45) * 0.4;
    head.current.rotation.z = Math.sin(t * 0.3) * 0.12;
    legs.current.forEach((g, i) => {
      if (!g) return;
      const front = i < 2;
      const phase = (i === 0 || i === 3 ? 0 : Math.PI) + (front ? 0 : 0.4);
      g.rotation.x = walk ? Math.sin(s + phase) * 0.6 : nap ? (front ? -1.3 : 1.3) : sit && !front ? 1.4 : 0;
    });
    ears.current.forEach((g, i) => {
      if (!g) return;
      // The occasional twitch.
      const twitch = Math.max(0, Math.sin(t * 0.9 + i * 2.1) - 0.97) * 20;
      g.rotation.z = (i === 0 ? 0.25 : -0.25) + (i === 0 ? twitch : -twitch) * 0.3;
    });
    lids.current.forEach((m) => {
      if (!m) return;
      const blink = Math.max(0, Math.sin(t * 0.8) - 0.985) * 60;
      m.scale.y = nap ? 1 : Math.min(1, 0.05 + blink);
    });
    tail.current.forEach((m, i) => {
      if (!m) return;
      const k = i / (TAIL - 1);
      const sway = Math.sin(t * (walk ? 4 : 1.6) - i * 0.6) * (0.03 + k * 0.08);
      const up = nap ? -0.02 + k * 0.02 : walk ? k * 0.32 : sit ? k * 0.05 : 0.04 + k * 0.18;
      const curl = nap ? Math.sin(k * 2.4) * 0.22 : 0;
      m.position.set(sway + curl, 0.02 + up, -0.24 - k * (nap ? 0.18 : 0.28) + (nap ? k * k * 0.3 : 0));
      m.rotation.x = -up * 2.2;
    });
  });

  return (
    <group>
      <group ref={body} position={[0, 0.22, 0]}>
        <mesh scale={[0.14, 0.13, 0.25]} material={fur()} castShadow receiveShadow>
          <sphereGeometry args={[1, 32, 24]} />
        </mesh>
        {/* The ruff he hasn't grown into. */}
        <mesh position={[0, 0.03, 0.16]} scale={[0.13, 0.13, 0.1]} material={chest()} castShadow>
          <sphereGeometry args={[1, 24, 18]} />
        </mesh>
        {[-1, 1].flatMap((x) =>
          [1, -1].map((z) => {
            const i = (z === 1 ? 0 : 2) + (x === -1 ? 0 : 1);
            return (
              <group key={`${x}${z}`} ref={(g) => void (legs.current[i] = g)} position={[x * 0.075, -0.04, z * 0.15]}>
                <mesh position={[0, -0.08, 0]} material={fur()} castShadow>
                  <capsuleGeometry args={[0.035, 0.1, 6, 12]} />
                </mesh>
                <mesh position={[0, -0.16, 0.015]} scale={[1, 0.7, 1.2]} material={chest()} castShadow>
                  <sphereGeometry args={[0.04, 14, 10]} />
                </mesh>
              </group>
            );
          }),
        )}
        {Array.from({ length: TAIL }, (_, i) => (
          <mesh key={i} ref={(m) => void (tail.current[i] = m)} material={i === TAIL - 1 ? dark() : fur()} scale={[1, 1, 1.5]} castShadow>
            <sphereGeometry args={[0.062 - i * 0.003, 14, 10]} />
          </mesh>
        ))}
        <group ref={head} position={[0, 0.13, 0.24]}>
          <mesh scale={[0.12, 0.11, 0.11]} material={fur()} castShadow>
            <sphereGeometry args={[1, 28, 22]} />
          </mesh>
          {/* Muzzle and chin. */}
          {[-1, 1].map((x) => (
            <mesh key={x} position={[x * 0.03, -0.035, 0.09]} material={chest()}>
              <sphereGeometry args={[0.035, 14, 10]} />
            </mesh>
          ))}
          <mesh position={[0, -0.012, 0.115]} material={PBR.lacquer("#c98d93", 0.4)}>
            <sphereGeometry args={[0.012, 10, 8]} />
          </mesh>
          {[-1, 1].map((x, i) => (
            <group key={x} position={[x * 0.048, 0.02, 0.085]}>
              <mesh material={eye} scale={[1, 1.05, 0.6]}>
                <sphereGeometry args={[0.024, 16, 12]} />
              </mesh>
              <mesh position={[0, 0, 0.013]} scale={[0.35, 1, 0.4]} material={PBR.lacquer("#08080a", 0.1)}>
                <sphereGeometry args={[0.018, 10, 8]} />
              </mesh>
              <mesh ref={(m) => void (lids.current[i] = m)} position={[0, 0.006, 0.006]} scale={[1, 0.05, 0.7]} material={fur()}>
                <sphereGeometry args={[0.027, 12, 8]} />
              </mesh>
            </group>
          ))}
          {/* Big Maine Coon ears with lynx tips. */}
          {[-1, 1].map((x, i) => (
            <group key={x} ref={(g) => void (ears.current[i] = g)} position={[x * 0.065, 0.08, -0.01]}>
              <mesh position={[0, 0.045, 0]} material={fur()} castShadow>
                <coneGeometry args={[0.045, 0.1, 4]} />
              </mesh>
              <mesh position={[0, 0.042, 0.012]} scale={[0.7, 0.8, 0.4]} material={PBR.matte("#d9b7b4")}>
                <coneGeometry args={[0.04, 0.09, 4]} />
              </mesh>
              <mesh position={[0, 0.11, 0]} material={PBR.matte("#3a3b40")}>
                <coneGeometry args={[0.008, 0.05, 5]} />
              </mesh>
            </group>
          ))}
          {/* Whiskers. */}
          {[-1, 1].flatMap((x) =>
            [0, 1].map((k) => (
              <mesh key={`${x}${k}`} position={[x * 0.09, -0.03 - k * 0.012, 0.1]} rotation={[0, 0, x * (0.08 + k * 0.12)]} material={PBR.matte("#eceef0")}>
                <boxGeometry args={[0.1, 0.002, 0.002]} />
              </mesh>
            )),
          )}
        </group>
      </group>
    </group>
  );
}
