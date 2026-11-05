import { describe, expect, it } from "vitest";
import { readDevice } from "./homeDevices.ts";
import { amount, clock, due, duration, nextOf, noPlanSay, ounces, petFacts, shapeSay, statusWord, trayBowls } from "./petDay.ts";

describe("the wet tray's three bowls", () => {
  it("draws every bowl: in front, served, now, next or later, with its window and name", () => {
    const d = readDevice({
      id: "0123456789ae",
      vendor: "petlibro",
      kind: "wet-feeder",
      state: "closed",
      online: true,
      plate: 3,
      served: [1, 9],
      meals: [
        { time: "07:00", end: "09:00", plate: 1, status: "done", label: "Bowl one" },
        { time: "18:00", end: "20:00", plate: 3, status: "next", label: "Bowl three" },
      ],
      wetPlanShape: { read: "ok", template: true, entries: 2, disabled: 0, badTime: 0, keys: ["plate", "bad key!"], top: ["plan"] },
    })!;
    expect(d.served).toEqual([1]);
    expect(d.wetPlanShape?.keys).toEqual(["plate"]);
    expect(trayBowls(d)).toEqual([
      { n: 1, front: false, state: "served", time: "07:00", end: "09:00", label: "Bowl one" },
      { n: 2, front: false, state: "none" },
      { n: 3, front: true, state: "next", time: "18:00", end: "20:00", label: "Bowl three" },
    ]);
    expect(shapeSay(d.wetPlanShape!)).toBe("template yes · 2 entries · 0 off · 0 unreadable time · keys: plate · answer: plan");
  });

  it("says plainly when the Haven's account sees no schedule", () => {
    const d = readDevice({ id: "0123456789ae", vendor: "petlibro", kind: "wet-feeder", state: "closed", online: true, plate: 1, nextFeed: { time: "18:00" }, wetPlanShape: { read: "failed" } })!;
    expect(trayBowls(d).map((b) => b.state)).toEqual(["none", "none", "none"]);
    expect(noPlanSay({})).toBe("No schedule visible to the Haven's account.");
    expect(noPlanSay(d)).toBe("No schedule visible to the Haven's account. The feeder says next at 6:00 PM.");
    expect(noPlanSay({ planOn: false })).toBe("The feeding schedule is switched off in the Petlibro app.");
    expect(shapeSay(d.wetPlanShape!)).toBe("Plan read failed (the call didn't go through).");
  });
});

/** The Petlibro day on the Desk (#685). Made-up readings only. */
describe("the Petlibro day in words (#685)", () => {
  it("writes times, durations, ounces and amounts as the app does", () => {
    expect([clock("05:00"), clock("12:09"), clock("21:00"), clock("00:30")]).toEqual(["5:00 AM", "12:09 PM", "9:00 PM", "12:30 AM"]);
    expect([duration(124), duration(45), duration(600)]).toEqual(["2m 04s", "45s", "10m 00s"]);
    expect([ounces(240), ounces(600)]).toEqual(["8.1", "20"]);
    expect([amount(2), amount(12), amount(14), amount(24), amount(4, "g"), amount(4, "oz"), amount(4, "ml")]).toEqual(["2/12 cup", "1 cup", "1 2/12 cups", "2 cups", "40 g", "1.4 oz", "80 mL"]);
  });

  it("says overdue in ember, and how long until due otherwise", () => {
    expect(due(-2)).toEqual({ text: "2 days overdue", over: true });
    expect(due(-1)).toEqual({ text: "1 day overdue", over: true });
    expect(due(0)).toEqual({ text: "due today", over: true });
    expect(due(12)).toEqual({ text: "in 12 days", over: false });
    expect([statusWord("done", true), statusWord("done", false), statusWord("now", true), statusWord(undefined, true)]).toEqual(["Completed", "Served", "Feeding now", ""]);
  });

  it("keeps only well-formed day fields from a private reading", () => {
    const d = readDevice({
      id: "0123456789ab",
      vendor: "petlibro",
      kind: "fountain",
      state: "running",
      online: true,
      alerts: [],
      filterDays: -2,
      cleanDays: "soon",
      drankMl: 240,
      visits: 7,
      avgSec: 20.5,
    });
    expect(d).toMatchObject({ filterDays: -2, drankMl: 240, visits: 7 });
    expect(d).not.toHaveProperty("cleanDays");
    expect(d).not.toHaveProperty("avgSec");
    const dry = readDevice({ id: "0123456789ac", vendor: "petlibro", kind: "dry-feeder", state: "idle", online: true, alerts: [], fedPortions: 4, feedUnit: "cup", plan: [{ time: "05:00", portions: 2, on: true, status: "done" }, { time: "9pm", portions: 2 }, { time: "21:00", portions: 2, on: true, status: "next" }] });
    expect(dry?.plan).toEqual([{ time: "05:00", portions: 2, on: true, status: "done" }, { time: "21:00", portions: 2, on: true, status: "next" }]);
    expect(nextOf(dry?.plan)).toEqual({ time: "21:00", portions: 2, on: true, status: "next" });
    expect(petFacts(dry!)).toEqual(["4/12 cup today", "next 9:00 PM, 2/12 cup"]);
    expect(petFacts(d!)).toEqual(["8.1 oz today", "7 visits", "filter 2 days overdue"]);
    // Another vendor's reading never takes these fields.
    expect(readDevice({ id: "0123456789ad", vendor: "whisker", kind: "litter", state: "ready", online: true, visits: 3 })).not.toHaveProperty("visits");
  });
});
