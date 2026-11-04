import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../../../api/_haven/plan.fixture.ts";
import type { DeviceReading } from "../homeDevices.ts";
import { deviceLit, litRooms, roomAt, summaryOf, tabOf } from "./data.ts";
import { wallsOf } from "./house.ts";

/** The Haven's lit rooms (#616), from made-up readings on a made-up plan. */

const NOW = Date.parse("2026-11-04T18:00:00Z");
const dev = (over: Partial<DeviceReading>): DeviceReading => ({ id: "0123456789ab", vendor: "petlibro", kind: "dry-feeder", model: "", place: "", online: true, state: "idle", alerts: [], ...over });
const room = (id: string) => FAKE_PLAN.rooms.find((r) => r.id === id)!;

describe("the plan's rooms", () => {
  it("finds the room a point is in", () => {
    expect(roomAt(FAKE_PLAN, 300, 100)?.id).toBe("kitchen");
    expect(roomAt(FAKE_PLAN, 400, 1000)?.id).toBe("gym");
    expect(roomAt(FAKE_PLAN, 990, 1290)).toBeNull();
  });

  it("opens a room's own tab, or Pets where the cat's things are, or the Hall where the vacuum docks", () => {
    expect(tabOf(FAKE_PLAN, room("kitchen"))).toBe("kitchen");
    expect(tabOf(FAKE_PLAN, room("nook"))).toBe("pets");
    expect(tabOf(FAKE_PLAN, room("bedroom"))).toBeNull();
    const bare = { ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.map((r) => ({ ...r, tab: null })), devices: FAKE_PLAN.devices.filter((d) => d.kind !== "litter") };
    expect(tabOf(bare, bare.rooms.find((r) => r.id === "hall")!)).toBe("hall");
  });

  it("builds walls with the doors cut out", () => {
    const walls = wallsOf(FAKE_PLAN);
    // The front door (y = 40, x 90 to 170) is a gap in the hall's top wall.
    const top = walls.filter((w) => w[1] === 40 && w[3] === 40 && w[0] < 220);
    expect(top).toEqual([
      [40, 40, 90, 40],
      [170, 40, 960, 40],
    ]);
  });
});

describe("litRooms", () => {
  it("leaves a quiet house dim", () => {
    expect(litRooms(FAKE_PLAN, { devices: [dev({ kind: "vacuum", vendor: "roborock", state: "docked" })], kitchenOpen: 0, climate: { state: "waiting" }, now: NOW })).toEqual({});
  });

  it("lights the room where the vacuum runs, the feeders' room when food is low, and the kitchen with things to get", () => {
    const lit = litRooms(FAKE_PLAN, {
      devices: [dev({ kind: "vacuum", vendor: "roborock", state: "cleaning" }), dev({ kind: "dry-feeder", foodLow: true })],
      kitchenOpen: 3,
      climate: { state: "waiting" },
      now: NOW,
    });
    expect(lit.hall).toMatchObject({ level: 1, needs: false, why: ["vacuum running"] });
    expect(lit.nook).toMatchObject({ needs: true, why: ["food low"] });
    expect(lit.kitchen).toMatchObject({ needs: false, why: ["3 to get"] });
    expect(Object.keys(lit).sort()).toEqual(["hall", "kitchen", "nook"]);
  });

  it("lets the climate light the room it names (the living room), only once it's live and running", () => {
    const base = { devices: [], kitchenOpen: 0, now: NOW };
    expect(litRooms(FAKE_PLAN, { ...base, climate: { state: "waiting" } }).living).toBeUndefined();
    expect(litRooms(FAKE_PLAN, { ...base, climate: { state: "live", inside: 67, target: 68, mode: "heat", running: true } }).living?.why).toEqual(["heating"]);
  });

  it("reads each device's own signs", () => {
    expect(deviceLit(dev({ online: false }), NOW)).toMatchObject({ needs: true, why: ["offline"] });
    expect(deviceLit(dev({ kind: "litter", vendor: "whisker", drawer: 90 }), NOW)).toMatchObject({ needs: true, why: ["drawer full"] });
    expect(deviceLit(dev({ kind: "litter", vendor: "whisker", catInside: true }), NOW)).toMatchObject({ level: 0.8, why: ["cat inside"] });
    expect(deviceLit(dev({ kind: "fountain", water: 10 }), NOW).why).toEqual(["water low"]);
    expect(deviceLit(dev({ lastFed: new Date(NOW - 10 * 60_000).toISOString() }), NOW).why).toEqual(["just fed"]);
    expect(deviceLit(dev({ foodLow: true, lastFed: new Date(NOW - 10 * 60_000).toISOString() }), NOW).why).toEqual(["food low", "just fed"]);
    expect(deviceLit(dev({ lastFed: new Date(NOW - 3 * 3_600_000).toISOString() }), NOW).level).toBe(0);
  });

  it("sums up what needs Nikita first", () => {
    expect(summaryOf({}, FAKE_PLAN)).toMatch(/All quiet/);
    expect(summaryOf({ nook: { level: 0.85, needs: true, why: ["food low"] }, kitchen: { level: 0.5, needs: false, why: ["2 to get"] } }, FAKE_PLAN)).toBe("Dining: food low");
  });
});
