import { useEffect } from "react";
import { roomMicOf, SKIPPY_VOICE, voiceTargetOf } from "@ceo/engine/voice";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { useIsPhone } from "@ceo/engine/web/phone.ts";
import { useSkippy } from "../skippy/chat.ts";
import { useTalk } from "../skippy/talk.ts";
import { holdHint, PRIORITY, registerHoldToTalk, useHoldToTalk } from "../holdToTalk.ts";
import {
  handsFreeOff,
  handsFreeOn,
  handsFreeSupported,
  micFinish,
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
 * Space on any page, holdToTalk.ts) and it listens at once; release, or tap and pause, and the words go to the room's submind; the answer plays in
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
  // On a phone Ask Skippy is the bottom bar's middle slot (#1045, PhoneNav.tsx): the dock keeps the mic and the line.
  const phone = useIsPhone();

  // Hands-free follows the page; it waits while Ask Skippy or a call has the floor, and signed out.
  useEffect(() => {
    setVoiceTarget(signedIn && !chatOpen && !calling ? voiceTargetOf(route) : null);
  }, [route, signedIn, chatOpen, calling]);
  useEffect(() => {
    if (auth === "out") handsFreeOff();
  }, [auth]);

  // Hold Space on any page (#905, holdToTalk.ts): the page's lead listens while it is held, and the words go on release.
  // The page's default; the Senate in session and a room's own handler take Space over while they are mounted.
  useEffect(
    () =>
      registerHoldToTalk(
        {
          start: () => {
            const said = holdBlocked(auth, chatOpen, calling);
            if (said) return holdHint(said);
            micPress((roomMicOf(route) ?? voiceTargetOf(route) ?? SKIPPY_VOICE).room);
          },
          end: () => {
            if (useRoomMic.getState().phase === "listening") void micFinish();
          },
          cancel: () => {
            if (useRoomMic.getState().phase === "listening") micReset();
          },
          ownIndicator: true,
        },
        PRIORITY.page,
      ),
    [route, auth, chatOpen, calling],
  );
  // Escape stops whatever the voice is doing, on every page.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && useRoomMic.getState().phase !== "idle" && micReset();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  if (chatOpen) return <HoldPill />;
  const mic = roomMicOf(route);
  const showMic = !!mic && signedIn && !calling && micSupported();
  const lead = voiceTargetOf(route);
  return (
    <div className="vdock" data-shot-skip="" style={{ "--mic": (mic ?? lead)?.colour ?? "#8fd8ff" } as React.CSSProperties}>
      <HoldPill />
      <HandsFreeChip />
      <VoiceLine name={lead?.name ?? "Skippy"} />
      <div className="vdock__row">
        {showMic && <MicButton room={mic.room} name={mic.name} />}
        {!phone && (
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
        )}
      </div>
    </div>
  );
}

/**
 * Why a held Space can't listen here, in a short line, or null when it can (#905): signed out, a browser that can't hear,
 * Skippy's chat or a call already has the floor.
 */
export function holdBlocked(auth: string, chatOpen: boolean, calling: boolean, supported: boolean = micSupported()): string | null {
  if (auth !== "in") return auth === "out" ? "Sign in on the Desk to talk to Skippy." : "Checking your sign-in…";
  if (!supported) return "This browser can't hear you here.";
  if (calling) return "You're on a call with Skippy.";
  if (chatOpen) return "Skippy's chat is open: type, or use Talk.";
  return null;
}

/** The held Space's small pill (#905): listening while it is held (when the handler shows nothing of its own), or a hint. */
export function HoldPill() {
  const held = useHoldToTalk((s) => s.held && !s.own);
  const heard = useHoldToTalk((s) => s.heard);
  const hint = useHoldToTalk((s) => s.hint);
  if (!held && !hint) return null;
  return (
    <div className={`vdock__hold${hint ? " is-hint" : ""}`} role="status" aria-live="polite">
      {hint ? (
        hint
      ) : (
        <>
          <i aria-hidden="true" />
          {heard ? <Private>{heard}</Private> : "Listening… let go of Space to send"}
        </>
      )}
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

function MicButton({ room, name }: { room: string; name: string }) {
  const phase = useRoomMic((s) => s.phase);

  // A new room is a new conversation on the mic; leaving the page stops it.
  useEffect(() => {
    micReset(room);
    return () => micReset(null);
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
