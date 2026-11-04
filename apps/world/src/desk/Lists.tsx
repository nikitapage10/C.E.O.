import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Private } from "./Private.tsx";
import { useDeskAuth } from "./signin.ts";
import { onWrote, touchesLists } from "./skippy/wrote.ts";
import { addOn, clearDoneOn, loadCounts, loadLists, removeOn, tickOn, undoRemoveOn, type KitchenItem, type ListCount, type ListId, type ListView } from "./haven.ts";
import "./lists.css";

/**
 * Lists on Today (#735): every private list (api/_haven/list.ts `LISTS`: Groceries, the Kitchen list, and Things to
 * buy, the Amazon-style list) in one compact place under the to-dos, since they aren't the Kitchen's alone. A tab per
 * list with its open count; signed in, the open one shows its items to tick off or × away (Undo for a few seconds), a
 * quick add, and Clear ticked. Signed out it shows the counts only, never an item. Nothing here buys anything.
 */

const KEEP_TAB = "ceo.lists.tab";
const readTab = (): ListId | null => {
  try {
    const v = window.localStorage.getItem(KEEP_TAB);
    return v === "kitchen" || v === "buy" ? v : null;
  } catch {
    return null;
  }
};
const keepTab = (id: ListId) => {
  try {
    window.localStorage.setItem(KEEP_TAB, id);
  } catch {
    /* a private window: the tab just isn't remembered */
  }
};

const PLACEHOLDER: Record<ListId, string> = { kitchen: "Add groceries: “oat milk, lemons”", buy: "Add a thing to buy: “phone charger”" };

