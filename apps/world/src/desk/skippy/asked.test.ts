import { describe, expect, it } from "vitest";
import { handedName, modelName, readAsked, whenAsked } from "./asked.ts";

describe("Asked Skippy, browser side (#273)", () => {
  it("keeps only good turns for the room asked, newest first", () => {
    const body = {
      room: "green",
      turns: [
        { at: "2026-10-20T10:00:00Z", question: "Old", answer: "A", model: "claude-sonnet-5-5" },
        { at: "2026-10-22T10:00:00Z", question: "New", answer: "B", model: "claude-opus-5-5" },
        { at: "nope", question: "Bad", answer: "C" },
        { at: "2026-10-22T11:00:00Z", question: "", answer: "D" },
        "junk",
      ],
    };
    expect(readAsked(body, "green")!.map((t) => t.question)).toEqual(["New", "Old"]);
    expect(readAsked(body, "exchange")).toBeNull();
    expect(readAsked({ room: "green" }, "green")).toBeNull();
    expect(readAsked(null, "green")).toBeNull();
  });

  it("keeps who held the mic on a Talk call (#479), and only a known submind", () => {
    const body = {
      room: "green",
      turns: [
        { at: "2026-10-27T10:00:00Z", question: "Play-by-play on the waiver race?", answer: "Two managers circling one kicker.", model: "voice", via: "voice", by: "turf" },
        { at: "2026-10-27T09:00:00Z", question: "Q", answer: "A", model: "voice", via: "voice", by: "<b>someone</b>" },
      ],
    };
    const [onMic, unknown] = readAsked(body, "green")!;
    expect(onMic).toMatchObject({ via: "voice", by: "turf" });
    expect(handedName(onMic!.by!)).toBe("The Commentator");
    expect(unknown).not.toHaveProperty("via");
  });

  it("names the model and the time plainly", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus");
    expect(modelName("claude-sonnet-5-5")).toBe("Sonnet");
    expect(modelName("other")).toBe("other");
    const now = Date.parse("2026-10-22T16:00:00Z");
    expect(whenAsked("2026-10-22T15:59:30Z", now)).toBe("just now");
    expect(whenAsked("2026-10-22T15:48:00Z", now)).toBe("12 min ago");
    expect(whenAsked("2026-10-22T13:00:00Z", now)).toBe("3 h ago");
  });
});

describe("a hand-off on the panel (#312)", () => {
  it("keeps who it went to and the answer that came back, and drops what isn't one", () => {
    const at = "2026-10-23T18:00:00.000Z";
    const body = {
      room: "foundry",
      turns: [
        { at, question: "Lift?", answer: "Handed off.", model: "m", needs: "ember", followUp: { from: "ember", text: "On the line.", at } },
        { at, question: "Other?", answer: "Handed off.", model: "m", needs: "rocky", followUp: { from: "x", text: "nope", at } },
      ],
    };
    const [a, b] = readAsked(body, "foundry")!;
    expect(a).toMatchObject({ needs: "ember", followUp: { from: "ember", text: "On the line.", at } });
    expect(b!.needs).toBeUndefined();
    expect(b!.followUp).toBeUndefined();
    expect(handedName("ember")).toBe("The Builder");
    expect(handedName("skippy")).toBe("Skippy");
  });
});
