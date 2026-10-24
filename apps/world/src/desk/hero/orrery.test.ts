import { describe, expect, it } from "vitest";
import { roman } from "../todaySchedule.ts";
import { dialAngle, planetAngle, shellOf } from "./orrery.ts";

describe("the astrolabe (#385)", () => {
  it("sets midnight at the foot of the dial, noon at the top, the morning on the left", () => {
    const at = (h: number) => {
      const a = dialAngle(h);
      return [Math.round(Math.cos(a) * 1000) / 1000 + 0, Math.round(Math.sin(a) * 1000) / 1000 + 0];
    };
    expect(at(0)).toEqual([0, 1]);
    expect(at(6)).toEqual([-1, 0]);
    expect(at(12)).toEqual([0, -1]);
    expect(at(18)).toEqual([1, 0]);
  });

  it("puts real work on the inner orbit, waiting rooms in the middle, rooms not set up outside", () => {
    expect(shellOf({ real: true, state: "busy" })).toBe(0);
    expect(shellOf({ real: true, state: "steady" })).toBe(0);
    expect(shellOf({ real: true, state: "down" })).toBe(0);
    expect(shellOf({ real: true, state: "waiting" })).toBe(1);
    expect(shellOf({ real: false, state: "sim" })).toBe(2);
  });

  it("spaces a shell's planets evenly and turns them together", () => {
    const a = planetAngle(0, 0, 4, 0);
    expect(planetAngle(0, 1, 4, 0) - a).toBeCloseTo(Math.PI / 2);
    expect(planetAngle(0, 1, 4, 100) - planetAngle(0, 0, 4, 100)).toBeCloseTo(Math.PI / 2);
  });

  it("writes the hour in the chart's numerals", () => {
    expect(roman(21)).toBe("XXI");
    expect(roman(9)).toBe("IX");
    expect(roman(14)).toBe("XIV");
    expect(roman(24)).toBe("XXIV");
    expect(roman(0)).toBe("XXIV");
  });
});
