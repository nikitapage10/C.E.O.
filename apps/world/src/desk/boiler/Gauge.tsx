import { useEffect, useState, type CSSProperties } from "react";
import type { GState } from "../systemsGraph.ts";
import type { Pressure } from "./pressure.ts";

/**
 * The Boiler Room's main gauge (#369): a brass pressure dial whose needle stands at the share of every real connection
 * that carries flow (pressure.ts). It sweeps up from zero when the page opens, settles with a spring, and quivers a
 * little while anything flows; a red lamp lights for a burst pipe and a blue one while something runs hot. Under
 * prefers-reduced-motion it simply stands at its reading (boiler.css).
 */

const CX = 110;
const CY = 112;
const R = 84;
const START = 150;
const SWEEP = 240;

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r] as const;
};
const arc = (r: number, from: number, to: number) => {
  const [x0, y0] = pt(from, r);
  const [x1, y1] = pt(to, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export function Gauge({ p, tone }: { p: Pressure; tone: GState }) {
  // Start at rest, then sweep to the reading: the needle rising is the page coming up to pressure.
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setV(p.share), 120);
    return () => window.clearTimeout(t);
  }, [p.share]);
  const pct = Math.round(p.share * 100);
  return (
    <figure className={`bx-gauge is-${tone}${p.flowing ? " is-live" : ""}`} style={{ "--a": `${START + SWEEP * v}deg`, "--v": v * 100 } as CSSProperties} aria-label={`Pressure ${pct}%: ${p.flowing} of ${p.total} connections carry flow`}>
      <svg viewBox="0 0 220 224" aria-hidden="true">
        <circle className="bx-g-bezel" cx={CX} cy={CY} r={R + 16} />
        <circle className="bx-g-face" cx={CX} cy={CY} r={R + 9} />
        <path className="bx-g-track" d={arc(R - 6, START, START + SWEEP)} />
        <path className="bx-g-val" d={arc(R - 6, START, START + SWEEP)} pathLength={100} />
        {Array.from({ length: 41 }, (_, i) => {
          const deg = START + (SWEEP * i) / 40;
          const major = i % 10 === 0;
          const [x0, y0] = pt(deg, R + 2);
          const [x1, y1] = pt(deg, major ? R - 14 : i % 5 === 0 ? R - 9 : R - 5);
          return <line key={i} className={major ? "bx-g-tick is-major" : "bx-g-tick"} x1={x0} y1={y0} x2={x1} y2={y1} />;
        })}
        {[0, 25, 50, 75, 100].map((n) => {
          const [x, y] = pt(START + (SWEEP * n) / 100, R - 26);
          return (
            <text key={n} className="bx-g-num" x={x} y={y} dy=".35em" textAnchor="middle">
              {n}
            </text>
          );
        })}
        <g className="bx-g-needle">
          <g className="bx-g-quiver">
            <path d={`M${CX - 12} ${CY - 2.4}L${CX + R - 18} ${CY - 0.6}L${CX + R - 14} ${CY}L${CX + R - 18} ${CY + 0.6}L${CX - 12} ${CY + 2.4}Z`} />
          </g>
        </g>
        <circle className="bx-g-pin" cx={CX} cy={CY} r={7} />
        <circle className="bx-g-pin2" cx={CX} cy={CY} r={2.4} />
        <circle className={`bx-g-lamp is-bad${p.burst ? " is-on" : ""}`} cx={CX - 40} cy={CY + 68} r={3.6} />
        <circle className={`bx-g-lamp is-run${p.run ? " is-on" : ""}`} cx={CX + 40} cy={CY + 68} r={3.6} />
      </svg>
      <figcaption>
        <b>{pct}</b>
        <span>% pressure</span>
      </figcaption>
    </figure>
  );
}
