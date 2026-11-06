import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { readPlan } from "../../../api/_haven/planShape.ts";
import { gymBeyond } from "./gymFill.ts";
import { placeLights, type Light } from "./lights.ts";

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
