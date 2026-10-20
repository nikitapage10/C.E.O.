import { describe, expect, it } from "vitest";
import { countdown, nextRuns } from "./crewRuns.ts";

const iso = (s: string) => nextRuns(new Date(s));

describe("crew runs (#205)", () => {
  it("queue checks step through :06 :21 :36 :51 and roll over the hour", () => {
    expect(iso("2026-10-20T10:00:00Z").queue.toISOString()).toBe("2026-10-20T10:06:00.000Z");
    expect(iso("2026-10-20T10:06:00Z").queue.toISOString()).toBe("2026-10-20T10:21:00.000Z");
    expect(iso("2026-10-20T10:51:00Z").queue.toISOString()).toBe("2026-10-20T11:06:00.000Z");
    expect(iso("2026-10-20T23:55:00Z").queue.toISOString()).toBe("2026-10-21T00:06:00.000Z");
  });

  it("upkeep runs every 5 h from the anchor", () => {
    expect(iso("2026-10-13T20:50:00Z").upkeep.toISOString()).toBe("2026-10-13T20:51:00.000Z");
    expect(iso("2026-10-13T20:51:00Z").upkeep.toISOString()).toBe("2026-10-14T01:51:00.000Z");
    expect(iso("2026-10-13T20:52:00Z").upkeep.toISOString()).toBe("2026-10-14T01:51:00.000Z");
    expect(iso("2026-10-20T10:00:00Z").upkeep.toISOString()).toBe("2026-10-20T12:51:00.000Z");
  });

  it("morning ideas are 9:00 Denver, before and after the hour", () => {
    expect(iso("2026-10-20T14:59:00Z").ideas.toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(iso("2026-10-20T15:00:00Z").ideas.toISOString()).toBe("2026-10-21T15:00:00.000Z");
  });

  it("morning ideas follow the DST change on 2026-11-01", () => {
    expect(iso("2026-10-31T16:00:00Z").ideas.toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(iso("2026-11-01T16:00:00Z").ideas.toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(iso("2026-11-01T15:00:00Z").ideas.toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(iso("2027-03-13T16:30:00Z").ideas.toISOString()).toBe("2027-03-14T15:00:00.000Z");
  });

  it("counts down in the Desk's style", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(countdown(new Date("2026-10-20T12:10:00Z"), now, true)).toBe("in about 2 h 10 min");
    expect(countdown(new Date("2026-10-20T10:06:00Z"), now)).toBe("in 6 min");
  });
});
