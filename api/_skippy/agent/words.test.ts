import { describe, expect, it } from "vitest";
import { directAsk, infoQuestion, spokenAsked } from "./words.ts";

describe("a question never runs a home device (2026-11-06)", () => {
  const asked = "Yeah. Um, can you tell me, um, what the vacuum cleaner's, uh, next schedule is gonna be?";

  it("reads the question as a question", () => {
    expect(infoQuestion(asked)).toBe(true);
    expect(infoQuestion("is the vacuum running?")).toBe(true);
    expect(infoQuestion("when does the litter box run next")).toBe(true);
    expect(infoQuestion("um, what's the wet feeder's schedule")).toBe(true);
  });

  it("the rules never turn it into an order", () => {
    expect(directAsk(asked)).toBeNull();
    expect(directAsk("when did the vacuum last clean the kitchen?")).toBeNull();
  });

  it("the model's call to run it is refused", () => {
    expect(spokenAsked(asked, { action: "vacuum.start" })).toBe(false);
    expect(spokenAsked(asked, { action: "vacuum.rooms" })).toBe(false);
  });

  it("plain orders still run, fillers and all", () => {
    expect(infoQuestion("can you vacuum the kitchen?")).toBe(false);
    expect(directAsk("yeah, um, vacuum the kitchen")?.input.action).toBe("vacuum.rooms");
    expect(directAsk("can you open the wet food feeder")?.input.action).toBe("wet.open");
    expect(directAsk("send the vacuum home")?.input.action).toBe("vacuum.dock");
    expect(spokenAsked("Yeah, I didn't want that. Send the vacuum back.", { action: "vacuum.dock" })).toBe(true);
    expect(directAsk("what's in the wet feeder?")).toEqual({ tool: "home_status", input: { about: "wet-feeder" } });
    expect(directAsk("what's the temperature in the apartment?")?.tool).toBe("home_status");
  });
});
