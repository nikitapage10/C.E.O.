import type { RoomId } from "./layout.ts";

/**
 * Each room's command podium: where the room's Skippy submind sits by default, on a hex platform that floats high in
 * the back-right corner (as the default camera sees it: +x, -z), directing the room from there (docs/SKIPPY.md).
 * Room-local (x, z); each spot is clear of the room's furniture and well away from the gate at (0, -6.9). It floats
 * over everyone's heads, so the floor under it is free: agents and pets walk under it.
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
  studio: [7.1, -4.7],
};

/**
 * The floating podium's seat, above the room's floor: higher than the tallest head in the room and clear of the
 * furniture, below the walls' tops, so the default camera sees it against the room rather than the sky.
 */
export const POST_HEIGHT = 2.6;
/** How far the podium's hex platform reaches either way from its centre (it touches nothing; this is just its size). */
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
  studio: [0.5, 0.2],
};

/** How high the submind hovers at the command spot: well clear of every agent and every piece of furniture. */
export const COMMAND_HEIGHT = 2.6;

/**
 * A station at least this high is in the air (the floating podium, the command spot): nobody walks there, and a
 * trip between two of them in one room is a straight glide (layout.ts routeBetween), not a walk round the furniture.
 */
export const AIR_HEIGHT = 2;
/** How fast a submind glides between two spots in the air, on average (m/s); it eases in and out. */
export const FLY_SPEED = 2;
/** How far a glide bows upward at its middle (metres). */
export const FLY_LIFT = 0.45;
