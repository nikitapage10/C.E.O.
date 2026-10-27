import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runAction } from "./actions.ts";
import { AnswerCard } from "./AnswerCard.tsx";
import { handedName } from "./asked.ts";
import { canSpeak, stopSpeaking, useSkippy, type ActionState, type SkippyAction, type Turn } from "./chat.ts";
import { useHide } from "../hide.ts";
import { Private } from "../Private.tsx";
import { SkippyComposer } from "./SkippyChat.tsx";
import { SKIPPY_PORTRAIT } from "./SkippyAvatar.tsx";
import { SkippyLine, TalkUsage } from "./SkippyLine.tsx";
import { useTalk } from "./talk.ts";
import { useDeskAuth } from "../signin.ts";
import { stripTags } from "../hologram/tags.ts";
import "./skippy.css";

/** The open dialogue, its own download: the Desk loads it the first time Skippy is opened (first-load budget). */

/** A turn as it reads: a voice line's audio tags ("[smug]", #490) are for the voice, not the transcript. */
const spoken = (t: Turn) => (t.who === "nikita" ? t.text : stripTags(t.text));

const ACTION_DONE: Record<ActionState, string> = { busy: "Sending…", done: "Done", held: "Held back", "signed-out": "Sign in first", failed: "Didn't work" };

function ActionChips({ turn }: { turn: Turn }) {
  const mark = useSkippy((s) => s.mark);
  const [held, setHeld] = useState("");
  const hidden = useHide((s) => s.on);
  const tap = async (a: SkippyAction, i: number) => {
    mark(turn.id, i, "busy");
    const state = await runAction(a, setHeld);
    mark(turn.id, i, state);
    if (state === "done" && (a.kind === "open" || a.kind === "lattice")) useSkippy.getState().setOpen(false);
  };
  if (!turn.actions?.length) return null;
  return (
    <div className="skp-chips">
      {turn.actions.map((a, i) => {
        const state = turn.done?.[i];
        const writes = a.kind === "idea" || a.kind === "answer";
        return (
          <button
            key={i}
            type="button"
            className={`skp-chip skp-chip--${a.kind}${state ? ` skp-chip--${state}` : ""}`}
            disabled={state === "busy" || (writes && state === "done")}
            onClick={() => void tap(a, i)}
            title={hidden ? undefined : a.kind === "idea" ? `Files this as an idea for Rivet to shape: ${a.text}` : a.kind === "answer" ? `Answers Rivet on #${a.issue}: ${a.text}` : undefined}
          >
            <span>{a.label}</span>
            {state && state !== "busy" && writes && <em>{ACTION_DONE[state]}</em>}
            {state === "busy" && <em>{ACTION_DONE.busy}</em>}
          </button>
        );
      })}
      {turn.actions.some((a) => a.kind === "idea" || a.kind === "answer") && <p className="skp-chips__note">Nothing is sent until you tap.</p>}
      {held && <p className="skp-compose__err">{held}</p>}
    </div>
  );
}

export interface SkippyChatProps {
  /** Where it sits: "dock" floats over the page's corner (a sheet at phone width), "inline" fills its container. */
  placement?: "dock" | "inline";
  /** Shown when the store says it's open; an inline chat is always shown. */
  className?: string;
  /** Where focus goes back to when it closes (the avatar that opened it). */
  returnFocus?: React.RefObject<HTMLElement | null>;
}

/**
 * The dialogue with Skippy: what was said, his buttons, and the text box with a mic. Optional spoken replies (the
 * browser's own voice) with a toggle. Esc closes it and focus goes back where it came from.
 */
