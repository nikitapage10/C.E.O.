import { useEffect, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { cents, contracts, pnlTone, signedPct, signedUsd, startPositions, usd, usePositions, type PmPosition, type PmPositions, type PmTrade, type PosStatus } from "./positions.ts";
import "./exchange.css";

/**
 * Nikita's own Polymarket US positions, leading the Exchange (#253, redrawn #367): what the book is worth now and the
 * P&L as one big figure, where the money sits as a strip of positions, then each position, simple first and opened
 * for its detail on a tap, and the recent fills behind their own disclosure. Read-only. The server answers only a
 * signed-in Desk; every dollar figure, size and P&L is wrapped in <Private> so Hide mode (#251) veils it, and the
 * strip and bars carry shares only, never a figure. Signed out, the board says where the book is (behind the passkey)
 * and nothing else. Every word in it came from Polymarket, so it is drawn as text only.
 */

/** Positions listed before "Show all". */
const FIRST = 5;

type Live = Extract<PmPositions, { state: "live" }>;

function Market({ name, url, className = "xc-q" }: { name: string; url: string | null; className?: string }) {
  return url ? (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer nofollow">
      {name}
    </a>
  ) : (
    <span className={className}>{name}</span>
  );
}

const STATE_WORD: Record<PosStatus, string> = {
  live: "Read-only · every two minutes",
  waiting: "Waiting for the key",
  "signed-out": "Behind your passkey",
  failed: "Polymarket US isn't answering",
  off: "Not connected here",
  idle: "Reading…",
};

/** Where the book sits: one segment per position, its width the position's share of the book's value. */
function Strip({ ps }: { ps: PmPosition[] }) {
  const total = ps.reduce((s, p) => s + Math.abs(p.value), 0);
  if (total <= 0) return null;
  return (
    <div className="xc-strip" aria-hidden="true">
      {ps.map((p, i) => (
        <i key={`${p.market}-${i}`} className={`is-${pnlTone(p.pnl)}`} style={{ flexGrow: Math.abs(p.value) / total, animationDelay: `${i * 70}ms` }} title={p.market} />
      ))}
    </div>
  );
}

function Row({ p, maxPnl, open, onToggle }: { p: PmPosition; maxPnl: number; open: boolean; onToggle: () => void }) {
  const tone = pnlTone(p.pnl);
  const share = maxPnl > 0 ? Math.min(1, Math.abs(p.pnl) / maxPnl) : 0;
  return (
    <li className={`xc-pos${p.expired ? " is-closed" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="xc-pos-line" aria-expanded={open} onClick={onToggle}>
        <span className={`xc-pos-dot is-${tone}`} aria-hidden="true" />
        <span className="xc-pos-q">
          <span className="xc-pos-name">{p.market}</span>
          <span className="xc-pos-side">
            {p.short ? `Short ${p.outcome}` : p.outcome}
            {p.expired && " · expired"}
          </span>
        </span>
        <span className="xc-pos-pl" aria-hidden="true">
          <i className={`is-${tone}`} style={{ flexGrow: share }} />
          <i style={{ flexGrow: 1 - share }} />
        </span>
        <span className="xc-pos-val">
          <Private label="value hidden">{usd(p.value)}</Private>
        </span>
        <span className={`xc-pos-pnl is-${tone}`}>
          <Private label="profit or loss hidden">{signedUsd(p.pnl)}</Private>
        </span>
        <span className="xc-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="xc-pos-more">
          <dl>
            <div>
              <dt>Contracts</dt>
              <dd>
                <Private>{contracts(p.contracts)}</Private>
              </dd>
            </div>
            <div>
              <dt>Average price</dt>
              <dd>
                <Private>{cents(p.avgPrice)}</Private>
              </dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>
                <Private>{usd(p.cost)}</Private>
              </dd>
            </div>
            <div>
              <dt>Return</dt>
              <dd className={`is-${tone}`}>
                <Private>{signedPct(p.pnlPct)}</Private>
              </dd>
            </div>
            <div>
              <dt>Taken already</dt>
              <dd>
                <Private>{signedUsd(p.realized)}</Private>
              </dd>
            </div>
          </dl>
          {p.url && <Market name="Open on Polymarket US ↗" url={p.url} className="xc-link" />}
        </div>
      )}
    </li>
  );
}

const KIND: Record<PmTrade["kind"], string> = { trade: "Filled", settled: "Settled", voided: "Voided" };

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Fills({ ts }: { ts: PmTrade[] }) {
  return (
    <details className="xc-fold">
      <summary>
        <span>Recent fills</span>
        <b>{ts.length}</b>
      </summary>
      <ol className="xc-fills" aria-label="Recent fills and settlements">
        {ts.map((t, i) => (
          <li key={`${t.at}-${i}`} className={`is-${t.kind}`}>
            <span className="xc-fill-when">{when(t.at)}</span>
            <span className="xc-fill-kind">{KIND[t.kind]}</span>
            <Market name={t.market} url={t.url} />
            <span className="xc-fill-px">{t.kind === "settled" ? "" : <Private>{`${contracts(t.contracts)} @ ${cents(t.price)}`}</Private>}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Book({ data }: { data: Live }) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const { totals, positions } = data;
  const tone = pnlTone(totals.pnl);
  const pct = totals.cost > 0 ? (totals.pnl / Math.abs(totals.cost)) * 100 : null;
  const maxPnl = positions.reduce((m, p) => Math.max(m, Math.abs(p.pnl)), 0);
  const shown = all ? positions : positions.slice(0, FIRST);
  const up = positions.filter((p) => pnlTone(p.pnl) === "up").length;
  const down = positions.filter((p) => pnlTone(p.pnl) === "down").length;
  return (
    <>
      <div className="xc-book-top">
        <div className="xc-worth">
          <p className="xc-eyb">Worth now</p>
          <Private as="b" className="xc-worth-n">
            {usd(totals.value)}
          </Private>
          <p className={`xc-worth-pl is-${tone}`}>
            <span aria-hidden="true">{tone === "up" ? "▲" : tone === "down" ? "▼" : "·"}</span>
            <Private>{signedUsd(totals.pnl)}</Private>
            <Private>{signedPct(pct)}</Private>
            <span className="xc-worth-on">unrealised, on a cost of</span>
            <Private>{usd(totals.cost)}</Private>
          </p>
        </div>
        <div className="xc-sits">
          <p className="xc-eyb">
            Where the book sits · <b>{totals.open}</b> open · <span className="is-up">{up} up</span> · <span className="is-down">{down} down</span>
          </p>
          <Strip ps={positions} />
        </div>
      </div>

      {positions.length > 0 ? (
        <ol className="xc-poss" aria-label="Positions, largest first">
          {shown.map((p, i) => (
            <Row key={`${p.market}-${i}`} p={p} maxPnl={maxPnl} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </ol>
      ) : (
        <p className="xc-empty">No open positions. The Bookie finds this restful.</p>
      )}
      {positions.length > FIRST && (
        <button type="button" className="xc-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show the largest few" : `Show all ${positions.length}`}
        </button>
      )}
      {data.more && <p className="xc-foot">Showing the largest {positions.length}; the totals cover those.</p>}
      {data.activity.length > 0 && <Fills ts={data.activity} />}
    </>
  );
}

/** The vault the book sits in while it can't be shown: a lock, and the state in words. */
function Vault({ status, reason, onSignIn }: { status: PosStatus; reason: "no-key" | "bad-key" | null; onSignIn: () => void }) {
  return (
    <div className="xc-vault" data-state={status}>
      <svg className="xc-vault-lock" viewBox="0 0 64 64" aria-hidden="true">
        <circle className="xc-vault-ring" cx="32" cy="32" r="30" />
        <circle className="xc-vault-ring is-2" cx="32" cy="32" r="22" />
        <rect x="22" y="29" width="20" height="15" rx="2.5" />
        <path d="M26 29v-4a6 6 0 0 1 12 0v4" />
      </svg>
      <div>
        {status === "waiting" ? (
          <p>
            {reason === "bad-key"
              ? "The Polymarket US key is set but can't be read. Check POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY in the Function App."
              : "Waiting for your Polymarket US key. Once it's in the Function App's settings, your positions show here, read-only."}
          </p>
        ) : status === "signed-out" ? (
          <>
            <p className="xc-vault-h">Your book is behind the Desk's passkey.</p>
            <p>Sign in and it opens here: what it's worth, the P&amp;L, and every position.</p>
            <button type="button" className="xc-signin" onClick={onSignIn}>
              Sign in
            </button>
          </>
        ) : status === "off" ? (
          <p>Positions need the Desk's sign-in, which isn't connected here.</p>
        ) : status === "failed" ? (
          <p>Polymarket US didn't answer. Trying again in two minutes.</p>
        ) : (
          <p>Reading your positions…</p>
        )}
      </div>
    </div>
  );
}

export function PositionsBoard() {
  const status = usePositions((s) => s.status);
  const data = usePositions((s) => s.data);
  const reason = usePositions((s) => s.reason);
  const signIn = useDeskAuth((s) => s.signIn);

  useEffect(() => startPositions(), []);

  return <PositionsView status={status} data={data} reason={reason} onSignIn={() => void signIn()} />;
}

/** The board itself, from the store's state (kept apart so it can be rendered and checked on its own). */
export function PositionsView({ status, data, reason, onSignIn }: { status: PosStatus; data: Live | null; reason: "no-key" | "bad-key" | null; onSignIn: () => void }) {
  const live = status === "live" && data;
  return (
    <section className="xc-book" aria-label="Your Polymarket US positions">
      <header className="xc-head">
        <div>
          <p className="xc-eyb">Your book · Polymarket US · only you, signed in</p>
          <h2 className="xc-h2">Open positions</h2>
        </div>
        <p className="xc-state" data-state={live ? (data.stale ? "stale" : "ready") : status}>
          <i aria-hidden="true" />
          {live && data.stale ? "Polymarket US isn't answering. Last good read." : STATE_WORD[status]}
        </p>
      </header>

      {live ? <Book data={data} /> : <Vault status={status} reason={reason} onSignIn={onSignIn} />}

      <p className="xc-foot">Read-only: the Desk reads your Polymarket US positions and never places an order.</p>
    </section>
  );
}
