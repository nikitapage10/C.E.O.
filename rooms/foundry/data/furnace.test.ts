import { describe, expect, it } from "vitest";
import type { Crate, OpenPr } from "../../../apps/world/src/foundry.ts";
import { forgeLanes, type Stage } from "./forge.ts";
import { coilState, furnaceOf, heatOf, heightOf, mainCoil, SHAFT, trailStep } from "./furnace.ts";

/** The Deep Furnace (#813): where each job hangs in the shaft, how its coils read, and who stands at which slot. */

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
const pr = (number: number, issue: number, checks: OpenPr["checks"]): OpenPr => ({ number, url: `https://github.com/x/pull/${number}`, at: 5_000, draft: false, issue, checks });

const ORDER: Stage[] = ["waiting", "paused", "building", "pr", "checks", "green", "ready"];

describe("how high a job hangs", () => {
  it("rises from the crucible to the hatch as it gets built", () => {
    const hs = ORDER.map((s) => heightOf(s));
    for (let i = 1; i < hs.length; i++) expect(hs[i]!).toBeGreaterThan(hs[i - 1]!);
    expect(hs[0]).toBe(0);
    expect(hs.at(-1)!).toBeLessThan(SHAFT.ship);
  });

  it("climbs the work deck once its branch is pushed", () => {
    expect(heightOf("building", { step: 2 })).toBeGreaterThan(heightOf("building", { step: 1 }));
    expect(heightOf("building", { step: 2 })).toBeLessThan(SHAFT.pictures);
  });

  it("hangs inside the coils while its checks run, and drops below them when they're red", () => {
    expect(heightOf("checks")).toBeGreaterThan(SHAFT.coils[0]);
    expect(heightOf("checks")).toBeLessThan(SHAFT.coils[4]);
    expect(heightOf("red")).toBeLessThan(SHAFT.coils[0]);
    expect(heightOf("red")).toBeGreaterThan(SHAFT.pictures);
  });

  it("cools as it rises", () => {
    expect(heatOf(0)).toBe(1);
    expect(heatOf(heightOf("green"))).toBeLessThan(heatOf(heightOf("pr")));
    expect(heatOf(SHAFT.ship)).toBe(0);
  });
});

describe("the Trail and the five coils", () => {
  it("puts each stage on Work, Pictures, Checks or Ship", () => {
    expect(["building", "stuck", "paused", "waiting"].map((s) => trailStep(s as Stage))).toEqual([0, 0, 0, 0]);
    expect(trailStep("pr")).toBe(1);
    expect(trailStep("checks")).toBe(2);
    expect(trailStep("red")).toBe(2);
    expect(trailStep("green")).toBe(3);
  });

  it("lights the coils from the pull request's checks", () => {
    expect(coilState("building")).toBe("wait");
    expect(coilState("checks")).toBe("run");
    expect(coilState("red")).toBe("fail");
    expect(coilState("green")).toBe("pass");
    expect(mainCoil("unknown")).toBe("wait");
    expect(mainCoil("fail")).toBe("fail");
  });
});

describe("the slots", () => {
  it("keeps each of Rusty's hands at its own slot, with the free ones asleep in their bays", () => {
    const { lanes, more } = forgeLanes([job(1), job(2)]);
    const f = furnaceOf(lanes, more);
    expect(f.slots.map((s) => [s.hand, s.lane?.crate.number ?? null])).toEqual([
      ["Rusty", 1],
      ["Dusty", 2],
      ["Gusty", null],
      ["Musty", null],
    ]);
  });

  it("puts Rivet on her own hoist outside the four, and Rocky at the first free slot", () => {
    const crates = [job(1), job(2, { builder: "caret" }), job(3, { kind: "upkeep", builder: "semicolon" })];
    const { lanes, more } = forgeLanes(crates, [pr(9, 1, "running")]);
    const f = furnaceOf(lanes, more);
    expect(f.rivet.map((l) => l.crate.number)).toEqual([3]);
    expect(f.slots.map((s) => s.hand)).toEqual(["Rusty", "Rocky", "Gusty", "Musty"]);
    expect(f.slots[0]!.lane!.stage).toBe("checks");
  });

  it("counts the jobs past the four", () => {
    const { lanes, more } = forgeLanes([1, 2, 3, 4, 5, 6].map((n) => job(n)));
    const f = furnaceOf(lanes, more);
    expect(f.slots.every((s) => s.lane)).toBe(true);
    expect(f.more).toHaveLength(2);
  });
});
