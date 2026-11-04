import { describe, expect, it } from "vitest";
import { irisLayout, lidHeightAt } from "./layout.ts";
import { MANNERS, signature, SKIPPY_MANNER, STILL_MANNER } from "./manner.ts";
import { ROOM_ORDER } from "../roomPulse.ts";

describe("the Iris layout", () => {
  for (const [w, h, phone] of [
    [900, 840, false],
    [358, 380, true],
  ] as const) {
    const L = irisLayout(w, h, ROOM_ORDER, phone);
    it(`seats the ten round the pupil, first at twelve o'clock (${w}×${h})`, () => {
      expect(L.seats.map((s) => s.id)).toEqual([...ROOM_ORDER]);
      expect(L.seats[0]!.x).toBeCloseTo(L.cx);
      expect(L.seats[0]!.y).toBeCloseTo(L.cy - L.r);
      for (const s of L.seats) expect(Math.hypot(s.x - L.cx, s.y - L.cy)).toBeCloseTo(L.r);
    });
    it(`keeps every seat inside the eye and on the stage (${w}×${h})`, () => {
      for (const s of L.seats) {
        expect(Math.abs(s.y - L.cy) + L.member * 0.3).toBeLessThan(lidHeightAt(L, s.x));
        expect(s.x - L.member / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + L.member / 2).toBeLessThanOrEqual(w);
        expect(s.y - L.member / 2).toBeGreaterThanOrEqual(0);
      }
      // Skippy fits inside the ring with room to spare.
      expect(L.skippy / 2 + L.member / 2).toBeLessThan(L.r);
    });
  }
});

describe("the Council's manners", () => {
  it("every submind has its own, and no two move alike", () => {
    const sigs = ROOM_ORDER.map((r) => signature(MANNERS[r]));
    expect(new Set(sigs).size).toBe(ROOM_ORDER.length);
    expect(sigs).not.toContain(signature(SKIPPY_MANNER));
  });
  it("the Pessimist sighs and is slow; the Commentator bounces; the Life of the Party spins", () => {
    expect(MANNERS.boiler.sighEvery).toBeGreaterThan(0);
    expect(MANNERS.boiler.tempo).toBeLessThan(0.6);
    expect(MANNERS.green.bounce).toBeGreaterThan(0.05);
    expect(MANNERS.breakroom.spinEvery).toBeGreaterThan(0);
  });
  it("one that isn't active holds still", () => {
    expect(STILL_MANNER.tempo).toBe(0);
    expect(STILL_MANNER.bob + STILL_MANNER.bounce + STILL_MANNER.sway + STILL_MANNER.spinEvery).toBe(0);
  });
});
