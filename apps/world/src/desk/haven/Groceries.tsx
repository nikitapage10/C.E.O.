import { useCallback, useEffect, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { costOf, goes, groceryAction, GROCERY_NOTE, isCartLink, loadGroceries, money, type GAction, type GLine, type GProduct, type Groceries as View } from "./groceries.ts";

/**
 * Send to King Soopers on the Haven's Kitchen page (#664): the home store, each open list item's pick with its price
 * and stock, a swap per pick, the total, and one tap that adds the shown picks to the King Soopers cart, then opens the
 * cart there. Checkout, pickup or delivery, happens in the King Soopers app: nothing is bought from the Desk. The setup
 * (the ZIP, the home store, Connect King Soopers) lives in Boiler Room → Controls → Connections (boiler/HouseSetup.tsx).
 */

const SETUP = "/boiler/controls#ct-house";
const WAITING = "King Soopers: waiting for the Kroger app's keys in the Key Vault (docs/HOME-DEVICES.md).";

const stamp = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
};

function Price({ p }: { p: GProduct }) {
  return (
    <Private as="b" className="hv-gPrice">
      {p.promo !== null ? (
        <>
          {money(p.promo)} <s>{money(p.price)}</s>
        </>
      ) : (
        money(p.price)
      )}
    </Private>
  );
}

function Stock({ p }: { p: GProduct }) {
  return p.stock === "out" ? <span className="hv-gStock is-out">out of stock</span> : p.stock === "low" ? <span className="hv-gStock">low stock</span> : null;
}

