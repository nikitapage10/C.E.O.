import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { onWrote, touchesLists } from "../../../apps/world/src/desk/skippy/wrote.ts";
import { addOn, clearDoneOn, loadCounts, loadLists, removeOn, tickOn, undoRemoveOn, type KitchenItem, type ListCount, type ListId, type ListView } from "../../../apps/world/src/desk/haven.ts";
import "./lists.css";

/**
 * Lists in the Haven (#735, moved off Today): a collapsible panel on the left of the Haven page, one folding section
 * per private list (api/_haven/list.ts `LISTS`: Groceries, the Kitchen list, and Things to buy). Everything starts
 * folded; once he opens one, the open/shut state is remembered on this device. Signed in, a section shows its items to
 * tick off or × away (Undo for a few seconds), a quick add, and Clear ticked. Signed out it shows the counts only,
 * never an item. Nothing here buys anything.
 */

type FoldId = "panel" | ListId;
const KEEP = "ceo.haven.lists.open";
const readOpen = (): Partial<Record<FoldId, boolean>> => {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEEP) ?? "{}") as Record<string, unknown>;
    return { panel: v.panel === true, kitchen: v.kitchen === true, buy: v.buy === true };
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

const PLACEHOLDER: Record<ListId, string> = { kitchen: "Add groceries: “oat milk, lemons”", buy: "Add a thing to buy: “phone charger”" };

type Say = (line: string, undo?: { list: ListId; id: string }) => void;

function Section({ list, open, onToggle, onChange, say, failed }: { list: ListView; open: boolean; onToggle: () => void; onChange: (fn: (items: KitchenItem[]) => KitchenItem[]) => void; say: Say; failed: (status: number) => void }) {
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

  return (
    <section className="hv-ls">
      <h3>
        <button type="button" className="hv-ls-h" aria-expanded={open} aria-controls={`hv-ls-${list.id}`} onClick={onToggle}>
          <span>{list.name}</span>
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
            <input type="text" value={text} maxLength={200} enterKeyHint="done" autoComplete="off" aria-label={`Add to ${list.name}`} placeholder={PLACEHOLDER[list.id]} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <button type="submit" disabled={busy || !text.trim()}>
              Add
            </button>
          </form>
          {nDone > 0 && (
            <button type="button" className="hv-ls-clear" onClick={() => void clear()}>
              Clear ticked ({nDone})
            </button>
          )}
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
    const r = await undoRemoveOn(u.list, u.id);
    if (!r.ok) failed(r.status);
    else read();
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
                <Section key={l.id} list={l} open={!!folds[l.id]} onToggle={() => toggle(l.id)} onChange={(fn) => patch(l.id, fn)} say={say} failed={failed} />
              ))}
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
