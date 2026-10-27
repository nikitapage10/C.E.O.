import { describe, expect, it } from "vitest";
import type { Crate, OpenPr, PullTiming } from "../../foundry.ts";
import type { Trail } from "../../usage.ts";
import { assignedTimes, leftWords, progressMap, progressOf, progressWords, readNote, reached, stepPct, stepTimes, stepWords, type StepTimes } from "./progress.ts";

/** Build progress on the jobs in flight (#488): step N of seven real milestones, and time left from measured steps. */

const MIN = 60_000;
const T0 = Date.parse("2026-10-27T07:00:00Z");
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

const pr = (o: Partial<OpenPr> = {}): OpenPr => ({ number: 487, url: "https://github.com/x/pull/487", at: T0 + 10 * MIN, draft: false, issue: 481, checks: "unknown", checksAt: null, greenAt: null, ...o });

/** A merged pull request whose steps took 5, 3, 1, 12, 2 and 6 minutes after its Assigned step at `start`. */
const timed = (issue: number, start: number, k = 1): PullTiming => ({
  issue,
  pushed: start + 5 * k * MIN,
  opened: start + 8 * k * MIN,
  checksAt: start + 9 * k * MIN,
  greenAt: start + 21 * k * MIN,
  merged: start + 23 * k * MIN,
  deployed: start + 29 * k * MIN,
});

describe("readNote", () => {
  it("keeps the builder's words and drops any percent or time left", () => {
    expect(readNote("**Trail · Progress:** fixing the phone layout")).toBe("fixing the phone layout");
    expect(readNote("**Trail · Progress:** 60% · checks running on PR #489 · about 25 min left")).toBe("checks running on PR #489");
    expect(readNote("**Trail · Progress:** 95%")).toBeNull();
  });

  it("only reads the first line and keeps the words plain", () => {
    expect(readNote("**Trail · Progress:** see **https://example.com/x** or a@b.co\n\nmore")).toBe("see or");
    expect(readNote("**Trail · Work:** chat/488 · try 1 on Opus.")).toBeNull();
  });
});

describe("the milestones", () => {
  it("gives each step a fixed share of seven", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(stepPct)).toEqual([14, 29, 43, 57, 71, 86, 100]);
    expect(stepWords({ step: 4, at: "checks" })).toBe("Step 4 of 7, checks running");
  });

  it("reads where a job is from GitHub: its pull request's checks, its branch, else assigned", () => {
    expect(reached(crate(), null, false, T0 + MIN)).toEqual({ at: "assigned", since: T0 + MIN, step: 1 });
    expect(reached(crate(), null, true, T0)).toEqual({ at: "pushed", since: null, step: 2 });
    expect(reached(crate(), pr(), true, T0)).toEqual({ at: "open", since: T0 + 10 * MIN, step: 3 });
    expect(reached(crate(), pr({ checks: "running", checksAt: T0 + 11 * MIN }), true, T0)).toEqual({ at: "checks", since: T0 + 11 * MIN, step: 4 });
    expect(reached(crate(), pr({ checks: "pass", greenAt: T0 + 20 * MIN }), true, T0)).toEqual({ at: "green", since: T0 + 20 * MIN, step: 5 });
    // Red checks: back at the pull request, the fix still to come.
    expect(reached(crate(), pr({ checks: "fail" }), true, T0).step).toBe(3);
  });
});

