import { describe, expect, it } from "vitest";
import { Poly } from "../wvCanvas.ts";
import { capCounts, converge, fan, FIELD_MAX, flowCount, LINE_MAX, nearestLine, passes, polyOf, pulseU, samplePath, type Pt } from "./path.ts";

const ends = (xs: number[], ys: number[]) => [xs[0], ys[0], xs.at(-1), ys.at(-1)];

describe("flow paths", () => {
  it("runs a from/to line exactly from one point to the other, bowed to the left of travel", () => {
    const [xs, ys] = samplePath({ from: [0, 100], to: [200, 100], bend: 0.2 });
    expect(ends(xs, ys)).toEqual([0, 100, 200, 100]);
    // Travelling right on screen (y down), left is up: the middle sits above the chord.
    expect(Math.min(...ys)).toBeLessThan(80);
    const [, flat] = samplePath({ from: [0, 100], to: [200, 100], bend: 0 });
    expect(flat.every((y) => Math.abs(y - 100) < 1e-9)).toBe(true);
  });
  it("samples densely enough to hit-test, and never unboundedly", () => {
    const [xs] = samplePath({ from: [0, 0], to: [600, 0], bend: 0 });
    expect(xs.length).toBeGreaterThanOrEqual(100);
    const [big] = samplePath({ from: [0, 0], to: [100000, 0] });
    expect(big.length).toBeLessThanOrEqual(400);
  });
  it("passes through every via point, straight or smoothed", () => {
    const via: Pt[] = [[0, 0], [100, 50], [200, 0]];
    for (const smooth of [true, false]) {
      const [xs, ys] = samplePath({ via, smooth });
      for (const [x, y] of via) expect(xs.some((v, i) => Math.hypot(v - x, ys[i]! - y) < 1e-6)).toBe(true);
    }
  });
  it("measures arc length", () => {
    expect(polyOf({ via: [[0, 0], [300, 400]], smooth: false }).len).toBeCloseTo(500, 2);
  });
  it("fans one source out along a shared trunk to each end", () => {
    const from: Pt = [0, 0];
    const tos: Pt[] = [[400, -100], [400, 0], [400, 100]];
    const ps = fan(from, tos, { trunk: 0.5 }) as { xs: number[]; ys: number[] }[];
    expect(ps).toHaveLength(3);
    ps.forEach((p, i) => {
      expect([p.xs[0], p.ys[0]]).toEqual([0, 0]);
      expect(p.xs.at(-1)).toBeCloseTo(tos[i]![0]);
      expect(p.ys.at(-1)).toBeCloseTo(tos[i]![1]);
    });
    // The trunk (to 200, 0) is the same for every branch.
    const k = ps[0]!.xs.findIndex((x) => x >= 199.99);
    expect(k).toBeGreaterThan(0);
    for (const p of ps) for (let i = 0; i <= k; i++) {
      expect(p.xs[i]).toBeCloseTo(ps[0]!.xs[i]!);
      expect(p.ys[i]).toBeCloseTo(ps[0]!.ys[i]!);
    }
    // The branches leave the trunk without a kink: the first step after it keeps going right.
    for (const p of ps) expect(p.xs[k + 1]!).toBeGreaterThan(p.xs[k]!);
  });
  it("converges several sources into one end", () => {
    const ps = converge([[0, 0], [0, 200]], [300, 100]) as { xs: number[]; ys: number[] }[];
    expect([ps[0]!.xs[0], ps[0]!.ys[0]]).toEqual([0, 0]);
    expect([ps[1]!.xs[0], ps[1]!.ys[0]]).toEqual([0, 200]);
    for (const p of ps) expect([p.xs.at(-1), p.ys.at(-1)]).toEqual([300, 100]);
  });
  it("fans out to nothing when there are no ends", () => {
    expect(fan([0, 0], [])).toEqual([]);
  });
});

describe("flow counts", () => {
  it("carries more on a longer, denser line, within the caps", () => {
    expect(flowCount(600, 1)).toBe(100);
    expect(flowCount(600, 0.5)).toBe(50);
    expect(flowCount(600, 1, true)).toBe(55);
    expect(flowCount(10, 0)).toBe(4);
    expect(flowCount(1e6, 1)).toBe(LINE_MAX);
    expect(flowCount(-5, 2)).toBe(4);
  });
  it("scales a whole field down together to stay under its cap", () => {
    expect(capCounts([10, 20])).toEqual([10, 20]);
    const many = capCounts(Array.from({ length: 20 }, () => 240));
    expect(many.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(FIELD_MAX);
    expect(new Set(many).size).toBe(1);
  });
  it("lets an even share through a filter, the same particles every time", () => {
    const kept = Array.from({ length: 1000 }, (_, i) => passes(i, 0.25)).filter(Boolean).length;
    expect(kept).toBeGreaterThan(230);
    expect(kept).toBeLessThan(270);
    expect(passes(7, 0.25)).toBe(passes(7, 0.25));
    expect(Array.from({ length: 50 }, (_, i) => passes(i, 1)).every(Boolean)).toBe(true);
    expect(Array.from({ length: 50 }, (_, i) => passes(i, 0)).some(Boolean)).toBe(false);
  });
});

describe("pulses and hits", () => {
  it("runs a pulse along its line once", () => {
    expect(pulseU(10, 10, 100, 200)).toBe(0);
    expect(pulseU(10, 11, 100, 200)).toBeCloseTo(0.5);
    expect(pulseU(10, 13, 100, 200)).toBeNull();
    expect(pulseU(10, 9, 100, 200)).toBeNull();
  });
  it("finds the nearest line within the tolerance", () => {
    const a = { id: "a", poly: polyOf({ via: [[0, 0], [200, 0]], smooth: false }) };
    const b = { id: "b", poly: polyOf({ via: [[0, 40], [200, 40]], smooth: false }) };
    expect(nearestLine([a, b], 100, 6)?.id).toBe("a");
    expect(nearestLine([a, b], 100, 33)?.id).toBe("b");
    expect(nearestLine([a, b], 100, 20, 10)).toBeNull();
    expect(nearestLine([a, b], 50, 2)!.u).toBeCloseTo(0.25, 1);
    expect(nearestLine([{ id: "x", poly: new Poly() }], 0, 0)).toBeNull();
  });
});
