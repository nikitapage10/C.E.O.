import { describe, expect, it } from "vitest";
import { COUNSEL_MEMOS, HUD_PEEKS, NOTICED, STARES } from "./lines.ts";
import { GLITCHES, GLITCH_BY_ID } from "./registry.ts";
import { LEGAL_AT, LEVEL_GAPS, legalFollowUp, nextDelay, pickGlitch } from "./scheduler.ts";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("glitch registry", () => {
  it("has unique ids and sane timings", () => {
    expect(Object.keys(GLITCH_BY_ID)).toHaveLength(GLITCHES.length);
    for (const g of GLITCHES) {
      expect(g.durationMs).toBeGreaterThan(1000);
      expect(g.weight).toBeGreaterThan(0);
      if (g.legal) expect(g.kind).toBe("intrusion");
    }
  });

  it("covers every kind, with at least ten intrusions", () => {
    const kinds = new Set(GLITCHES.map((g) => g.kind));
    expect(kinds).toEqual(new Set(["intrusion", "legal", "fourth_wall"]));
    expect(GLITCHES.filter((g) => g.kind === "intrusion").length).toBeGreaterThanOrEqual(10);
  });

  it("never names a real mascot in its disclaimers or lines", () => {
    const text = [...GLITCHES.map((g) => g.disclaimer ?? ""), ...STARES, ...NOTICED, ...COUNSEL_MEMOS, ...HUD_PEEKS].join(" ").toLowerCase();
    for (const name of ["chester", "cheetos", "clippy", "mickey", "disney", "tinker bell", "aol"]) expect(text).not.toContain(name);
  });
});

describe("scheduler", () => {
  it("is silent in Serious mode and much busier when Unhinged", () => {
    expect(nextDelay("off", Math.random)).toBeNull();
    const normal = nextDelay("normal", () => 0.5)!;
    const unhinged = nextDelay("unhinged", () => 0.5)!;
    expect(unhinged).toBeLessThan(normal);
    expect(normal).toBeGreaterThanOrEqual(LEVEL_GAPS.normal!.min);
  });

  it("respects cooldowns", () => {
    const now = 1_000_000;
    const allRecent = Object.fromEntries(GLITCHES.map((g) => [g.id, now - 1]));
    expect(pickGlitch(GLITCHES, Math.random, now, allRecent)).toBeNull();
    const { stare: _s, ...othersRecent } = allRecent;
    expect(pickGlitch(GLITCHES, Math.random, now, othersRecent)?.id).toBe("stare");
  });

  it("picks by weight", () => {
    const first = pickGlitch(GLITCHES, () => 0, 0, {});
    expect(first?.id).toBe(GLITCHES[0]!.id);
    const last = pickGlitch(GLITCHES, () => 0.999999, 0, {});
    expect(last?.id).toBe(GLITCHES.at(-1)!.id);
  });

  it("only sends Counsel.exe after intrusions that allow it", () => {
    const fairy = GLITCH_BY_ID["absinthe-fairy"]!;
    expect(legalFollowUp(fairy, seq(0.1, 0))).toBe("stamp");
    expect(legalFollowUp(fairy, seq(0.9))).toBeNull();
    expect(legalFollowUp(GLITCH_BY_ID.stare!, seq(0))).toBeNull();
    expect(legalFollowUp(GLITCH_BY_ID["glyph-rain"]!, seq(0))).toBeNull();
    for (const at of Object.values(LEGAL_AT)) expect(at).toBeGreaterThan(0.3);
  });
});
