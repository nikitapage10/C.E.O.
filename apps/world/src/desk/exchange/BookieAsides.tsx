import { useEffect, useMemo, useState } from "react";
import { asideBadge, asideLine, byMove, KIND_LABEL, movePts, moved, shortName } from "./asides.ts";
import { move, moveTone, pct, startPolymarket, usePolymarket, type PmWorld } from "./polymarket.ts";
import { DayArea, Dial, MoveBar, useReducedMotion } from "./viz.tsx";
import "./exchange.css";

/**
 * What's moving the world (#345, made the Exchange's centrepiece in #367): the Bookie's world-moving odds
 * (geopolitics, politics, pop culture; never sports). One market takes the stage: its odds as a dial with a tick where
 * they stood a day ago, the day's price drawn in, and one line in his voice on why it matters. Beside it, the movers:
 * every world market as a diverging bar of the day's move, biggest first; tap one to put it on the stage. The stage
 * turns over on its own (a thin bar runs down the time); hovering, focusing or Pause holds it, and with reduced motion
 * it only changes when asked. Real data only: until Polymarket answers, it says it's waiting. Public odds only.
 */

/** How long each market holds the stage. */
const DWELL_S = 10;

/** The Bookie as a glyph: his Admiral's can, a bead of sweat that drops when the odds jump. */
function BookieMark({ sweating }: { sweating: boolean }) {
  return (
    <svg className={`xc-bk${sweating ? " is-sweating" : ""}`} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="6" width="14" height="21" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 11h14M9 22h14" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <circle cx="13.5" cy="16" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="16" r="1.1" fill="currentColor" />
      <path className="xc-bk-drop" d="M25.5 7.5c1 1.5 1.6 2.4 1.6 3.2a1.6 1.6 0 0 1-3.2 0c0-.8.6-1.7 1.6-3.2z" fill="currentColor" />
    </svg>
  );
}

function Stage({ m, world, paused, auto, onDone }: { m: PmWorld; world: readonly PmWorld[]; paused: boolean; auto: boolean; onDone: () => void }) {
  const tone = moveTone(m.change24h);
  const yes = m.outcome.toLowerCase() === "yes";
  const pts = movePts(m);
  const was = m.change24h === null ? null : Math.min(1, Math.max(0, m.prob - m.change24h));
  return (
    <article className={`xc-stage is-${m.kind}`}>
      <div className="xc-stage-dial">
        <div className="xc-dial-box">
          <Dial prob={m.prob} was={was} tone={tone} />
          <div className="xc-stage-n">
            <b>{pct(m.prob)}</b>
            <span>{yes ? "chance, yes" : m.outcome}</span>
          </div>
        </div>
        {was !== null && (
          <p className="xc-dial-key">
            <i aria-hidden="true" /> where it stood a day ago
          </p>
        )}
      </div>
      <div className="xc-stage-body">
        <p className="xc-tag">
          <span className={`xc-kind is-${m.kind}`}>{KIND_LABEL[m.kind]}</span>
          <span className="xc-badge">{asideBadge(m, world)}</span>
          <span className={`xc-stage-move is-${tone}`} aria-label={pts === null ? "No 24-hour move" : `${move(m.change24h)} points in 24 hours`}>
            {tone === "up" ? "▲" : tone === "down" ? "▼" : "·"} {move(m.change24h).replace(/^[+−]/, "")} pts today
          </span>
        </p>
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
  const sweating = !!m && moved(m) && (movePts(m) ?? 0) >= 5;
  const maxMove = world.reduce((x, w) => Math.max(x, Math.abs(w.change24h ?? 0)), 0);
  const auto = !reduced && world.length > 1;

  return (
    <section className="xc-world" aria-label="What's moving the world: the Bookie's world-moving odds">
      <header className="xc-world-head">
        <BookieMark sweating={sweating} />
        <div>
          <p className="xc-eyb">The Bookie's asides · geopolitics, politics, pop culture · no sports</p>
          <h2 className="xc-world-h">What's moving the world</h2>
        </div>
        <p className="xc-state" data-state={m ? "ready" : status}>
          <i aria-hidden="true" />
          {m ? `${world.length} ${world.length === 1 ? "market" : "markets"} · live` : status === "failed" ? "Polymarket isn't answering" : status === "off" ? "Not connected here" : "Waiting on the feed"}
        </p>
      </header>

      {m ? (
        <div className="xc-world-grid" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <Stage key={`${m.id}:${turn}`} m={m} world={world} paused={held || hover} auto={auto} onDone={() => go(i + 1)} />
          <div className="xc-movers">
            <p className="xc-eyb xc-movers-h">
              <span>The movers · today</span>
              {auto && (
                <button type="button" className="xc-hold" aria-pressed={held} onClick={() => setHeld((h) => !h)}>
                  {held ? "Play" : "Pause"}
                </button>
              )}
            </p>
            <ol aria-label="World markets by the day's move">
              {world.map((w, k) => {
                const t = moveTone(w.change24h);
                return (
                  <li key={w.id}>
                    <button type="button" className="xc-mover" aria-current={k === i ? "true" : undefined} onClick={() => go(k)} title={w.question}>
                      <span className="xc-mover-q">
                        <span className={`xc-kind is-${w.kind}`}>{KIND_LABEL[w.kind]}</span>
                        <span className="xc-mover-name">{shortName(w.question)}</span>
                      </span>
                      <b className="xc-mover-p">{pct(w.prob)}</b>
                      <MoveBar c={w.change24h} max={maxMove} />
                      <span className={`xc-mover-d is-${t}`}>
                        {t === "up" ? "▲" : t === "down" ? "▼" : ""}
                        {move(w.change24h).replace(/^[+−]/, "")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="xc-foot">Points moved in the last 24 hours. Odds are the market's price, not advice.</p>
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
