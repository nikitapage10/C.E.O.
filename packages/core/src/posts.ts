import type { RoomId } from "./layout.ts";

/**
 * Each room's conductor's post: the spot overhead where the room's Skippy submind hovers, looking down on everyone
 * and directing the room (docs/SKIPPY.md). Room-local (x, z), roughly over the room's centre; the floor beneath it
 * carries a soft glow in the submind's colour. Nothing stands there, so it blocks nobody.
 */
export const POSTS: Record<RoomId, readonly [number, number]> = {
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

/** How high the submind hovers above the room's floor: well clear of every agent and every piece of furniture. */
export const POST_HEIGHT = 3.1;
