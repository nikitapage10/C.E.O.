import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useTexts, type TextItem } from "../data/texts.ts";
import { flip, GROUP_REPLY_MAX, replyOf, swipeOf } from "../data/groups.ts";
import { Said } from "./Said.tsx";
import { EmojiPicker, Tapbacks } from "./Tapbacks.tsx";
import { undoable, UNDO_MS } from "../data/thread.ts";
import "./groups.css";

/**
 * The group flipper (#805), in the Codex's Groups section: one group chat at a time. ‹ and › (or the arrow keys, or a
 * swipe) flip to the next, the dots jump; the group's recent texts scroll in one column, newest at the foot; the box
 * under them replies to the group. Groups are never drafted for, so the reply is Nikita's own words, sent exactly as
 * typed once the Undo window has passed, with this device's passkey unlock, and the flipper moves on to the next group.
 * Nothing sends without that Send tap (or ⌘/Ctrl+Enter in the box). Every word is wrapped in <Private> for Hide mode,
 * and the box can't send while Hide is on.
 */

interface Sending {
  id: string;
  name: string;
  /** The words as they will go, back in the box on Undo. */
  words: string;
  until: number;
}

export function GroupFlipper({ groups, hidden, unlocked, open }: { groups: TextItem[]; hidden: boolean; unlocked: boolean; open?: { id: string; at: number } | null }) {
  const [cur, setCur] = useState<string | null>(null);
  // The stage's Groups shelf (#869) opens a group here.
  useEffect(() => {
    if (open) setCur(open.id);
  }, [open]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Sending | null>(null);
  const [note, setNote] = useState<{ text: string; warn?: boolean; unlock?: boolean } | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const undo = useRef(undoable());
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  const found = groups.findIndex((g) => g.id === cur);
  const i = found < 0 ? 0 : found;
  const g = groups[i];
  const n = groups.length;

  // A waiting send goes when the page closes (as the Thread's does); the countdown ticks only while one waits.
  useEffect(() => () => undo.current.flush(), []);
  useEffect(() => {
    if (!sending) return;
    const t = window.setInterval(() => setTick(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [sending]);
  // Each group opens at its newest text, at the column's foot.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [g?.id, g?.messages?.length]);

  if (!g) return null;

  const go = (dir: -1 | 1) => {
    if (n > 1) setCur(groups[flip(i, n, dir)]!.id);
  };
  const words = replyOf(typed[g.id] ?? "");

  const send = () => {
    if (!words || hidden || sending) return;
    if (!unlocked) {
      setNote({ text: "Sending is locked on this device.", warn: true, unlock: true });
      return;
    }
    const at = Date.now();
    const target = { id: g.id, name: g.name, words };
    setSending({ ...target, until: at + UNDO_MS });
    setTick(at);
    setNote(null);
    setTyped((t) => ({ ...t, [target.id]: "" }));
    go(1);
    undo.current.start(target.id, () => {
      setSending(null);
      void useTexts
        .getState()
        .ask({ action: "send", thread: target.id, draftAt: 0, text: words })
        .then((ok) => setNote(ok ? { text: `Sent to ${target.name}` } : { text: useTexts.getState().error ?? "That didn't go through.", warn: true }));
    });
  };
  const takeBack = () => {
    const id = undo.current.undo();
    if (!id || !sending) return;
    // The words come back to the box, and the flipper to that group.
    const back = sending.words;
    setTyped((t) => ({ ...t, [id]: t[id] || back }));
    setCur(id);
    setSending(null);
    setNote({ text: "Not sent." });
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "TEXTAREA") {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send();
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      go(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const onDown = (e: PointerEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    down.current = el.closest("textarea, button") ? null : { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent<HTMLElement>) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dir = swipeOf(e.clientX - d.x, e.clientY - d.y);
    if (dir) go(dir);
  };

  const left = sending ? Math.max(0, Math.ceil((sending.until - tick) / 1000)) : 0;
  const locked = !unlocked;
  return (
    <section className="cx-gf" aria-roledescription="carousel" aria-label="Group chats" tabIndex={0} onKeyDown={onKey} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (down.current = null)}>
      <header className="cx-gf-top">
        <button type="button" className="cx-gf-arrow" onClick={() => go(-1)} disabled={n < 2} aria-label="Previous group">
          ‹
        </button>
        <div className="cx-gf-name" aria-live="polite">
          <h4>
            <Private>{g.name}</Private>
          </h4>
          <span className="cx-gf-count">
            {i + 1} / {n}
            {(g.state !== "settled" || g.summary?.asked) && <span className="cx-unread"> · asks you</span>}
          </span>
        </div>
        <button type="button" className="cx-gf-arrow" onClick={() => go(1)} disabled={n < 2} aria-label="Next group">
          ›
        </button>
      </header>
      {n > 1 && (
        <div className="cx-gf-dots" role="tablist" aria-label="Groups">
          {groups.map((x, k) => (
            <button key={x.id} type="button" role="tab" aria-selected={k === i} aria-label={`Group ${k + 1}`} onClick={() => setCur(x.id)} />
          ))}
        </div>
      )}
      <div className="cx-gf-msgs" ref={scroller} key={g.id}>
        {g.summary && (
          <p className="cx-gist">
            <Private>{g.summary.text}</Private>
          </p>
        )}
        {g.messages?.length ? <Said messages={g.messages} hidden={hidden} /> : <p className="cx-quiet">Only the summary for this one.</p>}
        <Tapbacks thread={g.id} messages={g.messages} hidden={hidden} />
      </div>
      <form
        className="cx-own cx-gf-reply"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="cx-sr" htmlFor={`cx-gf-${g.id}`}>
          Your reply to the group, sent exactly as you type it
        </label>
        <textarea
          id={`cx-gf-${g.id}`}
          ref={box}
          value={typed[g.id] ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setTyped((t) => ({ ...t, [g.id]: v }));
          }}
          rows={Math.min(5, Math.max(1, (typed[g.id] ?? "").split("\n").length))}
          maxLength={GROUP_REPLY_MAX}
          placeholder="Reply to the group. It goes exactly as typed."
          data-private=""
        />
        <div className="cx-acts cx-gf-acts">
          {locked ? (
            <button type="button" className="cx-opt is-yes" onClick={() => void useTexts.getState().unlock()} title="One passkey check unlocks sending on this device for 72 hours">
              Unlock to send
            </button>
          ) : (
            <button type="submit" className="cx-opt is-yes" disabled={!words || hidden || !!sending} title="Waits a few seconds for Undo, then sends · ⌘/Ctrl+Enter">
              Send as typed
            </button>
          )}
          <EmojiPicker box={box} value={typed[g.id] ?? ""} set={(v) => setTyped((t) => ({ ...t, [g.id]: v }))} />
          <span className="cx-gf-status" role="status" aria-live="polite">
            {sending ? (
              <>
                Sending to <Private>{sending.name}</Private> <b>{left}</b>{" "}
                <button type="button" className="cx-lnk" onClick={takeBack}>
                  Undo
                </button>
              </>
            ) : note ? (
              <span data-warn={note.warn || undefined}>
                <Private>{note.text}</Private>
                {note.unlock && (
                  <>
                    {" "}
                    <button type="button" className="cx-lnk" onClick={() => void useTexts.getState().unlock()}>
                      Unlock
                    </button>
                  </>
                )}
              </span>
            ) : null}
          </span>
        </div>
      </form>
    </section>
  );
}
