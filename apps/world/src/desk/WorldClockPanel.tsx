import type { LinkState } from "../systems.ts";
import { formatUsd } from "../usage.ts";
import { CLOCK_SLOW_MS, clockHeadline, clockState, clockTime, nextLine, span, useWorldClock } from "../worldClock.ts";
import { WorldHowItWorks } from "./HowItWorks.tsx";
import { link } from "./nav.ts";
import { Panel, Pill } from "./ui.tsx";
import "./worldClock.css";

/**
 * The world clock on the Systems page (issue #53): whether the living Lattice took its hourly step, when the next is
 * due, who wrote the last hour and the world's spend this month against its $6 share. Read live from
 * GET /api/world-step (worldClock.ts polls it every minute); `now` ticks the ages between reads. Its "How it works"
 * pop-over explains the connections behind the step (issue #99).
 */

const PILL: Record<LinkState, string> = { ok: "Ticking", slow: "Overdue", down: "Stopped", off: "Not running" };

/** A ring that fills through the hour and goes amber once it runs past it. */
function Dial({ fraction, state, label }: { fraction: number; state: LinkState; label: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`wclock__dial wclock__dial--${state}`} viewBox="-40 -40 80 80" aria-hidden="true">
      <circle r={r} className="wclock__dial-track" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="0" y1={-r - 5} x2="0" y2={-r - (i % 3 ? 7 : 9)} transform={`rotate(${i * 30})`} className="wclock__tick" />
      ))}
      <circle r={r} className="wclock__dial-fill" strokeDasharray={`${(c * Math.min(1, fraction)).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90)" />
      <text y="5" className="wclock__dial-text">
        {label}
      </text>
    </svg>
  );
}

export function WorldClockPanel({ now }: { now: number }) {
  const status = useWorldClock((s) => s.status);
  const reading = useWorldClock((s) => s.reading);
  const checkedAt = useWorldClock((s) => s.checkedAt);
  const state = clockState(reading, status, now);
  const at = reading?.at ? Date.parse(reading.at) : null;
  const age = at === null ? null : now - at;
  const spend = reading?.spend;
  const share = spend && spend.budget > 0 ? Math.min(1, spend.usd / spend.budget) : 0;
  const source = !reading?.source ? "Not yet" : reading.source === "claude" ? "Claude" : "Scripted";
  const why = !reading
    ? "Claude, or the agents' own lines"
    : !reading.claude
      ? "No Claude key: the agents' own lines"
      : reading.source === "scripted"
        ? "The agents' own lines, for free"
        : "Claude wrote the hour";

  return (
    <Panel
      eyebrow="World clock: the hourly step"
      aside={<Pill tone={state}>{PILL[state]}</Pill>}
      className={`panel--world-clock wclock wclock--${state}`}
      label="World clock"
    >
      <div className="wclock__body">
        <Dial fraction={age === null ? 0 : age / (60 * 60_000)} state={state} label={age === null ? "–" : age < 99 * 60_000 ? `${Math.round(age / 60_000)}m` : `${Math.floor(age / 3_600_000)}h`} />
        <div className="wclock__main">
          <p className="wclock__head" role="status">
            {clockHeadline(reading, status, now)}
          </p>
          <dl className="wclock__grid">
            <div className="wclock__cell">
              <dt>Last hour</dt>
              <dd>
                <b>{reading?.at ? clockTime(reading.at) : "–"}</b>
                <small>{age === null ? "No step yet" : `${span(age)} ago · step ${reading!.step}`}</small>
              </dd>
            </div>
            <div className={`wclock__cell ${state === "slow" || state === "down" ? "wclock__cell--late" : ""}`}>
              <dt>Next due</dt>
              <dd>
                <b>{reading?.nextAt ? clockTime(reading.nextAt) : "–"}</b>
                <small>{nextLine(reading, now)}</small>
              </dd>
            </div>
            <div className="wclock__cell">
              <dt>Written by</dt>
              <dd>
                <b>{source}</b>
                <small>{why}</small>
              </dd>
            </div>
            <div className="wclock__cell">
              <dt>This month</dt>
              <dd>
                <b>{spend ? formatUsd(spend.usd) : "–"}</b>
                <small>{spend ? `of its ${formatUsd(spend.budget)} share · ${spend.calls} by Claude, ${spend.scripted} scripted` : "of its $6.00 share"}</small>
                <span className="wclock__meter" aria-hidden="true">
                  <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
                </span>
              </dd>
            </div>
          </dl>
          <p className="wclock__foot">
            <span>
              Steps at :05 each hour. Amber past {Math.round(CLOCK_SLOW_MS / 60_000)} min, stopped past 3 h.
              {checkedAt ? ` Read ${clockTime(new Date(checkedAt).toISOString())}.` : ""}
            </span>
            <span className="wclock__links">
              <WorldHowItWorks />
              <a className="panel__hint" href="/chronicle" onClick={link("chronicle")}>
                The Chronicle →
              </a>
            </span>
          </p>
        </div>
      </div>
    </Panel>
  );
}
