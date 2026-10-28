import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { submindOf } from "../../../../../packages/simulator/src/subminds.ts";
import { useSkippy } from "../skippy/chat.ts";
import { clock, talkLevel, talkMute, useTalk } from "../skippy/talk.ts";
import { setHoldMuted, useHold } from "../skippy/hold.ts";
import type { Holo } from "./holoScene.ts";
import { personaOf } from "./persona.ts";
import { expressionOf, stripTags, useHolo, type Expression } from "./signal.ts";
import { PHONE, placeFor, type Place } from "./place.ts";
import "./hologram.css";

/**
 * The hologram call (#481, #490, #538): Skippy, booting up over the chat box. When Talk starts the dock dims, a glitch
 * and scanlines run over it as he boots, and he rises from its bottom edge, the emitter there, to take the panel over.
 * His name, his latest line and the call's pill stay beside the dock on its left (above it when there's no room
 * beside, as on a phone, where the dock is a sheet from the bottom). On End he sinks back down and the chat returns;
 * with less motion it all fades. His face follows the call (signal.ts) and his mouth his voice. When a submind takes
 * the mic the whole projection turns its room's colour, the label takes its name, and the channel glitches over.
 */

const STILL = "(prefers-reduced-motion: reduce)";
/** How long the channel-switch glitch runs when the mic changes hands, in ms. */
const SWITCH_MS = 700;

const media = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;

function placeNow(): Place {
  const r = document.getElementById("skippy-chat")?.getBoundingClientRect() ?? null;
  return placeFor(window.innerWidth, window.innerHeight, r, media(PHONE));
}

