import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../../../api/_haven/planShape.ts";
import type { HavenPlan, PlanItem } from "./data.ts";
import { furnish, mainRect } from "./furnish.ts";
import { KIND_STYLE } from "./style.ts";

/** The main rooms dressed by rule (#747), on the made-up plan: nothing here is anyone's real home. */
const base = readPlan(FAKE_PLAN)!;
const plan = furnish(base);
const room = (id: string) => plan.rooms.find((r) => r.id === id)!;
const boxOf = (i: PlanItem): [number, number, number, number] => (i.round ? [i.x - i.w / 2, i.y - i.w / 2, i.x + i.w / 2, i.y + i.w / 2] : [i.x, i.y, i.x + i.w, i.y + i.h]);
const mid = (i: PlanItem): [number, number] => (i.round ? [i.x, i.y] : [i.x + i.w / 2, i.y + i.h / 2]);
const inRoom = (id: string) => (i: PlanItem) => {
  const [x, y] = mid(i);
  return room(id).parts.some(([px, py, w, h]) => x >= px && x <= px + w && y >= py && y <= py + h);
};
const solid = (i: PlanItem) => KIND_STYLE[i.k].height > 2 && KIND_STYLE[i.k].lift < 20;

describe("dressing the rooms (#747)", () => {
  it("keeps every dressed piece inside its room, and no two standing pieces in one footprint", () => {
    for (const id of ["living", "study", "bath"]) {
      const R = mainRect(room(id));
      const list = plan.items.filter(inRoom(id));
      expect(list.length).toBeGreaterThan(3);
      for (const i of list) {
        const [x0, y0, x1, y1] = boxOf(i);
        expect(x0).toBeGreaterThanOrEqual(R[0] - 1);
        expect(y0).toBeGreaterThanOrEqual(R[1] - 1);
        expect(x1).toBeLessThanOrEqual(R[0] + R[2] + 1);
        expect(y1).toBeLessThanOrEqual(R[1] + R[3] + 1);
      }
      const st = list.filter(solid);
      for (let a = 0; a < st.length; a++)
        for (let b = a + 1; b < st.length; b++) {
          const p = boxOf(st[a]!), q = boxOf(st[b]!);
          const hit = p[0] < q[2] - 1 && p[2] > q[0] + 1 && p[1] < q[3] - 1 && p[3] > q[1] + 1;
          expect(hit, `${id}: ${st[a]!.k} and ${st[b]!.k}`).toBe(false);
        }
    }
  });

  it("hangs the living room's TV on the wall the plan names, over its console, the sectional facing it", () => {
    const list = plan.items.filter(inRoom("living"));
    const tv = list.find((i) => i.k === "tv")!;
    expect(tv.x).toBe(600);
    expect(list.find((i) => i.k === "console")!.x).toBeLessThan(650);
    expect(list.filter((i) => i.k === "sofa")).toHaveLength(2);
    for (const k of ["rug", "ctable", "lamp", "minifridge", "projector", "cattree"] as const) expect(list.some((i) => i.k === k)).toBe(true);
  });

  it("without a named TV wall, puts it on a wall with no glass", () => {
    const p = furnish({ ...base, tv: [] });
    const tv = p.items.filter(inRoom("living")).find((i) => i.k === "tv")!;
    const onGlass = [...p.windows, ...p.balconies].some((s) => (s[0] === s[2] ? Math.abs(s[0] - tv.x) < 10 || Math.abs(s[0] - (tv.x + tv.w)) < 10 : Math.abs(s[1] - tv.y) < 10 || Math.abs(s[1] - (tv.y + tv.h)) < 10));
    expect(onGlass).toBe(false);
  });

  it("stands the living room's cat tree in the corner by the balcony door", () => {
    const tree = plan.items.filter(inRoom("living")).find((i) => i.k === "cattree")!;
    const [, a, , b] = base.balconies[0]!;
    expect(Math.abs(tree.x - 960)).toBeLessThan(60);
    expect(Math.min(Math.abs(tree.y - a), Math.abs(tree.y - b))).toBeLessThan(80);
  });

  it("lays out the studio: no printer, the desk on the window wall with two screens and a chair, the sofas in an L", () => {
    const list = plan.items.filter(inRoom("study"));
    expect(list.some((i) => i.k === "printer")).toBe(false);
    const desk = list.find((i) => i.k === "desk")!;
    expect(desk.x + desk.w).toBeGreaterThan(950);
    expect(list.filter((i) => i.k === "monitor")).toHaveLength(2);
    expect(list.filter((i) => i.k === "speaker")).toHaveLength(2);
    for (const k of ["ochair", "shelf", "dj"] as const) expect(list.some((i) => i.k === k)).toBe(true);
    expect(list.filter((i) => i.k === "sofa").length).toBeGreaterThanOrEqual(1);
  });

  it("dresses a single bath as the guest bath (vanity, toilet, tub), two baths with the bigger as the master", () => {
    const guest = plan.items.filter(inRoom("bath")).map((i) => i.k);
    for (const k of ["vanity", "wc", "tub", "towelbar"] as const) expect(guest).toContain(k);
    expect(guest).not.toContain("shower");
    const two: HavenPlan = furnish({
      ...base,
      rooms: [...base.rooms.map((r) => (r.id === "bedroom" ? { ...r, parts: [[220, 460, 240, 340] as [number, number, number, number]] } : r)), { id: "mbath", name: "Bath 2", parts: [[460, 460, 200, 340]], floor: "tile", tab: null, vacuum: null, detached: false }],
      doors: [...base.doors, [460, 520, 460, 610]],
    });
    const m = two.items.filter((i) => {
      const [x, y] = mid(i);
      return x >= 460 && x <= 660 && y >= 460 && y <= 800;
    }).map((i) => i.k);
    for (const k of ["shower", "vanity", "wc", "litterbox"] as const) expect(m).toContain(k);
    expect(m).not.toContain("tub");
  });

  it("puts a coat rack by the front door, the raised bowls at the end of the feeding row, a tub chair in the dining area", () => {
    const rack = plan.items.find((i) => i.k === "coatrack")!;
    expect(rack.y).toBeLessThan(90);
    const bowls = plan.items.find((i) => i.k === "bowls")!;
    expect(mid(bowls)[0]).toBeGreaterThan(500);
    expect(Math.abs(mid(bowls)[1] - 446)).toBeLessThan(5);
    expect(plan.items.filter(inRoom("nook")).some((i) => i.k === "tubchair")).toBe(true);
  });

  it("gives a balcony door in any other room its nook: a greenhouse, a cat bed, the purifier under the window", () => {
    const p = furnish({ ...base, rooms: base.rooms.map((r) => (r.id === "study" ? { ...r, name: "Bedroom 2" } : r)) });
    const list = p.items.filter((i) => {
      const [x, y] = mid(i);
      return x >= 660 && y >= 460 && y <= 800;
    }).map((i) => i.k);
    for (const k of ["greenhouse", "petbed", "purifier"] as const) expect(list).toContain(k);
  });

  it("leaves the stored plan alone", () => {
    expect(readPlan(FAKE_PLAN)).toEqual(base);
    expect(plan.rooms).toBe(base.rooms);
  });
});
