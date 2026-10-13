/**
 * The geometry of the Lattice, shared by the simulator (to time walks) and the world (to draw them),
 * so that both always agree on where an agent is.
 *
 * Coordinates: y is up. Rooms float on a ring around the Kernel at the origin. In a room's local frame,
 * -z points back toward the Kernel (where its gate and light stream are) and +z faces the visitor's camera.
 */

import { detour } from "./obstacles.ts";
import { POSTS, POST_HEIGHT } from "./posts.ts";

export type Vec3 = readonly [number, number, number];

export const ROOM_IDS = ["foundry", "spire", "exchange", "green", "relay", "archive", "breakroom", "boiler", "workshop"] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export interface Station {
  id: string;
  label: string;
  /** Local standing spot. */
  x: number;
  z: number;
  /** Direction the agent faces while working here, in radians; 0 faces the back (-z), PI faces the camera. */
  facing: number;
  /** Standing height above the floor (a stage, a dais). */
  y?: number;
  /** Stand exactly here: no per-agent shuffle (a DJ behind the decks, a player in their chair). */
  exact?: boolean;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  theme: string;
  workstream: string;
  /** Height of the platform's top surface. */
  y: number;
  stations: Station[];
}

export const RING_RADIUS = 34;
/** Height of the benches at the Archive's long table, which the players stand on. */
const BENCH_TOP = 0.49;
export const ROOM_HALF_W = 8;
export const ROOM_HALF_D = 6.5;
export const KERNEL_PORT_RADIUS = 4.2;
export const KERNEL_PORT_Y = 2;
export const WALK_SPEED = 2.4;
export const STREAM_SPEED = 18;

const s = (id: string, label: string, x: number, z: number, facing = 0, opts: { y?: number; exact?: boolean } = {}): Station => ({ id, label, x, z, facing, ...opts });
/** A station that faces a point (a seat around a table, a spot on a pitch). */
const toward = (id: string, label: string, x: number, z: number, tx: number, tz: number, opts: { y?: number; exact?: boolean } = {}): Station =>
  s(id, label, x, z, Math.atan2(-(tx - x), -(tz - z)), opts);

/** The conductor's post in a room (posts.ts): high overhead, exact, and turned to look down over the room. */
const post = (room: RoomId): Station => {
  const [x, z] = POSTS[room];
  return toward("post", "The conductor's post", x, z, 0, 0.5, { y: POST_HEIGHT, exact: true });
};

