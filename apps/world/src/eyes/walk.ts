import {
  ENTRY_SPOT,
  KERNEL_PORT_RADIUS,
  KERNEL_PORT_Y,
  OBSTACLES,
  ROOM_IDS,
  beamOut,
  padSpot,
  roomAngle,
  roomCenter,
  roomToWorld,
  type Box,
  type RoomId,
  type Route,
  type SegmentKind,
  type Vec3,
} from "@ceo/core";

/**
 * Brogu's eyes: the pure part. Where he drops in, how he walks (sliding along the furniture, stopping at the
 * platform's edge), the teleporter and the stream that carry him between rooms, and the head bob. Everything is in a
 * room's local frame (packages/core/src/layout.ts): -z is the back of the room, where the light stream leaves for the
 * Kernel; +z faces the visitor's camera, and the way in and the teleporter pad (packages/core/src/pads.ts) are there. A yaw of 0 looks at the back of the room; PI looks out at the camera side.
 */

/** His eyes, above the floor. He comes up to an agent's hip (pets/Brogu.tsx), so everything looms. */
export const EYE_HEIGHT = 0.6;
/** Half his width, for bumping into things. */
export const BODY_RADIUS = 0.22;
/** A toddle, and a determined toddle (Shift). Metres a second. */
export const WALK_SPEED = 1.15;
export const RUN_SPEED = 1.9;
/** The light stream carries him faster than his legs ever could, but slower than an agent rides it, to enjoy the view. */
export const RIDE_SPEED = 11;
/** Within this of a tapped spot he's there. */
const ARRIVE = 0.12;

/** How far he can wander: the platform, less the walls along the back and left, and a step short of the drop. */
export const BOUNDS = { x0: -7.1, x1: 7.75, z0: -5.95, z1: 6.4 };

/**
 * The Break Room's stage (rooms/Club.tsx draws it from this). He can climb onto it, so the floor is higher there.
 */
export const CLUB_STAGE = { x0: -3.6, x1: 3.6, z0: -6.25, z1: -3.45, h: 0.45 };

const b = (x: number, z: number, hw: number, hd: number): Box => ({ x, z, hw, hd });

/**
 * Pieces no agent's route ever crosses, so OBSTACLES leaves them out, but a steered Brogu would walk straight
 * through: the club's DJ booth and speakers, the Spire's KPI easel. (The boiler moved into the walkways, so it's in
 * OBSTACLES now.)
 */
export const EYES_OBSTACLES: Partial<Record<RoomId, readonly Box[]>> = {
  breakroom: [b(0, -4.6, 1.1, 0.35), b(-4.45, -5.5, 0.5, 0.4), b(4.45, -5.5, 0.5, 0.4)],
  spire: [b(4.8, -3.5, 1.35, 0.15)],
};

/**
 * The room's teleporter pad, a few steps from where he drops in (packages/core/src/pads.ts): the same pad the agents
 * use, so one rule places it in every room.
 */
export function gateSpot(room: RoomId): [number, number] {
  return padSpot(room);
}
/** Close enough to the pad to ride it. */
export const GATE_REACH = 1.1;

export interface Pose {
  x: number;
  z: number;
  /** 0 looks at the back of the room, PI at the camera side. */
  yaw: number;
}

/** Every footprint he bumps into in a room. */
export function boxesIn(room: RoomId): readonly Box[] {
  return [...(OBSTACLES[room] ?? []), ...(EYES_OBSTACLES[room] ?? [])];
}

/** Would he, standing here, overlap a footprint (or be off the platform)? */
export function blocked(room: RoomId, x: number, z: number, radius = BODY_RADIUS): boolean {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return true;
  return boxesIn(room).some((box) => Math.abs(x - box.x) < box.hw + radius && Math.abs(z - box.z) < box.hd + radius);
}

/** The floor's height under him, above the platform: the club's stage is the only step up. */
export function floorAt(room: RoomId, x: number, z: number): number {
  if (room !== "breakroom") return 0;
  const s = CLUB_STAGE;
  return x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 ? s.h : 0;
}

/** The way he faces, as a unit vector in the room's floor plane. */
export function forwardOf(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
/** His right hand. */
export function rightOf(yaw: number): [number, number] {
  return [Math.cos(yaw), -Math.sin(yaw)];
}

/** The yaw that faces from one spot toward another. */
export function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - fx), -(tz - fz));
}

