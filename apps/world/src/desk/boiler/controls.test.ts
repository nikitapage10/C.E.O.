import { describe, expect, it } from "vitest";
import { actionOf, actionWord, costumeState, meterTone, monthClock, pipeOf, projectMonth, quietState, shareWidths, SKIPPY_AGENT_CAP_USD, SKIPPY_AGENT_WARN_USD, TONE_WORD } from "./controls.ts";

const at = (s: string) => Date.parse(s);

describe("Controls: the meters", () => {
  it("turns amber at 80% and red at the cap, and waits without data", () => {
    expect(meterTone(7.99, 10)).toBe("ok");
    expect(meterTone(8, 10)).toBe("warn");
    expect(meterTone(10, 10)).toBe("over");
    expect(meterTone(12, 10)).toBe("over");
    expect(meterTone(null, 10)).toBe("wait");
    expect(meterTone(3, null)).toBe("wait");
    expect(meterTone(3, 0)).toBe("wait");
  });

  it("warns Skippy's agent at $50 of its $60", () => {
    expect(meterTone(49.99, SKIPPY_AGENT_CAP_USD, SKIPPY_AGENT_WARN_USD)).toBe("ok");
    expect(meterTone(50, SKIPPY_AGENT_CAP_USD, SKIPPY_AGENT_WARN_USD)).toBe("warn");
    expect(meterTone(60, SKIPPY_AGENT_CAP_USD, SKIPPY_AGENT_WARN_USD)).toBe("over");
  });

  it("counts the days left in the UTC month, today included", () => {
    expect(monthClock(at("2026-11-04T05:00:00Z"))).toMatchObject({ daysLeft: 27, days: 30 });
    expect(monthClock(at("2026-11-30T23:00:00Z")).daysLeft).toBe(1);
    expect(monthClock(at("2026-02-01T00:00:00Z"))).toMatchObject({ daysLeft: 28, days: 28, elapsed: 0 });
  });

  it("projects the month-end at this pace, never from less than a day", () => {
    expect(projectMonth(5, at("2026-11-16T00:00:00Z"))).toBeCloseTo(10, 5);
    // An hour into the month counts as a whole day: $0.10 → $3, not $72.
    expect(projectMonth(0.1, at("2026-11-01T01:00:00Z"))).toBeCloseTo(3, 5);
  });

  it("lays the shares end to end and stops the bar at the cap", () => {
    expect(shareWidths([{ id: "a", label: "", usd: 2 }, { id: "b", label: "", usd: 3 }], 10)).toEqual([
      { id: "a", from: 0, width: 0.2 },
      { id: "b", from: 0.2, width: 0.3 },
    ]);
    const over = shareWidths([{ id: "a", label: "", usd: 8 }, { id: "b", label: "", usd: 5 }], 10);
    expect(over[1]).toEqual({ id: "b", from: 0.8, width: expect.closeTo(0.2, 5) as number });
  });

  it("says a state, never a figure, for the signed-out view", () => {
    for (const w of Object.values(TONE_WORD)) expect(w).not.toMatch(/[$\d]/);
  });
});

describe("Controls: the breakers", () => {
  it("knows the quiet hours (10 pm to 7 am Mountain) and when they change", () => {
    // 05:00 UTC on Nov 4 is 10 pm on Nov 3 in Denver (MST): just inside.
    const q = quietState(at("2026-11-04T05:30:00Z"));
    expect(q.on).toBe(true);
    expect(q.next).toBe(at("2026-11-04T14:00:00Z"));
    expect(q.changed).toBe(at("2026-11-04T05:00:00Z"));
    const day = quietState(at("2026-11-04T18:00:00Z"));
    expect(day.on).toBe(false);
    expect(day.next).toBe(at("2026-11-05T05:00:00Z"));
  });

  it("opens the costume party on Halloween night and remembers when it closed", () => {
    expect(costumeState(at("2026-11-01T02:00:00Z"))).toEqual({ on: true, changed: at("2026-11-01T00:00:00Z") });
    expect(costumeState(at("2026-11-04T12:00:00Z"))).toEqual({ on: false, changed: at("2026-11-01T06:00:00Z") });
    expect(costumeState(at("2026-06-01T12:00:00Z"))).toEqual({ on: false, changed: at("2025-11-01T06:00:00Z") });
  });
});

describe("Controls: the connections", () => {
  it("offers Gmail's own connect, a key for the keyed links, and nothing for read-only feeds", () => {
    expect(actionWord(actionOf("gmail"), "ok")).toBe("Disconnect");
    expect(actionWord(actionOf("gmail"), "off")).toBe("Connect");
    expect(actionWord(actionOf("gmail"), "down")).toBe("Reconnect");
    expect(actionWord(actionOf("fantasypros"), "off")).toBe("Connect · set key");
    expect(actionWord(actionOf("paypal"), "down")).toBe("Reconnect · replace key");
    expect(actionWord(actionOf("polymarket"), "ok")).toBeNull();
    expect(pipeOf("world")).toBe("boiler");
    expect(pipeOf("relay")).toBe("relay");
  });
});
