import { describe, expect, it } from "vitest";
import { insideDrop, onDropEvent, shownDrop } from "./navDrop.ts";

const haven = { id: "haven", path: "/haven/gym" };

describe("the bar's room drop-downs (#871, #901)", () => {
  it("never draws a drop-down on a page other than the one it was opened on", () => {
    expect(shownDrop(haven, "/haven/gym")).toBe(haven);
    expect(shownDrop(haven, "/boiler")).toBeNull();
    expect(shownDrop(haven, "/haven/kitchen")).toBeNull();
    expect(shownDrop(null, "/haven/gym")).toBeNull();
  });

  it("closes on a tap or click elsewhere, Escape, a move, the window losing focus or the mouse leaving the window", () => {
    expect(onDropEvent(haven, { kind: "pointerdown", inside: false })).toBe("close");
    expect(onDropEvent(haven, { kind: "pointerdown", inside: true })).toBe("stay");
    expect(onDropEvent(haven, { kind: "key", key: "Escape" })).toBe("close");
    expect(onDropEvent(haven, { kind: "key", key: "ArrowDown" })).toBe("stay");
    for (const kind of ["blur", "hidden", "resize", "scroll", "navigate", "leave-window"] as const) expect(onDropEvent(haven, { kind })).toBe("close");
  });

  it("closes a moment after the mouse leaves it and its room's name, whoever opened it; a finger moving doesn't", () => {
    expect(onDropEvent(haven, { kind: "pointermove", inside: false, pointerType: "mouse" })).toBe("soon");
    expect(onDropEvent(haven, { kind: "pointermove", inside: true, pointerType: "mouse" })).toBe("stay");
    expect(onDropEvent(haven, { kind: "pointermove", inside: false, pointerType: "touch" })).toBe("stay");
    expect(onDropEvent(null, { kind: "pointerdown", inside: false })).toBe("stay");
  });

  it("knows the drop-down and its own room's entry in the bar, and nothing else", () => {
    const at = (hits: string[]) => ({ closest: (s: string) => (hits.includes(s) ? {} : null) });
    expect(insideDrop(at([".wv-drop"]), "haven")).toBe(true);
    expect(insideDrop(at(['[data-drop="haven"]']), "haven")).toBe(true);
    expect(insideDrop(at(['[data-drop="boiler"]']), "haven")).toBe(false);
    expect(insideDrop(at([]), "haven")).toBe(false);
    expect(insideDrop(null, "haven")).toBe(false);
    expect(insideDrop({}, "haven")).toBe(false);
  });
});
