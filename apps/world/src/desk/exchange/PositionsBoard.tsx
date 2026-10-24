import { useEffect, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { cents, contracts, pnlTone, signedPct, signedUsd, startPositions, usd, usePositions, type PmPosition, type PmPositions, type PmTrade, type PosStatus } from "./positions.ts";
import { landforms, returnPct, waterline } from "./terrain.ts";
import { Terrain } from "./Terrain.tsx";
import "./exchange.css";

/**
 * Nikita's own Polymarket US positions, leading the Exchange (#253; the terrain is #387). The book reads first as
 * plain figures (what it's worth, the P&L, how many are above and under water), then as land: one cross-section where
 * each position is a landform, its footprint its share of the book and its summit its return against sea level, which
 * is what was paid. Under it, the ledger says every position plainly: side, size, entry, now, value, P&L; a row opens
 * for cost, return and what was taken already. Hovering a row lights its landform and the other way round.
 * Read-only. The server answers only a signed-in Desk; every dollar figure, size, price and P&L is wrapped in <Private>
 * so Hide mode (#251) veils it, and the land carries shapes only. Signed out, the sea is empty and the board says where
 * the book is and nothing else. Every word in it came from Polymarket, so it is drawn as text only.
 */

/** Positions listed before "Show all". */
const FIRST = 8;

type Live = Extract<PmPositions, { state: "live" }>;

const num = (i: number) => String(i + 1).padStart(2, "0");

/** The price a position marks at now, per contract: its value over its size. */
const nowPrice = (p: PmPosition): number | null => (p.contracts > 0 ? Math.max(0, Math.min(1, p.value / p.contracts)) : null);

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

const side = (p: PmPosition) => `${p.short ? "Short " : ""}${p.outcome}${p.expired ? " · expired" : ""}`;

/** The summit markers above the land: each position's number and P&L, on its sounding line. */
function Marks({ ps, hot, onHot }: { ps: PmPosition[]; hot: number | null; onHot: (i: number | null) => void }) {
  const fs = landforms(ps);
  let last = -1;
  return (
    <ol className="xc-marks" aria-label="Positions on the section, by number">
      {fs.map((f, i) => {
        // Markers too close to the one before stay off the section; the ledger still lists them.
        if (last >= 0 && f.cx - fs[last]!.cx < 0.06 && hot !== i) return null;
        last = i;
        const p = ps[i]!;
        const tone = pnlTone(p.pnl);
        return (
          <li key={`${p.market}-${i}`} className={`xc-mark is-${tone}${hot === i ? " is-hot" : ""}${f.rise < 0 ? " is-under" : ""}`} style={{ left: `${(f.cx * 100).toFixed(2)}%` }} onMouseEnter={() => onHot(i)} onMouseLeave={() => onHot(null)} title={p.market}>
            <b>{num(i)}</b>
            <span className={`is-${tone}`}>
              <Private label="profit or loss hidden">{signedUsd(p.pnl)}</Private>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ p, i, open, hot, onToggle, onHot }: { p: PmPosition; i: number; open: boolean; hot: boolean; onToggle: () => void; onHot: (i: number | null) => void }) {
  const tone = pnlTone(p.pnl);
  return (
    <li className={`xc-led-row${p.expired ? " is-closed" : ""}${open ? " is-open" : ""}${hot ? " is-hot" : ""}`} onMouseEnter={() => onHot(i)} onMouseLeave={() => onHot(null)}>
      <button type="button" className="xc-led-line" aria-expanded={open} onClick={onToggle} onFocus={() => onHot(i)} onBlur={() => onHot(null)}>
        <span className="xc-led-n">{num(i)}</span>
        <span className="xc-led-q">
          <span className="xc-led-name">{p.market}</span>
          <span className={`xc-led-side${p.short ? " is-short" : ""}`}>{side(p)}</span>
        </span>
        <span className="xc-led-f" data-k="Size">
          <Private>{contracts(p.contracts)}</Private>
        </span>
        <span className="xc-led-f" data-k="Entry">
          <Private>{cents(p.avgPrice)}</Private>
        </span>
        <span className="xc-led-f" data-k="Now">
          <Private>{cents(nowPrice(p))}</Private>
        </span>
        <span className="xc-led-f xc-led-val" data-k="Value">
          <Private label="value hidden">{usd(p.value)}</Private>
        </span>
        <span className={`xc-led-pnl is-${tone}`}>
          <Private as="b" label="profit or loss hidden">
            {signedUsd(p.pnl)}
          </Private>
          <Private>{signedPct(p.pnlPct ?? returnPct(p))}</Private>
        </span>
        <span className="xc-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="xc-led-more">
          <dl>
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
  const [hot, setHot] = useState<number | null>(null);
  const { totals, positions } = data;
  const tone = pnlTone(totals.pnl);
  const pct = totals.cost > 0 ? (totals.pnl / Math.abs(totals.cost)) * 100 : null;
  const shown = all ? positions : positions.slice(0, FIRST);
  const w = waterline(positions);
  return (
    <>
      <div className="xc-sum">
        <div className="xc-worth">
          <p className="xc-k">Worth now</p>
          <Private as="b" className="xc-worth-n">
            {usd(totals.value)}
          </Private>
        </div>
        <div className={`xc-worth-pl is-${tone}`}>
          <p className="xc-k">Profit or loss, unrealised</p>
          <p>
            <Private as="b">{signedUsd(totals.pnl)}</Private>
            <Private>{signedPct(pct)}</Private>
          </p>
          <p className="xc-worth-on">
            on a cost of <Private>{usd(totals.cost)}</Private>
          </p>
        </div>
        <dl className="xc-water">
          <div>
            <dt>Open</dt>
            <dd>{totals.open}</dd>
          </div>
          <div className="is-up">
            <dt>Above water</dt>
            <dd>{w.above}</dd>
          </div>
          <div className="is-down">
            <dt>Under water</dt>
            <dd>{w.under}</dd>
          </div>
        </dl>
      </div>

      {positions.length > 0 ? (
        <>
          <div className="xc-relief">
            <Marks ps={positions} hot={hot} onHot={setHot} />
            <Terrain items={positions} hot={hot} />
            <span className="xc-sea-key" aria-hidden="true">
              Sea level · what you paid
            </span>
          </div>
          <div className="xc-led" role="group" aria-label="Positions, largest first">
            <p className="xc-led-head" aria-hidden="true">
              <span>№</span>
              <span>Market · side</span>
              <span>Size</span>
              <span>Entry</span>
              <span>Now</span>
              <span>Value</span>
              <span>P&amp;L</span>
              <span />
            </p>
            <ol>
              {shown.map((p, i) => (
                <Row key={`${p.market}-${i}`} p={p} i={i} open={open === i} hot={hot === i} onToggle={() => setOpen(open === i ? null : i)} onHot={setHot} />
              ))}
            </ol>
          </div>
        </>
      ) : (
        <div className="xc-relief is-calm">
          <Terrain items={[]} hot={null} />
          <p className="xc-calm">No open positions right now.</p>
        </div>
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

/** While the book can't be shown: the open sea, and the state in words over it. */
function Vault({ status, reason, onSignIn }: { status: PosStatus; reason: "no-key" | "bad-key" | null; onSignIn: () => void }) {
  return (
    <div className="xc-relief is-calm">
      <Terrain items={[]} hot={null} />
      <div className="xc-vault" data-state={status}>
        {status === "waiting" ? (
          <p>
            {reason === "bad-key"
              ? "The Polymarket US key is set but can't be read. Check POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY in the Function App."
              : "Waiting for your Polymarket US key. Once it's in the Function App's settings, your positions show here, read-only."}
          </p>
        ) : status === "signed-out" ? (
          <>
            <p className="xc-vault-h">Your book is behind the Desk&apos;s passkey.</p>
            <p>Sign in and it rises here: what it&apos;s worth, the P&amp;L, and every position.</p>
            <button type="button" className="xc-signin" onClick={onSignIn}>
              Sign in
            </button>
          </>
        ) : status === "off" ? (
          <p>Positions need the Desk&apos;s sign-in, which isn&apos;t connected here.</p>
        ) : status === "failed" ? (
          <p>Polymarket US didn&apos;t answer. Trying again in two minutes.</p>
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
          <p className="xc-k">Your book · Polymarket US · only you, signed in</p>
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
