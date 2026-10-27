import { useEffect, useId, useRef, useState } from "react";
import { Mic } from "../IdeaCard.tsx";
import { useDictation } from "../dictate.ts";
import { useDeskAuth } from "../signin.ts";
import { MESSAGE_MAX, loadRoundTrip, stopSpeaking, useSkippy } from "./chat.ts";
import { useTalk } from "./talk.ts";
import "./skippy.css";

/** Whether Nikita can talk to Skippy here, and if not, what to say instead. */
export function useChatGate(): { ready: boolean; hint: string; canSignIn: boolean } {
  const status = useDeskAuth((s) => s.auth.status);
  if (status === "in") return { ready: true, hint: "", canSignIn: false };
  if (status === "out") return { ready: false, hint: "Sign in on the Desk to talk to Skippy.", canSignIn: true };
  if (status === "checking") return { ready: false, hint: "Checking your sign-in…", canSignIn: false };
  return { ready: false, hint: "Skippy's chat needs the Desk's sign-in, which isn't set up on this site.", canSignIn: false };
}

/**
 * The text box with its mic and send button, shared by the dialogue and the compact box on Today. Speech comes from
 * the browser's own recognition (dictate.ts); what was typed before the mic started stays, and the words append.
 */
export function SkippyComposer({ autoFocus = false, compact = false, onSent, placeholder = "Ask Skippy anything…" }: { autoFocus?: boolean; compact?: boolean; onSent?: () => void; placeholder?: string }) {
  const gate = useChatGate();
  const busy = useSkippy((s) => s.busy);
  const send = useSkippy((s) => s.send);
  const signIn = useDeskAuth((s) => s.signIn);
  const [text, setText] = useState("");
  const typed = useRef("");
  const box = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const dictation = useDictation((finished, tail) => setText(`${typed.current}${typed.current && (finished || tail) ? " " : ""}${finished}${finished && tail ? " " : ""}${tail}`.slice(0, MESSAGE_MAX)));
  useEffect(() => {
    if (autoFocus && gate.ready) box.current?.focus({ preventScroll: true });
  }, [autoFocus, gate.ready]);
  const toggleMic = () => {
    if (dictation.listening) dictation.stop();
    else {
      stopSpeaking();
      typed.current = text.trim();
      dictation.start();
    }
  };
  const submit = () => {
    const words = text.trim();
    if (!words || busy || !gate.ready) return;
    dictation.stop();
    setText("");
    onSent?.();
    void send(words);
  };
  return (
    <form
      className={`skp-compose${compact ? " skp-compose--compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={box}
        className="skp-compose__box"
        rows={1}
        value={text}
        maxLength={MESSAGE_MAX}
        disabled={!gate.ready}
        placeholder={gate.ready ? placeholder : gate.hint}
        aria-label="Message to Skippy"
        aria-describedby={gate.ready ? undefined : hintId}
        onFocus={() => void loadRoundTrip().catch(() => null)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {gate.ready && <Mic dictation={dictation} onToggle={toggleMic} label="Say it to Skippy" />}
      {gate.ready && (
        <TalkButton
          onStart={() => {
            dictation.stop();
            if (compact) useSkippy.getState().setOpen(true);
          }}
        />
      )}
      {gate.ready ? (
        <button type="submit" className="btn btn--go btn--sm skp-compose__send" disabled={!text.trim() || busy}>
          {busy ? "…" : "Send"}
        </button>
      ) : gate.canSignIn ? (
        <button type="button" className="btn btn--sm skp-compose__send" onClick={() => void signIn()}>
          Sign in
        </button>
      ) : null}
      {!gate.ready && (
        <span id={hintId} className="skp-sr">
          {gate.hint}
        </span>
      )}
      {dictation.error && <p className="skp-compose__err">{dictation.error}</p>}
    </form>
  );
}

/**
 * The call button (#434): a live voice call with Skippy, on ElevenLabs. The microphone is asked for only after this
 * tap. Off only when talking isn't set up; the site sets no budget or call length (#532), and ElevenLabs' own credits are the limit; typing and
 * the mic beside it carry on either way.
 */
export function TalkButton({ onStart }: { onStart?: () => void }) {
  const phase = useTalk((s) => s.phase);
  const ready = useTalk((s) => s.ready);
  const reason = useTalk((s) => s.reason);
  const start = useTalk((s) => s.start);
  const end = useTalk((s) => s.end);
  const live = phase !== "idle";
  const off = !live && ready === false && (reason === "no-key" || reason === "not-set-up");
  const title = live ? "End the call" : off ? "Talking isn't set up yet" : "Talk to Skippy: a live voice call";
  return (
    <button
      type="button"
      className={`skp-talk${live ? " skp-talk--live" : ""}`}
      aria-pressed={live}
      aria-label={title}
      title={title}
      disabled={off || phase === "ending"}
      // Ready before the tap (#496): the function, its Desk lines and agent check, the call's code and the hologram.
      onPointerEnter={() => useTalk.getState().warm()}
      onFocus={() => useTalk.getState().warm()}
      onTouchStart={() => useTalk.getState().warm()}
      onClick={() => {
        if (live) void end();
        else {
          onStart?.();
          void start();
        }
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      <span>{live ? "End" : "Talk"}</span>
    </button>
  );
}
