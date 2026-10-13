import type { RoomId } from "./layout.ts";

/**
 * Each room's command podium: where the room's Skippy submind sits by default, on a small raised dais in the
 * back-right corner (as the default camera sees it: +x, -z), directing the room from there (docs/SKIPPY.md).
 * Room-local (x, z); each spot is clear of the room's furniture and well away from the gate at (0, -6.9). The
 * podium's footprint is in obstacles.ts, so everyone walks round it.
 */
export const POSTS: Record<RoomId, readonly [number, number]> = {
  foundry: [6.3, -4.9],
  spire: [7.0, -4.3],
  exchange: [6.3, -5.3],
  green: [6.6, -4.35],
  relay: [6.3, -4.9],
  archive: [7.1, -5.2],
  breakroom: [6.4, -4.8],
  boiler: [6.3, -5.0],
  workshop: [7.3, -4.6],
};

/** The podium's top, above the room's floor: the submind sits there, higher than everyone else in the room. */
export const POST_HEIGHT = 0.8;
/** The podium's footprint, as a half extent either way. */
export const POST_HALF = 0.55;

/**
 * Where the submind floats out to when it starts a command: over the middle of the room, high enough to look down
 * on everyone, with a soft glow on the floor beneath it. Nothing stands there, so it blocks nobody. Room-local (x, z).
 */
export const COMMAND_SPOTS: Record<RoomId, readonly [number, number]> = {
  foundry: [0.6, 0.2],
  spire: [0.4, 0.4],
  exchange: [0.5, 0.2],
  green: [0.6, 0.4],
  relay: [0.4, 0.2],
  archive: [0.6, 0.6],
  breakroom: [0.4, 0.4],
  boiler: [0.5, 0.3],
  workshop: [0.6, 0.4],
};

/** How high the submind hovers at the command spot: well clear of every agent and every piece of furniture. */
export const COMMAND_HEIGHT = 2.6;
