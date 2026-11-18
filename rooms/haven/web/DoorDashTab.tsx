import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { navigateTo, usePathname, useSearch } from "../../../apps/world/src/route.ts";
import { BUSY, DoorDashGate, Placed, PreviewView, type Call } from "./Order.tsx";
import {
  money,
  noteOf,
  orderCall,
  picksOk,
  readCart,
  readDetails,
  readMenu,
  readOrder,
  readPreview,
  readReceipt,
  readStatus,
  readStore,
  STATUS_WORDS,
  type Cart,
  type ChoiceGroup,
  type Item,
  type ItemDetails,
  type Menu,
  type OrderReply,
  type OrderStatus,
  type PastOrder,
  type Placement,
  type Preview,
  type Receipt,
  type Store,
} from "./order.ts";
import {
  ACTIVE_STEPS,
  activeOrderOf,
  cartCents,
  cartCount,
  CUISINES,
  glyphOf,
  initialOf,
  rememberStore,
  slotParam,
  stepOf,
  storeFacts,
  storeParam,
  toneOf,
  withStore,
  withStoreInfo,
  type Slot,
} from "./ddtab.ts";
import "./ddtab.css";

/**
 * The Haven's DoorDash tab (#1195, /haven/doordash): ordering out, its own dashboard apart from the Kitchen's meal prep
 * (Nikita, 2026-11-17). Tonight's search and cuisine chips, the Usuals and Order again with one-tap Reorder, Nearby, a
 * store's page with its photos, the cart, and the same priced preview and Place as before (Order.tsx; the server's
 * rules in api/_haven/doordash/order.ts are unchanged). `?store=<id>` opens a store directly; the meal plan's order-in
 * meals link here with `?slot=sat-dinner&week=<Monday>` (and `store` when one is remembered for that meal), and a
 * store's page then offers to remember it for that meal (the planner's `order-store` edit). Pictures are DoorDash's own (parse.ts takes https on its hosts only), loaded lazily with no
 * referrer; a store or dish without one gets a warm stand-in with its letter. Real data only: nothing here is made up.
 */

type Screen = { k: "home" } | { k: "preview" } | { k: "placed"; placement: Placement; message: string | null } | { k: "orders" };

/** One open cart at DoorDash already: the add (or reorder) waiting on Nikita's choice. */
interface Pending {
  count: number;
  retry: (open: "use" | "fresh") => void;
}

/** The calls that change something: they hold the buttons while they run. Reads run beside each other. */
const WRITES = new Set(["add", "remove", "clear", "promo", "preview", "place", "reorder"]);

export default function DoorDashTab() {
  return (
    <div className="dd">
      <DoorDashGate intro="Order out from DoorDash here." loading={<HomeSkeleton />}>
        {(onExpired) => <Dash onExpired={onExpired} />}
      </DoorDashGate>
    </div>
  );
}

/**
 * A sheet or the cart drawer, laid over the whole page (on a phone, over its bottom bar too): rendered at the body's end,
 * still inside the Haven's styles, so the room's open sheet doesn't clip it.
 */
function Layer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(
    <div data-room="haven" className="dd-layer">
      <div className="dd">{children}</div>
    </div>,
    document.body,
  );
}

/* ── Pictures ── */

/** A store's or a dish's picture, or a warm stand-in with its letter (or its cuisine's glyph) when there's none. */
function Art({ src, name, hint, className }: { src: string | null; name: string; hint?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) return <img className={`dd-art ${className ?? ""}`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  const glyph = glyphOf(name, hint);
  return (
    <span className={`dd-art dd-ph is-t${toneOf(name)} ${className ?? ""}`} aria-hidden="true">
      <b>{glyph ?? initialOf(name)}</b>
    </span>
  );
}

function Skel({ className }: { className: string }) {
  return <span className={`dd-skel ${className}`} aria-hidden="true" />;
}

function HomeSkeleton() {
  return (
    <div className="dd-home" aria-busy="true" aria-label="Loading DoorDash">
      <div className="dd-hero">
        <Skel className="is-line is-short" />
        <Skel className="is-title" />
        <Skel className="is-input" />
      </div>
      <CardsSkeleton n={3} rail />
      <CardsSkeleton n={6} />
    </div>
  );
}

function CardsSkeleton({ n, rail }: { n: number; rail?: boolean }) {
  return (
    <ul className={rail ? "dd-rail" : "dd-grid"} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className={rail ? "dd-usual is-skel" : "dd-store is-skel"}>
          <Skel className="is-photo" />
          <Skel className="is-line" />
          <Skel className="is-line is-short" />
        </li>
      ))}
    </ul>
  );
}

/* ── The dashboard ── */

