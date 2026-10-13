import { describe, expect, it } from "vitest";
import { FOUNDRY_FLOOR, OBSTACLES, ROOMS, benchDesks, ROOM_IDS, TALK_DISTANCE, blockedAt, detour, placeToWorld, routeBetween, talkingShift, worldToRoom, roomToWorld, type RoomId } from "./index.ts";

describe("walking around furniture", () => {
  it("goes straight when nothing is in the way", () => {
    expect(detour("foundry", [-5, 2.2], [0, 2.4])).toEqual([]);
    expect(detour("spire", [0, 0], [1, 1])).toEqual([]);
  });

  it("bends around a piece of furniture that blocks the straight line", () => {
    // The Foundry's conveyor belt runs across the middle of the hall.
    const way = detour("foundry", [-3, -1.6], [-3, -4.6]);
    expect(way.length).toBeGreaterThan(0);
    const path: [number, number][] = [[-3, -1.6], ...way, [-3, -4.6]];
    for (let i = 1; i < path.length; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = path[i - 1]![0] + (path[i]![0] - path[i - 1]![0]) * t;
        const z = path[i - 1]![1] + (path[i]![1] - path[i - 1]![1]) * t;
        expect(blockedAt("foundry", x, z)).toBe(false);
      }
    }
  });

  it("lets an agent walk out of the furniture it is standing at", () => {
    expect(() => detour("exchange", [0, 0.4], [-5, 3])).not.toThrow();
    const way = detour("exchange", [0, 0.4], [0, 3]);
    expect(way.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))).toBe(true);
  });

  it("no station's standing spot is buried in furniture", () => {
    for (const id of ROOM_IDS) {
      for (const st of ROOMS[id].stations) {
        // Agents may stand at (inside the clearance of) their own furniture, but never deep inside a footprint.
        for (const box of OBSTACLES[id] ?? []) {
          const inside = Math.abs(st.x - box.x) < box.hw - 0.5 && Math.abs(st.z - box.z) < box.hd - 0.5;
          if (st.exact) continue;
          expect(inside, `${id}/${st.id} inside a footprint`).toBe(false);
        }
      }
    }
  });

  it("routes between every pair of stations in a room stay out of the furniture", () => {
    for (const id of ROOM_IDS as readonly RoomId[]) {
      const sts = ROOMS[id].stations;
      for (const a of sts) {
        for (const c of sts) {
          if (a === c) continue;
          const r = routeBetween({ room: id, station: a.id }, { room: id, station: c.id }, "tester");
          // Check the interior of every leg that was bent (the endpoints belong to the stations).
          for (let i = 1; i < r.points.length - 1; i++) {
            const [lx, lz] = worldToRoom(id, r.points[i]![0], r.points[i]![2]);
            expect(blockedAt(id, lx, lz), `${id} ${a.id}->${c.id} waypoint ${i}`).toBe(false);
          }
        }
      }
    }
  });

  it("worldToRoom inverts roomToWorld", () => {
    for (const id of ROOM_IDS) {
      const w = roomToWorld(id, 2.5, 0, -3);
      const [x, z] = worldToRoom(id, w[0], w[2]);
      expect(x).toBeCloseTo(2.5);
      expect(z).toBeCloseTo(-3);
    }
  });

  it("a bent route still starts and ends in place", () => {
    const from = { room: "foundry", station: "bench-a" } as const;
    const to = { room: "foundry", station: "assembler" } as const;
    const r = routeBetween(from, to, "a1");
    expect(r.points[0]).toEqual(placeToWorld(from, "a1"));
    expect(r.points.at(-1)).toEqual(placeToWorld(to, "a1"));
  });
});

describe("talking distance", () => {
  it("leaves agents who already have room alone", () => {
    expect(talkingShift([0, 0], [TALK_DISTANCE + 0.1, 0])).toEqual([[0, 0], [0, 0]]);
  });

  it("steps overlapping agents apart to the talking distance, each taking half", () => {
    const [a, b] = talkingShift([0, 0], [0.5, 0]);
    const gap = 0.5 + b[0] - a[0];
    expect(gap).toBeCloseTo(TALK_DISTANCE);
    expect(a[0]).toBeCloseTo(-b[0]);
    expect(a[1]).toBeCloseTo(0);
  });

  it("separates two agents standing on the very same spot", () => {
    const [a, b] = talkingShift([1, 1], [1, 1]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeGreaterThan(TALK_DISTANCE - 0.01);
  });
});

describe("Rusty's dock crew", () => {
  it("roll from the dock to their spots on the line and back without driving through furniture", () => {
    FOUNDRY_FLOOR.bays.forEach(([bx, bz], i) => {
      const apron: [number, number] = [bx + 1.05, bz];
      const spot = FOUNDRY_FLOOR.lineSpots[i]!;
      expect(blockedAt("foundry", apron[0], apron[1])).toBe(false);
      expect(blockedAt("foundry", spot[0], spot[1])).toBe(false);
      for (const [a, c] of [
        [apron, spot],
        [spot, apron],
      ] as const) {
        const path: (readonly [number, number])[] = [a, ...detour("foundry", a, c), c];
        for (let k = 1; k < path.length; k++) {
          for (let t = 0; t <= 1; t += 0.05) {
            const x = path[k - 1]![0] + (path[k]![0] - path[k - 1]![0]) * t;
            const z = path[k - 1]![1] + (path[k]![1] - path[k - 1]![1]) * t;
            expect(blockedAt("foundry", x, z), `bay ${i} at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false);
          }
        }
      }
    });
  });

  it("keep the front left clear: no furniture in front of the dock, workbenches and crates included (#68, #110)", () => {
    // From the dock's face out toward the middle of the hall, and from the dock's back end up to the front wall.
    const { dock } = FOUNDRY_FLOOR;
    const front = { x0: dock.x - dock.hw, x1: -3.5, z0: dock.z - dock.hd, z1: 6.6 };
    const others = (OBSTACLES.foundry ?? []).filter((f) => !(f.x === dock.x && f.z === dock.z));
    expect(others.length).toBe((OBSTACLES.foundry ?? []).length - 1);
    for (const f of others) {
      const overlaps = f.x - f.hw < front.x1 && f.x + f.hw > front.x0 && f.z - f.hd < front.z1 && f.z + f.hd > front.z0;
      expect(overlaps, `furniture at ${f.x},${f.z} stands in front of the dock`).toBe(false);
    }
  });

  it("count the workbenches' desks as furniture, with each bench's standing spot just behind its desk", () => {
    for (const desk of benchDesks()) expect(OBSTACLES.foundry).toContainEqual(desk);
    for (const id of ["bench-a", "bench-b"]) {
      const st = ROOMS.foundry.stations.find((s) => s.id === id)!;
      expect(blockedAt("foundry", st.x, st.z)).toBe(false);
      expect(benchDesks().some((d) => Math.abs(d.x - st.x) < 0.01 && d.z > st.z)).toBe(true);
    }
  });

  it("work the line spread out, clear of each other and of the stretch Rusty walks", () => {
    const line = ROOMS.foundry.stations.filter((s) => ["intake", "assembler", "furnace"].includes(s.id));
    const [lo, hi] = [Math.min(...line.map((s) => s.x)), Math.max(...line.map((s) => s.x))];
    const spots = FOUNDRY_FLOOR.lineSpots;
    spots.forEach(([x, z], i) => {
      for (const [ox, oz] of spots.slice(i + 1)) expect(Math.hypot(ox - x, oz - z)).toBeGreaterThan(1.2);
      for (const s of line) expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(1);
      expect(x < lo || x > hi).toBe(true);
    });
  });
});
