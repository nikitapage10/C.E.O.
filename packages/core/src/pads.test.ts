import { describe, expect, it } from "vitest";
import { FOUNDRY_FLOOR } from "./foundryFloor.ts";
import { ROOMS, ROOM_HALF_D, ROOM_HALF_W, ROOM_IDS, inAir, padSpot, padWorld, roomToWorld, routeBetween, type RoomId } from "./layout.ts";
import { OBSTACLES, blockedAt, detour } from "./obstacles.ts";
import { PAD_CLEARANCE, PAD_FROM_SPOTS, PAD_MAX_FROM_ENTRY, PAD_MIN_FROM_ENTRY, PAD_RADIUS, entrySpot } from "./pads.ts";

/** The walking length from a to b round the furniture, as routes walk it. */
function walkLength(room: RoomId, a: readonly [number, number], b: readonly [number, number]): number {
  const pts = [a, ...detour(room, a, b), b];
  return pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);
}

describe("the teleporter pads (#155)", () => {
  it("sit a few steps from each room's way in, with a straight walk there", () => {
    for (const room of ROOM_IDS) {
      const entry = entrySpot(room);
      const [x, z] = padSpot(room);
      const d = Math.hypot(x - entry[0], z - entry[1]);
      expect(d, room).toBeGreaterThanOrEqual(PAD_MIN_FROM_ENTRY);
      expect(d, room).toBeLessThanOrEqual(PAD_MAX_FROM_ENTRY);
      // Nothing in the way: the walk from the way in is a straight line.
      expect(detour(room, entry, [x, z]), room).toEqual([]);
      // The way in is front and centre, on the camera side; the pad is up front with it.
      expect(entry[1], room).toBeGreaterThan(3.5);
      expect(z, room).toBeGreaterThan(2.5);
    }
  });

  it("stand on clear floor, inside the walls, off every footprint", () => {
    for (const room of ROOM_IDS) {
      const [x, z] = padSpot(room);
      expect(Math.abs(x) + PAD_RADIUS, room).toBeLessThan(ROOM_HALF_W);
      expect(Math.abs(z) + PAD_RADIUS, room).toBeLessThan(ROOM_HALF_D);
      expect(blockedAt(room, x, z, PAD_CLEARANCE), room).toBe(false);
      for (const box of OBSTACLES[room] ?? []) {
        const gap = Math.max(Math.abs(x - box.x) - box.hw, Math.abs(z - box.z) - box.hd);
        expect(gap, `${room} ${JSON.stringify(box)}`).toBeGreaterThanOrEqual(PAD_RADIUS);
      }
    }
  });

  it("keep clear of where anyone stands to work or idle, the Foundry's dock crew included", () => {
    for (const room of ROOM_IDS) {
      const [x, z] = padSpot(room);
      for (const st of ROOMS[room].stations) {
        if (inAir({ room, station: st.id })) continue;
        expect(Math.hypot(x - st.x, z - st.z), `${room}/${st.id}`).toBeGreaterThanOrEqual(PAD_FROM_SPOTS);
      }
    }
    const [x, z] = padSpot("foundry");
    for (const [sx, sz] of [...FOUNDRY_FLOOR.bays, ...FOUNDRY_FLOOR.lineSpots]) expect(Math.hypot(x - sx, z - sz)).toBeGreaterThanOrEqual(PAD_FROM_SPOTS);
    // Well away from the dock against the left wall.
    expect(x - (FOUNDRY_FLOOR.dock.x + FOUNDRY_FLOOR.dock.hw)).toBeGreaterThan(3);
  });

  it("are a short walk from every spot in the room: no going round the room to reach them", () => {
    for (const room of ROOM_IDS) {
      const pad = padSpot(room);
      for (const st of ROOMS[room].stations) {
        if (inAir({ room, station: st.id })) continue;
        const straight = Math.hypot(st.x - pad[0], st.z - pad[1]);
        // At most a short step round a piece of furniture on top of the straight line.
        expect(walkLength(room, [st.x, st.z], pad), `${room}/${st.id}`).toBeLessThan(straight * 1.25 + 1.5);
      }
    }
  });

  it("in the Foundry, the line no longer stands between the benches and the way out", () => {
    // Before #155 the way out was at the back wall, behind the conveyor that runs nearly wall to wall.
    const pad = padSpot("foundry");
    for (const [bx, bz] of FOUNDRY_FLOOR.benches) expect(walkLength("foundry", [bx, bz], pad)).toBeLessThan(4);
    const oldGate: [number, number] = [0, -ROOM_HALF_D - 0.4];
    const [bx, bz] = FOUNDRY_FLOOR.benches[1];
    expect(walkLength("foundry", [bx, bz], oldGate)).toBeGreaterThan(walkLength("foundry", [bx, bz], pad) * 3);
  });

  it("are where agents leave a room and arrive in the next", () => {
    const from = { room: "foundry", station: "bench-b" } as const;
    const to = { room: "archive", station: "loom" } as const;
    const route = routeBetween(from, to, "tessellate");
    const firstStream = route.kinds.indexOf("stream");
    const lastStream = route.kinds.lastIndexOf("stream");
    // The walk ends on the Foundry's pad; the stream sets them down on the Archive's.
    expect(route.points[firstStream]).toEqual(padWorld("foundry"));
    expect(route.points[lastStream + 1]).toEqual(padWorld("archive"));
    // Walking from the bench to the pad is a few metres, not a lap of the room.
    const walked = route.points.slice(0, firstStream + 1);
    const metres = walked.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - walked[i]![0], p[2] - walked[i]![2]), 0);
    expect(metres).toBeLessThan(4);
    // The beam carries them up over the back wall before the stream takes them.
    const top = Math.max(...route.points.slice(firstStream, firstStream + 3).map((p) => p[1]));
    expect(top).toBeGreaterThan(roomToWorld("foundry", 0, 5.6, 0)[1]);
  });
});
