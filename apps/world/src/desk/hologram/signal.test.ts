import { beforeEach, describe, expect, it } from "vitest";
import { INTERRUPTED_MS, SWAP_MS, expressionOf, holoEvents, setSpeaker, stripTags, tagMood, useHolo, type FaceInputs } from "./signal.ts";

const at = (over: Partial<FaceInputs> = {}): FaceInputs => ({ phase: "live", mode: "listening", tools: 0, thinking: false, swappedAt: 0, interruptedAt: 0, line: "", now: 100_000, ...over });

describe("Skippy's face on a call (#481)", () => {
  beforeEach(() => holoEvents.reset());

  it("listens while Nikita talks and is smug while he does", () => {
    expect(expressionOf(at())).toBe("listening");
    expect(expressionOf(at({ mode: "speaking", line: "Obviously." }))).toBe("smug");
  });

  it("laughs on a [laugh] or [excited] line and is annoyed on a [sigh]", () => {
    expect(expressionOf(at({ mode: "speaking", line: "[laughs] Monkeys." }))).toBe("laughing");
    expect(expressionOf(at({ mode: "speaking", line: "Oh! [excited] It shipped." }))).toBe("laughing");
    expect(expressionOf(at({ mode: "speaking", line: "[sigh] Fine." }))).toBe("annoyed");
    // A tag only moves his face while he's the one talking.
    expect(expressionOf(at({ mode: "listening", line: "[laugh]" }))).toBe("listening");
  });

  it("thinks while connecting, during a lookup, and through a hand-off", () => {
    expect(expressionOf(at({ phase: "starting" }))).toBe("thinking");
    expect(expressionOf(at({ mode: "speaking", tools: 1 }))).toBe("thinking");
    expect(expressionOf(at({ thinking: true }))).toBe("thinking");
    expect(expressionOf(at({ swappedAt: 100_000 - SWAP_MS / 2 }))).toBe("thinking");
    expect(expressionOf(at({ swappedAt: 100_000 - SWAP_MS - 1 }))).toBe("listening");
  });

  it("is annoyed for a moment when he's cut off", () => {
    expect(expressionOf(at({ mode: "speaking", interruptedAt: 100_000 - 200 }))).toBe("annoyed");
    expect(expressionOf(at({ mode: "speaking", interruptedAt: 100_000 - INTERRUPTED_MS - 1 }))).toBe("smug");
  });

  it("reads tags and keeps them out of the captions", () => {
    expect(tagMood("No tags here")).toBeNull();
    expect(stripTags("[laughs]  Two things are   building. [excited]")).toBe("Two things are building.");
  });

  it("counts lookups and swaps the speaker for hand-offs", () => {
    holoEvents.toolStart();
    holoEvents.toolStart();
    holoEvents.toolEnd();
    expect(useHolo.getState().tools).toBe(1);
    holoEvents.toolEnd();
    holoEvents.toolEnd();
    expect(useHolo.getState().tools).toBe(0);
    setSpeaker("foundry");
    expect(useHolo.getState().speaker).toBe("foundry");
    expect(useHolo.getState().swappedAt).toBeGreaterThan(0);
    setSpeaker(null);
    expect(useHolo.getState().speaker).toBeNull();
  });
});
