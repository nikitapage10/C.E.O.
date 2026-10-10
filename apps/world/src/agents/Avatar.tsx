import type { Look } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DoubleSide, MeshPhysicalMaterial, type Group, type Mesh } from "three";
import { PBR } from "../fx/pbr.ts";
import { Block } from "../rooms/primitives.tsx";

/**
 * The avatar wardrobe: heads, faces, hats, outfits and props, all procedural so any combination works.
 * Coordinates: the head group is centred on the head; body parts are relative to the agent's feet, +z forward.
 */

const shellCache = new Map<string, MeshPhysicalMaterial>();
export function shellMaterial(color: string) {
  let m = shellCache.get(color);
  if (!m) {
    m = new MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 });
    shellCache.set(color, m);
  }
  return m;
}
const fabric = (c: string) => PBR.fabric(c);
const VISOR = new MeshPhysicalMaterial({ color: "#05070a", roughness: 0.05, metalness: 0.4, clearcoat: 1, side: DoubleSide });

export function Head({ look }: { look: Look }) {
  const shell = shellMaterial(look.shell);
  switch (look.head) {
    case "dome":
      return (
        <mesh material={shell} scale={[0.95, 1.3, 0.95]} position={[0, 0.03, 0]} castShadow>
          <sphereGeometry args={[0.2, 40, 28]} />
        </mesh>
      );
    case "crt":
      return (
        <group>
          <Block size={[0.44, 0.34, 0.36]} material={shell} radius={0.05} />
          <Block size={[0.3, 0.22, 0.12]} position={[0, 0, -0.2]} material={shell} radius={0.04} />
        </group>
      );
    case "cube":
      return <Block size={[0.36, 0.36, 0.36]} material={shell} radius={0.09} />;
    case "helmet":
    default:
      return (
        <mesh material={shell} scale={[1, 1.08, 1]} castShadow>
          <sphereGeometry args={[0.2, 40, 28]} />
        </mesh>
      );
  }
}

/** How far forward the face sits for each head. */
const FRONT: Record<Look["head"], number> = { helmet: 0.2, dome: 0.19, crt: 0.182, cube: 0.182 };

export function Face({ look }: { look: Look }) {
  const z = FRONT[look.head];
  const light = PBR.light(look.accent, 3.2);
  const eyes = (
    <>
      {[-0.07, 0.07].map((x) => (
        <mesh key={x} position={[x, 0.03, z]} material={light}>
          <sphereGeometry args={[0.026, 16, 12]} />
        </mesh>
      ))}
    </>
  );
  switch (look.face) {
    case "eyes":
      return eyes;
    case "screen":
      return (
        <group position={[0, 0, z + 0.002]}>
          <mesh material={PBR.light(look.accent, 0.5)}>
            <planeGeometry args={[0.3, 0.2]} />
          </mesh>
          {[-0.06, 0.06].map((x) => (
            <mesh key={x} position={[x, 0.025, 0.002]} material={PBR.light(look.accent, 4)}>
              <planeGeometry args={[0.035, 0.05]} />
            </mesh>
          ))}
          <mesh position={[0, -0.045, 0.002]} material={PBR.light(look.accent, 4)}>
            <planeGeometry args={[0.1, 0.014]} />
          </mesh>
        </group>
      );
    case "shades":
      return (
        <group position={[0, 0.03, z + 0.01]}>
          {[-0.07, 0.07].map((x) => (
            <Block key={x} size={[0.11, 0.055, 0.02]} position={[x, 0, 0]} material={VISOR} radius={0.012} />
          ))}
          <Block size={[0.3, 0.012, 0.012]} material={PBR.blackMetal()} radius={0.004} />
        </group>
      );
    case "glasses":
      return (
        <group position={[0, 0.03, z + 0.01]}>
          {eyes}
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} position={[x, 0, 0]} material={PBR.chrome()}>
              <torusGeometry args={[0.045, 0.006, 8, 24]} />
            </mesh>
          ))}
          <Block size={[0.05, 0.008, 0.008]} material={PBR.chrome()} radius={0.003} />
        </group>
      );
    case "mustache":
      return (
        <>
          {eyes}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.045, -0.05, z + 0.005]} rotation={[0, 0, s * 0.35]} scale={[1.6, 0.6, 0.6]} material={PBR.matte("#3a2418", 0.9)}>
              <sphereGeometry args={[0.03, 12, 10]} />
            </mesh>
          ))}
        </>
      );
    case "visor":
    default:
      if (look.head === "crt" || look.head === "cube") {
        return (
          <mesh position={[0, 0.02, z + 0.002]} material={PBR.light(look.accent, 3)}>
            <planeGeometry args={[0.24, 0.02]} />
          </mesh>
        );
      }
      return (
        <>
          <mesh rotation={[0, Math.PI, 0]} material={VISOR}>
            <cylinderGeometry args={[0.205, 0.205, 0.13, 40, 1, true, Math.PI * 0.68, Math.PI * 0.64]} />
          </mesh>
          <mesh position={[0, 0.002, 0]} rotation={[0, Math.PI, 0]} material={PBR.light(look.accent, 3.2)}>
            <cylinderGeometry args={[0.208, 0.208, 0.012, 40, 1, true, Math.PI * 0.74, Math.PI * 0.52]} />
          </mesh>
        </>
      );
  }
}

