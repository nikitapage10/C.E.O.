import { describe, expect, it } from "vitest";
import { homeText, type HomeLook } from "./devices/homeread.ts";
import type { DeviceReading } from "./devices/types.ts";
import { NO_HOUSE, attentionOf, climateBit, dinnerBit, homeDay, houseLine, houseText, lightsBit, todosBit, type HouseSources } from "./house.ts";
import type { LightsView } from "./lights/lights.ts";
import type { MealsFile } from "./mealShape.ts";
import type { HavenPlan } from "./planShape.ts";
import type { TodoState } from "../_today/todos.ts";
import { TOOL_DEFS } from "../_skippy/voicecrew.ts";
import { ALL_TOOLS, EXECUTOR_NAMES } from "../_skippy/agent/tools.ts";
import { directAsk, homeAsk, houseAsk } from "../_skippy/agent/words.ts";
import { readText, type RoomSources } from "../_skippy/toolroute.ts";

/** #1067: "how's the house?" gets one short line from the Haven's own state. Sample data only. */

// Thursday, November 12, 2026, 6:00 PM in Denver; that week's Monday is the 9th.
const NOW = Date.parse("2026-11-13T01:00:00Z");

const device = (d: Partial<DeviceReading> & Pick<DeviceReading, "kind">): DeviceReading => ({ id: d.kind, vendor: "nest", model: "x", place: "x", online: true, state: "idle", alerts: [], ...d });
const thermostat = device({ kind: "thermostat", tempF: 72, humidity: 38, mode: "heat", heatF: 70, hvac: "heating" } as Partial<DeviceReading> & { kind: "thermostat" });
const look = (devices: DeviceReading[], vendors: HomeLook["vendors"] = { nest: "live", roborock: "live", petlibro: "live", whisker: "live" }): HomeLook => ({ vendors, devices });
const fine = homeText(look([thermostat, device({ kind: "vacuum", vendor: "roborock", state: "docked", battery: 100 }), device({ kind: "fountain", vendor: "petlibro", water: 80, filter: 60 } as Partial<DeviceReading> & { kind: "fountain" })]), NOW);

const light = (name: string, on: boolean | null, online = true) => ({ id: name, vendor: "switchbot" as const, name, type: "Bot", on, online });
const lights = (...l: ReturnType<typeof light>[]): LightsView => ({ vendors: { switchbot: "live", govee: "live" }, lights: l, scenes: [], remotes: [] }) as unknown as LightsView;
const plan = { rooms: [{ id: "a", name: "Library", parts: [[0, 0, 100, 100]] }, { id: "b", name: "Kitchen", parts: [[100, 0, 100, 100]] }], lights: [{ name: "Desk lamp", x: 10, y: 10 }, { name: "Floor lamp", x: 50, y: 50 }, { name: "Strip", x: 150, y: 50 }] } as unknown as HavenPlan;

const todo = (id: string, text: string, at: string, extra: Record<string, string> = {}) => ({ id, text, at, updated: at, ...extra });
const todos = (...t: ReturnType<typeof todo>[]): TodoState => ({ todos: t, marks: [] });

const meals = (slot: Record<string, unknown>, start = "2026-11-09"): MealsFile =>
  ({ catalog: [{ id: "tikka", name: "Chicken Tikka" }], week: { start, slots: [{ day: "thu", meal: "tikka", ...slot }] }, ahead: [] }) as unknown as MealsFile;

