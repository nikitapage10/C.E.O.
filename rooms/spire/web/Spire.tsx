import { Keeper, Waits, type Wait } from "@ceo/desk/rooms/parts.tsx";
import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { Boardroom } from "./Boardroom.tsx";
import { InvoicesSection } from "./InvoicesSection.tsx";
// The flow kit's type and page rules (Bodoni, Jost, flow.css); the boardroom draws its own scene.
import "@ceo/desk/flow/index.ts";
import "@ceo/desk/rooms/rooms.css";
import "./spire.css";

/**
 * The Spire (#225; the boardroom since #825): the business side. The boardroom leads (Boardroom.tsx): the whole screen
 * under the bar is the top floor of the tower in 3D, a horseshoe table with the Spire's own seated round it, the
 * invoices' counts on it as piles of folders and the open count on the Executive's easel, read live from PayPal on the
 * Azure copy (#279). Below it, on the same gold wire grid with nanites rising out of it (UndoneField), in gold-framed
 * panels you can see the grid through: the ledger itself (the Invoices panel, to make drafts and send them, behind the
 * passkey), the pitch on the easel (this week's best idea from the scout), the memos on what the room waits on, and the
 * shelf of ideas for later as binders. The Lattice only ever shows counts from here.
 */

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

const toInvoices = () => document.getElementById("sp-invoices")?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });

export function Spire() {
  return (
    <div className="wv-page fl-page rm-spire" data-room="spire">
      <Boardroom onInvoices={toInvoices} />

      <div className="sp-deck">
        <UndoneField className="sp-deck-sig" />
        <div className="fl-below sp-wrap">
          <Keeper page="spire" className="sp-keeper" />

          <div id="sp-invoices" className="sp-frame sp-book">
            <InvoicesSection />
          </div>

          <div className="sp-row">
            <section className="sp-frame sp-pitch" aria-label="The idea scout">
              <p className="fl-k">
                <span>On the easel</span> · this week's best idea
              </p>
              <div className="sp-card">
                <blockquote>No idea this week yet.</blockquote>
                <p>
                  Once a week the scout reads what people are asking for on Reddit, Hacker News, Product Hunt and Etsy, and brings back the one idea that looks most like a
                  business, with its reasons. It isn't running yet.
                </p>
              </div>
              <div className="sp-legs" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </section>
            <section className="sp-frame sp-memos" aria-label="What the room waits on">
              <Waits items={WAITS} className="sp-waits" />
            </section>
          </div>

          <section className="sp-frame sp-shelf" aria-label="Ideas on the shelf for later">
            <div className="sp-shelf-h">
              <div>
                <p className="fl-k">
                  <span>On the shelf</span> · for later
                </p>
                <h2 className="fl-h2">Seven ideas, gilt-edged</h2>
              </div>
              <p className="sp-note">Plans, not promises: each becomes a Foundry idea when it's picked.</p>
            </div>
            <ul className="sp-binders">
              {SHELF.map((x, i) => (
                <li key={x.t} style={{ "--i": i } as React.CSSProperties}>
                  <b>{x.t}</b>
                  <span>{x.s}</span>
                </li>
              ))}
            </ul>
            <div className="sp-plank" aria-hidden="true" />
          </section>

          <p className="rm-guard">The Lattice only ever shows counts from the Spire: never an amount, a client or an invoice.</p>
        </div>
      </div>
    </div>
  );
}
