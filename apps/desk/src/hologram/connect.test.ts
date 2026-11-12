import { describe, expect, it } from "vitest";
import { RESOLVE_MS, callLost, garbleNext, garbleShape } from "./connect.ts";

describe("the hologram glitches into clarity as the call connects (#1053)", () => {
  it("stays fully garbled while connecting", () => {
    expect(garbleNext(0, 0.03, true)).toBe(1);
    expect(garbleNext(0.4, 0.03, true)).toBe(1);
  });

  it("clears evenly over RESOLVE_MS once live, and stays clear", () => {
    let g = 1;
    let ms = 0;
    while (g > 0 && ms < 5_000) {
      g = garbleNext(g, 1 / 32, false);
      ms += 1000 / 32;
    }
    expect(ms).toBeGreaterThanOrEqual(RESOLVE_MS - 40);
    expect(ms).toBeLessThanOrEqual(RESOLVE_MS + 40);
    expect(garbleNext(0, 1, false)).toBe(0);
  });

  it("eases the garble without overshooting", () => {
    expect(garbleShape(0)).toBe(0);
    expect(garbleShape(1)).toBe(1);
    expect(garbleShape(0.5)).toBe(0.5);
    expect(garbleShape(2)).toBe(1);
    expect(garbleShape(0.2)).toBeLessThan(0.2);
  });

  it("glitches out on a dropped or failed call, not on a hang-up or a timeout", () => {
    expect(callLost(null)).toBe(false);
    expect(callLost("silence")).toBe(false);
    expect(callLost("failed")).toBe(true);
    expect(callLost("eleven")).toBe(true);
    expect(callLost("mic")).toBe(true);
  });
});
