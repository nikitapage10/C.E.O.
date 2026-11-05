import { describe, expect, it } from "vitest";
import { biggestMove, floorWord, marketLine, MINT, positionLine, returnPct, ROSE, tapeItems, tapeSeconds, waterline } from "./floor.ts";
import type { PmMarket, PmWorld } from "./polymarket.ts";

const M = (id: string, prob: number, change24h: number | null, volume24h = 1e6): PmMarket => ({ id, question: `Will thing ${id} happen by December 31, 2026?`, outcome: "Yes", prob, change24h, volume24h, volume: volume24h * 10, endDate: null, url: null, closed: false, spark: [] });

describe("the Exchange's floor (#430)", () => {
  it("gives a busier market a denser line and a bigger move a faster one, coloured by its way", () => {
    const big = marketLine(M("1", 0.5, 0.08, 4e6), 4e6);
    const small = marketLine(M("2", 0.5, -0.01, 1e5), 4e6);
    expect(big.density).toBeGreaterThan(small.density);
    expect(big.rate).toBeGreaterThan(small.rate);
    expect(big.rgb).toBe(MINT);
    expect(small.rgb).toBe(ROSE);
  });

  it("runs the marquee over the world's markets first, then the busiest, each once, with no closed market", () => {
    const w: PmWorld = { ...M("7", 0.62, 0.07), kind: "geopolitics" };
    const items = tapeItems({ world: [w], top: [M("7", 0.62, 0.07), M("8", 0.3, -0.03), { ...M("9", 0.1, 0), closed: true }] });
    expect(items.map((i) => i.id)).toEqual(["7", "8"]);
    expect(items[0]).toMatchObject({ odds: "62%", move: "▲7", tone: "up", name: "Will thing 7 happen" });
    expect(items[1]!.move).toBe("▼3");
    expect(tapeItems(null)).toEqual([]);
  });

  it("keeps the marquee at a reading pace", () => {
    expect(tapeSeconds(4200)).toBe(100);
    expect(tapeSeconds(100)).toBe(20);
  });

  it("says the floor is moving, quiet or waiting, from the real moves only", () => {
    expect(floorWord(null)).toBe("waiting");
    expect(floorWord({ top: [M("1", 0.5, 0.002)], world: [] })).toBe("quiet");
    expect(floorWord({ top: [M("1", 0.5, -0.02)], world: [] })).toBe("moving");
    expect(biggestMove({ top: [M("1", 0.5, -0.06), M("2", 0.5, 0.02)], world: [] })).toBe(6);
  });

  it("tilts a position's line from entry to now, faster the further it moved", () => {
    const up = positionLine({ value: 74.4, cost: 57.6, pnl: 16.8, pnlPct: 29.2, contracts: 120, avgPrice: 0.48 });
    const down = positionLine({ value: 32.8, cost: 41.6, pnl: -8.8, pnlPct: -21.2, contracts: 80, avgPrice: 0.52 });
    expect(up.to).toBeLessThan(up.from);
    expect(down.to).toBeGreaterThan(down.from);
    expect(up.tone).toBe("up");
    expect(down.tone).toBe("down");
    expect(up.rate).toBeGreaterThan(down.rate);
    for (const l of [up, down])
      for (const v of [l.from, l.to]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
  });

  it("reads the return and the waterline as before (#387)", () => {
    expect(returnPct({ pnl: 10, cost: 100, pnlPct: 12.5 })).toBe(12.5);
    expect(returnPct({ pnl: 10, cost: 100, pnlPct: null })).toBeCloseTo(10);
    expect(waterline([{ pnl: 2 }, { pnl: -1 }, { pnl: 0 }])).toEqual({ above: 1, under: 1, flat: 1 });
  });
});
