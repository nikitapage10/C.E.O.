import { describe, expect, it } from "vitest";
import { ROOMS, ROOM_IDS, blockedAt, inAir, routeBetween, worldToRoom } from "@ceo/core";
import { PETS, wanderSpots } from "./pets.ts";

describe("pet wander spots", () => {
  it("keeps pets on the floor, off the benches at the Archive's long table (#1179)", () => {
    for (const pet of PETS) {
      const spots = wanderSpots("archive", pet.id);
      expect(spots.some((id) => id.startsWith("seat-"))).toBe(false);
      expect(spots).toContain("dice-table");
    }
  });

  it("never sends a pet to a spot up on the furniture or in the air", () => {
    for (const room of ROOM_IDS) {
      for (const id of wanderSpots(room)) {
        const s = ROOMS[room].stations.find((st) => st.id === id)!;
        expect(inAir({ room, station: id })).toBe(false);
        expect((s.y ?? 0) > 0 && blockedAt(room, s.x, s.z)).toBe(false);
      }
    }
  });

  it("walks Spore around the long table, not across it", () => {
    const spots = wanderSpots("archive", "spore");
    for (const a of spots)
      for (const b of spots) {
        if (a === b) continue;
        const route = routeBetween({ room: "archive", station: a }, { room: "archive", station: b }, "spore-1");
        for (const [x, , z] of route.points) {
          const [lx, lz] = worldToRoom("archive", x, z);
          // The long table and its benches: x 0 to 4.8, z 1.05 to 3.55.
          expect(lx > 0.05 && lx < 4.75 && lz > 1.1 && lz < 3.5).toBe(false);
        }
      }
  });
});
