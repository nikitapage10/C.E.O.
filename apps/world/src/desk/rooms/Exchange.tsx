import { useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { SetupAsks } from "../skippy/SetupAsks.tsx";
import { Parts, Poly, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import { BookieAsides } from "../exchange/BookieAsides.tsx";
import { PolymarketBoard } from "../exchange/PolymarketBoard.tsx";
import { PositionsBoard } from "../exchange/PositionsBoard.tsx";
import { bookLine, usePositions } from "../exchange/positions.ts";
import { tapeLine, usePolymarket } from "../exchange/polymarket.ts";
import "./rooms.css";
import "../exchange/exchange.css";

/**
 * The Exchange (#225, redrawn #367): markets and money, as a trading floor at night. Simple first, deeper on a tap.
 * Nikita's own Polymarket US positions lead (#253, PositionsBoard: read-only, signed-in Desk only, every figure marked
 * private for Hide mode; signed out it shows only where the book is). Then the centrepiece, what's moving the world
 * (#345, BookieAsides: geopolitics, politics and pop culture, no sports), then where the money is on Polymarket today
 * (#240, PolymarketBoard: the busiest markets, sports left out, and the pinned watchlist). Below, what's still to come
 * to the floor (the mispriced desk, research, personal money behind the passkey) and what the room waits on, folded
 * away. The Lattice only ever shows the public odds, never a position.
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

/** What's still to come to the floor, each one line until it's opened. */
const LATER = [
  {
    k: "Mispriced, with reasons",
    h: "Where the odds look wrong",
    on: "Waiting on the reasoning model",
    body: "For each open market: the price, the Bookie's own estimate, and the reasoning in a few lines, so you can disagree with it.",
  },
  {
    k: "The research desk",
    h: "Crypto, stocks and paper trades",
    on: "Waiting on a price source",
    body: "Notes on what you're watching and a paper-trading record that keeps score honestly, wins and losses alike. Prediction markets read from Polymarket now (pin one above).",
  },
  {
    k: "Personal money · behind the passkey",
    h: "Spending, debts and subscriptions",
    on: "Waiting on Plaid or statements",
    body: "Spending by category, debts with a payoff plan, subscriptions unused for sixty days flagged. Read-only, only you see it signed in; the Lattice only ever says \"on track\" or \"needs a look\".",
  },
] as const;

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
        c.strokeStyle = `rgba(${MINT},.06)`;
        r.p.stroke(c);
      }
      f.rails.forEach((r, i) => weave(c, r.p, r.P, { a: 0.2 + r.k * 0.45, sp: 0.4, sz: 0.5 + r.k * 0.5, v: (i % 2 ? -1 : 1) * (10 + r.k * 40), rgb: MINT, rgb2: "236,238,243", line: 0.04 + r.k * 0.06 }, t, dt));
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
  const waits = posStatus === "live" ? WAITS.slice(1) : WAITS;
  return (
    <div className="wv-page xc" data-room="exchange">
      <div className="xc-tape" aria-label={`The tape: Polymarket US, ${usLine}; market data, ${tapeLine(pmStatus, pmBoard)}; Plaid is not connected yet`}>
        <p aria-hidden="true">
          {tape.map(([k, v], i) => (
            <span key={i}>
              <b>{k}</b> {v}
            </span>
          ))}
        </p>
      </div>

      <div className="xc-floor">
        <canvas ref={cv} className="wv-cv xc-floor-cv" aria-hidden="true" />
        <header className="xc-mast">
          <div>
            <p className="xc-eyb">The Exchange · the floor after hours</p>
            <h1 className="xc-h1 desk__title">
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
          </div>
          <Keeper page="exchange" className="xc-keeper" />
        </header>
        <PositionsBoard />
      </div>

      <BookieAsides />

      <PolymarketBoard />

      <section className="xc-later" aria-label="Still to come to the floor">
        <p className="xc-eyb">Still to come to the floor</p>
        <div className="xc-later-row">
          {LATER.map((l) => (
            <details key={l.k} className="xc-soon">
              <summary>
                <span className="xc-soon-k">{l.k}</span>
                <span className="xc-soon-h">{l.h}</span>
                <span className="xc-soon-on">{l.on}</span>
              </summary>
              <p>{l.body}</p>
            </details>
          ))}
        </div>
      </section>

      <SetupAsks room="exchange" />

      <details className="xc-fold xc-waits">
        <summary>
          <span>What the room waits on</span>
          <b>{waits.length}</b>
        </summary>
        <Waits items={waits} title="What it waits on" />
      </details>
    </div>
  );
}
