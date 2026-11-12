import { describe, expect, it } from "vitest";
import { answerSummary, type AnswerTime } from "../../../api/_skippy/answertimes.ts";
import { answerLine, answerTimes } from "./AnswerTimes.tsx";

/** #1065: the Systems card's fold for Skippy's answer times on calls. */

const NOW = Date.parse("2026-11-12T18:00:00Z");
const ago = (h: number) => new Date(NOW - h * 60 * 60_000).toISOString();
const t = (h: number, ms: number, kind: AnswerTime["kind"] = "quick"): AnswerTime => ({ at: ago(h), ms, kind });

describe("the answer times fold", () => {
  it("says so plainly with no calls in the window, never a made-up number", () => {
    expect(answerLine(answerSummary([], NOW))).toBe("No calls today");
    expect(answerLine(answerSummary([t(26, 3_000)], NOW))).toBe("No calls today");
  });

  it("reads the Desk's view only when it carries answers", () => {
    expect(answerTimes({ ok: true, calls: [], answers: [t(1, 2_000), { at: 1 }] })).toEqual([t(1, 2_000)]);
    expect(answerTimes({ ok: true, calls: [] })).toBeNull();
    expect(answerTimes(null)).toBeNull();
  });

  it("words the fold's line", () => {
    expect(answerLine(answerSummary([t(1, 3_000), t(1, 11_000, "search")], NOW))).toBe("Typically 7.0 s, slowest 11 s");
    expect(answerLine(answerSummary([t(1, 3_000), t(1, 45_500, "timeout")], NOW))).toBe("Typically 24 s, slowest 46 s, 1 timed out");
    expect(answerLine(answerSummary([t(1, 25_000, "deeper")], NOW))).toBe("Typically 25 s, slowest 25 s, slow");
  });
});