export function SkippyChat({ placement = "dock", className = "", returnFocus }: SkippyChatProps) {
  const open = useSkippy((s) => s.open);
  const turns = useSkippy((s) => s.turns);
  const busy = useSkippy((s) => s.busy);
  const voice = useSkippy((s) => s.voice);
  const setVoice = useSkippy((s) => s.setVoice);
  const setOpen = useSkippy((s) => s.setOpen);
  const clear = useSkippy((s) => s.clear);
  const list = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const shown = placement === "inline" || open;
  const talking = useTalk((s) => s.phase !== "idle");
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  // This month's talk minutes (#434), asked for when the chat opens signed in.
  useEffect(() => {
    if (shown && signedIn) void useTalk.getState().refresh();
  }, [shown, signedIn]);

  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, shown]);

  const close = () => {
    void useTalk.getState().end();
    setOpen(false);
    stopSpeaking();
    returnFocus?.current?.focus();
  };
  useEffect(() => {
    if (!shown || placement === "inline") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!shown) return null;
  const dialog = (
    <section id="skippy-chat" className={`skp-chat skp-chat--${placement} ${className}`} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header className="skp-chat__head">
        <img className="skp-chat__face" src={SKIPPY_PORTRAIT} alt="" width={40} height={40} />
        <div className="skp-chat__who">
          <h2 id={titleId}>Skippy, the Magnificent</h2>
          <p>{talking ? "On the line, magnificently" : busy ? "Thinking, magnificently…" : "Runs C.E.O. Routes anything you ask."}</p>
        </div>
        {canSpeak() && (
          <button type="button" className={`skp-chat__icon${voice ? " on" : ""}`} aria-pressed={voice} onClick={() => setVoice(!voice)} title={voice ? "Stop reading replies aloud" : "Read replies aloud"} aria-label="Read replies aloud">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
              {voice ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
            </svg>
          </button>
        )}
        {turns.length > 0 && (
          <button type="button" className="skp-chat__icon" onClick={clear} title="Start over" aria-label="Start a new conversation">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {placement === "dock" && (
          <button type="button" className="skp-chat__icon" onClick={close} aria-label="Close the chat" title="Close (Esc)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </header>
      <ol className="skp-chat__list" ref={list} aria-live="polite" aria-relevant="additions" tabIndex={0} aria-label="Conversation">
        {turns.length === 0 && (
          <li className="skp-turn skp-turn--skippy skp-turn--hello">
            <p>Ah, the C.E.O. Ask me what's waiting, what's building, or tell me an idea and I'll route it. Magnificently.</p>
          </li>
        )}
        {turns.map((t) => (
          <li key={t.id} className={`skp-turn skp-turn--${t.who}${t.note ? " skp-turn--note" : ""}${t.pending ? " skp-turn--pending" : ""}${t.from ? " skp-turn--answer" : ""}`} aria-busy={t.pending ? true : undefined}>
            <span className="skp-sr">{t.who === "nikita" ? "You:" : t.note ? "Desk:" : t.from ? `${t.from === "skippy" ? "The deeper Skippy" : handedName(t.from)}:` : "Skippy:"}</span>
            {t.from && (
              <p className="skp-turn__from" aria-hidden="true">
                {t.from === "skippy" ? "The deeper Skippy" : handedName(t.from)} {t.pending ? "says, still pondering" : "answered"}
              </p>
            )}
            <p>{t.note || (t.pending && !t.from) ? t.text : <Private>{spoken(t)}</Private>}</p>
            {t.card && (
              <Private block as="div">
                <AnswerCard card={t.card} />
              </Private>
            )}
            {t.who === "skippy" && !t.pending && <ActionChips turn={t} />}
          </li>
        ))}
        {busy && (
          <li className="skp-turn skp-turn--skippy skp-turn--typing" aria-label="Skippy is thinking">
            <i />
            <i />
            <i />
          </li>
        )}
      </ol>
      {talking ? (
        <SkippyLine />
      ) : (
        <>
          <SkippyComposer autoFocus />
          {signedIn && <TalkUsage />}
        </>
      )}
    </section>
  );
  // The dock floats over the viewport, so it lives at the Desk's root (its tokens and resets, none of its panels):
  // a panel's backdrop-filter would otherwise pin "fixed" to that panel instead of the screen. Off the Desk, the body.
  if (placement !== "dock" || typeof document === "undefined") return dialog;
  return createPortal(dialog, document.querySelector(".desk") ?? document.body);
}
