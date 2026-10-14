import { Panel, Pill } from "../ui.tsx";
import { describeRun, useVisualQa } from "./feed.ts";
import "./visualQa.css";

/**
 * Systems > Foundry: the latest Visual QA run (#91). After every push to main a tour records each Lattice room and
 * Gemini watches the clips for visual bugs; blockers become fix issues. This shows the last run's time, rooms checked,
 * findings and a link to the run, from api/visual-qa-feed.ts. Real data only.
 */

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export function VisualQaPanel() {
  const { feed } = useVisualQa();
  const run = feed?.latest ?? null;
  const d = describeRun(run);
  return (
    <Panel eyebrow="Visual QA: Gemini watches every room" aside={<Pill tone={d.tone}>{d.pill}</Pill>} className="panel--vqa vqa" label="Visual QA">
      <p className="vqa__head" role="status">
        {d.line}
      </p>
      {run && (
        <dl className="vqa__grid">
          <div className="vqa__cell">
            <dt>Last run</dt>
            <dd>
              <b>{when(run.at)}</b>
            </dd>
          </div>
          <div className="vqa__cell">
            <dt>Rooms checked</dt>
            <dd>
              <b>{run.rooms}</b>
            </dd>
          </div>
          <div className="vqa__cell">
            <dt>Findings</dt>
            <dd>
              <b>{run.findings}</b>
              <small>
                {run.blockers} {run.blockers === 1 ? "blocker" : "blockers"}
              </small>
            </dd>
          </div>
        </dl>
      )}
      <p className="vqa__foot">
        <span>After every push to main: a short clip of each room, watched by Gemini. In the Lattice, Rivet walks the rooms with her far-sight lens.</span>
        {run && (
          <a className="panel__hint" href={run.url} target="_blank" rel="noreferrer">
            Open the run →
          </a>
        )}
      </p>
    </Panel>
  );
}
