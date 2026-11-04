/**
 * The Petlibro devices' day (#685): the fountain's intake, visits and due dates, the wet feeder's visits and today's
 * bowls, the dry feeder's amount and today's schedule. Made-up devices and answers only; nothing from a real account.
 */
import { describe, expect, it } from "vitest";
import { Home } from "./home.ts";
import { count, daysLeft, denverNow, dryPlan, feederDay, fountainDay, petlibroReading, wetMeals } from "./petlibro.ts";

// 11:00 in Denver (MST) on a made-up Wednesday.
const NOW = Date.parse("2026-11-04T18:00:00Z");

describe("the Petlibro day's numbers (#685)", () => {
  it("takes counts and days only when they have the expected shape", () => {
    expect([count(5), count("12"), count(-1), count("lots"), count(null), count(9e9)]).toEqual([5, 12, undefined, undefined, undefined, undefined]);
    expect([daysLeft(-2), daysLeft("4"), daysLeft("soon"), daysLeft(undefined), daysLeft(99_999)]).toEqual([-2, 4, undefined, undefined, undefined]);
    expect(denverNow(NOW)).toEqual({ minutes: 11 * 60, weekday: 3 });
  });

  it("reads the fountain's day, its filter and cleaning days, overdue below zero", () => {
    expect(fountainDay({ todayTotalMl: 240, todayTotalTimes: 7, petEatingTime: 140, avgDrinkDuration: 20 })).toEqual({ drankMl: 240, visits: 7, visitSec: 140, avgSec: 20 });
    expect(fountainDay(null)).toEqual({});
    const r = petlibroReading("00000000000f", "fountain", { productName: "Test Fountain", online: true }, { online: true, weightPercent: 35, remainingReplacementDays: -2, filterReplacementFrequency: 30, remainingCleaningDays: -2 }, { drink: { todayTotalMl: 240, todayTotalTimes: 7, avgDrinkDuration: 20 } }, NOW);
    expect(r).toMatchObject({ water: 35, filter: 0, filterDays: -2, cleanDays: -2, drankMl: 240, visits: 7, avgSec: 20, state: "running" });
    expect(r.alerts).toEqual(["filter due", "needs a clean"]);
    // Without the drink read or the day counts, the fields are simply absent.
    const bare = petlibroReading("00000000000f", "fountain", { productName: "Test Fountain" }, { online: true, weightPercent: 80 }, { drink: null }, NOW);
    expect(bare).not.toHaveProperty("drankMl");
    expect(bare).not.toHaveProperty("filterDays");
  });

  it("reads a feeder's day from grainStatus: portions and dispenses for the dry one, visits for either", () => {
    expect(feederDay({ todayFeedingQuantity: 4, todayFeedingTimes: 2, todayFeedingQuantities: [2, 2] }, "dry-feeder")).toEqual({ fedPortions: 4, feeds: 2 });
    expect(feederDay({ todayEatingTimes: 5, petEatingTime: 124 }, "wet-feeder")).toEqual({ visits: 5, visitSec: 124 });
    expect(feederDay({ todayFeedingQuantity: "n/a" }, "wet-feeder")).toEqual({});
  });

  it("lays out the wet bowls for today by the clock: served, open now, next", () => {
    const wet = {
      plan: [
        { plate: 1, executionStartTime: "07:00", executionEndTime: "09:00" },
        { plate: 2, executionStartTime: "10:30", executionEndTime: "12:30" },
        { plate: 3, executionStartTime: "18:00", executionEndTime: "20:00" },
      ],
    };
    expect(wetMeals(wet, NOW)).toEqual([
      { time: "07:00", end: "09:00", plate: 1, status: "done" },
      { time: "10:30", end: "12:30", plate: 2, status: "now" },
      { time: "18:00", end: "20:00", plate: 3, status: "next" },
    ]);
    // Without now, the plan as the rails read it: times, bowls and ends, no status.
    expect(wetMeals(wet)[0]).toEqual({ time: "07:00", end: "09:00", plate: 1 });
    const r = petlibroReading("00000000000e", "wet-feeder", { productName: "Test Wet Feeder" }, { online: true }, { wet, grain: { todayEatingTimes: 5, petEatingTime: 124 } }, NOW);
    expect(r).toMatchObject({ visits: 5, visitSec: 124, state: "closed" });
  });

  it("builds the dry feeder's plan for today from todayNew and the schedule", () => {
    const list = [
      { id: 11, executionTime: "05:00", grainNum: 2, enable: true, repeatDay: "[1,2,3,4,5,6,7]" },
      { id: 12, executionTime: "21:00", grainNum: 2, enable: true, repeatDay: "[1,2,3,4,5,6,7]" },
      { id: 13, executionTime: "13:00", grainNum: 1, enable: false, repeatDay: "[3]" },
      { id: 14, executionTime: "15:00", grainNum: 1, enable: true, repeatDay: "[6,7]" },
    ];
    const today = { allSkipped: false, plans: [{ planId: 11, time: "05:00", grainNum: 2, state: 3 }, { planId: 12, time: "21:00", grainNum: 2, state: 1 }] };
    expect(dryPlan(list, today, NOW)).toEqual([
      { time: "05:00", portions: 2, on: true, status: "done" },
      { time: "13:00", portions: 1, on: false },
      { time: "21:00", portions: 2, on: true, status: "next" },
    ]);
    // Without todayNew, the schedule's meals for today's weekday, by the clock.
    expect(dryPlan(list, null, NOW)).toEqual([
      { time: "05:00", portions: 2, on: true },
      { time: "13:00", portions: 1, on: false },
      { time: "21:00", portions: 2, on: true, status: "next" },
    ]);
    // Petlibro's skip states.
    expect(dryPlan([], { plans: [{ planId: 1, time: "12:00", grainNum: 1, state: 2 }, { planId: 2, time: "06:00", state: 4 }] }, NOW).map((m) => m.status)).toEqual(["skipped", "skip"]);
    expect(dryPlan("nonsense", { plans: "nope" }, NOW)).toEqual([]);
    const r = petlibroReading("00000000000d", "dry-feeder", { productName: "Test Feeder" }, { online: true, surplusGrain: true, unitType: 1 }, { grain: { todayFeedingQuantity: 2, todayFeedingTimes: 1 }, plans: list, today }, NOW);
    expect(r).toMatchObject({ fedPortions: 2, feeds: 1, feedUnit: "cup" });
    expect(r.plan).toHaveLength(3);
  });

  it("keeps the public face to kinds and states", () => {
    const fountain = petlibroReading("00000000000f", "fountain", { productName: "Test Fountain" }, { online: true, remainingReplacementDays: -2 }, { drink: { todayTotalMl: 240 } }, NOW);
    const dry = petlibroReading("00000000000d", "dry-feeder", { productName: "Test Feeder" }, { online: true }, { plans: [{ id: 1, executionTime: "21:00", grainNum: 2, enable: true, repeatDay: "[]" }] }, NOW);
    const pub = Home.publicOf({ vendors: { roborock: "waiting", petlibro: "live", whisker: "waiting", nest: "waiting" }, problems: {}, devices: [fountain, dry], feedCap: 2 });
    expect(pub.devices).toEqual([{ kind: "fountain", state: "running", online: true }, { kind: "dry-feeder", state: "idle", online: true }]);
    expect(JSON.stringify(pub)).not.toMatch(/21:00|240|plan|Test/);
  });
});
