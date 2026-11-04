import "./houseChips.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeskAuth } from "./signin.ts";
import { Private } from "./Private.tsx";
import { INSTACART_NOTE, isInstacartLink, loadCounts, loadKitchen, removeItem, sendInstacart, tickItem, undoRemoveItem, type KitchenItem } from "./haven.ts";

/**
 * The Kitchen list chip (#627; on Today until the Iris, #666, on the Haven since): what "Hey Skippy" put on it from the iPhone. A chip in
 * Today's helm with how many things are still to get; signed in, it opens the list, and each item ticks off (and back
 * on, for a day) or is removed with the ×, with five seconds to Undo (#657). Signed out, the count only. Hidden where there's no haven route (the Vercel copy). Send to Instacart
 * (#637) turns the open items into an Instacart shopping list page and opens it, to pick the store and check out there.
 */
export function KitchenList() {
  const status = useDeskAuth((s) => s.auth.status);
  const [count, setCount] = useState<number | null>(null);
  const [items, setItems] = useState<KitchenItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<{ busy: boolean; note: string | null; url: string | null }>({ busy: false, note: null, url: null });
  // The last item removed, kept five seconds so Undo can bring it back (#657).
  const [undo, setUndo] = useState<KitchenItem | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const signedIn = status === "in";

  const refresh = useCallback(() => {
    if (signedIn) {
      void loadKitchen().then((l) => {
        if (l.state === "ready") {
          setItems(l.view.items);
          setCount(l.view.items.filter((i) => !i.done).length);
        } else if (l.state === "out") useDeskAuth.getState().lost();
      });
    } else {
      setItems(null);
      void loadCounts().then((l) => setCount(l.state === "ready" && l.view.ready ? l.view.kitchen.open : null));
    }
  }, [signedIn]);

  useEffect(() => {
    if (status === "checking") return;
    refresh();
    const t = window.setInterval(refresh, 120_000);
    return () => window.clearInterval(t);
  }, [status, refresh]);

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  if (count === null || (!signedIn && count === 0)) return null;

  const tick = (item: KitchenItem) => {
    const done = !item.done;
    setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, done } : i)) ?? cur);
    setCount((c) => (c === null ? c : c + (done ? -1 : 1)));
    void tickItem(item.id, done).then((r) => {
      if (!r.ok) refresh();
    });
  };

  const remove = (item: KitchenItem) => {
    setItems((cur) => cur?.filter((i) => i.id !== item.id) ?? cur);
    if (!item.done) setCount((c) => (c === null ? c : Math.max(0, c - 1)));
    window.clearTimeout(undoTimer.current);
    setUndo(item);
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
    void removeItem(item.id).then((r) => {
      if (!r.ok) {
        setUndo(null);
        refresh();
      }
    });
  };

  const takeBack = () => {
    if (!undo) return;
    const item = undo;
    window.clearTimeout(undoTimer.current);
    setUndo(null);
    void undoRemoveItem(item.id).then(() => refresh());
  };

  const toInstacart = () => {
    // A window opened now, in the tap, so the link isn't blocked as a pop-up once Instacart answers.
    const win = window.open("about:blank", "_blank");
    setCart({ busy: true, note: null, url: null });
    void sendInstacart().then((r) => {
      if (r.ok && isInstacartLink(r.data.url)) {
        if (win) {
          win.opener = null;
          win.location.href = r.data.url;
        }
        setCart({ busy: false, note: `Sent ${r.data.items} to Instacart. Pick the store there.`, url: r.data.url });
      } else {
        win?.close();
        if (!r.ok && r.status === 401) useDeskAuth.getState().lost();
        setCart({ busy: false, note: INSTACART_NOTE[r.ok ? "vendor" : r.error] ?? INSTACART_NOTE.failed!, url: null });
      }
    });
  };

  const words = count === 0 ? "nothing to get" : `${count} to get`;
  if (!signedIn) {
    return (
      <div className="cf-cu kl">
        <span className="cf-cu-btn kl-btn">
          <span className="cf-cu-k">Kitchen list</span>
          <span>{words}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="cf-cu kl" ref={box}>
      <button type="button" className="cf-cu-btn kl-btn" aria-expanded={open} aria-controls="kl-pop" onClick={() => setOpen((o) => !o)}>
        <span className="cf-cu-k">Kitchen list</span>
        <span>{count === 0 ? words : <b>{words}</b>}</span>
      </button>
      <div id="kl-pop" className="cf-cu-pop kl-pop" hidden={!open}>
        {open && (
          <>
            {!items?.length ? <p className="kl-empty">Empty. Say "Skippy, add garlic and lemons" on the phone.</p> : null}
            <ul className="kl-list" aria-label="Kitchen list">
              {items?.map((i) => (
                <li key={i.id} className={i.done ? "is-done" : ""}>
                  <label>
                    <input type="checkbox" checked={i.done} onChange={() => tick(i)} />
                    <Private>{i.name}</Private>
                  </label>
                  <button type="button" className="kl-x" aria-label={`Remove ${i.name}`} onClick={() => remove(i)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {undo ? (
              <p className="kl-undo" role="status">
                <span>Removed.</span>
                <button type="button" onClick={takeBack}>
                  Undo
                </button>
              </p>
            ) : null}
            <p className="kl-cart">
              <button type="button" disabled={cart.busy || !count} onClick={toInstacart}>
                Send to Instacart
              </button>
              {cart.note ? <small role="status">{cart.note}</small> : null}
              {cart.url ? (
                <a href={cart.url} target="_blank" rel="noopener noreferrer">
                  Open the list
                </a>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
