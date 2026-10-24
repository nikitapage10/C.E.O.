import { useEffect, useId, useState } from "react";
import { sparkPath } from "./polymarket.ts";

/**
 * The Exchange's own small data marks (#367), drawn as plain SVG so the page carries no chart library: a probability
 * dial, a day's price as a drawn-in area, and a diverging bar for the day's move. Every mark is decoration beside text
 * that says the same thing (aria-hidden), and every animation stops under prefers-reduced-motion (exchange.css).
 */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A point on the dial's half circle, `p` from 0 (left) to 1 (right). */
function onArc(p: number, r: number, cx: number, cy: number): [number, number] {
  const a = Math.PI * (1 - clamp01(p));
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

/**
 * The odds as a half-dial: the track from 0 to 100, the arc filled to the price, and a small tick where it stood a day
 * ago (when Polymarket says how far it moved).
 */
export function Dial({ prob, was, tone }: { prob: number; was: number | null; tone: "up" | "down" | "flat" }) {
  const R = 84;
  const CX = 100;
  const CY = 98;
  const track = `M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const [x1, y1] = onArc(p, R + 7, CX, CY);
    const [x2, y2] = onArc(p, R + 12, CX, CY);
    return <line key={p} x1={x1} y1={y1} x2={x2} y2={y2} />;
  });
  const ghost = was === null ? null : (() => {
    const [x1, y1] = onArc(was, R - 9, CX, CY);
    const [x2, y2] = onArc(was, R + 9, CX, CY);
    return <line className="xc-dial-was" x1={x1} y1={y1} x2={x2} y2={y2} />;
  })();
  return (
    <svg className={`xc-dial is-${tone}`} viewBox="0 0 200 108" aria-hidden="true">
      <g className="xc-dial-ticks">{ticks}</g>
      <path className="xc-dial-track" d={track} pathLength={1} />
      <path className="xc-dial-fill" d={track} pathLength={1} style={{ strokeDasharray: `${clamp01(prob)} 1` }} />
      {ghost}
    </svg>
  );
}

/** A day's prices as an area that draws itself in from the left. */
export function DayArea({ ps, tone, w = 320, h = 64 }: { ps: number[]; tone: string; w?: number; h?: number }) {
  const id = useId().replace(/:/g, "");
  const d = sparkPath(ps, w, h);
  if (!d) return <p className="xc-area-none">Polymarket sent no price history for the day.</p>;
  return (
    <svg className={`xc-area is-${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`xa${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".26" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="xc-area-fill" d={`${d}L${w} ${h}L0 ${h}Z`} fill={`url(#xa${id})`} />
      <path className="xc-area-line" d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A small sparkline for a row. */
export function Spark({ ps, tone, w = 72, h = 22 }: { ps: number[]; tone: string; w?: number; h?: number }) {
  const d = sparkPath(ps, w, h);
  if (!d) return <span className="xc-spark xc-spark--none" aria-hidden="true" />;
  return (
    <svg className={`xc-spark is-${tone}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The day's move as a diverging bar from a centre line: right and mint for up, left and rose for down, its length the
 * share of `max`. Drawn with flex-grow, never a percentage, so no figure sits in the markup.
 */
export function MoveBar({ c, max }: { c: number | null; max: number }) {
  const share = c === null || max <= 0 ? 0 : Math.min(1, Math.abs(c) / max);
  const up = (c ?? 0) > 0;
  return (
    <span className="xc-mv" aria-hidden="true">
      <span className="xc-mv-side">
        <i style={{ flexGrow: up ? 1 : 1 - share }} />
        {!up && share > 0 && <i className="xc-mv-bar is-down" style={{ flexGrow: share }} />}
      </span>
      <span className="xc-mv-mid" />
      <span className="xc-mv-side">
        {up && share > 0 && <i className="xc-mv-bar is-up" style={{ flexGrow: share }} />}
        <i style={{ flexGrow: up ? 1 - share : 1 }} />
      </span>
    </span>
  );
}
