import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { onWrote, touchesLists } from "@ceo/desk/skippy/wrote.ts";
import { addOn, clearDoneOn, clearListOn, deleteListOn, loadCounts, loadLists, NEW_LIST_NOTE, newList, removeOn, tickOn, undoClearOn, undoRemoveOn, type KitchenItem, type ListCount, type ListId, type ListView } from "@ceo/desk/haven.ts";
import "./lists.css";

/**
 * Lists in the Haven (#735, moved off Today): a collapsible panel on the left of the Haven page, one folding section
 * per private list (api/_haven/list.ts `LISTS`: Groceries, the Kitchen list, and Things to buy). Everything starts
 * folded; once he opens one, the open/shut state is remembered on this device. Signed in, a section shows its items to
 * tick off or × away (Undo for a few seconds), a quick add, Clear ticked, and Clear list (#1091), which asks "Are you
 * sure" on the page first and can be undone for a few seconds. New list makes another list; a list he made can be
 * deleted, after the same question. Signed out it shows the counts only, never an item. Nothing here buys anything.
 */

type FoldId = "panel" | ListId;
const KEEP = "ceo.haven.lists.open";
const readOpen = (): Partial<Record<FoldId, boolean>> => {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEEP) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([k, on]) => on === true && /^[\w-]{1,20}$/.test(k)).map(([k]) => [k, true]));
  } catch {
    return {};
  }
};
const keepOpen = (m: Partial<Record<FoldId, boolean>>) => {
  try {
    window.localStorage.setItem(KEEP, JSON.stringify(m));
  } catch {
    /* a private window: the folds just aren't remembered */
  }
};

const PLACEHOLDER: Record<string, string> = { kitchen: "Add groceries: “oat milk, lemons”", buy: "Add a thing to buy: “phone charger”" };

/** What Undo brings back: one removed item, or everything one Clear list took. */
type Undo = { list: ListId; id: string } | { list: ListId; at: string };
type Say = (line: string, undo?: Undo) => void;

/**
 * A button that asks first, on the page (confirm() is no use here): the first tap turns it into "Are you sure you want
 * to delete this? Yes No", which falls back after a few seconds.
 */
