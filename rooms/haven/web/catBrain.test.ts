import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../api/_haven/planShape.ts";
import { CatBrain, FED_MS, footprints, inBox, nearestOpen, navGrid, pathOn, spotsOf } from "./catBrain.ts";
import { furnish } from "./furnish.ts";
import { roomAt } from "./data.ts";
import { wallsOf } from "./house.ts";

/** Myshka in the house (#729), on the made-up plan: the floor he walks, the doors he goes through, what sends him where. */
// As the house draws it: the made-up plan with its rooms dressed (#747).
const plan = furnish(readPlan(FAKE_PLAN)!);
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

  it("loafs by the cat trees, the cat beds and the sofas, eats at the feeders, watches the litter from a step back", () => {
    const s = spotsOf(plan, g);
    expect(s.loaf.map((p) => roomAt(plan, ...p)?.id)).toContain("living");
    const perches = plan.items.filter((i) => i.k === "cattree" || i.k === "petbed" || i.k === "sofa");
    for (const [x, y] of s.loaf) expect(perches.some((i) => Math.hypot((i.round ? i.x : i.x + i.w / 2) - x, (i.round ? i.y : i.y + i.h / 2) - y) < Math.max(i.w, i.h) / 2 + 40)).toBe(true);
    expect(s.feeders).toHaveLength(2);
    expect(s.litter && roomAt(plan, ...s.litter)?.id).toBe("hall");
  });
});

describe("Myshka and the furniture (#747)", () => {
  const boxes = footprints(plan);
  const inside = (x: number, y: number) => boxes.some((b) => inBox(x, y, b));

  it("counts every piece standing on the floor and the pets' devices, not rugs, mats or what hangs on the wall", () => {
    const kinds = new Set(plan.items.filter((i) => boxes.some((b) => b[0] === (i.round ? i.x - i.w / 2 : i.x) && b[1] === (i.round ? i.y - i.w / 2 : i.y))).map((i) => i.k));
    for (const k of ["sofa", "cattree", "island", "counter", "table", "desk"] as const) expect(kinds.has(k)).toBe(true);
    for (const k of ["rug", "mat", "tv", "upper", "petbed"] as const) expect(kinds.has(k)).toBe(false);
    expect(boxes.length).toBeGreaterThan(plan.items.filter((i) => i.k === "sofa").length + 4);
  });

  it("never stands on a cell inside a footprint", () => {
    for (let i = 0; i < g.open.length; i++) {
      if (!g.open[i]) continue;
      expect(inside(((i % g.cols) + 0.5) * g.cell, (Math.floor(i / g.cols) + 0.5) * g.cell)).toBe(false);
    }
  });

  it("walks round the furniture: no point of any path, legs included, lies inside a footprint", () => {
    const b = new CatBrain(g, plan, false, seq([0.37, 0.71, 0.13, 0.92, 0.55]));
    const targets = [...b.spots.loaf, ...b.spots.feeders, ...(b.spots.litter ? [b.spots.litter] : [])];
    const floor = b.spots.floor;
    for (let k = 0; k < 40; k++) targets.push([((floor[(k * 7919) % floor.length]! % g.cols) + 0.5) * g.cell, (Math.floor(floor[(k * 7919) % floor.length]! / g.cols) + 0.5) * g.cell]);
    let legs = 0;
    for (const from of targets)
      for (const to of targets.slice(0, 12)) {
        const path = pathOn(g, from, to);
        if (!path) continue;
        for (let i = 0; i < path.length; i++) {
          expect(inside(...path[i]!)).toBe(false);
          if (!i) continue;
          const [ax, ay] = path[i - 1]!, [bx, by] = path[i]!;
          const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 2);
          for (let j = 0; j <= n; j++) expect(inside(ax + ((bx - ax) * j) / Math.max(1, n), ay + ((by - ay) * j) / Math.max(1, n))).toBe(false);
          legs++;
        }
      }
    expect(legs).toBeGreaterThan(100);
  }, 15_000);

  it("wanders and sits only on free floor", () => {
    const b = new CatBrain(g, plan, false, seq([0.5, 0.6, 0.2, 0.9, 0.1, 0.4]));
    for (let t = 0; t < 4000; t++) {
      const p = b.update(t * 100, 0.1);
      expect(inside(p.x, p.y)).toBe(false);
    }
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
    const p = run(b, 0, 25);
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
