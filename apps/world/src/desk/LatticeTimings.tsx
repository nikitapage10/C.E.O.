import { useEffect, useState } from "react";
import type { Timing, TimingsView, TripKind } from "../../../../api/_boot/types.ts";
import { TRIP_KINDS } from "../../../../api/_boot/types.ts";
import { median, slowdownLine } from "./slowdown.ts";

/**
 * How the Lattice loads on the real machine (#373): the last arrivals the boot-timing beacon recorded
 * (apps/world/src/bootBeacon.ts, api/_boot/timing.ts), newest first, so a change can be compared before and after.
 * Read once when the Boiler Room opens. Timings and counts only.
 */

const KIND: Record<TripKind, string> = { direct: "Opened on it", first: "First trip", warmed: "First trip, warmed", return: "Back again" };

const sec = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

/** Just enough of a check that an answer has the view's shape before the panel draws it. */
export function isTimingsView(v: unknown): v is TimingsView {
  const o = v as Partial<TimingsView> | null;
  return (
    !!o &&
    o.ok === true &&
    Array.isArray(o.timings) &&
    o.timings.every((t: Partial<Timing>) => typeof t?.at === "string" && (TRIP_KINDS as readonly unknown[]).includes(t.kind) && [t.firstFrame, t.curtain, t.fps, t.draws].every((n) => typeof n === "number"))
  );
}

export { median };

export function LatticeTimings() {
  const [view, setView] = useState<TimingsView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off">("loading");
  useEffect(() => {
    let gone = false;
    fetch("/api/lattice-timing", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: unknown) => {
        if (gone) return;
        if (isTimingsView(v)) {
          setView(v);
          setState("ok");
        } else setState("off");
      })
      .catch(() => !gone && setState("off"));
    return () => {
      gone = true;
    };
  }, []);

  const list = view?.timings ?? [];
  const firsts = median(list.filter((t) => t.kind !== "return" && t.kind !== "direct").map((t) => t.firstFrame));
  const returns = median(list.filter((t) => t.kind === "return").map((t) => t.firstFrame));
  const fps = median(list.map((t) => t.fps));
  const slower = slowdownLine(list.filter((t) => t.kind !== "return" && t.kind !== "direct").map((t) => t.firstFrame));

  return (
    <details className="bx-more bx-ltime" aria-label="How the Lattice loads">
      <summary>
        <span className="bx-eyb">The Lattice · how it loads on this machine</span>
        <b>
          {state === "loading" ? "Reading the timings" : state === "off" ? "No timings to read here" : !list.length ? "No arrival timed yet" : `Desk to Lattice ${firsts === null ? "–" : sec(firsts)} first, ${returns === null ? "–" : sec(returns)} after`}
        </b>
      </summary>
      <p className="bx-note">
        Each trip into the Lattice, timed in your own browser: from the click to the first frame on screen and to the curtain lifting, then the frame rate over
        the next five seconds. Timings and counts only.
      </p>
      {list.length > 0 && (
        <>
          <dl className="bx-readout">
            <div>
              <dt>First trip</dt>
              <dd>{firsts === null ? "–" : sec(firsts)}</dd>
            </div>
            <div>
              <dt>Back again</dt>
              <dd>{returns === null ? "–" : sec(returns)}</dd>
            </div>
            <div>
              <dt>Frame rate</dt>
              <dd>{fps === null ? "–" : `${fps} fps`}</dd>
            </div>
          </dl>
          {slower && <p className="bx-note">{slower}</p>}
          <div className="bx-ltime-scroll">
            <table className="bx-ltime-t">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Trip</th>
                  <th scope="col">First frame</th>
                  <th scope="col">Curtain</th>
                  <th scope="col">fps</th>
                  <th scope="col">Slowest frame</th>
                  <th scope="col">Draw calls</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 12).map((t) => (
                  <tr key={`${t.at}-${t.trip}`}>
                    <td>{new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td>{KIND[t.kind]}</td>
                    <td>{sec(t.firstFrame)}</td>
                    <td>{sec(t.curtain)}</td>
                    <td>{t.fps}</td>
                    <td>{t.worstFrame} ms</td>
                    <td>{t.draws}</td>
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
