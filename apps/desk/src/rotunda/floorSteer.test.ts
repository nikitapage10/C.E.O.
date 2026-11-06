import { describe, expect, it } from "vitest";
import { FLOOR_WAIT_MS, steerLines, whereClause } from "./floorSteer.ts";

/** After Nikita's turn on the floor (#948): the wait for his reply, and the steer back to the debate. */

const first = () => 0;
const second = (n: number) => Math.min(1, n - 1);

describe("the wait for his reply (#948)", () => {
  it("is several seconds, about nine", () => {
    expect(FLOOR_WAIT_MS).toBeGreaterThanOrEqual(8_000);
    expect(FLOOR_WAIT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("the steer back (#948)", () => {
  it("has the chair bring the chamber back to what it was on", () => {
    const l = steerLines({ answered: ["kernel"], where: "the motion was that a starship crew beats any single hero", seated: ["boiler", "foundry"], pick: first });
    expect(l).toHaveLength(1);
    expect(l[0]!.by).toBe("kernel");
    expect(l[0]!.text).toMatch(/before we were interrupted, the motion was that a starship crew/i);
  });

  it("may let another member chime in on the one who answered first", () => {
    const l = steerLines({ answered: ["boiler"], where: "we were on item II", seated: ["boiler", "foundry", "green"], pick: first });
    expect(l.map((x) => x.by)).toEqual(["foundry", "kernel"]);
    expect(l[0]!.text).toMatch(/the Pessimist/);
    expect(l[1]!.text).toMatch(/item II/);
  });

  it("never has the one who answered chime in on himself, nor the chair chime in", () => {
    const l = steerLines({ answered: ["boiler"], where: "we were on item I", seated: ["boiler", "kernel"], pick: first });
    expect(l.map((x) => x.by)).toEqual(["kernel"]);
    expect(steerLines({ answered: ["boiler"], where: "we were on item I", seated: ["boiler", "green"], pick: second }).map((x) => x.by)).toEqual(["kernel"]);
  });

  it("says nothing when the chamber was on nothing: it simply picks up", () => {
    expect(steerLines({ answered: ["kernel"], where: null, seated: ["boiler"], pick: first })).toEqual([]);
  });
});

describe("what the chamber was on (#948)", () => {
  it("reads a motion or an item as the chair's clause", () => {
    expect(whereClause({ motion: "that the Institute is the finest opening act." })).toBe("the motion was that the Institute is the finest opening act");
    expect(whereClause({ motion: "pizza toppings" })).toBe("we were on pizza toppings");
    expect(whereClause({ item: "III" })).toBe("we were on item III");
    expect(whereClause(null)).toBeNull();
    expect(whereClause({ motion: "  " })).toBeNull();
  });
});