export const ROOMS: Record<RoomId, RoomDef> = {
  foundry: {
    id: "foundry",
    name: "The Foundry",
    theme: "factory",
    workstream: "Coding — Claude Code, Cursor",
    y: 0.6,
    stations: [
      s("intake", "Crate intake", -5.6, -1.6, 0),
      s("assembler", "Assembly arm", -1.2, -1.6, 0),
      s("furnace", "Test furnace", 3.4, -1.6, 0),
      s("shipping", "Shipping dock", 5.8, 2.6, -Math.PI / 2),
      s("bench-a", "Workbench A", -4.2, 3.2, Math.PI),
      s("bench-b", "Workbench B", -0.6, 3.2, Math.PI),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("foundry"),
    ],
  },
  spire: {
    id: "spire",
    name: "The Spire",
    theme: "office tower",
    workstream: "Small-business operations",
    y: 2.2,
    stations: [
      s("desk-1", "Desk 1", -5, -1.2, 0),
      s("desk-2", "Desk 2", -2, -1.2, 0),
      s("desk-3", "Desk 3", 1, -1.2, 0),
      s("whiteboard", "KPI whiteboard", 4.8, -2.6, 0),
      s("meeting", "Meeting pod", 4, 2.6, Math.PI),
      s("coffee", "Coffee machine", -6, 3.4, Math.PI / 2),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("spire"),
    ],
  },
  exchange: {
    id: "exchange",
    name: "The Exchange",
    theme: "trading floor",
    workstream: "Kalshi & portfolio",
    y: 1.2,
    stations: [
      s("desk-n", "North desk", 0, -2.8, 0),
      s("desk-e", "East desk", 3, 0.4, -Math.PI / 2),
      s("desk-w", "West desk", -3, 0.4, Math.PI / 2),
      s("vault", "Approval vault", 6, 3.4, -Math.PI / 2),
      s("terminal", "Research terminal", -5.8, 3.4, Math.PI / 2),
      toward("poker-n", "Card table", 0, -1.25, 0, 0.4),
      toward("poker-e", "Card table", 1.75, 0.4, 0, 0.4),
      toward("poker-w", "Card table", -1.75, 0.4, 0, 0.4),
      toward("poker-s", "Card table", 0, 2.05, 0, 0.4),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("exchange"),
    ],
  },
  green: {
    id: "green",
    name: "The Green",
    theme: "park & pitch",
    workstream: "Sleeper fantasy football",
    y: -0.2,
    stations: [
      s("depth-chart", "Depth chart", -5.6, -3.4, 0),
      s("mailbox", "Waiver mailbox", 5.6, -3.4, 0),
      s("sideline", "Sideline", 0, 4, Math.PI),
      s("huddle", "Huddle", 0, 0.6, 0),
      s("bench", "Park bench", -5.4, 3.6, Math.PI),
      toward("play-1", "Pitch", -3, 0.6, 0, 0.6),
      toward("play-2", "Pitch", 3, 0.6, 0, 0.6),
      toward("play-3", "Pitch", -1.2, 2.6, 0, 0.6),
      toward("play-4", "Pitch", 1.4, -1.2, 0, 0.6),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("green"),
    ],
  },
  relay: {
    id: "relay",
    name: "The Relay",
    theme: "switchboard & post office",
    workstream: "iMessage assistant",
    y: 1.8,
    stations: [
      s("tubes", "Pneumatic tubes", 0, -3.4, 0),
      s("draft-desk", "Draft desk", -3, 1, 0),
      s("outbox", "Outbox (needs approval)", 4, 1, 0),
      s("switchboard", "Switchboard", -6, -2.6, Math.PI / 2),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("relay"),
    ],
  },
  archive: {
    id: "archive",
    name: "The Archive",
    theme: "library",
    workstream: "The Tide — worldbuilding & campaign",
    y: 0.2,
    stations: [
      s("shelves", "Glass shelves", -5, -3, 0),
      s("loom", "Lore loom", 0, -2.6, 0),
      // The DM's chair at the head of the long table, behind the screen.
      s("dice-table", "The DM's chair", 5.05, 2.3, Math.PI / 2, { exact: true }),
      s("shrine", "Cease & Desist shrine", 5.8, -3.2, 0),
      s("reading", "Reading nook", -4.4, 3, Math.PI),
      // Faces his workbench, side-on to the room.
      s("lab", "Professor's workbench", -1.4, 4.2, -Math.PI / 2),
      // Players down both sides of the long table: the back row faces the room, the front row has its back to it.
      // They stand on the benches, so the small ones (a yordle, a little wizard) can be seen over the table.
      ...(
        [
          ["seat-w", 1.1, 1.3, Math.PI],
          ["seat-e", 3.7, 1.3, Math.PI],
          ["seat-sw", 1.1, 3.3, 0],
          ["seat-se", 3.7, 3.3, 0],
          ["seat-nm", 2.4, 1.3, Math.PI],
          ["seat-sm", 2.4, 3.3, 0],
        ] as const
      ).map(([id, x, z, facing]) => s(id, "On the bench at the long table", x, z, facing, { exact: true, y: BENCH_TOP })),
      // The Kernel's loot box, by the C.E.O.'s trophy case. Nobody opens it. Myshka sits in it.
      s("loot-box", "The loot box", -6.75, 2.6, Math.PI / 2, { y: 0.06, exact: true }),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("archive"),
    ],
  },
  breakroom: {
    id: "breakroom",
    name: "The Break Room",
    theme: "lounge",
    workstream: "Idle, morale, nonsense",
    y: 1,
    stations: [
      // A club: the stage along the back wall under the skyline, the floor in front of it, a bar down the
      // left wall, the lounge and the ping-pong table at the front.
      s("couch", "Lounge", -4.6, 3.7, Math.PI),
      s("ping-pong", "Ping-pong table", 4.6, 5.55, 0),
      s("coffee-machine", "Sentient coffee machine", -6.4, -4.1, Math.PI / 2),
      s("bar", "The bar", -6.3, -1.6, Math.PI / 2),
      s("server-rack", "Server rack (nap spot)", 6.3, -1.2, -Math.PI / 2),
      s("window", "The skyline", 5.4, -5.4, 0),
      s("pong-a", "Ping-pong (west end)", 2.95, 4.3, -Math.PI / 2, { exact: true }),
      s("pong-b", "Ping-pong (east end)", 6.25, 4.3, Math.PI / 2, { exact: true }),
      // On stage (0.45 m up), all facing the floor.
      s("decks", "DJ booth", 0, -5.25, Math.PI, { y: 0.45, exact: true }),
      s("mic", "Microphone", 0, -4.05, Math.PI, { y: 0.45, exact: true }),
      s("stage-l", "Drum riser", -2.2, -5.2, Math.PI, { y: 0.45, exact: true }),
      s("stage-r", "Keys", 2.25, -4.6, Math.PI, { y: 0.45, exact: true }),
      toward("dance-1", "Dance floor", -1.2, -2.2, 0, -5.25),
      toward("dance-2", "Dance floor", 1.3, -1.9, 0, -5.25),
      toward("dance-3", "Dance floor", 0.1, -0.9, 0, -5.25),
      toward("dance-4", "Dance floor", -2.3, -0.6, 0, -5.25),
      toward("dance-5", "Dance floor", 2.4, -0.4, 0, -5.25),
      toward("dance-6", "Dance floor", -0.6, 0.6, 0, -5.25),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("breakroom"),
    ],
  },
  boiler: {
    id: "boiler",
    name: "The Boiler Room",
    theme: "maintenance closet",
    workstream: "Keeping the real lines running",
    y: -0.8,
    stations: [
      // The pipe wall runs along the back left; each pipe is a real link, with a gauge at eye height.
      s("pipes", "The pipe wall", -3.6, -3.4, 0),
      // The boiler (the MacBook) stands back right; the keeper faces its firebox.
      s("boiler", "The boiler", 4.2, -0.6, 0),
      s("bucket", "The bucket", -0.6, 1.6, 0),
      s("sign", "The incident sign", -5.9, 2.4, Math.PI / 2),
      s("bench", "Tool bench", 3.2, 4.1, Math.PI),
      // Kevin's spiritual maintenance spot: the warm side of the boiler.
      s("warm-side", "The warm side of the boiler", 6.4, -1.0, -Math.PI / 2),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("boiler"),
    ],
  },
  workshop: {
    id: "workshop",
    name: "The Workshop",
    theme: "maker's workshop",
    workstream: "Making new things for the Lattice — concept, mould, fitting, rehearsal",
    y: 0.2,
    stations: [
      // The making line runs left to right along the back: sketch it, mould it, fit it, rehearse it.
      s("easel", "The concept easel", -5.5, -1.3, 0),
      s("mould", "The mould", -1.85, -1.1, 0),
      s("fitting", "The fitting stand", 1.85, -1.1, 0),
      s("stage", "The rehearsal stage", 5.5, -0.9, 0),
      // Front of the room: the long workbench, the shelves of past figures, the crate of finished pieces by the exit.
      s("bench", "The workbench", -2.6, 3.0, Math.PI),
      s("shelves", "Shelves of past figures", -6.7, 2.2, Math.PI / 2),
      s("crate", "Crate of finished pieces", 6.2, 3.4, -Math.PI / 2),
      // The room lead's conductor's post: the submind hovers overhead, looking down on the room.
      post("workshop"),
    ],
  },
};

