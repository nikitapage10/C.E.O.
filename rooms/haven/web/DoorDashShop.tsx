import { useCallback, useContext, useEffect, useState, type FormEvent } from "react";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { DoorDashGate, Placed, PreviewView } from "./Order.tsx";
import {
  addLinesOf,
  money,
  noteOf,
  orderCall,
  readFound,
  readGroceryBuild,
  readPreview,
  readStore,
  rowsCents,
  weekKey,
  type Found,
  type GroceryBuild,
  type GroceryRow,
  type OrderReply,
  type Placement,
  type Preview,
  type Store,
} from "./order.ts";
import { ShopWeek } from "./shopWeek.ts";

/**
 * The Shop step's DoorDash tab (#1195, phase 3; api/_haven/doordash/order.ts, the grocery-* actions): King Soopers or
 * DoorDash for the week's shopping. Pick a DoorDash grocery store once (remembered for the week, and as the last one),
 * build the cart from the open Kitchen list in one go, review what it couldn't find or found out of stock (swap, find
 * or drop), add it to one DoorDash cart, then the same priced preview and Place as the Order tab, with a delivery window.
 */

type Phase = { k: "home" } | { k: "stores" } | { k: "review" } | { k: "preview" } | { k: "placed"; placement: Placement; message: string | null };

const BUSY: Record<string, string> = {
  home: "Reading DoorDash…",
  stores: "Finding grocery stores near you…",
  pick: "Saving the store…",
  build: "Matching the list at the store… this takes a moment.",
  find: "Searching the store…",
  add: "Adding it to the DoorDash cart…",
  preview: "Pricing the order…",
  place: "Placing the order… don't close this.",
};

export default function DoorDashShop({ listCount }: { listCount: number }) {
  return <DoorDashGate intro="Shop the Kitchen list on DoorDash here, from a grocery store you pick.">{(onExpired) => <Groceries onExpired={onExpired} listCount={listCount} />}</DoorDashGate>;
}

