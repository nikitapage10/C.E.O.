import { useEffect, useState } from "react";
import {
  answerSummary,
  cleanAnswerTime,
  SLOW_ANSWER_MS,
  type AnswerSummary,
  type AnswerTime,
} from "../../../api/_skippy/answertimes.ts";
import { readTalkTiming } from "./TalkTimings.tsx";

/**
 * How long Skippy takes to answer on Talk calls (#1065): the last day's typical and slowest times from a question to
 * its answer, and how many ended in the honest "couldn't get that in time" line, marked when any did or the typical
 * answer runs past SLOW_ANSWER_MS. Read with the Talk timings (TalkTimings.tsx, api/_boot/talkTiming.ts).
 * Milliseconds and counts only: never a word of a question or an answer.
 */

const sec = (ms: number) =>
  ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

/** The Talk view's kept answer times as the panel may trust them; null when it has none to read. */
export function answerTimes(view: unknown): AnswerTime[] | null {
  const v = (view as { ok?: unknown; answers?: unknown } | null)?.answers;
  return (view as { ok?: unknown } | null)?.ok === true && Array.isArray(v)
    ? v.map(cleanAnswerTime).filter((t): t is AnswerTime => t !== null)
    : null;
}

/** The fold's one line. */
export function answerLine(s: AnswerSummary): string {
  if (!s.count) return "No calls today";
  const out = `Typically ${sec(s.median!)}, slowest ${sec(s.slowest!)}`;
  return s.timeouts
    ? `${out}, ${s.timeouts} timed out`
    : s.warn
      ? `${out}, slow`
      : out;
}

export function AnswerTimes() {
  const [read, setRead] = useState<{ answers: AnswerTime[] | null; now: number } | null>(null);
  useEffect(() => {
    let gone = false;
    void readTalkTiming().then((v) => !gone && setRead({ answers: answerTimes(v), now: Date.now() }));
    return () => {
      gone = true;
    };
  }, []);
  const s = read?.answers ? answerSummary(read.answers, read.now) : null;
  return (
    <details
      className="bx-more bx-ltime"
      aria-label="How fast Skippy answers on calls"
    >
      <summary>
        <span className="bx-eyb">
          {s?.warn && (
            <i
              className="bx-lampdot is-bad"
              role="img"
              aria-label="Needs a look"
            />
          )}
          Talk · Skippy's answer times
        </span>
        <b>
          {!read
            ? "Reading the answers"
            : !s
              ? "No answer times to read here"
              : answerLine(s)}
        </b>
      </summary>
      <p className="bx-note">
        Each question Skippy is asked on a call, timed from when it reaches him
        to when its answer is said or put into the call, over the last 24 hours.
        Marked when any ran out of time or the typical answer takes over{" "}
        {Math.round(SLOW_ANSWER_MS / 1000)} s. Milliseconds and counts only:
        never a word of a question or an answer.
      </p>
      {s && s.count > 0 && (
        <dl className="bx-readout">
          <div>
            <dt>Typical</dt>
            <dd className={s.median! > SLOW_ANSWER_MS ? "is-bad" : undefined}>
              {sec(s.median!)}
            </dd>
          </div>
          <div>
            <dt>Slowest</dt>
            <dd>{sec(s.slowest!)}</dd>
          </div>
          <div>
            <dt>Timed out</dt>
            <dd className={s.timeouts ? "is-bad" : undefined}>
              {s.timeouts} of {s.count}
            </dd>
          </div>
        </dl>
      )}
    </details>
  );
}
