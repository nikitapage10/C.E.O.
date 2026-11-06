import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../api/_haven/planShape.ts";
import type { HavenPlan, PlanItem } from "./data.ts";
import { BALCONY_DOOR, furnish, mainRect, withOpenings } from "./furnish.ts";
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

describe("dressing the rooms (#747, #764)", () => {
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

  it("with a Gym, hangs the TV on the solid wall nearest it even when another wall was saved (#860)", () => {
    const named = furnish(base).items.filter(inRoom("living")).find((i) => i.k === "tv")!;
    const fresh = furnish({ ...base, tv: [] }).items.filter(inRoom("living")).find((i) => i.k === "tv")!;
    expect([named.x, named.y, named.w, named.h]).toEqual([fresh.x, fresh.y, fresh.w, fresh.h]);
  });

  it("without a Gym, hangs the living room's TV on the wall the plan names, over its console, the sectional facing it", () => {
    const list = furnish({ ...base, rooms: base.rooms.filter((r) => r.id !== "gym") }).items.filter(inRoom("living"));
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

  it("stands the only cat tree in the living room: none in the studio or anywhere else", () => {
    const trees = plan.items.filter((i) => i.k === "cattree");
    expect(trees).toHaveLength(1);
    expect(inRoom("living")(trees[0]!)).toBe(true);
  });

  it("stands the studio's DJ decks in the right-hand corner as you walk in, not by the door", () => {
    // The made-up study's door is on its west wall (x 660, y 560 to 660): walking in, the right-hand wall is the south.
    const dj = plan.items.filter(inRoom("study")).find((i) => i.k === "dj")!;
    const [x, y] = mid(dj);
    expect(Math.hypot(x - 660, y - 610)).toBeGreaterThan(150);
    expect(y).toBeGreaterThan(700);
  });

  it("puts the fridge at the left end of the cabinet run, the espresso machine on the counter, and no sideboard", () => {
    // The made-up kitchen's run is on its north wall: looking at it, left is west. The stored fridge stood at the east.
    // With no dining room of its own, the coffee stays on the counter (#860).
    const p = furnish({ ...base, rooms: base.rooms.filter((r) => r.id !== "nook") });
    const k = p.items.filter(inRoom("kitchen"));
    const fridge = k.find((i) => i.k === "fridge")!, counter = k.find((i) => i.k === "counter")!;
    expect(fridge.x).toBeLessThan(counter.x);
    expect(fridge.x).toBeGreaterThanOrEqual(220);
    // The sink and the hob moved over with the run.
    for (const kind of ["sink", "range"] as const) {
      const was = base.items.find((i) => i.k === kind)!, now = k.find((i) => i.k === kind)!;
      expect(now.x).toBeGreaterThan(was.x);
    }
    const esp = k.find((i) => i.k === "espresso")!;
    const [ex, ey] = mid(esp);
    expect(ex).toBeGreaterThan(counter.x);
    expect(ex).toBeLessThan(counter.x + counter.w);
    expect(ey).toBeGreaterThan(counter.y);
    expect(ey).toBeLessThan(counter.y + counter.h);
    expect(p.items.some((i) => i.k === "sideboard")).toBe(false);
    // Loose jars (the bottles) are gone with it.
    expect(k.some((i) => i.k === "jar")).toBe(false);
  });

  it("hangs five tall canvases on the wall across from the cabinets, where the doors leave room", () => {
    // The made-up dining door takes most of that wall; with a narrower one the canvases fit beside it.
    expect(plan.items.some((i) => i.k === "art")).toBe(false);
    const roomy = furnish({ ...base, doors: base.doors.map((d) => (d[1] === 320 && d[3] === 320 ? ([420, 320, 520, 320] as typeof d) : d)) });
    const art = roomy.items.filter((i) => i.k === "art");
    expect(art).toHaveLength(1);
    const a = art[0]!;
    // The run is on the kitchen's north wall (y 40); across is its south wall (y 320).
    expect(Math.abs(a.y + a.h - 320)).toBeLessThanOrEqual(2);
    expect(a.w).toBeGreaterThanOrEqual(110);
    expect(KIND_STYLE.art.height).toBeGreaterThan(a.w / 5);
    // It hangs under the top of the cut-down walls (140 plan units), never over the edge (#892).
    expect(KIND_STYLE.art.lift + KIND_STYLE.art.height).toBeLessThanOrEqual(135);
    // Clear of the door into the dining area (x 420 to 520), and inside the kitchen's wall.
    expect(a.x + a.w).toBeLessThanOrEqual(410);
    expect(a.x).toBeGreaterThanOrEqual(220);
  });

  it("draws the kitchen and the hall as one open space: their shared edge is open", () => {
    expect(plan.doors).toContainEqual([220, 40, 220, 320]);
    expect(base.doors).not.toContainEqual([220, 40, 220, 320]);
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

  it("with a door across the back wall, stands the coffee station on the next free wall; the espresso leaves the counter (#860)", () => {
    for (const p of [plan, furnish({ ...base, windows: [], balconies: [], tv: [], openings: undefined })]) {
      const d = p.items.filter(inRoom("nook"));
      const board = d.find((i) => i.k === "sideboard")!, esp = d.find((i) => i.k === "espresso")!;
      // The made-up dining room's back wall (y 320) is mostly a door, so the station stands against another wall.
      const R = room("nook").parts[0]!;
      expect(board.x <= R[0] + 6 || board.x + board.w >= R[0] + R[2] - 6 || board.y + board.h >= R[1] + R[3] - 6).toBe(true);
      const [ex, ey] = mid(esp);
      expect(ex).toBeGreaterThan(board.x);
      expect(ex).toBeLessThan(board.x + board.w);
      expect(ey).toBeGreaterThan(board.y);
      expect(ey).toBeLessThan(board.y + board.h);
      // Behind the table, clear of it and of the feeding station.
      const table = d.find((i) => i.k === "table")!;
      const overlap = (a: PlanItem, b: PlanItem) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      expect(overlap(board, table)).toBe(false);
      expect(p.items.filter((i) => i.k === "espresso")).toHaveLength(1);
    }
  });

  it("stands the coffee station on the dining room's back wall, the TV's side, stepping the table out for it (Nikita 2026-11-05 21:09Z)", () => {
    // A deeper made-up dining room whose back wall (y 320, the living room TV's side, away from the Gym) has no door.
    const rooms = base.rooms.filter((r) => r.id !== "bedroom").map((r) => (r.id === "nook" ? { ...r, parts: [[220, 320, 380, 260]] as typeof r.parts } : r));
    // The living room's north wall solid too, so the TV hangs there and the dining room's matching wall takes the station.
    const p = furnish({ ...base, rooms, tv: [], windows: base.windows.filter((w) => !(w[1] === 40 && w[0] >= 600)), doors: base.doors.filter((d) => !(d[1] === 320 && d[3] === 320)) });
    const d = p.items.filter(inRoom("nook"));
    const board = d.find((i) => i.k === "sideboard")!, table = d.find((i) => i.k === "table")!;
    expect(board.y).toBeLessThan(330);
    expect(table.y).toBeGreaterThanOrEqual(board.y + board.h + 40);
    expect(p.items.filter((i) => i.k === "espresso")).toHaveLength(1);
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

  describe("with no windows, balcony doors or TV wall saved (#764)", () => {
    const bare: HavenPlan = { ...base, windows: [], balconies: [], tv: [], openings: undefined };
    // Imported openings that were never set in the editor are not trusted: the defaults replace them.
    const imported = furnish({ ...base, openings: undefined });
    const got = furnish(bare);
    const on = (segs: number[][], x0: number, y0: number, x1: number, y1: number) => segs.filter((s) => s[0]! >= x0 && s[2]! <= x1 && s[1]! >= y0 && s[3]! <= y1);

    it("runs the living room's balcony the whole length of its longest outside wall (#806), glazed like the other rooms (#860)", () => {
      // Its outside walls: north (360 long) and east (420): the east wins. The balcony slab runs all of it.
      const deck = on(got.decks ?? [], 960, 40, 960, 460);
      expect(deck).toHaveLength(1);
      expect(Math.abs(deck[0]![3]! - deck[0]![1]!)).toBeGreaterThan(380);
      // One door out, at the end nearest the Studio (south), and windows along the rest.
      const door = on(got.balconies, 960, 40, 960, 460);
      expect(door).toHaveLength(1);
      expect(Math.abs(door[0]![3]! - door[0]![1]!)).toBeLessThanOrEqual(90);
      expect(Math.min(door[0]![1]!, door[0]![3]!)).toBeGreaterThan(300);
      const win = on(got.windows, 960, 40, 960, 460);
      expect(win).toHaveLength(1);
      expect(Math.abs(win[0]![3]! - win[0]![1]!)).toBeGreaterThan(250);
      expect(on(got.windows, 600, 40, 960, 40)).toHaveLength(0);
    });

    it("without a Gym, hangs the TV across from the balcony", () => {
      const p = furnish({ ...bare, rooms: bare.rooms.filter((r) => r.id !== "gym") });
      expect(p.tv).toEqual([[600, 40, 600, 460]]);
    });

    it("hangs the TV on the back wall, across the room from the Gym (Nikita 2026-11-05 21:09Z), the sectional facing it", () => {
      // The made-up Gym lies below the flat: the living room's south wall (y 460) is nearest it, so the TV goes on
      // the north wall (y 40), the room turned 180° from the gym side.
      expect(got.tv).toEqual([[600, 40, 960, 40]]);
      const list = got.items.filter(inRoom("living"));
      const tv = list.find((i) => i.k === "tv")!, con = list.find((i) => i.k === "console")!;
      expect(tv.y).toBeLessThan(50);
      expect(tv.w).toBeGreaterThan(tv.h);
      expect(con.y).toBeLessThan(50);
      const sofas = list.filter((i) => i.k === "sofa");
      const run = sofas.reduce((a, b) => (b.w > a.w ? b : a));
      expect(run.w).toBeGreaterThan(run.h);
      expect(run.y).toBeGreaterThan(tv.y + tv.h + 150);
      expect(list.filter((i) => i.k === "cattree")).toHaveLength(1);
    });

    it("keeps the arc lamp where it stood before the walls gave the openings", () => {
      // Before, glass nowhere, the room was laid out from its longest wall (east here): the lamp stood behind the
      // sofa toward the north end, about (929, 130). It is there still.
      const lamp = got.items.filter(inRoom("living")).find((i) => i.k === "lamp")!;
      expect(Math.abs(lamp.x - 929)).toBeLessThanOrEqual(2);
      expect(Math.abs(lamp.y - 130)).toBeLessThanOrEqual(2);
    });

    it("gives the main bedroom windows only on its outside wall, no balcony (#806)", () => {
      // The bedroom's only outside stretch is its south wall (y 800).
      expect(on(got.windows, 220, 800, 660, 800)).toHaveLength(1);
      expect(on(got.balconies, 220, 800, 660, 800)).toHaveLength(0);
    });

    it("gives the hall outside the bedroom a balcony door and a window, and its nook: greenhouse, cat bed, purifier", () => {
      const door = on(got.balconies, 40, 40, 40, 540), win = on(got.windows, 40, 40, 40, 540);
      expect(door).toHaveLength(1);
      // The big window, and the balcony's own windows beside its door (#860): no wall of glass door.
      expect(win).toHaveLength(2);
      expect(Math.abs(door[0]![3]! - door[0]![1]!)).toBeLessThanOrEqual(90);
      const deck = on(got.decks ?? [], 40, 40, 40, 540);
      expect(deck).toHaveLength(1);
      expect(Math.abs(deck[0]![3]! - deck[0]![1]!)).toBeGreaterThan(200);
      // The corner by the bedroom door (y 470 to 530) is left for the greenhouse: the door is short of it.
      expect(Math.max(door[0]![1]!, door[0]![3]!)).toBeLessThanOrEqual(540 - 90);
      const hallItems = got.items.filter(inRoom("hall"));
      const gh = hallItems.find((i) => i.k === "greenhouse")!;
      expect(mid(gh)[1]).toBeGreaterThan(Math.max(door[0]![1]!, door[0]![3]!));
      for (const k of ["petbed", "purifier"] as const) expect(hallItems.some((i) => i.k === k)).toBe(true);
      // The bedroom gets no nook of its own.
      expect(got.items.filter(inRoom("bedroom")).some((i) => i.k === "greenhouse")).toBe(false);
    });

    it("still stands the DJ decks in the studio's right-hand corner, not by the door", () => {
      const dj = got.items.filter(inRoom("study")).find((i) => i.k === "dj")!;
      const [x, y] = mid(dj);
      expect(x).toBeGreaterThan(810);
      expect(y).toBeGreaterThan(700);
    });

    it("leaves every other wall solid", () => {
      for (const id of ["kitchen", "nook", "bath", "study"]) {
        const R = mainRect(room(id));
        const touch = [...got.windows, ...got.balconies].filter((s) => s[0]! >= R[0] && s[2]! <= R[0] + R[2] && s[1]! >= R[1] && s[3]! <= R[1] + R[3]);
        const shared = touch.filter((s) => !["living", "bedroom", "hall"].some((o) => {
          const Q = mainRect(room(o));
          return s[0]! >= Q[0] && s[2]! <= Q[0] + Q[2] && s[1]! >= Q[1] && s[3]! <= Q[1] + Q[3];
        }));
        expect(shared, id).toHaveLength(0);
      }
    });

    it("draws only the defaults when the openings were never set, whatever an import carried", () => {
      const got2 = withOpenings({ ...base, openings: undefined }).plan;
      expect(got2.windows).toEqual(withOpenings(bare).plan.windows);
      expect(imported.balconies).toEqual(got.balconies);
    });

    it("lets openings set in the editor win: exactly as saved, every other wall solid", () => {
      const kept = withOpenings(base).plan;
      expect(kept.windows).toEqual(base.windows);
      // Balcony doors as saved, each drawn one single door wide within its saved run (#935).
      expect(kept.balconies).toHaveLength(base.balconies.length);
      kept.balconies.forEach((d, i) => {
        const [x0, y0, x1, y1] = base.balconies[i]!;
        expect(d[0]).toBe(x0);
        expect(Math.min(d[1], d[3])).toBeGreaterThanOrEqual(y0);
        expect(Math.max(d[1], d[3])).toBeLessThanOrEqual(y1);
        expect(Math.abs(d[3] - d[1]) + Math.abs(d[2] - d[0])).toBe(BALCONY_DOOR);
        expect(x1).toBe(x0);
      });
      expect(kept.tv).toEqual(base.tv);
      const none = withOpenings({ ...base, windows: [], balconies: [], tv: [] }).plan;
      expect([none.windows, none.balconies, none.tv]).toEqual([[], [], []]);
    });
  });

  describe("single balcony doors and the turned sectional (#935)", () => {
    const bare: HavenPlan = { ...base, windows: [], balconies: [], tv: [], openings: undefined };
    const len = (d: number[]) => Math.abs(d[2]! - d[0]!) + Math.abs(d[3]! - d[1]!);

    it("draws every balcony door one single door wide, saved or derived", () => {
      for (const p of [plan, furnish(bare), furnish({ ...base, balconies: [[960, 200, 960, 330]] })]) {
        expect(p.balconies.length).toBeGreaterThan(0);
        for (const d of p.balconies) expect(len(d)).toBeLessThanOrEqual(BALCONY_DOOR);
      }
    });

    // The made-up living room hangs its TV on the west wall: the long run is the sofa standing tall.
    const sofas = (p: HavenPlan) => {
      const two = p.items.filter(inRoom("living")).filter((i) => i.k === "sofa");
      expect(two).toHaveLength(2);
      const [run, ret] = two[0]!.h >= two[1]!.h ? [two[0]!, two[1]!] : [two[1]!, two[0]!];
      return { run, ret };
    };

    it("turns the L to the east and south walls by default: across from the TV, the return to the south", () => {
      const { run, ret } = sofas(plan);
      expect(mid(ret)[1]).toBeGreaterThan(mid(run)[1]);
      // A balcony door on the wall behind it: the sofa stays off that wall.
      expect(run.x + run.w).toBeLessThan(960 - 30);
    });

    it("backs onto both walls in their corner when no balcony door is behind it", () => {
      const p = furnish({ ...base, balconies: base.balconies.slice(1) });
      const { run, ret } = sofas(p);
      expect(960 - (run.x + run.w)).toBeLessThanOrEqual(8);
      expect(460 - (ret.y + ret.h)).toBeLessThanOrEqual(8);
      const st = p.items.filter(inRoom("living")).filter(solid);
      for (let a = 0; a < st.length; a++)
        for (let b = a + 1; b < st.length; b++) {
          const P = boxOf(st[a]!), Q = boxOf(st[b]!);
          expect(P[0] < Q[2] - 1 && P[2] > Q[0] + 1 && P[1] < Q[3] - 1 && P[3] > Q[1] + 1, `${st[a]!.k} and ${st[b]!.k}`).toBe(false);
        }
    });

    it("faces the TV with its long run and the other wall with its return when the TV is on one of them", () => {
      // Turned to the west (the TV) and the south: the return at the north end, facing south.
      const { run, ret } = sofas(furnish({ ...base, sectional: ["w", "s"] }));
      expect(mid(ret)[1]).toBeLessThan(mid(run)[1]);
      expect(ret.x).toBeLessThan(run.x);
    });

    it("follows the walls the plan names", () => {
      const { run, ret } = sofas(furnish({ ...base, sectional: ["n", "e"] }));
      expect(mid(ret)[1]).toBeLessThan(mid(run)[1]);
    });
  });

  it("leaves the stored plan alone", () => {
    expect(readPlan(FAKE_PLAN)).toEqual(base);
    expect(plan.rooms).toBe(base.rooms);
  });
});
