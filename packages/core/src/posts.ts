import type { RoomId } from "./layout.ts";

/**
 * Each room's conductor's post: a small raised podium in the back-right corner (as the default camera sees it),
 * where the room's Skippy submind hovers and directs the room (docs/SKIPPY.md). Room-local (x, z); each spot is
 * clear of the room's furniture and well away from the gate at (0, -6.9).
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

/** The podium's top, above the room's floor: the submind hovers higher than everyone else. */
export const POST_HEIGHT = 0.8;
/** The podium's footprint, as a half extent either way. */
export const POST_HALF = 0.6;
