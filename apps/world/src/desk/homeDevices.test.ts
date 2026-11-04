import { describe, expect, it } from "vitest";
import { homeLine, linkOf, readDevice, readPrivate, readPublic } from "./homeDevices.ts";

describe("the home devices on the Desk (#632)", () => {
  it("keeps only kinds and states from the public face, whatever else comes back", () => {
    const pub = readPublic({ vendors: { roborock: "live", petlibro: "down", whisker: "nope" }, devices: [{ kind: "vacuum", state: "docked", online: true, name: "Rocky's Qrevo", place: "Hall" }, { kind: "toaster", state: "on" }] });
    expect(pub).toEqual({ vendors: { roborock: "live", petlibro: "down", whisker: "waiting" }, devices: [{ kind: "vacuum", state: "docked", online: true }] });
    expect(JSON.stringify(pub)).not.toMatch(/Qrevo|Hall/);
  });

  it("drops a private reading without an opaque id", () => {
    expect(readDevice({ id: "LR5PTESTSERIAL0001", vendor: "whisker", kind: "litter" })).toBeNull();
    const d = readDevice({ id: "0123456789ab", vendor: "whisker", kind: "litter", state: "ready", online: true, drawer: 40, alerts: ["drawer full", 7] });
    expect(d?.drawer).toBe(40);
    expect(d?.alerts).toEqual(["drawer full"]);
    expect(readPrivate({ vendors: {}, devices: [d], feedCap: 3, roborockConnected: true })?.feedCap).toBe(3);
  });

  it("says counts only, and maps vendor states to Systems lights", () => {
    expect(homeLine(null)).toBe("reading…");
    expect(homeLine({ vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting" }, devices: [] })).toBe("not connected yet");
    expect(homeLine({ vendors: { roborock: "live", petlibro: "live", whisker: "live" }, devices: [{ kind: "vacuum", state: "docked", online: true }, { kind: "fountain", state: "offline", online: false }] })).toBe("2 devices, 1 offline");
    expect([linkOf("live"), linkOf("down"), linkOf("waiting"), linkOf(undefined)]).toEqual(["ok", "down", "off", "off"]);
  });
});
