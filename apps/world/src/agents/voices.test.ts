import { lookFromPreset } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { voiced, voiceOf } from "./voices.ts";

describe("voices", () => {
  it("costumes with a voice have one; plain looks don't", () => {
    expect(voiceOf(lookFromPreset("rock-engineer"))).toBe("chords");
    expect(voiceOf(lookFromPreset("envoy"))).toBe("thisone");
    expect(voiceOf(lookFromPreset("frame"))).toBeUndefined();
    expect(voiced(undefined, "Hello.")).toEqual({ text: "Hello." });
  });

  it("the engineer sings, and asks questions the engineer's way", () => {
    const v = voiced("chords", "Is it lunch?");
    expect(v.pre).toMatch(/^[♩♪♫♬ ]+$/);
    expect(v.text).toBe("Is it lunch, question?");
    expect(voiced("chords", "The build broke.").post).toBe("Bad bad bad.");
    expect(["Amaze amaze amaze!", "Good good good.", "Happy happy happy."]).toContain(voiced("chords", "Shipped it!").post);
  });

  it("the hanar speaks of itself as this one", () => {
    expect(voiced("thisone", "I'm late, and my tea is cold.").text).toBe("This one is late, and this one's tea is cold.");
    expect(voiced("thisone", "Give me a moment. I'll check.").text).toBe("Give this one a moment. This one will check.");
    expect(voiced("thisone", "Hello there.").text).toBe("Hello there.");
  });

  it("the professor fusses first and cautions after", () => {
    expect(voiceOf(lookFromPreset("professor"))).toBe("professor");
    expect(["Oh dear. Back to the drawing board.", "Hm. A most educational failure.", "Too hasty. Far too hasty."]).toContain(voiced("professor", "The experiment failed.").post);
    expect(voiced("professor", "Calibrating the lens.").text).toBe("Calibrating the lens.");
    expect(voiced("professor", "It works!")).toEqual(voiced("professor", "It works!"));
  });

  it("the emotive voice says how it feels first, and it's stable for a given line", () => {
    const a = voiced("emotive", "Sorry, that failed.");
    expect(a.pre).toMatch(/:$/);
    expect(["Apologetically:", "With deep regret:", "Sheepishly:"]).toContain(a.pre);
    expect(voiced("emotive", "Sorry, that failed.")).toEqual(a);
    expect(voiced("emotive", "Shall we?").pre).toBe("Inquisitively:");
  });
});
