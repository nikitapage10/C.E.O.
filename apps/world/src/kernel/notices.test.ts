import { describe, expect, it } from "vitest";
import { noticeVisible, scopeOf, type Notice } from "./notices.ts";

const drill = (room: Notice["room"]): Notice => ({ room, scope: "room" });
const wide = (room: Notice["room"] = null): Notice => ({ room, scope: "lattice" });

describe("which Kernel notices show on the banner", () => {
  it("in a focused room, only that room's own notices show", () => {
    expect(noticeVisible(drill("foundry"), "foundry")).toBe(true);
    expect(noticeVisible(drill("spire"), "foundry")).toBe(false);
    expect(noticeVisible(drill(null), "foundry")).toBe(false);
  });

  it("Lattice-wide notices show in every focused room, wherever they came from", () => {
    expect(noticeVisible(wide(), "foundry")).toBe(true);
    expect(noticeVisible(wide("spire"), "breakroom")).toBe(true);
  });

  it("in the overview, demo drills stay off the banner, room or no room", () => {
    expect(noticeVisible(drill("foundry"), null)).toBe(false);
    expect(noticeVisible(drill("breakroom"), null)).toBe(false);
    expect(noticeVisible(drill(null), null)).toBe(false);
  });

  it("in the overview, real events, achievements and night/day changes still show", () => {
    expect(noticeVisible(wide(), null)).toBe(true);
    expect(noticeVisible(wide("foundry"), null)).toBe(true);
  });

  it("an event is Lattice-wide only when it is real", () => {
    expect(scopeOf({ source: "simulated" })).toBe("room");
    expect(scopeOf({ source: "github" })).toBe("lattice");
    expect(scopeOf({ source: "claude-code" })).toBe("lattice");
  });
});