/** The product's photo beside a pick: small in the row, larger on hover or a tap. None when Kroger has none. */
function Photo({ p }: { p: GProduct }) {
  const [big, setBig] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!p.image || broken) return null;
  return (
    <Private className="hv-gPhoto">
      <button type="button" className="hv-gThumb" aria-expanded={big} aria-label={`${big ? "Hide" : "Show"} the photo of ${p.description}`} onClick={() => setBig((v) => !v)} onPointerEnter={(e) => e.pointerType === "mouse" && setBig(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setBig(false)} onBlur={() => setBig(false)}>
        <img src={p.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      </button>
      {big ? <img className="hv-gBig" src={p.image} alt={p.description} referrerPolicy="no-referrer" /> : null}
    </Private>
  );
}

function Line({ l, busy, run, onRemove }: { l: GLine; busy: boolean; run: (b: GAction) => void; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(l.name);
  const p = l.pick?.product ?? null;
  return (
    <li className={l.pick?.skip ? "is-skip" : ""}>
      <div className="hv-gRow">
        <label className="hv-gItem">
          <input type="checkbox" checked={Boolean(p && !l.pick?.skip)} disabled={busy || !p} onChange={(e) => run({ action: "skip", key: l.key, skip: !e.target.checked })} aria-label={`Send ${l.name}`} />
          <Private>{l.name}</Private>
        </label>
        {l.pick ? (
          <button type="button" className="hv-gSwap" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Done" : "Swap"}
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" className="hv-x" aria-label={`Remove ${l.name} from the list`} onClick={() => onRemove(l.id)}>
            ×
          </button>
        ) : null}
      </div>
      {!l.pick ? (
        <p className="hv-gPick is-none">Not matched yet.</p>
      ) : p ? (
        <p className="hv-gPick">
          <Photo p={p} />
          <Private>
            {p.description}
            {p.size ? ` · ${p.size}` : ""}
          </Private>{" "}
          <Price p={p} /> <Stock p={p} />
        </p>
      ) : (
        <p className="hv-gPick is-none">No match at this store. Swap to search another way.</p>
      )}
      {open && l.pick ? (
        <div className="hv-gAlts">
          {l.pick.alts.length ? (
            <ul aria-label={`Other matches for ${l.name}`}>
              {l.pick.alts.map((a) => (
                <li key={a.productId}>
                  <Photo p={a} />
                  <Private>
                    {a.description}
                    {a.size ? ` · ${a.size}` : ""}
                  </Private>{" "}
                  <Price p={a} /> <Stock p={a} />
                  <button type="button" disabled={busy} onClick={() => (run({ action: "choose", key: l.key, productId: a.productId }), setOpen(false))}>
                    Use
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hv-note">No other matches kept. Search below.</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run({ action: "search", key: l.key, term });
            }}
          >
            <input value={term} maxLength={60} onChange={(e) => setTerm(e.target.value)} aria-label={`Search King Soopers for ${l.name}`} />
            <button type="submit" disabled={busy || term.trim().length < 3}>
              Search
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

export function Groceries({ listOpen, onRemove }: { listOpen: number; onRemove?: (id: string) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [load, setLoad] = useState<"idle" | "off" | "failed" | "ready">("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cart, setCart] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void loadGroceries().then((l) => {
      if (l.state === "ready") {
        setView(l.view);
        setLoad("ready");
      } else if (l.state === "out") useDeskAuth.getState().lost();
      else setLoad(l.state);
    });
  }, []);
  // Read once on open, and again when the list's open count moves (an item added or ticked): no polling.
  useEffect(refresh, [refresh, listOpen]);

  const run = async (body: GAction, done?: string) => {
    setBusy(true);
    setNote(null);
    const r = await groceryAction(body);
    setBusy(false);
    if (r.status === 401) useDeskAuth.getState().lost();
    if (r.view) setView(r.view);
    setNote(r.ok ? (done ?? null) : (GROCERY_NOTE[r.error ?? "failed"] ?? GROCERY_NOTE.failed!));
    return r;
  };

  if (load === "off") return null;
  if (!view) return <p className="hv-note">{load === "failed" ? "King Soopers didn't load. It'll try again when you come back." : "Reading King Soopers…"}</p>;
  if (!view.ready) {
    return <p className="hv-note">{WAITING}</p>;
  }

  const going = view.lines.filter(goes);
  const unmatched = view.lines.filter((l) => !l.pick).length;
  const send = async () => {
    // A window opened now, in the tap, so the cart isn't blocked as a pop-up once Kroger answers.
    const win = window.open("about:blank", "_blank");
    const r = await run({ action: "send", picks: going.map((l) => ({ key: l.key, productId: l.pick!.product!.productId })) });
    if (r.ok && r.url && isCartLink(r.url)) {
      if (win) {
        win.opener = null;
        win.location.href = r.url;
      }
      setCart(r.url);
      setNote(`Added ${r.items} to your King Soopers cart. Pick pickup or delivery and check out there.`);
    } else win?.close();
  };

  return (
    <div className="hv-groc">
      {view.store ? (
        <p className="hv-row">
          <Private>
            {view.store.name}
            {view.store.line ? ` · ${view.store.line}, ${view.store.city}` : ""}
          </Private>
          <a className="hv-gSwap" href={SETUP}>
            Change
          </a>
        </p>
      ) : (
        <p className="hv-note">
          Pick your home store first: <a href={SETUP}>Boiler Room → Controls → Connections</a>, by ZIP.
        </p>
      )}

      {view.store ? (
        <>
          {view.lines.length ? (
            <ul className="hv-gLines" aria-label="Picks at King Soopers">
              {view.lines.map((l) => (
                <Line key={l.key} l={l} busy={busy} run={(b) => void run(b)} onRemove={onRemove} />
              ))}
            </ul>
          ) : (
            <p className="hv-note">Nothing open on the list to match.</p>
          )}
          {unmatched ? (
            <button type="button" className="hv-btn" disabled={busy} onClick={() => void run({ action: "match" }, "Matched.")}>
              {busy ? "Matching…" : `Match ${unmatched} item${unmatched === 1 ? "" : "s"} at this store`}
            </button>
          ) : null}
          {going.length ? (
            <p className="hv-row hv-gTotal">
              <span>
                {going.length} item{going.length === 1 ? "" : "s"}
              </span>
              <Private as="b">{money(going.reduce((n, l) => n + costOf(l.pick!.product!), 0))}</Private>
            </p>
          ) : null}
          {going.length ? <p className="hv-note">Before tax and fees; King Soopers sets the final price at checkout.</p> : null}

          {view.connected ? (
            <>
              <button type="button" className="hv-btn is-pri" disabled={busy || !going.length} onClick={() => void send()}>
                {busy ? "Working…" : `Send ${going.length} to King Soopers`}
              </button>
              <p className="hv-note">Adds these to your King Soopers cart; you check out in the King Soopers app.</p>
            </>
          ) : (
            <p className="hv-note">
              {view.refused ? "King Soopers let go of the connection" : "King Soopers isn't connected yet"}: connect it in{" "}
              <a href={SETUP}>Boiler Room → Controls → Connections</a>, then send from here.
            </p>
          )}
        </>
      ) : null}

      {note ? (
        <p className="hv-note" role="status">
          {note}
        </p>
      ) : null}
      {cart ? (
        <a className="hv-btn" href={cart} target="_blank" rel="noopener noreferrer">
          Open the cart
        </a>
      ) : view.sent?.ok ? (
        <p className="hv-note">
          Last sent {view.sent.items} on {stamp(view.sent.at)}.
        </p>
      ) : null}
    </div>
  );
}

