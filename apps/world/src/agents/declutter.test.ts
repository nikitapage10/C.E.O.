import { describe, expect, it } from "vitest";
import { declutterPlates, intersects, settleLevel, stepsForward, type PlateBox, type Rect } from "./declutter.ts";

const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h });
/** A plate with its name at (x, y), 80×12, and a 140×20 line under it. */
const plate = (id: string, x: number, y: number, depth: number, extra: Partial<PlateBox> = {}): PlateBox => ({
  id,
  depth,
  name: rect(x - 40, y, 80, 12),
  line: rect(x - 70, y + 14, 140, 20),
  ...extra,
});

describe("intersects", () => {
  it("needs a real overlap, or as much air as asked for", () => {
    expect(intersects(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(intersects(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
    expect(intersects(rect(0, 0, 10, 10), rect(8, 8, 10, 10), 2)).toBe(false);
    expect(intersects(rect(0, 0, 10, 10), rect(12, 0, 10, 10), -3)).toBe(true);
    expect(intersects(rect(0, 0, 10, 10), rect(14, 0, 10, 10), -3)).toBe(false);
  });
});

describe("declutterPlates", () => {
  it("leaves plates that are apart alone", () => {
    expect(declutterPlates([plate("a", 100, 100, 10), plate("b", 400, 100, 12)])).toEqual({ a: "full", b: "full" });
  });

  it("drops the farther plate's task line when it would land on the nearer plate", () => {
    // b's line (y 214–234) runs into a's name (y 230–242); b's name is clear.
    const out = declutterPlates([plate("a", 140, 230, 8), plate("b", 100, 200, 14)]);
    expect(out).toEqual({ a: "full", b: "name" });
  });

  it("fades the farther plate back when even its name would cover the nearer one", () => {
    expect(declutterPlates([plate("far", 105, 102, 20), plate("near", 100, 100, 9)])).toEqual({ near: "full", far: "dim" });
  });

  it("gives way to speech bubbles", () => {
    expect(declutterPlates([plate("a", 100, 100, 5)], [rect(20, 116, 160, 40)])).toEqual({ a: "name" });
    expect(declutterPlates([plate("a", 100, 100, 5)], [rect(20, 90, 160, 40)])).toEqual({ a: "dim" });
  });

  it("never steps back a plate whose card is open, and puts it first", () => {
    const out = declutterPlates([plate("near", 100, 100, 5), plate("open", 105, 102, 30, { pinned: true })]);
    expect(out).toEqual({ open: "full", near: "dim" });
  });

  it("ignores a faded-out line", () => {
    expect(declutterPlates([plate("a", 140, 230, 8), plate("b", 100, 200, 14, { line: null })])).toEqual({ a: "full", b: "full" });
  });

  it("is the same whatever order the plates come in", () => {
    const list = [plate("a", 100, 100, 10), plate("b", 104, 104, 10), plate("c", 300, 100, 2)];
    expect(declutterPlates(list)).toEqual(declutterPlates([...list].reverse()));
  });
});

describe("settleLevel", () => {
  it("steps back at once", () => {
    expect(settleLevel("full", "dim", 0, 0, 600)).toBe("dim");
    expect(settleLevel("name", "dim", 0, 0, 600)).toBe("dim");
  });

  it("steps forward only after clear air for the hold", () => {
    expect(stepsForward("dim", "full")).toBe(true);
    expect(settleLevel("dim", "full", 1000, 1400, 600)).toBe("dim");
    expect(settleLevel("dim", "full", 1000, 1600, 600)).toBe("full");
  });
});