function Groceries({ onExpired, listCount }: { onExpired: () => void; listCount: number }) {
  const week = weekKey(useContext(ShopWeek));
  const [phase, setPhase] = useState<Phase>({ k: "home" });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [store, setStore] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [build, setBuild] = useState<GroceryBuild | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ask, setAsk] = useState<number | null>(null);

  const call = useCallback(
    async (body: Record<string, unknown>, label: string): Promise<OrderReply> => {
      setBusy(label);
      setNote(null);
      const r = await orderCall(body);
      setBusy(null);
      if (r.status === 401 && r.error === "unauthorized") useDeskAuth.getState().lost();
      else if (r.error === "expired" || r.error === "signed-out") onExpired();
      return r;
    },
    [onExpired],
  );

  useEffect(() => {
    let live = true;
    void call({ action: "grocery-home", week }, "home").then((r) => {
      if (!live) return;
      if (!r.ok) return setNote(noteOf(r));
      setStore(readStore(r.data.store));
      setOpen(typeof r.data.open === "number" ? r.data.open : null);
    });
    return () => {
      live = false;
    };
  }, [call, week, listCount]);

  const priced = (r: OrderReply) => {
    const p = readPreview(r.data.preview);
    if (p) {
      setPreview(p);
      setPhase({ k: "preview" });
    } else setNote(r.text ?? noteOf(r));
  };

  const runBuild = async () => {
    const r = await call({ action: "grocery-build", week }, "build");
    const b = r.ok ? readGroceryBuild(r.data) : null;
    if (!b) return setNote(r.text ?? noteOf(r));
    setBuild(b);
    if (b.store.id !== store?.id) setStore(b.store);
    setPhase({ k: "review" });
  };

  const add = async (choice?: "use" | "fresh") => {
    if (!build) return;
    setAsk(null);
    const lines = addLinesOf(build.rows);
    const r = await call({ action: "grocery-add", lines, ...(choice && { open: choice }) }, "add");
    if (r.error === "open-cart") return setAsk(Number(r.data.count) || 0);
    const errors = Array.isArray(r.data.errors) ? r.data.errors.filter((e): e is string => typeof e === "string").slice(0, 8) : [];
    if (!r.data.cart) return setNote(errors.length ? `DoorDash turned down: ${errors.map((e) => e.slice(0, 80)).join("; ")}` : noteOf(r));
    if (errors.length) setNote(`Added, except: ${errors.map((e) => e.slice(0, 80)).join("; ")}. Check the price below.`);
    priced(await call({ action: "preview" }, "preview"));
  };

  return (
    <section className="hv-or hv-ddShop" aria-label="Groceries from DoorDash">
      {ask !== null ? (
        <div className="hv-orAsk" role="alertdialog" aria-label="An open cart at this store">
          <p>
            You already have a DoorDash cart at this store ({ask} item{ask === 1 ? "" : "s"}). Add the groceries to it, or start fresh?
          </p>
          <div className="hv-btns">
            <button type="button" className="hv-btn is-pri" disabled={busy !== null} onClick={() => void add("use")}>
              Use that cart
            </button>
            <button type="button" className="hv-btn" disabled={busy !== null} onClick={() => void add("fresh")}>
              Start fresh
            </button>
            <button type="button" className="hv-btn" onClick={() => setAsk(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {note ? (
        <p className="hv-note is-warn" role="status">
          {note}
        </p>
      ) : null}
      {phase.k === "home" ? (
        <div className="hv-ddHome">
          <p className="hv-note">
            {store ? (
              <>
                Store for this week: <b>{store.name}</b>
              </>
            ) : (
              "Pick a DoorDash grocery store first. It's remembered for the week."
            )}
          </p>
          <div className="hv-btns">
            <button type="button" className="hv-btn is-pri" disabled={busy !== null || !store || open === 0} onClick={() => void runBuild()}>
              {open ? `Build the cart from the list (${open})` : "Build the cart from the list"}
            </button>
            <button type="button" className={store ? "hv-btn" : "hv-btn is-pri"} disabled={busy !== null} onClick={() => setPhase({ k: "stores" })}>
              {store ? "Change store" : "Pick a store"}
            </button>
          </div>
          <p className="hv-note">Matches every open item on the Kitchen list at the store, then shows what it couldn&apos;t find to swap or skip. Nothing is bought until you tap Place.</p>
        </div>
      ) : phase.k === "stores" ? (
        <Stores
          call={call}
          busy={busy}
          onNote={setNote}
          onBack={() => setPhase({ k: "home" })}
          onPick={async (s) => {
            const r = await call({ action: "grocery-pick", storeId: s.id, storeName: s.name, week }, "pick");
            if (!r.ok) return setNote(noteOf(r));
            setStore({ id: s.id, name: s.name });
            setBuild(null);
            setPhase({ k: "home" });
          }}
        />
      ) : phase.k === "review" && build ? (
        <Review build={build} call={call} busy={busy} onChange={setBuild} onBack={() => setPhase({ k: "home" })} onAdd={() => void add()} />
      ) : phase.k === "preview" && preview ? (
        <PreviewView
          key={preview.id}
          preview={preview}
          call={call}
          busy={busy}
          onPriced={priced}
          onNote={setNote}
          back="← Review"
          hint={!preview.pickup && !preview.scheduled && preview.windows.length ? "Groceries: pick a delivery window under Schedule, or keep ASAP." : null}
          onPlaced={(placement, message) => setPhase({ k: "placed", placement, message })}
          onBack={() => setPhase(build ? { k: "review" } : { k: "home" })}
        />
      ) : phase.k === "placed" ? (
        <Placed
          placement={phase.placement}
          message={phase.message}
          cartWord="the review"
          onOrders={() => {
            setPhase({ k: "home" });
            setNote("Orders, status and receipts are in the Kitchen's Order tab.");
          }}
          onCart={() => setPhase(build ? { k: "review" } : { k: "home" })}
        />
      ) : (
        <p className="hv-note">Build the cart from the list first.</p>
      )}
      {busy ? (
        <p className="hv-note" role="status" aria-live="polite">
          {BUSY[busy] ?? "Asking DoorDash…"}
        </p>
      ) : null}
    </section>
  );
}

type Call = (body: Record<string, unknown>, label: string) => Promise<OrderReply>;

function Stores({ call, busy, onNote, onBack, onPick }: { call: Call; busy: string | null; onNote: (n: string | null) => void; onBack: () => void; onPick: (s: Store) => void }) {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void call({ action: "grocery-stores" }, "stores").then((r) => {
      if (!live) return;
      if (!r.ok) {
        onNote(noteOf(r));
        setStores([]);
        return;
      }
      setStores(((r.data.stores as unknown[]) ?? []).map(readStore).filter((s): s is Store => s !== null));
      setSaid(r.text);
    });
    return () => {
      live = false;
    };
  }, [call, onNote]);

  return (
    <div className="hv-ddStores">
      <header className="hv-orHead">
        <button type="button" className="hv-btn" onClick={onBack}>
          ← Back
        </button>
        <h4>Grocery stores near you</h4>
      </header>
      {stores === null ? null : stores.length ? (
        <ul className="hv-orStores">
          {stores.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={busy !== null} onClick={() => onPick(s)}>
                {s.image ? <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden="true" />}
                <span>
                  <b>{s.name}</b>
                  <small>{[s.eta, s.rating ? `★ ${s.rating}` : null, s.miles !== null ? `${s.miles} mi` : null].filter(Boolean).join(" · ") || "Pick this store"}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hv-note">{said ?? "No grocery stores came up for your address."}</p>
      )}
    </div>
  );
}

/** The review: matched lines (quantity, drop), out of stock (swap or drop) and not found (find or skip). */
function Review({ build, call, busy, onChange, onBack, onAdd }: { build: GroceryBuild; call: Call; busy: string | null; onChange: (b: GroceryBuild) => void; onBack: () => void; onAdd: () => void }) {
  const set = (key: string, patch: Partial<GroceryRow>) => onChange({ ...build, rows: build.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const out = build.rows.filter((r) => r.out);
  const kept = build.rows.filter((r) => !r.out);
  const lines = addLinesOf(build.rows);
  const about = rowsCents(build.rows);
  const found = (name: string, f: Found) =>
    onChange({
      ...build,
      missing: build.missing.filter((m) => m !== name),
      rows: [...build.rows, { key: `f${build.rows.length}-${f.id}`, id: f.id, name: f.name, forName: name, qty: 1, unit: null, priceCents: f.priceCents, out: false, subs: [], drop: false }],
    });

  return (
    <div className="hv-ddReview">
      <header className="hv-orHead">
        <button type="button" className="hv-btn" onClick={onBack}>
          ← Back
        </button>
        <h4>{build.store.name}</h4>
      </header>
      {out.length ? (
        <>
          <h4 className="hv-orH">Out of stock</h4>
          <ul className="hv-orLines">
            {out.map((r) => (
              <li key={r.key}>
                <span>
                  <b>{r.name}</b>
                  <small>{r.forName ? `for ${r.forName}` : "out of stock"}</small>
                </span>
                <div className="hv-btns">
                  {r.subs.slice(0, 3).map((s) => (
                    <button key={s.id} type="button" className="hv-btn" onClick={() => set(r.key, { id: s.id, name: s.name, priceCents: s.priceCents, out: false, drop: false, subs: [] })}>
                      Swap: {s.name.slice(0, 40)}
                      {s.priceCents !== null ? ` ${money(s.priceCents)}` : ""}
                    </button>
                  ))}
                  {r.subs.length ? null : <small>Left out: no swap offered</small>}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {build.missing.length ? (
        <>
          <h4 className="hv-orH">Couldn&apos;t find</h4>
          <ul className="hv-orLines">
            {build.missing.map((m) => (
              <Missing key={m} name={m} call={call} busy={busy} onFound={(f) => found(m, f)} onSkip={() => onChange({ ...build, missing: build.missing.filter((x) => x !== m) })} />
            ))}
          </ul>
        </>
      ) : null}
      <h4 className="hv-orH">In the cart</h4>
      {kept.length ? (
        <ul className="hv-orLines">
          {kept.map((r) => (
            <li key={r.key} className={r.drop ? "is-dropped" : undefined}>
              <span>
                <b>{r.name}</b>
                <small>
                  {[r.forName && r.forName.toLowerCase() !== r.name.toLowerCase() ? `for ${r.forName}` : null, r.priceCents !== null ? `${money(r.priceCents)}${r.unit ? ` / ${r.unit}` : " each"}` : null].filter(Boolean).join(" · ")}
                </small>
              </span>
              <div className="hv-btns hv-ddQty">
                {r.unit ? (
                  <span>
                    {r.qty} {r.unit}
                  </span>
                ) : (
                  <>
                    <button type="button" className="hv-btn" aria-label={`One fewer ${r.name}`} disabled={r.drop || r.qty <= 1} onClick={() => set(r.key, { qty: Math.max(1, Math.round(r.qty) - 1) })}>
                      −
                    </button>
                    <span>{r.qty}</span>
                    <button type="button" className="hv-btn" aria-label={`One more ${r.name}`} disabled={r.drop || r.qty >= 99} onClick={() => set(r.key, { qty: Math.min(99, Math.round(r.qty) + 1) })}>
                      +
                    </button>
                  </>
                )}
                <button type="button" className="hv-btn" onClick={() => set(r.key, { drop: !r.drop })}>
                  {r.drop ? "Keep" : "Drop"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hv-note">{build.message ?? "Nothing matched yet."}</p>
      )}
      {about !== null && lines.length ? <p className="hv-note">About {money(about)} before fees, tax and tip.</p> : null}
      <div className="hv-btns">
        <button type="button" className="hv-btn is-pri" disabled={busy !== null || !lines.length} onClick={onAdd}>
          {lines.length ? `Add ${lines.length} to the DoorDash cart` : "Nothing to add"}
        </button>
      </div>
      <p className="hv-note">Then the full price, a delivery window and the tip, and one Place button.</p>
    </div>
  );
}

function Missing({ name, call, busy, onFound, onSkip }: { name: string; call: Call; busy: string | null; onFound: (f: Found) => void; onSkip: () => void }) {
  const [q, setQ] = useState(name);
  const [items, setItems] = useState<Found[] | null>(null);
  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    const r = await call({ action: "grocery-find", query: q.trim() }, "find");
    setItems(r.ok ? ((r.data.items as unknown[]) ?? []).map(readFound).filter((f): f is Found => f !== null) : []);
  };
  return (
    <li className="hv-ddMissing">
      <span>
        <b>{name}</b>
      </span>
      <form className="hv-orSearch" onSubmit={(e) => void find(e)} role="search">
        <input type="search" value={q} maxLength={60} aria-label={`Search the store for ${name}`} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="hv-btn" disabled={busy !== null || !q.trim()}>
          Find
        </button>
        <button type="button" className="hv-btn" onClick={onSkip}>
          Skip
        </button>
      </form>
      {items ? (
        items.length ? (
          <ul className="hv-ddFound">
            {items.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => onFound(f)}>
                  {f.image ? <img src={f.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                  <span>{f.name}</span>
                  {f.priceCents !== null ? <small>{money(f.priceCents)}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hv-note">Nothing came up. Try other words, or skip it.</p>
        )
      ) : null}
    </li>
  );
}
