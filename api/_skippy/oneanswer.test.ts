import { describe, expect, it } from "vitest";
import { atSentence } from "./kernelagent.ts";
import { GO_ON, PASSED_ON, askedBefore, noteAsked, sameQuestion } from "./toolroute.ts";
import { withoutMeta } from "./voicelookups.ts";

const NOW = Date.parse("2026-11-13T05:40:00Z");

/** Nikita, 2026-11-13: one election question got two answers, one cut mid-sentence, then "keep going" sat on pondering (#1116). */
describe("one answer per question on a call (#1116)", () => {
  it("knows the same question asked by the search and the deeper mind", () => {
    expect(sameQuestion("What was the result of the Mississippi Senate election recently?", "Mississippi Senate election result")).toBe(true);
    expect(sameQuestion("Mississippi Senate election result", "weather tomorrow near home")).toBe(false);
  });

  it("answers a repeat with silence and 'keep going' with the rest, but lets a new question through", () => {
    const call = "call-a";
    expect(askedBefore(call, "Mississippi Senate election result", NOW)).toBeNull();
    noteAsked(call, "What was the result of the Mississippi Senate election recently?", NOW);
    expect(askedBefore(call, "Mississippi Senate election 2026 result", NOW + 5_000)).toBe(PASSED_ON);
    expect(askedBefore(call, "Keep going.", NOW + 30_000)).toBe(GO_ON);
    expect(askedBefore(call, "What's the weather tomorrow?", NOW + 30_000)).toBeNull();
    expect(askedBefore(call, "Mississippi Senate election result", NOW + 200_000)).toBeNull();
    expect(askedBefore("call-b", "Keep going", NOW)).toBeNull();
  });

  it("drops the narration from an answer", () => {
    const raw =
      "Tonight is November 12, 2026, so the election (November 3) has already happened. This looks surprising, so I'll verify it with another source. Democrat Scott Colom won the race. Nov 12, 2026 is after the Nov 3, 2026 election, so I'll search for the result.";
    expect(withoutMeta(raw)).toBe("Democrat Scott Colom won the race.");
  });

  it("cuts a long answer after a whole sentence", () => {
    const text = `${"The race was close. ".repeat(40)}The Free Press also reported more`;
    const cut = atSentence(text, 700);
    expect(cut.length).toBeLessThanOrEqual(700);
    expect(cut.endsWith("close.")).toBe(true);
  });
});
