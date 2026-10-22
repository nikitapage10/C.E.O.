import { describe, expect, it } from "vitest";
import { modelName, readAsked, whenAsked } from "./asked.ts";

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
