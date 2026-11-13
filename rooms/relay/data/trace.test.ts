import { describe, expect, it } from "vitest";
import { lengthOf, outline, pointAlong, traceCount, traceStops, TRACE_MS } from "./trace.ts";

/* The border trace on an opening message (#1162). Numbers only. */

const box = outline(100, 50, 600, 200, 0);

describe("outline", () => {
  it("runs from the spine's top corner along the top, down the far side and back along the foot", () => {
    expect(box).toEqual([
      { x: 100, y: 50 },
      { x: 700, y: 50 },
      { x: 700, y: 250 },
      { x: 100, y: 250 },
    ]);
    expect(lengthOf(box)).toBe(600 + 200 + 600);
  });
  it("stays inside a box too small for its inset", () => {
    const p = outline(0, 0, 4, 4, 6);
    expect(lengthOf(p)).toBeGreaterThanOrEqual(0);
    expect(p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
  });
});

describe("pointAlong", () => {
  it("starts at the corner and clamps at both ends", () => {
    expect(pointAlong(box, -5)).toEqual({ x: 100, y: 50 });
    expect(pointAlong(box, 1e6)).toEqual({ x: 100, y: 250 });
  });
  it("follows each edge in turn", () => {
    expect(pointAlong(box, 300)).toEqual({ x: 400, y: 50 });
    expect(pointAlong(box, 700)).toEqual({ x: 700, y: 150 });
    expect(pointAlong(box, 1100)).toEqual({ x: 400, y: 250 });
  });
  it("copes with an empty or single-point path", () => {
    expect(pointAlong([], 10)).toEqual({ x: 0, y: 0 });
    expect(pointAlong([{ x: 3, y: 4 }], 10)).toEqual({ x: 3, y: 4 });
  });
});

describe("the sigils", () => {
  it("are few and capped", () => {
    expect(traceCount(0)).toBe(0);
    expect(traceCount(1400)).toBeGreaterThan(20);
    expect(traceCount(1e6)).toBe(56);
  });
  it("each stop is further along than the last, the last at the path's end", () => {
    const s = traceStops(1400, 10);
    expect(s).toHaveLength(10);
    expect(s.at(-1)).toBe(1400);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });
  it("finishes in about half a second", () => {
    expect(TRACE_MS).toBeLessThanOrEqual(600);
  });
});
