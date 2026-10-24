import { describe, expect, it } from "vitest";
import { safeTitle, shippedLine } from "./rise.ts";
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
