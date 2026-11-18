import { describe, expect, it } from "vitest";
import { orderInHref } from "./orderIn.ts";

/** Order now on an order-in meal (#1195, phase 2) links to the Haven's DoorDash tab with the meal (made-up store). */
describe("orderInHref", () => {
  it("names the meal, the week and the remembered store", () => {
    expect(orderInHref("sat", "dinner", "2026-11-16", { id: "987", name: "Taco Spot" })).toBe("/haven/doordash?slot=sat-dinner&week=2026-11-16&store=987");
    expect(orderInHref("tue", "lunch", null)).toBe("/haven/doordash?slot=tue-lunch");
  });
});
