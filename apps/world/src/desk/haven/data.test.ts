import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../../../api/_haven/plan.fixture.ts";
import type { DeviceReading } from "../homeDevices.ts";
import { climateOf, deviceLit, litRooms, roomAt, summaryOf, tabOf } from "./data.ts";
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

describe("the climate from the Nest (#637)", () => {
  it("waits without a thermostat reading, and reads one once it's there", () => {
    expect(climateOf(null)).toEqual({ state: "waiting" });
    expect(climateOf([dev({ kind: "vacuum", vendor: "roborock" })])).toEqual({ state: "waiting" });
    expect(climateOf([dev({ kind: "thermostat", vendor: "nest", online: false, tempF: 66 })])).toEqual({ state: "waiting" });
    expect(climateOf([dev({ kind: "thermostat", vendor: "nest", tempF: 66, mode: "heat", heatF: 68, hvac: "heating" })])).toEqual({ state: "live", inside: 66, target: 68, mode: "heat", running: true });
    expect(climateOf([dev({ kind: "thermostat", vendor: "nest", tempF: 74, mode: "heatcool", heatF: 66, coolF: 72, hvac: "cooling" })])).toEqual({ state: "live", inside: 74, target: null, mode: "cool", running: true });
    expect(climateOf([dev({ kind: "thermostat", vendor: "nest", tempF: 70, mode: "heat", eco: true, hvac: "off" })])).toMatchObject({ mode: "eco", running: false });
  });
});

describe("the default view (#658)", () => {
  it("fits the plan's box inside the frame's margins, whatever its shape, and fills it", async () => {
    const THREE = await import("three");
    const { fitView, HOME_TH, HOME_PH } = await import("./house.ts");
    const m = { l: 40, r: 50, t: 60, b: 50 };
    for (const [box, W, H] of [
      [{ x0: -5, x1: 5, z0: -6.5, z1: 6.5, h: 0.9 }, 1100, 860],
      [{ x0: -12, x1: 12, z0: -2, z1: 2, h: 0.9 }, 1100, 860],
      [{ x0: -5, x1: 5, z0: -6.5, z1: 6.5, h: 0.9 }, 390, 620],
    ] as const) {
      const { r, pan } = fitView(box, HOME_TH, HOME_PH, W, H, m);
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 400);
      cam.position.set(r * Math.sin(HOME_PH) * Math.sin(HOME_TH), r * Math.cos(HOME_PH), r * Math.sin(HOME_PH) * Math.cos(HOME_TH));
      cam.lookAt(0, 0, 0);
      cam.setViewOffset(W, H, pan[0], pan[1], W, H);
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const x of [box.x0, box.x1]) for (const z of [box.z0, box.z1]) for (const y of [0, box.h]) {
        const v = new THREE.Vector3(x, y, z).project(cam);
        const px = ((v.x + 1) / 2) * W, py = ((1 - v.y) / 2) * H;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      expect(x0).toBeGreaterThanOrEqual(m.l - 1);
      expect(x1).toBeLessThanOrEqual(W - m.r + 1);
      expect(y0).toBeGreaterThanOrEqual(m.t - 1);
      expect(y1).toBeLessThanOrEqual(H - m.b + 1);
      // It fills one way or the other, and sits centred in the box the other way.
      const fillW = (x1 - x0) / (W - m.l - m.r), fillH = (y1 - y0) / (H - m.t - m.b);
      expect(Math.max(fillW, fillH)).toBeGreaterThan(0.98);
      expect(Math.abs((x0 + x1) / 2 - (m.l + (W - m.r)) / 2)).toBeLessThan(1);
      expect(Math.abs((y0 + y1) / 2 - (m.t + (H - m.b)) / 2)).toBeLessThan(1);
    }
  });
});

describe("the night round the house (#665)", () => {
  it("lays the city's lights on the plain, clear of the house, mostly along streets in step with its walls", async () => {
    const { cityLights } = await import("./night.ts");
    const keep = { x0: -5, x1: 5, z0: -6.5, z1: 6.5 };
    const p = cityLights(4000, keep);
    expect(p.length / 3).toBe(4000);
    let onStreet = 0;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!];
      expect(y).toBeGreaterThan(0);
      expect(x > keep.x0 - 2.5 && x < keep.x1 + 2.5 && z > keep.z0 - 2.5 && z < keep.z1 + 2.5).toBe(false);
      if (Math.abs(x / 6 - Math.round(x / 6)) < 0.02 || Math.abs(z / 6 - Math.round(z / 6)) < 0.02) onStreet++;
    }
    expect(onStreet / 4000).toBeGreaterThan(0.85);
  });
});
