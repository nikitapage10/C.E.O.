import { describe, expect, it } from "vitest";
import type { Crate } from "../../foundry.ts";
import type { Trail, UsageFeed, UsageIssue } from "../../usage.ts";
import { leftWords, progressMap, progressOf, progressWords, readProgress, stagePct, typicalBySize } from "./progress.ts";

/** Build progress on the jobs in flight (#488): the builder's Progress steps, and the stage-and-history fallback. */

const MIN = 60_000;
const T0 = Date.parse("2026-10-27T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const step = (issue: number, at: number, body: string): Trail => ({ issue, at: iso(at), body });

const crate = (o: Partial<Crate> = {}): Crate => ({
  number: 481,
  title: "Hologram call",
  kind: "chat",
  state: "working",
  rung: null,
  url: "https://github.com/nikitapage10/C.E.O./issues/481",
  updatedAt: T0,
  createdAt: T0,
  pitch: "",
  size: "medium",
  revising: false,
  ...o,
});

const shipped = (number: number, size: string, start: number, end: number): UsageIssue => ({
  number,
  title: `Job ${number}`,
  state: "closed",
  created_at: iso(start),
  closed_at: iso(end),
  body: `**Pitch:** x\n**Size:** ${size}`,
  labels: ["foundry", "foundry:chat", "foundry:shipped"],
});

describe("readProgress", () => {
  it("reads the percent, what's happening and the time left", () => {
    expect(readProgress("**Trail · Progress:** 60% · checks running · about 25 min left")).toEqual({ pct: 60, doing: "checks running", leftMs: 25 * MIN });
    expect(readProgress("**Trail · Progress:** 40% · PR up · about 1 h 10 min left.")).toEqual({ pct: 40, doing: "PR up", leftMs: 70 * MIN });
  });

  it("takes a step with no time left, or no words", () => {
    expect(readProgress("**Trail · Progress:** 10% · started")).toEqual({ pct: 10, doing: "started", leftMs: null });
    expect(readProgress("**Trail · Progress:** 95%")).toEqual({ pct: 95, doing: "", leftMs: null });
  });

  it("only reads the first line, clamps the percent and keeps the words plain", () => {
    const got = readProgress("**Trail · Progress:** 140% · see **https://example.com/x** or a@b.co · about 5 min left\n\nmore text · 2 h left");
    expect(got).toEqual({ pct: 100, doing: "see or", leftMs: 5 * MIN });
  });

  it("ignores other steps and steps without a percent", () => {
    expect(readProgress("**Trail · Work:** chat/488 · try 1 on Opus.")).toBeNull();
    expect(readProgress("**Trail · Progress:** nearly there")).toBeNull();
  });
});

describe("stagePct", () => {
  it("counts the furthest trail step or forge stage", () => {
    expect(stagePct([], null)).toBe(0);
    expect(stagePct([step(1, T0, "**Trail · Assigned:** Rusty on Opus.")], "building")).toBe(25);
    expect(stagePct([step(1, T0, "**Trail · Work:** b")], "pr")).toBe(50);
    expect(stagePct([step(1, T0, "**Trail · Pictures:** x")], "checks")).toBe(75);
    expect(stagePct([step(1, T0, "**Trail · Checks:** green.")], "pr")).toBe(85);
    expect(stagePct([], "green")).toBe(90);
  });
});

describe("typicalBySize", () => {
  it("takes the median of recent shipped jobs of each size, preferring Claude Code run times", () => {
    const feed: UsageFeed = {
      issues: [shipped(1, "medium", T0, T0 + 60 * MIN), shipped(2, "medium", T0, T0 + 30 * MIN), shipped(3, "medium", T0, T0 + 999 * MIN), shipped(4, "small", T0, T0 + 10 * MIN)],
      trails: [step(3, T0 + 999 * MIN, "**Trail · Shipped:** abc on main.\nClaude Code: 120k tokens on Opus, 40 min.")],
    };
    const t = typicalBySize(feed);
    expect(t.medium).toBe(40 * MIN);
    // One small job isn't enough history.
    expect(t.small).toBeNull();
    expect(t.large).toBeNull();
  });

  it("leaves out jobs that sat open for days", () => {
    const feed: UsageFeed = { issues: [shipped(1, "large", T0, T0 + 5 * 24 * 60 * MIN), shipped(2, "large", T0, T0 + 90 * MIN)], trails: [] };
    expect(typicalBySize(feed).large).toBeNull();
  });
});

describe("progressOf", () => {
  const typical = { small: 20 * MIN, medium: 60 * MIN, large: null };

  it("uses the builder's newest Progress step and counts its time down", () => {
    const steps = [step(481, T0, "**Trail · Assigned:** Musty on Opus."), step(481, T0 + 5 * MIN, "**Trail · Progress:** 25% · started · about 50 min left"), step(481, T0 + 20 * MIN, "**Trail · Progress:** 60% · PR up · about 25 min left")];
    const p = progressOf(crate(), "pr", steps, typical, T0 + 30 * MIN)!;
    expect(p).toEqual({ pct: 60, doing: "PR up", leftMin: 15, long: false, source: "builder" });
    expect(progressWords(p)).toBe("60% · about 15 min left");
  });

  it("says running long once the builder's time is up", () => {
    const steps = [step(481, T0, "**Trail · Progress:** 60% · PR up · about 10 min left")];
    const p = progressOf(crate(), "pr", steps, typical, T0 + 30 * MIN)!;
    expect(p.long).toBe(true);
    expect(progressWords(p)).toBe("60% · running long");
  });

  it("falls back to the stage once it has run past what the builder said", () => {
    const steps = [step(481, T0, "**Trail · Assigned:** Musty on Opus."), step(481, T0 + MIN, "**Trail · Progress:** 30% · building · about 40 min left")];
    const p = progressOf(crate(), "green", steps, typical, T0 + 20 * MIN)!;
    expect(p).toMatchObject({ pct: 90, source: "stage", leftMin: 40 });
  });

  it("estimates from the stage and past jobs of its size with no Progress step", () => {
    const steps = [step(481, T0 + 10 * MIN, "**Trail · Assigned:** Musty on Opus."), step(481, T0 + 12 * MIN, "**Trail · Work:** chat/481 · try 1.")];
    expect(progressOf(crate(), "building", steps, typical, T0 + 40 * MIN)).toEqual({ pct: 25, doing: "", leftMin: 30, long: false, source: "stage" });
    expect(progressOf(crate(), "building", steps, typical, T0 + 90 * MIN)).toMatchObject({ long: true });
  });

  it("omits the time with no history for its size", () => {
    const p = progressOf(crate({ size: "large" }), "pr", [], typical, T0)!;
    expect(p).toEqual({ pct: 50, doing: "", leftMin: null, long: false, source: "stage" });
    expect(progressWords(p)).toBe("50%");
  });

  it("gives none to jobs that aren't moving", () => {
    expect(progressOf(crate(), "paused", [], typical, T0)).toBeNull();
    expect(progressOf(crate(), "waiting", [], typical, T0)).toBeNull();
    expect(progressOf(crate(), "stuck", [], typical, T0)).toBeNull();
  });
});

describe("progressMap and words", () => {
  it("is empty until the trails arrive, then keyed by issue", () => {
    expect(progressMap([{ crate: crate(), stage: "pr" }], null, T0).size).toBe(0);
    const feed: UsageFeed = { issues: [], trails: [step(481, T0, "**Trail · Progress:** 60% · checks running · about 25 min left")] };
    expect(progressMap([{ crate: crate(), stage: "pr" }], feed, T0).get(481)?.pct).toBe(60);
  });

  it("rounds long estimates to half hours", () => {
    expect(leftWords({ leftMin: 25, long: false })).toBe("about 25 min left");
    expect(leftWords({ leftMin: 130, long: false })).toBe("about 2 h left");
    expect(leftWords({ leftMin: 100, long: false })).toBe("about 1.5 h left");
    expect(leftWords({ leftMin: null, long: false })).toBe("");
  });
});