/**
 * Where Brogu drops in when Nikita takes him: the room in view, front and centre (the room's way in, ENTRY_SPOT),
 * where the overview camera looks in from, facing into the room. If that spot has furniture on it, the nearest clear
 * spot, searched outward in rings; he always looks toward the middle of the room. The teleporter pad is a few steps
 * to one side.
 */
export function entryPoint(room: RoomId): Pose {
  const prefer: [number, number] = [ENTRY_SPOT[0], ENTRY_SPOT[1]];
  const step = 0.25;
  for (let ring = 0; ring < 60; ring++) {
    const found: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = prefer[0] + i * step;
        const z = prefer[1] + j * step;
        if (!blocked(room, x, z, BODY_RADIUS + 0.15)) found.push([x, z]);
      }
    }
    if (found.length) {
      found.sort((a, c) => Math.hypot(a[0] - prefer[0], a[1] - prefer[1]) - Math.hypot(c[0] - prefer[0], c[1] - prefer[1]));
      const [x, z] = found[0]!;
      return { x, z, yaw: yawToward(x, z, 0, -1) };
    }
  }
  return { x: prefer[0], z: prefer[1], yaw: 0 };
}

/**
 * Which room Nikita is looking at from the overview: the one nearest the camera, across the floor. (In a room,
 * it's simply the room in focus.)
 */
