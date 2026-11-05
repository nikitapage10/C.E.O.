import { describe, expect, it } from "vitest";
import { GRID, LATTICE_C, pointOn, rgbOf, ROOM_SIGILS, seats, sigilOf, sigilPath, strokeLength } from "./roomSigils.ts";
// The Desk's pages (route.ts NAV_ORDER); the engine imports no app code, so they are listed here.
const PAGES = ["today", "haven", "foundry", "relay", "archive", "spire", "exchange", "green", "workshop", "studio", "annex", "boiler"];
const rng = (seed: number) => {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

describe("room sigils (#752)", () => {
  it("every Desk page has its own sigil, and no two are the same", () => {
    for (const page of PAGES) expect(ROOM_SIGILS[page], page).toBeDefined();
    const paths = Object.values(ROOM_SIGILS).map(sigilPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("draws on the 48 grid, with at least one gold node", () => {
    for (const [id, s] of Object.entries({ ...ROOM_SIGILS, lattice: LATTICE_C })) {
      expect(s.nodes.length, id).toBeGreaterThan(0);
      for (const p of [...s.strokes.flat(), ...s.nodes]) {
        expect(p[0], id).toBeGreaterThanOrEqual(0);
        expect(p[0], id).toBeLessThanOrEqual(GRID);
        expect(p[1], id).toBeGreaterThanOrEqual(0);
        expect(p[1], id).toBeLessThanOrEqual(GRID);
      }
      for (const st of s.strokes) expect(strokeLength(st), id).toBeGreaterThan(0);
    }
  });

  it("falls back to the Lattice C", () => {
    expect(sigilOf("nowhere")).toBe(LATTICE_C);
    expect(sigilOf("haven")).toBe(ROOM_SIGILS.haven);
  });

  it("finds a point along a stroke by length", () => {
    const s = [
      [0, 0],
      [10, 0],
      [10, 10],
    ] as const;
    expect(pointOn(s, 0)).toEqual([0, 0]);
    expect(pointOn(s, 0.5)).toEqual([10, 0]);
    expect(pointOn(s, 0.75)).toEqual([10, 5]);
    expect(pointOn(s, 1)).toEqual([10, 10]);
    expect(pointOn(s, 2)).toEqual([10, 10]);
  });

  it("spreads the motes' seats over the strokes by length", () => {
    const sig = { strokes: [[[0, 0], [30, 0]], [[0, 10], [10, 10]]], nodes: [[0, 0]] } as const;
    const got = seats(sig, 400, rng(3));
    expect(got).toHaveLength(400);
    const onLong = got.filter((s) => s.stroke === 0).length;
    expect(onLong).toBeGreaterThan(280);
    expect(onLong).toBeLessThan(320);
    for (const s of got) {
      expect(s.u).toBeGreaterThanOrEqual(0);
      expect(s.u).toBeLessThanOrEqual(1);
    }
    expect(seats(sig, 0)).toEqual([]);
  });

  it("reads the accent as r,g,b", () => {
    expect(rgbOf(" #f0c987")).toBe("240,201,135");
    expect(rgbOf("#abc")).toBe("170,187,204");
    expect(rgbOf("rgb(124, 205, 172)")).toBe("124,205,172");
    expect(rgbOf("")).toBe("159,210,255");
  });
});
