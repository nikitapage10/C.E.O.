import { describe, expect, it } from "vitest";
import type { DeviceReading } from "@ceo/desk/homeDevices.ts";
import { bowlChip, cycling, dockOf, drawerWidth, flowing, frontBowl, HOPPER, hopperOf, renderUrl, ringOffset, TANK, trayTurn, waterline } from "./plates.ts";

/** The device plates' marks (#766), from made-up readings: each comes from the reading, and none is invented. */

const dev = (over: Partial<DeviceReading>): DeviceReading => ({ id: "0123456789ab", vendor: "petlibro", kind: "dry-feeder", model: "", place: "", online: true, state: "ok", alerts: [], ...over });

describe("the renders", () => {
  it("are served from the Desk's own assets", () => {
    expect(renderUrl("wettop")).toMatch(/desk\/haven\/wettop\.webp$/);
  });
});

describe("the dry feeder's window", () => {
  it("is clear with OK when there's food, shaded to its last fifth with Low when there isn't", () => {
    expect(hopperOf(dev({ foodLow: false }))).toMatchObject({ shadeTo: HOPPER.top, word: "OK", tone: "ok" });
    const low = hopperOf(dev({ foodLow: true }))!;
    expect(low).toMatchObject({ word: "Low", tone: "warn" });
    expect(low.shadeTo).toBeGreaterThan(HOPPER.top + (HOPPER.bottom - HOPPER.top) * 0.8);
  });

  it("is all shade offline, and nothing at all without a reading", () => {
    expect(hopperOf(dev({ online: false }))).toMatchObject({ shadeTo: HOPPER.bottom, word: "offline" });
    expect(hopperOf(null)).toBeNull();
  });
});

describe("the wet tray from above", () => {
  it("turns so the bowl in front sits at the bottom", () => {
    for (const b of [1, 2, 3] as const) {
      const at = bowlChip(b, trayTurn(b));
      expect(at.left).toBeCloseTo(50, 1);
      expect(at.top).toBeGreaterThan(70);
    }
  });

  it("keeps the other two bowls up top and stays still when the front bowl isn't known", () => {
    const turn = trayTurn(2);
    expect(bowlChip(1, turn).top).toBeLessThan(50);
    expect(bowlChip(3, turn).top).toBeLessThan(50);
    expect(trayTurn(undefined)).toBe(0);
    expect(frontBowl(dev({ kind: "wet-feeder", plate: 3 }))).toBe(3);
    expect(frontBowl(dev({ kind: "wet-feeder", plate: 7 }))).toBeNull();
    expect(frontBowl(null)).toBeNull();
  });
});

describe("the fountain's tank", () => {
  it("fills the base's face to the reading, and draws nothing when the fountain didn't say", () => {
    expect(waterline(100)).toBe(TANK.top);
    expect(waterline(0)).toBe(TANK.bottom);
    expect(waterline(50)).toBe((TANK.top + TANK.bottom) / 2);
    expect(waterline(140)).toBe(TANK.top);
    expect(waterline(null)).toBeNull();
    expect(waterline(undefined)).toBeNull();
  });

  it("flows unless it's off, paused or dry", () => {
    expect(flowing(dev({ kind: "fountain", state: "flowing" }))).toBe(true);
    expect(flowing(dev({ kind: "fountain", state: "paused" }))).toBe(false);
    expect(flowing(dev({ kind: "fountain", state: "flowing", online: false }))).toBe(false);
  });
});

describe("the Litter-Robot", () => {
  it("turns its globe while it cycles or just after Clean now", () => {
    expect(cycling(dev({ kind: "litter", state: "cycling" }))).toBe(true);
    expect(cycling(dev({ kind: "litter", state: "ready" }))).toBe(false);
    expect(cycling(dev({ kind: "litter", state: "ready" }), true)).toBe(true);
  });

  it("draws the drawer to its level, or not at all", () => {
    expect(drawerWidth(50)).toBe(13);
    expect(drawerWidth(null)).toBeNull();
  });
});

describe("the vacuum on its dock", () => {
  const vac = (state: string, battery: number | null = 80, online = true) => dev({ vendor: "roborock", kind: "vacuum", state, battery, online });

  it("is away while it cleans or comes back, charging on the dock below full, docked when full", () => {
    expect(dockOf(vac("cleaning"))).toBe("away");
    expect(dockOf(vac("returning"))).toBe("away");
    expect(dockOf(vac("docked", 64))).toBe("charging");
    expect(dockOf(vac("docked", 100))).toBe("docked");
    expect(dockOf(vac("cleaning", 80, false))).toBe("off");
    expect(dockOf(null)).toBe("off");
  });

  it("rings the turret by its battery, and leaves the ring off without one", () => {
    expect(ringOffset(100, 10)).toBe(0);
    expect(ringOffset(25, 10)).toBe(7.5);
    expect(ringOffset(null, 10)).toBeNull();
  });
});
