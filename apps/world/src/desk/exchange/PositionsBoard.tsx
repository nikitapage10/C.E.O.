import { useEffect } from "react";
import { useDeskAuth } from "../signin.ts";
import { cents, contracts, pnlTone, signedPct, signedUsd, startPositions, usd, usePositions, type PmPosition, type PmTrade } from "./positions.ts";
import "./polymarket.css";
import "./positions.css";

/**
 * Nikita's own Polymarket US positions on the Exchange (#253): what he holds, what it cost, what it's worth and the
 * P&L, then the last few fills. Read-only. The server answers only a signed-in Desk; every dollar figure, size and P&L
 * here carries `data-private` so the Desk's Hide mode (#251) can mask it for a demo. Nothing from this board reaches the
 * Lattice or any public page. Every word in it came from Polymarket, so it is drawn as text only.
 */

function Market({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <a className="pm-q" href={url} target="_blank" rel="noopener noreferrer nofollow">
      {name}
    </a>
  ) : (
    <span className="pm-q">{name}</span>
  );
}

function Row({ p }: { p: PmPosition }) {
  const tone = pnlTone(p.pnl);
  return (
    <li className={`pos-row${p.expired ? " is-closed" : ""}`}>
      <div className="pos-q">
        <Market name={p.market} url={p.url} />
        <span className="pos-sub">
          <span className="pos-side">{p.short ? `Short ${p.outcome}` : p.outcome}</span>
          <span data-private>
            {contracts(p.contracts)} {p.contracts === 1 ? "contract" : "contracts"} · avg {cents(p.avgPrice)}
          </span>
          {p.expired && <span>Expired</span>}
        </span>
      </div>
      <span className="pos-num" data-private aria-label={`Worth ${usd(p.value)}, cost ${usd(p.cost)}`}>
        {usd(p.value)}
        <small>cost {usd(p.cost)}</small>
      </span>
      <span className={`pos-num pos-pnl is-${tone}`} data-private aria-label={`Profit or loss ${signedUsd(p.pnl)}, ${signedPct(p.pnlPct)}`}>
        {signedUsd(p.pnl)}
        <small>{signedPct(p.pnlPct)}</small>
      </span>
    </li>
  );
}

const KIND: Record<PmTrade["kind"], string> = { trade: "Filled", settled: "Settled", voided: "Voided" };

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Trade({ t }: { t: PmTrade }) {
  return (
    <li className={`pos-trade is-${t.kind}`}>
      <span className="pos-when">{when(t.at)}</span>
      <span className="pos-kind">{KIND[t.kind]}</span>
      <Market name={t.market} url={t.url} />
      <span className="pos-fill" data-private>
        {t.kind === "settled" ? "" : `${contracts(t.contracts)} @ ${cents(t.price)}`}
      </span>
    </li>
  );
}

export function PositionsBoard() {
  const status = usePositions((s) => s.status);
  const data = usePositions((s) => s.data);
  const reason = usePositions((s) => s.reason);
  const signIn = useDeskAuth((s) => s.signIn);

  useEffect(() => startPositions(), []);

  const totals = data?.totals ?? null;
  const tone = totals ? pnlTone(totals.pnl) : "flat";

  return (
    <section className="pm pos" aria-label="Your Polymarket US positions">
      <header className="pm-head">
        <div>
          <p className="pm-eyb">Your book · Polymarket US · only you, signed in</p>
          <h2 className="pm-h2">Open positions</h2>
        </div>
        <p className="pm-state" data-state={status === "live" ? (data?.stale ? "stale" : "ready") : status}>
          <i aria-hidden="true" />
          {status === "live"
            ? data?.stale
              ? "Polymarket US isn't answering. Last good read."
              : "Read-only · every two minutes"
            : status === "waiting"
              ? "Waiting for the key"
              : status === "signed-out"
                ? "Behind your passkey"
                : status === "failed"
                  ? "Polymarket US isn't answering"
                  : status === "off"
                    ? "Not connected here"
                    : "Reading…"}
        </p>
      </header>

      {status === "live" && data && totals ? (
        <>
          <div className="pos-totals">
            <div>
              <p className="pm-eyb">Worth now</p>
              <b data-private>{usd(totals.value)}</b>
            </div>
            <div>
              <p className="pm-eyb">Cost</p>
              <b data-private>{usd(totals.cost)}</b>
            </div>
            <div>
              <p className="pm-eyb">Unrealised P&amp;L</p>
              <b className={`is-${tone}`} data-private>
                {signedUsd(totals.pnl)}
              </b>
            </div>
            <div>
              <p className="pm-eyb">Open</p>
              <b>{totals.open}</b>
            </div>
          </div>
          {data.positions.length > 0 ? (
            <ol className="pos-list" aria-label="Positions, largest first">
              {data.positions.map((p, i) => (
                <Row key={`${p.market}-${i}`} p={p} />
              ))}
            </ol>
          ) : (
            <p className="pm-empty">No open positions. The Bookie finds this restful.</p>
          )}
          {data.more && <p className="pm-foot">Showing the largest {data.positions.length}; the totals cover those.</p>}
          {data.activity.length > 0 && (
            <div className="pos-activity">
              <p className="pm-eyb">Recent fills</p>
              <ol className="pos-trades" aria-label="Recent fills and settlements">
                {data.activity.map((t, i) => (
                  <Trade key={`${t.at}-${i}`} t={t} />
                ))}
              </ol>
            </div>
          )}
        </>
      ) : (
        <div className="pos-wait">
          {status === "waiting" ? (
            <p>
              {reason === "bad-key"
                ? "The Polymarket US key is set but can't be read. Check POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY in the Function App."
                : "Waiting for your Polymarket US key. Once it's in the Function App's settings, your positions show here, read-only."}
            </p>
          ) : status === "signed-out" ? (
            <p>
              Your positions are behind the Desk's passkey.{" "}
              <button type="button" className="pos-signin" onClick={() => void signIn()}>
                Sign in
              </button>
            </p>
          ) : status === "off" ? (
            <p>Positions need the Desk's sign-in, which isn't connected here.</p>
          ) : status === "failed" ? (
            <p>Polymarket US didn't answer. Trying again in two minutes.</p>
          ) : (
            <p>Reading your positions…</p>
          )}
        </div>
      )}

      <p className="pm-foot">Read-only: the Desk reads your Polymarket US positions and never places an order. Only you see this, signed in.</p>
    </section>
  );
}
