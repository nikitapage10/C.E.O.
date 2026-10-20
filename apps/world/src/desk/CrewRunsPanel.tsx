import { countdown, nextRuns, runTime } from "./crewRuns.ts";
import { Panel } from "./ui.tsx";
import "./worldClock.css";

/** When the crew runs next (issue #205): the next queue check, upkeep and morning ideas, counted down from `now`. */
export function CrewRunsPanel({ now }: { now: number }) {
  const at = new Date(now);
  const next = nextRuns(at);
  const rows = [
    { name: "Queue check", to: next.queue, about: false, note: "Every 15 min" },
    { name: "Upkeep", to: next.upkeep, about: true, note: "Every 5 h, may start a few min late" },
    { name: "Morning ideas", to: next.ideas, about: false, note: "9:00 am each day" },
  ];
  return (
    <Panel eyebrow="Next runs: the crew" className="panel--crew-runs" label="Next runs">
      <dl className="wclock__grid">
        {rows.map((r) => (
          <div className="wclock__cell" key={r.name}>
            <dt>{r.name}</dt>
            <dd>
              <b>{countdown(r.to, at, r.about)}</b>
              <small>
                {r.about ? "about " : ""}
                {runTime(r.to)} · {r.note}
              </small>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
