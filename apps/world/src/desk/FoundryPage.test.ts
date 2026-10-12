import { describe, expect, it } from "vitest";
import { nextUpkeep } from "../foundry.ts";
import { ideaTitle, nextIdeas } from "./FoundryPage.tsx";

describe("the Foundry's clock", () => {
  it("finds the next upkeep tick at :57 on a sixth hour", () => {
    const at = Date.UTC(2026, 9, 12, 22, 51);
    expect(new Date(nextUpkeep(at)).toISOString()).toBe("2026-10-13T00:57:00.000Z");
    expect(new Date(nextUpkeep(Date.UTC(2026, 9, 13, 0, 57))).toISOString()).toBe("2026-10-13T06:57:00.000Z");
  });
  it("finds the next 9:00 in Denver", () => {
    const at = Date.UTC(2026, 9, 12, 22, 51); // 16:51 in Denver (MDT)
    expect(new Date(nextIdeas(at)).toISOString()).toBe("2026-10-13T15:00:00.000Z");
  });
});

describe("ideaTitle", () => {
  it("drops the Idea: prefix and capitalises", () => {
    expect(ideaTitle("Idea: merge each room's furniture")).toBe("Merge each room's furniture");
    expect(ideaTitle("Already clean")).toBe("Already clean");
  });
});