export function roomAngle(room: RoomId): number {
  return (ROOM_IDS.indexOf(room) / ROOM_IDS.length) * Math.PI * 2;
}

export function roomCenter(room: RoomId): Vec3 {
  const a = roomAngle(room);
  return [RING_RADIUS * Math.sin(a), ROOMS[room].y, RING_RADIUS * Math.cos(a)];
}

/** Room-local (x, y above platform, z) to world. Matches three.js `rotation.y = roomAngle(room)`. */
export function roomToWorld(room: RoomId, x: number, y: number, z: number): Vec3 {
  const a = roomAngle(room);
  const [cx, cy, cz] = roomCenter(room);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [cx + x * cos + z * sin, cy + y, cz - x * sin + z * cos];
}

export function getStation(room: RoomId, station: string): Station {
  const found = ROOMS[room].stations.find((st) => st.id === station);
  if (!found) throw new Error(`Unknown station ${room}/${station}`);
  return found;
}

/** A small, stable offset per agent so two agents at one station don't overlap. */
export function agentJitter(agentId: string, station: string): [number, number] {
  let h = 2166136261;
  for (const ch of `${agentId}@${station}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  const r = 0.25 + (((h >>> 12) % 100) / 100) * 0.35;
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

export interface Place {
  room: RoomId;
  station: string;
}

/** Where an agent stands at a place, in the room's local frame. */
export function placeLocal(place: Place, agentId: string): Vec3 {
  const st = getStation(place.room, place.station);
  const [jx, jz] = st.exact ? [0, 0] : agentJitter(agentId, place.station);
  return [st.x + jx, st.y ?? 0, st.z + jz];
}

export function placeToWorld(place: Place, agentId: string): Vec3 {
  return roomToWorld(place.room, ...placeLocal(place, agentId));
}

/** World (x, z) back to a room's local frame (x, z). */
export function worldToRoom(room: RoomId, x: number, z: number): [number, number] {
  const a = roomAngle(room);
  const [cx, , cz] = roomCenter(room);
  const dx = x - cx;
  const dz = z - cz;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

export function gateWorld(room: RoomId): Vec3 {
  return roomToWorld(room, 0, 0, -ROOM_HALF_D - 0.4);
}

export function kernelPort(room: RoomId): Vec3 {
  const a = roomAngle(room);
  return [KERNEL_PORT_RADIUS * Math.sin(a), KERNEL_PORT_Y, KERNEL_PORT_RADIUS * Math.cos(a)];
}

/** The light stream from a room's gate to the Kernel, as a sampled quadratic arc. */
export function streamCurve(room: RoomId, samples = 24): Vec3[] {
  const a = gateWorld(room);
  const b = kernelPort(room);
  const lift = 7 + ROOMS[room].y;
  const c: Vec3 = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + lift, (a[2] + b[2]) / 2];
  const pts: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    pts.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      u * u * a[2] + 2 * u * t * c[2] + t * t * b[2],
    ]);
  }
  return pts;
}

/** Around the Kernel's base ring from one room's port to another's, the short way. */
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

export type SegmentKind = "walk" | "stream";

export interface Route {
  points: Vec3[];
  /** One per segment (points.length - 1). */
  kinds: SegmentKind[];
  /** Cumulative end time of each segment, in ms. */
  ends: number[];
  duration: number;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export function routeBetween(from: Place, to: Place, agentId: string): Route {
  const start = placeToWorld(from, agentId);
  const end = placeToWorld(to, agentId);
  const gateLocal: Vec3 = [0, 0, -ROOM_HALF_D - 0.4];
  const points: Vec3[] = [start];
  const kinds: SegmentKind[] = [];
  const push = (p: Vec3, kind: SegmentKind) => {
    points.push(p);
    kinds.push(kind);
  };
  /** Walk across a room from one local spot to another, around the furniture. The last point is `finish`. */
  const walk = (room: RoomId, a: Vec3, c: Vec3, finish: Vec3) => {
    const around = detour(room, [a[0], a[2]], [c[0], c[2]]);
    // Spread the change in height (a stage, a dais) along the way.
    const lengths = [a, ...around.map(([x, z]) => [x, 0, z] as const), c].map((p, i, all) => (i ? Math.hypot(p[0] - all[i - 1]![0], p[2] - all[i - 1]![2]) : 0));
    const total = lengths.reduce((sum, l) => sum + l, 0) || 1;
    let run = 0;
    around.forEach(([x, z], i) => {
      run += lengths[i + 1]!;
      push(roomToWorld(room, x, a[1] + (c[1] - a[1]) * (run / total), z), "walk");
    });
    push(finish, "walk");
  };
  if (from.room === to.room) {
    walk(from.room, placeLocal(from, agentId), placeLocal(to, agentId), end);
  } else {
    walk(from.room, placeLocal(from, agentId), gateLocal, gateWorld(from.room));
    for (const p of streamCurve(from.room).slice(1)) push(p, "stream");
    for (const p of kernelArc(from.room, to.room).slice(1)) push(p, "stream");
    for (const p of [...streamCurve(to.room)].reverse().slice(1)) push(p, "stream");
    walk(to.room, gateLocal, placeLocal(to, agentId), end);
  }
  const ends: number[] = [];
  let t = 0;
  for (let i = 0; i < kinds.length; i++) {
    const speed = kinds[i] === "walk" ? WALK_SPEED : STREAM_SPEED;
    t += (dist(points[i]!, points[i + 1]!) / speed) * 1000;
    ends.push(t);
  }
  return { points, kinds, ends, duration: t };
}

export interface RouteSample {
  position: Vec3;
  kind: SegmentKind;
  /** Unit direction of travel in the xz-plane (zero vector when stationary). */
  heading: [number, number];
  done: boolean;
}

export function sampleRoute(route: Route, elapsed: number): RouteSample {
  const last = route.points[route.points.length - 1]!;
  if (route.kinds.length === 0 || elapsed >= route.duration) {
    const k = route.kinds.length;
    const prev = route.points[Math.max(0, k - 1)]!;
    return { position: last, kind: "walk", heading: headingOf(prev, last), done: true };
  }
  const t = Math.max(0, elapsed);
  let i = 0;
  while (i < route.ends.length - 1 && route.ends[i]! < t) i++;
  const segStart = i === 0 ? 0 : route.ends[i - 1]!;
  const segLen = route.ends[i]! - segStart;
  const f = segLen <= 0 ? 1 : (t - segStart) / segLen;
  const a = route.points[i]!;
  const b = route.points[i + 1]!;
  return {
    position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
    kind: route.kinds[i]!,
    heading: headingOf(a, b),
    done: false,
  };
}

function headingOf(a: Vec3, b: Vec3): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  return len < 1e-6 ? [0, 0] : [dx / len, dz / len];
}

/** How long a walk between two places takes, in ms of Lattice time. */
export function travelTime(from: Place, to: Place, agentId: string): number {
  return routeBetween(from, to, agentId).duration;
}
