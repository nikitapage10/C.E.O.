import { useId } from "react";
import { formatWait, type ReplyDay } from "./deskData.ts";

/** The Desk's drawings: inline SVG and CSS only, no chart library. Each one has a designed empty state. */

const TAU = Math.PI * 2;

const polar = (r: number, turn: number): [number, number] => [r * Math.sin(turn * TAU), -r * Math.cos(turn * TAU)];

/** The colour of a wait, from calm to urgent. */
export function waitTone(fraction: number): string {
  return fraction < 0.34 ? "var(--ok)" : fraction < 0.67 ? "var(--warn)" : "var(--bad)";
}

function arcPath(r: number, from: number, to: number) {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/* ───────────────────────── Seven-day reply strip ───────────────────────── */

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function minutesTone(m: number) {
  return m <= 15 ? "var(--ok)" : m <= 60 ? "var(--ink-2)" : m <= 240 ? "var(--warn)" : "var(--bad)";
}

export function ReplyStrip({ week }: { week: ReplyDay[] }) {
  const known = week.filter((d) => d.medianMinutes !== null);
  const top = Math.max(60, ...known.map((d) => d.medianMinutes ?? 0));
  const pts = week
    .map((d, i) => (d.medianMinutes === null ? null : `${((i + 0.5) / week.length) * 100},${100 - (d.medianMinutes / top) * 100}`))
    .filter(Boolean)
    .join(" ");
  return (
    <figure className="strip" aria-label={known.length ? "Median reply time, last seven days" : "No reply times tracked yet"}>
      <div className="strip__plot">
        <div className="strip__grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {week.map((d, i) => {
          const m = d.medianMinutes;
          const date = new Date(d.day);
          const today = i === week.length - 1;
          return (
            <div key={d.day} className={`strip__col ${today ? "strip__col--today" : ""}`}>
              <div className="strip__well">
                {m === null ? (
                  <span className="strip__none" style={{ animationDelay: `${i * 140}ms` }} />
                ) : (
                  <span className="strip__bar" style={{ height: `${Math.max(4, (m / top) * 100)}%`, background: minutesTone(m), animationDelay: `${i * 60}ms` }}>
                    <em>{formatWait(m * 60_000)}</em>
                  </span>
                )}
              </div>
              <span className="strip__day">{DAY_LETTERS[date.getDay()]}</span>
              <span className="strip__date">{date.getDate()}</span>
            </div>
          );
        })}
        {known.length > 1 && (
          <svg className="strip__line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pts} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <figcaption className="strip__cap">{known.length ? `Median reply time, on a scale of ${formatWait(top * 60_000)}` : "No replies tracked yet. The week fills in as you answer."}</figcaption>
    </figure>
  );
}

/* ───────────────────────── Streak ───────────────────────── */

