import { describe, expect, it } from "vitest";
import { nextUpkeep } from "../foundry.ts";
import { ideaAge } from "./IdeaCard.tsx";
import { ideaTitle, nextIdeas } from "./FoundryPage.tsx";

describe("the Foundry's clock", () => {
  it("finds the next upkeep tick, every five hours from the routine's anchor (20:51Z on 2026-10-13)", () => {
    const at = Date.UTC(2026, 9, 12, 22, 51);
    expect(new Date(nextUpkeep(at)).toISOString()).toBe("2026-10-13T00:51:00.000Z");
    expect(new Date(nextUpkeep(Date.UTC(2026, 9, 13, 0, 51))).toISOString()).toBe("2026-10-13T05:51:00.000Z");
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

describe("how long an idea has waited", () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const ago = (days: number) => now - days * 86_400_000;

  it("counts down to the shelf", () => {
    expect(ideaAge(ago(0), now)).toBe("New today · shelved in 7 days");
    expect(ideaAge(ago(1), now)).toBe("Waiting 1 day · shelved in 6");
    expect(ideaAge(ago(3), now)).toBe("Waiting 3 days · shelved in 4");
    expect(ideaAge(ago(6), now)).toBe("Waiting 6 days · shelved tomorrow");
  });

  it("says when an idea is due for the shelf", () => {
    expect(ideaAge(ago(7), now)).toBe("Waiting 7 days · due for the shelf");
    expect(ideaAge(ago(8), now)).toBe("Waiting 8 days · due for the shelf");
  });

  it("shows nothing without a date", () => {
    expect(ideaAge(undefined, now)).toBe("");
  });
});
