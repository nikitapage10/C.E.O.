import { describe, expect, it } from "vitest";
import type { ShownText } from "../../../api/_relay/texts.ts";
import { EMOJI, insertAt, reactable, stepLine, TAPBACK_FACE, TAPBACKS, tapbackTarget } from "./react.ts";

/** #888: the card's tapback target and the composer's emoji. Every text here is made up. */

const NOW = Date.parse("2026-11-05T15:00:00Z");
const lines: ShownText[] = [
  { text: "Are we still on?", at: NOW - 4_000, ref: "a1a1a1a1" },
  { text: "Yes!", at: NOW - 3_000, me: true },
  { text: "Great", at: NOW - 2_000, ref: "b2b2b2b2" },
  { text: "Photo", at: NOW - 1_000, media: true, ref: "c3c3c3c3" },
];

describe("tapbacks on the card (#888)", () => {
  it("are iMessage's six, each with a face and a name", () => {
    expect(TAPBACKS).toEqual(["love", "like", "dislike", "laugh", "emphasize", "question"]);
    for (const t of TAPBACKS) expect(TAPBACK_FACE[t].icon && TAPBACK_FACE[t].label).toBeTruthy();
  });

  it("go on their latest line by default, never Nikita's own, and step between their lines", () => {
    expect(reactable(lines).map((m) => m.ref)).toEqual(["a1a1a1a1", "b2b2b2b2", "c3c3c3c3"]);
    expect(tapbackTarget(lines, null)?.ref).toBe("c3c3c3c3");
    expect(tapbackTarget(lines, "a1a1a1a1")?.ref).toBe("a1a1a1a1");
    // A pick that is no longer shown falls back to the latest.
    expect(tapbackTarget(lines, "ffffffff")?.ref).toBe("c3c3c3c3");
    expect(stepLine(lines, "c3c3c3c3", -1)).toBe("b2b2b2b2");
    expect(stepLine(lines, "b2b2b2b2", -1)).toBe("a1a1a1a1");
    expect(stepLine(lines, "a1a1a1a1", -1)).toBe("a1a1a1a1");
    expect(stepLine(lines, "c3c3c3c3", 1)).toBe("c3c3c3c3");
    // Lines from a hub before #888 carry no ref: no buttons.
    expect(tapbackTarget([{ text: "Hi", at: NOW }], null)).toBeNull();
    expect(stepLine(undefined, null, 1)).toBeNull();
  });
});

describe("the composer's emoji picker (#888)", () => {
  it("puts the emoji in at the cursor and moves the cursor after it", () => {
    expect(insertAt("see you soon", 7, 7, "\u{1F44B}")).toEqual({ text: "see you\u{1F44B} soon", caret: 7 + "\u{1F44B}".length });
    expect(insertAt("", 0, 0, "\u{1F525}")).toEqual({ text: "\u{1F525}", caret: 2 });
  });

  it("replaces a selection, and falls back to the end without a cursor", () => {
    expect(insertAt("ok great thanks", 3, 8, "\u{1F64F}").text).toBe("ok \u{1F64F} thanks");
    expect(insertAt("ok", null, null, "\u{1F44D}")).toEqual({ text: "ok\u{1F44D}", caret: 2 + "\u{1F44D}".length });
    expect(insertAt("ok", 99, 99, "!").text).toBe("ok!");
    expect(insertAt("abc", 2, 1, "!").text).toBe("ab!c");
  });

  it("is a short hand-made set, each emoji once, each named", () => {
    expect(EMOJI.length).toBeGreaterThan(20);
    expect(EMOJI.length).toBeLessThanOrEqual(48);
    expect(new Set(EMOJI.map((x) => x.e)).size).toBe(EMOJI.length);
    for (const x of EMOJI) expect(x.name.trim()).not.toBe("");
  });
});
