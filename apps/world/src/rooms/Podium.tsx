import { POST_HEIGHT, getStation, type RoomId } from "@ceo/core";
import { submindOf } from "@ceo/simulator";
import { PBR } from "../fx/pbr.ts";

const R = 0.55;

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
      {/* Plinth and step. */}
      <mesh position={[0, POST_HEIGHT / 2, 0]} material={PBR.steel()} castShadow receiveShadow>
        <cylinderGeometry args={[R, R + 0.06, POST_HEIGHT, 40]} />
      </mesh>
      <mesh position={[0, POST_HEIGHT + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.blackMetal()} receiveShadow>
        <circleGeometry args={[R - 0.04, 40]} />
      </mesh>
      {/* The submind's colour, round the top edge and the foot. */}
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