function AskFirst({ label, ask, onYes }: { label: string; ask: string; onYes: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const off = () => {
    window.clearTimeout(timer.current);
    setArmed(false);
  };
  const arm = () => {
    setArmed(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setArmed(false), 8000);
  };
  return armed ? (
    <span className="hv-ls-ask" role="group" aria-label={ask}>
      <span>{ask}</span>
      <button type="button" className="is-yes" onClick={() => (off(), onYes())}>
        Yes
      </button>
      <button type="button" onClick={off}>
        No
      </button>
    </span>
  ) : (
    <button type="button" className="hv-ls-clear" onClick={arm}>
      {label}
    </button>
  );
}

function Section({ list, open, onToggle, onChange, onDeleted, say, failed }: { list: ListView; open: boolean; onToggle: () => void; onChange: (fn: (items: KitchenItem[]) => KitchenItem[]) => void; onDeleted: () => void; say: Say; failed: (status: number) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const items = [...list.items.filter((i) => !i.done), ...list.items.filter((i) => i.done)];
  const nOpen = list.items.filter((i) => !i.done).length;
  const nDone = list.items.length - nOpen;

  const tick = async (i: KitchenItem, on: boolean) => {
    onChange((xs) => xs.map((x) => (x.id === i.id ? { ...x, done: on } : x)));
    const r = await tickOn(list.id, i.id, on);
    if (!r.ok) failed(r.status);
  };
  const remove = async (i: KitchenItem) => {
    onChange((xs) => xs.filter((x) => x.id !== i.id));
    const r = await removeOn(list.id, i.id);
    if (r.ok) say(`Taken off ${list.name}.`, { list: list.id, id: i.id });
    else failed(r.status);
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    const r = await addOn(list.id, words);
    setBusy(false);
    if (!r.ok) return failed(r.status);
    setText("");
    onChange(() => r.data.items);
    if (r.data.already.length && !r.data.added.length) say(`Already on ${list.name}.`);
  };
  const clear = async () => {
    onChange((xs) => xs.filter((x) => !x.done));
    const r = await clearDoneOn(list.id);
    if (!r.ok) failed(r.status);
  };
  const clearAll = async () => {
    onChange(() => []);
    const r = await clearListOn(list.id);
    if (!r.ok) return failed(r.status);
    say(`Cleared ${list.name}.`, r.data.cleared ? { list: list.id, at: r.data.at } : undefined);
  };
  const drop = async () => {
    const r = await deleteListOn(list.id);
    if (!r.ok) return failed(r.status);
    onDeleted();
    say(`Deleted ${list.name}.`);
  };

  return (
    <section className="hv-ls">
      <h3>
        <button type="button" className="hv-ls-h" aria-expanded={open} aria-controls={`hv-ls-${list.id}`} onClick={onToggle}>
          <span>{list.custom ? <Private>{list.name}</Private> : list.name}</span>
          <b aria-label={`${nOpen} open`}>{nOpen}</b>
          <i aria-hidden="true">{open ? "−" : "+"}</i>
        </button>
      </h3>
      {open && (
        <div id={`hv-ls-${list.id}`} className="hv-ls-body">
          {items.length === 0 ? (
            <p className="hv-ls-empty">Nothing on {list.name}.</p>
          ) : (
            <ul className="hv-ls-l">
              {items.map((i) => (
                <li key={i.id} className={i.done ? "is-done" : ""}>
                  <label>
                    <input type="checkbox" checked={i.done} onChange={(e) => void tick(i, e.target.checked)} />
                    <Private>{i.name}</Private>
                  </label>
                  <button type="button" className="hv-ls-x" aria-label={`Remove ${i.name} from ${list.name}`} onClick={() => void remove(i)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="hv-ls-add" onSubmit={add} aria-label={`Add to ${list.name}`}>
            <input type="text" value={text} maxLength={200} enterKeyHint="done" autoComplete="off" aria-label={`Add to ${list.name}`} placeholder={PLACEHOLDER[list.id] ?? `Add to ${list.name}`} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <button type="submit" disabled={busy || !text.trim()}>
              Add
            </button>
          </form>
          <div className="hv-ls-acts">
            {nDone > 0 && (
              <button type="button" className="hv-ls-clear" onClick={() => void clear()}>
                Clear ticked ({nDone})
              </button>
            )}
            {items.length > 0 && <AskFirst label="Clear list" ask="Are you sure you want to delete this?" onYes={() => void clearAll()} />}
            {list.custom && <AskFirst label="Delete list" ask={`Are you sure you want to delete ${list.name}?`} onYes={() => void drop()} />}
          </div>
        </div>
      )}
    </section>
  );
}

export function HavenLists() {
  const auth = useDeskAuth((s) => s.auth.status);
  const signedIn = auth === "in";
  const [lists, setLists] = useState<ListView[] | null>(null);
  const [counts, setCounts] = useState<ListCount[] | null>(null);
  // Folded until he opens one; the remembered state only holds what he has opened before.
  const [folds, setFolds] = useState<Partial<Record<FoldId, boolean>>>(() => (typeof window === "undefined" ? {} : readOpen()));
  const [note, setNote] = useState<{ line: string; undo?: Undo } | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [making, setMaking] = useState(false);
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

  const toggle = (id: FoldId) =>
    setFolds((f) => {
      const next = { ...f, [id]: !f[id] };
      keepOpen(next);
      return next;
    });
  const say: Say = (line, undo) => {
    window.clearTimeout(noteTimer.current);
    setNote({ line, undo });
    noteTimer.current = window.setTimeout(() => setNote(null), undo ? 6_000 : 3_000);
  };
  const failed = (status: number) => {
    if (status === 401) useDeskAuth.getState().lost();
    else say("That didn't go through. Try again.");
    read();
  };
  const patch = (id: ListId, fn: (items: KitchenItem[]) => KitchenItem[]) => setLists((ls) => ls?.map((l) => (l.id === id ? { ...l, items: fn(l.items) } : l)) ?? ls);
  const undo = async () => {
    const u = note?.undo;
    if (!u) return;
    setNote(null);
    const r = "at" in u ? await undoClearOn(u.list, u.at) : await undoRemoveOn(u.list, u.id);
    if (!r.ok) failed(r.status);
    else read();
  };
  const make = async (e: FormEvent) => {
    e.preventDefault();
    const words = name.trim();
    if (!words || making) return;
    setMaking(true);
    const r = await newList(words);
    setMaking(false);
    if (!r.ok) {
      if (r.status === 401) return useDeskAuth.getState().lost();
      return say(NEW_LIST_NOTE[r.error] ?? "That didn't go through. Try again.");
    }
    const made = r.data.list;
    setName("");
    setNaming(false);
    setLists((ls) => [...(ls ?? []), made]);
    setFolds((f) => {
      const next = { ...f, [made.id]: true };
      keepOpen(next);
      return next;
    });
  };

  if (!(signedIn ? lists : counts)?.length) return null;
  const total = signedIn ? (lists ?? []).reduce((n, l) => n + l.items.filter((i) => !i.done).length, 0) : (counts ?? []).reduce((n, c) => n + c.open, 0);
  const panelOpen = !!folds.panel;

  return (
    <aside className="hv-lists" aria-label="Lists">
      <button type="button" className="hv-lists-h" aria-expanded={panelOpen} aria-controls="hv-lists-body" onClick={() => toggle("panel")}>
        <span>Lists</span>
        <b aria-label={`${total} open`}>{total}</b>
        <i aria-hidden="true">{panelOpen ? "−" : "+"}</i>
      </button>
      {panelOpen && (
        <div id="hv-lists-body" className="hv-lists-body">
          {signedIn ? (
            <>
              {(lists ?? []).map((l) => (
                <Section key={l.id} list={l} open={!!folds[l.id]} onToggle={() => toggle(l.id)} onChange={(fn) => patch(l.id, fn)} onDeleted={() => setLists((ls) => ls?.filter((x) => x.id !== l.id) ?? ls)} say={say} failed={failed} />
              ))}
              {naming ? (
                <form className="hv-ls-add hv-ls-new" onSubmit={make} aria-label="New list">
                  <input type="text" value={name} maxLength={40} autoFocus enterKeyHint="done" autoComplete="off" aria-label="New list's name" placeholder="Name it: “Hardware store”" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(false)} disabled={making} />
                  <button type="submit" disabled={making || !name.trim()}>
                    Make
                  </button>
                </form>
              ) : (
                <button type="button" className="hv-ls-newb" onClick={() => setNaming(true)}>
                  + New list
                </button>
              )}
              <p className="hv-ls-foot" role="status" aria-live="polite">
                {note && (
                  <>
                    <span>{note.line}</span>
                    {note.undo && (
                      <button type="button" onClick={() => void undo()}>
                        Undo
                      </button>
                    )}
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="hv-ls-counts">
              {(counts ?? []).map((c) => (
                <span key={c.id}>
                  {c.name} <b>{c.open}</b>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
