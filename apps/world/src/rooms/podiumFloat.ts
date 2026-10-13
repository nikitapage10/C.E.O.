import { getStation, roomAngle, type RoomId } from "@ceo/core";

export interface PodiumSway {
  /** Offset from the podium's spot, in the room's local frame (metres). */
  x: number;
  y: number;
  z: number;
  /** A gentle rock about the seat (radians): forward and back, side to side. */
  pitch: number;
  roll: number;
}

/** Each room's podium keeps its own time, so the nine don't bob in step. */
const phaseOf = (room: RoomId) => {
  const st = getStation(room, "post");
  return st.x * 1.7 + st.z * 2.3;
};

/**
 * How a room's floating podium moves at time t (seconds): a slow bob of a few centimetres, a smaller drift either way
 * and a slight rock, like a raft on a long swell. The podium draws itself with it, and the submind sitting on it
 * rides along (Agent.tsx), so the seat and its admiral never part company.
 */
export function podiumSway(room: RoomId, t: number): PodiumSway {
  const p = phaseOf(room);
  return {
    x: Math.sin(t * 0.37 + p) * 0.04,
    y: Math.sin(t * 0.9 + p) * 0.06 + Math.sin(t * 0.41 + p * 2) * 0.02,
    z: Math.sin(t * 0.29 + p * 1.3) * 0.035,
    pitch: Math.sin(t * 0.53 + p) * 0.018,
    roll: Math.sin(t * 0.47 + p * 0.7) * 0.022,
  };
}

/** The same sway's offset in world axes (x, y, z), for a rider that lives outside the room's group. */
export function podiumSwayWorld(room: RoomId, t: number): [number, number, number] {
  const s = podiumSway(room, t);
  const a = roomAngle(room);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [s.x * cos + s.z * sin, s.y, -s.x * sin + s.z * cos];
}
