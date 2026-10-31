import { describe, expect, it } from "vitest";
import type { Change } from "../foundry.ts";
import { shipWeeks } from "./shipWeeks.ts";

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
