import { describe, expect, it } from "vitest";
import { openingStep, weekDays } from "./kitchenDay.ts";

// Made-up weeks and lists only (#1055): never a real plan.
const draft = { confirmedAt: null, sentAt: null };
const final = { confirmedAt: "2026-03-01T20:00:00.000Z", sentAt: "2026-03-01T20:00:00.000Z" };
const item = (source: string, done: boolean) => ({ source, done });

describe("the step the Kitchen opens on (#1055)", () => {
  it("is Plan while the week's a draft, whatever the list says", () => {
    expect(openingStep(draft, { items: [] })).toBe("plan");
    expect(openingStep(draft, { items: [item("meals", false)], cartSentAt: "2026-03-02T10:00:00.000Z" })).toBe("plan");
  });

  it("is Shop while anything the week put on the list is still open", () => {
    expect(openingStep(final, { items: [item("meals", true), item("meals", false)] })).toBe("shop");
  });

  it("is Cook once the week's items are all ticked off or gone", () => {
    expect(openingStep(final, { items: [item("meals", true), item("meals", true)] })).toBe("cook");
    expect(openingStep(final, { items: [] })).toBe("cook");
  });

  it("isn't held at Shop by things added by hand", () => {
    expect(openingStep(final, { items: [item("phone", false), item("tasks", false), item("meals", true)] })).toBe("cook");
  });

  it("is Cook once the cart was sent after the week was finalized, even before the list is read", () => {
    expect(openingStep(final, { items: null, cartSentAt: "2026-03-01T21:00:00.000Z" })).toBe("cook");
    expect(openingStep(final, { items: [item("meals", false)], cartSentAt: "2026-03-02T09:00:00.000Z" })).toBe("cook");
  });

  it("doesn't count a cart sent before the week was finalized (last week's)", () => {
    expect(openingStep(final, { items: [item("meals", false)], cartSentAt: "2026-02-24T09:00:00.000Z" })).toBe("shop");
  });

  it("is Shop while the list is still being read, and Cook when the week sent nothing to the list", () => {
    expect(openingStep(final, { items: null })).toBe("shop");
    expect(openingStep({ ...final, sentAt: null }, { items: [item("meals", false)] })).toBe("cook");
  });
});

describe("the week's days in Cook (#1055)", () => {
  it("dates each day from the Monday and marks yesterday, today and tomorrow", () => {
    const d = weekDays("2026-03-02", new Date(2026, 2, 4, 18, 30));
    expect(d.map((x) => x.name)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(d.map((x) => x.date)).toEqual(["Mar 2", "Mar 3", "Mar 4", "Mar 5", "Mar 6", "Mar 7", "Mar 8"]);
    expect(d.map((x) => x.when)).toEqual(["past", "past", "today", "tomorrow", "ahead", "ahead", "ahead"]);
    expect(d.map((x) => x.tag)).toEqual([null, "Yesterday", "Today", "Tomorrow", null, null, null]);
  });

  it("crosses a month, and a week ahead has no today", () => {
    const d = weekDays("2026-03-30", new Date(2026, 2, 29, 9));
    expect(d.map((x) => x.date)).toEqual(["Mar 30", "Mar 31", "Apr 1", "Apr 2", "Apr 3", "Apr 4", "Apr 5"]);
    expect(d[0]!.when).toBe("tomorrow");
    expect(d.some((x) => x.when === "today" || x.when === "past")).toBe(false);
  });

  it("goes by the local day, late at night as early in the morning", () => {
    expect(weekDays("2026-03-02", new Date(2026, 2, 2, 23, 59))[0]!.when).toBe("today");
    expect(weekDays("2026-03-02", new Date(2026, 2, 3, 0, 1))[0]!.tag).toBe("Yesterday");
  });
});
