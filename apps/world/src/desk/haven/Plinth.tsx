import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent, type Ref } from "react";
import { THERMO_MAX_F, THERMO_MIN_F, useHome, type DeviceReading } from "../homeDevices.ts";
import { angleOf, dialOf, DIAL_A0, DIAL_SWEEP, turnTo, type Gauge, type GaugeId } from "./plinth.ts";

/**
 * The instrument plinth (#680, Nikita's pick of four): the house-wide readings as a hi-fi faceplate in the dark to the
 * lower right of the house (under it on a phone, scrolling sideways). One engraved gauge per reading, its lamp lit
 * amber (ember when the device is down, dim while it waits), and a thread of nanites from each lamp to its device in
 * the scene (house.ts). Climate is the rotary dial at the left end: tap it for the Climate control (ClimatePop), or
 * turn it to move the set point, through the same thermostat.set action and its rails (60 to 80 °F).
 */

const STEP = DIAL_SWEEP / (THERMO_MAX_F - THERMO_MIN_F);
const R = 40;
const C = 50;
const pt = (a: number, r: number) => [+(C + Math.cos(a) * r).toFixed(2), +(C + Math.sin(a) * r).toFixed(2)] as const;
const seg = (a: number, r0: number, r1: number) => {
  const [x1, y1] = pt(a, r0), [x2, y2] = pt(a, r1);
  return { x1, y1, x2, y2 };
};

function DialFace({ inside, set, live, heat }: { inside: string; set: number | null; live: boolean; heat: boolean }) {
  const ticks = [];
  for (let i = 0; i <= THERMO_MAX_F - THERMO_MIN_F; i++) {
    const a = DIAL_A0 + i * STEP, f = THERMO_MIN_F + i;
    const lit = set !== null && (heat ? f <= set : f >= set);
    ticks.push(<line key={i} {...seg(a, R + 2, i % 5 ? R + 7 : R + 10)} className={lit ? "is-lit" : undefined} strokeWidth={i % 5 ? 1 : 1.6} />);
  }
  const ka = set !== null ? angleOf(set) : null;
  return (
    <svg className="hv-dialFace" viewBox="-4 -4 108 108" aria-hidden="true" data-live={live ? "" : undefined}>
      <circle cx={C} cy={C} r={R} className="hv-dialRim" />
      <circle cx={C} cy={C} r={R - 6} className="hv-dialIn" />
      <g className="hv-dialTicks">{ticks}</g>
      {ka !== null && <line className="hv-dialKnob" {...seg(ka, R - 16, R - 4)} />}
      <text x={C} y={C + 2} className="hv-dialV" textAnchor="middle" dominantBaseline="middle">
        {inside}
      </text>
    </svg>
  );
}

