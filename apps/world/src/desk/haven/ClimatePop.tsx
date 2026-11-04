import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { THERMO_MAX_F, THERMO_MIN_F, useHome, type DeviceReading, type ThermoMode } from "../homeDevices.ts";
import { HOLD_MS, moodOf, sameAs, useClimateQueue, type PendingClimate } from "./climateQueue.ts";
import { angleOf, DIAL_A0, DIAL_SWEEP, GAP_F, setOf } from "./plinth.ts";

/**
 * The Haven's thermostat control (#671): opened from the rail's Climate dial (#680) or the Nest's marker, passkey only.
 * Since #729 it is one big dial: its arc runs from ice blue (cool) to ember orange (heat), the room's temperature is a
 * marker on it and the set point a knob (two in heat-and-cool), dragged, tapped with − and +, or turned with the arrow
 * keys. A change is held (climateQueue.ts): the dial's centre counts the seconds down round its ring, with Cancel and
 * Send now, and the thermostat hears once with the final setting through thermostat.set and its rails (60 to 80 °F, a
 * 3 °F gap, nothing while eco is on or the mode is off). The card glows with its mode, faint orange for heat and blue
 * for cool even while it holds; embers rise while it heats and frost falls while it cools.
 */

const MODE_WORD: Record<ThermoMode, string> = { heat: "Heat", cool: "Cool", heatcool: "Heat · Cool", off: "Off" };
const ALL_MODES: readonly ThermoMode[] = ["heat", "cool", "heatcool", "off"];

const clampF = (f: number) => Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, f));

