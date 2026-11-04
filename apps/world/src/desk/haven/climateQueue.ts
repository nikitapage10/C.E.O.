import { create } from "zustand";
import { useHome, type ActExtra, type DeviceReading } from "../homeDevices.ts";

/**
 * The Climate's held change (#718): every tap, turn or arrow on the dial or in the Climate control only moves the
 * pending set point; the thermostat hears once, about three seconds after the last change, with the final setting
 * (through the same thermostat.set action and its rails). Until then the dial and the control show it as pending,
 * with Cancel and Send now.
 */

export const HOLD_MS = 3000;

export interface PendingClimate {
  device: string;
  /** The dial's set point (heat side in heat-and-cool), for the dial and the strip. */
  f: number;
  /** What goes to thermostat.set. */
  extra: Pick<ActExtra, "tempF" | "heatF" | "coolF">;
  /** When it sends (ms since epoch). */
  at: number;
}

/** How long a sent change shows before the thermostat's own reading must have caught up. */
export const SENT_MS = 60_000;

interface ClimateQueue {
  pending: PendingClimate | null;
  /** The last change sent (#742), shown until the thermostat reports it, or dropped (rolled back) if the send failed. */
  sent: (PendingClimate & { until: number }) | null;
  /** Hold a change: replaces any held one and starts the three seconds again. */
  hold: (device: string, f: number, extra: PendingClimate["extra"], ms?: number) => void;
  cancel: () => void;
  /** Send the held change now. */
  flush: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useClimateQueue = create<ClimateQueue>((set, get) => ({
  pending: null,
  sent: null,
  hold: (device, f, extra, ms = HOLD_MS) => {
    clearTimeout(timer);
    set({ pending: { device, f, extra, at: Date.now() + ms } });
    timer = setTimeout(() => get().flush(), ms);
  },
  cancel: () => {
    clearTimeout(timer);
    set({ pending: null });
  },
  flush: () => {
    clearTimeout(timer);
    const p = get().pending;
    if (!p) return set({ pending: null });
    const sent = { ...p, until: Date.now() + SENT_MS };
    set({ pending: null, sent });
    void useHome
      .getState()
      .act("thermostat.set", p.device, undefined, p.extra)
      .then((ok) => {
        // Refused or failed: the dial goes back to what the thermostat has.
        if (!ok && get().sent === sent) set({ sent: null });
      });
  },
}));

/** What the dial shows for a thermostat: the held change, else the one just sent until the reading has caught up. */
export function shownChange(d: DeviceReading, pending: PendingClimate | null, sent: (PendingClimate & { until: number }) | null, now = Date.now()): PendingClimate | null {
  if (pending && pending.device === d.id) return pending;
  if (sent && sent.device === d.id && now < sent.until && !sameAs(d, sent.extra)) return sent;
  return null;
}

/** Is the held change the same as what the thermostat already has? Then there's nothing to send. */
export function sameAs(d: DeviceReading, extra: PendingClimate["extra"]): boolean {
  if (extra.tempF !== undefined) return extra.tempF === (d.mode === "cool" ? d.coolF : d.heatF);
  return extra.heatF === d.heatF && extra.coolF === d.coolF;
}

/** What the climate is doing, for the dial's weather: heating (orange), cooling (blue), or holding (calm). */
export type ClimateMood = "heat" | "cool" | "hold" | "off";

export function moodOf(d: DeviceReading | null, pendingF: number | null = null): ClimateMood {
  if (!d || !d.online || d.mode === "off") return "off";
  // A held change says where it is going: above the room's temperature warms, below it cools.
  if (pendingF !== null && typeof d.tempF === "number" && pendingF !== d.tempF) {
    if (d.mode === "heat" && pendingF > d.tempF) return "heat";
    if (d.mode === "cool" && pendingF < d.tempF) return "cool";
  }
  if (d.hvac === "heating") return "heat";
  if (d.hvac === "cooling") return "cool";
  return "hold";
}