export function Streak({ days }: { days: number }) {
  const pips = Array.from({ length: 14 }, (_, i) => i >= 14 - Math.min(14, days));
  return (
    <div className="streak">
      <div className="streak__num">
        <span>{days}</span>
        <small>{days === 1 ? "day" : "days"}</small>
      </div>
      <div className="streak__pips" aria-label={`${days} day streak`}>
        {pips.map((on, i) => (
          <span key={i} className={on ? "on" : ""} style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <p className="streak__cap">{days ? "Nobody left past their window" : "Starts the first day the hub watches"}</p>
    </div>
  );
}

/* ───────────────────────── 24-hour nudge clock ───────────────────────── */

export function NudgeClock({ nudges, now, next }: { nudges: [number, number][]; now: number; next: number | null }) {
  const d = new Date(now);
  const nowTurn = (d.getHours() * 60 + d.getMinutes()) / 1440;
  const nd = next === null ? null : new Date(next);
  const nextTurn = nd === null ? null : (nd.getHours() * 60 + nd.getMinutes()) / 1440;
  const [hx, hy] = polar(70, nowTurn);
  const span = nextTurn === null ? 0 : (nextTurn - nowTurn + 1) % 1;
  return (
    <div className="clock">
      <svg viewBox="-100 -100 200 200" aria-hidden="true">
        <path d={arcPath(84, 22 / 24, 1)} className="clock__night" />
        <path d={arcPath(84, 0, 7 / 24)} className="clock__night" />
        <circle r="84" className="clock__ring" />
        {Array.from({ length: 96 }, (_, i) => {
          const t = i / 96;
          const major = i % 4 === 0;
          const [x0, y0] = polar(major ? 76 : 80, t);
          const [x1, y1] = polar(84, t);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? "major" : ""} />;
        })}
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = polar(64, h / 24);
          return (
            <text key={h} x={x} y={y + 3} className="clock__h">
              {String(h).padStart(2, "0")}
            </text>
          );
        })}
        {nextTurn !== null && span > 0.002 && <path d={arcPath(92, nowTurn, nowTurn + span)} className="clock__until" />}
        {nudges.map(([h, m]) => {
          const t = (h * 60 + m) / 1440;
          const [x, y] = polar(92, t);
          const [lx, ly] = polar(108, t);
          return (
            <g key={`${h}:${m}`} className="clock__nudge">
              <circle cx={x} cy={y} r="9" className="clock__halo" />
              <rect x={x - 3.6} y={y - 3.6} width="7.2" height="7.2" transform={`rotate(45 ${x} ${y})`} />
              <text x={lx} y={ly + 3} className={`clock__label ${lx < 0 ? "left" : ""}`}>
                {`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`}
              </text>
            </g>
          );
        })}
        <line x1="0" y1="0" x2={hx} y2={hy} className="clock__hand" />
        <circle r="3" className="clock__hub" />
      </svg>
    </div>
  );
}

/* ───────────────────────── Activity meter ───────────────────────── */

export function ActivityMeter({ load, live }: { load: number; live: boolean }) {
  const bars = 16;
  return (
    <div className={`meter ${live ? "meter--live" : ""}`} aria-label={live ? `Load ${Math.round(load * 100)}%` : "Idle"}>
      {Array.from({ length: bars }, (_, i) => {
        const h = live ? 0.18 + load * 0.82 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + load * 9))) : 0;
        return <span key={i} style={{ height: `${Math.max(1, h * 100)}%`, animationDelay: `${(i * 97) % 900}ms` }} />;
      })}
    </div>
  );
}

/* ───────────────────────── Portraits ───────────────────────── */

/** Dialtone: a painted flyer who runs a switchboard, wings like brushstrokes, a headset and a trailing cord. */
export function DialtoneGlyph() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 120 120" className="glyph glyph--dialtone" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-w`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--viz-violet)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--viz-rose)" }} stopOpacity="0.85" />
          <stop offset="1" style={{ stopColor: "var(--viz-gold)" }} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="54" className="glyph__halo" />
      <g className="glyph__wing glyph__wing--l">
        <path d="M54 58 C 34 40, 14 34, 6 42 C 18 46, 26 52, 30 58 C 20 56, 12 60, 10 66 C 24 62, 36 64, 54 66 Z" fill={`url(#${id}-w)`} />
        <path d="M50 60 C 36 50, 22 46, 12 46" className="glyph__stroke" />
      </g>
      <g className="glyph__wing glyph__wing--r">
        <path d="M66 58 C 86 40, 106 34, 114 42 C 102 46, 94 52, 90 58 C 100 56, 108 60, 110 66 C 96 62, 84 64, 66 66 Z" fill={`url(#${id}-w)`} />
        <path d="M70 60 C 84 50, 98 46, 108 46" className="glyph__stroke" />
      </g>
      <path d="M52 64 L 60 92 L 68 64 Z" className="glyph__body" />
      <circle cx="60" cy="50" r="10" className="glyph__head" />
      <path d="M48 50 A 12 12 0 0 1 72 50" className="glyph__headset" />
      <circle cx="48.5" cy="52" r="2.6" className="glyph__ear" />
      <path d="M48 54 C 46 70, 40 84, 48 96 C 54 104, 66 100, 72 106" className="glyph__cord" />
      <rect x="70" y="103" width="8" height="5" rx="1" className="glyph__jack" />
    </svg>
  );
}

