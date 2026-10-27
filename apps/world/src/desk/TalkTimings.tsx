import { useEffect, useState } from "react";
import type {
  TalkCall,
  TalkCallsView,
} from "../../../../api/_boot/talkTiming.ts";
import { median } from "./LatticeTimings.tsx";

/**
 * How fast Talk starts on real calls (#512): the last calls the Talk beacon recorded (skippy/talkBeacon.ts,
 * api/_boot/talkTiming.ts), newest first, with the median tap to Skippy's first word and the stage that took longest.
 * Read once when the Boiler Room opens. Stage names and milliseconds only.
 */

const sec = (ms: number) =>
  ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

const LABEL: Record<string, string> = {
  mic: "Microphone",
  token: "Token",
  code: "Call code",
  connected: "Connecting",
  firstWord: "First word",
  desk: "Desk lines",
};
const label = (k: string) => LABEL[k] ?? k;

export function isTalkCallsView(v: unknown): v is TalkCallsView {
  const o = v as Partial<TalkCallsView> | null;
  return (
    !!o &&
    o.ok === true &&
    Array.isArray(o.calls) &&
    o.calls.every(
      (c: Partial<TalkCall>) =>
        typeof c?.at === "string" &&
        typeof c.ok === "boolean" &&
        !!c.stages &&
        typeof c.stages === "object" &&
        !!c.server &&
        typeof c.server === "object",
    )
  );
}

/** The steps of a call: each client stage's own share (time since the stage before it), then the server's stages. */
export function callSteps(c: TalkCall): [string, number][] {
  const steps: [string, number][] = [];
  const order = ["mic", "token", "connected", "firstWord"] as const;
  let prev = 0;
  for (const k of order) {
    const at = c.stages[k];
    if (at === undefined) continue;
    steps.push([k, Math.max(0, at - prev)]);
    prev = at;
  }
  for (const [k, ms] of Object.entries(c.server)) steps.push([k, ms]);
  return steps;
}

/** The stage that took longest, typically, across the calls: the median of each stage's time, the biggest one named. */
export function slowestStage(
  calls: TalkCall[],
): { stage: string; ms: number } | null {
  const by = new Map<string, number[]>();
  for (const c of calls)
    for (const [k, ms] of callSteps(c)) by.set(k, [...(by.get(k) ?? []), ms]);
  let best: { stage: string; ms: number } | null = null;
  for (const [stage, xs] of by) {
    const ms = median(xs);
    if (ms !== null && (!best || ms > best.ms)) best = { stage, ms };
  }
  return best;
}

export function TalkTimings() {
  const [view, setView] = useState<TalkCallsView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off">("loading");
  useEffect(() => {
    let gone = false;
    fetch("/api/talk-timing", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: unknown) => {
        if (gone) return;
        if (isTalkCallsView(v)) {
          setView(v);
          setState("ok");
        } else setState("off");
      })
      .catch(() => !gone && setState("off"));
    return () => {
      gone = true;
    };
  }, []);

  const list = view?.calls ?? [];
  const good = list.filter((c) => c.ok && c.stages.firstWord !== undefined);
  const first = median(good.map((c) => c.stages.firstWord!));
  const slow = slowestStage(good);
  const failed = list.length - good.length;

  return (
    <details className="bx-more bx-ltime" aria-label="How fast Talk starts">
      <summary>
        <span className="bx-eyb">Talk · how fast calls start</span>
        <b>
          {state === "loading"
            ? "Reading the calls"
            : state === "off"
              ? "No calls to read here"
              : !list.length
                ? "No call timed yet"
                : `Calls ${first === null ? "–" : sec(first)} to first word${slow ? `, slowest ${label(slow.stage).toLowerCase()}` : ""}`}
        </b>
      </summary>
      <p className="bx-note">
        Each Talk call, timed in your own browser from the tap to Skippy's first
        word, with the server's stages from the start. The last 40 are kept.
        Stage names and milliseconds only: never a word, a sound or a
        transcript.
      </p>
      {list.length > 0 && (
        <>
          <dl className="bx-readout">
            <div>
              <dt>Median first word</dt>
              <dd>{first === null ? "–" : sec(first)}</dd>
            </div>
            <div>
              <dt>Slowest stage</dt>
              <dd>{slow ? `${label(slow.stage)} ${sec(slow.ms)}` : "–"}</dd>
            </div>
            <div>
              <dt>Calls kept</dt>
              <dd>
                {failed ? `${list.length} (${failed} failed)` : list.length}
              </dd>
            </div>
          </dl>
          <div className="bx-ltime-scroll">
            <table className="bx-ltime-t">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Result</th>
                  <th scope="col">First word</th>
                  <th scope="col">Longest stage</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 8).map((c) => {
                  const top = callSteps(c).sort((a, b) => b[1] - a[1])[0];
                  return (
                    <tr key={c.at}>
                      <td>
                        {new Date(c.at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td>{c.ok ? "Spoke" : "Failed"}</td>
                      <td>
                        {c.stages.firstWord === undefined
                          ? "–"
                          : sec(c.stages.firstWord)}
                      </td>
                      <td>{top ? `${label(top[0])} ${sec(top[1])}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
