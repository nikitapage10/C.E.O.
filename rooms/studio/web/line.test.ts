import { describe, expect, it } from "vitest";
import { BUDGETS, LINE, stepTo } from "./line.ts";

describe("the Studio's timeline keys", () => {
  it("steps with the arrows and stops at the ends", () => {
    expect(stepTo("ArrowRight", 0)).toBe(1);
    expect(stepTo("ArrowLeft", 0)).toBe(0);
    expect(stepTo("ArrowRight", LINE.length - 1)).toBe(LINE.length - 1);
    expect(stepTo("ArrowDown", 3)).toBe(4);
    expect(stepTo("ArrowUp", 3)).toBe(2);
  });
  it("jumps to the ends with Home and End, and leaves other keys alone", () => {
    expect(stepTo("Home", 5)).toBe(0);
    expect(stepTo("End", 2)).toBe(LINE.length - 1);
    expect(stepTo("w", 2)).toBeNull();
    expect(stepTo(" ", 2)).toBeNull();
  });
});

describe("what the Studio shows", () => {
  it("lists nine steps, each saying what it waits on, and spends nothing", () => {
    expect(LINE.map((s) => s.k)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
    for (const s of LINE) expect(s.w).toMatch(/^Waits on /);
    for (const b of BUDGETS) expect(b.cap).toBe(10);
  });
});
