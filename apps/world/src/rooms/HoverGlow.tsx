import { getStation, type RoomId } from "@ceo/core";
import { submindOf } from "@ceo/simulator";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending, CanvasTexture, type Mesh, type MeshBasicMaterial } from "three";
import { PBR } from "../fx/pbr.ts";

const R = 0.9;

/** A soft round glow, bright in the middle and gone at the edge. Shared by every hover glow. */
let glowTex: CanvasTexture | null = null;
function glowMap() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (glowTex = new CanvasTexture(c));
}

/** The submind's accent glow, pooled on the floor beneath it and breathing slowly, so its colour reads across the room. */
function Glow({ colour, phase }: { colour: string; phase: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const b = 0.5 + Math.sin(clock.elapsedTime * 1.1 + phase) * 0.12;
    (m.material as MeshBasicMaterial).opacity = b * 0.8;
    m.scale.setScalar(1 + (b - 0.5) * 0.4);
  });
  return (
    <mesh ref={ref} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[3.4, 3.4]} />
      <meshBasicMaterial color={colour} map={glowMap()} transparent opacity={0.4} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/**
 * Where a room's Skippy submind hovers (docs/SKIPPY.md): the submind floats overhead, looking down on the room,
 * and this marks the floor beneath it: a soft pool of light and a thin ring in its colour. Nothing solid, so
 * nobody has to walk round it.
 */
export function HoverGlow({ room }: { room: RoomId }) {
  const st = getStation(room, "post");
  const colour = submindOf(room).colour;
  return (
    <group position={[st.x, 0, st.z]}>
      <Glow colour={colour} phase={st.x * 3 + st.z} />
      <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light(colour, 1.4)}>
        <ringGeometry args={[R - 0.03, R, 64]} />
      </mesh>
    </group>
  );
}
