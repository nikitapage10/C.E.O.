import { describe, expect, it } from "vitest";
import { isHalloweenNight } from "./veil.ts";

// Mountain time: MDT (UTC-6) on Oct 31, MST (UTC-7) on Nov 1 after DST ends on the first Sunday of November.
const at = (iso: string) => isHalloweenNight(new Date(iso));

describe("isHalloweenNight", () => {
  it("starts at dusk (18:00 Mountain) on October 31", () => {
    expect(at("2026-10-31T23:59:00Z")).toBe(false);
    expect(at("2026-11-01T00:00:00Z")).toBe(true); // 18:00 MDT
  });
  it("runs to midnight Mountain, then stops", () => {
    expect(at("2026-11-01T05:59:59Z")).toBe(true); // 23:59:59 MDT
    expect(at("2026-11-01T06:00:00Z")).toBe(false); // 00:00 Nov 1
  });
  it("is not on other days or mornings", () => {
    expect(at("2026-10-30T20:00:00Z")).toBe(false);
    expect(at("2026-10-31T15:00:00Z")).toBe(false); // 09:00 on the 31st
    expect(at("2026-11-01T02:00:00Z")).toBe(true);
  });
  it("works in any year", () => {
    expect(at("2027-11-01T01:00:00Z")).toBe(true);
    expect(at("2027-07-31T01:00:00Z")).toBe(false);
  });
});
