import { describe, expect, it } from "vitest";
import { slowdown, slowdownLine } from "./slowdown.ts";

const rep = (n: number, v: number) => Array<number>(n).fill(v);

describe("the Boiler Room's slowdown flag (#569)", () => {
  it("needs 20 values", () => {
    expect(slowdown(rep(19, 100))).toBeNull();
    expect(slowdown([...rep(10, 3000), ...rep(9, 1000)])).toBeNull();
  });
  it("flags newest 10 at least 1.5x the 10 before (newest first)", () => {
    expect(slowdown([...rep(10, 2400), ...rep(10, 1300)])).toEqual({ now: 2400, was: 1300 });
    expect(slowdown([...rep(10, 1500), ...rep(10, 1000)])).toEqual({ now: 1500, was: 1000 });
  });
  it("stays quiet below 1.5x, when faster, or on a zero baseline", () => {
    expect(slowdown([...rep(10, 1499), ...rep(10, 1000)])).toBeNull();
    expect(slowdown([...rep(10, 500), ...rep(10, 1000)])).toBeNull();
    expect(slowdown([...rep(10, 500), ...rep(10, 0)])).toBeNull();
  });
  it("ignores a single outlier through the median", () => {
    expect(slowdown([9000, ...rep(9, 1000), ...rep(10, 1000)])).toBeNull();
  });
  it("words the line", () => {
    expect(slowdownLine([...rep(10, 2400), ...rep(10, 1300)])).toBe("Slower lately: 2.4 s now, was 1.3 s");
    expect(slowdownLine(rep(20, 1000))).toBeNull();
  });
});