/** Top of the head, per head shape. */
const TOP: Record<Look["head"], number> = { helmet: 0.2, dome: 0.28, crt: 0.17, cube: 0.18 };

export function Hat({ look }: { look: Look }) {
  const top = TOP[look.head];
  const trim = PBR.lacquer(look.trim, 0.5);
  const spin = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (spin.current) spin.current.rotation.z = clock.elapsedTime * 0.4;
  });
  switch (look.hat) {
    case "cap":
      return (
        <group position={[0, top - 0.06, 0]}>
          <mesh material={trim} castShadow>
            <sphereGeometry args={[0.21, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <Block size={[0.26, 0.02, 0.18]} position={[0, 0.005, 0.2]} material={trim} radius={0.008} />
          <mesh position={[0, 0.1, 0.17]} material={PBR.matte("#ffffff", 0.8)}>
            <circleGeometry args={[0.04, 20]} />
          </mesh>
        </group>
      );
    case "tophat":
      return (
        <group position={[0, top, 0]} rotation={[0, 0, 0.08]}>
          <mesh position={[0, 0.01, 0]} material={trim} castShadow>
            <cylinderGeometry args={[0.24, 0.24, 0.02, 32]} />
          </mesh>
          <mesh position={[0, 0.15, 0]} material={trim} castShadow>
            <cylinderGeometry args={[0.14, 0.14, 0.28, 32]} />
          </mesh>
          <mesh position={[0, 0.05, 0]} material={PBR.lacquer("#7a1f24", 0.4)}>
            <cylinderGeometry args={[0.142, 0.142, 0.04, 32]} />
          </mesh>
        </group>
      );
    case "headphones":
      return (
        <group>
          <mesh position={[0, 0.02, 0]} rotation={[0, 0, 0]} material={PBR.blackMetal()}>
            <torusGeometry args={[0.235, 0.018, 8, 40, Math.PI]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.225, 0.0, 0]} rotation={[0, 0, Math.PI / 2]} material={trim} castShadow>
              <cylinderGeometry args={[0.07, 0.07, 0.06, 24]} />
            </mesh>
          ))}
        </group>
      );
    case "crown":
      return (
        <group position={[0, top + 0.02, 0]}>
          <mesh material={PBR.brass()} castShadow>
            <cylinderGeometry args={[0.15, 0.15, 0.08, 32, 1, true]} />
          </mesh>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[Math.cos((i / 6) * Math.PI * 2) * 0.15, 0.08, Math.sin((i / 6) * Math.PI * 2) * 0.15]} material={PBR.brass()}>
              <coneGeometry args={[0.03, 0.09, 8]} />
            </mesh>
          ))}
          <mesh position={[0, 0.02, 0.15]} material={PBR.light(look.accent, 3)}>
            <octahedronGeometry args={[0.025, 0]} />
          </mesh>
        </group>
      );
    case "cowboy":
      return (
        <group position={[0, top - 0.02, 0]}>
          <mesh scale={[1, 0.18, 1.2]} material={trim} castShadow>
            <sphereGeometry args={[0.36, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, 0.09, 0]} scale={[1, 1, 1.15]} material={trim} castShadow>
            <cylinderGeometry args={[0.13, 0.16, 0.18, 24]} />
          </mesh>
        </group>
      );
    case "wizard":
      return (
        <group position={[0, top - 0.02, 0]} rotation={[-0.15, 0, 0.12]}>
          <mesh position={[0, 0.01, 0]} material={trim} castShadow>
            <cylinderGeometry args={[0.27, 0.27, 0.02, 32]} />
          </mesh>
          <mesh position={[0, 0.28, 0]} material={trim} castShadow>
            <coneGeometry args={[0.17, 0.55, 32]} />
          </mesh>
        </group>
      );
    case "beanie":
      return (
        <group position={[0, top - 0.09, 0]}>
          <mesh material={fabric(look.trim)} castShadow>
            <sphereGeometry args={[0.215, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={fabric(look.trim)}>
            <torusGeometry args={[0.205, 0.03, 10, 40]} />
          </mesh>
          <mesh position={[0, 0.22, 0]} material={fabric("#efe9dc")}>
            <sphereGeometry args={[0.045, 14, 12]} />
          </mesh>
        </group>
      );
    case "halo":
      return (
        <group ref={spin} position={[0, 0.02, -0.1]}>
          <mesh material={PBR.brass()}>
            <torusGeometry args={[0.32, 0.01, 8, 64]} />
          </mesh>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0]} rotation={[0, 0, a]} material={PBR.light(look.accent, 2)}>
                <boxGeometry args={[0.06, 0.008, 0.008]} />
              </mesh>
            );
          })}
        </group>
      );
    case "hood":
      return (
        <mesh position={[0, 0.01, -0.02]} scale={[1.18, 1.2, 1.18]} rotation={[0.25, 0, 0]} material={fabric(look.trim)} castShadow>
          <sphereGeometry args={[0.2, 32, 20, Math.PI * 0.15, Math.PI * 1.7]} />
        </mesh>
      );
    case "none":
    default:
      return null;
  }
}

