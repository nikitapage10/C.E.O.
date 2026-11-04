import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent, type Ref } from "react";
import { THERMO_MAX_F, THERMO_MIN_F, useHome, type DeviceReading } from "../homeDevices.ts";
import { angleOf, dialOf, DIAL_A0, DIAL_SWEEP, orderGauges, turnTo, type Gauge, type GaugeId } from "./plinth.ts";
import { moodOf, sameAs, useClimateQueue, type ClimateMood } from "./climateQueue.ts";

/**
 * The instrument plinth (#680, Nikita's pick of four): the house-wide readings as a hi-fi faceplate in the dark to the
 * lower right of the house (under it on a phone, scrolling sideways). One engraved gauge per reading, its lamp lit
 * amber (ember when the device is down, dim while it waits), and a thread of nanites from each lamp to its device in
 * the scene (house.ts). Since #718 it is docked along the foot of the house, its gauges in the order their rooms stand
 * left to right on screen, so no two threads cross. Climate is the rotary dial: tap it for the Climate control
 * (ClimatePop), or turn it to move the set point; a change is held three seconds after the last turn and then sent
 * once (climateQueue.ts), through the same thermostat.set action and its rails (60 to 80 °F).
 */

const STEP = DIAL_SWEEP / (THERMO_MAX_F - THERMO_MIN_F);
const R = 40;
const C = 50;
const pt = (a: number, r: number) => [+(C + Math.cos(a) * r).toFixed(2), +(C + Math.sin(a) * r).toFixed(2)] as const;
const seg = (a: number, r0: number, r1: number) => {
  const [x1, y1] = pt(a, r0), [x2, y2] = pt(a, r1);
  return { x1, y1, x2, y2 };
};

/** The dial's weather (#718): embers rising while it heats, frost falling while it cools, a slow breath while it holds. */
function Weather({ mood }: { mood: ClimateMood }) {
  if (mood === "off") return null;
  const motes = [];
  for (let i = 0; i < 9; i++) {
    const x = 26 + ((i * 37) % 48);
    motes.push(<circle key={i} className="hv-wxMote" cx={x} cy={mood === "cool" ? 18 : 82} r={i % 3 ? 1.4 : 2} style={{ animationDelay: `${(-i * 0.47).toFixed(2)}s`, ["--dx" as string]: `${((i % 4) - 1.5) * 3}px` }} />);
  }
  return (
    <g className="hv-wx" data-mood={mood}>
      <circle cx={C} cy={C} r={R + 12} className="hv-wxGlow" />
      {mood !== "hold" && <g className="hv-wxMotes">{motes}</g>}
    </g>
  );
}

function DialFace({ inside, set, live, heat, mood }: { inside: string; set: number | null; live: boolean; heat: boolean; mood: ClimateMood }) {
  const ticks = [];
  for (let i = 0; i <= THERMO_MAX_F - THERMO_MIN_F; i++) {
    const a = DIAL_A0 + i * STEP, f = THERMO_MIN_F + i;
    const lit = set !== null && (heat ? f <= set : f >= set);
    ticks.push(<line key={i} {...seg(a, R + 2, i % 5 ? R + 7 : R + 10)} className={lit ? "is-lit" : undefined} strokeWidth={i % 5 ? 1 : 1.6} />);
  }
  const ka = set !== null ? angleOf(set) : null;
  return (
    <svg className="hv-dialFace" viewBox="-4 -4 108 108" aria-hidden="true" data-live={live ? "" : undefined} data-mood={mood}>
      <Weather mood={mood} />
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
  const busy = useHome((s) => s.busy);
  const pending = useClimateQueue((s) => s.pending);
  const hold = useClimateQueue((s) => s.hold);
  const cancel = useClimateQueue((s) => s.cancel);
  const dial = dialOf(thermo);
  // The set point while a finger is on the dial; once it lifts the change is held (climateQueue.ts).
  const [turning, setTurning] = useState<number | null>(null);
  const drag = useRef<{ a: number; set: number; moved: number; at: number } | null>(null);
  const dragged = useRef(false);
  const face = useRef<HTMLButtonElement>(null);
  const held = pending && thermo && pending.device === thermo.id ? pending.f : null;

  const turnable = !!thermo && !!dial && busy === null;
  const commit = (f: number) => {
    if (!thermo || !dial) return;
    const extra = turnTo(thermo, f);
    if (!extra || sameAs(thermo, extra)) return cancel();
    hold(thermo.id, f, extra);
  };
  const angle = (e: PointerEvent) => {
    const b = face.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (!turnable || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const from = held ?? dial!.set;
    drag.current = { a: angle(e), set: from, moved: 0, at: from };
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
    setTurning(f);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setTurning(null);
    if (!d || d.moved < 6) return;
    dragged.current = true;
    commit(d.at);
  };
  const key = (e: KeyboardEvent) => {
    if (!turnable) return;
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    commit(Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, (held ?? dial!.set) + by)));
  };

  const set = turning ?? held ?? dial?.set ?? null;
  const heat = thermo?.mode !== "cool";
  const mood = moodOf(thermo, turning ?? held);
  const state = turning !== null ? `set to ${turning}°` : held !== null ? `${held}° · sending soon` : g.state;
  const body = (
    <>
      <span className="hv-dialWrap">
        <i className="hv-lamp" ref={lamp as Ref<HTMLElement>} data-tone={g.tone} />
        <DialFace inside={g.value} set={set} live={g.tone === "on"} heat={heat} mood={thermo ? mood : "off"} />
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
      data-mood={mood}
      data-turning={turning !== null || held !== null ? "" : undefined}
      aria-expanded={open}
      aria-label={`Climate: ${g.value === "Down" ? "down" : `${g.value} inside`}${set !== null ? `, set to ${set}°F` : ""}${held !== null ? ", sending in a moment" : ""}. Opens the climate control${dial ? "; arrow keys turn the set point" : ""}.`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        drag.current = null;
        setTurning(null);
      }}
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

/** The held change, under the strip's dial: what it will send, a countdown, Cancel and Send now. */
export function ClimateHeld({ thermo }: { thermo: DeviceReading | null }) {
  const pending = useClimateQueue((s) => s.pending);
  const cancel = useClimateQueue((s) => s.cancel);
  const flush = useClimateQueue((s) => s.flush);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [pending]);
  if (!pending || !thermo || pending.device !== thermo.id) return null;
  const left = Math.max(0, Math.ceil((pending.at - Date.now()) / 1000));
  const what = pending.extra.tempF !== undefined ? `${pending.extra.tempF}°` : `heat ${pending.extra.heatF}° · cool ${pending.extra.coolF}°`;
  return (
    <div className="hv-held" role="status">
      <span className="hv-heldRing" aria-hidden="true" />
      <span>
        Setting <b>{what}</b> in {left}s
      </span>
      <button type="button" onClick={cancel}>
        Cancel
      </button>
      <button type="button" className="is-pri" onClick={flush}>
        Send now
      </button>
    </div>
  );
}

