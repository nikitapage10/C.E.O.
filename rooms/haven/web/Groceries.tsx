import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { KitchenItem } from "../../../apps/world/src/desk/haven.ts";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { adds, costOf, goes, groceryAction, GROCERY_NOTE, isCartLink, listCleared, loadGroceries, matchAll, money, QTY_MAX, reviewOf, shelfOf, VERDICT_BADGE, type GAction, type GLine, type GProduct, type GReply, type Groceries as View } from "./groceries.ts";

/**
 * The Kitchen's Shopping card (#737; Send to King Soopers, #664): one card, two tabs. **List** is the Kitchen list by
 * shelf, with Finalize & match, which matches every open item at the home store in one press and turns to the second
 * tab. **King Soopers** is each item's pick with its price and stock, a swap, a rematch and the product's own sheet, the
 * total, and one tap that adds the shown picks to the King Soopers cart. Kroger's public Cart API can only add (it can't
 * read or empty the cart), so the Desk remembers what it sent and never adds it twice. Checkout, pickup or delivery,
 * happens in the King Soopers app: nothing is bought from the Desk. After matching, each pick's quantity is checked
 * against its list line (#761: "garlic 30 cloves" is ×3 heads), with −/+ to change it and Re-check to ask again; the
 * send adds those quantities. Each tab has a two-tap Clear: King Soopers forgets the matches only, List clears the list
 * and the matches and reopens the week's Finalize. The setup (the ZIP, the home store, Connect King
 * Soopers) lives in Boiler Room → Controls → Connections (boiler/HouseSetup.tsx).
 */

const SETUP = "/boiler/controls#ct-house";
const CART = "https://www.kingsoopers.com/cart";
const WAITING = "King Soopers: waiting for the Kroger app's keys in the Key Vault (docs/HOME-DEVICES.md).";

const stamp = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

/** The product's photo, or nothing when Kroger has none (or it won't load). */
function Img({ p, eager }: { p: GProduct; eager?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!p.image || broken) return null;
  return <img src={p.image} alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/**
 * A Clear that asks first, on the page (#761: confirm() doesn't work there): the first tap turns it into "Clear? Yes
 * No", which falls back after a few seconds.
 */
function ConfirmClear({ label, busy, onYes }: { label: string; busy: boolean; onYes: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const arm = () => {
    setArmed(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setArmed(false), 5000);
  };
  const off = () => {
    window.clearTimeout(timer.current);
    setArmed(false);
  };
  return armed ? (
    <span className="hv-confirm" role="group" aria-label={`${label}?`}>
      <span>Clear?</span>
      <button type="button" className="hv-gSwap is-yes" disabled={busy} onClick={() => (off(), onYes())}>
        Yes
      </button>
      <button type="button" className="hv-gSwap" onClick={off}>
        No
      </button>
    </span>
  ) : (
    <button type="button" className="hv-gSwap hv-clear" disabled={busy} onClick={arm}>
      {label}
    </button>
  );
}

/** A pick's count (#761): ×N with −/+, the check's one-line reason, a badge when it's short, way over or wrong, and a better pick. */
function Qty({ l, busy, run }: { l: GLine; busy: boolean; run: (b: GAction) => void }) {
  const p = l.pick?.product;
  if (!p || l.pick?.skip) return null;
  const r = reviewOf(l);
  const badge = r ? VERDICT_BADGE[r.verdict] : null;
  const better = r?.better ? l.pick!.alts.find((a) => a.productId === r.better) : null;
  return (
    <>
      <div className="hv-gQty">
        <span className="hv-step" role="group" aria-label={`How many of ${l.name}`}>
          <button type="button" aria-label={`One fewer ${l.name}`} disabled={busy || l.inCart || l.qty <= 1} onClick={() => run({ action: "qty", key: l.key, qty: l.qty - 1 })}>
            −
          </button>
          <b aria-live="polite">×{l.qty}</b>
          <button type="button" aria-label={`One more ${l.name}`} disabled={busy || l.inCart || l.qty >= QTY_MAX} onClick={() => run({ action: "qty", key: l.key, qty: l.qty + 1 })}>
            +
          </button>
        </span>
        <small className="hv-gWhy">{r ? <Private>{r.reason}</Private> : "Not checked yet"}</small>
        {badge ? <span className={`hv-gFlag is-${r!.verdict}`}>{badge}</span> : null}
      </div>
      {better ? (
        <p className="hv-gBetter">
          <span>
            Better fit:{" "}
            <Private>
              {better.description}
              {better.size ? ` · ${better.size}` : ""}
            </Private>
          </span>
          <button type="button" className="hv-gSwap" disabled={busy} onClick={() => run({ action: "choose", key: l.key, productId: better.productId })}>
            Use
          </button>
        </p>
      ) : null}
    </>
  );
}

/** The groceries view, read on open and again when the list's open count moves (no polling), and its actions. */
function useGroceries(listOpen: number) {
  const [view, setView] = useState<View | null>(null);
  const [load, setLoad] = useState<"idle" | "off" | "failed" | "ready">("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void loadGroceries().then((l) => {
      if (l.state === "ready") {
        setView(l.view);
        setLoad("ready");
      } else if (l.state === "out") useDeskAuth.getState().lost();
      else setLoad(l.state);
    });
  }, []);
  useEffect(refresh, [refresh, listOpen]);
  const take = (r: GReply, done?: string | null) => {
    if (r.status === 401) useDeskAuth.getState().lost();
    if (r.view) setView(r.view);
    setNote(r.ok ? (done ?? null) : (GROCERY_NOTE[r.error ?? "failed"] ?? GROCERY_NOTE.failed!));
    return r;
  };
  const run = async (body: GAction, done?: string) => {
    setBusy(true);
    setNote(null);
    const r = await groceryAction(body);
    setBusy(false);
    return take(r, done);
  };
  return { view, load, busy, setBusy, note, setNote, run, take };
}
type G = ReturnType<typeof useGroceries>;

