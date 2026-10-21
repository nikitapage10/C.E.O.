import { describe, expect, it } from "vitest";
import { mountainClock, previousWeek, weekDaysOf, weekDue, weekStartOf } from "./weeks.ts";

describe("weeks", () => {
  it("names a week by its Monday", () => {
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19"); // a Monday
    expect(weekStartOf("2026-10-21")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19"); // the Sunday closes the week
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26"); // across a month
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28"); // across a year
  });

  it("lists the seven days, Monday first, and the week before", () => {
    expect(weekDaysOf("2026-10-26")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(previousWeek("2026-10-19")).toBe("2026-10-12");
  });

  it("reads Mountain time, daylight saving included", () => {
    expect(mountainClock(Date.parse("2026-10-26T00:30:00Z"))).toEqual({ day: "2026-10-25", weekday: 0, hour: 18 }); // MDT, UTC-6
    expect(mountainClock(Date.parse("2026-11-02T01:30:00Z"))).toEqual({ day: "2026-11-01", weekday: 0, hour: 18 }); // MST, UTC-7
  });

  it("is due on Sunday from 6 pm Mountain, and not before or on other days", () => {
    expect(weekDue(Date.parse("2026-10-25T23:59:00Z"))).toBeNull(); // Sunday 5:59 pm
    expect(weekDue(Date.parse("2026-10-26T00:00:00Z"))).toBe("2026-10-19"); // Sunday 6 pm
    expect(weekDue(Date.parse("2026-10-26T05:30:00Z"))).toBe("2026-10-19"); // Sunday 11:30 pm
    expect(weekDue(Date.parse("2026-10-26T06:00:00Z"))).toBeNull(); // Monday midnight
    expect(weekDue(Date.parse("2026-10-24T02:00:00Z"))).toBeNull(); // Friday night
    expect(weekDue(Date.parse("2026-11-02T01:00:00Z"))).toBe("2026-10-26"); // MST Sunday 6 pm
  });
});
