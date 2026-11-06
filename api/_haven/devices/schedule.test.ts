/**
 * When the home's devices run next (#952): the wet plan in every shape it has been seen in, the next wet and dry meal in
 * words, the Roborock app's schedules, and the home's lines that Skippy reads them from. Synthetic answers only.
 */
import { describe, expect, it } from "vitest";
import { deviceOf, homeText } from "./homeread.ts";
import { wetMeals, wetPlanShape, shapeLine } from "./petlibro.ts";
import { cronSchedule, dryNextWords, nextVacRun, roborockSchedules, vacScheduleWords, wetNextWords } from "./schedule.ts";
import type { DeviceReading } from "./types.ts";

// 11:00 in Denver (MST) on a made-up Wednesday, 2026-11-04.
const NOW = Date.parse("2026-11-04T18:00:00Z");
const MEALS = [
  { plate: 1, executionStartTime: "07:00", executionEndTime: "09:00" },
  { plate: 2, executionStartTime: "18:00", executionEndTime: "20:00" },
];

describe("the wet plan, in every shape it comes in (#952)", () => {
  it("reads the integration's own shape", () => {
    expect(wetMeals({ templateName: "Made-up", plan: MEALS }, NOW).map((m) => [m.time, m.status])).toEqual([
      ["07:00", "done"],
      ["18:00", "next"],
    ]);
  });
  it("reads a plan sent as JSON text, under another name, or wrapped", () => {
    expect(wetMeals({ plan: JSON.stringify(MEALS) }, NOW)).toHaveLength(2);
    expect(wetMeals({ planList: MEALS }, NOW)).toHaveLength(2);
    expect(wetMeals({ data: { plan: MEALS } }, NOW)).toHaveLength(2);
    expect(wetMeals(MEALS, NOW)).toHaveLength(2);
  });
  it("reads a list of templates, taking the one in use", () => {
    const other = [{ plate: 3, executionStartTime: "12:00" }];
    expect(wetMeals([{ templateName: "Old", enable: false, plan: other }, { templateName: "Now", enable: true, plan: MEALS }], NOW).map((m) => m.time)).toEqual(["07:00", "18:00"]);
    expect(wetMeals({ templates: null, list: [{ templateName: "Only", plan: MEALS }] }, NOW)).toHaveLength(2);
  });
  it("says Petlibro's code when it refuses the plan to the Haven's account", () => {
    const s = wetPlanShape(null, true, 1201);
    expect(s).toMatchObject({ read: "failed", code: 1201 });
    expect(shapeLine(s)).toContain("code=1201");
  });
});

const wet = (over: Partial<DeviceReading> = {}): DeviceReading => ({ id: "w", vendor: "petlibro", kind: "wet-feeder", model: "Wet", place: "Kitchen", online: true, state: "closed", alerts: [], ...over });

describe("the next meal in words (#952)", () => {
  it("names the next wet meal and its bowl, or the meal that's on", () => {
    expect(wetNextWords(wet({ meals: wetMeals({ plan: MEALS }, NOW) }))).toBe("The next wet meal is at 6pm, bowl 2.");
    expect(wetNextWords(wet({ meals: wetMeals({ plan: MEALS }, Date.parse("2026-11-04T15:00:00Z")) }))).toBe("The wet food feeder's meal is on now, bowl 1, until 9am.");
    expect(wetNextWords(wet({ meals: wetMeals({ plan: MEALS }, Date.parse("2026-11-05T04:00:00Z")) }))).toBe("That's all of today's wet meals; the next is tomorrow at 7am, bowl 1.");
  });
  it("falls back on the device list's own next meal, and says plainly when there's none", () => {
    expect(wetNextWords(wet({ nextFeed: { time: "17:30" } }))).toBe("The next wet meal is at 5:30pm.");
    expect(wetNextWords(wet())).toMatch(/No schedule visible/);
    expect(wetNextWords(wet({ planOn: false }))).toMatch(/switched off/);
  });
  it("names the next dry meal", () => {
    const dry = { online: true, plan: [{ time: "08:00", portions: 2, on: true, status: "done" as const }, { time: "17:00", portions: 1, on: true, status: "next" as const }] };
    expect(dryNextWords(dry)).toBe("The next dry meal is at 5pm, 1 portion.");
  });
});

describe("the vacuum's schedule from the Roborock app (#952)", () => {
  it("reads repeating and one-off cron lines", () => {
    expect(cronSchedule("0 9 * * 1,3,5", true)).toEqual({ time: "09:00", days: [1, 3, 5], on: true });
    expect(cronSchedule("30 14 ? * *", false)).toEqual({ time: "14:30", days: [], on: false });
    expect(cronSchedule("03 13 15 12 ?", true)).toEqual({ time: "13:03", days: [], once: "12-15", on: true });
    expect(cronSchedule("nonsense", true)).toBeNull();
    expect(roborockSchedules({ success: true, result: [{ id: 1, cron: "0 9 * * 1,3,5", enabled: true }, { cron: 4 }] })).toHaveLength(1);
  });
  it("finds the next run, in Denver's days", () => {
    // Wednesday 11:00: a 9:00 Mon/Wed/Fri clean already ran today, so Friday's is next.
    expect(nextVacRun([{ time: "09:00", days: [1, 3, 5], on: true }], NOW)).toEqual({ inDays: 2, time: "09:00" });
    expect(nextVacRun([{ time: "15:00", days: [], on: true }], NOW)).toEqual({ inDays: 0, time: "15:00" });
    expect(nextVacRun([{ time: "15:00", days: [], on: false }], NOW)).toBeNull();
  });
  it("says it in one sentence", () => {
    expect(vacScheduleWords({ online: true, schedule: [{ time: "09:00", days: [1, 3, 5], on: true }] }, NOW)).toBe("The vacuum's next scheduled clean is on Friday at 9am.");
    expect(vacScheduleWords({ online: true, schedule: [] }, NOW)).toMatch(/no cleaning schedule/);
    expect(vacScheduleWords({ online: true }, NOW)).toMatch(/didn't come back/);
  });
});

describe("the home's lines carry each device's next run, and one device can be read alone (#952)", () => {
  const view = {
    vendors: { petlibro: "live" as const, roborock: "live" as const },
    devices: [
      { id: "v", vendor: "roborock" as const, kind: "vacuum" as const, model: "Vac", place: "Hall", online: true, state: "docked", alerts: [], schedule: [{ time: "09:00", days: [5], on: true }] },
      wet({ meals: wetMeals({ plan: MEALS }, NOW) }),
    ],
  };
  it("puts the schedule in each line", () => {
    const text = homeText(view, NOW);
    expect(text).toContain("The vacuum's next scheduled clean is on Friday at 9am.");
    expect(text).toContain("The next wet meal is at 6pm, bowl 2.");
    expect(deviceOf(text, "wet-feeder")).toMatch(/^The wet food feeder.*6pm/);
    expect(deviceOf(text, "vacuum")).toMatch(/^The vacuum is docked/);
    expect(deviceOf("The feeders' cloud (Petlibro) isn't answering right now.", "feeders")).toMatch(/Petlibro/);
  });
});
