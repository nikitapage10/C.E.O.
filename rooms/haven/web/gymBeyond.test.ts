import { describe, expect, it } from "vitest";
import { FAKE_PLAN } from "../../../api/_haven/plan.fixture.ts";
import { gymBeyond, gymRoom } from "./gymFill.ts";

/** The Gym drawn beyond the home (#729), on the made-up plan. */
describe("the Gym beyond the home", () => {
  const out = gymBeyond(FAKE_PLAN);
  const bounds = (rooms: typeof out.rooms) => {
    const xs = rooms.flatMap((r) => r.parts.flatMap(([x, , w]) => [x, x + w]));
    const ys = rooms.flatMap((r) => r.parts.flatMap(([, y, , h]) => [y, y + h]));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  it("moves the detached block to the far side, its right edge with the home's, nothing below zero", () => {
    const home = bounds(out.rooms.filter((r) => !r.detached));
    const gym = bounds([gymRoom(out)!]);
    expect(gym[3]).toBeLessThan(home[1]!);
    expect(gym[2]).toBe(home[2]);
    expect(Math.min(gym[0]!, gym[1]!, home[0]!, home[1]!)).toBeGreaterThanOrEqual(0);
    expect(out.w).toBeGreaterThanOrEqual(home[2]!);
    expect(out.h).toBeGreaterThanOrEqual(home[3]!);
    expect(out.path).toEqual([]);
  });
  it("keeps the kit inside the gym and the home's rooms where they stood, shifted together", () => {
    const g = gymRoom(out)!;
    const [gx, gy, gw, gh] = g.parts[0]!;
    const kit = out.items.filter((i) => ["rack", "bench", "treadmill", "bike"].includes(i.k));
    expect(kit.length).toBeGreaterThan(0);
    for (const i of kit) {
      expect(i.x).toBeGreaterThanOrEqual(gx);
      expect(i.y).toBeGreaterThanOrEqual(gy);
      expect(i.x + i.w).toBeLessThanOrEqual(gx + gw);
      expect(i.y + i.h).toBeLessThanOrEqual(gy + gh);
    }
    const before = FAKE_PLAN.rooms.find((r) => r.id === "kitchen")!.parts[0]!;
    const after = out.rooms.find((r) => r.id === "kitchen")!.parts[0]!;
    expect(after[0]! - before[0]!).toBe(0);
    expect(after[1]! - before[1]!).toBeGreaterThan(0);
  });
  it("leaves a plan alone with no detached block, and is drawing only (the input is untouched)", () => {
    const flat = { ...FAKE_PLAN, rooms: FAKE_PLAN.rooms.filter((r) => !r.detached) };
    expect(gymBeyond(flat)).toBe(flat);
    expect(gymRoom(FAKE_PLAN)!.parts[0]).toEqual([180, 900, 640, 360]);
    expect(gymBeyond(out)).toBe(out);
  });
});
