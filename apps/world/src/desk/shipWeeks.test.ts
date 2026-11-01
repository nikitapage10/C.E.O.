import { describe, expect, it } from "vitest";
import type { Change } from "../foundry.ts";
import { formatSpan, medianSpan, shipWeeks } from "./shipWeeks.ts";

const change = (key: string, at: number, extra: Partial<Change> = {}): Change => ({ key, at, title: `Idea: ${key}`, kind: "build", issue: { number: 1, url: `https://x/${key}` }, landed: null, by: "tessellate", short: "", approval: "auto", origin: "builder", ...extra });
// 2026-10-31 is a Saturday; its week starts Monday 2026-10-26 (Mountain time).
const now = Date.UTC(2026, 9, 31, 18);

describe("shipWeeks", () => {
  it("is empty for no changes", () => {
    expect(shipWeeks([], now)).toEqual([]);
  });
  it("starts weeks on Monday in Mountain time", () => {
    // Mon 2026-10-26 00:30 MDT = 06:30Z belongs to the new week; 05:30Z is still Sunday 25th, the week before.
    const w = shipWeeks([change("a", Date.UTC(2026, 9, 26, 6, 30)), change("b", Date.UTC(2026, 9, 26, 5, 30))], now);
    expect(w.map((x) => [x.monday, x.entries.map((e) => e.key)])).toEqual([
      ["2026-10-26", ["a"]],
      ["2026-10-19", ["b"]],
    ]);
  });
  it("orders newest week first and newest change first, and drops empty weeks", () => {
    const w = shipWeeks([change("old", Date.UTC(2026, 9, 14, 12)), change("x", Date.UTC(2026, 9, 28, 12)), change("y", Date.UTC(2026, 9, 29, 12))], now);
    expect(w.map((x) => x.monday)).toEqual(["2026-10-26", "2026-10-12"]);
    expect(w[0]!.entries.map((e) => e.key)).toEqual(["y", "x"]);
  });
  it("keeps only the last six weeks", () => {
    const w = shipWeeks([change("in", Date.UTC(2026, 8, 21, 12)), change("out", Date.UTC(2026, 8, 20, 12))], now);
    expect(w.map((x) => x.monday)).toEqual(["2026-09-21"]);
  });
  it("carries the title, short, builder and pictures", () => {
    const [w] = shipWeeks([change("a", now - 1000, { short: "Filing the week's ships", pictures: [{ src: "p.png", alt: "l", note: "" }] })], now);
    expect(w!.entries[0]).toMatchObject({ title: "A", short: "Filing the week's ships", builder: "Rusty", href: "https://x/a" });
    expect(w!.entries[0]!.pictures).toHaveLength(1);
  });
});

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("formatSpan", () => {
  it("writes minutes, hours and days short", () => {
    expect(formatSpan(42 * MIN)).toBe("42 min");
    expect(formatSpan(3 * HOUR)).toBe("3 h");
    expect(formatSpan(2 * 24 * HOUR)).toBe("2 d");
  });
  it("rounds, and never says 0 min", () => {
    expect(formatSpan(0)).toBe("1 min");
    expect(formatSpan(59.6 * MIN)).toBe("1 h");
    expect(formatSpan(23.6 * HOUR)).toBe("1 d");
    expect(formatSpan(5.4 * HOUR)).toBe("5 h");
  });
});

describe("medianSpan", () => {
  it("is null for none, the middle for odd and the mean of the middle two for even", () => {
    expect(medianSpan([])).toBeNull();
    expect(medianSpan([9, 1, 5])).toBe(5);
    expect(medianSpan([8, 2, 4, 10])).toBe(6);
  });
});

describe("shipWeeks, how long it took", () => {
  it("is closing minus opening, and null when the opening is missing", () => {
    const at = Date.UTC(2026, 9, 28, 12);
    const [w] = shipWeeks([change("a", at, { openedAt: at - 3 * HOUR }), change("b", at - 1)], now);
    expect(w!.entries.map((e) => [e.key, e.took])).toEqual([["a", 3 * HOUR], ["b", null]]);
  });
  it("takes the week's median over the changes that have a time, null when none has", () => {
    const at = Date.UTC(2026, 9, 28, 12);
    const timed = (k: string, h: number) => change(k, at, { openedAt: at - h * HOUR });
    expect(shipWeeks([timed("a", 1), timed("b", 2), timed("c", 9), change("d", at)], now)[0]!.median).toBe(2 * HOUR);
    expect(shipWeeks([timed("a", 1), timed("b", 3)], now)[0]!.median).toBe(2 * HOUR);
    expect(shipWeeks([change("d", at)], now)[0]!.median).toBeNull();
  });
});