export function roomInView(cameraX: number, cameraZ: number): RoomId {
  let best: RoomId = ROOM_IDS[0];
  let bestD = Infinity;
  for (const id of ROOM_IDS) {
    const [x, , z] = roomCenter(id);
    const d = Math.hypot(x - cameraX, z - cameraZ);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export interface Step {
  x: number;
  z: number;
  /** He tried to go somewhere and something stopped him (on either axis). */
  bumped: boolean;
  /** What stopped him was the platform's edge, not furniture. */
  atEdge: boolean;
}

/**
 * One step of walking: from (x, z) by (dx, dz), sliding along whatever is in the way rather than stopping dead.
 * Each axis moves on its own, so walking into a desk at an angle carries him along its side. Starting somewhere
 * he shouldn't be (inside a footprint), he can always walk out.
 */
export function move(room: RoomId, x: number, z: number, dx: number, dz: number): Step {
  const stuck = blocked(room, x, z);
  let bumped = false;
  let atEdge = false;
  const tryAxis = (nx: number, nz: number) => {
    if (stuck || !blocked(room, nx, nz)) return true;
    bumped = true;
    if (nx < BOUNDS.x0 || nx > BOUNDS.x1 || nz < BOUNDS.z0 || nz > BOUNDS.z1) atEdge = true;
    return false;
  };
  let nx = x;
  let nz = z;
  if (dx && tryAxis(x + dx, nz)) nx = x + dx;
  if (dz && tryAxis(nx, z + dz)) nz = z + dz;
  return { x: nx, z: nz, bumped, atEdge };
}

export interface Drive {
  /** Ahead (+1) or back (-1). */
  forward: number;
  /** Right (+1) or left (-1). */
  strafe: number;
  run: boolean;
}

/**
 * Where he wants to go this frame, as a floor-plane velocity, from the keys or the stick. Diagonals aren't faster.
 */
export function velocity(yaw: number, drive: Drive): [number, number] {
  const [fx, fz] = forwardOf(yaw);
  const [rx, rz] = rightOf(yaw);
  let vx = fx * drive.forward + rx * drive.strafe;
  let vz = fz * drive.forward + rz * drive.strafe;
  const len = Math.hypot(vx, vz);
  if (len > 1) {
    vx /= len;
    vz /= len;
  }
  const speed = drive.run ? RUN_SPEED : WALK_SPEED;
  return [vx * speed, vz * speed];
}

/**
 * Tap-to-walk: the velocity toward a tapped spot, or null once he's there. He slows for the last few
 * centimetres so he doesn't overshoot.
 */
export function seek(x: number, z: number, tx: number, tz: number): [number, number] | null {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  if (d < ARRIVE) return null;
  const speed = WALK_SPEED * Math.min(1, d / 0.4 + 0.25);
  return [(dx / d) * speed, (dz / d) * speed];
}

/** Is he on the room's teleporter pad? */
export function atGate(room: RoomId, x: number, z: number): boolean {
  const [gx, gz] = gateSpot(room);
  return Math.hypot(x - gx, z - gz) < GATE_REACH;
}

/** Around the Kernel's base ring, the short way (as the agents go, layout.ts). */
function kernelArc(from: RoomId, to: RoomId, samples = 10): Vec3[] {
  const a0 = roomAngle(from);
  let delta = roomAngle(to) - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const pts: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const a = a0 + (delta * i) / samples;
    pts.push([KERNEL_PORT_RADIUS * Math.sin(a), KERNEL_PORT_Y, KERNEL_PORT_RADIUS * Math.cos(a)]);
  }
  return pts;
}

/**
 * The ride between rooms, in world space: from where he stands onto the room's teleporter pad, beamed up over the
 * back wall onto the light stream to the Kernel, round its base and down the other room's stream to its pad, then a
 * few steps off it onto its floor. A Route (sampleRoute in @ceo/core plays it back), timed for the ride.
 */
export function rideRoute(from: RoomId, x: number, z: number, to: RoomId): Route {
  const [fx, fz] = gateSpot(from);
  const [tx, tz] = gateSpot(to);
  const land = arrival(to);
  const points: Vec3[] = [roomToWorld(from, x, 0, z)];
  const kinds: SegmentKind[] = [];
  const push = (p: Vec3, kind: SegmentKind) => {
    points.push(p);
    kinds.push(kind);
  };
  push(roomToWorld(from, fx, 0, fz), "walk");
  for (const p of beamOut(from)) push(p, "stream");
  for (const p of kernelArc(from, to).slice(1)) push(p, "stream");
  for (const p of [...beamOut(to)].reverse().slice(1)) push(p, "stream");
  push(roomToWorld(to, tx, 0, tz), "stream");
  push(roomToWorld(to, land.x, 0, land.z), "walk");
  const ends: number[] = [];
  let t = 0;
  for (let i = 0; i < kinds.length; i++) {
    const [a, c] = [points[i]!, points[i + 1]!];
    const d = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    t += (d / (kinds[i] === "walk" ? RUN_SPEED * 1.4 : RIDE_SPEED)) * 1000;
    ends.push(t);
  }
  return { points, kinds, ends, duration: t };
}

/**
 * Where the teleporter sets him down, facing into the room: a few steps off the pad, into the room (so he isn't
 * offered the ride straight back), on clear floor he can walk straight to from the pad.
 */
export function arrival(room: RoomId): Pose {
  const [gx, gz] = gateSpot(room);
  // Aim a step and a half in from the pad, toward the back of the room; take the nearest clear spot to that.
  const want: [number, number] = [gx, gz - 1.5];
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let i = -12; i <= 12; i++) {
    for (let j = -12; j <= 12; j++) {
      const x = gx + i * 0.2;
      const z = gz + j * 0.2;
      const d = Math.hypot(x - want[0], z - want[1]);
      if (d >= bestD || blocked(room, x, z) || atGate(room, x, z) || !straightWalk(room, gx, gz, x, z)) continue;
      best = [x, z];
      bestD = d;
    }
  }
  const [x, z] = best ?? want;
  return { x, z, yaw: yawToward(x, z, 0, -1) };
}

/** Can he walk the straight line from one spot to another without bumping into anything? */
export function straightWalk(room: RoomId, ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05);
  for (let k = 0; k <= n; k++) {
    const t = n ? k / n : 0;
    if (blocked(room, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/**
 * The head bob: a toddler's walk rocks him over each foot in turn, so the eyes dip twice a stride and roll a
 * little toward the planted foot. `phase` advances with distance walked; `amount` is 0 standing, 1 at a walk.
 */
export function headBob(phase: number, amount: number): { y: number; roll: number } {
  return { y: -Math.abs(Math.sin(phase)) * 0.022 * amount, roll: Math.sin(phase) * 0.014 * amount };
}
/** Metres per footstep, to advance the bob's phase by PI. */
export const STEP_LENGTH = 0.24;

/** Pitch limits: down at his feet, up at the ceiling (and Skippy). */
export const PITCH = { min: -1.25, max: 1.2 };
export const clampPitch = (p: number) => Math.min(PITCH.max, Math.max(PITCH.min, p));
