import { ROOM_IDS } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { above, nodeOf, ringIn, spokeOf } from "./mapStage.ts";
import type { RoomSummary } from "./mapModel.ts";

const room = (o: Partial<RoomSummary>): RoomSummary => ({ room: "foundry", live: true, here: 3, running: 1, shipped: 0, waiting: 0, crew: [], ...o });

describe("the map's ring (#433)", () => {
  it("fits its box with room for the names, on a desk and on a phone", () => {
    for (const [w, h, phone] of [[760, 820, false], [1200, 700, false], [358, 358, true]] as const) {
      const g = ringIn({ x: 10, y: 20, w, h }, phone);
      expect(g.cx).toBe(10 + w / 2);
      for (const r of ROOM_IDS) {
        const [x, y] = nodeOf(g, r);
        expect(x - g.br).toBeGreaterThanOrEqual(10);
        expect(x + g.br).toBeLessThanOrEqual(10 + w);
        // The name above or under it stays inside the box too.
        expect(y - (above(r) ? g.lab + (phone ? 16 : 56) : g.br)).toBeGreaterThanOrEqual(20 - 0.5);
        expect(y + (above(r) ? g.br : g.lab + (phone ? 16 : 56))).toBeLessThanOrEqual(20 + h + 0.5);
      }
    }
  });

  it("names the far half's rooms above them and the near half's under them", () => {
    expect(above("archive")).toBe(true);
    expect(above("foundry")).toBe(false);
    expect(ROOM_IDS.filter(above)).toHaveLength(5);
  });
});

describe("a room's stream", () => {
  it("waits for a room the simulator plays, and never shows it flowing", () => {
    expect(spokeOf(room({ live: false, running: 3 }))).toMatchObject({ waiting: true });
    expect(spokeOf(room({ live: false })).density).toBeUndefined();
  });

  it("runs denser and faster with a live room's real work", () => {
    const quiet = spokeOf(room({ running: 0, here: 1 }));
    const busy = spokeOf(room({ running: 3, here: 5 }));
    expect(busy.density!).toBeGreaterThan(quiet.density!);
    expect(busy.rate!).toBeGreaterThan(quiet.rate!);
    expect(busy.density!).toBeLessThanOrEqual(1);
  });
});
