import { describe, expect, it } from "vitest";
import type { TextItem } from "./texts.ts";
import { flip, GROUP_MAX_AGE_MS, GROUP_REPLY_MAX, groupsOf, lastHeard, replyOf, swipeOf, SWIPE_PX } from "./groups.ts";

/* The group flipper (#805). Every group, member and text here is made up. */

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const group = (over: Partial<TextItem> = {}): TextItem => ({ id: "0123456789abcdef", name: "Test Group", channel: "iMessage", group: true, state: "settled", sort: null, since: NOW - DAY, laterUntil: null, gist: "", draft: null, summary: { text: "Member 1 plans a picnic.", asked: false }, ...over });

describe("the group flipper", () => {
  it("lists only groups with something to read, heard from within 60 days, newest first", () => {
    const items = [
      group({ id: "1000000000000000", since: NOW - 3 * DAY }),
      group({ id: "2000000000000000", since: NOW - 5 * DAY, messages: [{ text: "Bringing snacks", at: NOW - 60_000, from: "Sam Test" }] }),
      group({ id: "3000000000000000", since: NOW - GROUP_MAX_AGE_MS - 1 }),
      group({ id: "4000000000000000", summary: null }),
      group({ id: "5000000000000000", group: false, state: "owed" }),
    ];
    expect(groupsOf(items, NOW).map((g) => g.id)).toEqual(["2000000000000000", "1000000000000000"]);
    expect(lastHeard(items[1]!)).toBe(NOW - 60_000);
    expect(groupsOf(items, NOW, "oldest").map((g) => g.id)).toEqual(["1000000000000000", "2000000000000000"]);
    expect(groupsOf(undefined, NOW)).toEqual([]);
  });

  it("puts the groups that asked Nikita first in priority order", () => {
    const items = [group({ id: "1000000000000000", since: NOW - DAY }), group({ id: "2000000000000000", since: NOW - 2 * DAY, state: "owed" }), group({ id: "3000000000000000", since: NOW - 3 * DAY, summary: { text: "Member 2 asks.", asked: true } })];
    expect(groupsOf(items, NOW, "priority").map((g) => g.id)).toEqual(["2000000000000000", "3000000000000000", "1000000000000000"]);
  });

  it("flips round the ends both ways", () => {
    expect(flip(0, 3, 1)).toBe(1);
    expect(flip(2, 3, 1)).toBe(0);
    expect(flip(0, 3, -1)).toBe(2);
    expect(flip(0, 0, 1)).toBe(0);
  });

  it("reads a sideways swipe as a flip and a scroll or a tap as nothing", () => {
    expect(swipeOf(-SWIPE_PX - 1, 4)).toBe(1);
    expect(swipeOf(SWIPE_PX + 1, -4)).toBe(-1);
    expect(swipeOf(SWIPE_PX - 1, 0)).toBe(0);
    expect(swipeOf(80, 120)).toBe(0);
  });

  it("sends the words exactly as typed, only trimmed, never empty or too long", () => {
    expect(replyOf("  Count me in 🙌\r\nsee you there ")).toBe("Count me in 🙌\nsee you there");
    expect(replyOf("lowercase, no full stop")).toBe("lowercase, no full stop");
    expect(replyOf("   ")).toBeNull();
    expect(replyOf("x".repeat(GROUP_REPLY_MAX + 1))).toBeNull();
  });
});
