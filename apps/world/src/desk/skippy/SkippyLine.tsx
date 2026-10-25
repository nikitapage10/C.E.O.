import { useEffect, useRef, useState } from "react";
import { TALK_NOTE, clock, talkLevel, usageLine, useTalk } from "./talk.ts";

/**
 * The line (#434): while a call is on, the chat's composer becomes one strand of the Lattice's dots and lines, strung
 * across the panel and plucked by the call. The strand stands still while Skippy listens and swings in gold when he
 * speaks; your own voice moves it in ice. Under it the time left in plain type and the End button. With reduced motion
 * the strand stays flat and only its colour says who is talking.
 */

const DOTS = 28;

function Strand() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mode = useTalk((s) => s.mode);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let level = 0;
    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
      if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      level += ((still ? 0 : talkLevel()) - level) * 0.25;
      const gold = modeRef.current === "speaking";
      const ink = gold ? "232, 184, 74" : "143, 232, 255";
      const amp = (h / 2 - 6) * Math.min(1, 0.08 + level * 1.6);
      const pts: [number, number][] = [];
      for (let i = 0; i < DOTS; i++) {
        const x = 6 + ((w - 12) * i) / (DOTS - 1);
        const edge = Math.sin((Math.PI * i) / (DOTS - 1));
        const y = h / 2 + (still ? 0 : Math.sin(i * 0.7 - t / 180) * Math.sin(t / 900 + i * 0.13) * amp * edge);
        pts.push([x, y]);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${ink}, 0.35)`;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      for (const [x, y] of pts) {
        ctx.fillStyle = `rgba(${ink}, 0.9)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // Reduced motion draws once, flat; a colour change redraws it.
    return () => cancelAnimationFrame(raf);
  }, [mode]);
  return <canvas ref={canvas} className="skp-line__strand" aria-hidden="true" />;
}

function Left() {
  const startedAt = useTalk((s) => s.startedAt);
  const maxSecs = useTalk((s) => s.maxSecs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = startedAt ? maxSecs - (now - startedAt) / 1000 : maxSecs;
  return (
    <span className="skp-line__clock" aria-label={`${clock(left)} left on the call`}>
      {clock(left)}
      <small>left</small>
    </span>
  );
}

export function SkippyLine() {
  const phase = useTalk((s) => s.phase);
  const mode = useTalk((s) => s.mode);
  const end = useTalk((s) => s.end);
  const usage = useTalk((s) => s.usage);
  const who = phase === "starting" ? "Ringing the Kernel…" : phase === "ending" ? "Hanging up…" : mode === "speaking" ? "Skippy is talking" : "Listening to you";
  return (
    <div className={`skp-line skp-line--${phase} skp-line--${mode}`} role="group" aria-label="Voice call with Skippy">
      <Strand />
      <div className="skp-line__row">
        <p className="skp-line__who" aria-live="polite">
          {who}
        </p>
        {phase === "live" && <Left />}
        <button type="button" className="btn btn--sm skp-line__end" onClick={() => void end()} disabled={phase === "ending"}>
          End call
        </button>
      </div>
      {usage && <p className="skp-line__usage">{usageLine(usage)}</p>}
    </div>
  );
}

/** The small line under the composer: this month's talk minutes, or why talking is off. */
export function TalkUsage() {
  const usage = useTalk((s) => s.usage);
  const ready = useTalk((s) => s.ready);
  const reason = useTalk((s) => s.reason);
  if (ready === false && reason && reason !== "signed-out" && reason !== "capped") return <p className="skp-talk-usage skp-talk-usage--off">{TALK_NOTE[reason]}</p>;
  if (!usage) return null;
  return <p className={`skp-talk-usage${usage.canTalk ? "" : " skp-talk-usage--off"}`}>{usage.canTalk ? usageLine(usage) : `${usageLine(usage)}: spent, so it's typing until the month turns`}</p>;
}
