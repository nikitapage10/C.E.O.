import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { DoorDashCard } from "./DoorDash.tsx";
import { loadDoorDash, type DdView } from "./doordash.ts";
import { money, noteOf, orderCall, placeKey, readPlacement, readStatus, STATUS_WORDS, tipChoices, type Fulfillment, type OrderReply, type OrderStatus, type Placement, type Preview } from "./order.ts";

/**
 * DoorDash's shared ordering screens (#1195): the sign-in gate, the priced preview with its one Place button, and what
 * follows Place. The Haven's DoorDash tab (DoorDashTab.tsx) and Shop's DoorDash tab (DoorDashShop.tsx) both end here,
 * so every order goes through the same preview and the server's Place rules (api/_haven/doordash/order.ts).
 */

/** DoorDash's sign-in first: signed out or expired, the sign-in card; live, the children (told when it runs out). Shared by the DoorDash tab and Shop's DoorDash tab. */
export function DoorDashGate({ intro, children, loading }: { intro: string; children: (onExpired: () => void) => ReactNode; loading?: ReactNode }) {
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
  if (!dd && ddLoad !== "failed" && loading) return <>{loading}</>;
  if (!dd) return <p className="hv-note">{ddLoad === "failed" ? "DoorDash didn't load. It'll try again when you come back." : "Reading DoorDash…"}</p>;
  if (dd.state !== "live")
    return (
      <div className="hv-or is-out">
        <p className="hv-note">{intro} Sign in first: a sign-in lasts about three days.</p>
        <DoorDashCard onChange={readDd} />
      </div>
    );
  return <>{children(readDd)}</>;
}

export const BUSY: Record<string, string> = {
  home: "Reading your usuals…",
  search: "Searching DoorDash…",
  nearby: "Finding places nearby…",
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

export type Call = (body: Record<string, unknown>, label: string) => Promise<OrderReply>;

/* ── The preview and Place ── */

/** The priced order and its one Place button; Shop's DoorDash tab reuses it for the groceries (`back` names its way back, `hint` adds a line). */
export function PreviewView({ preview: p, call, busy, onPriced, onNote, onPlaced, onBack, back = "← Cart", hint }: { preview: Preview; call: Call; busy: string | null; onPriced: (r: OrderReply) => void; onNote: (n: string | null) => void; onPlaced: (pl: Placement, message: string | null) => void; onBack: () => void; back?: string; hint?: string | null }) {
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
          {back}
        </button>
        <h4>{p.storeName ?? "Your order"}</h4>
      </header>
      {hint ? <p className="hv-note">{hint}</p> : null}
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

export function Placed({ placement, message, onOrders, onCart, cartWord = "the cart" }: { placement: Placement; message: string | null; onOrders: () => void; onCart: () => void; cartWord?: string }) {
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
          Back to {cartWord}
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
