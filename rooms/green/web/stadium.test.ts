import { describe, expect, it } from "vitest";
import { formation, rank, yardAt } from "./stadium.ts";

describe("the Green's stadium", () => {
  it("maps yard lines inside the end zones", () => {
    expect(yardAt(0)).toBeCloseTo(10 / 120);
    expect(yardAt(100)).toBeCloseTo(110 / 120);
    expect(yardAt(150)).toBeCloseTo(110 / 120);
  });

  it("lines a lineup up on its own half, receivers at the line, kickers and defences deepest", () => {
    const toks = [
      { pos: "QB", slot: "QB" },
      { pos: "RB", slot: "RB" },
      { pos: "WR", slot: "WR" },
      { pos: "TE", slot: "TE" },
      { pos: "WR", slot: "FLEX" },
      { pos: "DEF", slot: "DEF" },
    ];
    expect(rank("WR", "FLEX")).toBe(0);
    expect(rank("RB", "FLEX")).toBe(1);
    const mine = formation(toks, "mine");
    const theirs = formation(toks, "theirs");
    for (const s of mine) expect(s.along).toBeLessThan(0.5);
    for (const s of theirs) expect(s.along).toBeGreaterThan(0.5);
    expect(mine[2]!.along).toBeGreaterThan(mine[0]!.along);
    expect(mine[5]!.along).toBeLessThan(mine[1]!.along);
  });
});
