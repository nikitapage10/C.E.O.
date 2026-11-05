import { describe, expect, it } from "vitest";
import { deskLoadBody } from "./deskBeacon.ts";
import { isDeskLoadsView } from "./DeskTimings.tsx";

const load = { at: "2026-10-29T10:00:00.000Z", firstPaint: 400, dataReady: 1500 };

describe("the Boiler Room's Desk timings (#561)", () => {
  it("checks the answer's shape", () => {
    expect(isDeskLoadsView({ ok: true, loads: [load] })).toBe(true);
    expect(isDeskLoadsView({ ok: true, loads: [] })).toBe(true);
    expect(isDeskLoadsView({ ok: true, loads: [{ at: "x" }] })).toBe(false);
    expect(isDeskLoadsView({ ok: true, loads: [{ ...load, dataReady: "1" }] })).toBe(false);
    expect(isDeskLoadsView({ error: "not-set-up" })).toBe(false);
    expect(isDeskLoadsView(null)).toBe(false);
  });
  it("sends two rounded numbers, data never before paint", () => {
    expect(deskLoadBody(400.4, 1500.6)).toEqual({ firstPaint: 400, dataReady: 1501 });
    expect(deskLoadBody(900, 300)).toEqual({ firstPaint: 900, dataReady: 900 });
    expect(deskLoadBody(NaN, 1)).toBeNull();
    expect(deskLoadBody(1, -1)).toBeNull();
  });
});