describe("the house in one line (#1067)", () => {
  it("says it all in one sentence when everything is fine", async () => {
    const s: HouseSources = {
      home: async () => fine,
      lights: async () => lights(light("Desk lamp", true), light("Floor lamp", true), light("Strip", false)),
      plan: async () => plan,
      todos: async () => todos(todo("aaaaaa", "Call the vet", "2026-11-10T00:00:00Z"), todo("bbbbbb", "Buy a filter", "2026-11-11T00:00:00Z"), todo("cccccc", "Water the plants", "2026-11-12T00:00:00Z")),
      meals: async () => meals({}),
    };
    expect(await houseText(s, NOW)).toBe("All quiet: 72 inside, heat set to 70, two lights on in the library, three to-dos, first up water the plants, and it's chicken tikka tonight.");
  });

  it("skips the temperature when Nest is offline, down or not connected", () => {
    expect(climateBit(homeText(look([device({ kind: "thermostat", online: false })]), NOW))).toBeNull();
    expect(climateBit(homeText(look([], { nest: "down" }), NOW))).toBeNull();
    expect(climateBit(homeText(look([], { nest: "waiting" }), NOW))).toBeNull();
    // Hours-old kept lines aren't said as now.
    expect(climateBit(`As of 3 hours ago:\n${fine}`)).toBeNull();
    expect(climateBit(`As of 4 minutes ago:\n${fine}`)).toBe("72 inside, heat set to 70");
    expect(houseLine({ climate: null, lights: "lights all off", todos: "no to-dos", dinner: null, attention: [] })).toBe("All quiet: lights all off and no to-dos.");
  });

  it("reads each thermostat setting", () => {
    const t = (x: Record<string, unknown>) => climateBit(homeText(look([device({ kind: "thermostat", tempF: 68, ...x } as Partial<DeviceReading> & { kind: "thermostat" })]), NOW));
    expect(t({ mode: "cool", coolF: 74 })).toBe("68 inside, AC set to 74");
    expect(t({ mode: "heatcool", heatF: 66, coolF: 76 })).toBe("68 inside, held between 66 and 76");
    expect(t({ mode: "off" })).toBe("68 inside, heat and AC off");
    expect(t({ eco: true, mode: "heat", heatF: 60 })).toBe("68 inside, thermostat on eco");
  });

  it("brings in the vacuum or the cat's devices only when one needs attention", () => {
    expect(attentionOf(fine)).toEqual([]);
    const needs = homeText(
      look([thermostat, device({ kind: "vacuum", vendor: "roborock", state: "error", battery: 40 }), device({ kind: "litter", vendor: "whisker", state: "ready", alerts: ["drawer full"] }), device({ kind: "fountain", vendor: "petlibro", online: false })]),
      NOW,
    );
    expect(attentionOf(needs)).toEqual(["the vacuum needs a look", "the Litter-Robot says drawer full"]);
    expect(houseLine({ climate: "72 inside, heat set to 70", lights: null, todos: "no to-dos", dinner: null, attention: attentionOf(needs) })).toBe("Mostly fine: 72 inside, heat set to 70 and no to-dos. One thing: the vacuum needs a look and the Litter-Robot says drawer full.");
    expect(houseLine({ climate: null, lights: null, todos: null, dinner: null, attention: ["the fountain is offline"] })).toBe("Heads up: the fountain is offline.");
  });

  it("counts the lights, with their rooms only when every one on is placed", () => {
    expect(lightsBit(lights(light("Desk lamp", true), light("Strip", true)), plan)).toBe("two lights on in the library and the kitchen");
    expect(lightsBit(lights(light("Desk lamp", true), light("Unplaced", true)), plan)).toBe("two lights on");
    expect(lightsBit(lights(light("Desk lamp", true)), null)).toBe("one light on");
    expect(lightsBit(lights(light("Desk lamp", false), light("Strip", false)), plan)).toBe("lights all off");
    expect(lightsBit(lights(light("Desk lamp", null), light("Strip", true, false)), plan)).toBeNull();
    expect(lightsBit(null, plan)).toBeNull();
  });

  it("counts the to-dos and says the first one only when it's short and plain", () => {
    expect(todosBit(todos(), NOW)).toBe("no to-dos");
    expect(todosBit(todos(todo("aaaaaa", "Call the vet.", "2026-11-10T00:00:00Z")), NOW)).toBe("one to-do: call the vet");
    // Due ones first, as the Haven lists them; done and snoozed ones don't count.
    const s = todos(todo("aaaaaa", "Newest", "2026-11-12T00:00:00Z"), todo("bbbbbb", "Due soon", "2026-11-01T00:00:00Z", { due: "2026-11-13T03:00:00Z" }), todo("cccccc", "Done", "2026-11-01T00:00:00Z", { done: "2026-11-02T00:00:00Z" }), todo("dddddd", "Later", "2026-11-01T00:00:00Z", { until: "2026-12-01T00:00:00Z" }));
    expect(todosBit(s, NOW)).toBe("two to-dos, first up due soon");
    expect(todosBit(todos(todo("aaaaaa", "Write the long quarterly plan for the whole of next year", "2026-11-10T00:00:00Z")), NOW)).toBe("one to-do");
    expect(todosBit(todos(todo("aaaaaa", "Text 303-555-0100 back", "2026-11-10T00:00:00Z")), NOW)).toBe("one to-do");
    expect(todosBit(null, NOW)).toBeNull();
  });

  it("finds tonight's dinner in today's week on Nikita's clock", () => {
    expect(homeDay(NOW)).toEqual({ day: "thu", monday: "2026-11-09" });
    expect(dinnerBit(meals({}), NOW)).toBe("it's chicken tikka tonight");
    expect(dinnerBit(meals({ helloFresh: true }), NOW)).toBe("HelloFresh tonight");
    expect(dinnerBit(meals({ skip: { dinner: "out" } }), NOW)).toBe("eating out tonight");
    expect(dinnerBit(meals({}, "2026-11-02"), NOW)).toBeNull();
    expect(dinnerBit(null, NOW)).toBeNull();
  });

  it("goes without any piece that fails or is late, and says so plainly when none answers", async () => {
    const late = () => new Promise<never>(() => undefined);
    const s: HouseSources = { home: async () => fine, lights: late, todos: async () => Promise.reject(new Error("x")), meals: async () => meals({}) };
    expect(await houseText(s, NOW, 20)).toBe("All quiet: 72 inside, heat set to 70 and it's chicken tikka tonight.");
    expect(await houseText({ home: late }, NOW, 20)).toBe(NO_HOUSE);
    expect(await houseText({}, NOW)).toBe(NO_HOUSE);
  });

  it("never says the words the call keeps to itself", async () => {
    const line = await houseText({ home: async () => fine, meals: async () => meals({}) }, NOW);
    expect(line).not.toMatch(/\b(?:crew|team|thread|builder|kernel)\b/i);
  });
});