function ClimateDial({ g, thermo, open, onToggle, lamp }: { g: Gauge; thermo: DeviceReading | null; open: boolean; onToggle: () => void; lamp: Ref<HTMLElement> }) {
  const act = useHome((s) => s.act);
  const busy = useHome((s) => s.busy);
  const dial = dialOf(thermo);
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{ a: number; set: number; moved: number; at: number } | null>(null);
  const dragged = useRef(false);
  const commitT = useRef<number | undefined>(undefined);
  const face = useRef<HTMLButtonElement>(null);

  // The settled set point arrives with the next reading (#682): the preview gives way to it, or after a while regardless.
  useEffect(() => setPreview(null), [dial?.set]);
  useEffect(() => {
    if (preview === null) return;
    const t = window.setTimeout(() => setPreview(null), 9000);
    return () => window.clearTimeout(t);
  }, [preview]);
  useEffect(() => () => window.clearTimeout(commitT.current), []);

  const turnable = !!thermo && !!dial && busy === null;
  const commit = (f: number) => {
    if (!thermo || !dial || f === dial.set) return setPreview(null);
    const extra = turnTo(thermo, f);
    if (extra) void act("thermostat.set", thermo.id, undefined, extra);
  };
  const angle = (e: PointerEvent) => {
    const b = face.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (!turnable || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { a: angle(e), set: preview ?? dial!.set, moved: 0, at: preview ?? dial!.set };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    let da = angle(e) - d.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    d.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (d.moved < 6) return;
    // Turning it like a knob: the change in angle, a degree a tick, the start carried along so it can go round.
    const f = Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, d.set + Math.round(da / STEP)));
    if (Math.abs(da) > STEP * 6) {
      d.a = angle(e);
      d.set = f;
    }
    d.at = f;
    setPreview(f);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved < 6) return;
    dragged.current = true;
    commit(d.at);
  };
  const key = (e: KeyboardEvent) => {
    if (!turnable) return;
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const f = Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, (preview ?? dial!.set) + by));
    setPreview(f);
    window.clearTimeout(commitT.current);
    commitT.current = window.setTimeout(() => commit(f), 700);
  };

  const set = preview ?? dial?.set ?? null;
  const heat = thermo?.mode !== "cool";
  const state = preview !== null ? `set to ${preview}°` : g.state;
  const body = (
    <>
      <span className="hv-dialWrap">
        <i className="hv-lamp" ref={lamp as Ref<HTMLElement>} data-tone={g.tone} />
        <DialFace inside={g.value} set={set} live={g.tone === "on"} heat={heat} />
      </span>
      <span className="hv-gTxt">
        <span className="hv-gName">{g.name}</span>
        <span className="hv-gState">{state}</span>
        {thermo && <span className="hv-gHint">{dial ? "tap · turn to set" : "tap for controls"}</span>}
      </span>
    </>
  );
  if (!thermo)
    return (
      <div className="hv-gauge is-dial" data-tone={g.tone} data-gauge="climate">
        {body}
      </div>
    );
  return (
    <button
      type="button"
      ref={face}
      className="hv-gauge is-dial is-btn"
      data-tone={g.tone}
      data-gauge="climate"
      data-turning={preview !== null ? "" : undefined}
      aria-expanded={open}
      aria-label={`Climate: ${g.value === "Down" ? "down" : `${g.value} inside`}${set !== null ? `, set to ${set}°F` : ""}. Opens the climate control${dial ? "; arrow keys turn the set point" : ""}.`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={key}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onToggle();
      }}
    >
      {body}
    </button>
  );
}

export interface PlinthProps {
  gauges: Gauge[];
  thermo: DeviceReading | null;
  climateOpen: boolean;
  onClimate: () => void;
  /** A gauge that opens something: the Kitchen and Gym tabs (signed in), the to-dos on Today. */
  onOpen: (id: GaugeId) => void;
  canOpen: (id: GaugeId) => boolean;
  lamp: (id: GaugeId) => (el: HTMLElement | null) => void;
  onScroll?: () => void;
  stripRef?: Ref<HTMLElement>;
  /** The Climate control, opened over the strip's left end. */
  children?: ReactNode;
}

export function Plinth({ gauges, thermo, climateOpen, onClimate, onOpen, canOpen, lamp, onScroll, stripRef, children }: PlinthProps) {
  return (
    <aside className="hv-plinth" aria-label="House-wide" ref={stripRef}>
      <div className="hv-plate" onScroll={onScroll}>
        {gauges.map((g) =>
          g.id === "climate" ? (
            <ClimateDial key={g.id} g={g} thermo={thermo} open={climateOpen} onToggle={onClimate} lamp={lamp(g.id)} />
          ) : (
            (() => {
              const inner = (
                <>
                  <i className="hv-lamp" ref={lamp(g.id)} data-tone={g.tone} />
                  <b className="hv-gV">{g.value}</b>
                  <span className="hv-gName">{g.name}</span>
                  <span className="hv-gState">{g.state}</span>
                </>
              );
              if (g.id === "todos")
                return (
                  <a key={g.id} className="hv-gauge is-btn" data-tone={g.tone} data-gauge={g.id} href="/">
                    {inner}
                  </a>
                );
              if (g.id === "kitchen" || g.id === "gym")
                return (
                  <button key={g.id} type="button" className="hv-gauge is-btn" data-tone={g.tone} data-gauge={g.id} disabled={!canOpen(g.id)} onClick={() => onOpen(g.id)}>
                    {inner}
                  </button>
                );
              return (
                <div key={g.id} className="hv-gauge" data-tone={g.tone} data-gauge={g.id}>
                  {inner}
                </div>
              );
            })()
          ),
        )}
      </div>
      {children}
    </aside>
  );
}
