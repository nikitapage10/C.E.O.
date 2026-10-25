import { describe, expect, it } from "vitest";
import { formation, modeFor, place, rank, yardAt } from "./stadium.ts";

describe("the Green's stadium", () => {
  it("picks the wide camera from 640px up and the tall one on a phone", () => {
    expect(modeFor(1280)).toBe("wide");
    expect(modeFor(390)).toBe("tall");
  });

  it("puts the near edge at full scale and the far edge smaller", () => {
    for (const mode of ["wide", "tall"] as const) {
      const near = mode === "wide" ? place(mode, 0.5, 1) : place(mode, 0, 0.5);
      const far = mode === "wide" ? place(mode, 0.5, 0) : place(mode, 1, 0.5);
      expect(near.s).toBeCloseTo(1);
      expect(far.s).toBeLessThan(near.s);
      expect(far.y).toBeLessThan(near.y);
    }
  });

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
