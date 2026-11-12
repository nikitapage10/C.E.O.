import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../api/_haven/planShape.ts";
import type { HavenPlan, PlanItem } from "./data.ts";
import { BALCONY_DOOR, biggerGuestBath, furnish, LITTER_WALL, mainRect, openSeams, PUSH_BACK, withOpenings } from "./furnish.ts";
import { frontDoor, wallsOf } from "./house.ts";
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
const overlap = (a: PlanItem, b: PlanItem) => {
  const p = boxOf(a), q = boxOf(b);
  return p[0] < q[2] - 1 && p[2] > q[0] + 1 && p[1] < q[3] - 1 && p[3] > q[1] + 1;
};

describe("dressing the rooms (#747, #764)", () => {
  it("keeps every dressed piece inside its room, and no two standing pieces in one footprint", () => {
    for (const id of ["living", "study", "bath"]) {
      const R = mainRect(room(id));
      // The kitchen's coffee station may stand across the open seam into the living room (#1022): it is the kitchen's.
      const list = plan.items.filter(inRoom(id)).filter((i) => !["coffeebar", "espresso", "cupshelf"].includes(i.k));
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

  it("stands the living room's cat tree flat against the wall by the balcony door, out of the way to it (#1022)", () => {
    const tree = plan.items.filter(inRoom("living")).find((i) => i.k === "cattree")!;
    const [, a, , b] = plan.balconies.find((d) => d[0] === 960 && d[1] < 460)!;
    // Shallow against the east wall (the balcony door's), not a square block.
    expect(tree.w).toBeLessThanOrEqual(30);
    expect(tree.h).toBeGreaterThanOrEqual(2 * tree.w);
    expect(960 - (tree.x + tree.w)).toBeLessThanOrEqual(1);
    // Out of the doorway, with a way's width round it to walk past.
    expect(tree.y + tree.h <= a - 10 || tree.y >= b + 10).toBe(true);
    const near = plan.items.filter(inRoom("living")).filter((i) => i !== tree && solid(i)).map(boxOf);
    for (const q of near) expect(q[0] < tree.x + tree.w + 45 && q[2] > tree.x - 45 && q[1] < tree.y + tree.h + 45 && q[3] > tree.y - 45).toBe(false);
  });

  it("stands the only cat tree in the living room: none in the studio or anywhere else", () => {
    const trees = plan.items.filter((i) => i.k === "cattree");
    expect(trees).toHaveLength(1);
    expect(inRoom("living")(trees[0]!)).toBe(true);
  });

  it("stands the studio's DJ decks against the window wall by the north-east corner, away from the door (#959, #1022, #1035)", () => {
    // The made-up study (x 660 to 960, y 460 to 800) has its door on its west wall (y 560 to 660).
    const dj = plan.items.filter(inRoom("study")).find((i) => i.k === "dj")!;
    const [x0, y0, x1, y1] = boxOf(dj);
    expect(Math.hypot(mid(dj)[0] - 660, mid(dj)[1] - 610)).toBeGreaterThan(150);
    // Turned 90° clockwise onto the east (window) wall, two decks and the mixer long, leaving the very corner to the
    // floor lamp.
    expect(x1).toBe(960);
    expect(y1 - y0).toBeGreaterThanOrEqual(120);
    expect(y0 - 460).toBeGreaterThanOrEqual(30);
    expect(y0 - 460).toBeLessThanOrEqual(60);
    expect(x0).toBeGreaterThan(860);
    // The desk further along the same wall, clear of the decks.
    const desk = plan.items.filter(inRoom("study")).find((i) => i.k === "desk")!;
    expect(desk.x + desk.w).toBe(956);
    expect(desk.y).toBeGreaterThanOrEqual(y1 + 10);
  });

  it("puts the fridge at the left end of the cabinet run, the coffee station past its right end, the sink where the machine stood (#1022)", () => {
    // The made-up kitchen's run is on its north wall: looking at it, left is west. The stored fridge stood at the east.
    const k = plan.items.filter((i) => inRoom("kitchen")(i) || ["coffeebar", "espresso", "cupshelf"].includes(i.k));
    const fridge = k.find((i) => i.k === "fridge")!, counter = k.find((i) => i.k === "counter")!;
    expect(fridge.x).toBeLessThan(counter.x);
    expect(fridge.x).toBeGreaterThanOrEqual(220);
    // The hob moved over with the run.
    const was = base.items.find((i) => i.k === "range")!, hob = k.find((i) => i.k === "range")!;
    expect(hob.x).toBeGreaterThan(was.x);
    // The coffee station just past the run's right-hand (east) end, against the same wall: the machine on its left,
    // the black cup shelves over it.
    const bar = k.find((i) => i.k === "coffeebar")!, esp = k.find((i) => i.k === "espresso")!, cups = k.find((i) => i.k === "cupshelf")!;
    expect(bar.x).toBeGreaterThanOrEqual(counter.x + counter.w);
    expect(bar.x - (counter.x + counter.w)).toBeLessThanOrEqual(4);
    expect(bar.y).toBe(counter.y);
    expect(mid(esp)[0]).toBeGreaterThan(bar.x);
    expect(mid(esp)[0]).toBeLessThan(bar.x + bar.w / 2);
    expect([cups.x, cups.w]).toEqual([bar.x, bar.w]);
    expect(KIND_STYLE.cupshelf.lift).toBeGreaterThan(KIND_STYLE.coffeebar.height);
    expect(plan.items.filter((i) => i.k === "espresso")).toHaveLength(1);
    // The sink at the run's right-hand end, clear of the hob.
    const sink = k.find((i) => i.k === "sink")!;
    expect(counter.x + counter.w - (sink.x + sink.w)).toBeLessThanOrEqual(10);
    expect(sink.x).toBeGreaterThan(hob.x + hob.w);
    expect(plan.items.some((i) => i.k === "sideboard")).toBe(false);
    // Loose jars (the bottles) are gone with it, and the loose cylinders by it: only the island's stools stay.
    expect(k.some((i) => i.k === "jar")).toBe(false);
    expect(plan.items.some((i) => i.k === "tubchair")).toBe(false);
    expect(k.filter((i) => i.k === "stool")).toHaveLength(3);
  });

  it("stands a brushed-steel bin by the island's east end (#1022)", () => {
    const island = plan.items.find((i) => i.k === "island")!, bin = plan.items.find((i) => i.k === "bin")!;
    expect(bin.x).toBeGreaterThanOrEqual(island.x + island.w);
    expect(bin.x - (island.x + island.w)).toBeLessThanOrEqual(10);
    expect(mid(bin)[1]).toBeGreaterThan(island.y);
    expect(mid(bin)[1]).toBeLessThan(island.y + island.h);
    expect(bin.round).toBe(false);
  });

  it("keeps the coffee on the counter when there is no room past the run", () => {
    // The living room's place taken by a wall: no open floor east of the kitchen.
    const p = furnish({ ...base, rooms: base.rooms.filter((r) => r.id !== "living") });
    const k = p.items.filter(inRoom("kitchen"));
    const counter = k.find((i) => i.k === "counter")!, esp = k.find((i) => i.k === "espresso")!;
    expect(k.some((i) => i.k === "coffeebar")).toBe(false);
    const [ex, ey] = mid(esp);
    expect(ex).toBeGreaterThan(counter.x);
    expect(ex).toBeLessThan(counter.x + counter.w);
    expect(ey).toBeGreaterThan(counter.y);
    expect(ey).toBeLessThan(counter.y + counter.h);
  });

  it("hangs five tall canvases on the wall across from the cabinets, where the doors leave room", () => {
    // The made-up dining door takes most of that wall; with a narrower one the canvases fit beside it.
    expect(plan.items.some((i) => i.k === "art")).toBe(false);
    // The kitchen's south wall is an open seam into the dining room (#1022): no canvases float there. With a walled
    // room beyond it instead, and a narrower door, they fit beside the door.
    const pantry = base.rooms.map((r) => (r.id === "nook" ? { ...r, name: "Pantry" } : r));
    expect(furnish({ ...base, rooms: pantry }).items.some((i) => i.k === "art")).toBe(false);
    const roomy = furnish({ ...base, rooms: pantry, doors: base.doors.map((d) => (d[1] === 320 && d[3] === 320 ? ([420, 320, 520, 320] as typeof d) : d)) });
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
    for (const k of ["ochair", "dj"] as const) expect(list.some((i) => i.k === k)).toBe(true);
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

  it("faces the coffee table with two round accent chairs on its open side, clear of the sofas (#1022)", () => {
    const list = plan.items.filter(inRoom("living"));
    const chairs = list.filter((i) => i.k === "accent"), table = list.find((i) => i.k === "ctable")!;
    expect(chairs).toHaveLength(2);
    for (const c of chairs) {
      expect(c.round).toBe(true);
      expect(Math.hypot(c.x - mid(table)[0], c.y - mid(table)[1])).toBeLessThan(110);
    }
  });
  it("makes the living room's and the studio's sofas narrow, leaving a way to the balcony door (#1022)", () => {
    const depth = (i: PlanItem) => Math.min(i.w, i.h);
    for (const s of plan.items.filter((i) => i.k === "sofa" && inRoom("living")(i))) expect(depth(s)).toBeLessThanOrEqual(70);
    for (const s of plan.items.filter((i) => i.k === "sofa" && inRoom("study")(i))) expect(depth(s)).toBeLessThanOrEqual(60);
  });

  it("stands the coat rack on the hall's east wall, the raised bowls at the end of the feeding row, no tub chair (#1022)", () => {
    const rack = plan.items.find((i) => i.k === "coatrack")!;
    const hall = room("hall").parts[0]!;
    expect(hall[0] + hall[2] - (rack.x + rack.w)).toBeLessThanOrEqual(6);
    expect(rack.w).toBeLessThan(rack.h);
    const bowls = plan.items.find((i) => i.k === "bowls")!;
    expect(mid(bowls)[0]).toBeGreaterThan(500);
    expect(Math.abs(mid(bowls)[1] - 446)).toBeLessThan(5);
    expect(plan.items.some((i) => i.k === "tubchair")).toBe(false);
  });

  it("clears the hall: no rugs, no stray cylinders, the vacuum drawn at its dock on the west wall (#1022)", () => {
    const hall = plan.items.filter(inRoom("hall"));
    for (const k of ["rug", "runner", "mat", "petbed"] as const) expect(hall.some((i) => i.k === k)).toBe(false);
    expect(hall.some((i) => i.round && ["purifier", "jar", "stool", "tubchair", "box", "plant"].includes(i.k))).toBe(false);
    const vac = plan.devices.find((d) => d.kind === "vacuum")!;
    const H = room("hall").parts[0]!;
    expect(vac.x - H[0]).toBeLessThanOrEqual(24);
    expect(vac.y).toBeGreaterThan(H[1]);
    expect(vac.y).toBeLessThan(H[1] + H[3]);
    // Beside the plant cabinet when the hall has one.
    const gh: PlanItem = { k: "greenhouse", x: 46, y: 250, w: 50, h: 70, round: false };
    const v2 = furnish({ ...base, items: [...base.items, gh] }).devices.find((d) => d.kind === "vacuum")!;
    expect(v2.x - H[0]).toBeLessThanOrEqual(24);
    expect(Math.abs(v2.y - mid(gh)[1])).toBeLessThan(70);
    // Never in front of a balcony door on that wall.
    const bare = furnish({ ...base, windows: [], balconies: [], tv: [], openings: undefined });
    const v3 = bare.devices.find((d) => d.kind === "vacuum")!;
    for (const d of bare.balconies.filter((g) => g[0] === 40 && g[2] === 40)) expect(v3.y + 19 <= Math.min(d[1], d[3]) || v3.y - 19 >= Math.max(d[1], d[3])).toBe(true);
  });

  it("opens the kitchen, the dining room and the living room into one room: no wall between them (#1022)", () => {
    const walls = wallsOf(plan);
    const along = (x0: number, y0: number, x1: number, y1: number) =>
      walls.some((w) => (x0 === x1 ? w[0] === w[2] && w[0] === x0 && Math.min(w[1], w[3]) < y1 - 1 && Math.max(w[1], w[3]) > y0 + 1 : w[1] === w[3] && w[1] === y0 && Math.min(w[0], w[2]) < x1 - 1 && Math.max(w[0], w[2]) > x0 + 1));
    // Kitchen and dining | living room (x 600, y 40 to 460), kitchen | dining (y 320).
    expect(along(600, 40, 600, 460)).toBe(false);
    expect(along(220, 320, 600, 320)).toBe(false);
    // The outside of the open room is still walled.
    expect(along(220, 460, 600, 460)).toBe(true);
    // A hair apart counts as meeting.
    expect(openSeams([[0, 0, 100, 100], [102, 10, 50, 50]])).toEqual([[100, 10, 100, 60], [102, 10, 102, 60]]);
    expect(openSeams([[0, 0, 100, 100], [110, 10, 50, 50]])).toEqual([]);
  });

  it("lays out the guest bath: the tub on the west wall, the toilet about the middle of the south wall, the vanity beside it (#1022)", () => {
    const b = plan.items.filter(inRoom("bath"));
    const R = room("bath").parts[0]!;
    const tub = b.find((i) => i.k === "tub")!, wc = b.find((i) => i.k === "wc")!, vanity = b.find((i) => i.k === "vanity")!;
    expect(tub.x - R[0]).toBeLessThanOrEqual(4);
    expect(tub.h).toBeGreaterThan(tub.w);
    expect(R[1] + R[3] - (wc.y + wc.h)).toBeLessThanOrEqual(6);
    expect(Math.abs(mid(wc)[0] - (R[0] + R[2] / 2))).toBeLessThanOrEqual(40);
    expect(R[1] + R[3] - (vanity.y + vanity.h)).toBeLessThanOrEqual(6);
    expect(Math.min(Math.abs(vanity.x - (wc.x + wc.w)), Math.abs(wc.x - (vanity.x + vanity.w)))).toBeLessThanOrEqual(10);
  });

  it("grows the guest bath a little into empty floor beside it, its door moving with the wall (#1022)", () => {
    // A made-up gap of empty floor south of a shorter bath, inside the home's outline.
    const rooms = base.rooms.map((r) => (r.id === "bath" ? { ...r, parts: [[40, 540, 180, 200]] as typeof r.parts } : r.id === "hall" ? { ...r, parts: [[40, 40, 180, 500], [40, 780, 180, 20]] as typeof r.parts } : r));
    const doors = [...base.doors, [60, 740, 120, 740] as [number, number, number, number]];
    const got = biggerGuestBath({ ...base, rooms, doors });
    expect(got.rooms.find((r) => r.id === "bath")!.parts[0]).toEqual([40, 540, 180, 230]);
    expect(got.doors).toContainEqual([60, 770, 120, 770]);
    // With no empty floor beside it and no room it may take from, it stays as it is.
    expect(biggerGuestBath(base).rooms).toBe(base.rooms);
  });

  it("lays out the master bath: the shower at the north wall's east end, the toilet left of the vanity on the south (#1022, #1035)", () => {
    const two: HavenPlan = furnish({
      ...base,
      rooms: [...base.rooms.map((r) => (r.id === "bedroom" ? { ...r, parts: [[220, 460, 240, 340] as [number, number, number, number]] } : r)), { id: "mbath", name: "Master bath", parts: [[460, 460, 200, 340]], floor: "tile", tab: null, vacuum: null, detached: false }],
      // Its only door from the bedroom (the made-up Studio door on its east wall left out).
      doors: [...base.doors.filter((d) => d[0] !== 660), [460, 520, 460, 610]],
    });
    const m = two.items.filter((i) => mid(i)[0] >= 460 && mid(i)[0] <= 660 && mid(i)[1] >= 460 && mid(i)[1] <= 800);
    const one = (k: string) => m.find((i) => i.k === k)!;
    const shower = one("shower"), vanity = one("vanity"), wc = one("wc"), litter = one("litterbox");
    // The shower against the north wall, in its east corner (the closet's side), not the west.
    expect(shower.y - 460).toBeLessThanOrEqual(4);
    expect(660 - (shower.x + shower.w)).toBeLessThanOrEqual(4);
    // The vanity on the south wall and the toilet beside it, on its left looking at it (east of it).
    expect(800 - (vanity.y + vanity.h)).toBeLessThanOrEqual(6);
    expect(800 - (wc.y + wc.h)).toBeLessThanOrEqual(6);
    expect(wc.x).toBeGreaterThanOrEqual(vanity.x + vanity.w);
    expect(wc.x - (vanity.x + vanity.w)).toBeLessThanOrEqual(16);
    // The litter box on the west wall, away from the shower.
    expect(litter.x - 460).toBeLessThanOrEqual(10);
    for (const i of m.filter(solid)) for (const o of m.filter(solid)) if (i !== o) expect(overlap(i, o), `${i.k} and ${o.k}`).toBe(false);
  });

  it("hangs clothes rails along the closet's north and south walls, nothing else in it (#1022)", () => {
    const p = furnish({ ...base, rooms: [...base.rooms, { id: "closet", name: "Closet", parts: [[700, 900, 120, 200]], floor: "wood", tab: null, vacuum: null, detached: false }], items: [...base.items, { k: "box", x: 720, y: 950, w: 20, h: 120, round: false }] });
    const c = p.items.filter((i) => mid(i)[0] >= 700 && mid(i)[0] <= 820 && mid(i)[1] >= 900 && mid(i)[1] <= 1100);
    expect(c.map((i) => i.k)).toEqual(["rail", "rail"]);
    expect(c.some((i) => i.y - 900 <= 4)).toBe(true);
    expect(c.some((i) => 1100 - (i.y + i.h) <= 4)).toBe(true);
  });

  it("moves the main bedroom's door to the east end of its wall and the bed west of it (#1022)", () => {
    // The made-up bedroom (x 220 to 660, y 460 to 800), opening here from a made-up corridor along its north wall.
    const corr = { id: "corr", name: "Corridor", parts: [[220, 400, 440, 60]] as [number, number, number, number][], floor: "wood" as const, tab: null, vacuum: null, detached: false };
    const rooms = [...base.rooms.filter((r) => r.id !== "nook"), corr];
    const doors = [...base.doors.filter((d) => !(d[0] === 220 && d[2] === 220 && d[1] === 470)), [400, 460, 480, 460] as [number, number, number, number]];
    const got = furnish({ ...base, rooms, doors });
    const d = got.doors.find((x) => x[1] === 460 && x[3] === 460 && x[0] >= 220 && x[2] <= 660 && x[2] - x[0] === 80)!;
    expect(660 - d[2]).toBeLessThanOrEqual(10);
    const bed0 = base.items.find((i) => i.k === "bed")!, bed = got.items.find((i) => i.k === "bed")!;
    expect(bed.x).toBeLessThan(bed0.x);
    expect(d[0] - (bed.x + bed.w)).toBeGreaterThan(0);
  });

  it("gives the main bedroom's west wall and the studio's east wall three tall windows each (#1022)", () => {
    const tall = plan.tall ?? [];
    expect(tall.filter((s) => s[0] === 220 && s[2] === 220)).toHaveLength(3);
    expect(tall.filter((s) => s[0] === 960 && s[2] === 960)).toHaveLength(3);
    for (const t of tall) expect(plan.windows).toContainEqual(t);
    // Clear of the door on the bedroom's west wall.
    const door = plan.doors.find((d) => d[0] === 220 && d[2] === 220 && Math.min(d[1], d[3]) >= 460)!;
    for (const t of tall.filter((s) => s[0] === 220)) expect(Math.max(t[1], t[3]) <= Math.min(door[1], door[3]) || Math.min(t[1], t[3]) >= Math.max(door[1], door[3])).toBe(true);
  });

  describe("the Studio turned 90° clockwise (#959)", () => {
    // The made-up study: x 660 to 960, y 460 to 800; north is the top of the plan (small y), east the right.
    const R = [660, 460, 300, 340] as const;
    const E = R[0] + R[2], S = R[1] + R[3], W = R[0], N = R[1];
    const kinds = (p: HavenPlan) => {
      const list = p.items.filter((i) => {
        const [x, y] = mid(i);
        return x >= W && x <= E && y >= N && y <= S;
      });
      const one = (k: PlanItem["k"]) => list.find((i) => i.k === k)!;
      return { list, desk: one("desk"), dj: one("dj"), sofas: list.filter((i) => i.k === "sofa"), monitors: list.filter((i) => i.k === "monitor") };
    };
    // Its glass moved to the north wall: the furniture keeps to its walls all the same.
    const glassNorth: HavenPlan = { ...base, windows: [...base.windows.filter((s) => s[0] !== 960 || s[1] < 460), [700, 460, 900, 460]] };

    for (const [name, p] of [["as drawn", plan], ["with its window on the north wall", furnish(glassNorth)], ["with no openings saved", furnish({ ...base, windows: [], balconies: [], tv: [], openings: undefined })]] as const) {
      it(`${name}: the desk and its screens against the east wall, the sofas along the south and west, the decks in the north-east`, () => {
        const { desk, dj, sofas, monitors } = kinds(p);
        expect(E - (desk.x + desk.w)).toBeLessThanOrEqual(6);
        expect(desk.h).toBeGreaterThan(desk.w);
        expect(monitors).toHaveLength(2);
        for (const m of monitors) expect(E - (m.x + m.w)).toBeLessThanOrEqual(16);
        expect(sofas).toHaveLength(2);
        const south = sofas.find((s) => s.w > s.h)!, west = sofas.find((s) => s.h > s.w)!;
        expect(S - (south.y + south.h)).toBeLessThanOrEqual(6);
        expect(west.x - W).toBeLessThanOrEqual(6);
        // The two meet in the south-west corner.
        expect(south.x - (west.x + west.w)).toBeLessThanOrEqual(6);
        const [dx, dy] = mid(dj);
        expect(dx).toBeGreaterThan((W + E) / 2);
        expect(dy).toBeLessThan((N + S) / 2);
        expect(Math.min(E - (dj.x + dj.w), dj.y - N)).toBeLessThanOrEqual(10);
        // Nothing stands in another's footprint.
        const st = kinds(p).list.filter(solid);
        for (let a = 0; a < st.length; a++)
          for (let b = a + 1; b < st.length; b++) {
            const P = boxOf(st[a]!), Q = boxOf(st[b]!);
            expect(P[0] < Q[2] - 1 && P[2] > Q[0] + 1 && P[1] < Q[3] - 1 && P[3] > Q[1] + 1, `${st[a]!.k} and ${st[b]!.k}`).toBe(false);
          }
      });
    }
  });

  it("gives a balcony door in any other room its nook: a greenhouse and the purifier under the window, no cat bed (#1022)", () => {
    const p = furnish({ ...base, rooms: base.rooms.map((r) => (r.id === "study" ? { ...r, name: "Bedroom 2" } : r)) });
    const list = p.items.filter((i) => {
      const [x, y] = mid(i);
      return x >= 660 && y >= 460 && y <= 800;
    }).map((i) => i.k);
    for (const k of ["greenhouse", "purifier"] as const) expect(list).toContain(k);
    expect(list).not.toContain("petbed");
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

    it("keeps the hall's wall by the litter box solid, the plant cabinet where it stood (#1035)", () => {
      // The made-up litter box stands in the hall at (84, 500), by its west wall.
      const near = (s: number[]) => Math.max(s[1]!, s[3]!) > 500 - LITTER_WALL + 20 && Math.min(s[1]!, s[3]!) < 500 + LITTER_WALL - 20;
      expect(on(got.balconies, 40, 40, 40, 540).filter(near)).toHaveLength(0);
      expect(on(got.windows, 40, 40, 40, 540).filter(near)).toHaveLength(0);
      expect(on(got.decks ?? [], 40, 40, 40, 540).filter(near)).toHaveLength(0);
      // The big window further up the hall stays, and so does the plant cabinet.
      expect(on(got.windows, 40, 40, 40, 540).length).toBeGreaterThanOrEqual(1);
      expect(got.items.filter(inRoom("hall")).some((i) => i.k === "greenhouse")).toBe(true);
      // No opening onto the kitchen beside it either: the kitchen and the hall meet at x 220 from y 40 to 320.
      const byKitchen = furnish({ ...bare, devices: base.devices.map((d) => (d.kind === "litter" ? { ...d, x: 180, y: 250 } : d)) });
      const seam = (p: HavenPlan) => p.doors.filter((d) => d[0] === 220 && d[2] === 220 && Math.min(d[1], d[3]) >= 40 && Math.max(d[1], d[3]) <= 320);
      const open = (p: HavenPlan) => seam(p).reduce((n, d) => n + Math.abs(d[3] - d[1]), 0);
      expect(open(byKitchen)).toBeLessThan(open(got) - 150);
    });

    it("gives the hall outside the bedroom a balcony door and a window, and its nook: greenhouse, purifier", () => {
      // With the litter box elsewhere (#1035 keeps the wall by it solid).
      const got = furnish({ ...bare, devices: base.devices.map((d) => (d.kind === "litter" ? { ...d, x: 900, y: 600 } : d)) });
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
      expect(hallItems.some((i) => i.k === "purifier")).toBe(true);
      expect(hallItems.some((i) => i.k === "petbed")).toBe(false);
      // The bedroom gets no nook of its own.
      expect(got.items.filter(inRoom("bedroom")).some((i) => i.k === "greenhouse")).toBe(false);
    });

    it("still stands the DJ decks in the studio's north-east corner, not by the door", () => {
      const dj = got.items.filter(inRoom("study")).find((i) => i.k === "dj")!;
      const [x, y] = mid(dj);
      expect(x).toBeGreaterThan(810);
      expect(y).toBeLessThan(630);
    });

    it("leaves every other wall solid", () => {
      for (const id of ["kitchen", "nook", "bath", "study"]) {
        const R = mainRect(room(id));
        // The studio's tall windows were asked for (#1022).
        const touch = [...got.windows.filter((w) => !(got.tall ?? []).includes(w)), ...got.balconies].filter((s) => s[0]! >= R[0] && s[2]! <= R[0] + R[2] && s[1]! >= R[1] && s[3]! <= R[1] + R[3]);
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
    expect(plan.rooms).toEqual(base.rooms);
  });
});

describe("round two (#1035), on made-up plans", () => {
  type R4 = [number, number, number, number];
  // A made-up open room in a row: the kitchen, then the dining room set in 60 from the living room's north wall.
  const row: HavenPlan = {
    ...base,
    rooms: base.rooms.map((r) => (r.id === "kitchen" ? { ...r, parts: [[220, 40, 200, 420] as R4] } : r.id === "nook" ? { ...r, parts: [[420, 100, 180, 360] as R4] } : r)),
    windows: [...base.windows.filter((w) => !(w[1] === 40 && w[0] === 300)), [566, 100, 596, 100]],
    items: [
      ...base.items.filter((i) => !["counter", "upper", "range", "sink", "fridge", "island", "stool", "table", "chair", "jar"].includes(i.k)),
      { k: "counter", x: 224, y: 44, w: 180, h: 30, round: false },
      { k: "range", x: 300, y: 46, w: 60, h: 26, round: false },
      { k: "table", x: 450, y: 300, w: 120, h: 60, round: false },
      { k: "chair", x: 470, y: 290, w: 20, h: 20, round: true },
    ],
  };
  const got = furnish(row);
  const dining = got.rooms.find((r) => r.id === "nook")!;
  const inDining = (i: PlanItem) => mid(i)[0] >= 420 && mid(i)[0] <= 600 && mid(i)[1] >= 40 && mid(i)[1] <= 460;

  it("pushes the dining room back in line with the living room: one straight wall, its window moved with it", () => {
    expect(dining.parts[0]).toEqual([420, 40, 180, 420]);
    expect(got.windows).toContainEqual([566, 40, 596, 40]);
    expect(got.windows).not.toContainEqual([566, 100, 596, 100]);
    // No wall is drawn along the old corner.
    expect(wallsOf(got).some((w) => w[1] === 100 && w[3] === 100 && Math.min(w[0], w[2]) >= 420 && Math.max(w[0], w[2]) <= 600)).toBe(false);
  });

  it("leaves a wall further in than PUSH_BACK, or with a room in the way, where it is", () => {
    const y0 = 40 + PUSH_BACK + 70;
    const deep = furnish({ ...row, rooms: row.rooms.map((r) => (r.id === "nook" ? { ...r, parts: [[420, y0, 180, 460 - y0] as R4] } : r)) });
    expect(deep.rooms.find((r) => r.id === "nook")!.parts[0]).toEqual([420, y0, 180, 460 - y0]);
    const pantry = { id: "pantry", name: "Pantry", parts: [[420, 40, 180, 60] as R4], floor: "wood" as const, tab: null, vacuum: null, detached: false };
    const held = furnish({ ...row, rooms: [...row.rooms, pantry] });
    expect(held.rooms.find((r) => r.id === "nook")!.parts[0]).toEqual([420, 100, 180, 360]);
  });

  it("puts the coffee station on the dining room's north wall behind its table: three cup shelves over it, the table in front", () => {
    const d = got.items.filter(inDining);
    const bar = d.find((i) => i.k === "coffeebar")!, shelf = d.find((i) => i.k === "cupshelf")!, machine = d.find((i) => i.k === "espresso")!;
    expect(bar.y - 40).toBeLessThanOrEqual(6);
    // Behind the table, centred on it.
    const table = d.find((i) => i.k === "table")!;
    expect(Math.abs(mid(bar)[0] - mid(table)[0])).toBeLessThanOrEqual(2);
    expect(table.y).toBeGreaterThan(bar.y + bar.h);
    // The shelves over the cabinet, the machine on it; one station in the home.
    expect(shelf.x).toBe(bar.x);
    expect(shelf.w).toBe(bar.w);
    expect(machine.x).toBeGreaterThanOrEqual(bar.x);
    expect(machine.x + machine.w).toBeLessThanOrEqual(bar.x + bar.w);
    expect(got.items.filter((i) => i.k === "espresso")).toHaveLength(1);
    expect(got.items.filter((i) => i.k === "coffeebar")).toHaveLength(1);
  });

  it("keeps the station by the run when the dining room's north side opens onto the kitchen", () => {
    // The made-up flat's dining room is south of its kitchen: no north wall to stand it on.
    const k = plan.items.filter((i) => i.k === "coffeebar");
    expect(k).toHaveLength(1);
    expect(k[0]!.y).toBeLessThan(320);
  });

  it("clears the hall: no cat tunnel, no black box or dresser; a wide coat and shoe rack", () => {
    const stray: PlanItem[] = [
      { k: "tunnel", x: 60, y: 300, w: 130, h: 52, round: false },
      { k: "dresser", x: 46, y: 200, w: 40, h: 90, round: false },
      { k: "box", x: 46, y: 320, w: 30, h: 30, round: false },
    ];
    const p = furnish({ ...base, items: [...base.items, ...stray] });
    const hall = p.items.filter((i) => mid(i)[0] >= 40 && mid(i)[0] <= 220 && mid(i)[1] >= 40 && mid(i)[1] <= 540);
    for (const k of ["tunnel", "dresser", "box"]) expect(hall.some((i) => i.k === k)).toBe(false);
    const rack = hall.find((i) => i.k === "coatrack")!;
    expect(Math.max(rack.w, rack.h)).toBeGreaterThanOrEqual(90);
    expect(220 - (rack.x + rack.w)).toBeLessThanOrEqual(6);
  });

  it("finds the front door for the entrance alcove: the hall's door out of the home, and its way out", () => {
    expect(frontDoor(plan)).toEqual({ seg: [90, 40, 170, 40], out: [0, -1] });
    expect(frontDoor({ ...plan, doors: plan.doors.filter((d) => d[1] !== 40 || d[3] !== 40) })).toBeNull();
  });

  it("spans the Studio's east wall with three windows and no balcony door", () => {
    const studio = mainRect(plan.rooms.find((r) => r.id === "study")!);
    const east = studio[0] + studio[2];
    const on = (segs: number[][]) => segs.filter((s) => s[0] === east && s[2] === east && Math.min(s[1]!, s[3]!) >= studio[1] && Math.max(s[1]!, s[3]!) <= studio[1] + studio[3]);
    const win = on(plan.windows);
    expect(win).toHaveLength(3);
    expect(on(plan.balconies)).toHaveLength(0);
    const span = Math.max(...win.map((s) => Math.max(s[1]!, s[3]!))) - Math.min(...win.map((s) => Math.min(s[1]!, s[3]!)));
    expect(span).toBeGreaterThan(studio[3] - 40);
  });
});
