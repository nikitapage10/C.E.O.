import { Vector3 } from "three";

/**
 * Per-frame values that would be wasteful to keep in React state.
 * `sim` is Lattice time (ms, scaled by the speed control); positions are written by each agent every frame.
 */
export const clock = { sim: 0 };

export const agentPositions = new Map<string, Vector3>();
