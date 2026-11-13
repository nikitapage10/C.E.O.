import type { Vector3 } from "three";

/**
 * Per-frame values that would be wasteful to keep in React state.
 * `sim` is Lattice time (ms, scaled by the speed control); positions are written by each agent every frame.
 */
export const clock = { sim: 0 };

export const agentPositions = new Map<string, Vector3>();

/** Where each pet is, written by the pet every frame (keyed `pet-<id>`, so it never clashes with an agent's id). */
export const petPositions = new Map<string, Vector3>();

/**
 * Everyone else on the floor near `at` (agents and pets, within `reach` and about the same height), for keeping a
 * personal space (#1136). A floating submind overhead or someone in another room never counts.
 */
export function bodiesNear(selfId: string, at: Vector3, reach = 1.5): { id: string; x: number; z: number }[] {
  const out: { id: string; x: number; z: number }[] = [];
  for (const map of [agentPositions, petPositions]) {
    for (const [id, p] of map) {
      if (id === selfId || Math.abs(p.y - at.y) > 0.8 || Math.abs(p.x - at.x) > reach || Math.abs(p.z - at.z) > reach) continue;
      out.push({ id, x: p.x, z: p.z });
    }
  }
  return out;
}

/**
 * Where a chatting agent steps to keep a talking distance: a floor-plane nudge from their station spot (world
 * x, z), held until `until` (performance.now). Each agent eases toward it, and back to nothing once it lapses.
 */
export const talkSteps = new Map<string, { x: number; z: number; until: number }>();
