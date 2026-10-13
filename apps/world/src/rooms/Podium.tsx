import { POST_HEIGHT, getStation, type RoomId } from "@ceo/core";
import { submindOf } from "@ceo/simulator";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending, CanvasTexture, type Mesh, type MeshBasicMaterial } from "three";
import { PBR } from "../fx/pbr.ts";

const R = 0.55;

/** A soft round glow, bright in the middle and gone at the edge. Shared by every podium. */
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

/** The submind's accent glow, pooled on the podium's top and breathing slowly, so its colour reads across the room. */
function Glow({ colour, phase }: { colour: string; phase: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const b = 0.5 + Math.sin(clock.elapsedTime * 1.1 + phase) * 0.12;
    (m.material as MeshBasicMaterial).opacity = b;
    m.scale.setScalar(1 + (b - 0.5) * 0.4);
  });
  return (
    <mesh ref={ref} position={[0, POST_HEIGHT + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.5, 1.5]} />
      <meshBasicMaterial color={colour} map={glowMap()} transparent opacity={0.5} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/**
 * The conductor's post: a small round podium in the room's back-right corner, where the room's Skippy submind
 * hovers and directs everyone (docs/SKIPPY.md). Trimmed in that submind's colour, with a rail and a music stand on
 * the side facing the room. Its footprint is in core/obstacles.ts, so nobody walks through it.
 */
export function Podium({ room }: { room: RoomId }) {
  const st = getStation(room, "post");
  const colour = submindOf(room).colour;
  // The rail: an open arc round the front (local -z faces the room, as an agent's facing does).
  const railArc = Math.PI * 1.1;
  return (
    <group position={[st.x, 0, st.z]} rotation={[0, st.facing, 0]}>
      {/* Plinth, and a step up on the side facing the room. */}
      <mesh position={[0, POST_HEIGHT / 2, 0]} material={PBR.steel()} castShadow receiveShadow>
        <cylinderGeometry args={[R, R + 0.06, POST_HEIGHT, 40]} />
      </mesh>
      <mesh position={[0, POST_HEIGHT + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.blackMetal()} receiveShadow>
        <circleGeometry args={[R - 0.04, 40]} />
      </mesh>
      <mesh position={[0, POST_HEIGHT * 0.25, -R - 0.12]} material={PBR.steel()} castShadow receiveShadow>
        <boxGeometry args={[0.6, POST_HEIGHT * 0.5, 0.3]} />
      </mesh>
      {/* The submind's colour, round the top edge and the foot, and its glow on top. */}
      <Glow colour={colour} phase={st.x * 3 + st.z} />
      <mesh position={[0, POST_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.light(colour, 2.4)}>
        <torusGeometry args={[R - 0.01, 0.022, 8, 48]} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.light(colour, 1.2)}>
        <torusGeometry args={[R + 0.06, 0.012, 6, 48]} />
      </mesh>
      {/* Rail round the front, on three brass posts. */}
      <group position={[0, POST_HEIGHT + 0.55, 0]} rotation={[0, railArc / 2 + Math.PI / 2, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={PBR.brass()} castShadow>
          <torusGeometry args={[R - 0.06, 0.018, 6, 32, railArc]} />
        </mesh>
      </group>
      {[-0.95, 0, 0.95].map((a) => (
        <mesh key={a} position={[Math.sin(a) * (R - 0.06), POST_HEIGHT + 0.275, -Math.cos(a) * (R - 0.06)]} material={PBR.brass()} castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.55, 8]} />
        </mesh>
      ))}
      {/* Music stand to one side of the front, so the room can still see who's conducting. */}
      <group position={[0.34, POST_HEIGHT, -0.26]} rotation={[0, -0.5, 0]}>
        <mesh position={[0, 0.36, 0]} material={PBR.blackMetal()} castShadow>
          <cylinderGeometry args={[0.014, 0.018, 0.72, 8]} />
        </mesh>
        <mesh position={[0, 0.76, -0.02]} rotation={[-0.45, 0, 0]} material={PBR.blackMetal()} castShadow>
          <boxGeometry args={[0.42, 0.28, 0.02]} />
        </mesh>
        <mesh position={[0, 0.765, -0.006]} rotation={[-0.45, 0, 0]} material={PBR.matte("#efe9dc")}>
          <planeGeometry args={[0.36, 0.22]} />
        </mesh>
        <mesh position={[0, 0.62, -0.08]} rotation={[-0.45, 0, 0]} material={PBR.light(colour, 1.6)}>
          <boxGeometry args={[0.42, 0.02, 0.03]} />
        </mesh>
      </group>
    </group>
  );
}
