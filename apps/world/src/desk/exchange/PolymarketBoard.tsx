import { useEffect, useId, useState } from "react";
import { money, move, moveTone, pct, PIN_ERROR, PM_WATCH_MAX, startPolymarket, usePolymarket, type PmMarket } from "./polymarket.ts";
import { Spark } from "./viz.tsx";
import "./exchange.css";

/**
 * Polymarket's busiest markets on the Exchange (#240, redrawn #367): the open markets by 24-hour volume, sports left
 * out (#358). Simple first: the top few as odds bars, each with a tick where it stood a day ago and a thin line for its
 * share of the day's money; tap one for its detail (the day's chart, volumes, close date, the link and its pin). The
 * rest of the ten and the watchlist sit behind their own disclosures. Read-only public data: nothing here trades, and
 * every word in it came from Polymarket, so it is drawn as text only.
 */

/** Markets shown before "Show all". */
const FIRST = 5;

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

const closes = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No date given");

function Row({ m, rank, maxVol, open, onToggle, pinned, onPin, busy }: { m: PmMarket; rank: number | null; maxVol: number; open: boolean; onToggle: () => void; pinned: boolean; onPin: ((m: PmMarket) => void) | null; busy: boolean }) {
  const tone = moveTone(m.change24h);
  const yesNo = m.outcome.toLowerCase() === "yes";
  const was = m.change24h === null ? null : Math.min(1, Math.max(0, m.prob - m.change24h));
  const vol = maxVol > 0 ? Math.min(1, m.volume24h / maxVol) : 0;
  return (
    <li className={`xc-mk${m.closed ? " is-closed" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="xc-mk-line" aria-expanded={open} onClick={onToggle}>
        {rank !== null && <span className="xc-mk-rank">{String(rank).padStart(2, "0")}</span>}
        <span className="xc-mk-q">
          <span className="xc-mk-name">{m.question}</span>
          <span className="xc-mk-odds" aria-hidden="true">
            <i className="xc-mk-fill" style={{ flexGrow: m.prob }} />
            <i style={{ flexGrow: 1 - m.prob }} />
            {was !== null && <i className="xc-mk-was" style={{ left: `${(was * 100).toFixed(1)}%` }} />}
          </span>
          <span className="xc-mk-vol" aria-hidden="true">
            <i style={{ flexGrow: vol }} />
            <i style={{ flexGrow: 1 - vol }} />
          </span>
        </span>
        <span className="xc-mk-p">
          <b>{pct(m.prob)}</b>
          <small>{yesNo ? "yes" : m.outcome}</small>
        </span>
        <span className={`xc-mk-d is-${tone}`} aria-label={m.change24h === null ? "No 24-hour move" : `${move(m.change24h)} points in 24 hours`}>
          {tone === "up" ? "▲" : tone === "down" ? "▼" : ""}
          {move(m.change24h).replace(/^[+−]/, "")}
        </span>
        <span className="xc-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="xc-mk-more">
          <Spark ps={m.spark} tone={tone} w={240} h={48} />
          <dl>
            <div>
              <dt>Traded today</dt>
              <dd>{m.closed ? "Closed" : money(m.volume24h)}</dd>
            </div>
            <div>
              <dt>Traded ever</dt>
              <dd>{money(m.volume)}</dd>
            </div>
            <div>
              <dt>Closes</dt>
              <dd>{closes(m.endDate)}</dd>
            </div>
          </dl>
          <p className="xc-mk-acts">
            {m.url && (
              <a className="xc-link" href={m.url} target="_blank" rel="noopener noreferrer nofollow">
                Open on Polymarket ↗
              </a>
            )}
            {onPin && (
              <button type="button" className={`xc-pin${pinned ? " is-on" : ""}`} aria-pressed={pinned} disabled={busy} onClick={() => onPin(m)}>
                {pinned ? "Pinned · unpin" : "Pin to the watchlist"}
              </button>
            )}
          </p>
        </div>
      )}
    </li>
  );
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
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
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
  const shown = all ? top : top.slice(0, FIRST);
  const maxVol = top.reduce((x, m) => Math.max(x, m.volume24h), 0);
  const dayMoney = top.reduce((x, m) => x + m.volume24h, 0);
  const flip = (k: string) => setOpen(open === k ? null : k);

  return (
    <section className="xc-busy" aria-label="Polymarket: the busiest markets">
      <header className="xc-head">
        <div>
          <p className="xc-eyb">Polymarket · live odds · no sports</p>
          <h2 className="xc-h2">Where the money is today</h2>
        </div>
        <p className="xc-state" data-state={board?.stale ? "stale" : status}>
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

      {top.length > 0 ? (
        <>
          <p className="xc-busy-sum">
            <b>{money(dayMoney)}</b> traded today across the {top.length} busiest. The bar is the chance of yes; the tick is where it stood a day ago; the thin line is each market's share of the day's money.
          </p>
          <ol className="xc-mks" aria-label="Top markets by 24-hour volume, no sports">
            {shown.map((m, k) => (
              <Row key={m.id} m={m} rank={k + 1} maxVol={maxVol} open={open === `t${m.id}`} onToggle={() => flip(`t${m.id}`)} pinned={pinned.has(m.id)} onPin={toggle} busy={busy !== null} />
            ))}
          </ol>
          {top.length > FIRST && (
            <button type="button" className="xc-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? "Show the top few" : `Show all ${top.length}`}
            </button>
          )}
        </>
      ) : (
        <p className="xc-empty">{status === "idle" ? "Reading Polymarket…" : status === "ready" ? "No open markets came back." : "No odds to show yet. Waiting on Polymarket."}</p>
      )}

      <details className="xc-fold">
        <summary>
          <span>Your watchlist</span>
          <b>{board ? `${board.watchlist.length} of ${PM_WATCH_MAX}` : "–"}</b>
        </summary>
        {canPin && (
          <form
            className="xc-add"
            onSubmit={(e) => {
              e.preventDefault();
              void pin(ref).then((ok) => ok && setRef(""));
            }}
          >
            <label htmlFor={inputId} className="wv-sr">
              A Polymarket link or market id
            </label>
            <input id={inputId} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Paste a Polymarket link" maxLength={300} autoComplete="off" spellCheck={false} />
            <button type="submit" disabled={!ref.trim() || busy !== null}>
              Pin
            </button>
          </form>
        )}
        {error && (
          <p className="xc-err" role="status">
            {PIN_ERROR[error]}
          </p>
        )}
        {board && board.watch.length > 0 ? (
          <ol className="xc-mks" aria-label="Pinned markets">
            {board.watch.map((m) => (
              <Row key={m.id} m={m} rank={null} maxVol={maxVol} open={open === `w${m.id}`} onToggle={() => flip(`w${m.id}`)} pinned onPin={toggle} busy={busy !== null} />
            ))}
          </ol>
        ) : (
          <p className="xc-empty">{canPin ? "Nothing pinned. Open a market above and pin it, or paste its link. Pinning asks for your passkey." : board ? "Pins need the private store, which isn't connected here." : "The watchlist loads with the odds."}</p>
        )}
      </details>

      <p className="xc-foot">Public market data from Polymarket, read-only: no wallet, no trading. Odds are the market's price, not advice.</p>
    </section>
  );
}
