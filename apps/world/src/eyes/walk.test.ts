import { ROOM_IDS, ROOMS, roomCenter, roomToWorld, sampleRoute, type RoomId } from "@ceo/core";
import { describe, expect, it } from "vitest";
import {
  BODY_RADIUS,
  BOUNDS,
  RUN_SPEED,
  WALK_SPEED,
  arrival,
  atGate,
  blocked,
  boxesIn,
  entryPoint,
  floorAt,
  forwardOf,
  gateSpot,
  headBob,
  move,
  rideRoute,
  rightOf,
  roomInView,
  seek,
  velocity,
  yawToward,
} from "./walk.ts";

/** Can he walk from a to b on a 0.2 m grid, without ever standing anywhere blocked? */
function reachable(room: RoomId, [ax, az]: [number, number], [bx, bz]: [number, number]): boolean {
  const step = 0.2;
  const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
  const seen = new Set([key(ax, az)]);
  const queue: [number, number][] = [[ax, az]];
  while (queue.length) {
    const [x, z] = queue.shift()!;
    if (Math.hypot(x - bx, z - bz) < 0.5) return true;
    for (const [dx, dz] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const nx = x + dx!;
      const nz = z + dz!;
      const k = key(nx, nz);
      if (seen.has(k) || blocked(room, nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return false;
}

describe("Brogu's eyes: where he drops in", () => {
  it("starts every room in the clear, front and centre, facing in", () => {
    for (const room of ROOM_IDS) {
      const p = entryPoint(room);
      expect(blocked(room, p.x, p.z), room).toBe(false);
      expect(p.z, room).toBeGreaterThan(2.5);
      expect(Math.abs(p.x), room).toBeLessThan(3);
      // Facing into the room: his forward vector points toward the back (-z).
      expect(forwardOf(p.yaw)[1], room).toBeLessThan(-0.5);
    }
  });

  it("picks the room nearest the camera from the overview", () => {
    for (const room of ROOM_IDS) {
      const [x, , z] = roomCenter(room);
      // The camera pulled back out past the room, as the overview's orbit puts it.
      expect(roomInView(x * 2.4, z * 2.4)).toBe(room);
    }
    // The default overview camera (0, 66, 96) looks in over the Foundry.
    expect(roomInView(0, 96)).toBe("foundry");
  });

  it("can reach the light stream from where he starts, in every room", () => {
    for (const room of ROOM_IDS) {
      const p = entryPoint(room);
      const [gx, gz] = gateSpot(room);
      expect(blocked(room, gx, gz), `${room} gate`).toBe(false);
      expect(reachable(room, [p.x, p.z], [gx, gz]), room).toBe(true);
    }
  });
});

describe("Brogu's eyes: walking", () => {
  it("faces and strafes the way the camera does", () => {
    expect(forwardOf(0)[0]).toBeCloseTo(0);
    expect(forwardOf(0)[1]).toBeCloseTo(-1);
    expect(rightOf(0)[0]).toBeCloseTo(1);
    expect(rightOf(0)[1]).toBeCloseTo(0);
    // Turning right (a smaller yaw) brings forward round toward +x.
    expect(forwardOf(-Math.PI / 2)[0]).toBeCloseTo(1);
    const y = yawToward(0, 0, 3, -3);
    expect(forwardOf(y)[0]).toBeCloseTo(Math.SQRT1_2);
    expect(forwardOf(y)[1]).toBeCloseTo(-Math.SQRT1_2);
  });

  it("walks at a toddle, runs a little faster, and diagonals are no quicker", () => {
    const [vx, vz] = velocity(0, { forward: 1, strafe: 0, run: false });
    expect(Math.hypot(vx, vz)).toBeCloseTo(WALK_SPEED);
    const diag = velocity(0.3, { forward: 1, strafe: 1, run: false });
    expect(Math.hypot(...diag)).toBeCloseTo(WALK_SPEED);
    expect(Math.hypot(...velocity(0, { forward: 1, strafe: 0, run: true }))).toBeCloseTo(RUN_SPEED);
    expect(Math.hypot(...velocity(1, { forward: 0, strafe: 0, run: false }))).toBe(0);
  });

  it("stops at the platform's edge and says so", () => {
    let x = 0;
    let z = BOUNDS.z1 - 0.05;
    const step = move("green", x, z, 0, 0.2);
    expect(step.z).toBe(z);
    expect(step.bumped).toBe(true);
    expect(step.atEdge).toBe(true);
    // Walking along the edge still works.
    ({ x, z } = move("green", x, z, 0.2, 0));
    expect(x).toBeCloseTo(0.2);
  });

  it("slides along furniture instead of walking through it", () => {
    // The Exchange's card table: a 2 m square at (0, 0.4). Walk at it diagonally from the front.
    const room = "exchange";
    const table = boxesIn(room).find((b) => b.x === 0 && b.z === 0.4)!;
    let x = -0.4;
    let z = table.z + table.hd + BODY_RADIUS + 0.05;
    for (let i = 0; i < 20; i++) {
      const s = move(room, x, z, 0.05, -0.05);
      x = s.x;
      z = s.z;
      expect(blocked(room, x, z)).toBe(false);
    }
    // He's moved along the table's front edge (x went up) without getting into it (z held).
    expect(x).toBeGreaterThan(0.5);
    expect(z).toBeGreaterThanOrEqual(table.z + table.hd + BODY_RADIUS - 1e-9);
  });

  it("bumps into the things no agent's route crosses, too: the boiler", () => {
    expect(blocked("boiler", 4.2, -2.2)).toBe(true);
    expect(blocked("foundry", 0, 4.6)).toBe(false);
  });

  it("can always walk out of somewhere he shouldn't be", () => {
    const s = move("boiler", 4.2, -2.2, 0.1, 0);
    expect(s.x).toBeCloseTo(4.3);
  });

  it("climbs onto the club's stage", () => {
    expect(floorAt("breakroom", 0, -4)).toBeCloseTo(0.45);
    expect(floorAt("breakroom", 0, 0)).toBe(0);
    expect(floorAt("spire", 0, -4)).toBe(0);
  });

  it("walks to a tapped spot and stops there", () => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < 400; i++) {
      const v = seek(x, z, 2, -1);
      if (!v) break;
      x += v[0] / 60;
      z += v[1] / 60;
    }
    expect(seek(x, z, 2, -1)).toBeNull();
    expect(Math.hypot(x - 2, z + 1)).toBeLessThan(0.15);
  });

  it("bobs his head as he walks, and holds still when he doesn't", () => {
    expect(Math.abs(headBob(1.2, 0).y) + Math.abs(headBob(1.2, 0).roll)).toBe(0);
    const b = headBob(Math.PI / 2, 1);
    expect(b.y).toBeLessThan(0);
    expect(Math.abs(b.y)).toBeLessThan(0.05);
    expect(Math.abs(b.roll)).toBeLessThan(0.03);
  });
});

describe("Brogu's eyes: the stream between rooms", () => {
  it("knows when he's at the foot of it", () => {
    for (const room of ROOM_IDS) {
      const [gx, gz] = gateSpot(room);
      expect(atGate(room, gx, gz + 0.5)).toBe(true);
      expect(atGate(room, 0, 4.6)).toBe(false);
    }
  });

  it("sets him down on a clear floor, past the stream's foot, facing into the room", () => {
    for (const room of ROOM_IDS) {
      const land = arrival(room);
      expect(blocked(room, land.x, land.z), room).toBe(false);
      expect(atGate(room, land.x, land.z), room).toBe(false);
      expect(forwardOf(land.yaw)[1], room).toBeGreaterThan(0.9);
    }
  });

  it("carries him from one room's floor to another's, up through the Kernel", () => {
    const route = rideRoute("foundry", 0, -5.2, "archive");
    const start = sampleRoute(route, 0).position;
    expect(start[0]).toBeCloseTo(roomToWorld("foundry", 0, 0, -5.2)[0]);
    const end = sampleRoute(route, route.duration + 1);
    expect(end.done).toBe(true);
    const land = arrival("archive");
    const want = roomToWorld("archive", land.x, 0, land.z);
    expect(end.position[0]).toBeCloseTo(want[0]);
    expect(end.position[2]).toBeCloseTo(want[2]);
    expect(blocked("archive", land.x, land.z)).toBe(false);
    // It rises above the rooms on the way, and doesn't take all day.
    const top = Math.max(...route.points.map((p) => p[1]));
    expect(top).toBeGreaterThan(ROOMS.foundry.y + 4);
    expect(route.duration).toBeGreaterThan(2000);
    expect(route.duration).toBeLessThan(15000);
  });
});
