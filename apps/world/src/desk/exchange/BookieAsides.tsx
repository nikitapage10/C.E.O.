import { useEffect, useMemo, useState } from "react";
import { asideBadge, asideLine, byMove, KIND_LABEL, shortName } from "./asides.ts";
import { Flap } from "./Flap.tsx";
import { Fronts } from "./Fronts.tsx";
import { move, moveTone, pct, startPolymarket, usePolymarket, type PmWorld } from "./polymarket.ts";
import { DayArea, useReducedMotion } from "./viz.tsx";
import "./exchange.css";

/**
 * What's moving the world (#345; weather and a split-flap board since #387): the Bookie's world-moving odds
 * (geopolitics, politics, pop culture; never sports). The band is a pressure chart: each market a system whose
 * strength is the day's move, isobars traced live and motes riding the wind round them (Fronts). One market holds the
 * stage: its odds and the day's move on big split-flap readouts, the question, one line in the Bookie's voice and the
 * day's price drawn in. Beside it, the board: every world market, biggest move first, odds and move on flaps that
 * turn over when a figure changes; tap a row to put it on the stage. The stage turns over on its own (a thin bar runs
 * down the time); hovering, focusing or Pause holds it, and with reduced motion it only changes when asked. Real data
 * only: until Polymarket answers, it says it's waiting. Public odds only.
 */

/** How long each market holds the stage. */
const DWELL_S = 10;

/** The day's move for a flap: "▲2.0", "▼40.5", "0.0" when it held, a dash when Polymarket didn't say. */
export function moveFlap(c: number | null): string {
  const t = moveTone(c);
  if (t === "flat") return c === null ? "–" : "0.0";
  return `${t === "up" ? "▲" : "▼"}${move(c).replace(/^[+−]/, "")}`;
}

function Stage({ m, world, paused, auto, onDone }: { m: PmWorld; world: readonly PmWorld[]; paused: boolean; auto: boolean; onDone: () => void }) {
  const tone = moveTone(m.change24h);
  const yes = m.outcome.toLowerCase() === "yes";
  const was = m.change24h === null ? null : Math.min(1, Math.max(0, m.prob - m.change24h));
  return (
    <article className="xc-stage">
      <div className="xc-stage-read">
        <p className="xc-tag">
          <span className="xc-kind">{KIND_LABEL[m.kind]}</span>
          <span className="xc-badge">{asideBadge(m, world)}</span>
        </p>
        <div className="xc-stage-odds">
          <Flap text={pct(m.prob)} cells={4} className="is-xl" />
          <span className="xc-k">{yes ? "chance of yes" : `chance · ${m.outcome}`}</span>
        </div>
        <div className={`xc-stage-move is-${tone}`}>
          <Flap text={moveFlap(m.change24h)} cells={5} className="is-md" />
          <span className="xc-k">
            points in a day{was !== null && <> · was {pct(was)}</>}
          </span>
        </div>
      </div>
      <div className="xc-stage-body">
        {m.url ? (
          <a className="xc-stage-q" href={m.url} target="_blank" rel="noopener noreferrer nofollow">
            {m.question}
          </a>
        ) : (
          <span className="xc-stage-q">{m.question}</span>
        )}
        <blockquote className="xc-line">
          <p>{asideLine(m)}</p>
          <cite>the Bookie</cite>
        </blockquote>
        <div className="xc-stage-day">
          <DayArea ps={m.spark} tone={tone} />
          <p className="xc-axis" aria-hidden="true">
            <span>a day ago</span>
            <span>now</span>
          </p>
        </div>
      </div>
      {auto && <i className="xc-timer" style={{ animationDuration: `${DWELL_S}s`, animationPlayState: paused ? "paused" : "running" }} onAnimationEnd={onDone} aria-hidden="true" />}
    </article>
  );
}

export function BookieAsides() {
  const status = usePolymarket((s) => s.status);
  const raw = usePolymarket((s) => s.board?.world);
  const world = useMemo(() => byMove(raw ?? []), [raw]);
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const [turn, setTurn] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => startPolymarket(), []);

  const i = world.length ? at % world.length : 0;
  const m = world[i] ?? null;
  const go = (n: number) => {
    setAt(n);
    setTurn((t) => t + 1);
  };
  const auto = !reduced && world.length > 1;

  return (
    <section className="xc-world" aria-label="What's moving the world: the Bookie's world-moving odds">
      {m && <Fronts items={world} at={i} />}
      <header className="xc-world-head">
        <div>
          <p className="xc-k">The Bookie&apos;s board · geopolitics, politics, pop culture · no sports</p>
          <h2 className="xc-world-h">What&apos;s moving the world</h2>
        </div>
        <p className="xc-state" data-state={m ? "ready" : status}>
          <i aria-hidden="true" />
          {m ? `${world.length} ${world.length === 1 ? "market" : "markets"} · live` : status === "failed" ? "Polymarket isn't answering" : status === "off" ? "Not connected here" : "Waiting on the feed"}
        </p>
      </header>

      {m ? (
        <div className="xc-world-grid" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <Stage key={`${m.id}:${turn}`} m={m} world={world} paused={held || hover} auto={auto} onDone={() => go(i + 1)} />
          <div className="xc-board">
            <p className="xc-board-h">
              <span className="xc-k">The movers · last 24 hours</span>
              {auto && (
                <button type="button" className="xc-hold" aria-pressed={held} onClick={() => setHeld((h) => !h)}>
                  {held ? "Play" : "Pause"}
                </button>
              )}
            </p>
            <p className="xc-board-cols" aria-hidden="true">
              <span>Market</span>
              <span>Odds</span>
              <span>24 h</span>
            </p>
            <ol aria-label="World markets by the day's move">
              {world.map((w, k) => {
                const t = moveTone(w.change24h);
                return (
                  <li key={w.id}>
                    <button type="button" className="xc-row" aria-current={k === i ? "true" : undefined} onClick={() => go(k)} title={w.question}>
                      <span className="xc-row-q">
                        <span className="xc-row-kind">{KIND_LABEL[w.kind]}</span>
                        <span className="xc-row-name">{shortName(w.question)}</span>
                      </span>
                      <Flap text={pct(w.prob)} cells={4} className="xc-row-p" />
                      <Flap text={moveFlap(w.change24h)} cells={5} className={`xc-row-d is-${t}`} />
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="xc-foot">Points moved in the last 24 hours. Odds are the market&apos;s price, not advice.</p>
          </div>
        </div>
      ) : (
        <p className="xc-wait">
          <span className="xc-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {status === "idle" ? "The Bookie is reading the world's odds…" : "Waiting on the world's odds. No feed, no asides: the Bookie won't make one up."}
        </p>
      )}
    </section>
  );
}
