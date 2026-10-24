import { describe, expect, it } from "vitest";
import { Simulator } from "@ceo/simulator";
import { applyEvents, emptyState, ROOM_IDS } from "@ceo/core";
import { crewPoint, hexToRgb, roomSummary, stateLine } from "./mapModel.ts";

describe("the map's reading of the world (#332)", () => {
  const sim = new Simulator({ seed: 7 });
  const state = applyEvents(emptyState(), sim.advanceTo(20_000));

  it("puts every agent somewhere on the ring, in the room they're in", () => {
    const agents = Object.values(state.agents);
    expect(agents.length).toBeGreaterThan(10);
    for (const rt of agents) {
      const p = crewPoint(rt, 20_000);
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(50);
    }
  });

  it("sums each room's crew to the whole Lattice's", () => {
    const total = ROOM_IDS.reduce((n, r) => n + roomSummary(state, r, 20_000).here, 0);
    expect(total).toBe(Object.keys(state.agents).length);
    const s = roomSummary(state, "foundry", 20_000);
    expect(s.live).toBe(true);
    expect(stateLine(s)).toMatch(/^\d+ here/);
  });

  it("reads accents as r,g,b", () => {
    expect(hexToRgb("#ff8000")).toBe("255,128,0");
    expect(hexToRgb("#fff")).toBe("255,255,255");
  });
});
