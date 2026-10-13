import { describe, expect, it } from "vitest";
import { adoptRelationships } from "./cast/castStore.ts";
import { chronicleDay, dayTitle, playbackOf, remarksByIssue, sinceAway, type HistoryEntry } from "./chronicle.ts";

const hour = (step: number, at: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  step,
  at,
  day: chronicleDay(Date.parse(at)),
  source: "claude",
  summary: `Hour ${step}`,
  scenes: [],
  changes: [],
  remarks: [],
  events: [],
  cost: null,
  ...over,
});

describe("the Chronicle's helpers", () => {
  it("files hours by the Mountain-time day", () => {
    expect(chronicleDay(Date.parse("2026-10-14T05:30:00Z"))).toBe("2026-10-13");
    expect(chronicleDay(Date.parse("2026-10-14T07:30:00Z"))).toBe("2026-10-14");
  });

  it("names today and yesterday, and dates the rest", () => {
    const now = Date.parse("2026-10-13T18:00:00Z");
    expect(dayTitle("2026-10-13", now)).toBe("Today");
    expect(dayTitle("2026-10-12", now)).toBe("Yesterday");
    expect(dayTitle("2026-10-10", now)).toBe("Saturday 10 October");
  });

  it("lists the hours since you were away, newest first", () => {
    const recent = [hour(1, "2026-10-13T10:00:00Z"), hour(2, "2026-10-13T11:00:00Z"), hour(3, "2026-10-13T12:00:00Z")];
    expect(sinceAway(recent, Date.parse("2026-10-13T10:30:00Z")).map((e) => e.step)).toEqual([3, 2]);
  });

  it("keeps each job's latest remark for the Changelog", () => {
    const m = remarksByIssue([
      { issue: 41, title: "t", who: "caret", text: "newer", at: "2026-10-13T12:00:00Z" },
      { issue: 41, title: "t", who: "caret", text: "older", at: "2026-10-13T11:00:00Z" },
    ]);
    expect(m.get(41)?.text).toBe("newer");
  });

  it("plays the room in view first, speakers facing each other, then the builders' remarks", () => {
    const e = hour(1, "2026-10-13T10:00:00Z", {
      scenes: [
        { room: "green", title: "Huddle", lines: [{ who: "gridiron", text: "Start the kicker!" }, { who: "punt", text: "Zzz." }] },
        { room: "foundry", title: "Crate", lines: [{ who: "caret", text: "Amaze." }, { who: "ghost", text: "Boo." }, { who: "tessellate", text: "Sorry, crate." }] },
      ],
      remarks: [{ issue: 41, title: "t", who: "caret", text: "Done done done." }],
    });
    const has = (id: string) => id !== "ghost";
    const lines = playbackOf(e, has, "foundry");
    expect(lines.map((l) => `${l.who}:${l.text}`)).toEqual(["caret:Amaze.", "tessellate:Sorry, crate.", "gridiron:Start the kicker!", "punt:Zzz.", "caret:Done done done."]);
    expect(lines[0]).toMatchObject({ to: "tessellate", room: "foundry" });
    expect(lines.at(-1)?.to).toBeNull();
    expect(playbackOf(null, has, null)).toEqual([]);
  });
});

describe("taking on the world's relationships in the Lattice", () => {
  const known = (id: string) => ["caret", "tessellate", "kevin", "gilt"].includes(id);
  const current = [{ a: "caret", b: "tessellate", kind: "rival" as const, note: "Rocky builds first." }];

  it("updates a changed pair in place and adds a new one", () => {
    const next = adoptRelationships(current, [{ a: "tessellate", b: "caret", kind: "friend", note: "Softened." }, { a: "kevin", b: "gilt", kind: "friend", note: "New." }], known);
    expect(next).toEqual([
      { a: "caret", b: "tessellate", kind: "friend", note: "Softened." },
      { a: "kevin", b: "gilt", kind: "friend", note: "New." },
    ]);
  });

  it("returns the same list when nothing differs, and ignores agents it doesn't know", () => {
    expect(adoptRelationships(current, [{ a: "caret", b: "tessellate", kind: "rival", note: "Rocky builds first." }], known)).toBe(current);
    expect(adoptRelationships(current, [{ a: "caret", b: "nobody", kind: "friend", note: "?" }], known)).toBe(current);
  });
});
