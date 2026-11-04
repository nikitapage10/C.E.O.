import { useEffect, useRef } from "react";
import { THERMO_MAX_F, THERMO_MIN_F, useHome, type DeviceReading, type ThermoMode } from "../homeDevices.ts";

/**
 * The Haven's thermostat control (#671): opened from the Climate card or the Nest's marker in the house, passkey only.
 * The set point a degree at a time (both ends in heat-and-cool), the mode, and eco shown as it is. Every change goes
 * through the same action as Today's Home chip (thermostat.set / thermostat.mode), so the server's rails (60 to 80 °F,
 * a 3 °F gap, nothing while eco is on or the mode is off) and its Council log apply. A floating card, so the
 * House-wide column can change round it.
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

  const off = !d.online || busy !== null;
  const locked = off || !!d.eco || d.mode === "off" || !d.mode;
  const modes = d.modes?.length ? d.modes : ALL_MODES;
  const running = d.hvac === "heating" ? "Heating" : d.hvac === "cooling" ? "Cooling" : "Holding";
  const set = (extra: { tempF?: number; heatF?: number; coolF?: number }) => void act("thermostat.set", d.id, undefined, extra);

  return (
    <div className="hv-th" role="dialog" aria-label="Climate" tabIndex={-1} ref={box}>
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
          <Stepper label="Heat to" value={d.heatF} lo={THERMO_MIN_F} hi={(d.coolF ?? THERMO_MAX_F) - GAP_F} off={locked} onSet={(f) => set({ heatF: f, coolF: d.coolF ?? f + GAP_F })} />
          <Stepper label="Cool to" value={d.coolF} lo={(d.heatF ?? THERMO_MIN_F) + GAP_F} hi={THERMO_MAX_F} off={locked} onSet={(f) => set({ heatF: d.heatF ?? f - GAP_F, coolF: f })} />
        </>
      ) : d.mode === "heat" || d.mode === "cool" ? (
        <Stepper label={d.mode === "heat" ? "Heat to" : "Cool to"} value={d.mode === "heat" ? d.heatF : d.coolF} lo={THERMO_MIN_F} hi={THERMO_MAX_F} off={locked} onSet={(f) => set({ tempF: f })} />
      ) : null}

      <div className="hv-th-modes" role="group" aria-label="Mode">
        {modes.map((m) => (
          <button key={m} type="button" aria-pressed={d.mode === m} disabled={off || d.mode === m} onClick={() => void act("thermostat.mode", d.id, undefined, { mode: m })}>
            {MODE_WORD[m]}
          </button>
        ))}
      </div>

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
