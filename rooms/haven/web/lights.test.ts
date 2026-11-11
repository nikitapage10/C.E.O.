import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../api/_haven/planShape.ts";
import { gymBeyond } from "./gymFill.ts";
import { afterScene, deskRoom, fixtureOf, HIDDEN_LIGHTS, isOffScene, loadLights, placeLights, roomLightOf, shownLights, type Light, type LightsView } from "./lights.ts";
import { boxOf, colourOf, drawList, roomReach } from "./realLights.ts";
import { dayLevel, sunAt } from "./daylight.ts";

/** Where the lights go on the house (#931), on the made-up plan: nothing here is anyone's real home. */

const plan = readPlan(FAKE_PLAN)!;
const light = (name: string, id = name): Light => ({ id, vendor: "switchbot", name, type: "Bot", on: false, online: true });
const room = (id: string) => plan.rooms.find((r) => r.id === id)!.parts[0]!;

describe("placing the lights (#931)", () => {
  it("hangs a light named after a room in that room, on its left or right half when the name says", () => {
    const { placed, loose } = placeLights(plan, [light("Kitchen"), light("Left Living Room"), light("Right Living Room"), light("Porch")]);
    expect(loose.map((l) => l.name)).toEqual(["Porch"]);
    const at = (n: string) => placed.find((p) => p.light.name === n)!;
    const [kx, ky, kw, kh] = room("kitchen");
    expect(at("Kitchen")).toMatchObject({ x: kx + kw / 2, y: ky + kh / 2 });
    const [lx, , lw] = room("living");
    expect(at("Left Living Room").x).toBeCloseTo(lx + lw * 0.3);
    expect(at("Right Living Room").x).toBeCloseTo(lx + lw * 0.7);
  });

  it("puts a light where the plan's own spots say, by name, ignoring case", () => {
    const withSpots = readPlan({ ...FAKE_PLAN, lights: [{ name: "porch", x: 120, y: 300 }] })!;
    const { placed, loose } = placeLights(withSpots, [light("Porch")]);
    expect(loose).toEqual([]);
    expect(placed[0]).toMatchObject({ x: 120, y: 300 });
  });

  it("moves the plan's spots with the home when the Gym goes out back", () => {
    const withSpots = readPlan({ ...FAKE_PLAN, lights: [{ name: "Porch", x: 120, y: 300 }] })!;
    const drawn = gymBeyond(withSpots);
    const before = withSpots.rooms.find((r) => r.id === "hall")!.parts[0]!, after = drawn.rooms.find((r) => r.id === "hall")!.parts[0]!;
    expect(drawn.lights![0]).toEqual({ name: "Porch", x: 120 + after[0] - before[0], y: 300 + after[1] - before[1] });
  });

  it("keeps two plain lights in one room apart", () => {
    const { placed } = placeLights(plan, [light("Kitchen", "a"), light("Kitchen", "b")]);
    expect(placed[0]!.x).not.toBe(placed[1]!.x);
  });

  it("reads the plan's spots as untrusted: names cleaned, bad ones dropped, the list capped", () => {
    const got = readPlan({ ...FAKE_PLAN, lights: [{ name: "<b>Desk</b>", x: 1, y: 2 }, { name: "", x: 1, y: 2 }, { name: "x", x: "no", y: 2 }, ...Array.from({ length: 40 }, (_, i) => ({ name: `L${i}`, x: i, y: i }))] })!;
    expect(got.lights![0]!.name).toBe("bDesk/b");
    expect(got.lights!).toHaveLength(30);
    expect(readPlan(FAKE_PLAN)).not.toHaveProperty("lights");
  });
});

describe("the real lights on the house (#974)", () => {
  it("draws a floor lamp as an LED line, an under-light low, anything else from the ceiling", () => {
    expect(fixtureOf("Floor Lamp Left")).toBe("floor");
    expect(fixtureOf("Corner uplight")).toBe("floor");
    expect(fixtureOf("Counter Underlights")).toBe("under");
    expect(fixtureOf("Under cabinet glow")).toBe("under");
    expect(fixtureOf("Kitchen")).toBe("ceiling");
  });

  it("takes the page's spots over the plan's, and adds the Studio's light only on a desktop, with a Studio", () => {
    const studio = readPlan({ ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.map((r) => (r.id === "study" ? { ...r, name: "Studio" } : r)) })!;
    expect(deskRoom(plan)).toBeNull();
    expect(deskRoom(studio)?.id).toBe("study");
    const list = drawList(studio, [light("Test Floor Lamp")], [{ name: "test floor lamp", x: 700, y: 500 }], true);
    expect(list.map((d) => [d.light.name, d.fixture, d.virtual, d.x, d.y])).toEqual([
      ["Test Floor Lamp", "floor", false, 700, 500],
      ["Studio", "room", true, 810, 630],
    ]);
    expect(drawList(studio, [], undefined, false)).toEqual([]);
  });

  it("colours a light from the vendor's colour, else a warm white", () => {
    expect(colourOf({ rgb: "#39ff7a" })).toBe(0x39ff7a);
    expect(colourOf({ rgb: null })).not.toBe(0);
  });

  it("knows day from night over Denver", () => {
    expect(dayLevel(sunAt(new Date("2026-06-21T19:00:00Z")).alt)).toBe(1);
    expect(dayLevel(sunAt(new Date("2026-06-21T07:00:00Z")).alt)).toBe(0);
    expect(dayLevel(sunAt(new Date("2026-11-07T01:00:00Z")).alt)).toBe(0);
    expect(dayLevel(sunAt(new Date("2026-11-06T18:00:00Z")).alt)).toBe(1);
  });
});

