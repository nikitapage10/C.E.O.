import { useCallback, useEffect, useRef, useState } from "react";
import { useDeskAuth } from "./signin.ts";
import { Private } from "./Private.tsx";
import { loadCounts, loadKitchen, tickItem, type KitchenItem } from "./haven.ts";

/**
 * The Kitchen list on Today (#627), until the Haven room ships: what "Hey Skippy" put on it from the iPhone. A chip in
 * Today's helm with how many things are still to get; signed in, it opens the list, and each item ticks off (and back
 * on, for a day). Signed out, the count only. Hidden where there's no haven route (the Vercel copy).
 */
export function KitchenList() {
  const status = useDeskAuth((s) => s.auth.status);
  const [count, setCount] = useState<number | null>(null);
  const [items, setItems] = useState<KitchenItem[] | null>(null);
  const [open, setOpen] = useState(false);
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
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
