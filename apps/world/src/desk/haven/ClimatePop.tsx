import { useEffect, useRef, useState } from "react";
import { THERMO_MAX_F, THERMO_MIN_F, useHome, type DeviceReading, type ThermoMode } from "../homeDevices.ts";
import { moodOf, sameAs, useClimateQueue, type PendingClimate } from "./climateQueue.ts";

/**
 * The Haven's thermostat control (#671): opened from the plinth's Climate dial (#680) or the Nest's marker, passkey only.
 * The set point a degree at a time (both ends in heat-and-cool), the mode, and eco shown as it is. Every change goes
 * through the same action as Today's Home chip (thermostat.set / thermostat.mode), so the server's rails (60 to 80 °F,
 * a 3 °F gap, nothing while eco is on or the mode is off) and its Council log apply. A floating card, so the
 * plinth (#680) can open it over its dial. Since #718 the set point taps are held: the thermostat hears once, three
 * seconds after the last tap, with the final setting (climateQueue.ts), and the card says so with Cancel and Send now.
 */

/** The heat-and-cool gap the rails keep (api/_haven/devices/rails.ts, THERMO_GAP_F). */
const GAP_F = 3;
const MODE_WORD: Record<ThermoMode, string> = { heat: "Heat", cool: "Cool", heatcool: "Heat · Cool", off: "Off" };
const ALL_MODES: readonly ThermoMode[] = ["heat", "cool", "heatcool", "off"];

const clampF = (f: number) => Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, f));

function Stepper({ label, value, lo, hi, off, onSet }: { label: string; value: number | null | undefined; lo: number; hi: number; off: boolean; onSet: (f: number) => void }) {
  const v = typeof value === "number" ? value : null;
  return (
    <div className="hv-th-step">
      <span className="hv-th-k">{label}</span>
      <button type="button" aria-label={`${label}: one degree cooler`} disabled={off || v === null || v <= lo} onClick={() => v !== null && onSet(clampF(v - 1))}>
        −
      </button>
      <b aria-live="polite">{v === null ? "–" : `${v}°`}</b>
      <button type="button" aria-label={`${label}: one degree warmer`} disabled={off || v === null || v >= hi} onClick={() => v !== null && onSet(clampF(v + 1))}>
        +
      </button>
    </div>
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
  // What the steppers show: the held change while there is one, else the thermostat's own.
  const heatF = mine ? (mine.extra.heatF ?? (d.mode === "heat" ? mine.extra.tempF : d.heatF)) : d.heatF;
  const coolF = mine ? (mine.extra.coolF ?? (d.mode === "cool" ? mine.extra.tempF : d.coolF)) : d.coolF;
  const set = (extra: PendingClimate["extra"], f: number) => (sameAs(d, extra) ? cancel() : hold(d.id, f, extra));
  const mood = moodOf(d, mine?.f ?? null);
  const left = mine ? Math.max(0, Math.ceil((mine.at - Date.now()) / 1000)) : 0;

  return (
    <div className="hv-th" role="dialog" aria-label="Climate" tabIndex={-1} ref={box} data-mood={mood}>
      <span className="hv-th-wx" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ left: `${6 + ((i * 29) % 88)}%`, animationDelay: `${(-i * 0.37).toFixed(2)}s` }} />
        ))}
      </span>
      <div className="hv-th-top">
        <span className="hv-uk">Climate</span>
        <button type="button" className="hv-th-x" aria-label="Close the climate control" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="hv-th-now">
        <b>{typeof d.tempF === "number" ? `${d.tempF}°F` : "–"}</b>
        <span>
          inside{typeof d.humidity === "number" ? ` · ${d.humidity}% humidity` : ""}
          <br />
          {!d.online ? "The thermostat is offline." : d.mode === "off" ? "Off" : d.eco ? "Eco" : running}
        </span>
      </p>

      {d.mode === "heatcool" ? (
        <>
          <Stepper label="Heat to" value={heatF} lo={THERMO_MIN_F} hi={(coolF ?? THERMO_MAX_F) - GAP_F} off={locked} onSet={(f) => set({ heatF: f, coolF: coolF ?? f + GAP_F }, f)} />
          <Stepper label="Cool to" value={coolF} lo={(heatF ?? THERMO_MIN_F) + GAP_F} hi={THERMO_MAX_F} off={locked} onSet={(f) => set({ heatF: heatF ?? f - GAP_F, coolF: f }, heatF ?? f - GAP_F)} />
        </>
      ) : d.mode === "heat" || d.mode === "cool" ? (
        <Stepper label={d.mode === "heat" ? "Heat to" : "Cool to"} value={d.mode === "heat" ? heatF : coolF} lo={THERMO_MIN_F} hi={THERMO_MAX_F} off={locked} onSet={(f) => set({ tempF: f }, f)} />
      ) : null}

      <div className="hv-th-modes" role="group" aria-label="Mode">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={d.mode === m}
            disabled={off || d.mode === m}
            onClick={() => {
              // A new mode drops a held set point: it was for the old mode.
              cancel();
              void act("thermostat.mode", d.id, undefined, { mode: m });
            }}
          >
            {MODE_WORD[m]}
          </button>
        ))}
      </div>

      {mine && (
        <div className="hv-th-held" role="status">
          <span className="hv-heldRing" aria-hidden="true" />
          <span>Sending in {left}s</span>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="is-pri" onClick={flush}>
            Send now
          </button>
        </div>
      )}
      <p className="hv-th-note">
        {d.eco
          ? "Eco is on: the Nest keeps its own eco range, so the set point waits until eco is off (in the Home app)."
          : busy
            ? "Sending…"
            : (said ?? `Set points stay between ${THERMO_MIN_F} and ${THERMO_MAX_F} °F.`)}
      </p>
    </div>
  );
}
