import { describe, expect, it } from "vitest";
import { captionTop, spokenShare } from "./captions.ts";

describe("the call's caption follows the speech (#952)", () => {
  it("counts how much of a line has been said", () => {
    expect(spokenShare(0, 150)).toBe(0);
    expect(spokenShare(5_000, 150)).toBe(0.5);
    expect(spokenShare(60_000, 150)).toBe(1);
    expect(spokenShare(1_000, 0)).toBe(1);
  });
  it("never scrolls a line that fits", () => {
    expect(captionTop(0.9, 2)).toBe(0);
    expect(captionTop(1, 1)).toBe(0);
  });
  it("scrolls a long line a line at a time, ending on its last two lines", () => {
    const tops = [0, 0.2, 0.4, 0.6, 0.8, 1].map((s) => captionTop(s, 5));
    expect(tops).toEqual([0, 0, 1, 2, 3, 3]);
    // Never past the end, never above the start.
    expect(captionTop(2, 5)).toBe(3);
    expect(captionTop(-1, 5)).toBe(0);
  });
});
