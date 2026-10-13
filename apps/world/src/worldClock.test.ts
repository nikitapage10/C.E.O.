import { describe, expect, it } from "vitest";
import { CLOCK_DOWN_MS, CLOCK_SLOW_MS, clockHeadline, clockLoad, clockState, clockTime, nextLine, span } from "./worldClock.ts";

const MIN = 60_000;
/** 10:05 am Mountain on 13 October 2026. */
const T0 = Date.parse("2026-10-13T16:05:00Z");
const reading = { at: new Date(T0).toISOString(), nextAt: new Date(T0 + 55 * MIN).toISOString() };

describe("the world clock's state", () => {
  it("is working while the last step is under 70 minutes old", () => {
    expect(clockState(reading, "ready", T0 + 1 * MIN)).toBe("ok");
    expect(clockState(reading, "ready", T0 + 69 * MIN)).toBe("ok");
  });

  it("goes slow (amber) once an hour is overdue, and down past three hours", () => {
    expect(clockState(reading, "ready", T0 + CLOCK_SLOW_MS)).toBe("slow");
    expect(clockState(reading, "ready", T0 + 2 * 60 * MIN)).toBe("slow");
    expect(clockState(reading, "ready", T0 + CLOCK_DOWN_MS)).toBe("down");
    expect(clockState(reading, "ready", T0 + 4 * 60 * MIN)).toBe("down");
  });

  it("is down when the endpoint fails, even with an earlier good reading", () => {
    expect(clockState(reading, "failed", T0 + MIN)).toBe("down");
    expect(clockState(null, "failed", T0)).toBe("down");
  });

  it("is off before the first answer, before the first step, and where the world isn't saving", () => {
    expect(clockState(null, "idle", T0)).toBe("off");
    expect(clockState(null, "off", T0)).toBe("off");
    expect(clockState({ at: null }, "ready", T0)).toBe("off");
  });
});

describe("the world clock's words", () => {
  it("says the headline for each state", () => {
    expect(clockHeadline(reading, "ready", T0 + 10 * MIN)).toBe("On time");
    expect(clockHeadline(reading, "ready", T0 + 95 * MIN)).toBe("An hour is overdue: 1 h 35 min since the last");
    expect(clockHeadline(reading, "ready", T0 + 4 * 60 * MIN)).toBe("Stalled: 4 h since the last hour");
    expect(clockHeadline(reading, "failed", T0)).toBe("The clock isn't answering");
    expect(clockHeadline({ at: null }, "ready", T0)).toBe("No hour taken yet");
    expect(clockHeadline(null, "off", T0)).toBe("Not running here");
  });

  it("says when the next hour is due", () => {
    expect(nextLine(reading, T0 + 23 * MIN)).toBe("in 32 min");
    expect(nextLine(reading, T0 + 62 * MIN)).toBe("any minute now");
    expect(nextLine(reading, T0 + 80 * MIN)).toBe("overdue by 25 min");
    expect(nextLine({ at: null, nextAt: null }, T0)).toBe("After the first step");
  });

  it("formats spans and Mountain times", () => {
    expect(span(0)).toBe("0 min");
    expect(span(-5 * MIN)).toBe("0 min");
    expect(span(65 * MIN)).toBe("1 h 05 min");
    expect(span(180 * MIN)).toBe("3 h");
    expect(clockTime(reading.at)).toBe("10:05 am");
  });

  it("fills the pipe's gauge toward overdue", () => {
    expect(clockLoad(null, T0)).toBe(0);
    expect(clockLoad(reading, T0 + 35 * MIN)).toBeCloseTo(0.5);
    expect(clockLoad(reading, T0 + 5 * 60 * MIN)).toBe(1);
  });
});
