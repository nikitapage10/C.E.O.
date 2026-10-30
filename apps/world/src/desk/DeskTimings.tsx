import { useEffect, useState } from "react";
import type { DeskLoad, DeskLoadsView } from "../../../../api/_boot/deskTiming.ts";
import { median } from "./LatticeTimings.tsx";
import { slowdownLine } from "./slowdown.ts";

/**
 * How fast the Desk opens on real loads (#561): the last loads the Desk beacon recorded (deskBeacon.ts,
 * api/_boot/deskTiming.ts), newest first, with the median to first paint and to live data. Read once when the Boiler
 * Room opens. Milliseconds only.
 */

const sec = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

export function isDeskLoadsView(v: unknown): v is DeskLoadsView {
  const o = v as Partial<DeskLoadsView> | null;
  return !!o && o.ok === true && Array.isArray(o.loads) && o.loads.every((c: Partial<DeskLoad>) => typeof c?.at === "string" && typeof c.firstPaint === "number" && typeof c.dataReady === "number");
}

export function DeskTimings() {
  const [view, setView] = useState<DeskLoadsView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off">("loading");
  useEffect(() => {
    let gone = false;
    fetch("/api/desk-timing", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: unknown) => {
        if (gone) return;
        if (isDeskLoadsView(v)) {
          setView(v);
          setState("ok");
        } else setState("off");
      })
      .catch(() => !gone && setState("off"));
    return () => {
      gone = true;
    };
  }, []);

  const list = view?.loads ?? [];
  const paint = median(list.map((c) => c.firstPaint));
  const data = median(list.map((c) => c.dataReady));
  const slower = slowdownLine(list.map((c) => c.firstPaint));

  return (
    <details className="bx-more bx-ltime" aria-label="How fast the Desk opens">
      <summary>
        <span className="bx-eyb">Desk · how fast it opens</span>
        <b>
          {state === "loading"
            ? "Reading the loads"
            : state === "off"
              ? "No loads to read here"
              : !list.length
                ? "No load timed yet"
                : `Opens ${paint === null ? "–" : sec(paint)}, live data ${data === null ? "–" : sec(data)}`}
        </b>
      </summary>
      <p className="bx-note">
        Each time the Desk opens as the first page, timed in your own browser from the page opening to its first paint and to its live data being ready. The last 40 are kept. Two numbers only: no address, no browser details, nothing typed or read.
      </p>
      {list.length > 0 && (
        <>
          <dl className="bx-readout">
            <div>
              <dt>Median first paint</dt>
              <dd>{paint === null ? "–" : sec(paint)}</dd>
            </div>
            <div>
              <dt>Median live data</dt>
              <dd>{data === null ? "–" : sec(data)}</dd>
            </div>
            <div>
              <dt>Loads kept</dt>
              <dd>{list.length}</dd>
            </div>
          </dl>
          {slower && <p className="bx-note">{slower}</p>}
          <div className="bx-ltime-scroll">
            <table className="bx-ltime-t">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">First paint</th>
                  <th scope="col">Live data</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 8).map((c) => (
                  <tr key={c.at}>
                    <td>{new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td>{sec(c.firstPaint)}</td>
                    <td>{sec(c.dataReady)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
