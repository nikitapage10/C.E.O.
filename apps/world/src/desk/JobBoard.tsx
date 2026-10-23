import { useMemo } from "react";
import { useFoundry } from "../foundry.ts";
import { ago } from "./foundryGraph.ts";
import { jobRows, lateLabel, LATE_MIN, pessimistLine, type JobState } from "./jobs.ts";

/**
 * The Pessimist's board of scheduled jobs (#301), on the Boiler Room's Systems page: every job GitHub runs on a clock,
 * with its last run, whether it passed and how late GitHub started it. His one line on top names what's failing or
 * late. Real runs only, from the Desk's feed (desk/jobs.ts); each row links to its run on GitHub.
 */

const WORD: Record<JobState, string> = { pass: "passed", fail: "failed", running: "running", other: "skipped", none: "no run yet" };

export function JobBoard({ now }: { now: number }) {
  const jobs = useFoundry((s) => s.data.jobs);
  const rows = useMemo(() => jobRows(jobs, now), [jobs, now]);
  return (
    <section className="wv-jobs" data-room="boiler" aria-label="Scheduled jobs">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Scheduled jobs · the Pessimist</p>
          <h2 className="wv-h2">{pessimistLine(rows)}</h2>
        </div>
        <p className="wv-note">Every job GitHub runs on a clock: its last run, whether it passed, and how late GitHub started it against its cron minute.</p>
      </div>
      <ul className="wv-jobs-l">
        {rows.map((r) => {
          const late = r.lateMin !== null && r.lateMin >= LATE_MIN;
          const body = (
            <>
              <i className="wv-dot" />
              <b>{r.name}</b>
              <span className="wv-jobs-when">{r.when}</span>
              <span className="wv-jobs-at">{r.at === null ? "–" : ago(r.at, now)}</span>
              <span className="wv-jobs-st">{r.missed ? "missed" : WORD[r.state]}</span>
              <span className={`wv-jobs-late${late ? " is-late" : ""}`}>{lateLabel(r)}</span>
            </>
          );
          return (
            <li key={r.file} className={`is-${r.missed && r.state !== "fail" ? "missed" : r.state}`}>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {body}
                </a>
              ) : (
                <div>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