describe("asking for it, on every surface (#1067)", () => {
  it("knows a house check-in from other asks", () => {
    for (const q of ["How's the house?", "how is the house looking", "Hey Skippy, how's home?", "so how are things at home", "everything OK at home?", "what's going on at home", "house check", "check on the apartment", "How's the place doing today?"]) {
      expect(houseAsk(q), q).toBe(true);
      expect(directAsk(q)).toEqual({ tool: "house_check", input: {} });
      expect(homeAsk(q)).toBe(true);
    }
    for (const q of ["how's the house of the dragon finale", "what's the temperature in the apartment", "turn on the lights", "how's the weather", "how's the Green doing"]) expect(houseAsk(q), q).toBe(false);
  });

  it("is a read on every surface: the one brain's tool and quick tier, and the call's own", async () => {
    expect(ALL_TOOLS.find((t) => t.name === "house_check")).toMatchObject({ room: "haven", effect: "read" });
    expect(EXECUTOR_NAMES).toContain("house_check");
    expect(TOOL_DEFS.find((t) => t.name === "read_house")).toMatchObject({ read: "house" });
    const sources = { house: async () => "All quiet: 70 inside." } as unknown as RoomSources;
    expect(await readText("house", sources, NOW)).toBe("All quiet: 70 inside.");
    expect(await readText("house", {} as RoomSources, NOW)).toBe(NO_HOUSE);
  });
});
