/**
 * How long Skippy takes to answer on a Talk call (#1065): each question timed from when it reached the call's tools to
 * when its final answer was said (the quick pass, toolroute.ts) or kept for the call (calldeliver.ts), with how it
 * ended. Kept with the Talk timings (api/_boot/talkTiming.ts) and shown on the Boiler Room's Systems card.
 *
 * Milliseconds, the kind and the time only: never a word of the question or the answer.
 *
 * Pure, so the Desk can import it. Underscore folder: Vercel never serves it as a function.
 */

/** How a question ended: answered in the tool's own seconds, by the call's search, by the deeper run, or not in time. */
export const ANSWER_KINDS = ["quick", "search", "deeper", "timeout"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export interface AnswerTime {
  /** When the answer was decided (ISO). */
  at: string;
  /** From the question to its answer. */
  ms: number;
  kind: AnswerKind;
}

/** The window the Desk shows. */
export const ANSWER_WINDOW_MS = 24 * 60 * 60_000;
/** A typical answer slower than this is flagged. */
export const SLOW_ANSWER_MS = 20_000;
/** The longest time kept (a stuck run's figure is clamped, not dropped). */
export const ANSWER_MAX_MS = 10 * 60_000;

/** One kept timing as it may be read back, or null when it isn't one. Unknown fields are dropped, the time clamped. */
export function cleanAnswerTime(v: unknown): AnswerTime | null {
  const o = v as Partial<AnswerTime> | null;
  if (!o || typeof o !== "object") return null;
  if (typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at))) return null;
  if (typeof o.ms !== "number" || !Number.isFinite(o.ms) || o.ms < 0) return null;
  if (!(ANSWER_KINDS as readonly unknown[]).includes(o.kind)) return null;
  return { at: o.at, ms: Math.min(ANSWER_MAX_MS, Math.round(o.ms)), kind: o.kind as AnswerKind };
}

export interface AnswerSummary {
  /** Answers in the window. */
  count: number;
  /** The typical (median) time, null with none. */
  median: number | null;
  /** The slowest time, null with none. */
  slowest: number | null;
  /** How many ended in the honest "couldn't get that in time" line. */
  timeouts: number;
  /** Something to look at: any timeout, or a typical answer over SLOW_ANSWER_MS. */
  warn: boolean;
}

/** The last day's answers on calls, summed up; every answer counts, the timeouts at the time they gave up. */
export function answerSummary(list: AnswerTime[], now: number, windowMs = ANSWER_WINDOW_MS): AnswerSummary {
  const inWindow = list.filter((t) => {
    const at = Date.parse(t.at);
    return at <= now && now - at <= windowMs;
  });
  const ms = inWindow.map((t) => t.ms).sort((a, b) => a - b);
  const mid = Math.floor(ms.length / 2);
  const median = !ms.length ? null : ms.length % 2 ? ms[mid]! : Math.round((ms[mid - 1]! + ms[mid]!) / 2);
  const timeouts = inWindow.filter((t) => t.kind === "timeout").length;
  return {
    count: inWindow.length,
    median,
    slowest: ms.length ? ms[ms.length - 1]! : null,
    timeouts,
    warn: timeouts > 0 || (median !== null && median > SLOW_ANSWER_MS),
  };
}
