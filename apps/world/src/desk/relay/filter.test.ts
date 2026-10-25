import { describe, expect, it } from "vitest";
import { arrivals, densityOf, filterPaths, homeward, keepOf, rateOf, threadsOf, volumeOf } from "./filter.ts";

const day = { total: 40, handled: 30, fyi: 6, needs: 4 };

describe("Relay's filter (#429)", () => {
  it("fills and speeds the feed with the day's mail, within bounds", () => {
    expect(volumeOf(0)).toBeCloseTo(0.22);
    expect(volumeOf(10)).toBeLessThan(volumeOf(100));
    expect(volumeOf(1e6)).toBe(1);
    expect(rateOf(0)).toBeLessThan(rateOf(200));
    expect(rateOf(1e6)).toBe(58);
    expect(threadsOf(0)).toBe(1);
    expect(threadsOf(25)).toBeGreaterThan(threadsOf(3));
    expect(threadsOf(1e6)).toBe(5);
  });

  it("lets every needing mail through and thins Handled most", () => {
    expect(keepOf("needs", day)).toBe(1);
    expect(keepOf("handled", day)).toBeLessThan(keepOf("fyi", day));
    expect(keepOf("handled", day)).toBeLessThanOrEqual(0.48);
    expect(keepOf("handled", { total: 0, handled: 0, fyi: 0, needs: 0 })).toBeCloseTo(0.18);
  });

  it("carries the bulk of the feed on Handled", () => {
    expect(densityOf("handled", day)).toBeGreaterThan(densityOf("fyi", day));
    expect(densityOf("needs", day, 4)).toBeLessThan(densityOf("needs", day, 1));
    expect(densityOf("needs", day, 1)).toBeLessThanOrEqual(0.45);
    expect(densityOf("needs", day, 40)).toBeGreaterThanOrEqual(0.07);
  });

  it("runs a pulse only for what arrived since the last read", () => {
    expect(arrivals(null, day)).toEqual({ handled: 0, fyi: 0, needs: 0 });
    expect(arrivals(day, { ...day, handled: 33, needs: 3 })).toEqual({ handled: 3, fyi: 0, needs: 0 });
    expect(arrivals(day, { ...day, needs: 6 })).toEqual({ handled: 0, fyi: 0, needs: 2 });
  });

  it("feeds the sort from the source and splits it to every end", () => {
    const ends = [
      [800, 100],
      [800, 300],
      [700, 500],
    ] as const;
    const { feed, branches } = filterPaths([0, 300], [300, 300], ends, { threads: 3, spread: 100 });
    expect(feed).toHaveLength(3);
    expect(feed.map((f) => Math.round(f.ys[0]!))).toEqual([250, 300, 350]);
    feed.forEach((f) => {
      expect(f.xs[0]).toBeCloseTo(0);
      expect(f.xs.at(-1)).toBeCloseTo(300);
      expect(f.ys.at(-1)).toBeCloseTo(300);
    });
    expect(branches).toHaveLength(3);
    branches.forEach((p, i) => {
      expect(p.xs[0]).toBeCloseTo(300);
      expect(p.ys[0]).toBeCloseTo(300);
      expect(p.xs.at(-1)).toBeCloseTo(ends[i]![0]);
      expect(p.ys.at(-1)).toBeCloseTo(ends[i]![1]);
    });
  });
});

describe("Done's way home (#429)", () => {
  it("runs from the row back to the sort, then on to Handled", () => {
    const { branches } = filterPaths([0, 300], [300, 300], [
      [800, 100],
      [700, 560],
    ]);
    const home = homeward(branches[0]!, branches[1]!)!;
    expect(home.xs[0]).toBeCloseTo(800);
    expect(home.ys[0]).toBeCloseTo(100);
    expect(home.xs.at(-1)).toBeCloseTo(700);
    expect(home.ys.at(-1)).toBeCloseTo(560);
    expect(home.xs.some((x, k) => Math.hypot(x - 300, home.ys[k]! - 300) < 1)).toBe(true);
    expect(homeward({ xs: [0], ys: [0] }, branches[1]!)).toBeNull();
  });
});
