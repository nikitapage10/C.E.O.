import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import type { DeviceReading } from "@ceo/desk/homeDevices.ts";
import { angleOf, DIAL_A0, DIAL_SWEEP, gaugesOf, setOf, threadPoint, THREAD_TO, turnTo, type GaugeInput } from "./plinth.ts";
import { HOME_PH, HOME_TH, hullHits, hullOf, RISE_HOLD_MS, RISE_MS, riseFrom } from "./house.ts";
import { HUSH } from "./surroundings.ts";
import { HUSH_DAY, HUSH_NIGHT } from "./night.ts";

/** The instrument plinth (#680), from made-up readings on the made-up plan. */

const base: GaugeInput = {
  signedIn: true,
  loading: false,
  vendors: { roborock: "live", petlibro: "down", whisker: "waiting", nest: "live" },
  devices: [{ kind: "vacuum", state: "docked", online: true }],
  climate: { state: "live", inside: 73, target: 70, mode: "heat", running: false },
  kitchenOpen: 0,
  gym: { perWeek: 2, doneThisWeek: 1 },
  todos: 3,
};
const nest = (over: Partial<DeviceReading>): DeviceReading => ({ id: "0123456789ab", vendor: "nest", kind: "thermostat", model: "", place: "", online: true, state: "heating", alerts: [], tempF: 68, mode: "heat", heatF: 70, coolF: null, eco: false, ...over });

describe("the gauges", () => {
  it("reads every house-wide source, left to right, with Climate first", () => {
    const g = gaugesOf(base);
    expect(g.map((x) => x.id)).toEqual(["climate", "roborock", "petlibro", "whisker", "kitchen", "gym", "todos"]);
    expect(g[0]).toMatchObject({ value: "73°", state: "holding · heat to 70°", tone: "on" });
    expect(g[1]).toMatchObject({ value: "Docked", tone: "on" });
    expect(g[5]).toMatchObject({ value: "1 of 2", state: "this week" });
    expect(g[6]).toMatchObject({ value: "3", state: "open" });
  });

  it("lights a down device ember and leaves an unconnected one waiting", () => {
    const g = gaugesOf(base);
    expect(g[2]).toMatchObject({ value: "Down", tone: "down" });
    expect(g[3]).toMatchObject({ value: "Waiting", state: "not connected", tone: "wait" });
  });

  it("makes nothing up: no climate, counts or gym say waiting", () => {
    const g = gaugesOf({ ...base, vendors: { ...base.vendors, nest: "waiting" }, climate: { state: "waiting" }, kitchenOpen: null, gym: null, todos: null });
    expect(g[0]).toMatchObject({ value: "Waiting", tone: "wait" });
    for (const i of [4, 5, 6]) expect(g[i]).toMatchObject({ value: "–", state: "waiting", tone: "wait" });
  });
});

describe("the Climate dial", () => {
  it("sweeps 270° from 60 °F to 80 °F and back", () => {
    expect(angleOf(60)).toBeCloseTo(DIAL_A0);
    expect(angleOf(80)).toBeCloseTo(DIAL_A0 + DIAL_SWEEP);
    for (const f of [60, 65, 70, 72, 80]) expect(setOf(angleOf(f))).toBe(f);
    // The dead zone at the bottom snaps to the nearer end.
    expect(setOf(Math.PI / 2 - 0.1)).toBe(80);
    expect(setOf(Math.PI / 2 + 0.1)).toBe(60);
  });

  it("turns through the same set point the control sends, inside the rails", () => {
    expect(turnTo(nest({}), 72)).toEqual({ tempF: 72 });
    expect(turnTo(nest({}), 95)).toEqual({ tempF: 80 });
    expect(turnTo(nest({ mode: "cool", coolF: 76, heatF: null }), 74)).toEqual({ tempF: 74 });
    // Heat and cool: the heat side, with the cool side kept 3 °F above.
    expect(turnTo(nest({ mode: "heatcool", heatF: 68, coolF: 76 }), 70)).toEqual({ heatF: 70, coolF: 76 });
    expect(turnTo(nest({ mode: "heatcool", heatF: 68, coolF: 72 }), 71)).toEqual({ heatF: 71, coolF: 74 });
    expect(turnTo(nest({ mode: "heatcool", heatF: 68, coolF: 72 }), 80)).toEqual({ heatF: 77, coolF: 80 });
  });

  it("doesn't turn while off, in eco or offline", () => {
    expect(turnTo(nest({ mode: "off" }), 72)).toBeNull();
    expect(turnTo(nest({ eco: true }), 72)).toBeNull();
    expect(turnTo(nest({ online: false }), 72)).toBeNull();
  });
});

