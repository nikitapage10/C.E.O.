import { useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { AskedSkippy } from "../skippy/AskedSkippy.tsx";
import { RoomFeed } from "../skippy/RoomFeed.tsx";
import { Parts, Poly, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import { PolymarketBoard } from "../exchange/PolymarketBoard.tsx";
import { PositionsBoard } from "../exchange/PositionsBoard.tsx";
import { bookLine, usePositions } from "../exchange/positions.ts";
import { tapeLine, usePolymarket } from "../exchange/polymarket.ts";
import "./rooms.css";

/**
 * The Exchange (#225): markets and money, as a trading floor at night. Nikita's own Polymarket US positions and P&L
 * first (#253, PositionsBoard: read-only, signed-in Desk only, every figure marked private for Hide mode), then
 * Polymarket's public odds (#240, PolymarketBoard: the busiest markets and a pinned watchlist, read-only), then markets
 * the Bookie thinks are mispriced with his reasons, crypto and stock research and a paper-trading record; below,
 * behind the passkey, personal money: spending, debts and subscriptions (not built yet). The Lattice only ever shows
 * the public odds, never a position.
 */

const MINT = "124,205,172";

/** The tape; POSITIONS reads the book's state (never a figure), MARKET DATA and WATCHLIST read Polymarket live (#240). */
const TAPE = [
  ["POLYMARKET US", ""],
  ["POSITIONS", ""],
  ["MARKET DATA", ""],
  ["WATCHLIST", ""],
  ["PAPER TRADES", "none yet"],
  ["PLAID", "not connected"],
  ["STATEMENTS", "none uploaded"],
] as const;

const WAITS: Wait[] = [
  { what: "Your Polymarket US key, in Azure", why: "POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY in the Function App, from Key Vault. Read-only: the Desk reads positions and never places an order." },
  { what: "A crypto and stock price source", why: "Prices for the research desk. Prediction-market odds already come from Polymarket, above." },
  { what: "OpenAI for the reasoning", why: "Reads a market, makes its own estimate and shows its working. The key stays on the server." },
  { what: "Plaid, read-only, or statement uploads", why: "For spending, debts and subscriptions. Behind the Desk's passkey; nothing leaves the server." },
];


/** The floor: a grid running away into the dark, mint tickers sliding along its rails. */
function floorSpec(): VizSpec {
  return {
    lay(V) {
      const hz = V.H * 0.18;
      const rails: { p: Poly; P: Parts; k: number }[] = [];
      for (let i = 0; i < 9; i++) {
        const f = i / 8;
        const y = hz + Math.pow(f, 1.8) * (V.H - hz);
        rails.push({ p: new Poly().set([0, V.W], [y, y]), P: new Parts(6 + Math.round(f * 26), 0.12), k: f });
      }
      const rays: { p: Poly }[] = [];
      for (let i = -8; i <= 8; i++) {
        const x0 = V.W / 2 + i * V.W * 0.035;
        const x1 = V.W / 2 + i * V.W * 0.16;
        rays.push({ p: new Poly().set([x0, x1], [hz, V.H]) });
      }
      V.s.f = { rails, rays };
    },
    draw(V, c, t, dt) {
      const f = V.s.f as { rails: { p: Poly; P: Parts; k: number }[]; rays: { p: Poly }[] };
      c.lineWidth = 0.6;
      for (const r of f.rays) {
        c.strokeStyle = `rgba(${MINT},.07)`;
        r.p.stroke(c);
      }
      f.rails.forEach((r, i) => weave(c, r.p, r.P, { a: 0.25 + r.k * 0.55, sp: 0.4, sz: 0.5 + r.k * 0.5, v: (i % 2 ? -1 : 1) * (10 + r.k * 40), rgb: MINT, rgb2: "236,238,243", line: 0.05 + r.k * 0.07 }, t, dt));
    },
  };
}

export function Exchange() {
  const cv = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(floorSpec, []);
  useViz(cv, spec);
  const pmStatus = usePolymarket((s) => s.status);
  const pmBoard = usePolymarket((s) => s.board);
  const pmLive = pmStatus === "ready" && pmBoard !== null;
  const pinned = pmBoard?.watchlist.length ?? 0;
  const posStatus = usePositions((s) => s.status);
  const [usLine, posLine] = bookLine(posStatus);
  const live = TAPE.map(([k, v]): [string, string] => [
    k,
    k === "MARKET DATA" ? tapeLine(pmStatus, pmBoard) : k === "WATCHLIST" ? (pmBoard ? (pinned ? `${pinned} pinned` : "empty") : "–") : k === "POLYMARKET US" ? usLine : k === "POSITIONS" ? posLine : v,
  ]);
  const tape = [...live, ...live];
  return (
    <div className="wv-page rm rm-exchange" data-room="exchange">
      <div className="ex-tape" aria-label={`The tape: Polymarket US, ${usLine}; market data, ${tapeLine(pmStatus, pmBoard)}; Plaid is not connected yet`}>
        <p aria-hidden="true">
          {tape.map(([k, v], i) => (
            <span key={i}>
              <b>{k}</b> {v}
            </span>
          ))}
        </p>
      </div>

      <header className="rm-head ex-head">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <div>
          <p className="wv-eyb">The Exchange · the floor after hours</p>
          <h1 className="wv-h1 desk__title">
            {pmLive ? (
              <>
                The odds are lit. <em>The Bookie is sweating.</em>
              </>
            ) : (
              <>
                The board is dark. <em>The Bookie isn't.</em>
              </>
            )}
          </h1>
          <p className="wv-sub">
            Your Polymarket US positions and what they're worth, read-only and only for you signed in; Polymarket's public odds, live; and soon the markets the Bookie
            thinks are mispriced and why, and research on crypto and stocks. Nothing here places an order.
          </p>
        </div>
        <Keeper page="exchange" />
      </header>

      <PositionsBoard />

      <PolymarketBoard />

      <div className="ex-grid">
        <section className="ex-card" aria-label="Mispriced markets">
          <p className="wv-eyb">Mispriced, with reasons</p>
          <h2 className="rm-h2">Where the odds look wrong</h2>
          <p className="wv-note">For each open market: the price, the Bookie's own estimate, and the reasoning in a few lines, so you can disagree with it. Comes once the reasoning model is connected.</p>
        </section>
        <section className="ex-card" aria-label="Research">
          <p className="wv-eyb">The research desk</p>
          <h2 className="rm-h2">Crypto, stocks and a watchlist</h2>
          <p className="wv-note">Notes on what you're watching and a paper-trading record that keeps score honestly, wins and losses alike. Prediction markets read from Polymarket now (pin one above); crypto and stocks wait on a price source.</p>
        </section>
      </div>

      <section className="ex-money" aria-label="Personal money">
        <div className="ex-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </div>
        <div>
          <p className="wv-eyb">Personal money · behind the passkey</p>
          <h2 className="rm-h2">Spending, debts and subscriptions</h2>
          <ul>
            <li>
              <b>Spending by category</b> where the month went
            </li>
            <li>
              <b>Debts</b> with a payoff plan
            </li>
            <li>
              <b>Subscriptions</b> unused for sixty days, flagged
            </li>
          </ul>
          <p className="wv-note">Read-only, through Plaid or statements you upload. Only you see this, signed in. The Lattice only ever says "on track" or "needs a look".</p>
        </div>
      </section>

      <AskedSkippy room="exchange" />
      <RoomFeed room="exchange" />

      <Waits items={posStatus === "live" ? WAITS.slice(1) : WAITS} className="ex-waits" />
    </div>
  );
}
