import { describe, expect, it } from "vitest";
import { homeLine, linkOf, readDevice, readGoogle, readPrivate, readPublic } from "./homeDevices.ts";

describe("the home devices on the Desk (#632)", () => {
  it("keeps only kinds and states from the public face, whatever else comes back", () => {
    const pub = readPublic({ vendors: { roborock: "live", petlibro: "down", whisker: "nope" }, devices: [{ kind: "vacuum", state: "docked", online: true, name: "Rocky's Qrevo", place: "Hall" }, { kind: "toaster", state: "on" }] });
    expect(pub).toEqual({ vendors: { roborock: "live", petlibro: "down", whisker: "waiting", nest: "waiting" }, links: { tasks: "waiting", kroger: "waiting" }, devices: [{ kind: "vacuum", state: "docked", online: true }] });
    expect(JSON.stringify(pub)).not.toMatch(/Qrevo|Hall/);
  });

  it("drops a private reading without an opaque id", () => {
    expect(readDevice({ id: "LR5PTESTSERIAL0001", vendor: "whisker", kind: "litter" })).toBeNull();
    const d = readDevice({ id: "0123456789ab", vendor: "whisker", kind: "litter", state: "ready", online: true, drawer: 40, alerts: ["drawer full", 7] });
    expect(d?.drawer).toBe(40);
    expect(d?.alerts).toEqual(["drawer full"]);
    expect(readPrivate({ vendors: {}, devices: [d], feedCap: 3, roborockConnected: true })?.feedCap).toBe(3);
    // Why a vendor is down (#672): fixed words only, anything else dropped.
    expect(readPrivate({ vendors: {}, devices: [], problems: { petlibro: "signed-out", whisker: "Code: 1102 ILLEGAL_PASSWORD", nope: "refused" } })?.problems).toEqual({ petlibro: "signed-out" });
  });

  it("says counts only, and maps vendor states to Systems lights", () => {
    expect(homeLine(null)).toBe("reading…");
    expect(homeLine({ vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting", nest: "waiting" }, links: { tasks: "waiting", kroger: "waiting" }, devices: [] })).toBe("not connected yet");
    expect(homeLine({ vendors: { roborock: "live", petlibro: "live", whisker: "live", nest: "live" }, links: { tasks: "live", kroger: "waiting" }, devices: [{ kind: "vacuum", state: "docked", online: true }, { kind: "fountain", state: "offline", online: false }] })).toBe("2 devices, 1 offline");
    expect([linkOf("live"), linkOf("down"), linkOf("waiting"), linkOf(undefined)]).toEqual(["ok", "down", "off", "off"]);
  });

  it("reads the thermostat's fields and the Haven's link states (#637)", () => {
    const t = readDevice({ id: "0123456789ab", vendor: "nest", kind: "thermostat", state: "heating", online: true, tempF: 69, humidity: 38, mode: "heat", modes: ["heat", "cool", "toast"], eco: false, heatF: 68, coolF: null, alerts: [] });
    expect(t).toMatchObject({ vendor: "nest", tempF: 69, humidity: 38, mode: "heat", modes: ["heat", "cool"], heatF: 68, coolF: null });
    expect(readPublic({ vendors: {}, links: { tasks: "live", kroger: "bogus" }, devices: [] })?.links).toEqual({ tasks: "live", kroger: "waiting" });
    expect(readGoogle({ google: true, nest: { project: true }, tasks: { connected: true, list: "Shopping" } })).toMatchObject({ google: true, nest: { project: true, connected: false }, tasks: { connected: true, list: "Shopping" } });
    expect(readGoogle({})).toBeNull();
  });
});
