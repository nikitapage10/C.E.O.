import { describe, expect, it } from "vitest";
import { debateAt, debateLines, debateOpen, DEBATES, isMember } from "./debates.ts";
import { ROTUNDA_SAY_MAX } from "../../../../api/_skippy/rotundavoice.ts";

describe("the Senate in recess (#878)", () => {
  it("rotates through a curated set, each argued by several members with a dissent", () => {
    expect(DEBATES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(DEBATES.map((d) => d.key)).size).toBe(DEBATES.length);
    for (const d of DEBATES) {
      expect(d.lines.length, d.key).toBeGreaterThanOrEqual(4);
      expect(d.lines[0]!.stance, d.key).toBe("open");
      expect(d.lines.filter((l) => l.stance === "nay").length, d.key).toBe(1);
      expect(d.lines.some((l) => l.stance === "aye"), d.key).toBe(true);
      expect(new Set(d.lines.map((l) => l.by)).size, d.key).toBe(d.lines.length);
      for (const l of d.lines) expect(isMember(l.by), `${d.key}: ${l.by}`).toBe(true);
    }
    expect(debateAt(0)).toBe(DEBATES[0]);
    expect(debateAt(DEBATES.length + 1)).toBe(DEBATES[1]);
    expect(debateAt(-1)).toBe(DEBATES[DEBATES.length - 1]);
  });

  it("every line fits the chamber's voice and never says whose taste it is", () => {
    for (const d of DEBATES)
      for (const { text } of debateLines(d)) {
        expect(text.length, text).toBeLessThanOrEqual(ROTUNDA_SAY_MAX);
        expect(text).not.toMatch(/nikita|favou?rite|your (taste|pick)/i);
      }
    expect(debateOpen(DEBATES[0]!)).toMatch(/^The chamber is in recess\./);
  });
});
