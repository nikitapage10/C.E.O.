import { Waits, type Wait } from "@ceo/desk/rooms/parts.tsx";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { SetupAsks } from "@ceo/desk/skippy/SetupAsks.tsx";
import { Keeper } from "@ceo/desk/rooms/parts.tsx";
import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import type { HallSoon } from "../data/hall.ts";
import { Hall, HALL_ACCENT } from "./Hall.tsx";
import { Watchlist } from "./Markets.tsx";
import { Movers } from "./Movers.tsx";
import { PositionsBoard } from "./PositionsBoard.tsx";
import { bookLine, usePositions } from "../data/positions.ts";
import { tapeLine, usePolymarket } from "../data/polymarket.ts";
import "@ceo/desk/rooms/rooms.css";
import "./exchange.css";

/**
 * The Exchange (#225, redrawn #367, #387, #430; the trade floor since #823). The floor leads (Hall): the whole screen
 * under the bar is a futuristic exchange floor in 3D, gold on black, the busiest Polymarket markets on its trading
 * posts, the live tape on the marquee over the back wall, the busiest markets listed over its right side, and the
 * posts still being assembled at its edges are what's still to come. Below it, on the same gold wire grid with nanites
 * rising out of it (UndoneField): Nikita's own Polymarket US positions (#253, PositionsBoard), read-only, signed-in
 * Desk only, every figure marked private for Hide mode, and signed out only where the book is; what's moving the world
 * (#345, Movers); the watchlist; and, folded away, what's still to come and what the room waits on. The data blocks
 * sit in one measured column (--xc-max). The Lattice only ever shows the public odds, never a position.
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

/** The posts still being assembled at the floor's edges: what's still to come, each with what it waits on. */
const SOON: readonly HallSoon[] = LATER.map((l, i) => ({ id: `soon-${i}`, name: l.k.split(" · ")[0]!, on: l.on }));

export function Exchange() {
  const pmStatus = usePolymarket((s) => s.status);
  useRoomReady(pmStatus !== "idle");
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
    <div className="wv-page fl-page xc" data-room="exchange" style={HALL_ACCENT}>
      <Hall soon={SOON} onBook={() => document.getElementById("xc-book")?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" })} />

      <div className="xc-deck">
        <UndoneField className="xc-deck-sig" />
      <div className="fl-below xc-wrap">
        <Keeper page="exchange" className="xc-keeper" />

        <div id="xc-book" className="xc-book-at">
          <PositionsBoard />
        </div>

        <Movers />

        <section className="xc-sec xc-sec--slim" aria-label="Your watchlist">
          <Watchlist />
        </section>

      <section className="xc-later" aria-label="Still to come to the Exchange">
        <p className="fl-k">Still to come</p>
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
          <b className="fl-num">{waits.length}</b>
        </summary>
        <Waits items={waits} title="What it waits on" />
      </details>

      <dl className="xc-gauges" aria-label="What the Exchange reads">
        {gauges.map(([k, v]) => (
          <div key={k}>
            <dt>{k.toLowerCase()}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      </div>
      </div>
    </div>
  );
}
