import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { submindOf } from "../../../../../packages/simulator/src/subminds.ts";
import { useSkippy } from "../skippy/chat.ts";
import { clock, talkLevel, talkMute, useTalk } from "../skippy/talk.ts";
import type { Holo } from "./holoScene.ts";
import { personaOf } from "./persona.ts";
import { expressionOf, stripTags, useHolo, type Expression } from "./signal.ts";
import "./hologram.css";

/**
 * The hologram call (#481, #490): Skippy, projected out of the chat dock. On every page, Today included, he rises from
 * the dock's top edge on the right, the emitter on that edge, with his name, his latest line and the call's pill
 * beside him (above him when there's no room beside, as on a phone, where the dock is a sheet from the bottom). His
 * face follows the call (signal.ts) and his mouth his voice. When a submind takes the mic the whole projection turns
 * its room's colour, the label takes its name, and the channel glitches over.
 */

/**
 * Where he stands: the figure's centre x and top y and its canvas size; the dock's top edge (`edge`, with its left and
 * width as `el` and `ew`); and his words, beside him (`side`, right-aligned to `ux + uw`) or stacked above him.
 */
type Place = { kind: "dock" | "stack" | "phone"; x: number; y: number; w: number; h: number; edge: number; el: number; ew: number; ux: number; uw: number };

const PHONE = "(max-width: 640px)";
const STILL = "(prefers-reduced-motion: reduce)";
/** How long the channel-switch glitch runs when the mic changes hands, in ms. */
const SWITCH_MS = 700;

const media = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;

/** Where he stands: on the dock's top edge, or where the dock sits when it's closed. */
function placeFor(): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = document.getElementById("skippy-chat")?.getBoundingClientRect();
  const open = !!r && r.width > 0 && r.height > 0;
  const phone = media(PHONE);
  // The dock's top edge; with the dock closed, the spot its foot would stand on.
  const ew = open ? r!.width : Math.min(420, vw - 32);
  const el = open ? r!.left : vw - (phone ? 0 : 24) - ew;
  const edge = open ? r!.top : vh - (phone ? 0 : 24);
  const x = el + ew / 2;
  const roomBeside = el - 24;
  if (!phone && roomBeside >= 280) {
    const h = Math.round(Math.max(220, Math.min(340, edge - 70)));
    const w = Math.round(h * 0.84);
    const uw = Math.round(Math.min(380, roomBeside - 8));
    return { kind: "dock", x, y: Math.round(edge - h * 0.99), w, h, edge, el, ew, ux: Math.round(el - 16 - uw), uw };
  }
  // No room beside the dock (a phone, a narrow window): his words go above him.
  const h = Math.round(Math.max(150, Math.min(phone ? 230 : 280, edge - 190)));
  const uw = Math.round(Math.min(ew, vw - 24));
  return { kind: phone ? "phone" : "stack", x, y: Math.round(edge - h * 0.99), w: Math.round(h * 0.84), h, edge, el, ew, ux: Math.round(x - uw / 2), uw };
}

export default function HologramStage({ route }: { route: string }) {
  const phase = useTalk((s) => s.phase);
  const mode = useTalk((s) => s.mode);
  const startedAt = useTalk((s) => s.startedAt);
  const end = useTalk((s) => s.end);
  const speaker = useHolo((s) => s.speaker);
  const muted = useHolo((s) => s.muted);
  const hidden = useHolo((s) => s.hidden);
  const dockOpen = useSkippy((s) => s.open);
  const turns = useSkippy((s) => s.turns);
  const firstTurn = useHolo((s) => s.fromTurn);
  const line = [...turns].reverse().find((t) => t.who === "skippy" && !t.note && t.id > firstTurn)?.text ?? "";

  const swappedAt = useHolo((s) => s.swappedAt);
  const [place, setPlace] = useState<Place>(() => placeFor());
  const [switching, setSwitching] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expr, setExpr] = useState<Expression>("thinking");
  const [now, setNow] = useState(() => Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);
  const holo = useRef<Holo | null>(null);
  const levelBars = useRef<HTMLSpanElement>(null);
  const inputs = useRef({ phase, mode, line });
  inputs.current = { phase, mode, line };

  // Where he stands, again whenever the window or the dock changes (the dock shrinks for the call, opens, closes).
  useLayoutEffect(() => {
    const again = () => setPlace((was) => {
      const next = placeFor();
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

  // The call makes room above the dock for him, and the dock's edge glows in whoever has the mic.
  useEffect(() => {
    document.body.classList.add("holo-call");
    return () => {
      document.body.classList.remove("holo-call");
      document.body.style.removeProperty("--holo-call");
    };
  }, []);
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

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const who = speaker ? `Skippy, the ${submindOf(speaker).job}` : "Skippy, the Magnificent";
  const tint = speaker ? submindOf(speaker).colour : undefined;
  const caption = stripTags(line);
  const live = phase === "live";
  const px = (n: number) => `${n}px`;
  const style = {
    "--hx": px(place.x),
    "--hy": px(place.y),
    "--hw": px(place.w),
    "--hh": px(place.h),
    "--he": px(place.edge),
    "--hel": px(place.el),
    "--hew": px(place.ew),
    "--ux": px(place.ux),
    "--uw": px(place.uw),
    ...(tint && { "--holo": tint }),
  } as CSSProperties;

  return (
    <div
      className={`holo holo--${place.kind}${hidden ? " holo--hidden" : ""}${ready ? " holo--ready" : ""}${failed ? " holo--failed" : ""}${switching ? " holo--switch" : ""}`}
      style={style}
      role="region"
      aria-label={`Call with ${who}`}
      data-expr={expr}
      data-speaker={speaker ?? "skippy"}
      data-face={personaOf(speaker).faces[expr]}
      data-manner={personaOf(speaker).manner}
    >
      <div className="holo__veil" aria-hidden="true" />
      <div className="holo__edge" aria-hidden="true" />
      <div className="holo__fig" aria-hidden="true">
        <div className="holo__beam" />
        <div className="holo__scan" />
        <canvas ref={canvas} className="holo__cv" />
        <div className="holo__pad" />
        {!ready && !failed && <span className="holo__wait">{phase === "starting" ? "Opening a channel…" : "Projecting…"}</span>}
        {switching && <span className="holo__switch">Channel switch</span>}
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
        <div className="holo__pill">
          <span className="holo__dot" aria-hidden="true" />
          <span className="holo__live">{live ? "Live" : "Calling"}</span>
          <span className="holo__clock">{live ? clock((now - startedAt) / 1000) : "0:00"}</span>
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
