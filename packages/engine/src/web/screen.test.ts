/** The screen-context registry (#1027): only the room on screen counts, keys never go, and it fits in about 2 KB. */
import { afterEach, describe, expect, it } from "vitest";
import { SCREEN_MAX, cleanScreen, clearScreen, screenJSON, screenNow, scrubScreen, setScreen } from "./screenFacts.ts";

afterEach(() => clearScreen());

describe("what Nikita is looking at (#1027)", () => {
  it("merges the shell's room and tab with the views of that room, in the order they were set", () => {
    setScreen("shell", { room: "haven", tab: "Kitchen" }, true);
    setScreen("planner", { room: "haven", item: "The week's meal plan", stage: "finalized", fields: { week: "2026-11-09" } });
    setScreen("cook", { room: "haven", item: "Cook mode, step 3 of 6", stage: "cooking", fields: { step: 3 }, private: { meal: "Sample tacos" } });
    // A page the Desk keeps mounted behind it adds nothing.
    setScreen("relay", { room: "relay", tab: "The Thread", fields: { needsYou: 4 } });
    expect(screenNow()).toEqual({ room: "haven", tab: "Kitchen", item: "Cook mode, step 3 of 6", stage: "cooking", fields: { week: "2026-11-09", step: 3 }, private: { meal: "Sample tacos" } });
    setScreen("cook", null);
    expect(screenNow().item).toBe("The week's meal plan");
    setScreen("shell", { room: "relay", tab: "Relay" }, true);
    expect(screenNow()).toEqual({ room: "relay", tab: "The Thread", fields: { needsYou: 4 } });
  });

  it("never carries a key, a token or a key-named field, and scrubs the private part for a public issue", () => {
    const c = cleanScreen({ room: "boiler", fields: { apiKey: "abc", note: "ghp_abcdefghijklmnopqrstu", hash: "a".repeat(40), ok: true }, private: { secretThing: "x", plan: "plain words" } });
    expect(c).toEqual({ room: "boiler", fields: { ok: true }, private: { plan: "plain words" } });
    expect(scrubScreen(c)).toEqual({ room: "boiler", fields: { ok: true } });
  });

  it("stays inside its cap, dropping the last fields first and keeping the room and tab", () => {
    const fields = Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`field${k}`, "plain words ".repeat(18)]));
    const s = screenJSON({ room: "annex", tab: "Job search", item: "Matches", fields });
    expect(s.length).toBeLessThanOrEqual(SCREEN_MAX);
    const back = JSON.parse(s) as { room: string; tab: string; fields: Record<string, string> };
    expect(back.room).toBe("annex");
    expect(back.tab).toBe("Job search");
    expect(Object.keys(back.fields)[0]).toBe("field0");
    expect(screenJSON({})).toBe("");
  });
});
