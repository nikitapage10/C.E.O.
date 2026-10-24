import { useEffect, useId, useState } from "react";
import { money, move, moveTone, pct, PIN_ERROR, PM_WATCH_MAX, sparkPath, startPolymarket, usePolymarket, type PmMarket } from "./polymarket.ts";
import "./polymarket.css";

/**
 * Polymarket's odds on the Exchange (#240): the busiest open markets by 24-hour volume, sports left out (#358), each with its probability as a
 * big mint numeral and a bar, the day's move and volume and a day's sparkline, and a small watchlist pinned with the
 * Desk passkey. Read-only public data: nothing here trades, and every word in it came from Polymarket, so it is drawn
 * as text only. Self-contained (its own CSS, its own polling), in the Weave's dark trading-floor language.
 */

const SPARK_W = 72;
const SPARK_H = 22;

function Spark({ ps, tone }: { ps: number[]; tone: string }) {
  const d = sparkPath(ps, SPARK_W, SPARK_H);
  if (!d) return <span className="pm-spark pm-spark--none" aria-hidden="true" />;
  return (
    <svg className={`pm-spark is-${tone}`} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden="true" preserveAspectRatio="none">
      <path d={d} fill="none" strokeWidth="1.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Question({ m }: { m: PmMarket }) {
  return m.url ? (
    <a className="pm-q" href={m.url} target="_blank" rel="noopener noreferrer nofollow">
      {m.question}
    </a>
  ) : (
    <span className="pm-q">{m.question}</span>
  );
}

function Row({ m, pinned, onPin, busy }: { m: PmMarket; pinned: boolean; onPin: ((m: PmMarket) => void) | null; busy: boolean }) {
  const tone = moveTone(m.change24h);
  const yesNo = m.outcome.toLowerCase() === "yes";
  return (
    <li className={`pm-row${m.closed ? " is-closed" : ""}`}>
      <div className="pm-row-q">
        <Question m={m} />
        <span className="pm-row-sub">
          {!yesNo && <span className="pm-outcome">{m.outcome}</span>}
          {m.closed ? "Closed" : `${money(m.volume24h)} today`}
        </span>
      </div>
      <div className="pm-row-odds">
        <b>{pct(m.prob)}</b>
        <i className="pm-bar" role="img" aria-label={`${pct(m.prob)} ${yesNo ? "yes" : m.outcome}`}>
          <i style={{ width: `${Math.max(1, Math.round(m.prob * 100))}%` }} />
        </i>
      </div>
      <span className={`pm-move is-${tone}`} aria-label={m.change24h === null ? "No 24-hour move" : `${move(m.change24h)} points in 24 hours`}>
        {tone === "up" ? "▲" : tone === "down" ? "▼" : ""}
        {move(m.change24h)}
      </span>
      <Spark ps={m.spark} tone={tone} />
      {onPin && (
        <button type="button" className={`pm-pin${pinned ? " is-on" : ""}`} aria-pressed={pinned} disabled={busy} onClick={() => onPin(m)} title={pinned ? "Unpin from the watchlist" : "Pin to the watchlist"}>
          {pinned ? "Pinned" : "Pin"}
        </button>
      )}
    </li>
  );
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function PolymarketBoard({ limit = 10 }: { limit?: number }) {
  const status = usePolymarket((s) => s.status);
  const board = usePolymarket((s) => s.board);
  const busy = usePolymarket((s) => s.busy);
  const error = usePolymarket((s) => s.error);
  const pin = usePolymarket((s) => s.pin);
  const unpin = usePolymarket((s) => s.unpin);
  const [ref, setRef] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const inputId = useId();

  useEffect(() => {
    startPolymarket();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const pinned = new Set(board?.watchlist ?? []);
  const canPin = board?.canPin ?? false;
  const toggle = canPin ? (m: PmMarket) => void (pinned.has(m.id) ? unpin(m.id) : pin(m.id)) : null;
  const top = (board?.top ?? []).slice(0, limit);
  const lead = top[0] ?? null;

  return (
    <section className="pm" aria-label="Polymarket: live odds">
      <header className="pm-head">
        <div>
          <p className="pm-eyb">Polymarket · live odds · no sports</p>
          <h2 className="pm-h2">The busiest markets right now</h2>
        </div>
        <p className="pm-state" data-state={board?.stale ? "stale" : status}>
          <i aria-hidden="true" />
          {status === "ready" && board
            ? board.stale
              ? `Polymarket isn't answering. Last good read ${ago(board.at, now)}.`
              : `Read ${ago(board.at, now)} · every minute`
            : status === "failed"
              ? "Polymarket isn't answering. Trying again every minute."
              : status === "off"
                ? "Not connected here"
                : "Reading the odds…"}
        </p>
      </header>

      {lead && (
        <div className="pm-lead">
          <div className="pm-lead-odds">
            <b>{pct(lead.prob)}</b>
            <span>
              {lead.outcome.toLowerCase() === "yes" ? "chance, yes" : lead.outcome} · <em className={`is-${moveTone(lead.change24h)}`}>{move(lead.change24h)} pts</em> today
            </span>
          </div>
          <div className="pm-lead-q">
            <p className="pm-eyb">Most traded today · {money(lead.volume24h)}</p>
            <Question m={lead} />
            <i className="pm-bar pm-bar--lead" role="img" aria-label={`${pct(lead.prob)}`}>
              <i style={{ width: `${Math.max(1, Math.round(lead.prob * 100))}%` }} />
            </i>
          </div>
        </div>
      )}

      {top.length > 0 ? (
        <ol className="pm-list" aria-label="Top markets by 24-hour volume, no sports">
          {top.map((m) => (
            <Row key={m.id} m={m} pinned={pinned.has(m.id)} onPin={toggle} busy={busy !== null} />
          ))}
        </ol>
      ) : (
        <p className="pm-empty">{status === "idle" ? "Reading Polymarket…" : status === "ready" ? "No open markets came back." : "No odds to show yet."}</p>
      )}

      <div className="pm-watch">
        <div className="pm-watch-head">
          <p className="pm-eyb">Watchlist · {board ? `${board.watchlist.length} of ${PM_WATCH_MAX}` : "–"}</p>
          {canPin && (
            <form
              className="pm-add"
              onSubmit={(e) => {
                e.preventDefault();
                void pin(ref).then((ok) => ok && setRef(""));
              }}
            >
              <label htmlFor={inputId} className="pm-sr">
                A Polymarket link or market id
              </label>
              <input id={inputId} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Paste a Polymarket link" maxLength={300} autoComplete="off" spellCheck={false} />
              <button type="submit" disabled={!ref.trim() || busy !== null}>
                Pin
              </button>
            </form>
          )}
        </div>
        {error && (
          <p className="pm-err" role="status">
            {PIN_ERROR[error]}
          </p>
        )}
        {board && board.watch.length > 0 ? (
          <ol className="pm-list pm-list--watch" aria-label="Pinned markets">
            {board.watch.map((m) => (
              <Row key={m.id} m={m} pinned onPin={toggle} busy={busy !== null} />
            ))}
          </ol>
        ) : (
          <p className="pm-empty">{canPin ? "Nothing pinned. Pin a market above, or paste its link. Pinning asks for your passkey." : board ? "Pins need the private store, which isn't connected here." : "The watchlist loads with the odds."}</p>
        )}
      </div>

      <p className="pm-foot">Public market data from Polymarket, read-only: no wallet, no trading. Odds are the market's price, not advice.</p>
    </section>
  );
}