describe("stepTimes", () => {
  it("measures each step's median from merged pull requests and their Assigned steps", () => {
    const assigned = new Map([[1, T0], [2, T0], [3, T0]]);
    const times = stepTimes([timed(1, T0), timed(2, T0, 2), timed(3, T0, 3)], assigned);
    expect(times.map((t) => t.ms! / MIN)).toEqual([10, 6, 2, 24, 4, 12]);
    expect(times.every((t) => t.n === 3)).toBe(true);
  });

  it("has no median for a step measured fewer than twice, or only from days-long gaps", () => {
    const times = stepTimes([timed(1, T0), { ...timed(2, T0), deployed: null }, { ...timed(3, T0), deployed: T0 + 9 * 24 * 60 * MIN }], new Map());
    // No Assigned steps: the first step has no history.
    expect(times[0]).toEqual({ ms: null, n: 0 });
    expect(times[5]).toEqual({ ms: null, n: 1 });
    expect(times[3]!.ms).toBe(12 * MIN);
  });

  it("dates assignment from the first Assigned step, else the first Work step", () => {
    const got = assignedTimes([step(1, T0 + 5 * MIN, "**Trail · Assigned:** Rusty on Opus."), step(1, T0 + 2 * MIN, "**Trail · Work:** b"), step(2, T0 + 3 * MIN, "**Trail · Work:** b"), step(2, T0 + 9 * MIN, "**Trail · Work:** b again")]);
    expect(got).toEqual(new Map([[1, T0 + 5 * MIN], [2, T0 + 3 * MIN]]));
  });
});

describe("progressOf", () => {
  // Measured: 5, 3, 1, 12, 2 and 6 minutes.
  const times: StepTimes = [5, 3, 1, 12, 2, 6].map((m) => ({ ms: m * MIN, n: 4 }));

  it("sums the steps still to go, less the live CI run's elapsed time", () => {
    const p = progressOf(crate(), "checks", pr({ checks: "running", checksAt: T0 + 11 * MIN }), true, [], times, T0, T0 + 15 * MIN)!;
    // Checks: 12 − 4 run so far = 8, then 2 to merge and 6 to deploy.
    expect(p).toEqual({ step: 4, at: "checks", pct: 57, doing: "", leftMin: 16, measured: 4 });
    expect(progressWords(p)).toBe("57% · about 16 min left");
  });

  it("never counts a step past its median below nothing", () => {
    const p = progressOf(crate(), "green", pr({ checks: "pass", greenAt: T0 }), true, [], times, T0, T0 + 60 * MIN)!;
    expect(p.leftMin).toBe(6);
  });

  it("takes the builder's note as words, never as the percent", () => {
    const steps = [step(481, T0, "**Trail · Progress:** 95% · wiring the call · about 1 min left")];
    const p = progressOf(crate(), "building", null, false, steps, times, T0, T0 + 2 * MIN)!;
    expect(p).toMatchObject({ step: 1, pct: 14, doing: "wiring the call" });
    expect(p.leftMin).toBe(27);
  });

  it("drops the time when a step still to go has no history", () => {
    const thin: StepTimes = times.map((t, i) => (i === 5 ? { ms: null, n: 1 } : t));
    const p = progressOf(crate(), "pr", pr(), true, [], thin, T0, T0)!;
    expect(p).toMatchObject({ step: 3, leftMin: null, measured: 0 });
    expect(progressWords(p)).toBe("43%");
  });

  it("gives none to jobs that aren't moving", () => {
    for (const s of ["paused", "waiting", "stuck"] as const) expect(progressOf(crate(), s, null, false, [], times, T0, T0)).toBeNull();
  });
});

describe("progressMap and words", () => {
  it("measures from the feed and keys by issue", () => {
    const trails = [1, 2, 3].map((n) => step(n, T0, "**Trail · Assigned:** Rusty on Opus."));
    const got = progressMap([{ crate: crate(), stage: "pr", pr: pr() }], trails, [timed(1, T0), timed(2, T0), timed(3, T0)], [481], T0 + 10 * MIN);
    // Pull request open: 1 + 12 + 2 + 6.
    expect(got.get(481)).toMatchObject({ step: 3, leftMin: 21, measured: 3 });
  });

  it("rounds long estimates to half hours", () => {
    expect(leftWords({ leftMin: 25 })).toBe("about 25 min left");
    expect(leftWords({ leftMin: 130 })).toBe("about 2 h left");
    expect(leftWords({ leftMin: 100 })).toBe("about 1.5 h left");
    expect(leftWords({ leftMin: null })).toBe("");
  });
});
