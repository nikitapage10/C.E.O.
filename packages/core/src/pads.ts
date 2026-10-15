/**
 * Each room's teleporter: the pad on the floor where an agent, a pet or Brogu steps on to ride the light stream to
 * another room, and where they step off coming in (#155). One rule places it in every room, so no room needs its own
 * numbers: it sits a few steps to the side of the room's way in (front and centre, on the camera side, where Brogu
 * drops in), with a straight walk to it from there, clear of the furniture and of every spot where someone stands
 * to work or idle (the Foundry's dock crew included). Before this the pad was the stream's foot at the back wall,
 * and in the Foundry that meant walking right round the assembly line to reach it.
 *
 * Room-local (x, z), like everything in layout.ts. The light stream itself still leaves from the back of the room
 * (layout.ts gateWorld); stepping on the pad beams you to it.
 */
import { FOUNDRY_FLOOR } from "./foundryFloor.ts";
import type { RoomId } from "./layout.ts";
import { blockedAt, detour } from "./obstacles.ts";
import { AIR_HEIGHT } from "./posts.ts";

/** Where the way into a room is: front and centre, the side the visitor's camera looks in from. */
export const ENTRY_SPOT = [0, 4.6] as const;
/** The clearance a body needs around its standing spot at the way in (Brogu's half width and a margin). */
export const ENTRY_CLEARANCE = 0.37;
/** The pad's radius on the floor (its ring of light). */
export const PAD_RADIUS = 0.6;
/** Clear floor kept round the pad: nothing's footprint comes nearer its centre than this. */
export const PAD_CLEARANCE = PAD_RADIUS + 0.3;
/**
 * How far the pad sits from the way in: far enough that arriving isn't standing on it, near enough to be a few steps.
 */
export const PAD_MIN_FROM_ENTRY = 1.5;
export const PAD_MAX_FROM_ENTRY = 3.5;
/** No standing spot (with its per-agent shuffle) comes nearer the pad's centre than this. */
export const PAD_FROM_SPOTS = 1.5;
/** The part of the floor the pad may sit on: inside the walls, a step in from the front edge. */
const PAD_AREA = { x0: -6.5, x1: 6.5, z0: -5.2, z1: 5.7 };
const GRID = 0.25;

type Spot = readonly [number, number];

// Stations live in layout.ts, which imports this file; they're passed in rather than imported to keep the two apart.
type StationLike = { x: number; z: number; y?: number };

/** Every spot in the room where someone stands: its ground-level stations and, in the Foundry, the dock crew's. */
function standingSpots(room: RoomId, stations: readonly StationLike[]): Spot[] {
  const spots: Spot[] = stations.filter((st) => (st.y ?? 0) < AIR_HEIGHT).map((st) => [st.x, st.z]);
  if (room === "foundry") spots.push(...FOUNDRY_FLOOR.bays, ...FOUNDRY_FLOOR.lineSpots);
  return spots;
}

/**
 * The way into a room: the clear spot nearest front and centre, searched outward in rings. Brogu drops in here
 * (apps/world/src/eyes/walk.ts entryPoint).
 */
export function entrySpot(room: RoomId): [number, number] {
  const [px, pz] = ENTRY_SPOT;
  for (let ring = 0; ring < 60; ring++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = px + i * GRID;
        const z = pz + j * GRID;
        if (blockedAt(room, x, z, ENTRY_CLEARANCE)) continue;
        const d = Math.hypot(x - px, z - pz);
        if (d < bestD - 1e-9) {
          best = [x, z];
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return [px, pz];
}

/**
 * Where a room's teleporter pad sits: of the clear spots between PAD_MIN_FROM_ENTRY and PAD_MAX_FROM_ENTRY from the
 * way in, with a straight walk from it, the one nearest the way in (nearer the front breaking a tie, then the left).
 * layout.ts padSpot works it out once per room with the room's stations.
 */
export function placePad(room: RoomId, stations: readonly StationLike[]): [number, number] {
  const entry = entrySpot(room);
  const spots = standingSpots(room, stations);
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  // A grid lined up on the way in, out to the farthest the pad may be.
  const reach = Math.ceil(PAD_MAX_FROM_ENTRY / GRID);
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const x = entry[0] + i * GRID;
      const z = entry[1] + j * GRID;
      if (x < PAD_AREA.x0 || x > PAD_AREA.x1 || z < PAD_AREA.z0 || z > PAD_AREA.z1) continue;
      const d = Math.hypot(x - entry[0], z - entry[1]);
      if (d < PAD_MIN_FROM_ENTRY || d > PAD_MAX_FROM_ENTRY) continue;
      if (blockedAt(room, x, z, PAD_CLEARANCE)) continue;
      if (spots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < PAD_FROM_SPOTS)) continue;
      if (detour(room, entry, [x, z]).length) continue;
      // Nearest first; then the front (larger z), then the left (smaller x), so the choice never wobbles.
      const score = d * 1000 - z * 10 + x * 0.1;
      if (score < bestScore) {
        best = [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
        bestScore = score;
      }
    }
  }
  return best ?? entry;
}
