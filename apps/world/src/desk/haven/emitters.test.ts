import { describe, expect, it } from "vitest";
import { emittersOf } from "./emitters.ts";

describe("device emitters (#729)", () => {
  it("merges devices standing together into one calmer emitter, and keeps a lone one as it was", () => {
    const got = emittersOf([
      { x: 100, y: 100, lift: 0, needs: false },
      { x: 160, y: 100, lift: 0, needs: true },
      { x: 220, y: 110, lift: 20, needs: false },
      { x: 900, y: 600, lift: 0, needs: false },
    ]);
    expect(got).toHaveLength(2);
    const pets = got.find((e) => e.n === 3)!;
    expect(pets.x).toBeCloseTo(160);
    expect(pets.needs).toBe(true);
    expect(pets.lift).toBe(20);
    expect(pets.weight).toBe(1.5);
    expect(pets.spread).toBeGreaterThan(50);
    expect(got.find((e) => e.n === 1)).toMatchObject({ x: 900, y: 600, spread: 0, weight: 1, needs: false });
  });
});