/** One product, large (#737): its photo, brand, size, price and sale, stock, aisle and departments, and the swaps. */
function ProductSheet({ l, busy, run, onClose }: { l: GLine; busy: boolean; run: (b: GAction) => void; onClose: () => void }) {
  const p = l.pick?.product;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  if (!p) return null;
  // Over the page, not inside the card: the card's blur would hold a fixed sheet inside it.
  return createPortal(
    <div data-room="haven" className="hv-portal">
      <div className="hv-pSheet" role="dialog" aria-modal="true" aria-label={`${l.name}: ${p.description}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="hv-pCard">
          <button ref={close} type="button" className="hv-x hv-pClose" aria-label="Close" onClick={onClose}>
            ×
          </button>
          <Private className={`hv-pHero${p.image ? "" : " is-empty"}`}>{p.image ? <Img p={p} eager /> : <span>No photo from Kroger</span>}</Private>
          <div className="hv-pTxt">
            {p.brand ? <small>{p.brand}</small> : null}
            <h4>
              <Private>{p.description}</Private>
            </h4>
            <p className="hv-pMeta">
              {p.size ? <span>{p.size}</span> : null}
              <Price p={p} />
              {p.promo !== null ? <span className="hv-pSale">on sale</span> : null}
              <Stock p={p} />
              {p.stock === "high" ? <span className="hv-pIn">in stock</span> : null}
            </p>
            <dl className="hv-pFacts">
              <dt>Aisle</dt>
              <dd>{p.aisle ?? "Not given"}</dd>
              {p.categories.length ? (
                <>
                  <dt>Department</dt>
                  <dd>{p.categories.join(" · ")}</dd>
                </>
              ) : null}
              <dt>For</dt>
              <dd>
                <Private>{l.name}</Private>
                {l.pick?.term && l.pick.term !== l.name.toLowerCase() ? ` (searched "${l.pick.term}")` : ""}
              </dd>
            </dl>
            {l.inCart ? <p className="hv-gIn">Already in your cart</p> : null}
          </div>
          {l.pick?.alts.length ? (
            <section className="hv-pAlts" aria-label={`Other matches for ${l.name}`}>
              <h5>Swap for</h5>
              <ul>
                {l.pick.alts.map((a) => (
                  <li key={a.productId}>
                    {a.image ? (
                      <Private className="hv-pAltImg">
                        <Img p={a} />
                      </Private>
                    ) : null}
                    <span className="hv-pAltTxt">
                      <Private>{a.description}</Private>
                      <small>
                        {a.size}
                        {a.aisle ? ` · ${a.aisle}` : ""}
                      </small>
                    </span>
                    <Price p={a} />
                    <Stock p={a} />
                    <button type="button" className="hv-gSwap" disabled={busy} onClick={() => (run({ action: "choose", key: l.key, productId: a.productId }), onClose())}>
                      Choose this
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Line({ l, busy, run, onOpen }: { l: GLine; busy: boolean; run: (b: GAction) => void; onOpen: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(l.pick?.term || l.name);
  const p = l.pick?.product ?? null;
  return (
    <li className={`${l.pick?.skip ? "is-skip" : ""}${l.inCart ? " is-in" : ""}${l.stale ? " is-stale" : ""}`}>
      <div className="hv-gRow">
        <label className="hv-gItem">
          <input type="checkbox" checked={Boolean(p && !l.pick?.skip)} disabled={busy || !p} onChange={(e) => run({ action: "skip", key: l.key, skip: !e.target.checked })} aria-label={`Send ${l.name}`} />
          <Private>{l.name}</Private>
          {l.stale ? <span className="hv-gFlag is-stale">plan changed</span> : null}
        </label>
        <span className="hv-gActs">
          {l.pick ? (
            <button type="button" className="hv-gSwap" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Done" : "Swap"}
            </button>
          ) : null}
          <button type="button" className="hv-gSwap" disabled={busy} aria-label={`Rematch ${l.name}`} onClick={() => run({ action: "rematch", key: l.key })}>
            Rematch
          </button>
        </span>
      </div>
      {!l.pick ? (
        <p className="hv-gPick is-none">Not matched yet.</p>
      ) : p ? (
        <button type="button" className="hv-gPick hv-gOpen" aria-label={`${p.description}: details`} onClick={() => onOpen(l.key)}>
          {p.image ? (
            <Private className="hv-gThumb">
              <Img p={p} />
            </Private>
          ) : null}
          <span>
            <Private>
              {p.description}
              {p.size ? ` · ${p.size}` : ""}
            </Private>{" "}
            <Price p={p} /> <Stock p={p} />
            {p.aisle ? <small className="hv-gAisle">{p.aisle}</small> : null}
            {l.inCart ? <span className="hv-gIn">Already in your cart</span> : null}
          </span>
        </button>
      ) : (
        <p className="hv-gPick is-none">No match at this store. Swap to search another way.</p>
      )}
      <Qty l={l} busy={busy} run={run} />
      {open && l.pick ? (
        <div className="hv-gAlts">
          {l.pick.alts.length ? (
            <ul aria-label={`Other matches for ${l.name}`}>
              {l.pick.alts.map((a) => (
                <li key={a.productId}>
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

/** The King Soopers tab's scrolling part: the store, each pick, and a product's own sheet. */
function KingSoopers({ g, onMatch }: { g: G; onMatch: () => void }) {
  const { view, busy, run } = g;
  const [detail, setDetail] = useState<string | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  if (!view) return null;
  if (!view.ready) return <p className="hv-note">{WAITING}</p>;
  const unmatched = view.lines.filter((l) => !l.pick).length;
  const shown = detail ? view.lines.find((l) => l.key === detail) : null;
  const plan = view.plan;
  return (
    <div className="hv-groc">
      {plan.changed ? (
        <p className="hv-note hv-stale" role="status">
          The plan changed since you finalized
          {plan.stale ? `: ${plural(plan.stale, "match no longer fits", "matches no longer fit")}` : ""}
          {plan.fresh ? `${plan.stale ? "," : ":"} ${plural(plan.fresh, "new item isn't", "new items aren't")} on the list yet` : ""}. Finalize the week again, then re-match.
        </p>
      ) : null}
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
        view.lines.length ? (
          <ul className="hv-gLines" aria-label="Picks at King Soopers">
            {view.lines.map((l) => (
              <Line key={l.key} l={l} busy={busy} run={(b) => void run(b)} onOpen={setDetail} />
            ))}
          </ul>
        ) : (
          <p className="hv-note">Nothing open on the list to match.</p>
        )
      ) : null}
      {view.store && unmatched ? (
        <button type="button" className="hv-btn" disabled={busy} onClick={onMatch}>
          {`Match ${plural(unmatched, "item")} at this store`}
        </button>
      ) : null}
      {shown ? <ProductSheet l={shown} busy={busy} run={(b) => void run(b)} onClose={closeDetail} /> : null}
    </div>
  );
}

/** Under the King Soopers tab's scroll: the total, Send to cart, the cart note and Clear matches. */
function KingSoopersFoot({ g, onCheck }: { g: G; onCheck: () => void }) {
  const { view, busy, run } = g;
  const [cart, setCart] = useState<string | null>(null);
  if (!view?.ready || !view.store) return null;
  const going = view.lines.filter(goes);
  const fresh = view.lines.filter(adds);
  const inCart = view.lines.filter((l) => l.inCart).length;
  const matched = view.lines.some((l) => l.pick);
  const send = async () => {
    // A window opened now, in the tap, so the cart isn't blocked as a pop-up once Kroger answers.
    const win = window.open("about:blank", "_blank");
    const r = await run({ action: "send", picks: going.map((l) => ({ key: l.key, productId: l.pick!.product!.productId, qty: l.qty })) });
    if (r.ok && r.url && isCartLink(r.url) && r.items) {
      if (win) {
        win.opener = null;
        win.location.href = r.url;
      }
      setCart(r.url);
      g.setNote(`Added ${r.items} to your King Soopers cart${r.already ? ` (${r.already} already there, not added again)` : ""}. Pick pickup or delivery and check out there.`);
    } else {
      win?.close();
      if (r.ok) g.setNote(`Nothing new to add: ${plural(r.already, "pick is", "picks are")} already in your cart.`);
    }
  };
  const clear = () => {
    setCart(null);
    void run({ action: "clear" }, "Matches cleared. The list is as it was; match again when it's ready.");
  };
  const flagged = going.filter((l) => {
    const r = reviewOf(l);
    return r && r.verdict !== "covered";
  }).length;
  const unchecked = going.filter((l) => !reviewOf(l)).length;
  const units = going.reduce((n, l) => n + l.qty, 0);
  return (
    <div className="hv-shopFoot">
      {going.length ? (
        <p className="hv-row hv-gTotal">
          <span>
            {plural(going.length, "item")}
            {units !== going.length ? <small> · {units} in all</small> : null}
            {inCart ? <small> · {inCart} in your cart</small> : null}
          </span>
          <Private as="b">{money(going.reduce((n, l) => n + costOf(l.pick!.product!) * l.qty, 0))}</Private>
        </p>
      ) : null}
      {going.length ? (
        <p className="hv-row hv-gCheck">
          <span>{flagged ? `${plural(flagged, "pick")} to look at` : unchecked ? `${plural(unchecked, "pick")} not checked yet` : "Quantities checked"}</span>
          <button type="button" className="hv-gSwap" disabled={busy} onClick={onCheck}>
            Re-check
          </button>
        </p>
      ) : null}
      {view.connected ? (
        <button type="button" className="hv-btn is-pri" disabled={busy || !fresh.length} onClick={() => void send()}>
          {busy ? "Working…" : fresh.length ? `Send ${fresh.length} to King Soopers` : going.length ? "All in your cart" : "Nothing to send"}
        </button>
      ) : (
        <p className="hv-note">
          {view.refused ? "King Soopers let go of the connection" : "King Soopers isn't connected yet"}: connect it in <a href={SETUP}>Boiler Room → Controls → Connections</a>, then send from here.
        </p>
      )}
      {cart ? (
        <a className="hv-btn" href={cart} target="_blank" rel="noopener noreferrer">
          Open the cart
        </a>
      ) : view.sent?.ok ? (
        <p className="hv-note">
          Last sent {view.sent.items} on {stamp(view.sent.at)}.
        </p>
      ) : null}
      <p className="hv-note hv-cartNote">
        Before tax and fees. The Desk can add to your cart but can't see or empty it, so it remembers what it sent and won't add it twice. Remove anything in the{" "}
        <a href={CART} target="_blank" rel="noopener noreferrer">
          King Soopers app
        </a>
        .
      </p>
      {matched ? (
        <div className="hv-clearRow">
          <ConfirmClear label="Clear matches" busy={busy} onYes={clear} />
          <p className="hv-note">Clears the matches here only: anything already sent stays in your King Soopers cart, which the Desk can add to but not empty.</p>
        </div>
      ) : null}
    </div>
  );
}

/** The List tab: the Kitchen list by shelf, ticked items last. */
function ListTab({ items, view, onTick, onRemove }: { items: KitchenItem[] | null; view: View | null; onTick: (i: KitchenItem) => void; onRemove: (i: KitchenItem) => void }) {
  if (items === null)
    return (
      <p className="hv-wait">
        <i aria-hidden="true" />
        Reading the list…
      </p>
    );
  if (!items.length) return <p className="hv-note">Empty. Say "Skippy, add garlic and lemons" on the phone, or finalize the week's meals.</p>;
  const pickOf = new Map((view?.lines ?? []).map((l) => [l.id, l.pick?.product ?? null]));
  const groups = new Map<string, KitchenItem[]>();
  for (const i of items.filter((x) => !x.done)) {
    const shelf = shelfOf(i.name, pickOf.get(i.id));
    groups.set(shelf, [...(groups.get(shelf) ?? []), i]);
  }
  const done = items.filter((x) => x.done);
  if (done.length) groups.set("Done", done);
  return (
    <ul className="hv-shopGroups" aria-label="Kitchen list">
      {[...groups].map(([shelf, rows]) => (
        <li key={shelf} className={shelf === "Done" ? "is-done" : ""}>
          <h4>
            {shelf} <small>{rows.length}</small>
          </h4>
          <ul className="hv-list">
            {rows.map((i) => (
              <li key={i.id} className={i.done ? "is-done" : ""}>
                <label>
                  <input type="checkbox" checked={i.done} onChange={() => onTick(i)} />
                  <Private>{i.name}</Private>
                </label>
                <button type="button" className="hv-x" aria-label={`Remove ${i.name}`} onClick={() => onRemove(i)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one Shopping card on the Kitchen page (#737). `undo` is the list's five-second Undo (#673), kept by the page so
 * it outlives a tab switch.
 */
export function Shopping({ items, onTick, onRemove, undo, tag }: { items: KitchenItem[] | null; onTick: (i: KitchenItem) => void; onRemove: (i: KitchenItem) => void; undo: ReactNode; tag: ReactNode }) {
  const open = items?.filter((i) => !i.done) ?? [];
  const g = useGroceries(open.length);
  const [tab, setTab] = useState<"list" | "ks">("list");
  const [progress, setProgress] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const { view, load, busy } = g;
  const ks = load !== "off";
  const picked = view?.lines.filter(goes).length ?? 0;
  const canMatch = Boolean(view?.ready && view.store);
  const go = (t: "list" | "ks") => {
    setTab(t);
    body.current?.scrollTo(0, 0);
  };

  /** The quantity check (#761): every matched pick against its list line, then what it found. */
  const check = async (after?: string | null) => {
    g.setBusy(true);
    setProgress("Checking quantities…");
    const r = await groceryAction({ action: "review" });
    setProgress(null);
    g.setBusy(false);
    const flagged = (r.view?.lines ?? []).filter((l) => goes(l) && reviewOf(l) && reviewOf(l)!.verdict !== "covered").length;
    const said = r.ok ? `Quantities checked${r.by === "rules" ? " with plain unit math (the AI check isn't available)" : ""}${flagged ? `: ${plural(flagged, "pick")} to look at` : "."}` : null;
    g.take(r, [after, said].filter(Boolean).join(" ") || null);
  };

  /** Finalize & match: every open item matched at the home store, a batch at a time, then on to the picks, then checked. */
  const matchEvery = async () => {
    g.setBusy(true);
    g.setNote(null);
    setProgress("Matching…");
    const r = await matchAll((d, of) => setProgress(of ? `Matching ${d} of ${of}…` : "Matching…"));
    setProgress(null);
    g.setBusy(false);
    g.take(r, r.left ? `Matched what it could; ${plural(r.left, "item")} still wait. Try again in a bit.` : null);
    if (r.view) go("ks");
    if (r.view?.lines.some(goes)) await check(r.left ? `Matched what it could; ${plural(r.left, "item")} still wait.` : null);
  };

  /** Clear list (#761): the list and every match gone, and the planner told, so it reopens the week at Plan. */
  const clearList = async () => {
    const r = await g.run({ action: "clear-list" }, "List and matches cleared. The week is open again: change it, then Finalize.");
    if (r.ok) listCleared();
  };

  return (
    <section className="hv-card hv-shop">
      <header>
        <h3>Shopping</h3>
        {tag ? <span className="hv-tag">{tag}</span> : null}
      </header>
      {ks ? (
        <div className="hv-shopTabs" role="tablist" aria-label="Shopping">
          <button type="button" role="tab" id="hv-shop-list" aria-controls="hv-shop-body" aria-selected={tab === "list"} onClick={() => go("list")}>
            List <b>{open.length}</b>
          </button>
          <button type="button" role="tab" id="hv-shop-ks" aria-controls="hv-shop-body" aria-selected={tab === "ks"} onClick={() => go("ks")}>
            King Soopers <b>{picked}</b>
          </button>
        </div>
      ) : null}
      <div ref={body} className="hv-shopBody" id="hv-shop-body" role={ks ? "tabpanel" : undefined} aria-labelledby={ks ? (tab === "list" ? "hv-shop-list" : "hv-shop-ks") : undefined} tabIndex={0}>
        {tab === "list" || !ks ? (
          <ListTab items={items} view={view} onTick={onTick} onRemove={onRemove} />
        ) : !view ? (
          <p className="hv-note">{load === "failed" ? "King Soopers didn't load. It'll try again when you come back." : "Reading King Soopers…"}</p>
        ) : (
          <KingSoopers g={g} onMatch={() => void matchEvery()} />
        )}
      </div>
      {undo}
      {progress ? (
        <p className="hv-note hv-shopProg" role="status">
          {progress}
        </p>
      ) : null}
      {tab === "list" && ks ? (
        <div className="hv-shopFoot">
          <button type="button" className="hv-btn is-pri" disabled={busy || !canMatch || !open.length} onClick={() => void matchEvery()}>
            {progress ? "Working…" : "Finalize & match"}
          </button>
          <p className="hv-note">
            {!view ? (
              "Reading King Soopers…"
            ) : !view.ready ? (
              WAITING
            ) : !view.store ? (
              <>
                Pick your home store first, in <a href={SETUP}>Boiler Room → Controls → Connections</a>.
              </>
            ) : (
              "Matches every open item at your store, checks how many of each to add, then shows the picks to send."
            )}
          </p>
          {items?.length ? <ConfirmClear label="Clear list" busy={busy} onYes={() => void clearList()} /> : null}
        </div>
      ) : tab === "ks" ? (
        <KingSoopersFoot g={g} onCheck={() => void check()} />
      ) : null}
      {g.note ? (
        <p className="hv-note" role="status">
          {g.note}
        </p>
      ) : null}
    </section>
  );
}
