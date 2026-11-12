import { describe, expect, it } from "vitest";
import { ANSWER_MAX_MS, SLOW_ANSWER_MS, answerSummary, cleanAnswerTime, type AnswerTime } from "./answertimes.ts";
import { GET, MemoryAnswerStore, MemoryTalkStore, timeAnswer } from "../_boot/talkTiming.ts";

/** #1065: Skippy's answer times on calls, summed up for the Desk's Systems card. Milliseconds and kinds only. */

const NOW = Date.parse("2026-11-12T18:00:00Z");
const ago = (h: number) => new Date(NOW - h * 60 * 60_000).toISOString();
const t = (h: number, ms: number, kind: AnswerTime["kind"] = "quick"): AnswerTime => ({ at: ago(h), ms, kind });

describe("answerSummary", () => {
  it("gives the typical and slowest time over the last day, ignoring older answers", () => {
    const s = answerSummary([t(1, 3_000), t(2, 12_000, "search"), t(5, 9_000, "deeper"), t(30, 90_000, "timeout")], NOW);
    expect(s).toEqual({ count: 3, median: 9_000, slowest: 12_000, timeouts: 0, warn: false });
  });

  it("takes the middle two's mean for an even count", () => {
    expect(answerSummary([t(1, 2_000), t(1, 4_000), t(1, 10_000), t(1, 30_000)], NOW).median).toBe(7_000);
  });

  it("counts the honest timeouts and marks them", () => {
    const s = answerSummary([t(1, 3_000), t(2, 46_000, "timeout"), t(3, 4_000)], NOW);
    expect(s.timeouts).toBe(1);
    expect(s.slowest).toBe(46_000);
    expect(s.warn).toBe(true);
  });

  it("marks a typical answer over twenty seconds, and not one at it", () => {
    expect(answerSummary([t(1, SLOW_ANSWER_MS + 1, "search")], NOW).warn).toBe(true);
    expect(answerSummary([t(1, SLOW_ANSWER_MS, "search")], NOW).warn).toBe(false);
  });

  it("has nothing to show with no calls in the window", () => {
    expect(answerSummary([t(25, 3_000)], NOW)).toEqual({ count: 0, median: null, slowest: null, timeouts: 0, warn: false });
  });
});

describe("the kept shape", () => {
  it("keeps the time, the milliseconds and the kind, and nothing else", () => {
    expect(cleanAnswerTime({ at: ago(1), ms: 1234.4, kind: "deeper", question: "anything" })).toEqual({ at: ago(1), ms: 1234, kind: "deeper" });
    expect(cleanAnswerTime({ at: ago(1), ms: 1e9, kind: "quick" })!.ms).toBe(ANSWER_MAX_MS);
    for (const bad of [null, { at: "x", ms: 1, kind: "quick" }, { at: ago(1), ms: -1, kind: "quick" }, { at: ago(1), ms: 1, kind: "unfit" }]) expect(cleanAnswerTime(bad)).toBeNull();
  });
});

describe("the store and the view", () => {
  it("keeps two days at most, newest first, and the Talk view carries them", async () => {
    const answers = new MemoryAnswerStore();
    await answers.add(t(60, 5_000), NOW - 60 * 60 * 60_000);
    const time = timeAnswer(answers);
    await time("search", 9_000, NOW);
    await time("quick", 2_000, NOW);
    expect((await answers.read()).map((x) => x.kind)).toEqual(["quick", "search"]);
    const view = (await (await GET(new Request("https://x/api/talk-timing"), { store: new MemoryTalkStore(), answers, now: NOW })).json()) as { ok: boolean; answers: AnswerTime[] };
    expect(view.ok).toBe(true);
    expect(view.answers).toHaveLength(2);
    expect(Object.keys(view.answers[0]!).sort()).toEqual(["at", "kind", "ms"]);
  });

  it("leaves answers out of the view when they can't be read, and never fails the timing", async () => {
    const broken = { read: async () => Promise.reject(new Error("x")), add: async () => Promise.reject(new Error("x")) };
    const view = (await (await GET(new Request("https://x/api/talk-timing"), { store: new MemoryTalkStore(), answers: broken, now: NOW })).json()) as Record<string, unknown>;
    expect(view.ok).toBe(true);
    expect("answers" in view).toBe(false);
    await expect(timeAnswer(broken)("quick", 1, NOW)).resolves.toBeUndefined();
  });
});
