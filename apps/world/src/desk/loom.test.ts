import { describe, expect, it } from "vitest";
import type { Crate } from "../foundry.ts";
import { flightEyebrow, loomFlights } from "./FoundryWeave.tsx";
import { flightEnds, LOOM_STRANDS, loomGeo, ROW_LABEL_X, rowLabelWidth, shipLabelWidth } from "./stageEngine.ts";

/** The loom shows every job in flight (#337): a strand and knot each, up to four, then "+N more". */

const job = (number: number, o: Partial<Crate> = {}): Crate => ({
  number,
  title: `Job ${number}`,
  kind: "build",
  state: "working",
  rung: null,
  url: `https://github.com/nikitapage10/C.E.O./issues/${number}`,
  updatedAt: 1_000 + number,
  pitch: "",
  size: "small",
  revising: false,
  builder: "tessellate",
  ...o,
});

describe("which jobs get a strand", () => {
  it("gives every working build its own strand, newest first", () => {
    const { shown, more } = loomFlights([job(1), job(2), job(3), job(9, { state: "queued" }), job(8, { kind: "idea", state: "queued" })]);
    expect(shown.map((c) => c.number)).toEqual([3, 2, 1]);
    expect(more).toEqual([]);
  });

  it("stops at four strands and puts the rest on +N more", () => {
    const crates = [1, 2, 3, 4, 5, 6].map((n) => job(n));
    const { shown, more, state } = loomFlights(crates);
    expect(shown).toHaveLength(LOOM_STRANDS);
    expect(more).toHaveLength(2);
    // Rusty runs four at once: the four running get the strands, the two waiting their turn go on +N more.
    expect(shown.every((c) => state(c) === "running")).toBe(true);
    expect(more.map((c) => state(c))).toEqual(["waiting", "waiting"]);
  });

  it("puts the jobs really running ahead of ones waiting or paused, however recent", () => {
    const { shown, state } = loomFlights([job(1), job(2, { paused: true, updatedAt: 9_999 })]);
    expect(shown.map((c) => c.number)).toEqual([1, 2]);
    expect(flightEyebrow(state(shown[0]!))).toBe("In flight");
    expect(flightEyebrow(state(shown[1]!))).toBe("In flight, paused for a fix");
  });

  it("has nothing in flight when nothing is working", () => {
    expect(loomFlights([job(1, { state: "shipped" })])).toMatchObject({ shown: [], more: [] });
  });
});

describe("where the knots in flight sit", () => {
  const SIZES: [number, number, boolean][] = [
    [1440, 520, false],
    [1200, 520, false],
    [900, 520, false],
    [700, 520, false],
    [390, 760, true],
  ];

  it("keeps one job in the loom's old place, on the checks line", () => {
    const g = loomGeo(false);
    expect(flightEnds(1, 1200, 520, false)).toEqual([{ x: g.st[2]! * 1200, y: g.tideB * 520 }]);
    const p = loomGeo(true);
    expect(flightEnds(1, 390, 760, true)).toEqual([{ x: p.tideB * 390, y: p.st[2]! * 760 }]);
    expect(flightEnds(0, 1200, 520, false)).toEqual([]);
  });

  it("stacks several a row apart, so no two labels or knots overlap", () => {
    for (const [W, H, phone] of SIZES) {
      for (let n = 2; n <= LOOM_STRANDS + 1; n++) {
        const ends = flightEnds(n, W, H, phone);
        expect(ends).toHaveLength(n);
        for (let i = 1; i < n; i++) {
          // A row's label is about 36 px tall and its knot's button 40 px.
          expect(ends[i]!.y - ends[i - 1]!.y).toBeGreaterThanOrEqual(40);
          expect(ends[i]!.x).toBe(ends[0]!.x);
        }
        // Inside the stage, below the column heads and above the crew along the foot.
        expect(ends[0]!.y).toBeGreaterThanOrEqual(phone ? 0.3 * H : 96);
        expect(ends.at(-1)!.y).toBeLessThanOrEqual(H - 150);
      }
    }
  });

  it("keeps the rows clear of the ideas and the shipped knot", () => {
    for (const [W, H, phone] of SIZES) {
      const g = loomGeo(phone);
      const ends = flightEnds(LOOM_STRANDS + 1, W, H, phone);
      if (phone) {
        // Below the second idea, above the ships' knot.
        expect(ends[0]!.y - g.ideaA[1]! * H).toBeGreaterThanOrEqual(48);
        expect(g.st[3]! * H - ends.at(-1)!.y).toBeGreaterThanOrEqual(48);
        continue;
      }
      // The last row's label ends above the first idea's label: they never share a line.
      expect(ends.at(-1)!.y + 18).toBeLessThan(g.ideaB[0]! * H - 21);
      // Each row's label stops short of the shipped knot's label, which is centred under it.
      const right = ends[0]!.x + ROW_LABEL_X + rowLabelWidth(ends[0]!.x, W);
      const shipLeft = g.st[3]! * W - shipLabelWidth(W) / 2;
      expect(right).toBeLessThan(shipLeft);
      expect(rowLabelWidth(ends[0]!.x, W)).toBeGreaterThanOrEqual(180);
      expect(shipLabelWidth(W) / 2).toBeLessThanOrEqual(W - g.st[3]! * W);
    }
  });
});