function Dash({ onExpired }: { onExpired: () => void }) {
  const pathname = usePathname();
  const search = useSearch();
  const storeId = storeParam(search);
  const slot = slotParam(search);
  const [screen, setScreen] = useState<Screen>({ k: "home" });
  const [cart, setCart] = useState<Cart | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [drawer, setDrawer] = useState(false);
  // What the home read gave: the Usuals, the last orders, the address's label, and orders placed in the last hours.
  const [usuals, setUsuals] = useState<PastOrder[] | null>(null);
  const [recent, setRecent] = useState<PastOrder[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [placedId, setPlacedId] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Store[] | null>(null);
  const [nearbyNote, setNearbyNote] = useState<string | null>(null);
  const [results, setResults] = useState<{
    query: string;
    stores: Store[] | null;
    said: string | null;
  } | null>(null);
  // A store opened from a card: its name and picture show at once, before its menu is read.
  const [hint, setHint] = useState<Store | null>(null);

  const call: Call = useCallback(
    async (body, label) => {
      const write = WRITES.has(label);
      if (write) {
        setBusy(label);
        setNote(null);
      }
      const r = await orderCall(body);
      if (write) setBusy(null);
      if (r.status === 401 && r.error === "unauthorized") useDeskAuth.getState().lost();
      else if (r.error === "expired" || r.error === "signed-out") onExpired();
      return r;
    },
    [onExpired],
  );

  useEffect(() => {
    let live = true;
    void call({ action: "home" }, "home").then((r) => {
      if (!live) return;
      if (!r.ok) {
        setNote(noteOf(r));
        setUsuals([]);
        return;
      }
      const list = (v: unknown) => (Array.isArray(v) ? v : []).map(readOrder).filter((o): o is PastOrder => o !== null);
      setUsuals(list(r.data.usuals));
      setRecent(list(r.data.recent));
      setActiveIds((Array.isArray(r.data.active) ? r.data.active : []).filter((x): x is string => typeof x === "string" && /^[0-9a-fA-F-]{8,64}$/.test(x)).slice(0, 3));
      const a = r.data.address as { label?: unknown } | null;
      setAddress(a ? (typeof a.label === "string" ? a.label.slice(0, 30) : "your default address") : null);
      setCart(readCart(r.data.cart));
    });
    void call({ action: "nearby" }, "nearby").then((r) => {
      if (!live) return;
      const stores = r.ok ? (Array.isArray(r.data.stores) ? r.data.stores : []).map(readStore).filter((s): s is Store => s !== null) : [];
      setNearby(stores);
      if (!r.ok) setNearbyNote(noteOf(r));
      else if (!stores.length) setNearbyNote(r.text ?? "DoorDash didn't list any places nearby just now.");
    });
    return () => {
      live = false;
    };
  }, [call]);

  // Everything a store list has read, by id: the Usuals and a store's page borrow its picture, rating and fee.
  const known = useMemo(() => {
    const m = new Map<string, Store>();
    for (const s of [...(nearby ?? []), ...(results?.stores ?? [])]) if (!m.has(s.id)) m.set(s.id, s);
    if (hint && !m.has(hint.id)) m.set(hint.id, hint);
    return m;
  }, [nearby, results, hint]);

  const runSearch = async (query: string) => {
    const q = query.trim().slice(0, 60);
    if (!q) return;
    setResults({ query: q, stores: null, said: null });
    const r = await call({ action: "search", query: q }, "search");
    if (!r.ok) {
      setResults(null);
      setNote(noteOf(r));
      return;
    }
    setResults({
      query: q,
      stores: (Array.isArray(r.data.stores) ? r.data.stores : []).map(readStore).filter((s): s is Store => s !== null),
      said: r.text,
    });
  };

  const openStore = (s: Store | { id: string; name: string; image?: string | null }) => {
    setHint(
      "rating" in s
        ? s
        : {
            id: s.id,
            name: s.name,
            eta: null,
            image: s.image ?? null,
            pickup: null,
            miles: null,
            rating: null,
            logo: null,
            fee: null,
            cuisine: null,
          },
    );
    setScreen({ k: "home" });
    navigateTo(withStore(pathname, search, s.id));
  };
  const closeStore = () => navigateTo(withStore(pathname, search, null));

  const priced = (r: OrderReply) => {
    const p = readPreview(r.data.preview);
    if (p) {
      setPreview(p);
      setDrawer(false);
      setScreen({ k: "preview" });
    } else setNote(r.text ?? noteOf(r));
  };

  const reorder = async (o: PastOrder, open?: "use" | "fresh") => {
    setPending(null);
    const r = await call({ action: "reorder", orderId: o.id, ...(open && { open }) }, "reorder");
    if (r.error === "open-cart") {
      setPending({
        count: Number(r.data.count) || 0,
        retry: (choice) => void reorder(o, choice),
      });
      return;
    }
    if (!r.ok && !r.data.preview) {
      setNote(noteOf(r));
      return;
    }
    priced(r);
  };

  const count = cartCount(cart);
  const subtotal = cartCents(cart);
  const activeId = placedId ?? activeOrderOf(activeIds, recent, Date.now());
  const inStore = screen.k === "home" && storeId !== null;

  return (
    <section className="dd-dash" aria-label="Order from DoorDash">
      <nav className="dd-bar" aria-label="DoorDash">
        <button type="button" aria-pressed={screen.k === "home" && !inStore} onClick={() => (setScreen({ k: "home" }), closeStore())}>
          Tonight
        </button>
        <button type="button" aria-pressed={screen.k === "orders"} onClick={() => setScreen({ k: "orders" })}>
          Orders
        </button>
        <button type="button" className="dd-barCart" aria-pressed={drawer} onClick={() => setDrawer(true)}>
          Cart{count ? <i>{count}</i> : null}
        </button>
      </nav>
      {activeId && screen.k !== "placed" ? <ActiveOrder key={activeId} orderId={activeId} /> : null}
      {slot && screen.k === "home" ? (
        <p className="dd-slot" role="status">
          <span aria-hidden="true">🍽</span> Ordering for {slot.words}
        </p>
      ) : null}
      {pending ? (
        <div className="dd-ask" role="alertdialog" aria-label="An open cart at this store">
          <p>
            You already have a DoorDash cart at this store ({pending.count} item
            {pending.count === 1 ? "" : "s"}). Add to it, or start fresh?
          </p>
          <div className="hv-btns">
            <button type="button" className="hv-btn is-pri" disabled={busy !== null} onClick={() => pending.retry("use")}>
              Use that cart
            </button>
            <button type="button" className="hv-btn" disabled={busy !== null} onClick={() => pending.retry("fresh")}>
              Start fresh
            </button>
            <button type="button" className="hv-btn" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {note ? (
        <p className="hv-note is-warn dd-note" role="status">
          {note}
        </p>
      ) : null}

      {screen.k === "preview" && preview ? (
        <div className="dd-panel hv-or">
          <PreviewView
            key={preview.id}
            preview={preview}
            call={call}
            busy={busy}
            onPriced={priced}
            onNote={setNote}
            onPlaced={(placement, message) => {
              if (placement.status === "placed") {
                setCart(null);
                if (placement.orderId) setPlacedId(placement.orderId);
              }
              setScreen({ k: "placed", placement, message });
            }}
            onBack={() => (setScreen({ k: "home" }), setDrawer(true))}
          />
        </div>
      ) : screen.k === "placed" ? (
        <div className="dd-panel hv-or">
          <Placed placement={screen.placement} message={screen.message} onOrders={() => setScreen({ k: "orders" })} onCart={() => (setScreen({ k: "home" }), setDrawer(true))} />
        </div>
      ) : screen.k === "orders" ? (
        <Orders call={call} busy={busy} onReorder={(o) => void reorder(o)} onNote={setNote} />
      ) : inStore ? (
        <StorePage
          key={storeId}
          storeId={storeId}
          hint={hint?.id === storeId ? hint : null}
          info={known.get(storeId) ?? null}
          slot={slot}
          call={call}
          busy={busy}
          onNote={setNote}
          onPending={setPending}
          onCart={setCart}
          onBack={closeStore}
        />
      ) : (
        <Home
          address={address}
          usuals={usuals}
          recent={recent}
          nearby={nearby}
          nearbyNote={nearbyNote}
          results={results}
          known={known}
          busy={busy}
          onSearch={(q) => void runSearch(q)}
          onClear={() => setResults(null)}
          onStore={openStore}
          onReorder={(o) => void reorder(o)}
        />
      )}

      {count && !drawer && (screen.k === "home" || screen.k === "orders") ? (
        <button type="button" className="dd-cartBar" onClick={() => setDrawer(true)}>
          <span>
            <b>View cart</b>
            <small>
              {count} item{count === 1 ? "" : "s"}
              {cart?.storeName ? ` · ${cart.storeName}` : ""}
            </small>
          </span>
          <em>{subtotal !== null ? money(subtotal) : "Review"}</em>
        </button>
      ) : null}
      {drawer ? (
        <CartDrawer
          cart={cart}
          call={call}
          busy={busy}
          onCart={setCart}
          onNote={setNote}
          onPriced={priced}
          onClose={() => setDrawer(false)}
          onOrders={() => (setDrawer(false), setScreen({ k: "orders" }))}
        />
      ) : null}
      {busy ? (
        <p className="dd-busy" role="status" aria-live="polite">
          <i aria-hidden="true" />
          {BUSY[busy] ?? "Asking DoorDash…"}
        </p>
      ) : null}
    </section>
  );
}

/* ── The Active order strip ── */

function ActiveOrder({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  useEffect(() => {
    let live = true;
    let tries = 0;
    let timer: number | undefined;
    const read = () =>
      void orderCall({ action: "status", orderId }).then((r) => {
        if (!live) return;
        const s = readStatus(r.data.status);
        if (s) setStatus(s);
        tries++;
        // Every 15 s while it's processing, then every minute, for half an hour at most, and only while on screen.
        if (r.ok && !s?.final && tries < 40) timer = window.setTimeout(read, s && s.status !== "pending" ? 60_000 : 15_000);
      });
    read();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [orderId]);

  if (!status || status.status === "completed" || status.status === "cancelled" || status.status === "not_found") return null;
  const step = stepOf(status.status);
  const warn = step < 0;
  return (
    <section className={`dd-active${warn ? " is-warn" : ""}`} aria-label="Active order" aria-live="polite">
      <span className="dd-activeDot" aria-hidden="true" />
      <div className="dd-activeText">
        <small>Active order</small>
        <b>{STATUS_WORDS[status.status]}</b>
        {status.eta ? <span>{status.eta}</span> : null}
      </div>
      {!warn ? (
        <ol className="dd-steps" aria-label={`Step ${step + 1} of ${ACTIVE_STEPS.length}`}>
          {ACTIVE_STEPS.map((s, i) => (
            <li key={s} className={i < step ? "is-done" : i === step ? "is-now" : undefined}>
              {s}
            </li>
          ))}
        </ol>
      ) : null}
      {status.link ? (
        <a className="dd-activeLink" href={status.link} target="_blank" rel="noopener noreferrer">
          Track in DoorDash
        </a>
      ) : null}
    </section>
  );
}

/* ── Tonight: the hero, the Usuals, Order again, Nearby ── */

function Home({
  address,
  usuals,
  recent,
  nearby,
  nearbyNote,
  results,
  known,
  busy,
  onSearch,
  onClear,
  onStore,
  onReorder,
}: {
  address: string | null;
  usuals: PastOrder[] | null;
  recent: PastOrder[];
  nearby: Store[] | null;
  nearbyNote: string | null;
  results: {
    query: string;
    stores: Store[] | null;
    said: string | null;
  } | null;
  known: ReadonlyMap<string, Store>;
  busy: string | null;
  onSearch: (q: string) => void;
  onClear: () => void;
  onStore: (s: Store | { id: string; name: string; image?: string | null }) => void;
  onReorder: (o: PastOrder) => void;
}) {
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(q);
  };
  // Order again: the last orders that aren't already a Usual's card.
  const again = useMemo(() => {
    const shown = new Set((usuals ?? []).map((u) => u.id));
    return recent.filter((o) => !shown.has(o.id) && o.reorderable);
  }, [usuals, recent]);
  const hour = new Date().getHours();
  const when = hour >= 5 && hour < 11 ? "This morning" : hour >= 11 && hour < 16 ? "This afternoon" : "Tonight";

  return (
    <div className="dd-home">
      <header className="dd-hero">
        <p className="dd-eyb">
          <span>{when}</span>
          {address ? <span>Delivering to {address}</span> : null}
        </p>
        <h3 className="dd-h">What sounds good?</h3>
        <form className="dd-search" role="search" onSubmit={submit}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input type="search" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} placeholder="Ramen, tacos, a place's name" aria-label="Search DoorDash" enterKeyHint="search" />
          <button type="submit" disabled={!q.trim()}>
            Search
          </button>
        </form>
        <div className="dd-chips" role="group" aria-label="Cuisines">
          {CUISINES.map((c) => (
            <button
              key={c.query}
              type="button"
              aria-pressed={results?.query === c.query}
              onClick={() => {
                setQ(c.label);
                onSearch(c.query);
              }}
            >
              <span aria-hidden="true">{c.glyph}</span>
              {c.label}
            </button>
          ))}
        </div>
      </header>

      {results ? (
        <section className="dd-sec" aria-label={`Results for ${results.query}`}>
          <header className="dd-secHead">
            <h4>Results for &ldquo;{results.query}&rdquo;</h4>
            <button type="button" className="dd-text" onClick={onClear}>
              Clear
            </button>
          </header>
          {results.stores === null ? (
            <CardsSkeleton n={6} />
          ) : results.stores.length ? (
            <StoreGrid stores={results.stores} onStore={onStore} />
          ) : (
            <p className="hv-note">{results.said ?? "Nothing came up. Try another word, or the place's name."}</p>
          )}
        </section>
      ) : null}

      <section className="dd-sec" aria-label="Your usuals">
        <header className="dd-secHead">
          <h4>Your usuals</h4>
          {usuals?.length ? <small>The places you order from most</small> : null}
        </header>
        {usuals === null ? (
          <CardsSkeleton n={3} rail />
        ) : usuals.length ? (
          <ul className="dd-rail">
            {usuals.map((o) => (
              <UsualCard key={o.id} o={o} known={known} busy={busy} onReorder={onReorder} onStore={onStore} />
            ))}
          </ul>
        ) : (
          <p className="hv-note">No past orders to repeat yet. The places you order from will show up here.</p>
        )}
      </section>

      {again.length ? (
        <section className="dd-sec" aria-label="Order again">
          <header className="dd-secHead">
            <h4>Order again</h4>
            <small>Your last orders</small>
          </header>
          <ul className="dd-rail">
            {again.map((o) => (
              <UsualCard key={o.id} o={o} known={known} busy={busy} onReorder={onReorder} onStore={onStore} dated />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="dd-sec" aria-label="Nearby">
        <header className="dd-secHead">
          <h4>Nearby</h4>
        </header>
        {nearby === null ? <CardsSkeleton n={6} /> : nearby.length ? <StoreGrid stores={nearby} onStore={onStore} /> : <p className="hv-note">{nearbyNote ?? "Nothing nearby just now."}</p>}
      </section>
    </div>
  );
}

function UsualCard({
  o,
  known,
  busy,
  onReorder,
  onStore,
  dated,
}: {
  o: PastOrder;
  known: ReadonlyMap<string, Store>;
  busy: string | null;
  onReorder: (o: PastOrder) => void;
  onStore: (s: { id: string; name: string; image?: string | null }) => void;
  dated?: boolean;
}) {
  const info = withStoreInfo(o, known);
  const items = `${o.items.slice(0, 3).join(", ") || "Your last order"}${o.items.length > 3 ? ` +${o.items.length - 3}` : ""}`;
  const meta = dated
    ? [
        o.when
          ? new Date(o.when).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          : null,
        o.totalCents !== null ? money(o.totalCents) : null,
        o.pickup ? "pick-up" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : info.facts.join(" · ");
  return (
    <li className="dd-usual">
      <div className="dd-usualPic">
        <Art src={info.image} name={o.store} hint={info.cuisine ?? o.items.join(" ")} />
        {!dated && o.times && o.times > 1 ? <span className="dd-badge">{o.times} orders</span> : null}
      </div>
      <div className="dd-usualBody">
        <b className="dd-name">{o.store}</b>
        {meta ? <small className="dd-facts">{meta}</small> : null}
        <p className="dd-items">{items}</p>
        <div className="dd-usualBtns">
          <button type="button" className="dd-btn is-pri" disabled={busy !== null || !o.reorderable} onClick={() => onReorder(o)}>
            Reorder
          </button>
          {o.storeId ? (
            <button type="button" className="dd-btn" onClick={() => onStore({ id: o.storeId!, name: o.store, image: info.image })}>
              Menu
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function StoreGrid({ stores, onStore }: { stores: Store[]; onStore: (s: Store) => void }) {
  return (
    <ul className="dd-grid">
      {stores.map((s) => (
        <li key={s.id} className="dd-store">
          <button type="button" onClick={() => onStore(s)}>
            <span className="dd-storePic">
              <Art src={s.image ?? s.logo} name={s.name} hint={s.cuisine} />
              {s.logo && s.image ? <img className="dd-logo" src={s.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
            </span>
            <b className="dd-name">{s.name}</b>
            <small className="dd-facts">{storeFacts(s).join(" · ") || s.cuisine || "Open the menu"}</small>
            {s.cuisine && storeFacts(s).length ? <small className="dd-cuisine">{s.cuisine}</small> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ── A store's page ── */

function StorePage({
  storeId,
  hint,
  info,
  slot,
  call,
  busy,
  onNote,
  onPending,
  onCart,
  onBack,
}: {
  storeId: string;
  hint: Store | null;
  info: Store | null;
  slot: Slot | null;
  call: Call;
  busy: string | null;
  onNote: (n: string | null) => void;
  onPending: (p: Pending | null) => void;
  onCart: (c: Cart | null) => void;
  onBack: () => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<{
    item: Item;
    details: ItemDetails | null;
  } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const secRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    let live = true;
    void call({ action: "menu", storeId }, "menu").then((r) => {
      if (!live) return;
      if (!r.ok) {
        setFailed(noteOf(r));
        return;
      }
      const m = readMenu(r.data.menu);
      setMenu(m);
      if (!m) setFailed(r.text ?? "This menu couldn't be read.");
    });
    return () => {
      live = false;
    };
  }, [call, storeId]);

  const add = async (item: Item, qty: number, options: { id: string; name: string }[], openCart?: "use" | "fresh") => {
    if (!menu) return;
    onPending(null);
    const r = await call(
      {
        action: "add",
        storeId,
        menuId: menu.menuId,
        storeName: menu.storeName ?? name,
        item: { id: item.id, name: item.name, qty, options },
        ...(openCart && { open: openCart }),
      },
      "add",
    );
    if (r.error === "open-cart") {
      onPending({
        count: Number(r.data.count) || 0,
        retry: (choice) => void add(item, qty, options, choice),
      });
      return;
    }
    if ("cart" in r.data) onCart(readCart(r.data.cart));
    const errors = Array.isArray(r.data.errors) ? (r.data.errors as { name?: unknown; why?: unknown }[]) : [];
    if (errors.length) onNote(errors.map((e) => `${String(e.name ?? "An item").slice(0, 60)}: ${String(e.why ?? "couldn't be added").slice(0, 120)}`).join(". "));
    else if (!r.ok) onNote(noteOf(r));
    else {
      setOpen(null);
      setAdded(item.name);
    }
  };

  // Quick add: one tap on +. A dish with a required choice opens its sheet instead; one without goes straight in.
  const quick = async (item: Item) => {
    setAdding(item.id);
    const r = await call({ action: "item", storeId, menuId: menu?.menuId, itemId: item.id }, "item");
    setAdding(null);
    const d = r.ok ? readDetails(r.data.item) : null;
    if (d && !d.groups.some((g) => g.min > 0)) return void add(item, 1, []);
    setOpen({ item, details: d });
  };

  const name = menu?.storeName ?? info?.name ?? hint?.name ?? "";
  const cover = menu?.image ?? info?.image ?? hint?.image ?? null;
  const logo = menu?.logo ?? info?.logo ?? null;
  const facts = info ? storeFacts(info) : [];
  return (
    <div className="dd-storePage">
      <header className="dd-cover">
        {cover ? <Art src={cover} name={name || "DoorDash"} className="dd-coverPic" /> : <span className={`dd-coverPic dd-ph is-t${toneOf(name || "DoorDash")}`} aria-hidden="true" />}
        <button type="button" className="dd-back" onClick={onBack}>
          <span aria-hidden="true">‹</span> Tonight
        </button>
        <div className="dd-coverText">
          {logo ? <img className="dd-coverLogo" src={logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
          <div>
            {name ? <h3 className="dd-h">{name}</h3> : <Skel className="is-title" />}
            {facts.length || info?.cuisine ? <p className="dd-facts">{[info?.cuisine, ...facts].filter(Boolean).join(" · ")}</p> : null}
          </div>
        </div>
      </header>
      {slot && name ? <Remember slot={slot} store={{ id: storeId, name }} /> : null}
      {added ? (
        <p className="hv-note is-ok dd-note" role="status">
          Added {added} to the cart.
        </p>
      ) : null}
      {menu?.nextOpen ? (
        <p className="hv-note dd-note">
          Closed now; opens{" "}
          {new Date(menu.nextOpen).toLocaleString("en-US", {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
          . You can still schedule.
        </p>
      ) : null}
      {menu?.deals.length ? (
        <ul className="dd-deals" aria-label="Deals">
          {menu.deals.map((d, i) => (
            <li key={`${d.title}-${i}`}>
              {d.title}
              {d.code ? <code>{d.code}</code> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? <p className="hv-note hv-orText dd-note">{failed}</p> : null}
      {!menu && !failed ? (
        <ul className="dd-menu" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="dd-dish is-skel">
              <span className="dd-dishText">
                <Skel className="is-line" />
                <Skel className="is-line is-short" />
              </span>
              <Skel className="is-thumb" />
            </li>
          ))}
        </ul>
      ) : null}
      {menu ? (
        <>
          <nav className="dd-secs" aria-label="Menu sections">
            {menu.sections.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onClick={() =>
                  secRefs.current[i]?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                {s.name}
              </button>
            ))}
          </nav>
          {menu.sections.map((s, i) => (
            <section key={s.name} className="dd-menuSec" ref={(el) => void (secRefs.current[i] = el)} aria-label={s.name}>
              <h4>{s.name}</h4>
              <ul className="dd-menu">
                {s.items.map((it) => (
                  <li key={it.id} className={`dd-dish${it.orderable === "no" ? " is-off" : ""}`}>
                    <button type="button" className="dd-dishMain" disabled={it.orderable === "no"} onClick={() => setOpen({ item: it, details: null })}>
                      <span className="dd-dishText">
                        <b>{it.name}</b>
                        {it.desc ? <small>{it.desc}</small> : null}
                        <em>
                          {it.priceCents !== null ? money(it.priceCents) : ""}
                          {it.orderable === "no" ? " · unavailable" : it.orderable === "later" ? " · schedule ahead" : ""}
                        </em>
                      </span>
                      {it.image ? <Art src={it.image} name={it.name} className="dd-thumb" /> : null}
                    </button>
                    {it.orderable !== "no" ? (
                      <button type="button" className={`dd-plus${it.image ? "" : " is-bare"}`} aria-label={`Add ${it.name}`} disabled={busy !== null || adding !== null} onClick={() => void quick(it)}>
                        {adding === it.id ? "…" : "+"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : null}
      {open && menu ? (
        <ItemSheet
          item={open.item}
          preload={open.details}
          store={storeId}
          menuId={menu.menuId}
          call={call}
          busy={busy}
          onClose={() => setOpen(null)}
          onAdd={(qty, options) => void add(open.item, qty, options)}
        />
      ) : null}
    </div>
  );
}

/** "Remember for Saturday dinners": this store for that meal in the meal plan, so its Order opens here next time. */
function Remember({ slot, store }: { slot: Slot; store: { id: string; name: string } }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const meals = `${slot.words}s`;
  const save = async (s: { id: string; name: string } | null) => {
    setState("saving");
    const ok = await rememberStore(slot, s);
    setState(ok ? (s ? "saved" : "idle") : "failed");
  };
  return (
    <div className="dd-remember">
      {state === "saved" ? (
        <>
          <span>Remembered for {meals}.</span>
          <button type="button" className="dd-text" onClick={() => void save(null)}>
            Forget
          </button>
        </>
      ) : (
        <>
          <button type="button" className="dd-btn" disabled={state === "saving"} onClick={() => void save(store)}>
            {state === "saving" ? "Saving…" : `Remember for ${meals}`}
          </button>
          {state === "failed" ? <span className="dd-muted">The meal plan couldn&apos;t keep it just now.</span> : null}
        </>
      )}
    </div>
  );
}

function ItemSheet({
  item,
  preload,
  store,
  menuId,
  call,
  busy,
  onClose,
  onAdd,
}: {
  item: Item;
  preload: ItemDetails | null;
  store: string;
  menuId: string;
  call: Call;
  busy: string | null;
  onClose: () => void;
  onAdd: (qty: number, options: { id: string; name: string }[]) => void;
}) {
  const [details, setDetails] = useState<ItemDetails | null>(preload);
  const [said, setSaid] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [picks, setPicks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (preload) return;
    let live = true;
    void call({ action: "item", storeId: store, menuId, itemId: item.id }, "item").then((r) => {
      if (!live) return;
      const d = r.ok ? readDetails(r.data.item) : null;
      setDetails(d);
      if (!d) setSaid(r.text ?? (r.ok ? "DoorDash sent no choices for this; it can still be added." : noteOf(r)));
    });
    return () => {
      live = false;
    };
  }, [call, item.id, menuId, store, preload]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  const groups = details?.groups ?? [];
  const toggle = (g: ChoiceGroup, id: string) =>
    setPicks((p) => {
      const had = p[g.id] ?? [];
      if (had.includes(id)) return { ...p, [g.id]: had.filter((x) => x !== id) };
      if (g.max === 1) return { ...p, [g.id]: [id] };
      return had.length >= g.max ? p : { ...p, [g.id]: [...had, id] };
    });
  const chosen = groups.flatMap((g) => g.options.filter((o) => picks[g.id]?.includes(o.id)));
  const each = (details?.priceCents ?? item.priceCents ?? 0) + chosen.reduce((s, o) => s + (o.priceCents ?? 0), 0);
  const ok = picksOk(groups, picks);
  const image = details?.image ?? item.image;
  return (
    <Layer>
      <div className="dd-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="dd-sheet" role="dialog" aria-modal="true" aria-label={item.name}>
          {image ? <Art src={image} name={item.name} className="dd-sheetPic" /> : null}
          <div className="dd-sheetIn">
            <header className="dd-sheetHead">
              <h4>{item.name}</h4>
              <button type="button" className="dd-x" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </header>
            {(details?.desc ?? item.desc) ? <p className="hv-note">{details?.desc ?? item.desc}</p> : null}
            {item.priceCents !== null ? <p className="dd-price">{money(item.priceCents)}</p> : null}
            {!details && !said ? <Skel className="is-line" /> : null}
            {said ? <p className="hv-note hv-orText">{said}</p> : null}
            {groups.map((g) => (
              <fieldset key={g.id} className="dd-group">
                <legend>
                  {g.name} <small>{g.min ? (g.min === g.max ? `Pick ${g.min}` : `Pick ${g.min} to ${g.max}`) : g.max === 1 ? "Optional" : `Optional, up to ${g.max}`}</small>
                </legend>
                {g.options.map((o) => (
                  <label key={o.id}>
                    <input type={g.max === 1 ? "radio" : "checkbox"} name={`g-${g.id}`} checked={picks[g.id]?.includes(o.id) ?? false} onChange={() => toggle(g, o.id)} />
                    <span>{o.name}</span>
                    {o.priceCents ? <em>+{money(o.priceCents)}</em> : null}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <footer className="dd-sheetFoot">
            <div className="dd-qty">
              <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))}>
                −
              </button>
              <b aria-live="polite">{qty}</b>
              <button type="button" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))}>
                +
              </button>
            </div>
            <button
              type="button"
              className="dd-btn is-pri is-big"
              disabled={busy !== null || !ok || (!details && !said)}
              onClick={() =>
                onAdd(
                  qty,
                  chosen.map((o) => ({ id: o.id, name: o.name })),
                )
              }
            >
              {ok ? `Add to cart${each ? ` · ${money(each * qty)}` : ""}` : "Pick the required choices"}
            </button>
          </footer>
        </div>
      </div>
    </Layer>
  );
}

/* ── The cart drawer ── */

function CartDrawer({
  cart,
  call,
  busy,
  onCart,
  onNote,
  onPriced,
  onClose,
  onOrders,
}: {
  cart: Cart | null;
  call: Call;
  busy: string | null;
  onCart: (c: Cart | null) => void;
  onNote: (n: string | null) => void;
  onPriced: (r: OrderReply) => void;
  onClose: () => void;
  onOrders: () => void;
}) {
  const [code, setCode] = useState("");
  const [promoSaid, setPromoSaid] = useState<string | null>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    let live = true;
    void call({ action: "cart" }, "cart").then((r) => {
      if (!live) return;
      setRead(true);
      if (r.ok) onCart(readCart(r.data.cart));
      else onNote(noteOf(r));
    });
    return () => {
      live = false;
    };
  }, [call, onCart, onNote]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  const act = async (body: Record<string, unknown>, label: string) => {
    const r = await call(body, label);
    if ("cart" in r.data) onCart(readCart(r.data.cart));
    if (!r.ok) onNote(noteOf(r));
    return r;
  };
  const promo = async (e: FormEvent) => {
    e.preventDefault();
    const r = await call({ action: "promo", code: code.trim() }, "promo");
    const off = typeof r.data.discountCents === "number" ? r.data.discountCents : null;
    setPromoSaid(r.ok ? `Applied${off ? `: ${money(off)} off` : ""}. It shows in the price on the next step.` : (r.message ?? noteOf(r)));
  };

  const lines = cart?.lines ?? [];
  const subtotal = cartCents(cart);
  let body: ReactNode;
  if (!lines.length)
    body = (
      <div className="dd-cartEmpty">
        <span className="dd-ph is-t0" aria-hidden="true">
          <b>🛍</b>
        </span>
        <p className="hv-note">
          {!read && !cart
            ? "Reading the cart…"
            : cart?.maybeSpent
              ? "The last order on this cart may have gone through. Check Orders before anything else."
              : "Your cart is empty. Find something good."}
        </p>
        <div className="hv-btns">
          {cart?.maybeSpent ? (
            <button type="button" className="dd-btn is-pri" onClick={onOrders}>
              Check Orders
            </button>
          ) : (
            <button type="button" className="dd-btn is-pri" onClick={onClose}>
              Find something
            </button>
          )}
          {cart ? (
            <button type="button" className="dd-btn" disabled={busy !== null} onClick={() => void act({ action: "clear" }, "clear")}>
              Start over
            </button>
          ) : null}
        </div>
      </div>
    );
  else
    body = (
      <>
        {cart?.maybeSpent ? <p className="hv-note is-warn">The last order on this cart may have gone through. Check Orders, then Start over: it won&apos;t be placed again from here.</p> : null}
        <ul className="dd-lines">
          {lines.map((l, i) => (
            <li key={l.id ?? `${l.name}-${i}`}>
              <span className="dd-lineQty">
                {l.qty}
                {l.unit ? ` ${l.unit}` : "×"}
              </span>
              <span className="dd-lineName">
                <b>{l.name}</b>
                {l.priceCents !== null ? (
                  <small>
                    {money(l.priceCents)}
                    {l.unit ? ` / ${l.unit}` : " each"}
                  </small>
                ) : null}
              </span>
              {l.id ? (
                <button type="button" className="dd-text" disabled={busy !== null || cart?.maybeSpent} onClick={() => void act({ action: "remove", lineId: l.id }, "remove")}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <form className="dd-promo" onSubmit={(e) => void promo(e)}>
          <input
            type="text"
            value={code}
            maxLength={30}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Promo code"
            placeholder="Promo code"
            onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
          />
          <button type="submit" className="dd-btn" disabled={busy !== null || code.trim().length < 2 || cart?.maybeSpent}>
            Apply
          </button>
        </form>
        {promoSaid ? <p className="hv-note">{promoSaid}</p> : null}
        <p className="hv-note">To change a quantity, remove the line and add it again. Delivery or pick-up, when, and the tip come on the next step, with the full price.</p>
      </>
    );

  return (
    <Layer>
      <div className="dd-scrim is-side" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <aside className="dd-drawer" role="dialog" aria-modal="true" aria-label="Your cart">
          <header className="dd-sheetHead">
            <div>
              <small className="dd-eybS">Your cart</small>
              <h4>{cart?.storeName ?? "DoorDash"}</h4>
            </div>
            <button type="button" className="dd-x" aria-label="Close the cart" onClick={onClose}>
              ×
            </button>
          </header>
          <div className="dd-drawerBody">{body}</div>
          {lines.length ? (
            <footer className="dd-sheetFoot is-stack">
              <p className="dd-total">
                <span>Subtotal</span>
                <b>{subtotal !== null ? money(subtotal) : "On the next step"}</b>
              </p>
              <button type="button" className="dd-btn is-pri is-big" disabled={busy !== null || cart?.maybeSpent} onClick={() => void call({ action: "preview" }, "preview").then(onPriced)}>
                Review order
              </button>
              <button type="button" className="dd-text" disabled={busy !== null} onClick={() => void act({ action: "clear" }, "clear")}>
                Start over
              </button>
            </footer>
          ) : null}
        </aside>
      </div>
    </Layer>
  );
}

/* ── Orders ── */

function Orders({ call, busy, onReorder, onNote }: { call: Call; busy: string | null; onReorder: (o: PastOrder) => void; onNote: (n: string | null) => void }) {
  const [orders, setOrders] = useState<PastOrder[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    status?: OrderStatus | null;
    receipt?: Receipt | null;
    text?: string | null;
  }>({});

  useEffect(() => {
    let live = true;
    void call({ action: "orders" }, "orders").then((r) => {
      if (!live) return;
      if (!r.ok) {
        onNote(noteOf(r));
        setOrders([]);
        return;
      }
      setOrders((Array.isArray(r.data.orders) ? r.data.orders : []).map(readOrder).filter((o): o is PastOrder => o !== null));
    });
    return () => {
      live = false;
    };
  }, [call, onNote]);

  const expand = async (o: PastOrder) => {
    if (open === o.id) return setOpen(null);
    setOpen(o.id);
    setDetail({});
    const recent = o.when ? Date.now() - Date.parse(o.when) < 6 * 3600_000 : false;
    if (recent) {
      const r = await call({ action: "status", orderId: o.id }, "status");
      setDetail((d) => ({ ...d, status: readStatus(r.data.status) }));
    }
  };
  const receipt = async (o: PastOrder) => {
    const r = await call({ action: "receipt", orderId: o.id }, "receipt");
    setDetail((d) => ({
      ...d,
      receipt: readReceipt(r.data.receipt),
      text: r.text ?? (r.ok ? null : noteOf(r)),
    }));
  };

  return (
    <section className="dd-sec dd-orders" aria-label="Your orders">
      <header className="dd-secHead">
        <h4>Your orders</h4>
        <small>The last six months</small>
      </header>
      {orders === null ? (
        <CardsSkeleton n={4} />
      ) : !orders.length ? (
        <p className="hv-note">No DoorDash orders in the last six months.</p>
      ) : (
        <ul className="dd-orderList">
          {orders.map((o) => (
            <li key={o.id} className={open === o.id ? "is-open" : undefined}>
              <button type="button" className="dd-orderRow" aria-expanded={open === o.id} onClick={() => void expand(o)}>
                <Art src={o.image} name={o.store} hint={o.items.join(" ")} className="dd-orderPic" />
                <span>
                  <b>{o.store}</b>
                  <small>
                    {[
                      o.when
                        ? new Date(o.when).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : null,
                      o.totalCents !== null ? money(o.totalCents) : null,
                      o.pickup ? "pick-up" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <i aria-hidden="true">{open === o.id ? "−" : "+"}</i>
              </button>
              {open === o.id ? (
                <div className="dd-orderDetail">
                  {o.items.length ? <p className="hv-note">{o.items.join(", ")}</p> : null}
                  {detail.status ? (
                    <p className="hv-note">
                      {STATUS_WORDS[detail.status.status]}
                      {detail.status.eta ? ` · ${detail.status.eta}` : ""}
                    </p>
                  ) : null}
                  {detail.receipt ? <ReceiptView r={detail.receipt} /> : detail.text ? <p className="hv-note hv-orText">{detail.text}</p> : null}
                  <div className="hv-btns">
                    {o.reorderable ? (
                      <button type="button" className="dd-btn is-pri" disabled={busy !== null} onClick={() => onReorder(o)}>
                        Reorder
                      </button>
                    ) : null}
                    {!detail.receipt ? (
                      <button type="button" className="dd-btn" onClick={() => void receipt(o)}>
                        Receipt
                      </button>
                    ) : null}
                    {detail.status?.link ? (
                      <a className="dd-btn" href={detail.status.link} target="_blank" rel="noopener noreferrer">
                        Open in DoorDash
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReceiptView({ r }: { r: Receipt }) {
  return (
    <div className="hv-or">
      {r.lines.length ? (
        <ul className="hv-orLines is-tight">
          {r.lines.map((l, i) => (
            <li key={`${l.name}-${i}`}>
              <span>
                {l.qty}× {l.name}
              </span>
              {l.price ? <small>{l.price}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="hv-orBill">
        {r.breakdown.map((b, i) => (
          <div key={`${b.label}-${i}`}>
            <dt>{b.label}</dt>
            <dd>
              {b.minus ? "−" : ""}
              {money(b.cents)}
            </dd>
          </div>
        ))}
        {r.totalCents !== null ? (
          <div className="is-sum">
            <dt>Total</dt>
            <dd>{money(r.totalCents)}</dd>
          </div>
        ) : null}
      </dl>
      {r.last4 ? <p className="hv-note">Charged to the card ending {r.last4}.</p> : null}
    </div>
  );
}
