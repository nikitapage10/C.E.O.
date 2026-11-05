import { useEffect } from "react";
import { roomMicOf, voiceTargetOf } from "@ceo/engine/voice";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { useSkippy } from "../skippy/chat.ts";
import { useTalk } from "../skippy/talk.ts";
import {
  handsFreeOff,
  handsFreeOn,
  handsFreeSupported,
  micPress,
  micRelease,
  micReset,
  micSupported,
  runAction,
  setVoiceTarget,
  useRoomMic,
} from "./roomVoice.ts";
import "./roommic.css";

/**
 * The rooms' voice (#638), shared chrome on every Desk page (docs/ROOMS.md, "The room voice"). Bottom right, the dock:
 * Ask Skippy, large, which opens his chat and Talk (Nikita, 02:05Z: "a little bit more prominent… in the bottom right,
 * not in the top"), and on every room's page but Today a mic in the room's submind's colour. Press the mic (or hold
 * Space) and it listens at once; release, or tap and pause, and the words go to the room's submind; the answer plays in
 * Skippy's voice and its line shows for a moment. Escape stops it. In the bar, `HandsFree`: one tap and it keeps
 * listening, page to page, each thing said going to whoever leads the page Nikita is on. One listener for both
 * (roomVoice.ts). Not an "Ask Skippy" panel on a room: the exchanges live in the Council on Today.
 */
export function VoiceDock({ route }: { route: string }) {
  const auth = useDeskAuth((s) => s.auth.status);
  const chatOpen = useSkippy((s) => s.open);
  const setChat = useSkippy((s) => s.setOpen);
  const calling = useTalk((s) => s.phase !== "idle");
  const signedIn = auth === "in";

  // Hands-free follows the page; it waits while Ask Skippy or a call has the floor, and signed out.
  useEffect(() => {
    setVoiceTarget(signedIn && !chatOpen && !calling ? voiceTargetOf(route) : null);
  }, [route, signedIn, chatOpen, calling]);
  useEffect(() => {
    if (auth === "out") handsFreeOff();
  }, [auth]);

  if (chatOpen) return null;
  const mic = roomMicOf(route);
  const showMic = !!mic && signedIn && !calling && micSupported();
  const lead = voiceTargetOf(route);
  return (
    <div className="vdock" style={{ "--mic": (mic ?? lead)?.colour ?? "#8fd8ff" } as React.CSSProperties}>
      <HandsFreeChip />
      <VoiceLine name={lead?.name ?? "Skippy"} />
      <div className="vdock__row">
        {showMic && <MicButton room={mic.room} name={mic.name} />}
        <button
          type="button"
          className="desk__skippy vdock__ask"
          onClick={() => setChat(true)}
          aria-expanded={false}
          aria-controls="skippy-chat"
          title="Ask Skippy: chat, or Talk on a call"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.8 7.6C5.9 4.7 8.7 3.4 12 3.4s6.1 1.3 8.2 4.2c-2.5-.8-5.2-1.1-8.2-1.1s-5.7.3-8.2 1.1z" fill="currentColor" />
            <rect x="7.4" y="8.2" width="9.2" height="12.6" rx="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="10.3" cy="14.4" r="1" fill="currentColor" />
            <circle cx="13.7" cy="14.4" r="1" fill="currentColor" />
          </svg>
          <span>Ask Skippy</span>
        </button>
      </div>
    </div>
  );
}

/** "listening · the Messenger": hands-free's state in the dock, in the lead's colour, so it reads on a phone too. */
function HandsFreeChip() {
  const hf = useRoomMic((s) => s.hf);
  const target = useRoomMic((s) => s.target);
  const busy = useRoomMic((s) => s.phase !== "idle" && s.phase !== "said");
  const ownListening = useRoomMic((s) => !!s.own?.listening);
  if (hf !== "on") return null;
  const live = target && !ownListening;
  return (
    <button
      type="button"
      className="vdock__hf"
      data-state={!live ? "waiting" : busy ? "busy" : "on"}
      style={{ "--hf": target?.colour ?? "#8fd8ff" } as React.CSSProperties}
      onClick={() => handsFreeOff()}
      title="Hands-free is on. Tap to stop."
    >
      {live ? `listening · ${target.name}` : "hands-free · waiting"}
    </button>
  );
}

