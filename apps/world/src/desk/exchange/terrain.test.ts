import { describe, expect, it } from "vitest";
import { bell, landforms, returnPct, waterline } from "./terrain.ts";

const P = (value: number, cost: number, pnlPct: number | null = null) => ({ value, cost, pnl: value - cost, pnlPct });

describe("the book as terrain (#387)", () => {
  it("puts a winner above the waterline, a loser under it, and break-even on it", () => {
    const [up, down, flat] = landforms([P(120, 90), P(80, 95), P(40, 40)]);
    expect(up!.rise).toBeGreaterThan(0);
    expect(down!.rise).toBeLessThan(0);
    expect(flat!.rise).toBe(0);
  });

  it("shares the section by value, left to right, inside the frame", () => {
    const fs = landforms([P(300, 200), P(100, 90), P(10, 12)]);
    expect(fs[0]!.w).toBeGreaterThan(fs[1]!.w);
    expect(fs[1]!.w).toBeGreaterThan(fs[2]!.w);
    for (let i = 1; i < fs.length; i++) expect(fs[i]!.cx).toBeGreaterThan(fs[i - 1]!.cx);
    for (const f of fs) {
      expect(f.cx).toBeGreaterThan(0);
      expect(f.cx).toBeLessThan(1);
      expect(Math.abs(f.rise)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a quiet book low: a 2% gain is not drawn as a mountain", () => {
    const [f] = landforms([P(102, 100, 2)]);
    expect(f!.rise).toBeLessThan(0.4);
  });

  it("reads the return from Polymarket, or from P&L over cost", () => {
    expect(returnPct(P(110, 100, 12.5))).toBe(12.5);
    expect(returnPct(P(110, 100))).toBeCloseTo(10);
    expect(returnPct(P(0, 0))).toBe(0);
  });

  it("counts above and under water", () => {
    expect(waterline([P(2, 1), P(1, 2), P(1, 1)])).toEqual({ above: 1, under: 1, flat: 1 });
  });

  it("peaks exactly at the summit, whatever the ridges", () => {
    const [f] = landforms([P(10, 5)]);
    for (const sd of [0, 0.3, 0.77]) expect(bell(f!.cx, f!, sd)).toBeCloseTo(1);
    expect(bell(f!.cx + f!.w * 3, f!, 0.5)).toBe(0);
  });
});