describe("the threads", () => {
  it("land on the devices, the kitchen's fridge and the gym", () => {
    const climate = FAKE_PLAN.devices.find((d) => d.kind === "thermostat");
    if (climate) expect(threadPoint(FAKE_PLAN, THREAD_TO.climate)?.slice(0, 2)).toEqual([climate.x, climate.y]);
    const fridge = FAKE_PLAN.items.find((i) => i.k === "fridge")!;
    expect(threadPoint(FAKE_PLAN, THREAD_TO.kitchen)?.slice(0, 2)).toEqual([fridge.x + fridge.w / 2, fridge.y + fridge.h / 2]);
    const gym = threadPoint(FAKE_PLAN, THREAD_TO.gym)!;
    expect(gym[1]).toBeGreaterThan(900);
    expect(threadPoint({ ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.filter((r) => r.tab !== "gym") }, THREAD_TO.gym)).toBeNull();
  });

  it("tells when the house would run under the strip", () => {
    const h = hullOf([[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]]);
    expect(h).toHaveLength(4);
    expect(hullHits(h, [90, 90, 200, 200])).toBe(true);
    expect(hullHits(h, [110, 0, 200, 200])).toBe(false);
    // A diamond leaves its corners empty.
    expect(hullHits(hullOf([[50, 0], [100, 50], [50, 100], [0, 50]]), [85, 85, 120, 120])).toBe(false);
  });
});

describe("the opening fly-up and the standard view (#1076)", () => {
  const home = { tx: 1, tz: -2, th: HOME_TH, ph: HOME_PH, r: 20 };
  it("looks down over the home from the hall's side, high and three-quarter", () => {
    // About 45° above the floor, the camera off the plan's low-x, high-y corner (the hall's side), looking to the studio.
    expect(HOME_PH).toBeGreaterThan(0.7);
    expect(HOME_PH).toBeLessThan(0.9);
    expect(Math.sin(HOME_TH)).toBeLessThan(0);
    expect(Math.cos(HOME_TH)).toBeGreaterThan(0);
  });
  it("starts low beside the building, round the same target, and is short", () => {
    const s = riseFrom(home);
    expect([s.tx, s.tz]).toEqual([home.tx, home.tz]);
    // Nearly level: the camera's height over the floor is a small share of its distance.
    expect(Math.cos(s.ph)).toBeLessThan(0.25);
    expect(s.ph).toBeGreaterThan(home.ph + 0.4);
    expect(s.r).toBeLessThan(home.r);
    expect(RISE_MS + RISE_HOLD_MS).toBeGreaterThanOrEqual(1500);
    expect(RISE_MS + RISE_HOLD_MS).toBeLessThanOrEqual(2500);
  });
  it("holds the surroundings and the sky well back", () => {
    expect(HUSH.keep).toBeLessThan(0.3);
    expect(HUSH.glow).toBeLessThan(0.6);
    expect(Math.max(...HUSH.haze)).toBeLessThan(0.1);
    expect(HUSH_DAY).toBeLessThan(HUSH_NIGHT);
    expect(HUSH_NIGHT).toBeLessThan(1);
  });
});
