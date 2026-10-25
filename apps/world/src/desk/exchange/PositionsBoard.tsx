import { useCallback, useEffect, useRef, useState } from "react";
import { useFlow, type FlowLayoutFn, type FlowLine } from "../flow/index.ts";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { MINT, nowPrice, positionLine, returnPct, toneRgb, waterline } from "./floor.ts";
import { cents, contracts, pnlTone, signedPct, signedUsd, startPositions, usd, usePositions, type PmPosition, type PmPositions, type PmTrade, type PosStatus } from "./positions.ts";

/**
 * Nikita's own Polymarket US positions (#253; on the flow kit since #430). The book reads first as plain figures
 * (what it's worth, the P&L, how many are above and under water), then as a ledger where every position is a row with
 * its own particle line: it runs from what was paid to where it marks now, so its tilt is the move since entry, and it
 * flows faster and brighter the further it has moved, mint in profit and rose at a loss. When a price ticks between
 * reads, a packet runs its line. A row opens for cost, return and what was taken already.
 * Read-only. The server answers only a signed-in Desk; every dollar figure, size, price and P&L is wrapped in <Private>
 * so Hide mode (#251) veils it, and the lines carry shapes only. Signed out, the book says where it is and nothing else.
 * Every word in it came from Polymarket, so it is drawn as text only.
 */

/** Positions listed before "Show all". */
const FIRST = 8;

type Live = Extract<PmPositions, { state: "live" }>;

const num = (i: number) => String(i + 1).padStart(2, "0");

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
const rowId = (p: PmPosition, i: number) => `p${i}:${p.market}`;

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
        <span className="xc-led-track" data-xc-pos={i} aria-hidden="true" />
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
        <b className="fl-num">{ts.length}</b>
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

/** The ledger's rows and their lines: one canvas over the list, each line kept inside its own row's track. */
function Lines({ shown, children, hot, onHot }: { shown: PmPosition[]; children: React.ReactNode; hot: number | null; onHot: (i: number | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(shown.map((p) => [p.market, p.value, p.cost, p.contracts, p.avgPrice, p.expired]));
  const layout = useCallback<FlowLayoutFn>(
    ({ rel }) => {
      const el = host.current;
      if (!el) return { lines: [] };
      const lines: FlowLine[] = [];
      shown.forEach((p, i) => {
        const t = el.querySelector(`[data-xc-pos="${i}"]`);
        if (!t) return;
        const b = rel(t);
        if (b.w < 8) return;
        const l = positionLine(p);
        const y = (u: number) => b.y + 6 + (b.h - 12) * u;
        lines.push({ id: rowId(p, i), path: { from: [b.x, y(l.from)], to: [b.x + b.w, y(l.to)], bend: 0 }, rgb: toneRgb(l.tone), rate: l.rate, bright: l.bright, density: l.density, spread: 1.2, knots: [0], bed: 0.1, waiting: p.expired });
      });
      return { lines };
    },
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { cv, field, bind } = useFlow(layout, { accent: MINT, onHover: (id) => onHot(id ? shown.findIndex((p, i) => rowId(p, i) === id) : null) });
  useEffect(() => field.setFocus(hot === null || !shown[hot] ? null : rowId(shown[hot]!, hot)), [field, hot, shown]);
  // A price that moved since the last read: a packet runs that position's line.
  const last = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = new Map(shown.map((p, i) => [rowId(p, i), nowPrice(p) ?? -1]));
    if (!was) return;
    shown.forEach((p, i) => {
      const before = was.get(rowId(p, i));
      if (before !== undefined && Math.abs(before - (nowPrice(p) ?? -1)) >= 0.001) field.pulse(rowId(p, i));
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={host} className="xc-led-host" {...bind}>
      <canvas ref={cv} className="fl-cv" aria-hidden="true" />
      {children}
    </div>
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
      <dl className="fl-ledger xc-book-sum">
        <div className="is-hot">
          <dt>Worth now</dt>
          <dd>
            <Private>{usd(totals.value)}</Private>
          </dd>
        </div>
        <div className={`is-${tone}`}>
          <dt>Profit or loss</dt>
          <dd>
            <Private>{signedUsd(totals.pnl)}</Private>{" "}
            <small>
              <Private>{signedPct(pct)}</Private>
            </small>
          </dd>
        </div>
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
      <p className="xc-book-on">
        Unrealised, on a cost of <Private>{usd(totals.cost)}</Private>.
      </p>

      {positions.length > 0 ? (
        <div className="xc-led" role="group" aria-label="Positions, largest first">
          <p className="xc-led-head" aria-hidden="true">
            <span>№</span>
            <span>Market · side</span>
            <span>Entry → now</span>
            <span>Size</span>
            <span>Entry</span>
            <span>Now</span>
            <span>Value</span>
            <span>P&amp;L</span>
            <span />
          </p>
          <Lines shown={shown} hot={hot} onHot={setHot}>
            <ol>
              {shown.map((p, i) => (
                <Row key={`${p.market}-${i}`} p={p} i={i} open={open === i} hot={hot === i} onToggle={() => setOpen(open === i ? null : i)} onHot={setHot} />
              ))}
            </ol>
          </Lines>
        </div>
      ) : (
        <p className="xc-empty fl-wait">No open positions right now.</p>
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

/** While the book can't be shown: the state in words, and nothing else. */
function Vault({ status, reason, onSignIn }: { status: PosStatus; reason: "no-key" | "bad-key" | null; onSignIn: () => void }) {
  return (
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
          <p>Sign in and it opens here: what it&apos;s worth, the P&amp;L, and every position as a line from what you paid to where it stands.</p>
          <button type="button" className="fl-btn is-pri" onClick={onSignIn}>
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
    <section className="xc-sec xc-book" aria-label="Your Polymarket US positions">
      <header className="xc-sec-h">
        <div>
          <p className="fl-eyb">
            <span>Your book</span>
            <i aria-hidden="true" />
            Polymarket US · only you, signed in
          </p>
          <h2 className="fl-h2">Open positions</h2>
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
