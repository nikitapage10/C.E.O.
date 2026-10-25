import { useMemo, useState } from "react";
import { asideBadge, asideLine, byMove, KIND_LABEL, shortName } from "./asides.ts";
import { move, moveTone, pct, usePolymarket } from "./polymarket.ts";
import { DayArea } from "./viz.tsx";

/**
 * What's moving the world (#345; on the flow kit since #430): the Bookie's world-moving odds (geopolitics, politics,
 * pop culture; never sports), biggest move first. One market holds the panel: its odds and the day's move in Bodoni,
 * the question, one line in the Bookie's voice and the day's price drawn in; beside it the movers, each a row you tap
 * to put it in the panel. Real data only: until Polymarket answers, it says it's waiting. Public odds only.
 */

const arrow = (c: number | null) => {
  const t = moveTone(c);
  return t === "flat" ? (c === null ? "–" : "0.0") : `${t === "up" ? "▲" : "▼"}${move(c).replace(/^[+−]/, "")}`;
};

export function Movers() {
  const status = usePolymarket((s) => s.status);
  const raw = usePolymarket((s) => s.board?.world);
  const world = useMemo(() => byMove(raw ?? []), [raw]);
  const [at, setAt] = useState(0);
  const i = world.length ? at % world.length : 0;
  const m = world[i] ?? null;

  return (
    <section className="xc-sec xc-world" aria-label="What's moving the world: the Bookie's world-moving odds">
      <header className="xc-sec-h">
        <div>
          <p className="fl-eyb">
            <span>The Bookie&apos;s board</span>
            <i aria-hidden="true" />
            geopolitics · politics · pop culture · no sports
          </p>
          <h2 className="fl-h2">What&apos;s moving the world</h2>
        </div>
        <p className="xc-state" data-state={m ? "ready" : status}>
          <i aria-hidden="true" />
          {m ? `${world.length} ${world.length === 1 ? "market" : "markets"} · live` : status === "failed" ? "Polymarket isn't answering" : status === "off" ? "Not connected here" : "Waiting on the feed"}
        </p>
      </header>

      {m ? (
        <div className="xc-world-grid">
          <article className="fl-panel xc-focus" key={m.id}>
            <p className="fl-k">
              <span>{KIND_LABEL[m.kind]}</span> · {asideBadge(m, world)}
            </p>
            {m.url ? (
              <a className="xc-focus-q" href={m.url} target="_blank" rel="noopener noreferrer nofollow">
                {m.question}
              </a>
            ) : (
              <span className="xc-focus-q">{m.question}</span>
            )}
            <div className="xc-focus-fig">
              <p>
                <b className="fl-num">{pct(m.prob)}</b>
                <small>{m.outcome.toLowerCase() === "yes" ? "chance of yes" : `chance · ${m.outcome}`}</small>
              </p>
              <p className={`is-${moveTone(m.change24h)}`}>
                <b className="fl-num">{arrow(m.change24h)}</b>
                <small>points in a day</small>
              </p>
            </div>
            <blockquote className="xc-line">
              <p>{asideLine(m)}</p>
              <cite>the Bookie</cite>
            </blockquote>
            <div className="xc-focus-day">
              <DayArea ps={m.spark} tone={moveTone(m.change24h)} />
              <p className="xc-axis" aria-hidden="true">
                <span>a day ago</span>
                <span>now</span>
              </p>
            </div>
          </article>
          <ol className="xc-movers" aria-label="World markets by the day's move">
            {world.map((w, k) => {
              const t = moveTone(w.change24h);
              return (
                <li key={w.id}>
                  <button type="button" className="xc-mover" aria-current={k === i ? "true" : undefined} onClick={() => setAt(k)} title={w.question}>
                    <span className="xc-mover-q">
                      <span className="fl-k">{KIND_LABEL[w.kind]}</span>
                      <span className="xc-mover-name">{shortName(w.question)}</span>
                    </span>
                    <b className="fl-num">{pct(w.prob)}</b>
                    <span className={`xc-mk-d is-${t}`}>{arrow(w.change24h)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <p className="xc-empty fl-wait">{status === "idle" ? "The Bookie is reading the world's odds…" : "Waiting on the world's odds. No feed, no asides: the Bookie won't make one up."}</p>
      )}
      <p className="xc-foot">Points moved in the last 24 hours. Odds are the market&apos;s price, not advice.</p>
    </section>
  );
}
