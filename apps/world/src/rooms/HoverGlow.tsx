import { getStation, type RoomId } from "@ceo/core";
import { submindOf } from "@ceo/simulator";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending, CanvasTexture, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { useWorld } from "../store.ts";

const R = 0.9;

/** A soft round glow, bright in the middle and gone at the edge. Shared by every hover glow (and the podiums). */
let glowTex: CanvasTexture | null = null;
export function glowMap() {
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

/**
 * Where a room's Skippy submind floats out to when it gives a command (docs/SKIPPY.md): while it is out over the
 * middle of the room, the floor beneath it carries a soft pool of light and a thin ring in its colour, breathing
 * slowly. It fades in as the submind leaves its podium and out as it heads home. Nothing solid, so nobody has to
 * walk round it.
 */
export function HoverGlow({ room }: { room: RoomId }) {
  const st = getStation(room, "command");
  const { id, colour } = submindOf(room);
  const out = useWorld((s) => {
    const p = s.lattice.agents[id]?.place;
    return !!p && p.room === room && p.station === "command";
  });
  const group = useRef<Group>(null);
  const pool = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const fade = useRef(0);
  const phase = st.x * 3 + st.z;
  useFrame(({ clock }, dt) => {
    fade.current += ((out ? 1 : 0) - fade.current) * (1 - Math.exp(-dt * 2.5));
    const g = group.current;
    if (!g) return;
    g.visible = fade.current > 0.01;
    if (!g.visible) return;
    const b = 0.5 + Math.sin(clock.elapsedTime * 1.1 + phase) * 0.12;
    if (pool.current) {
      (pool.current.material as MeshBasicMaterial).opacity = b * 0.8 * fade.current;
      pool.current.scale.setScalar(1 + (b - 0.5) * 0.4);
    }
    if (ring.current) (ring.current.material as MeshBasicMaterial).opacity = fade.current;
  });
  return (
    <group ref={group} position={[st.x, 0, st.z]} visible={false}>
      <mesh ref={pool} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.4, 3.4]} />
        <meshBasicMaterial color={colour} map={glowMap()} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={ring} position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[R - 0.03, R, 64]} />
        <meshBasicMaterial color={colour} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
