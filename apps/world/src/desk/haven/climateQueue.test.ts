import { afterEach, describe, expect, it, vi } from "vitest";
import { useHome, type DeviceReading } from "../homeDevices.ts";
import { HOLD_MS, moodOf, sameAs, useClimateQueue } from "./climateQueue.ts";
import { gaugesOf, orderGauges } from "./plinth.ts";

/** The Climate's held change and the strip's order (#718), from made-up readings. */

const nest = (over: Partial<DeviceReading>): DeviceReading => ({ id: "0123456789ab", vendor: "nest", kind: "thermostat", model: "", place: "", online: true, state: "heating", alerts: [], tempF: 68, mode: "heat", heatF: 70, coolF: null, eco: false, ...over });

afterEach(() => {
  useClimateQueue.getState().cancel();
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
