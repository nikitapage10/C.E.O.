import { useEffect, useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { InvoicesSection } from "../spire/InvoicesSection.tsx";
import { startInvoices, useInvoices } from "../spire/invoices.ts";
import { Parts, Poly, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import "./rooms.css";

/**
 * The Spire (#225): the business side, as a gilded ledger. Invoices open, paid and overdue in tall numerals, read live
 * from PayPal on the Azure copy (#279), with the Invoices panel below them to make drafts and send them; this week's
 * best idea from the scout, and the shelf of ideas for later. The Lattice only ever shows counts from here.
 */

const GOLD = "214,188,114";

const WAITS: Wait[] = [
  { what: "The scout's reading list", why: "Public feeds only: Reddit, Hacker News, Product Hunt and Etsy's trends, read once a week." },
  { what: "Claude for the scout, OpenAI for one-pagers", why: "Claude picks the week's idea and says why; OpenAI drafts the one-pagers. Keys stay on the server." },
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
  useEffect(() => startInvoices(), []);
  const load = useInvoices((s) => s.load);
  const status = useInvoices((s) => s.status);
  const live = status?.paypal === "live" ? status : null;
  const cols: [string, number | null][] = [
    ["Open", live?.open ?? null],
    ["Paid", live?.paid ?? null],
    ["Overdue", live?.overdue ?? null],
  ];
  return (
    <div className="wv-page rm rm-spire" data-room="spire">
      <header className="rm-head">
        <div>
          <p className="wv-eyb">The Spire · the gilded ledger</p>
          <h1 className="wv-h1 desk__title">
            The books are open: <em>the ledger is live.</em>
          </h1>
          <p className="wv-sub">
            The Spire keeps the business side: invoices through PayPal, made as drafts here and sent only when you say so, and a scout that will come back each week with
            one idea worth trying.
          </p>
        </div>
        <Keeper page="spire" />
      </header>

      <section className="sp-ledger" aria-label="The ledger">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <div className="sp-ledger-in">
          <p className="sp-ledger-k">Invoices, the newest fifty</p>
          <dl className="sp-cols">
            {cols.map(([k, n]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd aria-label={n === null ? "not read yet" : String(n)}>{n === null ? "—" : n}</dd>
              </div>
            ))}
          </dl>
          <p className="sp-ledger-note">
            {load === "off"
              ? "Invoicing lives on the Azure copy, where the PayPal keys are. Here the ledger stays blank rather than guessing."
              : live
                ? `Read from PayPal${live.mode === "sandbox" ? "'s sandbox, test money only" : ""}. ${live.drafts} ${live.drafts === 1 ? "draft waits" : "drafts wait"} for your Send.`
                : "Waiting on PayPal. The ledger stays blank rather than guessing."}
          </p>
        </div>
      </section>

      <InvoicesSection />

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

      <p className="rm-guard">The Lattice only ever shows counts from the Spire: never an amount, a client or an invoice.</p>
    </div>
  );
}
