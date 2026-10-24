import { useEffect, useId, useState } from "react";
import { sparkPath } from "./polymarket.ts";

/**
 * The Exchange's own small data marks (#367), drawn as plain SVG so the page carries no chart library: a day's price
 * as a drawn-in area and a small sparkline. Every mark is decoration beside text
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
