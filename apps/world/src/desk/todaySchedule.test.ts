import { describe, expect, it } from "vitest";
import { along, isQuiet, nextMountain, occurrences, quietBands, until, upcoming } from "./todaySchedule.ts";

const at = (s: string) => Date.parse(s);
const HOUR = 3_600_000;

describe("Today's little schedule (#363)", () => {
  it("lists the crew's runs soonest first, with Ilyr's hour when the clock gives one", () => {
    const now = at("2026-10-24T03:10:00Z"); // 9:10 pm in Denver (MDT)
    const runs = upcoming(now, at("2026-10-24T04:05:00Z"));
    expect(runs.map((r) => r.key)).toEqual(["queue", "hour", "story", "upkeep", "ideas"]);
    expect(new Date(runs[0]!.at).toISOString()).toBe("2026-10-24T03:21:00.000Z");
    // The story is after midnight, Mountain.
    expect(new Date(runs.find((r) => r.key === "story")!.at).toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(upcoming(now, null).some((r) => r.key === "hour")).toBe(false);
    expect(upcoming(now, now - 1).some((r) => r.key === "hour")).toBe(false);
  });

  it("says how far along a wait is, and every time a run comes round in a window", () => {
    const now = at("2026-10-24T03:10:00Z");
    const q = upcoming(now, null)[0]!;
    expect(along(q, now)).toBeCloseTo(4 / 15, 5);
    const ticks = occurrences(q, now, 2 * HOUR);
    expect(ticks).toHaveLength(8);
    expect(ticks.every((t) => t >= now && t < now + 2 * HOUR)).toBe(true);
  });

  it("shades the quiet hours, 10 PM to 7 AM Mountain", () => {
    const evening = at("2026-10-24T02:00:00Z"); // 8 pm Denver
    expect(isQuiet(evening)).toBe(false);
    const bands = quietBands(evening, 12 * HOUR);
    expect(bands).toHaveLength(1);
    expect(new Date(bands[0]![0]).toISOString()).toBe("2026-10-24T04:00:00.000Z");
    expect(new Date(bands[0]![1]).toISOString()).toBe("2026-10-24T13:00:00.000Z");
    const night = at("2026-10-24T08:00:00Z"); // 2 am Denver
    expect(isQuiet(night)).toBe(true);
    expect(quietBands(night, 2 * HOUR)[0]).toEqual([night, night + 2 * HOUR]);
    expect(new Date(nextMountain(evening, 22)).toISOString()).toBe("2026-10-24T04:00:00.000Z");
  });

  it("counts down plainly", () => {
    const now = 1_000_000_000;
    expect(until(now, now)).toBe("now");
    expect(until(now + 45_000, now, true)).toBe("in 45 s");
    expect(until(now + 7 * 60_000, now)).toBe("in 7 min");
    expect(until(now + 130 * 60_000, now)).toBe("in 2 h 10 min");
  });
});