/** Clothing over the torso (torso is ~0.27 wide at the chest, 0.2 at the waist). */
export function Outfit({ look }: { look: Look }) {
  const trim = fabric(look.trim);
  const open = (rTop: number, rBottom: number, y0: number, y1: number, mat = trim) => (
    <mesh position={[0, (y0 + y1) / 2, 0]} material={mat} castShadow>
      <cylinderGeometry args={[rTop, rBottom, y1 - y0, 40, 1, true, Math.PI * 0.12, Math.PI * 1.76]} />
    </mesh>
  );
  const closed = (rTop: number, rBottom: number, y0: number, y1: number, mat = trim) => (
    <mesh position={[0, (y0 + y1) / 2, 0]} material={mat} castShadow>
      <cylinderGeometry args={[rTop, rBottom, y1 - y0, 40, 1, true]} />
    </mesh>
  );
  switch (look.outfit) {
    case "tie":
      return (
        <group position={[0, 0, 0.255]}>
          <Block size={[0.06, 0.05, 0.02]} position={[0, 1.02, 0]} material={PBR.lacquer(look.trim, 0.4)} radius={0.01} />
          <Block size={[0.07, 0.32, 0.015]} position={[0, 0.84, -0.005]} rotation={[0.12, 0, 0]} material={PBR.lacquer(look.trim, 0.4)} radius={0.006} />
        </group>
      );
    case "scarf":
      return (
        <group>
          <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]} material={trim} castShadow>
            <torusGeometry args={[0.13, 0.05, 12, 32]} />
          </mesh>
          <Block size={[0.09, 0.32, 0.03]} position={[0.08, 0.92, 0.22]} rotation={[0.2, 0, -0.1]} material={trim} radius={0.012} />
        </group>
      );
    case "cape":
      return (
        <mesh position={[0, 0.68, -0.02]} material={PBR.lacquer(look.trim, 0.6)} castShadow>
          <cylinderGeometry args={[0.24, 0.36, 0.9, 40, 1, true, Math.PI * 0.6, Math.PI * 0.8]} />
        </mesh>
      );
    case "jacket":
      return open(0.285, 0.235, 0.6, 1.06);
    case "vest":
      return (
        <group>
          {open(0.3, 0.27, 0.66, 1.04)}
          {[0.75, 0.86, 0.97].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={trim}>
              <torusGeometry args={[0.29, 0.02, 8, 40, Math.PI * 1.76]} />
            </mesh>
          ))}
        </group>
      );
    case "labcoat":
      return open(0.29, 0.29, 0.28, 1.06, fabric("#f2f2ef"));
    case "trenchcoat":
      return (
        <group>
          {open(0.29, 0.36, 0.14, 1.06)}
          <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.blackMetal()}>
            <torusGeometry args={[0.215, 0.012, 8, 40]} />
          </mesh>
        </group>
      );
    case "overalls":
      return (
        <group>
          {closed(0.215, 0.2, 0.3, 0.66)}
          <Block size={[0.22, 0.26, 0.03]} position={[0, 0.78, 0.235]} material={trim} radius={0.02} />
          {[-0.08, 0.08].map((x) => (
            <Block key={x} size={[0.035, 0.36, 0.02]} position={[x, 0.93, 0.21]} rotation={[0.35, 0, 0]} material={trim} radius={0.008} />
          ))}
          {[-0.08, 0.08].map((x) => (
            <mesh key={x} position={[x, 0.88, 0.255]} material={PBR.brass()}>
              <sphereGeometry args={[0.018, 10, 10]} />
            </mesh>
          ))}
        </group>
      );
    case "jumpsuit":
      return (
        <group>
          {closed(0.29, 0.225, 0.3, 1.06)}
          <Block size={[0.12, 0.05, 0.02]} position={[-0.11, 0.92, 0.27]} material={PBR.lacquer("#d23a2e", 0.4)} radius={0.01} />
        </group>
      );
    case "robe":
      return (
        <group>
          {closed(0.29, 0.38, 0.06, 1.06)}
          <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.matte("#3a2a1a", 0.9)}>
            <torusGeometry args={[0.215, 0.018, 8, 40]} />
          </mesh>
        </group>
      );
    case "none":
    default:
      return null;
  }
}