/** The one line above the dock: what's being heard, the one waiting line, or the answer and any buttons it offers. */
function VoiceLine({ name }: { name: string }) {
  const phase = useRoomMic((s) => s.phase);
  const heard = useRoomMic((s) => s.heard);
  const hfHeard = useRoomMic((s) => s.hfHeard);
  const waiting = useRoomMic((s) => s.waiting);
  const say = useRoomMic((s) => s.say);
  const failed = useRoomMic((s) => s.failed);
  const actions = useRoomMic((s) => s.actions);
  const ms = useRoomMic((s) => s.ms);
  const line = phase === "listening" ? heard || "Listening…" : phase === "thinking" ? (waiting ?? "") : phase === "idle" ? hfHeard : say;
  if (!line) return null;
  const mine = phase === "listening" || phase === "speaking" || (phase === "said" && !failed) || (phase === "idle" && !!hfHeard);
  return (
    <div className={`vdock__line${failed ? " is-failed" : ""}`} data-phase={phase} data-ms={ms ?? undefined} role="status" aria-live="polite">
      {phase === "idle" && <span className="vdock__to">to {name}</span>}
      <p>{mine ? <Private>{line}</Private> : line}</p>
      {actions.length > 0 && (phase === "speaking" || phase === "said") && (
        <div className="vdock__acts">
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={() => runAction(a)}>
              {a.label.slice(0, 32)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const editable = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");

function MicButton({ room, name }: { room: string; name: string }) {
  const phase = useRoomMic((s) => s.phase);

  // A new room is a new conversation on the mic; leaving the page stops it.
  useEffect(() => {
    micReset(room);
    return () => micReset(null);
  }, [room]);

  // Space: hold to talk, anywhere on the page but a text field. Escape stops everything.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useRoomMic.getState().phase !== "idle") return micReset();
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey || editable(e.target) || useRoomMic.getState().own?.space) return;
      e.preventDefault();
      if (!e.repeat) micPress(room);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || editable(e.target) || useRoomMic.getState().own?.space) return;
      e.preventDefault();
      micRelease();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [room]);

  const label = phase === "listening" ? `Listening for ${name}: release or tap to send` : `Talk to ${name} (hold Space)`;
  return (
    <button
      type="button"
      className="vdock__mic"
      data-phase={phase}
      aria-label={label}
      aria-pressed={phase === "listening"}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        micPress(room);
      }}
      onPointerUp={micRelease}
      onPointerCancel={micRelease}
      onKeyDown={(e) => {
        // Enter works like a tap; Space is the page's own hold-to-talk.
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (e.repeat) return;
        micPress(room);
        micRelease();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MicGlyph />
      <span className="vdock__ring" aria-hidden="true" />
    </button>
  );
}

const MicGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/**
 * Hands-free, in the bar beside the account button (Nikita, 02:05Z: "a button in the top right that I can activate, so
 * that when I go from room to room, it actually will be always listening for that room by the submind"). One tap on,
 * one tap off; off by itself after ten quiet minutes. Signed in, and only where the browser hears words itself.
 */
/**
 * The bar's Hands-free since the Iris (#666): the switch lives in the Boiler Room's Settings, and the bar shows it only
 * while it is on, saying who it is listening for, so listening is never on out of sight. A tap stops it.
 */
export function HandsFreeLive() {
  const on = useRoomMic((s) => s.hf === "on");
  return on ? <HandsFree /> : null;
}

export function HandsFree() {
  const auth = useDeskAuth((s) => s.auth.status);
  const hf = useRoomMic((s) => s.hf);
  const target = useRoomMic((s) => s.target);
  const busy = useRoomMic((s) => s.phase !== "idle" && s.phase !== "said");
  const ownListening = useRoomMic((s) => !!s.own?.listening);
  if (auth !== "in" || !handsFreeSupported()) return null;
  const on = hf === "on";
  const live = target && !ownListening;
  const state = !on ? "off" : !live ? "waiting" : busy ? "busy" : "on";
  const label = !on ? "Hands-free" : live ? `Listening · ${target.name}` : "Hands-free · waiting";
  const title = !on
    ? "Hands-free: keep listening, page to page, for whoever leads the page you're on"
    : live
      ? `Listening for ${target.name}. Tap to stop.`
      : ownListening
        ? "Hands-free waits while this page's own listening is on. Tap to stop."
        : "Hands-free waits while Skippy's chat or a call is open. Tap to stop.";
  return (
    <button
      type="button"
      className="wv-navbtn hfree"
      data-state={state}
      aria-pressed={on}
      title={title}
      onClick={() => (on ? handsFreeOff() : handsFreeOn())}
      style={{ "--mic": target?.colour ?? "#8fd8ff" } as React.CSSProperties}
    >
      <MicGlyph />
      <span>{label}</span>
    </button>
  );
}