export default function HologramStage({ route, leaving = false }: { route: string; leaving?: boolean }) {
  const phase = useTalk((s) => s.phase);
  const mode = useTalk((s) => s.mode);
  const elapsed = useTalk((s) => s.elapsed);
  const end = useTalk((s) => s.end);
  const speaker = useHolo((s) => s.speaker);
  const muted = useHolo((s) => s.muted);
  const hidden = useHolo((s) => s.hidden);
  const holding = useHold((s) => s.playing);
  const holdMuted = useHold((s) => s.muted);
  const aside = useHold((s) => s.aside);
  const dockOpen = useSkippy((s) => s.open);
  const turns = useSkippy((s) => s.turns);
  const firstTurn = useHolo((s) => s.fromTurn);
  const line = [...turns].reverse().find((t) => t.who === "skippy" && !t.note && t.id > firstTurn)?.text ?? "";

  const swappedAt = useHolo((s) => s.swappedAt);
  const [place, setPlace] = useState<Place>(() => placeNow());
  const [switching, setSwitching] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expr, setExpr] = useState<Expression>("thinking");
  const canvas = useRef<HTMLCanvasElement>(null);
  const holo = useRef<Holo | null>(null);
  const levelBars = useRef<HTMLSpanElement>(null);
  const inputs = useRef({ phase, mode, line });
  inputs.current = { phase, mode, line };

  // Where he stands, again whenever the window or the dock changes (the dock shrinks for the call, opens, closes).
  useLayoutEffect(() => {
    const again = () => setPlace((was) => {
      const next = placeNow();
      return JSON.stringify(next) === JSON.stringify(was) ? was : next;
    });
    again();
    window.addEventListener("resize", again);
    const dock = document.getElementById("skippy-chat");
    const watch = typeof ResizeObserver === "function" && dock ? new ResizeObserver(again) : null;
    if (dock) watch?.observe(dock);
    // The dock opens a moment after Talk on Today's Ask line, and eases to its call height.
    const late = [120, 400, 900].map((ms) => window.setTimeout(again, ms));
    return () => {
      window.removeEventListener("resize", again);
      watch?.disconnect();
      late.forEach((t) => window.clearTimeout(t));
    };
  }, [route, dockOpen]);

  // The dock's edge glows in whoever has the mic; with his words above it (a phone), it makes room for them.
  useEffect(() => {
    document.body.classList.add("holo-call");
    return () => {
      document.body.classList.remove("holo-call");
      document.body.style.removeProperty("--holo-call");
    };
  }, []);
  const above = place.kind !== "dock";
  useEffect(() => {
    document.body.classList.toggle("holo-call--above", above);
    return () => document.body.classList.remove("holo-call--above");
  }, [above]);
  useEffect(() => {
    if (speaker) document.body.style.setProperty("--holo-call", submindOf(speaker).colour);
    else document.body.style.removeProperty("--holo-call");
  }, [speaker]);

  // The channel switch (#490): a short glitch whenever the mic changes hands.
  useEffect(() => {
    if (!swappedAt) return;
    setSwitching(true);
    const t = window.setTimeout(() => setSwitching(false), SWITCH_MS);
    return () => window.clearTimeout(t);
  }, [swappedAt]);

  // The projection itself: three.js and his model, fetched now and not before.
  useEffect(() => {
    let alive = true;
    const el = canvas.current;
    if (!el) return;
    import("./holoScene.ts")
      .then((m) => m.createHolo(el))
      .then((h) => {
        if (!alive) return h.dispose();
        holo.current = h;
        h.setColour(useHolo.getState().speaker ? submindOf(useHolo.getState().speaker!).colour : null);
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      holo.current?.dispose();
      holo.current = null;
    };
  }, []);

  useEffect(() => {
    holo.current?.setColour(speaker ? submindOf(speaker).colour : null);
  }, [speaker, ready]);

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    holo.current?.resize(place.w, place.h, dpr);
  }, [place.w, place.h, ready]);

  // The loop: ~30 frames a second while the page is in view.
  useEffect(() => {
    const still = media(STILL);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let shown: Expression | "" = "";
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      acc += dt;
      if (acc < 1 / 32 || document.hidden) return;
      const step = acc;
      acc = 0;
      const s = useHolo.getState();
      const i = inputs.current;
      const e = expressionOf({ phase: i.phase, mode: i.mode, tools: s.tools, thinking: s.thinking, swappedAt: s.swappedAt, interruptedAt: s.interruptedAt, line: i.line, now: Date.now() });
      if (e !== shown) {
        shown = e;
        setExpr(e);
      }
      const level = i.phase === "live" ? talkLevel() : 0;
      if (levelBars.current) levelBars.current.style.setProperty("--lvl", level.toFixed(3));
      if (!s.hidden) holo.current?.frame(step, { expr: e, persona: personaOf(s.speaker), level, speaking: i.mode === "speaking", still });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const who = speaker ? `Skippy, the ${submindOf(speaker).job}` : "Skippy, the Magnificent";
  const tint = speaker ? submindOf(speaker).colour : undefined;
  const caption = stripTags(line);
  const live = phase === "live";
  const px = (n: number) => `${n}px`;
  const style = {
    "--hw": px(place.w),
    "--hh": px(place.h),
    "--pl": px(place.pl),
    "--pt": px(place.pt),
    "--pw": px(place.pw),
    "--ph": px(place.ph),
    "--ux": px(place.ux),
    "--uw": px(place.uw),
    "--ub": px(place.ub),
    ...(tint && { "--holo": tint }),
  } as CSSProperties;

  return (
    <div
      className={`holo holo--${place.kind}${leaving ? " holo--leaving" : ""}${hidden ? " holo--hidden" : ""}${ready ? " holo--ready" : ""}${failed ? " holo--failed" : ""}${switching ? " holo--switch" : ""}`}
      style={style}
      role="region"
      aria-label={`Call with ${who}`}
      data-expr={expr}
      data-speaker={speaker ?? "skippy"}
      data-face={personaOf(speaker).faces[expr]}
      data-manner={personaOf(speaker).manner}
      data-hold={holding ? "playing" : holdMuted ? "muted" : "ready"}
    >
      <div className="holo__veil" aria-hidden="true" />
      {/* The chat box he takes over: it dims, boots with a glitch, and he rises from its foot. */}
      <div className="holo__panel" aria-hidden="true">
        <div className="holo__dim" />
        <div className="holo__boot">
          <div className="holo__lines" />
          <span className="holo__booting">
            Booting Skippy<i />
          </span>
        </div>
        <div className="holo__edge" />
        <div className="holo__riser">
          <div className="holo__fig">
            <div className="holo__beam" />
            <div className="holo__scan" />
            <canvas ref={canvas} className="holo__cv" />
            <div className="holo__pad" />
            {!ready && !failed && <span className="holo__wait">{phase === "starting" ? "Opening a channel…" : "Projecting…"}</span>}
            {switching && <span className="holo__switch">Channel switch</span>}
          </div>
        </div>
      </div>
      <div className="holo__under">
        <p className="holo__name" aria-live="polite">
          <span className="holo__name-dot" aria-hidden="true" />
          {who}
        </p>
        {caption && !hidden && (
          <p className="holo__cap" aria-hidden="true">
            “{caption}”
          </p>
        )}
        {/* Hold music (#546): a small note while it plays, and his rare aside as a caption (voicing it would cost credits). */}
        {holding && !leaving && (
          <p className="holo__hold" aria-live="polite">
            <span className="holo__hold-note" aria-hidden="true">
              ♪
            </span>
            <span>{aside ? `“${aside}”` : "On hold"}</span>
          </p>
        )}
        <div className="holo__pill">
          <span className="holo__dot" aria-hidden="true" />
          <span className="holo__live">{leaving ? "Ended" : live ? "Live" : "Calling"}</span>
          <span className="holo__clock">{live ? clock(elapsed) : "0:00"}</span>
          <span className="holo__who">{who}</span>
          <span ref={levelBars} className="holo__lvl" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <button
            type="button"
            className={`holo__btn${muted ? " is-on" : ""}`}
            aria-pressed={muted}
            aria-label={muted ? "Unmute your microphone" : "Mute your microphone"}
            title={muted ? "Unmute" : "Mute"}
            disabled={!live}
            onClick={() => {
              const next = !muted;
              talkMute(next);
              useHolo.setState({ muted: next });
            }}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              {muted && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>
          <button
            type="button"
            className={`holo__btn holo__hold-btn${holdMuted ? " is-on" : ""}`}
            aria-pressed={holdMuted}
            aria-label={holdMuted ? "Turn hold music on" : "Mute hold music"}
            title={holdMuted ? "Hold music: off" : "Hold music: on"}
            onClick={() => setHoldMuted(!holdMuted)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M9 17V6l10-2v11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
              <circle cx="6.5" cy="17" r="2.5" fill="currentColor" />
              <circle cx="16.5" cy="15" r="2.5" fill="currentColor" />
              {holdMuted && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>
          <button
            type="button"
            className="holo__btn"
            aria-pressed={hidden}
            aria-label={hidden ? "Show the hologram" : "Hide the hologram (the call carries on)"}
            title={hidden ? "Show him" : "Hide him"}
            onClick={() => useHolo.setState({ hidden: !hidden })}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" fill="none" />
              <circle cx="12" cy="12" r="2.6" fill="currentColor" />
              {!hidden && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>
          <button type="button" className="holo__btn holo__end" onClick={() => void end()} aria-label="End the call">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0V15l-3.5 1.5z" fill="currentColor" />
            </svg>
            <span>End</span>
          </button>
        </div>
      </div>
    </div>
  );
}