/** Blasto: a floating postmaster, a glowing bell with an envelope inside and long drifting trails. */
export function BlastoGlyph() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 120 120" className="glyph glyph--blasto" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-b`} cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" style={{ stopColor: "var(--viz-ice)" }} stopOpacity="0.95" />
          <stop offset="0.55" style={{ stopColor: "var(--viz-ice)" }} stopOpacity="0.35" />
          <stop offset="1" style={{ stopColor: "var(--viz-violet)" }} stopOpacity="0.08" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="56" r="50" className="glyph__halo" />
      <g className="glyph__float">
        <g className="glyph__trails">
          {[36, 48, 60, 72, 84].map((x, i) => (
            <path key={x} d={`M${x} 62 C ${x - 6} 76, ${x + 6} 88, ${x - 2} ${104 - (i % 2) * 6}`} style={{ animationDelay: `${i * 0.35}s` }} />
          ))}
        </g>
        <path d="M28 62 C 28 30, 92 30, 92 62 C 86 58, 80 66, 74 61 C 68 66, 62 58, 60 62 C 56 58, 50 66, 46 61 C 40 66, 34 58, 28 62 Z" fill={`url(#${id}-b)`} className="glyph__bell" />
        <rect x="49" y="42" width="22" height="14" rx="1.5" className="glyph__letter" />
        <path d="M49 43 L 60 51 L 71 43" className="glyph__letter-flap" />
        <circle cx="44" cy="38" r="1.6" className="glyph__spark" />
      </g>
    </svg>
  );
}

/* ───────────────────────── Empty-state drawings ───────────────────────── */

/** Sonar rings around an empty tray: listening, and nothing found. */
export function Listening({ tone = "var(--ink-3)" }: { tone?: string }) {
  return (
    <svg viewBox="-60 -60 120 120" className="listening" style={{ color: tone }} aria-hidden="true">
      <circle r="4" className="listening__core" />
      <circle r="12" className="listening__ring" />
      <circle r="12" className="listening__ring" style={{ animationDelay: "1.3s" }} />
      <circle r="12" className="listening__ring" style={{ animationDelay: "2.6s" }} />
      <circle r="40" className="listening__guide" />
      <circle r="56" className="listening__guide" />
    </svg>
  );
}

/** Relay's brass outbox, empty, with a little dust in the light. */
export function Outbox() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 240 180" className="outbox" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--viz-gold)" }} stopOpacity="0.9" />
          <stop offset="1" style={{ stopColor: "var(--viz-gold)" }} stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--viz-gold)" }} stopOpacity="0.22" />
          <stop offset="1" style={{ stopColor: "var(--viz-gold)" }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M92 0 L 148 0 L 196 150 L 44 150 Z" fill={`url(#${id}-beam)`} className="outbox__beam" />
      <ellipse cx="120" cy="156" rx="86" ry="8" className="outbox__shadow" />
      {/* back rim */}
      <path d="M58 92 L 76 72 L 164 72 L 182 92" className="outbox__rim" />
      {/* inside floor */}
      <path d="M58 92 L 182 92 L 164 72 L 76 72 Z" className="outbox__floor" />
      {/* front */}
      <path d="M50 96 L 190 96 L 180 150 L 60 150 Z" fill={`url(#${id}-brass)`} className="outbox__front" />
      <path d="M50 96 L 190 96" className="outbox__lip" />
      <rect x="102" y="112" width="36" height="16" rx="2" className="outbox__plate" />
      <text x="120" y="124" className="outbox__label">
        OUT
      </text>
      {[
        [96, 44],
        [128, 30],
        [146, 56],
        [110, 64],
        [136, 82],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.6} className="outbox__mote" style={{ animationDelay: `${i * 1.1}s` }} />
      ))}
    </svg>
  );
}