/** Things worn on the back or underfoot. */
export function BackProp({ look }: { look: Look }) {
  const flames = useRef<Group>(null);
  useFrame(({ clock }) => {
    flames.current?.children.forEach((f, i) => f.scale.set(1, 0.7 + Math.abs(Math.sin(clock.elapsedTime * 22 + i)) * 0.6, 1));
  });
  const trim = PBR.lacquer(look.trim, 0.45);
  switch (look.extra) {
    case "backpack":
      return <Block size={[0.34, 0.4, 0.16]} position={[0, 0.82, -0.3]} material={fabric(look.trim)} radius={0.06} />;
    case "tank":
      return (
        <group position={[0, 0.8, -0.32]}>
          <Block size={[0.38, 0.5, 0.2]} material={PBR.steel()} radius={0.05} />
          <mesh position={[0.1, 0, -0.1]} material={PBR.aluminium()} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 0.46, 20]} />
          </mesh>
          <mesh position={[-0.12, 0.05, -0.12]} material={PBR.light(look.accent, 2.4)}>
            <boxGeometry args={[0.04, 0.2, 0.02]} />
          </mesh>
          <mesh position={[0.22, -0.18, 0.18]} rotation={[0, 0, 0.6]} material={PBR.blackMetal()}>
            <torusGeometry args={[0.16, 0.02, 8, 24, Math.PI]} />
          </mesh>
        </group>
      );
    case "jetpack":
      return (
        <group position={[0, 0.82, -0.3]}>
          {[-0.09, 0.09].map((x) => (
            <mesh key={x} position={[x, 0, 0]} material={trim} castShadow>
              <cylinderGeometry args={[0.075, 0.075, 0.42, 20]} />
            </mesh>
          ))}
          <group ref={flames}>
            {[-0.09, 0.09].map((x) => (
              <mesh key={x} position={[x, -0.3, 0]} rotation={[Math.PI, 0, 0]} material={PBR.light("#ffb347", 4)}>
                <coneGeometry args={[0.05, 0.16, 12]} />
              </mesh>
            ))}
          </group>
        </group>
      );
    case "guitar":
      return (
        <group position={[0.05, 0.75, -0.3]} rotation={[0, 0, 0.6]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 1]} material={trim} castShadow>
            <cylinderGeometry args={[0.16, 0.16, 0.06, 6]} />
          </mesh>
          <Block size={[0.05, 0.55, 0.03]} position={[0, 0.38, 0]} material={PBR.wood("walnut")} radius={0.01} />
          <Block size={[0.09, 0.1, 0.03]} position={[0, 0.68, 0]} material={trim} radius={0.01} />
        </group>
      );
    case "hoverboard":
      return (
        <group position={[0, 0.04, 0]}>
          <Block size={[0.32, 0.05, 0.9]} material={PBR.lacquer(look.trim, 0.3)} radius={0.025} />
          <mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light(look.accent, 2.4)}>
            <planeGeometry args={[0.22, 0.75]} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** Things held in a hand (they ride along with the floating hand). */
export function HandProp({ look, hand }: { look: Look; hand: "left" | "right" }) {
  const blade = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (blade.current) blade.current.scale.x = blade.current.scale.z = 0.9 + Math.sin(clock.elapsedTime * 30) * 0.1;
  });
  if (look.extra === "sword" && hand === "right") {
    return (
      <group rotation={[0.4, 0, 0]}>
        <mesh position={[0, 0, 0]} material={PBR.chrome()}>
          <cylinderGeometry args={[0.022, 0.022, 0.16, 12]} />
        </mesh>
        <mesh ref={blade} position={[0, 0.45, 0]} material={PBR.light(look.accent, 4)}>
          <cylinderGeometry args={[0.018, 0.018, 0.75, 10]} />
        </mesh>
      </group>
    );
  }
  if (look.extra === "clipboard" && hand === "left") {
    return (
      <group position={[0, 0.05, 0.06]} rotation={[-0.5, 0.3, 0]}>
        <Block size={[0.2, 0.27, 0.012]} material={PBR.wood("oak")} radius={0.005} />
        <Block size={[0.16, 0.2, 0.004]} position={[0, -0.01, 0.008]} material={PBR.matte("#f2efe6", 0.9)} radius={0.002} />
        <Block size={[0.07, 0.025, 0.02]} position={[0, 0.13, 0.01]} material={PBR.chrome()} radius={0.005} />
      </group>
    );
  }
  return null;
}
