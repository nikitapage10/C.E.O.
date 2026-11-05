import { describe, expect, it } from "vitest";
import { pointsOf, readLive, ride, runsPath } from "./liveRun.ts";

/* Synthetic readings only: an invented two-room plan, never a real map. */

const room = (over: Record<string, unknown> = {}) => ({ segment: 16, name: "Test room", runs: [0, 0, 4, 2, 0, 4], cx: 2, cy: 2, order: 1, pct: 40.4, state: "now", ...over });
const answer = (over: Record<string, unknown> = {}) => ({
  map: { w: 20, h: 10, rooms: [room(), room({ segment: 17, order: null, pct: null, state: "off" })], walls: [0, 0, 20], path: [1, 1, 2, 1, 3, 1], robot: { x: 3, y: 1, a: 90 }, charger: { x: 1, y: 1 }, ...over },
});

describe("readLive", () => {
  it("reads idle, and anything off-shape as unavailable", () => {
    expect(readLive({ state: "idle" })).toEqual({ kind: "idle" });
    expect(readLive(null)).toEqual({ kind: "unavailable" });
    expect(readLive({ map: { w: 0, h: 5, rooms: [] } })).toEqual({ kind: "unavailable" });
    expect(readLive({ map: { w: 5, h: 5 } })).toEqual({ kind: "unavailable" });
  });

  it("reads a map field by field", () => {
    const got = readLive(answer());
    expect(got.kind).toBe("map");
    if (got.kind !== "map") return;
    expect(got.map.rooms).toHaveLength(2);
    expect(got.map.rooms[0]).toMatchObject({ segment: 16, name: "Test room", order: 1, pct: 40, state: "now" });
    expect(got.map.rooms[1]).toMatchObject({ order: null, pct: null, state: "off" });
    expect(got.map.robot).toEqual({ x: 3, y: 1, a: 90 });
    expect(got.map.charger).toEqual({ x: 1, y: 1 });
    expect(got.map.path).toEqual([1, 1, 2, 1, 3, 1]);
  });

  it("drops what is wrong: bad rooms, odd states, non-numbers, a missing robot", () => {
    const got = readLive(answer({ rooms: [room({ cx: "x" }), room({ state: "boom", pct: 400, order: 0 })], path: [1, "a", NaN, 2], robot: { x: "no" }, charger: null }));
    if (got.kind !== "map") throw new Error("expected a map");
    expect(got.map.rooms).toHaveLength(1);
    expect(got.map.rooms[0]).toMatchObject({ state: "off", pct: null, order: null });
    expect(got.map.path).toEqual([1, 2]);
    expect(got.map.robot).toBeNull();
    expect(got.map.charger).toBeNull();
  });
});

describe("runsPath and pointsOf", () => {
  it("draws runs as rectangles", () => {
    expect(runsPath([1, 2, 3])).toBe("M2 1h3v2h-3z");
    expect(runsPath([])).toBe("");
    expect(runsPath([1, 2])).toBe("");
  });
  it("pairs a flat list", () => {
    expect(pointsOf([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4]]);
  });
});

describe("ride", () => {
  const prev: [number, number][] = [[0, 0], [10, 0]];
  const next: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  const robot = { x: 10, y: 10, a: 90 };

  it("starts at the last reading and ends at the new one", () => {
    const start = ride(prev, next, robot, 0);
    expect(start.at).toEqual([10, 0]);
    const end = ride(prev, next, robot, 1);
    expect(end.at).toEqual([10, 10]);
    expect(end.path[end.path.length - 1]).toEqual([10, 10]);
    expect(end.heading).toBe(-90);
  });

  it("never runs the path ahead of the robot", () => {
    const mid = ride(prev, next, robot, 0.5);
    expect(mid.at![1]).toBeGreaterThan(0);
    expect(mid.at![1]).toBeLessThan(10);
    expect(mid.path[mid.path.length - 1]).toEqual(mid.at);
  });

  it("draws the whole path when there is no earlier reading, and handles no path", () => {
    expect(ride([], next, robot, 1).at).toEqual([10, 10]);
    expect(ride([], [], null, 1)).toEqual({ path: [], at: null, heading: null });
  });
});
