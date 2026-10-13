/**
 * Furniture footprints, so walking agents steer around desks and tables instead of through them, and chatting
 * agents keep a talking distance. Everything here is in a room's local frame (see layout.ts), on the floor plane.
 *
 * The footprints are rough boxes around the free-standing pieces in each room's scene; wall furniture is left out.
 * A station's own furniture is fine to overlap: an agent that starts or ends inside a box is allowed through it.
 */
import { FOUNDRY_FLOOR } from "./foundryFloor.ts";
import type { RoomId } from "./layout.ts";

/** An axis-aligned footprint: centre and half extents. */
export interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

const b = (x: number, z: number, hw: number, hd: number): Box => ({ x, z, hw, hd });
const box = ({ x, z, hw, hd }: Box): Box => b(x, z, hw, hd);

/** Clearance kept between an agent and a footprint. */
export const WALK_CLEARANCE = 0.3;
/** How far apart two agents stand to talk, about an arm's length and a bit. */
export const TALK_DISTANCE = 1.25;
/** No agent is nudged further than this to make room for a chat. */
export const MAX_TALK_SHIFT = 0.9;

const FURNITURE: Partial<Record<RoomId, readonly Box[]>> = {
  foundry: [
    b(0, -2.6, 7.2, 0.65), // conveyor belt
    b(3.4, -2.8, 1.15, 1), // test furnace
    b(-1.2, -3.9, 0.7, 0.7), // assembly arm
    b(-6.9, -2.6, 0.8, 0.8), // crate intake machine
    b(7.6, 2.6, 0.5, 1.5), // shipping rack
    b(3, 4.4, 0.7, 0.45), // toolbox
    b(-6.95, 5.9, 0.3, 0.3), // short crates in the front left corner, past the dock
    b(-6.0, 5.85, 0.5, 0.5),
    b(-5.0, 5.8, 0.5, 0.5),
    b(6.6, 5.45, 0.7, 0.7), // the big tarped crate in the front right corner
    b(1.6, 4.9, 0.4, 0.4), // anvil
    box(FOUNDRY_FLOOR.dock), // Rusty's dock, against the left wall
    box(FOUNDRY_FLOOR.drafting), // Rocky's drafting table
    box(FOUNDRY_FLOOR.alarmPost), // Rivet's alarm post
  ],
  spire: [
    b(-5, -2.05, 1.2, 0.45), // desks
    b(-2, -2.05, 1.2, 0.45),
    b(1, -2.05, 1.2, 0.45),
    b(4, 3.9, 0.9, 0.9), // meeting pod
    b(-4, 3.9, 1.4, 1.2), // couch and coffee table
  ],
  exchange: [
    b(0, 0.4, 1, 1), // card table
    b(0, -3.65, 1.2, 0.45), // desks
    b(3.85, 0.4, 0.45, 1.2),
    b(-3.85, 0.4, 0.45, 1.2),
  ],
  green: [
    b(-5.4, 3.25, 1.1, 0.4), // park bench
    b(-6.8, 4.6, 0.4, 0.4), // trees
    b(7, 4.4, 0.4, 0.4),
    b(6.9, -5.4, 0.4, 0.4),
    b(-7.5, -1, 0.2, 0.2), // lamp posts
    b(7.5, 1.4, 0.2, 0.2),
  ],
  relay: [
    b(-3, 0.15, 1, 0.5), // draft desk
    b(4.8, 4.4, 0.8, 1.3), // table
    b(6.6, 1.6, 0.9, 0.5), // cart
    b(-7.4, 3.4, 0.4, 0.4), // barrel
  ],
  archive: [
    b(2.4, 2.3, 2.4, 1.25), // long table and its benches
    b(-1.8, 4.2, 0.4, 1), // professor's workbench
    b(-4.4, 2.55, 1.5, 0.6), // reading nook
  ],
  breakroom: [
    b(-7, -1.4, 0.45, 2.25), // bar
    b(-4.6, 3.5, 1.45, 0.6), // couch
    b(-4.6, 4.8, 0.8, 0.4), // coffee table
    b(4.6, 4.3, 1.35, 0.75), // ping-pong table
  ],
  boiler: [b(3.2, 3.7, 1.2, 0.4)], // tool bench
  workshop: [
    b(-2.6, 2.9, 1.3, 0.5), // workbench
    b(1.4, 4.6, 1, 0.45), // second bench
    b(-7.2, 5.4, 0.4, 0.4), // barrels
    b(-6.5, 5.8, 0.4, 0.4),
  ],
};

