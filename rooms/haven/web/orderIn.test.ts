import { describe, expect, it } from "vitest";
import { doordashMoved, kitchenModeOf, orderInHref } from "./orderIn.ts";

/** Order now on an order-in meal (#1195, phase 2) links to the Kitchen's DoorDash side (#1206) with the meal (made-up store). */
describe("orderInHref", () => {
  it("names the meal, the week and the remembered store", () => {
    expect(orderInHref("sat", "dinner", "2026-11-16", { id: "987", name: "Taco Spot" })).toBe("/haven/kitchen/doordash?slot=sat-dinner&week=2026-11-16&store=987");
    expect(orderInHref("tue", "lunch", null)).toBe("/haven/kitchen/doordash?slot=tue-lunch");
  });
});

/** DoorDash lives inside the Kitchen (#1206): its side of the Kitchen, and the old tab's address landing there. */
describe("the Kitchen's DoorDash address", () => {
  it("opens DoorDash only at /haven/kitchen/doordash", () => {
    expect(kitchenModeOf("/haven/kitchen/doordash")).toBe("doordash");
    expect(kitchenModeOf("/haven/kitchen/doordash/")).toBe("doordash");
    expect(kitchenModeOf("/haven/kitchen")).toBe("prep");
    expect(kitchenModeOf("/haven/doordash")).toBe("prep");
  });
  it("sends the old /haven/doordash on, with its store, slot and week", () => {
    expect(doordashMoved("/haven/doordash", "?slot=sat-dinner&store=5")).toBe("/haven/kitchen/doordash?slot=sat-dinner&store=5");
    expect(doordashMoved("/haven/doordash/", "")).toBe("/haven/kitchen/doordash");
    expect(doordashMoved("/haven/kitchen/doordash", "")).toBeNull();
    expect(doordashMoved("/haven/kitchen", "")).toBeNull();
  });
});
