import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../../../api/_haven/planShape.ts";
import { CatBrain, FED_MS, nearestOpen, navGrid, pathOn, spotsOf } from "./catBrain.ts";
import { roomAt } from "./data.ts";
import { wallsOf } from "./house.ts";

/** Myshka in the house (#729), on the made-up plan: the floor he walks, the doors he goes through, what sends him where. */
const plan = readPlan(FAKE_PLAN)!;
const g = navGrid(plan, wallsOf(plan));
const seq = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};
const run = (b: CatBrain, from: number, secs: number) => {
  let p = b.update(from, 0);
  for (let t = 0; t < secs * 10; t++) p = b.update(from + t * 100, 0.1);
  return p;
};

describe("Myshka's floor (#729)", () => {
  it("is the home's rooms, clear of the walls, never the Gym out back", () => {
    let n = 0;
    for (let i = 0; i < g.open.length; i++) {
      if (!g.open[i]) continue;
      n++;
      const x = ((i % g.cols) + 0.5) * g.cell, y = (Math.floor(i / g.cols) + 0.5) * g.cell;
      expect(roomAt(plan, x, y)?.detached).toBe(false);
    }
    expect(n).toBeGreaterThan(200);
  });

  it("walks room to room through the doors, in a few straight legs that stay on the floor", () => {
    const path = pathOn(g, [100, 300], [800, 650])!; // Hall to the Study
    expect(path.length).toBeGreaterThan(2);
    expect(path.length).toBeLessThan(12);
    expect(roomAt(plan, ...path.at(-1)!)?.id).toBe("study");
    for (const p of path) expect(g.open[nearestOpen(g, p[0], p[1], 0)]).toBe(1);
  });

  it("loafs in the Living room (its cat tree), eats at the feeders, watches the litter from a step back", () => {
    const s = spotsOf(plan, g);
    expect(s.loaf.map((p) => roomAt(plan, ...p)?.id)).toEqual(["living"]);
    expect(s.feeders).toHaveLength(2);
    expect(s.litter && roomAt(plan, ...s.litter)?.id).toBe("hall");
  });
});

describe("Myshka's day (#729)", () => {
  it("goes to the feeders after a feed and stays a while, once per feed", () => {
    const b = new CatBrain(g, plan, false, seq([0.5, 0.9, 0.1]));
    const now = 1_000_000;
    b.setSignals({ fedAt: now - 60_000, litterCycling: false });
    const p = run(b, now, 30);
    const near = b.spots.feeders.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 1);
    expect(near).toBe(true);
    expect(p.mode).toBe("sit");
    // An old feed sends him nowhere.
    const c = new CatBrain(g, plan, false, seq([0.5]));
    c.setSignals({ fedAt: now - FED_MS - 1, litterCycling: false });
    expect(run(c, now, 5).mode).toBe("nap");
  });

  it("heads to the litter corner during a cycle", () => {
    const b = new CatBrain(g, plan, false, seq([0.5]));
    b.setSignals({ fedAt: null, litterCycling: true });
    const p = run(b, 0, 40);
    expect(Math.hypot(p.x - b.spots.litter![0], p.y - b.spots.litter![1])).toBeLessThan(1);
  });

  it("sits still in his loaf under reduced motion, whatever happens", () => {
    const b = new CatBrain(g, plan, true, seq([0.5]));
    const first = b.update(0, 0);
    b.setSignals({ fedAt: 0, litterCycling: true });
    const later = run(b, 0, 30);
    expect(later).toEqual({ ...first, speed: 0 });
    expect(later.mode).toBe("nap");
  });
});