export interface PlinthProps {
  gauges: Gauge[];
  /** The gauges left to right by where their rooms stand on screen (house.ts, `order`), so the threads never cross. */
  order?: GaugeId[] | null;
  thermo: DeviceReading | null;
  /** The gauge whose pop-up is open (Climate's control, a device's controls). */
  pop: GaugeId | null;
  onPop: (id: GaugeId) => void;
  /** Does this gauge open a pop-up of controls? */
  canPop: (id: GaugeId) => boolean;
  /** A gauge that opens something: the Kitchen and Gym tabs (signed in). */
  onOpen: (id: GaugeId) => void;
  canOpen: (id: GaugeId) => boolean;
  lamp: (id: GaugeId) => (el: HTMLElement | null) => void;
  onScroll?: () => void;
  stripRef?: Ref<HTMLElement>;
  /** The open pop-up, laid over the strip above its gauge. */
  children?: ReactNode;
}

export function Plinth({ gauges, order, thermo, pop, onPop, canPop, onOpen, canOpen, lamp, onScroll, stripRef, children }: PlinthProps) {
  const plate = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  // The pop-up sits over its gauge (clamped to the strip): measured when it opens and when the strip scrolls.
  useEffect(() => {
    const p = plate.current;
    if (!pop || !p) return setAnchor(null);
    const place = () => {
      const el = p.querySelector<HTMLElement>(`[data-gauge="${pop}"]`);
      if (!el) return;
      const pb = p.parentElement!.getBoundingClientRect(), b = el.getBoundingClientRect();
      setAnchor(Math.round(b.left + b.width / 2 - pb.left));
    };
    place();
    p.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      p.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [pop, order]);
  const list = orderGauges(gauges, order ?? null);
  return (
    <aside className="hv-plinth" aria-label="House-wide" ref={stripRef}>
      <div className="hv-plate" ref={plate} onScroll={onScroll}>
        {list.map((g) => {
          if (g.id === "climate") return <ClimateDial key={g.id} g={g} thermo={thermo} open={pop === "climate"} onToggle={() => onPop("climate")} lamp={lamp(g.id)} />;
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
          if (canPop(g.id))
            return (
              <button key={g.id} type="button" className="hv-gauge is-btn" data-tone={g.tone} data-gauge={g.id} aria-expanded={pop === g.id} aria-label={`${g.name}: ${g.value}, ${g.state}. Opens its controls.`} onClick={() => onPop(g.id)}>
                {inner}
              </button>
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
        })}
      </div>
      <ClimateHeld thermo={thermo} />
      {children && (
        <div className="hv-popAt" style={anchor !== null ? { ["--at" as string]: `${anchor}px` } : undefined}>
          {children}
        </div>
      )}
    </aside>
  );
}
