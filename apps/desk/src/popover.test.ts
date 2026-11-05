import { describe, expect, it } from "vitest";
import { placePopover, pointerBox, routesOf } from "./popover.ts";

const view = { width: 1200, height: 800 };
const pop = { width: 340, height: 220 };

describe("placePopover", () => {
  it("sits below and centred when there's room", () => {
    const p = placePopover({ left: 400, top: 100, width: 200, height: 60 }, pop, view);
    expect(p.side).toBe("below");
    expect(p.top).toBe(168);
    expect(p.left).toBe(330);
    expect(p.arrow).toBe(170);
  });

  it("flips above near the bottom of the screen", () => {
    const p = placePopover({ left: 400, top: 680, width: 200, height: 60 }, pop, view);
    expect(p.side).toBe("above");
    expect(p.top).toBe(680 - 8 - 220);
  });

  it("shifts inward at the left and right edges, keeping the pointer on the item", () => {
    const left = placePopover({ left: 0, top: 100, width: 120, height: 60 }, pop, view);
    expect(left.left).toBe(12);
    expect(left.arrow).toBe(48);
    const right = placePopover({ left: 1120, top: 100, width: 80, height: 60 }, pop, view);
    expect(right.left).toBe(1200 - 340 - 12);
    expect(right.left + pop.width).toBeLessThanOrEqual(1200 - 12);
  });

  it("stays on a phone screen even when the card is tall", () => {
    const phone = { width: 375, height: 640 };
    const p = placePopover({ left: 16, top: 300, width: 343, height: 70 }, { width: 351, height: 420 }, phone);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + 351).toBeLessThanOrEqual(375 - 12 + 0.001);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + 420).toBeLessThanOrEqual(640 - 12);
  });
});

describe("pointerBox", () => {
  it("puts a card that follows the mouse just under the cursor, centred on it", () => {
    const p = placePopover(pointerBox(600, 200), pop, view);
    expect(p.side).toBe("below");
    expect(p.top).toBe(200 + 22 + 8);
    expect(p.left).toBe(600 - pop.width / 2);
    expect(p.arrow).toBe(pop.width / 2);
  });

  it("flips above the cursor near the bottom of the screen", () => {
    const p = placePopover(pointerBox(600, 760), pop, view);
    expect(p.side).toBe("above");
    expect(p.top + pop.height).toBeLessThanOrEqual(760);
  });
});

describe("routesOf", () => {
  it("lists what feeds a part and what it feeds", () => {
    const wires = [
      { from: "mac", to: "hub" },
      { from: "hub", to: "bluebubbles" },
      { from: "hub", to: "openai" },
    ] as const;
    expect(routesOf(wires, "hub")).toEqual({ from: ["mac"], to: ["bluebubbles", "openai"] });
    expect(routesOf(wires, "mac")).toEqual({ from: [], to: ["hub"] });
  });
});
