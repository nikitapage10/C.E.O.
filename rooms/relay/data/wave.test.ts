import { describe, expect, it } from "vitest";
import type { TextItem } from "./texts.ts";
import { queueOf } from "./thread.ts";
import { bell, ease, LINE, lineLayout, lineOffset, scrollPlace, waveRows } from "./wave.ts";

/* Relay's queue on the line (#803, #869). Every person and message here is made up. */

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const text = (i: number): TextItem => ({ id: `${i.toString(16).padStart(2, "0")}23456789abcdef`, name: `Sam Test ${i}`, channel: "iMessage", group: false, state: "owed", sort: "normal", since: NOW - (i + 1) * 60_000, laterUntil: null, gist: `Asks about plan ${i}`, draft: null, summary: null });
const q = queueOf([], Array.from({ length: 12 }, (_, i) => text(i)));

describe("the line's rows", () => {
  it("holds every row of the queue, each with its place from the one in focus", () => {
    const rows = waveRows(q, q[4]!.key, NOW);
    expect(rows.map((r) => r.k)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rows[4]).toMatchObject({ who: "Sam Test 4", initial: "S", gist: "Asks about plan 4", age: "5 min", line: "text" });
    expect(waveRows(null, null, NOW)).toEqual([]);
  });

  it("shows a window around the one in focus on a very long queue", () => {
    const rows = waveRows(q, q[10]!.key, NOW, 5);
    expect(rows.map((r) => r.k)).toEqual([-3, -2, -1, 0, 1]);
    expect(waveRows(q, null, NOW, 5).map((r) => r.k)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("the line's layout", () => {
  it("puts the one in focus at the centre, in order, never past the ends", () => {
    const p = lineLayout(12, 4, 0);
    expect(p[4]!.at).toBeCloseTo(0);
    for (let i = 1; i < p.length; i++) expect(p[i]!.at).toBeGreaterThan(p[i - 1]!.at);
    for (const x of p) expect(Math.abs(x.at)).toBeLessThanOrEqual(LINE.half + 0.001);
    expect(lineOffset(1000, 46, 200)).toBeLessThanOrEqual(200);
  });

  it("magnifies along a bell: the nearest largest, its neighbours less, the far ones not at all", () => {
    const p = lineLayout(12, 4, 0);
    expect(p[4]!.scale).toBeCloseTo(1 + LINE.mag);
    expect(p[3]!.scale).toBeLessThan(p[4]!.scale);
    expect(p[3]!.scale).toBeGreaterThan(1.05);
    expect(p[11]!.scale).toBeCloseTo(1, 2);
    expect(bell(0, 40)).toBe(1);
  });

  it("follows the magnifier: hovering further down magnifies the one there", () => {
    const base = lineLayout(12, 4, 0, { ...LINE, spread: 0 });
    const p = lineLayout(12, 4, base[7]!.at);
    const top = p.reduce((a, x, i) => (x.scale > p[a]!.scale ? i : a), 0);
    expect(top).toBe(7);
  });

  it("keeps the ones scrolled past on the line, fainter, never gone", () => {
    const p = lineLayout(30, 25, 0);
    for (const x of p) expect(x.alpha).toBeGreaterThanOrEqual(0.3);
    expect(p[0]!.alpha).toBeLessThan(p[24]!.alpha);
    expect(p[0]!.at).toBeLessThan(0);
  });

  it("moves the rows up the line as the scroll moves down", () => {
    expect(lineLayout(8, 3.5, 0)[4]!.at).toBeLessThan(lineLayout(8, 3, 0)[4]!.at);
  });

  it("reads the place a scroll stands at", () => {
    const tops = [0, 800, 1600, 2400];
    expect(scrollPlace(0, tops)).toBe(0);
    expect(scrollPlace(400, tops)).toBeCloseTo(0.5);
    expect(scrollPlace(1600, tops)).toBe(2);
    expect(scrollPlace(9999, tops)).toBe(3);
    expect(scrollPlace(10, [])).toBe(0);
  });

  it("eases toward a place and settles on it", () => {
    let v = 1;
    for (let i = 0; i < 200; i++) v = ease(v, 0.2, 1 / 60);
    expect(v).toBe(0.2);
    expect(ease(1, 0, 1)).toBe(0);
  });
});
