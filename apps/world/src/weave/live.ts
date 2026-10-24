import type { LatticeState, RoomId } from "@ceo/core";
import { roomRgb } from "./bus.ts";

/**
 * What the Weave draws in the world (#374), read from the Lattice's state: real work only. A task counts when a real
 * agent started it (TaskRecord.live, set for events whose source isn't the simulator) and it's still running; the
 * demo's tasks never do, so a room the demo plays stays dark.
 */

export interface Worker {
  id: string;
  rgb: string;
  /** A steady 0..1 per agent, so each one's motes turn their own way. */
  seed: number;
}
export interface Derived {
  /** Rooms with real work running, and how much. */
  rooms: [RoomId, number][];
  /** Agents working a real task right now. */
  workers: Worker[];
}

export function derive(l: LatticeState): Derived {
  const count = new Map<RoomId, number>();
  const workers: Worker[] = [];
  for (const t of Object.values(l.tasks)) if (t.live && t.status === "running") count.set(t.room, (count.get(t.room) ?? 0) + 1);
  for (const a of Object.values(l.agents)) {
    const t = a.taskId ? l.tasks[a.taskId] : undefined;
    if (t?.live && t.status === "running") workers.push({ id: a.agent.id, rgb: roomRgb(t.room), seed: hash(a.agent.id) });
  }
  return { rooms: [...count], workers };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
