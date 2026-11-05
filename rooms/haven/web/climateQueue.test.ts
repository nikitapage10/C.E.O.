import { afterEach, describe, expect, it, vi } from "vitest";
import { useHome, type DeviceReading } from "../../../apps/world/src/desk/homeDevices.ts";
import { HOLD_MS, moodOf, sameAs, SENT_MS, shownChange, useClimateQueue } from "./climateQueue.ts";
import { GAP_F, gaugesOf, moveSide, orderGauges } from "./plinth.ts";

/** The Climate's held change and the strip's order (#718), from made-up readings. */

const nest = (over: Partial<DeviceReading>): DeviceReading => ({ id: "0123456789ab", vendor: "nest", kind: "thermostat", model: "", place: "", online: true, state: "heating", alerts: [], tempF: 68, mode: "heat", heatF: 70, coolF: null, eco: false, ...over });

afterEach(() => {
  useClimateQueue.getState().cancel();
  useClimateQueue.setState({ sent: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the held climate change", () => {
  it("sends once, three seconds after the last change, with the final setting", () => {
    vi.useFakeTimers();
    const act = vi.fn(async () => true);
    useHome.setState({ act });
    const q = useClimateQueue.getState();
    q.hold("0123456789ab", 71, { tempF: 71 });
    vi.advanceTimersByTime(HOLD_MS - 500);
    q.hold("0123456789ab", 72, { tempF: 72 });
    vi.advanceTimersByTime(HOLD_MS - 500);
    q.hold("0123456789ab", 73, { tempF: 73 });
    expect(act).not.toHaveBeenCalled();
    expect(useClimateQueue.getState().pending?.f).toBe(73);
    vi.advanceTimersByTime(HOLD_MS);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith("thermostat.set", "0123456789ab", undefined, { tempF: 73 });
    expect(useClimateQueue.getState().pending).toBeNull();
  });

  it("Cancel drops it and nothing is sent; Send now sends at once", () => {
    vi.useFakeTimers();
    const act = vi.fn(async () => true);
    useHome.setState({ act });
    const q = useClimateQueue.getState();
    q.hold("0123456789ab", 74, { tempF: 74 });
    q.cancel();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(act).not.toHaveBeenCalled();
    q.hold("0123456789ab", 66, { tempF: 66 });
    useClimateQueue.getState().flush();
    expect(act).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("knows a change back to the thermostat's own setting is no change", () => {
    expect(sameAs(nest({}), { tempF: 70 })).toBe(true);
    expect(sameAs(nest({}), { tempF: 71 })).toBe(false);
    expect(sameAs(nest({ mode: "heatcool", heatF: 68, coolF: 74 }), { heatF: 68, coolF: 74 })).toBe(true);
  });
});

describe("the climate's mood", () => {
  it("heats, cools or holds from the thermostat, and a held change shows where it is going", () => {
    expect(moodOf(nest({ hvac: "heating" }))).toBe("heat");
    expect(moodOf(nest({ hvac: "cooling", mode: "cool" }))).toBe("cool");
    expect(moodOf(nest({ hvac: "off" }))).toBe("hold");
    expect(moodOf(nest({ mode: "off" }))).toBe("off");
    expect(moodOf(nest({ hvac: "off", tempF: 68 }), 72)).toBe("heat");
    expect(moodOf(nest({ hvac: "off", tempF: 74, mode: "cool", coolF: 76 }), 70)).toBe("cool");
    expect(moodOf(null)).toBe("off");
  });
});

describe("the strip's order", () => {
  const gauges = gaugesOf({ signedIn: true, loading: false, vendors: { roborock: "live", petlibro: "live", whisker: "live", nest: "live" }, devices: [], climate: { state: "waiting" }, kitchenOpen: 0, gym: null, todos: 0 });
  it("lines the gauges up the way their threads land, and keeps the rest where they were", () => {
    const ids = orderGauges(gauges, ["gym", "whisker", "climate", "roborock"]).map((g) => g.id);
    expect(ids).toEqual(["gym", "whisker", "petlibro", "climate", "kitchen", "roborock", "todos"]);
    expect(orderGauges(gauges, null).map((g) => g.id)).toEqual(gauges.map((g) => g.id));
  });
});

describe("heat and cool never cross (#742)", () => {
  it("clamps a knob to 60 to 80 °F and stops it the gap short of the other, which stays put", () => {
    expect(moveSide("heat", 70.4, 68, 76)).toEqual({ heatF: 70, coolF: 76 });
    expect(moveSide("heat", 75, 68, 76)).toEqual({ heatF: 76 - GAP_F, coolF: 76 });
    expect(moveSide("heat", 90, 68, 76)).toEqual({ heatF: 73, coolF: 76 });
    expect(moveSide("heat", 40, 68, 76)).toEqual({ heatF: 60, coolF: 76 });
    expect(moveSide("cool", 69, 68, 76)).toEqual({ heatF: 68, coolF: 68 + GAP_F });
    expect(moveSide("cool", 99, 68, 76)).toEqual({ heatF: 68, coolF: 80 });
    expect(moveSide("cool", 74, 68, 76)).toEqual({ heatF: 68, coolF: 74 });
    // Every result keeps the gap, wherever the finger goes.
    for (let f = 50; f <= 90; f += 0.5)
      for (const side of ["heat", "cool"] as const) {
        const r = moveSide(side, f, 66, 74);
        expect(r.coolF - r.heatF).toBeGreaterThanOrEqual(GAP_F);
        expect(r.heatF).toBeGreaterThanOrEqual(60);
        expect(r.coolF).toBeLessThanOrEqual(80);
      }
  });
});

describe("a sent change shows at once, and goes back if it fails (#742)", () => {
  it("keeps showing the sent setting until the reading has it, then the reading", async () => {
    vi.useFakeTimers();
    useHome.setState({ act: vi.fn(async () => true) });
    const d = nest({ mode: "heatcool", heatF: 68, coolF: 76 });
    useClimateQueue.getState().hold(d.id, 66, { heatF: 66, coolF: 74 });
    useClimateQueue.getState().flush();
    await vi.advanceTimersByTimeAsync(0);
    const { pending, sent } = useClimateQueue.getState();
    expect(shownChange(d, pending, sent)?.extra).toEqual({ heatF: 66, coolF: 74 });
    expect(shownChange({ ...d, heatF: 66, coolF: 74 }, pending, sent)).toBeNull();
    expect(shownChange(d, pending, sent, Date.now() + SENT_MS + 1)).toBeNull();
  });

  it("rolls back when the thermostat refuses", async () => {
    useHome.setState({ act: vi.fn(async () => false) });
    useClimateQueue.getState().hold("0123456789ab", 66, { tempF: 66 });
    useClimateQueue.getState().flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(useClimateQueue.getState().sent).toBeNull();
  });
});
