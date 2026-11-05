import { describe, expect, it } from "vitest";
import { readWrote, touchesList, touchesMeals } from "./wrote.ts";

/** What Skippy's answers say he changed (#698), read untrusted, and which pages it touches. */
describe("Skippy changed something (#698)", () => {
  it("reads tool names and plain lines only", () => {
    expect(readWrote({ wrote: ["meals_swap", "Not A Tool!", 7], did: ["Tuesday: tacos instead of kofta.", 3] })).toEqual({ tools: ["meals_swap"], did: ["Tuesday: tacos instead of kofta."] });
    expect(readWrote({ wrote: ["kitchen_add"], did: "Added basil to the Kitchen list" })).toEqual({ tools: ["kitchen_add"], did: ["Added basil to the Kitchen list"] });
    expect(readWrote({ did: ["x"] })).toBeNull();
    expect(readWrote(null)).toBeNull();
  });

  it("knows which tools touch the planner and the Kitchen list", () => {
    expect(touchesMeals({ tools: ["meals_customize"], did: [] })).toBe(true);
    expect(touchesMeals({ tools: ["kitchen_add"], did: [] })).toBe(false);
    expect(touchesList({ tools: ["meals_send"], did: [] })).toBe(true);
    expect(touchesList({ tools: ["meals_swap"], did: [] })).toBe(false);
  });
});