describe("the lights Nikita uses, and the rooms the switches light (#1002)", () => {
  const govee = (name: string): Light => ({ ...light(name), vendor: "govee" });

  it("leaves out the unused lights by whole name, keeping the island's underlights", () => {
    const all = [govee("Bar Lights"), govee("christmas tree"), govee("Island Lights"), govee("Island Underlights"), govee("Studio Floor Lamp")];
    expect(shownLights(all).map((l) => l.name)).toEqual(["Island Underlights", "Studio Floor Lamp"]);
    expect(shownLights(all, [])).toHaveLength(5);
    expect(HIDDEN_LIGHTS).toContain("Island Lights");
  });

  it("lights the whole room for a SwitchBot switch, unless it's one of the home's fixtures (#1007)", () => {
    const of = (l: Light) => roomLightOf(plan, l)?.id ?? null;
    expect(of(light("Living Room"))).toBe("living");
    expect(of(light("Dining Room"))).toBe("nook");
    expect(of(light("Hall Lights"))).toBe("hall");
    // The kitchen's backlight, the laundry's fitting and the living room's spot rows are drawn as what they are.
    expect(of(light("Kitchen"))).toBeNull();
    expect(of(light("Laundry"))).toBeNull();
    expect(of(light("Left Living Room"))).toBeNull();
    // A Govee lamp lights round itself, not the room; so does a switch with no room to its name or spot.
    expect(of(govee("Kitchen"))).toBeNull();
    expect(of(light("Porch"))).toBeNull();
    const [hx, hy] = room("hall");
    expect(roomLightOf(plan, light("Porch"), { x: hx + 10, y: hy + 10 })?.id).toBe("hall");
  });

  it("places the laundry's switch in the hall, and draws a plain switch as its room's lights, off when it's off", () => {
    expect(placeLights(plan, [light("Laundry")]).loose).toEqual([]);
    const list = drawList(plan, [light("Hall"), { ...light("Dining"), on: true }, govee("Floor Lamp Left")], [{ name: "floor lamp left", x: 300, y: 600 }], false);
    const hall = boxOf(plan.rooms.find((r) => r.id === "hall")!);
    expect(list.map((d) => [d.light.name, d.fixture, d.light.on])).toEqual([
      ["Hall", "room", false],
      ["Dining", "room", true],
      ["Floor Lamp Left", "floor", false],
    ]);
    expect(list[0]!.room).toEqual(hall);
    // A room light reaches the room's corners and no further than that (no light next door through the walls).
    expect(roomReach(hall)).toBeCloseTo((0.62 * Math.hypot(hall.w, hall.h)) / 100);
  });
});

describe("a scene that turns the lights off (#1020)", () => {
  const view = (lights: Light[]): LightsView => ({ lights, groups: [], scenes: [{ id: "s1", name: "Turn off lights" }], remotes: [] }) as unknown as LightsView;
  const sb = (name: string, on: boolean | null, online = true): Light => ({ id: name, vendor: "switchbot", name, type: "Bot", on, online });

  it("knows an off scene by its name", () => {
    expect(isOffScene("Turn off lights")).toBe(true);
    expect(isOffScene("All Off")).toBe(true);
    expect(isOffScene("Lights on")).toBe(false);
    expect(isOffScene("Movie night")).toBe(false);
  });

  it("shows every SwitchBot switch off at once, leaving the offline ones and the Govee lamps for the next read", () => {
    const govee: Light = { ...sb("Studio Lamp", true), vendor: "govee" };
    const v = view([sb("Kitchen", true), sb("Left Living Room", null), sb("Laundry", true, false), govee]);
    expect(afterScene(v, "Turn off lights").lights.map((l) => l.on)).toEqual([false, false, true, true]);
    expect(afterScene(v, "Movie night")).toBe(v);
  });

  it("asks for a fresh read when told to", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ ok: false }), { status: 503 });
    }) as unknown as typeof fetch;
    await loadLights(f);
    await loadLights(f, true);
    expect(urls[0]!.endsWith("/api/haven/lights")).toBe(true);
    expect(urls[1]!.endsWith("/api/haven/lights?fresh=1")).toBe(true);
  });
});