export function Lists() {
  const auth = useDeskAuth((s) => s.auth.status);
  const signedIn = auth === "in";
  const [lists, setLists] = useState<ListView[] | null>(null);
  const [counts, setCounts] = useState<ListCount[] | null>(null);
  const [tab, setTab] = useState<ListId>(() => (typeof window === "undefined" ? "kitchen" : (readTab() ?? "kitchen")));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ line: string; undo?: { list: ListId; id: string } } | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);

  const read = useCallback(() => {
    if (signedIn)
      void loadLists().then((l) => {
        if (l.state === "ready") setLists(l.view.lists);
        else if (l.state === "out") useDeskAuth.getState().lost();
      });
    else {
      setLists(null);
      void loadCounts().then((l) => setCounts(l.state === "ready" && l.view.ready ? (l.view.lists ?? null) : null));
    }
  }, [signedIn]);

  useEffect(() => {
    if (auth === "checking") return;
    read();
    const t = window.setInterval(read, 120_000);
    const off = onWrote((w) => touchesLists(w) && read());
    return () => {
      window.clearInterval(t);
      off();
    };
  }, [auth, read]);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const say = (line: string, undo?: { list: ListId; id: string }) => {
    window.clearTimeout(noteTimer.current);
    setNote({ line, undo });
    noteTimer.current = window.setTimeout(() => setNote(null), undo ? 6_000 : 3_000);
  };
  const failed = (status: number) => (status === 401 ? useDeskAuth.getState().lost() : say("That didn't go through. Try again."));
  const patch = (id: ListId, fn: (items: KitchenItem[]) => KitchenItem[]) => setLists((ls) => ls?.map((l) => (l.id === id ? { ...l, items: fn(l.items) } : l)) ?? ls);

  // Signed out: the counts, if the server gave any, and nothing else.
  if (!signedIn) {
    if (!counts?.length) return null;
    return (
      <section className="ti-lists is-counts" aria-label="Lists">
        <p className="ti-left-k">
          <span>lists</span>
        </p>
        <p className="ti-lists-counts">
          {counts.map((c) => (
            <span key={c.id}>
              {c.name} <b>{c.open}</b>
            </span>
          ))}
        </p>
      </section>
    );
  }
  if (!lists?.length) return null;

  const cur = lists.find((l) => l.id === tab) ?? lists[0]!;
  const open = cur.items.filter((i) => !i.done);
  const done = cur.items.filter((i) => i.done);

  const pick = (id: ListId) => {
    setTab(id);
    keepTab(id);
  };
  const tick = async (i: KitchenItem, on: boolean) => {
    patch(cur.id, (items) => items.map((x) => (x.id === i.id ? { ...x, done: on } : x)));
    const r = await tickOn(cur.id, i.id, on);
    if (!r.ok) {
      failed(r.status);
      read();
    }
  };
  const remove = async (i: KitchenItem) => {
    patch(cur.id, (items) => items.filter((x) => x.id !== i.id));
    const r = await removeOn(cur.id, i.id);
    if (r.ok) say(`Taken off ${cur.name}.`, { list: cur.id, id: i.id });
    else {
      failed(r.status);
      read();
    }
  };
  const undo = async () => {
    const u = note?.undo;
    if (!u) return;
    setNote(null);
    const r = await undoRemoveOn(u.list, u.id);
    if (!r.ok) failed(r.status);
    read();
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    const r = await addOn(cur.id, words);
    setBusy(false);
    if (!r.ok) return failed(r.status);
    setText("");
    patch(cur.id, () => r.data.items);
    if (r.data.already.length && !r.data.added.length) say(`Already on ${cur.name}.`);
  };
  const clear = async () => {
    patch(cur.id, (items) => items.filter((x) => !x.done));
    const r = await clearDoneOn(cur.id);
    if (!r.ok) {
      failed(r.status);
      read();
    }
  };

  return (
    <section className="ti-lists" aria-label="Lists">
      <p className="ti-left-k">
        <span>lists</span>
      </p>
      <div className="ti-lists-tabs" role="tablist" aria-label="Your lists">
        {lists.map((l) => {
          const n = l.items.filter((i) => !i.done).length;
          return (
            <button key={l.id} type="button" role="tab" id={`ti-lt-${l.id}`} aria-selected={l.id === cur.id} aria-controls="ti-lists-panel" className={l.id === cur.id ? "is-on" : ""} onClick={() => pick(l.id)}>
              {l.name}
              <b aria-label={`${n} open`}>{n}</b>
            </button>
          );
        })}
      </div>
      <div id="ti-lists-panel" role="tabpanel" aria-labelledby={`ti-lt-${cur.id}`} className="ti-lists-panel">
        {cur.items.length === 0 ? (
          <p className="ti-lists-empty">Nothing on {cur.name}.</p>
        ) : (
          <ul className="ti-lists-l">
            {[...open, ...done].map((i) => (
              <li key={i.id} className={i.done ? "is-done" : ""}>
                <label>
                  <input type="checkbox" checked={i.done} onChange={(e) => void tick(i, e.target.checked)} />
                  <Private>{i.name}</Private>
                </label>
                <button type="button" className="ti-lists-x" aria-label={`Remove ${i.name} from ${cur.name}`} onClick={() => void remove(i)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="ti-lists-add" onSubmit={add} aria-label={`Add to ${cur.name}`}>
          <input type="text" value={text} maxLength={200} enterKeyHint="done" autoComplete="off" aria-label={`Add to ${cur.name}`} placeholder={PLACEHOLDER[cur.id]} onChange={(e) => setText(e.target.value)} disabled={busy} />
          <button type="submit" disabled={busy || !text.trim()}>
            Add
          </button>
        </form>
        <p className="ti-lists-foot" role="status" aria-live="polite">
          {note ? (
            <>
              <span>{note.line}</span>
              {note.undo && (
                <button type="button" onClick={() => void undo()}>
                  Undo
                </button>
              )}
            </>
          ) : done.length > 0 ? (
            <button type="button" onClick={() => void clear()}>
              Clear ticked ({done.length})
            </button>
          ) : null}
        </p>
      </div>
    </section>
  );
}
