import { ROOM_IDS, roomCenter } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { NEAR, nearestRooms } from "./streaming.ts";

describe("room-first on the overview (#373)", () => {
  it("loads the rooms nearest the overview's camera first", () => {
    const near = nearestRooms();
    expect(near).toHaveLength(NEAR);
    expect(new Set(near).size).toBe(NEAR);
    for (const r of near) expect(ROOM_IDS).toContain(r);
    // Nearer the camera (toward +z) than any room left for later.
    const z = (r: (typeof ROOM_IDS)[number]) => roomCenter(r)[2];
    const later = ROOM_IDS.filter((r) => !near.includes(r));
    expect(Math.min(...near.map(z))).toBeGreaterThanOrEqual(Math.max(...later.map(z)) - 1e-9);
  });
});
