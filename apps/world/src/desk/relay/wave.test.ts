import { describe, expect, it } from "vitest";
import type { TextItem } from "../texts/texts.ts";
import { queueOf } from "./thread.ts";
import { ease, WAVE_PAST, waveLook, wavePoint, waveRows, waveSpan, waveU } from "./wave.ts";

/* Relay's queue on the wave (#803). Every person and message here is made up. */

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const text = (i: number): TextItem => ({ id: `${i.toString(16).padStart(2, "0")}23456789abcdef`, name: `Sam Test ${i}`, channel: "iMessage", group: false, state: "owed", sort: "normal", since: NOW - (i + 1) * 60_000, laterUntil: null, gist: `Asks about plan ${i}`, draft: null, summary: null });
const q = queueOf([], Array.from({ length: 12 }, (_, i) => text(i)));

describe("the wave's rows", () => {
  it("holds a couple already past, the one in focus at 0, and the next ones", () => {
    const rows = waveRows(q, q[4]!.key, NOW, 5);
    expect(rows.map((r) => r.k)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5]);
    expect(rows[2]).toMatchObject({ who: "Sam Test 4", initial: "S", gist: "Asks about plan 4", age: "5 min", line: "text" });
  });

  it("starts at the first with nothing in focus, and stops at the end of the queue", () => {
    expect(waveRows(q, null, NOW, 5).map((r) => r.k)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(waveRows(q, q[11]!.key, NOW, 5).map((r) => r.k)).toEqual([-WAVE_PAST, -1, 0]);
    expect(waveRows(null, null, NOW, 5)).toEqual([]);
  });

  it("fits about one row per 64 px (58 on a phone), 3 to 9", () => {
    expect(waveSpan(100, false)).toBe(3);
    expect(waveSpan(400, false)).toBe(6);
    expect(waveSpan(400, true)).toBe(6);
    expect(waveSpan(4000, false)).toBe(9);
  });
});

describe("the wave's curve", () => {
  const box = { x: 0, y: 0, w: 600, h: 500 };

  it("puts the one in focus on the line, level, and the next ones out along the wave", () => {
    expect(waveU(0, 6)).toBe(0);
    expect(waveU(1, 6)).toBeCloseTo(0.16);
    expect(waveU(6, 6)).toBeCloseTo(1);
    expect(waveU(-1, 6)).toBeLessThan(0);
    // Desktop: the line is the box's right edge, at mid-height, whatever the time.
    expect(wavePoint(0, 0, box, false)).toEqual([600, 250]);
    expect(wavePoint(0, 7.3, box, false)).toEqual([600, 250]);
    const far = wavePoint(1, 0, box, false);
    expect(far[0]).toBeLessThan(600 - 300);
    // Phone: the line is the box's left edge, and the wave runs right.
    expect(wavePoint(0, 0, { x: 26, y: 0, w: 360, h: 78 }, true)[0]).toBe(26);
    expect(wavePoint(1, 0, { x: 26, y: 0, w: 360, h: 78 }, true)[0]).toBeGreaterThan(300);
  });

  it("drifts with time away from the line, and stays within the box", () => {
    const a = wavePoint(0.6, 0, box, false);
    const b = wavePoint(0.6, 2, box, false);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
    for (let u = 0; u <= 1; u += 0.05) {
      const [x, y] = wavePoint(u, 3.1, box, false);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(500);
    }
  });

  it("draws the far ones smaller and fainter, and fades the ones past either end", () => {
    expect(waveLook(0)).toEqual({ scale: 1, alpha: 1 });
    expect(waveLook(1).scale).toBeCloseTo(0.68);
    expect(waveLook(1).alpha).toBeCloseTo(0.5);
    expect(waveLook(-0.2).alpha).toBe(0);
    expect(waveLook(1.2).alpha).toBe(0);
  });

  it("eases toward a place and settles on it", () => {
    let v = 1;
    for (let i = 0; i < 200; i++) v = ease(v, 0.2, 1 / 60);
    expect(v).toBe(0.2);
    expect(ease(1, 0, 1)).toBe(0);
  });
});
