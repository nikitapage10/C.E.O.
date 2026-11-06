import { useEffect, useRef, useState } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useRoomShown } from "@ceo/engine/web/roomReady.ts";
import { readTapback, REASON_WORDS, TAPBACKS_HINT, type ShownText } from "../../../api/_relay/texts.ts";
import { useTexts } from "../data/texts.ts";
import { lastRequest } from "../data/thread.ts";
import { EMOJI, insertAt, reactable, stepLine, TAPBACK_FACE, TAPBACKS, tapbackTarget, type Tapback } from "../data/react.ts";

/**
 * Tapbacks on the Relay card (#888): iMessage's six, small, under their words, on their latest line unless Nikita steps
 * to an earlier one. Each tap is one send request (the unlock, single-use, 10 minutes) that the Mac turns into a tapback
 * through BlueBubbles; nothing goes without the tap, and the thread stays where it is. With the Mac's Private API off,
 * one quiet line says so instead of the buttons.
 */
export function Tapbacks({ thread, messages, hidden }: { thread: string; messages: readonly ShownText[] | undefined; hidden: boolean }) {
  const view = useTexts((s) => s.view);
  const busy = useTexts((s) => s.busy);
  const [picked, setPicked] = useState<string | null>(null);
  const lines = reactable(messages);
  if (!lines.length || !view) return null;
  if (view.tapbacks === "off")
    return (
      <p className="cx-tbnote" title={TAPBACKS_HINT}>
        Tapbacks need BlueBubbles' Private API turned on, on the Mac.
      </p>
    );
  const target = tapbackTarget(messages, picked);
  if (!target?.ref) return null;
  const latest = target === lines.at(-1);
  const unlocked = !!view.unlockedUntil && view.unlockedUntil > Date.now();
  const req = lastRequest(
    view.requests.filter((r) => r.kind === "react"),
    thread,
  );
  const got = req ? readTapback(req.text) : null;
  const onThis = got?.ref === target.ref ? got : null;
  const going = busy?.startsWith(`react:${thread}`) || (onThis && (req!.state === "waiting" || req!.state === "taken"));
  const tap = (t: Tapback) => {
    if (!unlocked) return void useTexts.getState().unlock();
    void useTexts.getState().ask({ action: "react", thread, ref: target.ref, tapback: t });
  };
  return (
    <div className="cx-tb" role="group" aria-label="Tapback">
      <span className="cx-tbon">
        {lines.length > 1 && (
          <button type="button" className="cx-tbstep" onClick={() => setPicked(stepLine(messages, target.ref!, -1))} disabled={target === lines[0]} aria-label="An earlier message">
            ‹
          </button>
        )}
        <span className="cx-tbwhich">{latest ? "on their latest" : <Private className="cx-tbline">{target.text}</Private>}</span>
        {lines.length > 1 && (
          <button type="button" className="cx-tbstep" onClick={() => setPicked(stepLine(messages, target.ref!, 1))} disabled={latest} aria-label="A later message">
            ›
          </button>
        )}
      </span>
      <span className="cx-tbset">
        {TAPBACKS.map((t) => (
          <button
            key={t}
            type="button"
            className="cx-tbbtn"
            onClick={() => tap(t)}
            disabled={hidden || !!going}
            aria-pressed={onThis?.tapback === t && req?.state === "sent"}
            data-sent={(onThis?.tapback === t && req?.state === "sent") || undefined}
            title={unlocked ? TAPBACK_FACE[t].label : `${TAPBACK_FACE[t].label}: unlock sending first`}
            aria-label={TAPBACK_FACE[t].label}
          >
            {TAPBACK_FACE[t].icon}
          </button>
        ))}
      </span>
      {onThis && req && (
        <span className="cx-tbstate" role="status" aria-live="polite">
          {req.state === "waiting" || req.state === "taken"
            ? "Sending…"
            : req.state === "sent"
              ? "Sent"
              : req.state === "expired"
                ? "Not sent: the Mac was offline."
                : `Not sent: ${req.reason ? REASON_WORDS[req.reason] : "the Mac refused it"}.`}
        </span>
      )}
    </div>
  );
}

/**
 * The composer's emoji (#888): a small button that opens a compact grid; a pick goes in at the cursor of the box
 * `box` points at. Escape or a tap outside closes it.
 */
export function EmojiPicker({ box, value, set }: { box: { current: HTMLTextAreaElement | null }; value: string; set: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const shown = useRoomShown();
  useEffect(() => {
    if (!open || !shown) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        box.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, box, shown]);
  const pick = (e: string) => {
    const el = box.current;
    const got = insertAt(value, el?.selectionStart, el?.selectionEnd, e);
    set(got.text);
    window.setTimeout(() => {
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(got.caret, got.caret);
    }, 0);
  };
  return (
    <span className="cx-emo" ref={wrap}>
      <button type="button" className="cx-opt cx-emobtn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} title="Emoji">
        {"\u{1F642}"}
      </button>
      {open && (
        <span className="cx-emogrid" role="group" aria-label="Emoji">
          {EMOJI.map((x) => (
            <button key={x.e} type="button" onClick={() => pick(x.e)} aria-label={x.name} title={x.name}>
              {x.e}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
