import { describe, expect, it } from "vitest";
import { safeTitle, shippedLine } from "./rise.ts";
import { riseSpot } from "../flow/rise.ts";
import type { Change } from "../../foundry.ts";

describe("rising words", () => {
  it("floats a submind's own title only when it carries nothing private", () => {
    expect(safeTitle("Lineup set for Sunday")).toBe("Lineup set for Sunday");
    expect(safeTitle("Paid $1,200 to the contractor")).toBeNull();
    expect(safeTitle("Mail from someone@example.com")).toBeNull();
    expect(safeTitle("See https://example.com")).toBeNull();
    expect(safeTitle("Call 5551234567")).toBeNull();
    expect(safeTitle("Rotated the API key")).toBeNull();
    expect(safeTitle("Invoice 12.50 sent")).toBeNull();
    expect(safeTitle("   ")).toBeNull();
  });
  it("keeps a long title short", () => {
    const t = safeTitle("The Bookie moved two lines overnight and flagged the interesting one");
    expect(t!.length).toBeLessThanOrEqual(34);
    expect(t!.endsWith("…")).toBe(true);
  });
  it("says what shipped by its issue number", () => {
    const base = { key: "k", at: 0, title: "Thing", kind: "feature", landed: null, by: null, short: "" } as unknown as Change;
    expect(shippedLine({ ...base, issue: { number: 412, url: "" } })).toBe("shipped #412");
    expect(shippedLine({ ...base, issue: null })).toBe("shipped a change");
  });
});

describe("where rising words go (#417)", () => {
  const W = 1400;
  // The Council's label across the middle at y 686..702, a chip above the left figures ending at y 617.
  const label = { x: 295, y: 686, w: 850, h: 16 };
  const chip = { x: 43, y: 576, w: 283, h: 41 };
  const clear = (x0: number, x1: number, y: number) => {
    const over = (r: typeof label) => x1 > r.x && x0 < r.x + r.w;
    const floor = over(label) && label.y < y ? label.y : Infinity;
    const ceil = over(chip) && chip.y + chip.h <= Math.min(floor, y) ? chip.y + chip.h : -Infinity;
    return { floor, ceil };
  };
  it("rises off its figure when nothing is in the way", () => {
    const s = riseSpot({ x: 1300, y: 730, W }, 120, 24)!;
    expect(s.top0).toBe(730 - 20 - 12);
    expect(s.rise).toBe(64);
  });
  it("never crosses the Council's label: it starts above it and rises no further than the chip above", () => {
    const s = riseSpot({ x: 244, y: 730, W, clear }, 140, 24)!;
    expect(s.top0 + 24).toBeLessThanOrEqual(label.y - 6);
    expect(s.top0 - s.rise).toBeGreaterThanOrEqual(chip.y + chip.h + 6);
    expect(s.floor).toBe(label.y);
  });
  it("keeps a second line waiting when there is no room above the first", () => {
    expect(riseSpot({ x: 244, y: 730, W, clear }, 140, 24, 52)).toBeNull();
    expect(riseSpot({ x: 900, y: 730, W, clear }, 140, 24, 52)).not.toBeNull();
  });
});
