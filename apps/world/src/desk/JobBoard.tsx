import { useMemo } from "react";
import { useFoundry } from "../foundry.ts";
import { ago } from "./foundryGraph.ts";
import { jobRows, lateLabel, LATE_MIN, type JobState } from "./jobs.ts";

/**
 * The Boiler Room's scheduled jobs (#301; an instrument since #369): every job GitHub runs on a clock, as counts first
 * (passed, failed, missed, late), then the list behind a fold, each with its last run, whether it passed and how late
 * GitHub started it. Real runs only, from the Desk's feed (desk/jobs.ts); each row links to its run on GitHub.
 */

const WORD: Record<JobState, string> = { pass: "passed", fail: "failed", running: "running", other: "skipped", none: "no run yet" };

export function JobBoard({ now }: { now: number }) {
  const jobs = useFoundry((s) => s.data.jobs);
  const rows = useMemo(() => jobRows(jobs, now), [jobs, now]);
  const seen = rows.filter((r) => r.state !== "none");
  const failed = seen.filter((r) => r.state === "fail").length;
  const missed = seen.filter((r) => r.missed && r.state !== "fail").length;
  const late = seen.filter((r) => !r.missed && r.state !== "fail" && r.lateMin !== null && r.lateMin >= LATE_MIN).length;
  const passed = seen.filter((r) => r.state === "pass").length;
  const tone = !seen.length ? "wait" : failed || missed ? "bad" : late ? "run" : "ok";
  return (
    <section className={`bx-card bx-jobs is-${tone}`} data-room="boiler" aria-label="Scheduled jobs">
      <p className="bx-eyb">
        <i className={`bx-lampdot is-${tone}`} aria-hidden="true" /> Scheduled jobs · GitHub Actions
      </p>
      <h2 className="bx-h2">{seen.length ? `${passed} of ${rows.length} passed` : "No runs seen yet"}</h2>
      <dl className="bx-readout">
        <div>
          <dt>Failed</dt>
          <dd className={failed ? "is-bad" : undefined}>{seen.length ? failed : "–"}</dd>
        </div>
        <div>
          <dt>Missed</dt>
          <dd className={missed ? "is-bad" : undefined}>{seen.length ? missed : "–"}</dd>
        </div>
        <div>
          <dt>Late</dt>
          <dd className={late ? "is-run" : undefined}>{seen.length ? late : "–"}</dd>
        </div>
      </dl>
      <details className="bx-fold">
        <summary>Every job, its last run and how late it started</summary>
        <ul className="bx-jobs-l">
          {rows.map((r) => {
            const isLate = r.lateMin !== null && r.lateMin >= LATE_MIN;
            const body = (
              <>
                <i className="bx-lampdot" />
                <b>{r.name}</b>
                <span className="bx-jobs-when">{r.when}</span>
                <span className="bx-jobs-at">{r.at === null ? "–" : ago(r.at, now)}</span>
                <span className="bx-jobs-st">{r.missed ? "missed" : WORD[r.state]}</span>
                <span className={`bx-jobs-late${isLate ? " is-late" : ""}`}>{lateLabel(r)}</span>
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
      </details>
    </section>
  );
}
