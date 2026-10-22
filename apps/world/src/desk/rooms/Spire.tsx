import { useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { Private } from "../Private.tsx";
import { Parts, Poly, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import "./rooms.css";

/**
 * The Spire (#225): the business side, as a gilded ledger. Invoices sent, paid and overdue in tall numerals, this
 * week's best idea from the scout, and the shelf of ideas for later. Nothing is connected yet, so the ledger's columns
 * are empty on purpose and the page says exactly what it waits on. The Lattice will only ever show counts from here.
 */

const GOLD = "214,188,114";

const WAITS: Wait[] = [
  { what: "Stripe Invoicing", why: "A read-only key, kept on the server: invoices sent, paid and overdue. Nothing is ever charged from the Desk." },
  { what: "The scout's reading list", why: "Public feeds only: Reddit, Hacker News, Product Hunt and Etsy's trends, read once a week." },
  { what: "Claude for the scout, OpenAI for drafts", why: "Claude picks the week's idea and says why; OpenAI drafts the invoice notes and one-pagers. Keys stay on the server." },
];

const SHELF = [
  { t: "The print shop", s: "Selling what the Workshop prints" },
  { t: "Invoice chaser", s: "A polite nudge when one runs late" },
  { t: "Receipts and taxes", s: "Filed as they come in" },
  { t: "Landing-page tester", s: "Try an idea before building it" },
  { t: "Tide products", s: "Maps, minis and books from the campaign" },
  { t: "Fantasy tools", s: "For the Green's league" },
  { t: "The weekly one-pager", s: "The business on a single page" },
];

/** The ledger's rules: gold ink drifting slowly along each ruled line, thickest at the double rule up top. */
function ledgerSpec(): VizSpec {
  return {
    lay(V) {
      const rows = Math.max(3, Math.floor((V.H - 70) / 34));
      V.s.lines = Array.from({ length: rows + 1 }, (_, i) => {
        const y = i === 0 ? 58 : 70 + i * 34;
        const p = new Poly().set([16, V.W - 16], [y, y]);
        return { p, P: new Parts(i === 0 ? 70 : 10, 0.15), top: i === 0 };
      });
    },
    draw(V, c, t, dt) {
      for (const l of V.s.lines as { p: Poly; P: Parts; top: boolean }[]) {
        weave(c, l.p, l.P, { a: l.top ? 0.75 : 0.28, sp: l.top ? 1.2 : 0.4, sz: l.top ? 0.8 : 0.55, v: l.top ? 14 : 5, rgb: GOLD, rgb2: "255,236,190", line: l.top ? 0.4 : 0.1 }, t, dt);
      }
    },
  };
}

export function Spire() {
  const cv = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(ledgerSpec, []);
  useViz(cv, spec);
  return (
    <div className="wv-page rm rm-spire" data-room="spire">
      <header className="rm-head">
        <div>
          <p className="wv-eyb">The Spire · the gilded ledger</p>
          <h1 className="wv-h1 desk__title">
            The books open when <em>the ledger does.</em>
          </h1>
          <p className="wv-sub">
            The Spire will keep the business side: every invoice sent, paid and overdue, and a scout that comes back each week with one idea worth trying. Nothing is
            connected yet, so the columns below are empty on purpose.
          </p>
        </div>
        <Keeper page="spire" />
      </header>

      <section className="sp-ledger" aria-label="The ledger">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <div className="sp-ledger-in">
          <p className="sp-ledger-k">Invoices, this month</p>
          <dl className="sp-cols">
            {["Sent", "Paid", "Overdue"].map((k) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd aria-label="none yet">
                  <Private label="none yet">—</Private>
                </dd>
              </div>
            ))}
          </dl>
          <p className="sp-ledger-note">The first entry lands when Stripe Invoicing is connected. Until then the ledger stays blank rather than guessing.</p>
        </div>
      </section>

      <div className="sp-row">
        <section className="sp-scout" aria-label="The idea scout">
          <p className="wv-eyb">This week's best idea</p>
          <blockquote>No idea this week yet.</blockquote>
          <p className="wv-note">
            Once a week the scout reads what people are asking for on Reddit, Hacker News, Product Hunt and Etsy, and brings back the one idea that looks most like a
            business, with its reasons. It isn't running yet.
          </p>
        </section>
        <Waits items={WAITS} className="sp-waits" />
      </div>

      <section className="sp-shelf" aria-label="Ideas on the shelf for later">
        <div className="wv-sechead">
          <div>
            <p className="wv-eyb">On the shelf for later</p>
            <h2 className="wv-h2">Seven ideas, gilt-edged</h2>
          </div>
          <p className="wv-note">Plans, not promises: each becomes a Foundry idea when it's picked.</p>
        </div>
        <ul>
          {SHELF.map((x, i) => (
            <li key={x.t} style={{ "--i": i } as React.CSSProperties}>
              <b>{x.t}</b>
              <span>{x.s}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="rm-guard">The Lattice will only ever show counts from the Spire: never an amount, a client or an invoice.</p>
    </div>
  );
}
