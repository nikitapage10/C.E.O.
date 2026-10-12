import type { Vector3 } from "three";

/**
 * Per-frame values that would be wasteful to keep in React state.
 * `sim` is Lattice time (ms, scaled by the speed control); positions are written by each agent every frame.
 */
export const clock = { sim: 0 };

export const agentPositions = new Map<string, Vector3>();

/**
 * Where a chatting agent steps to keep a talking distance: a floor-plane nudge from their station spot (world
 * x, z), held until `until` (performance.now). Each agent eases toward it, and back to nothing once it lapses.
 */
export const talkSteps = new Map<string, { x: number; z: number; until: number }>();