/** Every room's furniture. (The submind's podium floats high over the back-right corner, so it blocks nobody.) */
export const OBSTACLES: Partial<Record<RoomId, readonly Box[]>> = FURNITURE;

const EPS = 1e-4;

function containsPoint(box: Box, pad: number, x: number, z: number): boolean {
  return Math.abs(x - box.x) < box.hw + pad - EPS && Math.abs(z - box.z) < box.hd + pad - EPS;
}

/** Does the segment pass through the interior of the box grown by `pad`? */
function segmentCrosses(box: Box, pad: number, ax: number, az: number, cx: number, cz: number): boolean {
  const hw = box.hw + pad - EPS;
  const hd = box.hd + pad - EPS;
  let t0 = 0;
  let t1 = 1;
  const dx = cx - ax;
  const dz = cz - az;
  for (const [p, q, lo, hi] of [
    [dx, ax, box.x - hw, box.x + hw],
    [dz, az, box.z - hd, box.z + hd],
  ] as const) {
    if (Math.abs(p) < 1e-9) {
      if (q <= lo || q >= hi) return false;
    } else {
      let ta = (lo - q) / p;
      let tb = (hi - q) / p;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/** Is this spot inside a footprint of the room (with `pad` of clearance)? */
export function blockedAt(room: RoomId, x: number, z: number, pad = 0): boolean {
  return (OBSTACLES[room] ?? []).some((box) => containsPoint(box, pad, x, z));
}

/**
 * Waypoints (not including the endpoints) for walking from (ax, az) to (cx, cz) around the room's furniture.
 * Empty when the straight line is clear. A footprint that holds either endpoint is ignored, since that agent
 * is standing at its own furniture.
 */
export function detour(room: RoomId, [ax, az]: readonly [number, number], [cx, cz]: readonly [number, number]): [number, number][] {
  const boxes = (OBSTACLES[room] ?? [])
    .filter((box) => !containsPoint(box, 0, ax, az) && !containsPoint(box, 0, cx, cz))
    // Starting inside the clearance margin: only the footprint itself blocks.
    .map((box) => ({ box, pad: containsPoint(box, WALK_CLEARANCE, ax, az) || containsPoint(box, WALK_CLEARANCE, cx, cz) ? 0 : WALK_CLEARANCE }));
  const clear = (px: number, pz: number, qx: number, qz: number) => !boxes.some(({ box, pad }) => segmentCrosses(box, pad, px, pz, qx, qz));
  if (clear(ax, az, cx, cz)) return [];

  const nodes: [number, number][] = [[ax, az], [cx, cz]];
  for (const { box, pad } of boxes) {
    const gap = pad + 0.02;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = box.x + sx * (box.hw + gap);
        const pz = box.z + sz * (box.hd + gap);
        if (Math.abs(px) > 8.2 || pz > 6.6 || pz < -6.4) continue;
        if (boxes.some((o) => containsPoint(o.box, o.pad, px, pz))) continue;
        nodes.push([px, pz]);
      }
    }
  }
  // Shortest path over the visibility graph (a few dozen nodes at most).
  const n = nodes.length;
  const best = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const [ux, uz] = nodes[u]!;
      const [vx, vz] = nodes[v]!;
      if (!clear(ux, uz, vx, vz)) continue;
      const d = best[u]! + Math.hypot(vx - ux, vz - uz);
      if (d < best[v]!) {
        best[v] = d;
        prev[v] = u;
      }
    }
  }
  if (prev[1] === -1) return [];
  const path: [number, number][] = [];
  for (let i = prev[1]!; i > 0; i = prev[i]!) path.unshift(nodes[i]!);
  return path;
}

/**
 * How far each of two agents should step apart to stand `min` from each other, as [dx, dz] shifts for a and b
 * (zero when they already have room). Nobody moves further than MAX_TALK_SHIFT.
 */
export function talkingShift(
  a: readonly [number, number],
  b: readonly [number, number],
  min = TALK_DISTANCE,
): [[number, number], [number, number]] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const d = Math.hypot(dx, dz);
  if (d >= min) return [[0, 0], [0, 0]];
  const [ux, uz] = d < 1e-3 ? [1, 0] : [dx / d, dz / d];
  const step = Math.min((min - d) / 2, MAX_TALK_SHIFT);
  return [[-ux * step, -uz * step], [ux * step, uz * step]];
}
