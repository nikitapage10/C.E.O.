import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../api/_haven/planShape.ts";
import { DOOR_W, glassOf, onWall, setGlass, setTv, wallSides } from "./wallEdit.ts";

/** Setting the openings wall by wall (#747), on the made-up plan. */
const plan = readPlan(FAKE_PLAN)!;
const sides = wallSides(plan);
const wall = (key: string) => sides.find((s) => s.key === key)!;

describe("the wall editor's walls (#747)", () => {
  it("lists four walls a room, the Gym left out, and knows the outside ones", () => {
    expect(sides).toHaveLength(plan.rooms.filter((r) => !r.detached).length * 4);
    expect(sides.some((s) => s.room === "gym")).toBe(false);
    expect(wall("living:e").outside).toBe(true);
    expect(wall("living:w").outside).toBe(false);
  });

  it("reads what a wall has now", () => {
    expect(glassOf(plan, wall("living:e").seg)).toMatchObject({ glass: "both", tv: false });
    expect(glassOf(plan, wall("living:w").seg)).toMatchObject({ glass: "solid", tv: true });
    expect(glassOf(plan, wall("nook:s").seg).glass).toBe("solid");
  });

  it("makes a wall solid, and only that wall", () => {
    const p = setGlass(plan, wall("living:e").seg, "solid");
    expect(glassOf(p, wall("living:e").seg).glass).toBe("solid");
    expect(glassOf(p, wall("study:e").seg).glass).toBe("both");
    expect(p.windows.length).toBeLessThan(plan.windows.length);
  });

  it("puts a balcony door at the start, middle or end, windows on the rest clear of it", () => {
    const w = wall("living:e");
    for (const at of ["start", "middle", "end"] as const) {
      const p = setGlass(plan, w.seg, "both", at);
      const g = glassOf(p, w.seg);
      expect(g).toMatchObject({ glass: "both", at });
      const [door] = onWall(p.balconies, w.seg);
      expect(door![1] - door![0]).toBe(DOOR_W);
      for (const [a, b] of onWall(p.windows, w.seg)) expect(b <= door![0] || a >= door![1]).toBe(true);
    }
  });

  it("keeps windows clear of a wall's doors", () => {
    const w = wall("living:w");
    const p = setGlass(plan, w.seg, "windows");
    const doors = onWall(p.doors, w.seg);
    expect(doors.length).toBeGreaterThan(0);
    for (const [a, b] of onWall(p.windows, w.seg)) for (const [c, d] of doors) expect(b <= c || a >= d).toBe(true);
  });

  it("moves the TV to one wall of a room at a time", () => {
    const others = sides.filter((s) => s.room === "living" && s.key !== "living:s").map((s) => s.seg);
    const p = setTv(plan, wall("living:s").seg, true, others);
    expect(glassOf(p, wall("living:s").seg).tv).toBe(true);
    expect(glassOf(p, wall("living:w").seg).tv).toBe(false);
    expect(glassOf(setTv(p, wall("living:s").seg, false), wall("living:s").seg).tv).toBe(false);
  });

  it("saves through the plan's own check", () => {
    const p = setGlass(setGlass(plan, wall("bedroom:s").seg, "both", "end"), wall("kitchen:n").seg, "solid");
    expect(readPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