/* The dial's geometry: a 240-unit face, the arc on radius R. */
const C = 120;
const R = 92;
const pt = (a: number, r = R) => [+(C + Math.cos(a) * r).toFixed(2), +(C + Math.sin(a) * r).toFixed(2)] as const;
const arc = (a0: number, a1: number, r = R) => {
  const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
};
/** The arc's colour at a temperature: blue at the cool end, orange at the warm end (as the gradient runs). */
export function hueAt(f: number): string {
  const k = (clampF(f) - THERMO_MIN_F) / (THERMO_MAX_F - THERMO_MIN_F);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(${mix(96, 255)},${mix(170, 138)},${mix(255, 58)})`;
}

/** What the knobs show: the held change while there is one, else the thermostat's own. */
function shownOf(d: DeviceReading, mine: PendingClimate | null) {
  const heatF = mine ? (mine.extra.heatF ?? (d.mode === "heat" ? mine.extra.tempF : d.heatF)) : d.heatF;
  const coolF = mine ? (mine.extra.coolF ?? (d.mode === "cool" ? mine.extra.tempF : d.coolF)) : d.coolF;
  return { heatF: typeof heatF === "number" ? heatF : null, coolF: typeof coolF === "number" ? coolF : null };
}

function Dial({ d, mine, locked, onSet }: { d: DeviceReading; mine: PendingClimate | null; locked: boolean; onSet: (side: "heat" | "cool", f: number) => void }) {
  const { heatF, coolF } = shownOf(d, mine);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<"heat" | "cool" | null>(null);
  const both = d.mode === "heatcool";
  const one: "heat" | "cool" = d.mode === "cool" ? "cool" : "heat";
  const target = one === "cool" ? coolF : heatF;
  const inside = typeof d.tempF === "number" ? d.tempF : null;
  const at = (e: PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    return setOf(Math.atan2(((e.clientY - b.top) / b.height) * 240 - C, ((e.clientX - b.left) / b.width) * 240 - C));
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (locked || e.button !== 0) return;
    const f = at(e);
    // In heat-and-cool the nearer knob moves.
    const side = both ? (heatF !== null && coolF !== null && Math.abs(f - heatF) <= Math.abs(f - coolF) ? "heat" : "cool") : one;
    drag.current = side;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSet(side, f);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current) onSet(drag.current, at(e));
  };
  const up = () => void (drag.current = null);
  const knob = (f: number | null, side: "heat" | "cool") => {
    if (f === null) return null;
    const [x, y] = pt(angleOf(f));
    return (
      <g className="hv-cd-knob" data-side={side}>
        <circle cx={x} cy={y} r={13} style={{ fill: hueAt(f) }} />
        <circle cx={x} cy={y} r={4.5} className="hv-cd-knobIn" />
      </g>
    );
  };
  // Ticks: every degree, every fifth long and named.
  const ticks = [];
  for (let f = THERMO_MIN_F; f <= THERMO_MAX_F; f++) {
    const a = angleOf(f), big = f % 5 === 0;
    const [x0, y0] = pt(a, R - 15), [x1, y1] = pt(a, R - (big ? 24 : 19));
    ticks.push(<line key={f} x1={x0} y1={y0} x2={x1} y2={y1} className={big ? "is-big" : undefined} />);
  }
  for (const f of [THERMO_MIN_F, THERMO_MAX_F]) {
    const [tx, ty] = pt(angleOf(f), R + 4);
    ticks.push(
      <text key={`t${f}`} x={tx} y={ty + 18} className="hv-cd-tickV">
        {f}°
      </text>,
    );
  }
  const left = mine ? Math.max(0, mine.at - Date.now()) : 0;
  const [ix0, iy0] = inside !== null ? pt(angleOf(inside), R + 10) : [0, 0];
  const [ix1, iy1] = inside !== null ? pt(angleOf(inside), R - 10) : [0, 0];
  return (
    <svg ref={svg} className="hv-cd" viewBox="0 0 240 240" data-locked={locked ? "" : undefined} aria-hidden="true" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <defs>
        <linearGradient id="hv-cd-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5faaff" />
          <stop offset="50%" stopColor="#c7b3f0" />
          <stop offset="100%" stopColor="#ff8a3a" />
        </linearGradient>
      </defs>
      <path d={arc(DIAL_A0, DIAL_A0 + DIAL_SWEEP)} className="hv-cd-track" />
      <path d={arc(DIAL_A0, DIAL_A0 + DIAL_SWEEP)} className="hv-cd-arc" stroke="url(#hv-cd-grad)" />
      {/* The span the system works across: from the room to the set point, or between the two set points. */}
      {both && heatF !== null && coolF !== null ? (
        <path d={arc(angleOf(heatF), angleOf(coolF))} className="hv-cd-span" />
      ) : inside !== null && target !== null && inside !== target ? (
        <path d={arc(angleOf(Math.min(inside, target)), angleOf(Math.max(inside, target)))} className="hv-cd-span" data-dir={target > inside ? "heat" : "cool"} />
      ) : null}
      <g className="hv-cd-ticks">{ticks}</g>
      {inside !== null && <line className="hv-cd-inside" x1={ix0} y1={iy0} x2={ix1} y2={iy1} />}
      {both ? (
        <>
          {knob(heatF, "heat")}
          {knob(coolF, "cool")}
        </>
      ) : d.mode === "off" ? null : (
        knob(target, one)
      )}
      {mine && (
        // The held change's seconds round the centre: the ring drains to Send, a step each quarter second.
        <circle key={mine.at} cx={C} cy={C} r={60} pathLength={100} className="hv-cd-count" style={{ strokeDashoffset: 100 - (100 * left) / HOLD_MS }} />
      )}
    </svg>
  );
}

export function ClimatePop({ d, onClose }: { d: DeviceReading; onClose: () => void }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const said = useHome((s) => s.said);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  const pending = useClimateQueue((s) => s.pending);
  const hold = useClimateQueue((s) => s.hold);
  const cancel = useClimateQueue((s) => s.cancel);
  const flush = useClimateQueue((s) => s.flush);
  const mine = pending && pending.device === d.id ? pending : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!mine) return;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [mine]);

  const off = !d.online || busy !== null;
  const locked = off || !!d.eco || d.mode === "off" || !d.mode;
  const modes = d.modes?.length ? d.modes : ALL_MODES;
  const running = d.hvac === "heating" ? "Heating" : d.hvac === "cooling" ? "Cooling" : "Holding";
  const { heatF, coolF } = shownOf(d, mine);
  const both = d.mode === "heatcool";
  const one: "heat" | "cool" = d.mode === "cool" ? "cool" : "heat";
  const target = one === "cool" ? coolF : heatF;
  const set = (extra: PendingClimate["extra"], f: number) => (sameAs(d, extra) ? cancel() : hold(d.id, f, extra));
  // A knob moved to f: one set point, or one side of heat-and-cool, keeping the gap.
  const setSide = (side: "heat" | "cool", raw: number) => {
    const f = clampF(Math.round(raw));
    if (!both) return set({ tempF: f }, f);
    if (side === "heat") {
      const h = Math.min(f, THERMO_MAX_F - GAP_F);
      return set({ heatF: h, coolF: Math.max(coolF ?? h + GAP_F, h + GAP_F) }, h);
    }
    const c = Math.max(f, THERMO_MIN_F + GAP_F);
    const h = Math.min(heatF ?? c - GAP_F, c - GAP_F);
    return set({ heatF: h, coolF: c }, h);
  };
  const mood = moodOf(d, mine?.f ?? null);
  const left = mine ? Math.max(0, Math.ceil((mine.at - Date.now()) / 1000)) : 0;
  const what = mine ? (mine.extra.tempF !== undefined ? `${mine.extra.tempF}°` : `${mine.extra.heatF}° – ${mine.extra.coolF}°`) : "";
  const keys = (e: ReactKeyboardEvent) => {
    if (locked || both || target === null) return;
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    setSide(one, target + by);
  };
  const isOff = d.mode === "off" || !d.online;

  return (
    <div className="hv-th is-big" role="dialog" aria-label="Climate" tabIndex={-1} ref={box} data-mood={mood} data-mode={d.online ? (d.mode ?? "off") : "off"} data-held={mine ? "" : undefined}>
      <span className="hv-th-wx" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} style={{ left: `${4 + ((i * 29) % 92)}%`, animationDelay: `${(-i * 0.31).toFixed(2)}s` }} />
        ))}
      </span>
      <div className="hv-th-top">
        <span className="hv-uk">Climate</span>
        <span className="hv-th-run" data-run={isOff ? "off" : d.eco ? "eco" : running.toLowerCase()}>
          <i aria-hidden="true" />
          {!d.online ? "Offline" : d.mode === "off" ? "Off" : d.eco ? "Eco" : running}
        </span>
        <button type="button" className="hv-th-x" aria-label="Close the climate control" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="hv-th-dial" onKeyDown={keys}>
        <Dial d={d} mine={mine} locked={locked} onSet={setSide} />
        <div className="hv-th-mid">
          {isOff ? (
            <b className="hv-th-big is-off">{typeof d.tempF === "number" ? `${d.tempF}°` : "–"}</b>
          ) : both ? (
            <b className="hv-th-big is-pair">
              <span style={{ color: heatF !== null ? hueAt(heatF) : undefined }}>{heatF ?? "–"}°</span>
              <i>–</i>
              <span style={{ color: coolF !== null ? hueAt(coolF) : undefined }}>{coolF ?? "–"}°</span>
            </b>
          ) : (
            <b className="hv-th-big" style={{ color: target !== null ? hueAt(target) : undefined }}>
              {target ?? "–"}°
            </b>
          )}
          <span className="hv-th-k">{isOff ? "inside" : mine ? `sending in ${left}s` : both ? "heat · cool" : one === "cool" ? "cool to" : "heat to"}</span>
          {!isOff && typeof d.tempF === "number" ? <span className="hv-th-in">{d.tempF}° inside{typeof d.humidity === "number" ? ` · ${d.humidity}%` : ""}</span> : null}
        </div>
        {!both && !isOff && (
          <>
            <button type="button" className="hv-th-nudge is-dn" aria-label={`${one === "cool" ? "Cool to" : "Heat to"}: one degree cooler`} disabled={locked || target === null || target <= THERMO_MIN_F} onClick={() => target !== null && setSide(one, target - 1)}>
              −
            </button>
            <button type="button" className="hv-th-nudge is-up" aria-label={`${one === "cool" ? "Cool to" : "Heat to"}: one degree warmer`} disabled={locked || target === null || target >= THERMO_MAX_F} onClick={() => target !== null && setSide(one, target + 1)}>
              +
            </button>
          </>
        )}
      </div>

      {both && (
        <div className="hv-th-pair">
          {(["heat", "cool"] as const).map((side) => {
            const v = side === "heat" ? heatF : coolF;
            const lo = side === "heat" ? THERMO_MIN_F : (heatF ?? THERMO_MIN_F) + GAP_F;
            const hi = side === "heat" ? (coolF ?? THERMO_MAX_F) - GAP_F : THERMO_MAX_F;
            const label = side === "heat" ? "Heat to" : "Cool to";
            return (
              <div key={side} className="hv-th-step" data-side={side}>
                <span className="hv-th-k">{label}</span>
                <button type="button" aria-label={`${label}: one degree cooler`} disabled={locked || v === null || v <= lo} onClick={() => v !== null && setSide(side, v - 1)}>
                  −
                </button>
                <b aria-live="polite">{v === null ? "–" : `${v}°`}</b>
                <button type="button" aria-label={`${label}: one degree warmer`} disabled={locked || v === null || v >= hi} onClick={() => v !== null && setSide(side, v + 1)}>
                  +
                </button>
              </div>
            );
          })}
        </div>
      )}

      {mine ? (
        <div className="hv-th-held" role="status">
          <span className="hv-th-heldTxt">
            Sending <b>{what}</b> in {left}s
          </span>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="is-pri" onClick={flush}>
            Send now
          </button>
        </div>
      ) : null}

      <div className="hv-th-modes" role="group" aria-label="Mode">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            data-m={m}
            aria-pressed={d.mode === m}
            disabled={off || d.mode === m}
            onClick={() => {
              // A new mode drops a held set point: it was for the old mode.
              cancel();
              void act("thermostat.mode", d.id, undefined, { mode: m });
            }}
          >
            <i aria-hidden="true" />
            {MODE_WORD[m]}
          </button>
        ))}
      </div>

      <p className="hv-th-note">
        {d.eco
          ? "Eco is on: the Nest keeps its own eco range, so the set point waits until eco is off (in the Home app)."
          : busy
            ? "Sending…"
            : mine
              ? "Keep adjusting: it sends once, three seconds after the last change."
              : (said ?? `Drag the dial or tap − and +. Set points stay between ${THERMO_MIN_F} and ${THERMO_MAX_F} °F.`)}
      </p>
    </div>
  );
}
