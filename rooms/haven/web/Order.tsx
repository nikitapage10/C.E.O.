import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { DoorDashCard } from "./DoorDash.tsx";
import { loadDoorDash, type DdView } from "./doordash.ts";
import {
  money,
  noteOf,
  orderCall,
  picksOk,
  placeKey,
  readCart,
  readDetails,
  readMenu,
  readOrder,
  readPlacement,
  readPreview,
  readReceipt,
  readStatus,
  readStore,
  STATUS_WORDS,
  tipChoices,
  type Cart,
  type ChoiceGroup,
  type Fulfillment,
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

/**
 * The Kitchen's Order tab (#1195, phase 1; api/_haven/doordash/order.ts): a one-off DoorDash order, any day, beside
 * Plan, Customize, Shop and Cook. Tonight (search, the Usuals with one-tap Reorder), a store's menu, the cart, the
 * priced preview with one Place button, and the orders. Signed out or expired, it shows the DoorDash sign-in instead.
 */

type Screen =
  | { k: "tonight" }
  | { k: "store"; store: { id: string; name: string } }
  | { k: "cart" }
  | { k: "preview" }
  | { k: "placed"; placement: Placement; message: string | null }
  | { k: "orders" };

/** One open cart at DoorDash already: the add (or reorder) waiting on Nikita's choice. */
interface Pending {
  count: number;
  retry: (open: "use" | "fresh") => void;
}

export default function OrderTab() {
  const [dd, setDd] = useState<DdView | null>(null);
  const [ddLoad, setDdLoad] = useState<"idle" | "off" | "failed" | "ready">("idle");
  const readDd = useCallback(() => {
    void loadDoorDash().then((l) => {
      if (l.state === "ready") {
        setDd(l.view);
        setDdLoad("ready");
      } else if (l.state === "out") useDeskAuth.getState().lost();
      else setDdLoad(l.state);
    });
  }, []);
  useEffect(readDd, [readDd]);

  if (ddLoad === "off") return <p className="hv-note">DoorDash isn&apos;t on this server.</p>;
  if (!dd) return <p className="hv-note">{ddLoad === "failed" ? "DoorDash didn't load. It'll try again when you come back." : "Reading DoorDash…"}</p>;
  if (dd.state !== "live")
    return (
      <div className="hv-or is-out">
        <p className="hv-note">Order dinner from DoorDash here, any night. Sign in first: a sign-in lasts about three days.</p>
        <DoorDashCard onChange={readDd} />
      </div>
    );
  return <Ordering onExpired={readDd} />;
}

function Ordering({ onExpired }: { onExpired: () => void }) {
  const [screen, setScreen] = useState<Screen>({ k: "tonight" });
  const [cart, setCart] = useState<Cart | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

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

  const takeCart = (r: OrderReply) => {
    if ("cart" in r.data) setCart(readCart(r.data.cart));
  };

  const priced = (r: OrderReply) => {
    const p = readPreview(r.data.preview);
    if (p) {
      setPreview(p);
      setScreen({ k: "preview" });
    } else setNote(r.text ?? noteOf(r));
  };

  const reorder = async (o: PastOrder, open?: "use" | "fresh") => {
    setPending(null);
    const r = await call({ action: "reorder", orderId: o.id, ...(open && { open }) }, "reorder");
    if (r.error === "open-cart") {
      setPending({ count: Number(r.data.count) || 0, retry: (choice) => void reorder(o, choice) });
      return;
    }
    if (!r.ok && !r.data.preview) {
      setNote(noteOf(r));
      return;
    }
    priced(r);
  };

  const count = cart?.lines.reduce((n, l) => n + (l.unit ? 1 : l.qty), 0) ?? 0;
  const tabs: { k: Screen["k"]; label: string }[] = [
    { k: "tonight", label: "Tonight" },
    { k: "cart", label: count ? `Cart · ${count}` : "Cart" },
    { k: "orders", label: "Orders" },
  ];
  const on = screen.k === "store" ? "tonight" : screen.k === "preview" || screen.k === "placed" ? "cart" : screen.k;

  return (
    <section className="hv-or" aria-label="Order from DoorDash">
      <nav className="hv-orTabs" aria-label="Order">
        {tabs.map((t) => (
          <button key={t.k} type="button" aria-pressed={on === t.k} onClick={() => setScreen({ k: t.k } as Screen)}>
            {t.label}
          </button>
        ))}
      </nav>
      {pending ? (
        <div className="hv-orAsk" role="alertdialog" aria-label="An open cart at this store">
          <p>
            You already have a DoorDash cart at this store ({pending.count} item{pending.count === 1 ? "" : "s"}). Add to it, or start fresh?
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
        <p className="hv-note is-warn" role="status">
          {note}
        </p>
      ) : null}
      {screen.k === "tonight" ? (
        <Tonight call={call} busy={busy} onStore={(s) => setScreen({ k: "store", store: s })} onReorder={(o) => void reorder(o)} onCart={setCart} onNote={setNote} />
      ) : screen.k === "store" ? (
        <StoreMenu
          store={screen.store}
          call={call}
          busy={busy}
          onNote={setNote}
          onPending={setPending}
          onAdded={(r) => {
            takeCart(r);
          }}
          onCart={() => setScreen({ k: "cart" })}
          count={count}
          onBack={() => setScreen({ k: "tonight" })}
        />
      ) : screen.k === "cart" ? (
        <CartView cart={cart} call={call} busy={busy} onCart={setCart} onNote={setNote} onPriced={priced} onShop={() => setScreen({ k: "tonight" })} />
      ) : screen.k === "preview" && preview ? (
        <PreviewView
          key={preview.id}
          preview={preview}
          call={call}
          busy={busy}
          onPriced={priced}
          onNote={setNote}
          onPlaced={(placement, message) => {
            if (placement.status === "placed") setCart(null);
            setScreen({ k: "placed", placement, message });
          }}
          onBack={() => setScreen({ k: "cart" })}
        />
      ) : screen.k === "placed" ? (
        <Placed placement={screen.placement} message={screen.message} onOrders={() => setScreen({ k: "orders" })} onCart={() => setScreen({ k: "cart" })} />
      ) : screen.k === "orders" ? (
        <Orders call={call} busy={busy} onReorder={(o) => void reorder(o)} onNote={setNote} />
      ) : (
        <p className="hv-note">Nothing priced yet. Open the cart and tap Review.</p>
      )}
      {busy ? (
        <p className="hv-note" role="status" aria-live="polite">
          {BUSY[busy] ?? "Asking DoorDash…"}
        </p>
      ) : null}
    </section>
  );
}

const BUSY: Record<string, string> = {
  home: "Reading your usuals…",
  search: "Searching DoorDash…",
  menu: "Reading the menu…",
  item: "Reading the choices…",
  add: "Adding to the cart…",
  cart: "Reading the cart…",
  remove: "Taking it out…",
  clear: "Starting over…",
  promo: "Trying the code…",
  preview: "Pricing the order…",
  place: "Placing the order… don't close this.",
  orders: "Reading your orders…",
  reorder: "Building the cart from that order…",
  status: "Checking on it…",
  receipt: "Reading the receipt…",
};

type Call = (body: Record<string, unknown>, label: string) => Promise<OrderReply>;

/* ── Tonight ── */

function Tonight({ call, busy, onStore, onReorder, onCart, onNote }: { call: Call; busy: string | null; onStore: (s: { id: string; name: string }) => void; onReorder: (o: PastOrder) => void; onCart: (c: Cart | null) => void; onNote: (n: string | null) => void }) {
  const [q, setQ] = useState("");
  const [stores, setStores] = useState<Store[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [usuals, setUsuals] = useState<PastOrder[] | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void call({ action: "home" }, "home").then((r) => {
      if (!live) return;
      if (!r.ok) {
        onNote(noteOf(r));
        setUsuals([]);
        return;
      }
      setUsuals(((r.data.usuals as unknown[]) ?? []).map(readOrder).filter((o): o is PastOrder => o !== null));
      const a = r.data.address as { label?: unknown } | null;
      setAddress(a ? (typeof a.label === "string" ? a.label.slice(0, 30) : "your default address") : null);
      onCart(readCart(r.data.cart));
    });
    return () => {
      live = false;
    };
  }, [call, onCart, onNote]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    const r = await call({ action: "search", query }, "search");
    if (!r.ok) {
      onNote(noteOf(r));
      return;
    }
    setStores(((r.data.stores as unknown[]) ?? []).map(readStore).filter((s): s is Store => s !== null));
    setSaid(r.text);
  };

  return (
    <div className="hv-orTonight">
      <form className="hv-orSearch" onSubmit={(e) => void search(e)} role="search">
        <label>
          <span>What sounds good?</span>
          <input type="search" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} placeholder="ramen, tacos, a place's name" enterKeyHint="search" />
        </label>
        <button type="submit" className="hv-btn is-pri" disabled={busy !== null || !q.trim()}>
          Search
        </button>
      </form>
      {address ? <p className="hv-note">Delivering to {address}.</p> : null}
      {stores ? (
        stores.length ? (
          <ul className="hv-orStores">
            {stores.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onStore({ id: s.id, name: s.name })}>
                  {s.image ? <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden="true" />}
                  <span>
                    <b>{s.name}</b>
                    <small>{[s.eta, s.rating ? `★ ${s.rating}` : null, s.miles !== null ? `${s.miles} mi` : null, s.pickup ? "pick-up" : null].filter(Boolean).join(" · ") || "Open the menu"}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hv-note">{said ?? "Nothing came up. Try another word, or the place's name."}</p>
        )
      ) : null}
      <h4 className="hv-orH">Usuals</h4>
      {usuals === null ? (
        <p className="hv-note">Reading your usuals…</p>
      ) : usuals.length ? (
        <ul className="hv-orUsuals">
          {usuals.map((o) => (
            <li key={o.id}>
              <span>
                <b>{o.store}</b>
                <small>
                  {o.items.slice(0, 3).join(", ") || "Last order"}
                  {o.items.length > 3 ? ` +${o.items.length - 3}` : ""}
                  {o.times && o.times > 1 ? ` · ${o.times} times` : ""}
                </small>
              </span>
              <div className="hv-btns">
                <button type="button" className="hv-btn is-pri" disabled={busy !== null} onClick={() => onReorder(o)}>
                  Reorder
                </button>
                {o.storeId ? (
                  <button type="button" className="hv-btn" disabled={busy !== null} onClick={() => onStore({ id: o.storeId!, name: o.store })}>
                    Menu
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hv-note">No past orders to repeat yet.</p>
      )}
    </div>
  );
}

/* ── A store ── */

function StoreMenu({
  store,
  call,
  busy,
  onNote,
  onPending,
  onAdded,
  onCart,
  onBack,
  count,
}: {
  store: { id: string; name: string };
  call: Call;
  busy: string | null;
  onNote: (n: string | null) => void;
  onPending: (p: Pending | null) => void;
  onAdded: (r: OrderReply) => void;
  onCart: () => void;
  onBack: () => void;
  count: number;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [section, setSection] = useState(0);
  const [open, setOpen] = useState<Item | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void call({ action: "menu", storeId: store.id }, "menu").then((r) => {
      if (!live) return;
      if (!r.ok) return onNote(noteOf(r));
      const m = readMenu(r.data.menu);
      setMenu(m);
      if (!m) setSaid(r.text ?? "This menu couldn't be read.");
    });
    return () => {
      live = false;
    };
  }, [call, onNote, store.id]);

  const add = async (item: Item, qty: number, options: { id: string; name: string }[], open?: "use" | "fresh") => {
    if (!menu) return;
    onPending(null);
    const r = await call({ action: "add", storeId: store.id, menuId: menu.menuId, storeName: menu.storeName ?? store.name, item: { id: item.id, name: item.name, qty, options }, ...(open && { open }) }, "add");
    if (r.error === "open-cart") {
      onPending({ count: Number(r.data.count) || 0, retry: (choice) => void add(item, qty, options, choice) });
      return;
    }
    onAdded(r);
    const errors = Array.isArray(r.data.errors) ? (r.data.errors as { name?: unknown; why?: unknown }[]) : [];
    if (errors.length) onNote(errors.map((e) => `${String(e.name ?? "An item").slice(0, 60)}: ${String(e.why ?? "couldn't be added").slice(0, 120)}`).join(". "));
    else if (!r.ok) onNote(noteOf(r));
    else {
      setOpen(null);
      setAdded(item.name);
    }
  };

  const sec = menu?.sections[Math.min(section, (menu?.sections.length ?? 1) - 1)];
  return (
    <div className="hv-orStore">
      <header className="hv-orHead">
        <button type="button" className="hv-btn" onClick={onBack}>
          ← Back
        </button>
        <h4>{menu?.storeName ?? store.name}</h4>
        {count ? (
          <button type="button" className="hv-btn is-pri" onClick={onCart}>
            Cart · {count}
          </button>
        ) : null}
      </header>
      {added ? (
        <p className="hv-note is-ok" role="status">
          Added {added}.{" "}
          <button type="button" className="hv-link" onClick={onCart}>
            Open the cart
          </button>
        </p>
      ) : null}
      {menu?.nextOpen ? <p className="hv-note">Closed now; opens {new Date(menu.nextOpen).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}. You can still schedule.</p> : null}
      {menu?.deals.length ? <p className="hv-note">Deals: {menu.deals.map((d) => (d.code ? `${d.title} (${d.code})` : d.title)).join(" · ")}</p> : null}
      {said ? <p className="hv-note hv-orText">{said}</p> : null}
      {menu ? (
        <>
          <div className="hv-chips hv-orSecs" role="tablist" aria-label="Menu sections">
            {menu.sections.map((s, i) => (
              <button key={s.name} type="button" role="tab" className="hv-chip" aria-selected={sec === s} onClick={() => setSection(i)}>
                {s.name}
              </button>
            ))}
          </div>
          <ul className="hv-orItems">
            {sec?.items.map((it) => (
              <li key={it.id} className={it.orderable === "no" ? "is-off" : undefined}>
                <button type="button" disabled={it.orderable === "no"} onClick={() => setOpen(it)}>
                  <span>
                    <b>{it.name}</b>
                    {it.desc ? <small>{it.desc}</small> : null}
                    <em>{it.priceCents !== null ? money(it.priceCents) : ""}{it.orderable === "no" ? " · unavailable" : it.orderable === "later" ? " · schedule ahead" : ""}</em>
                  </span>
                  {it.image ? <img src={it.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {open && menu ? <ItemSheet item={open} store={store.id} menuId={menu.menuId} call={call} busy={busy} onClose={() => setOpen(null)} onAdd={(qty, options) => void add(open, qty, options)} /> : null}
    </div>
  );
}

function ItemSheet({ item, store, menuId, call, busy, onClose, onAdd }: { item: Item; store: string; menuId: string; call: Call; busy: string | null; onClose: () => void; onAdd: (qty: number, options: { id: string; name: string }[]) => void }) {
  const [details, setDetails] = useState<ItemDetails | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [picks, setPicks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let live = true;
    void call({ action: "item", storeId: store, menuId, itemId: item.id }, "item").then((r) => {
      if (!live) return;
      const d = r.ok ? readDetails(r.data.item) : null;
      setDetails(d);
      if (!d) setSaid(r.text ?? (r.ok ? null : noteOf(r)));
    });
    return () => {
      live = false;
    };
  }, [call, item.id, menuId, store]);

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
  return (
    <div className="hv-orSheet" role="dialog" aria-label={item.name}>
      <header className="hv-orHead">
        <h4>{item.name}</h4>
        <button type="button" className="hv-btn" onClick={onClose}>
          Close
        </button>
      </header>
      {details?.desc ?? item.desc ? <p className="hv-note">{details?.desc ?? item.desc}</p> : null}
      {said ? <p className="hv-note hv-orText">{said}</p> : null}
      {groups.map((g) => (
        <fieldset key={g.id} className="hv-orGroup">
          <legend>
            {g.name} <small>{g.min ? (g.min === g.max ? `pick ${g.min}` : `pick ${g.min} to ${g.max}`) : g.max === 1 ? "optional, pick 1" : `optional, up to ${g.max}`}</small>
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
      <div className="hv-orQty">
        <button type="button" className="hv-btn" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))}>
          −
        </button>
        <b aria-live="polite">{qty}</b>
        <button type="button" className="hv-btn" aria-label="One more" disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))}>
          +
        </button>
        <button type="button" className="hv-btn is-pri" disabled={busy !== null || !ok || (!details && !said)} onClick={() => onAdd(qty, chosen.map((o) => ({ id: o.id, name: o.name })))}>
          Add {qty > 1 ? `${qty} ` : ""}to cart{each ? `, ${money(each * qty)}` : ""}
        </button>
      </div>
      {!ok ? <p className="hv-note">Pick the required choices first.</p> : null}
    </div>
  );
}

/* ── The cart ── */

function CartView({ cart, call, busy, onCart, onNote, onPriced, onShop }: { cart: Cart | null; call: Call; busy: string | null; onCart: (c: Cart | null) => void; onNote: (n: string | null) => void; onPriced: (r: OrderReply) => void; onShop: () => void }) {
  const [code, setCode] = useState("");
  const [promoSaid, setPromoSaid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void call({ action: "cart" }, "cart").then((r) => {
      if (!live) return;
      if (r.ok) onCart(readCart(r.data.cart));
      else onNote(noteOf(r));
    });
    return () => {
      live = false;
    };
  }, [call, onCart, onNote]);

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

  if (!cart || !cart.lines.length)
    return (
      <div className="hv-orCart">
        <p className="hv-note">{cart?.maybeSpent ? "The last order on this cart may have gone through. Check Orders before anything else." : "The cart is empty."}</p>
        <div className="hv-btns">
          <button type="button" className="hv-btn is-pri" onClick={onShop}>
            Find something
          </button>
          {cart ? (
            <button type="button" className="hv-btn" disabled={busy !== null} onClick={() => void act({ action: "clear" }, "clear")}>
              Start over
            </button>
          ) : null}
        </div>
      </div>
    );
  const subtotal = cart.lines.every((l) => l.priceCents !== null) ? cart.lines.reduce((s, l) => s + (l.priceCents ?? 0) * (l.unit ? 1 : l.qty), 0) : null;
  return (
    <div className="hv-orCart">
      <h4 className="hv-orH">{cart.storeName ?? "Your cart"}</h4>
      {cart.maybeSpent ? <p className="hv-note is-warn">The last order on this cart may have gone through. Check Orders, then Start over: it won&apos;t be placed again from here.</p> : null}
      <ul className="hv-orLines">
        {cart.lines.map((l, i) => (
          <li key={l.id ?? `${l.name}-${i}`}>
            <span>
              <b>
                {l.qty}
                {l.unit ? ` ${l.unit}` : "×"} {l.name}
              </b>
              {l.priceCents !== null ? <small>{money(l.priceCents)}{l.unit ? ` / ${l.unit}` : " each"}</small> : null}
            </span>
            {l.id ? (
              <button type="button" className="hv-btn" disabled={busy !== null || cart.maybeSpent} onClick={() => void act({ action: "remove", lineId: l.id }, "remove")}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {subtotal !== null ? <p className="hv-note">About {money(subtotal)} before fees, tax and tip. To change a quantity, remove the line and add it again.</p> : null}
      <form className="hv-orPromo" onSubmit={(e) => void promo(e)}>
        <label>
          <span>Promo code</span>
          <input type="text" value={code} maxLength={30} autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} />
        </label>
        <button type="submit" className="hv-btn" disabled={busy !== null || code.trim().length < 2 || cart.maybeSpent}>
          Apply
        </button>
      </form>
      {promoSaid ? <p className="hv-note">{promoSaid}</p> : null}
      <div className="hv-btns">
        <button type="button" className="hv-btn is-pri" disabled={busy !== null || cart.maybeSpent} onClick={() => void call({ action: "preview" }, "preview").then(onPriced)}>
          Review order
        </button>
        <button type="button" className="hv-btn" onClick={onShop}>
          Add more
        </button>
        <button type="button" className="hv-btn" disabled={busy !== null} onClick={() => void act({ action: "clear" }, "clear")}>
          Start over
        </button>
      </div>
      <p className="hv-note">Delivery or pick-up, when, and the tip come on the next step, with the full price.</p>
    </div>
  );
}

/* ── The preview and Place ── */

function PreviewView({ preview: p, call, busy, onPriced, onNote, onPlaced, onBack }: { preview: Preview; call: Call; busy: string | null; onPriced: (r: OrderReply) => void; onNote: (n: string | null) => void; onPlaced: (pl: Placement, message: string | null) => void; onBack: () => void }) {
  const choices = useMemo(() => tipChoices(p), [p]);
  const [tip, setTip] = useState<number | null>(p.pickup || !p.pretippable ? 0 : (p.tipDefault ?? null));
  const [custom, setCustom] = useState("");
  // One key per priced preview: a double tap or a retry reaches the server as the same placement.
  const key = useRef(placeKey());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);
  const stale = now > Date.parse(p.until);
  const fulfillment: Fulfillment = p.pickup ? "pickup" : "delivery";
  const reprice = (over: { fulfillment?: Fulfillment; at?: string | null; priority?: boolean }) =>
    void call({ action: "preview", fulfillment: over.fulfillment ?? fulfillment, at: over.at === undefined ? (p.scheduled ?? "asap") : (over.at ?? "asap"), priority: over.priority ?? p.priority }, "preview").then(onPriced);

  const tipCents = tip ?? 0;
  const total = p.netCents + tipCents;
  const over = total > p.capCents;
  const needTip = !p.pickup && p.pretippable && tip === null;

  const place = async () => {
    const r = await call({ action: "place", previewId: p.id, key: key.current, tipCents, totalCents: total }, "place");
    const pl = readPlacement(r.data.placement);
    if (r.error === "changed" && r.data.preview) {
      onPriced(r);
      onNote("The price changed. Check the new total and place again.");
      return;
    }
    if (pl) onPlaced(pl, r.message);
    else onNote(noteOf(r));
  };

  const windows = p.windows.slice(0, 12);
  return (
    <div className="hv-orPreview">
      <header className="hv-orHead">
        <button type="button" className="hv-btn" onClick={onBack}>
          ← Cart
        </button>
        <h4>{p.storeName ?? "Your order"}</h4>
      </header>
      {p.dropped.length ? <p className="hv-note is-warn">Not in this cart any more (out of stock or gone): {p.dropped.join(", ")}. Check it&apos;s still what you want.</p> : null}
      <ul className="hv-orLines is-tight">
        {p.lines.map((l, i) => (
          <li key={`${l.name}-${i}`}>
            <span>
              {l.qty}× {l.name}
            </span>
            {l.price ? <small>{l.price}</small> : null}
          </li>
        ))}
      </ul>

      <div className="hv-orOpts">
        <div className="hv-orSeg" role="group" aria-label="Delivery or pick-up">
          {(["delivery", "pickup"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={fulfillment === f} disabled={busy !== null} onClick={() => fulfillment !== f && reprice({ fulfillment: f, at: f === "pickup" ? null : undefined, priority: false })}>
              {f === "delivery" ? "Delivery" : "Pick-up"}
            </button>
          ))}
        </div>
        {!p.pickup ? (
          <div className="hv-orSeg" role="group" aria-label="When">
            <button type="button" aria-pressed={!p.scheduled} disabled={busy !== null || p.asap === false} onClick={() => p.scheduled && reprice({ at: null })}>
              ASAP{p.eta && !p.scheduled ? ` · ${p.eta}` : ""}
            </button>
            <button type="button" aria-pressed={Boolean(p.scheduled)} disabled={busy !== null || !windows.length} onClick={() => !p.scheduled && windows[0] && reprice({ at: windows[0].at, priority: false })}>
              Schedule
            </button>
          </div>
        ) : null}
        {p.scheduled || (p.asap === false && windows.length) ? (
          <label className="hv-orWin">
            <span>Window</span>
            <select value={p.scheduled ?? ""} disabled={busy !== null} onChange={(e) => e.target.value && reprice({ at: e.target.value, priority: false })}>
              {!p.scheduled ? <option value="">Pick a window</option> : null}
              {windows.map((w) => (
                <option key={w.at} value={w.at}>
                  {w.day} {w.label}
                </option>
              ))}
              {p.scheduled && !windows.some((w) => w.at === p.scheduled) ? <option value={p.scheduled}>{new Date(p.scheduled).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</option> : null}
            </select>
          </label>
        ) : null}
        {!p.pickup && !p.scheduled && (p.priorityOffered || p.priority) ? (
          <div className="hv-orSeg" role="group" aria-label="Speed">
            <button type="button" aria-pressed={!p.priority} disabled={busy !== null} onClick={() => p.priority && reprice({ priority: false })}>
              Standard
            </button>
            <button type="button" aria-pressed={p.priority} disabled={busy !== null} onClick={() => !p.priority && reprice({ priority: true })}>
              Priority
            </button>
          </div>
        ) : null}
      </div>

      <dl className="hv-orBill">
        {p.breakdown.map((b, i) => (
          <div key={`${b.label}-${i}`}>
            <dt>{b.label}</dt>
            <dd>
              {b.minus ? "−" : ""}
              {money(b.cents)}
            </dd>
          </div>
        ))}
        <div className="is-sum">
          <dt>Before tip</dt>
          <dd>{money(p.netCents)}</dd>
        </div>
      </dl>

      {choices.length ? (
        <fieldset className="hv-orTip">
          <legend>Dasher tip</legend>
          <div className="hv-orSeg is-wrap">
            {choices.map((t) => (
              <button key={`${t.label}-${t.cents}`} type="button" aria-pressed={tip === t.cents && !custom} onClick={() => (setCustom(""), setTip(t.cents))}>
                {t.label}
                {t.label.endsWith("%") ? <small> {money(t.cents)}</small> : null}
              </button>
            ))}
            <label className="hv-orTipOwn">
              <span>Other $</span>
              <input
                type="text"
                inputMode="decimal"
                value={custom}
                maxLength={6}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  setCustom(v);
                  const n = Math.round(Number(v) * 100);
                  setTip(v && Number.isFinite(n) && n >= 0 && n <= 50_000 ? n : null);
                }}
              />
            </label>
          </div>
        </fieldset>
      ) : null}

      <dl className="hv-orFacts">
        <div>
          <dt>Card</dt>
          <dd>{p.card ?? p.cardNote ?? "Your default payment method"}</dd>
        </div>
        <div>
          <dt>{p.pickup ? "Pick up" : "Deliver to"}</dt>
          <dd>{p.pickup ? (p.storeName ?? "the store") : p.address}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{p.scheduled ? new Date(p.scheduled).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : (p.eta ?? "As soon as possible")}</dd>
        </div>
        {p.dashpass ? (
          <div>
            <dt>DashPass</dt>
            <dd>applied</dd>
          </div>
        ) : null}
      </dl>
      {p.pin ? <p className="hv-note is-warn">This order needs a PIN at the door: find it on the order&apos;s page in the DoorDash app and give it to the Dasher. Placing it means you&apos;re fine with that.</p> : null}
      {over ? <p className="hv-note is-warn">That&apos;s {money(total)}, over the $1,000 per-order limit. Take something out first.</p> : null}
      {stale ? (
        <button type="button" className="hv-btn is-pri hv-orPlace" disabled={busy !== null} onClick={() => reprice({})}>
          Price it again (prices hold 5 minutes)
        </button>
      ) : (
        <button type="button" className="hv-btn is-pri hv-orPlace" disabled={busy !== null || over || needTip} onClick={() => void place()}>
          {busy === "place" ? "Placing…" : needTip ? "Pick a tip first" : `Place order, ${money(total)}`}
        </button>
      )}
    </div>
  );
}

/* ── After Place ── */

function Placed({ placement, message, onOrders, onCart }: { placement: Placement; message: string | null; onOrders: () => void; onCart: () => void }) {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const tries = useRef(0);
  useEffect(() => {
    if (placement.status !== "placed" || !placement.orderId) return;
    let live = true;
    let timer: number | undefined;
    const read = () =>
      void orderCall({ action: "status", orderId: placement.orderId }).then((r) => {
        if (!live) return;
        const s = readStatus(r.data.status);
        if (s) setStatus(s);
        tries.current++;
        // Every 15 s while it's processing, then every minute, for half an hour at most, and only while on screen.
        if (!s?.final && tries.current < 40) timer = window.setTimeout(read, s && s.status !== "pending" ? 60_000 : 15_000);
      });
    read();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [placement.orderId, placement.status]);

  if (placement.status === "maybe")
    return (
      <div className="hv-orPlaced is-maybe">
        <h4>DoorDash didn&apos;t confirm</h4>
        <p className="hv-note">The order may or may not have gone through, so it wasn&apos;t tried again. Check Orders (or the DoorDash app) before ordering again; this cart is held so it can&apos;t be placed twice.</p>
        <button type="button" className="hv-btn is-pri" onClick={onOrders}>
          Check Orders
        </button>
      </div>
    );
  if (placement.status === "failed")
    return (
      <div className="hv-orPlaced is-failed">
        <h4>Not placed</h4>
        <p className="hv-note">{placement.error === "restricted" ? "This cart has an age-restricted item: finish it in the DoorDash app." : placement.error === "expired" ? "Your DoorDash sign-in ran out. Sign in again and price it again." : (message ?? "DoorDash turned it down. Nothing was charged.")}</p>
        <button type="button" className="hv-btn is-pri" onClick={onCart}>
          Back to the cart
        </button>
      </div>
    );
  return (
    <div className="hv-orPlaced">
      <h4>Order placed, {money(placement.totalCents)}</h4>
      <p className="hv-note">
        {status ? STATUS_WORDS[status.status] : "Sent. Checking on it…"}
        {status?.eta ? ` · ${status.eta}` : ""}
      </p>
      {status?.status === "action_required" ? <p className="hv-note is-warn">DoorDash needs one more step: finish it in the DoorDash app.</p> : null}
      <div className="hv-btns">
        {status?.link ? (
          <a className="hv-btn is-pri" href={status.link} target="_blank" rel="noopener noreferrer">
            Open in DoorDash
          </a>
        ) : null}
        <button type="button" className="hv-btn" onClick={onOrders}>
          Orders
        </button>
      </div>
    </div>
  );
}

/* ── Orders ── */

function Orders({ call, busy, onReorder, onNote }: { call: Call; busy: string | null; onReorder: (o: PastOrder) => void; onNote: (n: string | null) => void }) {
  const [orders, setOrders] = useState<PastOrder[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ status?: OrderStatus | null; receipt?: Receipt | null; text?: string | null }>({});

  useEffect(() => {
    let live = true;
    void call({ action: "orders" }, "orders").then((r) => {
      if (!live) return;
      if (!r.ok) {
        onNote(noteOf(r));
        setOrders([]);
        return;
      }
      setOrders(((r.data.orders as unknown[]) ?? []).map(readOrder).filter((o): o is PastOrder => o !== null));
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
    setDetail((d) => ({ ...d, receipt: readReceipt(r.data.receipt), text: r.text ?? (r.ok ? null : noteOf(r)) }));
  };

  if (orders === null) return <p className="hv-note">Reading your orders…</p>;
  if (!orders.length) return <p className="hv-note">No DoorDash orders in the last six months.</p>;
  return (
    <ul className="hv-orOrders">
      {orders.map((o) => (
        <li key={o.id} className={open === o.id ? "is-open" : undefined}>
          <button type="button" className="hv-orRow" aria-expanded={open === o.id} onClick={() => void expand(o)}>
            <b>{o.store}</b>
            <small>{[o.when ? new Date(o.when).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null, o.totalCents !== null ? money(o.totalCents) : null, o.pickup ? "pick-up" : null].filter(Boolean).join(" · ")}</small>
          </button>
          {open === o.id ? (
            <div className="hv-orDetail">
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
                  <button type="button" className="hv-btn is-pri" disabled={busy !== null} onClick={() => onReorder(o)}>
                    Reorder
                  </button>
                ) : null}
                {!detail.receipt ? (
                  <button type="button" className="hv-btn" disabled={busy !== null} onClick={() => void receipt(o)}>
                    Receipt
                  </button>
                ) : null}
                {detail.status?.link ? (
                  <a className="hv-btn" href={detail.status.link} target="_blank" rel="noopener noreferrer">
                    Open in DoorDash
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ReceiptView({ r }: { r: Receipt }): ReactNode {
  return (
    <div className="hv-orReceipt">
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
