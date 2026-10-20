import { describe, expect, it } from "vitest";
import { isHalloweenNight, nightsPhrase, veilCountdownNights } from "./veil.ts";

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

describe("veilCountdownNights", () => {
  const nights = (iso: string) => veilCountdownNights(new Date(iso));
  it("is off on October 23", () => {
    expect(nights("2026-10-24T05:59:59Z")).toBeNull(); // 23:59:59 MDT, Oct 23
    expect(nights("2026-10-23T18:00:00Z")).toBeNull();
  });
  it("starts at midnight Mountain on October 24 with seven nights to go", () => {
    expect(nights("2026-10-24T06:00:00Z")).toBe(7); // 00:00 MDT
    expect(nights("2026-10-24T20:00:00Z")).toBe(7);
  });
  it("counts down by the Denver day", () => {
    expect(nights("2026-10-27T18:00:00Z")).toBe(4);
    expect(nights("2026-10-30T20:00:00Z")).toBe(1);
    expect(nights("2026-10-31T05:00:00Z")).toBe(1); // 23:00 MDT on the 30th, already the 31st in UTC
  });
  it("is zero on the 31st until dusk, then hands over to the Veil", () => {
    expect(nights("2026-10-31T15:00:00Z")).toBe(0); // 09:00 MDT
    expect(nights("2026-10-31T23:59:00Z")).toBe(0); // 17:59 MDT
    expect(nights("2026-11-01T00:00:00Z")).toBeNull(); // 18:00 MDT: the Veil is open
    expect(nights("2026-11-01T07:00:00Z")).toBeNull(); // Nov 1
  });
  it("reads the wall clock across DST (MDT in late October, MST once it ends)", () => {
    // 2027-10-24 is in MDT (UTC-6); 06:00Z is midnight there. If Denver were on MST it would still be the 23rd.
    expect(nights("2027-10-24T05:59:00Z")).toBeNull();
    expect(nights("2027-10-24T06:00:00Z")).toBe(7);
    // Dusk on the 31st is 18:00 local whichever offset applies: 00:00Z on Nov 1 in MDT.
    expect(nights("2027-10-31T23:59:00Z")).toBe(0);
    expect(nights("2027-11-01T00:00:00Z")).toBeNull();
    expect(veilCountdownNights(new Date("2026-07-27T18:00:00Z"))).toBeNull();
  });
  it("names the nights", () => {
    expect(nightsPhrase(4)).toBe("Four nights");
    expect(nightsPhrase(1)).toBe("One night");
  });
});
