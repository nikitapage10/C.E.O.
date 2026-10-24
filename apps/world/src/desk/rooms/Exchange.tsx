import { Keeper, Waits, type Wait } from "./parts.tsx";
import { SetupAsks } from "../skippy/SetupAsks.tsx";
import { BookieAsides } from "../exchange/BookieAsides.tsx";
import { PolymarketBoard } from "../exchange/PolymarketBoard.tsx";
import { PositionsBoard } from "../exchange/PositionsBoard.tsx";
import { bookLine, usePositions } from "../exchange/positions.ts";
import { tapeLine, usePolymarket } from "../exchange/polymarket.ts";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/martian-mono/standard.css";
import "./rooms.css";
import "../exchange/exchange.css";

/**
 * The Exchange (#225, redrawn #367, given its own look in #387): a market sea and terrain, set in Instrument Serif and
 * Martian Mono with the Bookie's mint. Simple first, deeper on a tap. Nikita's own Polymarket US positions lead
 * (#253, PositionsBoard): plain figures, then the book as land against sea level (what was paid), then a ledger of
 * every position; read-only, signed-in Desk only, every figure marked private for Hide mode, and signed out an empty
 * sea that says where the book is. Then what's moving the world (#345, BookieAsides): the world's odds as weather and
 * a split-flap board, no sports. Then where the money is on Polymarket today (#240, PolymarketBoard). Below, what's
 * still to come and what the room waits on, folded away. The Lattice only ever shows the public odds, never a position.
 */

/** The room's gauges; POSITIONS reads the book's state (never a figure), MARKET DATA and WATCHLIST read Polymarket live (#240). */
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

export function Exchange() {
  const pmStatus = usePolymarket((s) => s.status);
  const pmBoard = usePolymarket((s) => s.board);
  const pinned = pmBoard?.watchlist.length ?? 0;
  const posStatus = usePositions((s) => s.status);
  const [usLine, posLine] = bookLine(posStatus);
  const gauges = TAPE.map(([k, v]): [string, string] => [
    k,
    k === "MARKET DATA" ? tapeLine(pmStatus, pmBoard) : k === "WATCHLIST" ? (pmBoard ? (pinned ? `${pinned} pinned` : "empty") : "–") : k === "POLYMARKET US" ? usLine : k === "POSITIONS" ? posLine : v,
  ]);
  const waits = posStatus === "live" ? WAITS.slice(1) : WAITS;
  return (
    <div className="wv-page xc" data-room="exchange">
      <header className="xc-mast">
        <div className="xc-mast-t">
          <p className="xc-k">Ilyr · the market floor · read-only</p>
          <h1 className="xc-h1 desk__title">The Exchange</h1>
          <p className="xc-dek">Your book as land against what you paid for it, and the world&apos;s odds as weather.</p>
        </div>
        <Keeper page="exchange" className="xc-keeper" />
      </header>
      <dl className="xc-gauges" aria-label="What the Exchange reads">
        {gauges.map(([k, v]) => (
          <div key={k}>
            <dt>{k.toLowerCase()}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <PositionsBoard />

      <BookieAsides />

      <PolymarketBoard />

      <section className="xc-later" aria-label="Still to come to the Exchange">
        <p className="xc-k">Still to come</p>
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
