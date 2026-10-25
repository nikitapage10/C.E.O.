import { useId, useState } from "react";
import { money, move, moveTone, pct, PIN_ERROR, PM_WATCH_MAX, usePolymarket, type PmMarket } from "./polymarket.ts";
import { Spark } from "./viz.tsx";

/**
 * Polymarket's markets on the Exchange (#240; on the flow kit since #430): one market as a row on the floor, plain
 * figures first (the question, the chance of yes, the day's move, a thin odds bar with a tick where it stood a day
 * ago), its detail on a tap (the day's chart, volumes, close date, the link and its pin); and the watchlist. Read-only
 * public data: nothing here trades, and every word in it came from Polymarket, so it is drawn as text only.
 */

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

const closes = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No date given");

export interface RowProps {
  m: PmMarket;
  open: boolean;
  hot?: boolean;
  onToggle: () => void;
  pinned: boolean;
  onPin: ((m: PmMarket) => void) | null;
  busy: boolean;
  onHot?: (id: string | null) => void;
}

export function MarketRow({ m, open, hot = false, onToggle, pinned, onPin, busy, onHot }: RowProps) {
  const tone = moveTone(m.change24h);
  const yes = m.outcome.toLowerCase() === "yes";
  const was = m.change24h === null ? null : Math.min(1, Math.max(0, m.prob - m.change24h));
  return (
    <li className={`xc-mk${m.closed ? " is-closed" : ""}${open ? " is-open" : ""}${hot ? " is-hot" : ""}`} data-xc-line={m.id} onMouseEnter={() => onHot?.(m.id)} onMouseLeave={() => onHot?.(null)}>
      <button type="button" className="xc-mk-line" aria-expanded={open} onClick={onToggle} onFocus={() => onHot?.(m.id)} onBlur={() => onHot?.(null)}>
        <span className="xc-mk-q">
          <span className="xc-mk-name">{m.question}</span>
          <span className="xc-mk-odds" aria-hidden="true">
            <i className="xc-mk-fill" style={{ width: `${(m.prob * 100).toFixed(1)}%` }} />
            {was !== null && <i className="xc-mk-was" style={{ left: `${(was * 100).toFixed(1)}%` }} />}
          </span>
        </span>
        <span className="xc-mk-p">
          <b className="fl-num">{pct(m.prob)}</b>
          <small>{yes ? "yes" : m.outcome}</small>
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
              <dd className="fl-num">{m.closed ? "Closed" : money(m.volume24h)}</dd>
            </div>
            <div>
              <dt>Traded ever</dt>
              <dd className="fl-num">{money(m.volume)}</dd>
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
              <button type="button" className={`fl-btn xc-pin${pinned ? " is-pri" : ""}`} aria-pressed={pinned} disabled={busy} onClick={() => onPin(m)}>
                {pinned ? "Pinned · unpin" : "Pin to the watchlist"}
              </button>
            )}
          </p>
        </div>
      )}
    </li>
  );
}

/** The pin toggle for a row, or null where pins can't be saved. */
export function usePinToggle() {
  const board = usePolymarket((s) => s.board);
  const pin = usePolymarket((s) => s.pin);
  const unpin = usePolymarket((s) => s.unpin);
  const pinned = new Set(board?.watchlist ?? []);
  const toggle = board?.canPin ? (m: PmMarket) => void (pinned.has(m.id) ? unpin(m.id) : pin(m.id)) : null;
  return { pinned, toggle };
}

/** The watchlist: pinned markets, and a field to pin one by its link, behind the passkey. */
export function Watchlist() {
  const board = usePolymarket((s) => s.board);
  const busy = usePolymarket((s) => s.busy);
  const error = usePolymarket((s) => s.error);
  const pin = usePolymarket((s) => s.pin);
  const { pinned, toggle } = usePinToggle();
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const inputId = useId();
  const canPin = board?.canPin ?? false;
  return (
    <details className="xc-fold">
      <summary>
        <span>Your watchlist</span>
        <b className="fl-num">{board ? `${board.watchlist.length} of ${PM_WATCH_MAX}` : "–"}</b>
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
          <button type="submit" className="fl-btn is-pri" disabled={!ref.trim() || busy !== null}>
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
            <MarketRow key={m.id} m={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} pinned={pinned.has(m.id)} onPin={toggle} busy={busy !== null} />
          ))}
        </ol>
      ) : (
        <p className="xc-empty">{canPin ? "Nothing pinned. Open a market on the floor and pin it, or paste its link. Pinning asks for your passkey." : board ? "Pins need the private store, which isn't connected here." : "The watchlist loads with the odds."}</p>
      )}
    </details>
  );
}
