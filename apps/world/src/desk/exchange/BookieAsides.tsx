import { useEffect, useState } from "react";
import { asideBadge, asideLine, KIND_LABEL, movePts, moved } from "./asides.ts";
import { move, moveTone, pct, sparkPath, startPolymarket, usePolymarket, type PmWorld } from "./polymarket.ts";
import "./asides.css";

/**
 * The Bookie's asides on the Exchange (#345): one world-moving market at a time (geopolitics, politics, pop culture;
 * never sports) pops up in a speech card with its live odds, the day's move, a day's sparkline and one line in his voice
 * on why it matters, linking to the market. A thin bar runs down the time to the next aside; hovering, focusing or the
 * pause button holds it, and with reduced motion it only changes when asked. Real data only: until Polymarket answers,
 * it says it's waiting. Public odds only: no money, no positions. Every word from Polymarket is drawn as text.
 */

/** How long each aside stays up. */
const DWELL_S = 9;

const SPARK_W = 96;
const SPARK_H = 26;

/** The Bookie as a glyph: his Admiral's can in mint, a bead of sweat that drops when the odds jump. */
function BookieMark({ sweating }: { sweating: boolean }) {
  return (
    <svg className={`ba-mark${sweating ? " is-sweating" : ""}`} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="6" width="14" height="21" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 11h14M9 22h14" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <circle cx="13.5" cy="16" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="16" r="1.1" fill="currentColor" />
      <path className="ba-drop" d="M25.5 7.5c1 1.5 1.6 2.4 1.6 3.2a1.6 1.6 0 0 1-3.2 0c0-.8.6-1.7 1.6-3.2z" fill="currentColor" />
    </svg>
  );
}

function Spark({ ps, tone }: { ps: number[]; tone: string }) {
  const d = sparkPath(ps, SPARK_W, SPARK_H);
  if (!d) return null;
  return (
    <svg className={`ba-spark is-${tone}`} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden="true" preserveAspectRatio="none">
      <path d={d} fill="none" strokeWidth="1.3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
    </svg>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function Aside({ m, world, paused, auto, onDone }: { m: PmWorld; world: readonly PmWorld[]; paused: boolean; auto: boolean; onDone: () => void }) {
  const tone = moveTone(m.change24h);
  const yes = m.outcome.toLowerCase() === "yes";
  const pts = movePts(m);
  return (
    <article className={`ba-card is-${m.kind}`}>
      <p className="ba-tag">
        <span className="ba-kind">{KIND_LABEL[m.kind]}</span>
        <span className="ba-badge">{asideBadge(m, world)}</span>
      </p>
      {m.url ? (
        <a className="ba-q" href={m.url} target="_blank" rel="noopener noreferrer nofollow">
          {m.question}
        </a>
      ) : (
        <span className="ba-q">{m.question}</span>
      )}
      <div className="ba-nums">
        <b className="ba-odds">{pct(m.prob)}</b>
        <span className="ba-on">{yes ? "chance, yes" : m.outcome}</span>
        <span className={`ba-move is-${tone}`} aria-label={pts === null ? "No 24-hour move" : `${move(m.change24h)} points in 24 hours`}>
          {tone === "up" ? "▲" : tone === "down" ? "▼" : "·"} {move(m.change24h).replace(/^[+−]/, "")} pts today
        </span>
        <Spark ps={m.spark} tone={tone} />
      </div>
      <blockquote className="ba-line">
        <p>{asideLine(m)}</p>
        <cite>the Bookie</cite>
      </blockquote>
      {auto && <i className="ba-timer" style={{ animationDuration: `${DWELL_S}s`, animationPlayState: paused ? "paused" : "running" }} onAnimationEnd={onDone} aria-hidden="true" />}
    </article>
  );
}

export function BookieAsides() {
  const status = usePolymarket((s) => s.status);
  const world = usePolymarket((s) => s.board?.world) ?? [];
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

  return (
    <section className="ba" aria-label="The Bookie's asides: world-moving odds">
      <header className="ba-head">
        <BookieMark sweating={sweating} />
        <div>
          <p className="ba-eyb">The Bookie's asides · world-moving odds</p>
          <h2 className="ba-h2">What's moving the world</h2>
        </div>
        <p className="ba-state" data-on={m ? "live" : status}>
          <i aria-hidden="true" />
          {m ? "Geopolitics, politics, pop culture · no sports" : status === "failed" ? "Polymarket isn't answering" : status === "off" ? "Not connected here" : "Waiting on the feed"}
        </p>
      </header>

      {m ? (
        <div className="ba-stage" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <Aside key={`${m.id}:${turn}`} m={m} world={world} paused={held || hover} auto={!reduced && world.length > 1} onDone={() => go(i + 1)} />
          <div className="ba-nav">
            <ol className="ba-chips" aria-label="Asides">
              {world.map((w, k) => (
                <li key={w.id}>
                  <button type="button" className={`ba-chip is-${w.kind}`} aria-current={k === i ? "true" : undefined} onClick={() => go(k)} title={w.question}>
                    <span className="ba-chip-k">{KIND_LABEL[w.kind]}</span>
                    <b>{pct(w.prob)}</b>
                    <span className={`is-${moveTone(w.change24h)}`}>{move(w.change24h)}</span>
                  </button>
                </li>
              ))}
            </ol>
            {!reduced && world.length > 1 && (
              <button type="button" className="ba-hold" aria-pressed={held} onClick={() => setHeld((h) => !h)}>
                {held ? "Play" : "Pause"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="ba-wait">
          <span className="ba-dots" aria-hidden="true">
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
