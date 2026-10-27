import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { submindOf } from "../../../../../packages/simulator/src/subminds.ts";
import { useSkippy } from "../skippy/chat.ts";
import { clock, talkLevel, talkMute, useTalk } from "../skippy/talk.ts";
import type { Holo } from "./holoScene.ts";
import { expressionOf, stripTags, useHolo, type Expression } from "./signal.ts";
import "./hologram.css";

/**
 * The hologram call (#481): Skippy, projected. On Today he rises out of his own constellation (the Confluence's
 * "Skippy, the Magnificent"); on any other page he projects from the corner nearest the chat dock; on a phone he
 * stands small at the top with the dock below. Under him: his latest line as a caption, and a pill with the call's
 * clock, its level, mute, hide and end. His face follows the call (signal.ts) and his mouth his voice.
 */

/** Centre x and top y of the projection, its canvas size, and how wide the caption and pill may run (`uw`). */
type Place = { kind: "today" | "corner" | "phone"; x: number; y: number; w: number; h: number; uw: number };

const PHONE = "(max-width: 640px)";
const STILL = "(prefers-reduced-motion: reduce)";

const media = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;

/** Where he stands, beside the dock and never under it. */
function placeFor(route: string): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (media(PHONE)) {
    const h = Math.round(Math.min(240, vh * 0.28));
    return { kind: "phone", x: vw / 2, y: 58, w: Math.round(h * 0.84), h, uw: vw - 24 };
  }
  const dock = document.getElementById("skippy-chat")?.getBoundingClientRect();
  const right = dock && dock.width > 0 && dock.left > 400 ? dock.left - 16 : vw - 16;
  const mark = route === "today" ? document.querySelector<HTMLElement>("[data-cf-sk]") : null;
  const r = mark?.getBoundingClientRect();
  if (r && r.width > 0 && r.bottom > 0 && r.top < vh) {
    const h = Math.round(Math.min(420, vh * 0.48));
    const x = Math.min(r.left + r.width / 2, right - 200);
    return { kind: "today", x, y: Math.max(76, r.top + r.height / 2 - h * 0.42), w: Math.round(h * 0.84), h, uw: Math.round(2 * Math.min(380, x - 16, right - x)) };
  }
  // The corner nearest the dock: just left of it when it's open, the bottom-right corner when it isn't.
  const h = Math.round(Math.min(320, vh * 0.38));
  const w = Math.round(h * 0.84);
  const uw = 360;
  const x = right - uw / 2;
  const below = 24 + 136; // room for the caption and the pill
  return { kind: "corner", x, y: vh - below - h, w, h, uw };
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

  const [place, setPlace] = useState<Place>(() => placeFor(route));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expr, setExpr] = useState<Expression>("thinking");
  const [now, setNow] = useState(() => Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);
  const holo = useRef<Holo | null>(null);
  const levelBars = useRef<HTMLSpanElement>(null);
  const inputs = useRef({ phase, mode, line });
  inputs.current = { phase, mode, line };

  // Where he stands, again whenever the window or the dock changes.
  useLayoutEffect(() => {
    const again = () => setPlace(placeFor(route));
    again();
    window.addEventListener("resize", again);
    const late = window.setTimeout(again, 400); // the dock opens a moment after Talk on Today's Ask line
    return () => {
      window.removeEventListener("resize", again);
      window.clearTimeout(late);
    };
  }, [route, dockOpen]);

  // A phone call shrinks the dock so he and the pill fit above it.
  useEffect(() => {
    document.body.classList.add("holo-call");
    return () => document.body.classList.remove("holo-call");
  }, []);

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
      if (!s.hidden) holo.current?.frame(step, { expr: e, level, speaking: i.mode === "speaking", still });
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
  const style = { "--hx": `${place.x}px`, "--hy": `${place.y}px`, "--hw": `${place.w}px`, "--hh": `${place.h}px`, "--uw": `${place.uw}px`, ...(tint && { "--holo": tint }) } as CSSProperties;

  return (
    <div className={`holo holo--${place.kind}${hidden ? " holo--hidden" : ""}${ready ? " holo--ready" : ""}${failed ? " holo--failed" : ""}`} style={style} role="region" aria-label={`Call with ${who}`} data-expr={expr}>
      <div className="holo__veil" aria-hidden="true" />
      <div className="holo__fig" aria-hidden="true">
        <div className="holo__beam" />
        <canvas ref={canvas} className="holo__cv" />
        <div className="holo__pad" />
        {!ready && !failed && <span className="holo__wait">{phase === "starting" ? "Opening a channel…" : "Projecting…"}</span>}
      </div>
      <div className="holo__under">
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
