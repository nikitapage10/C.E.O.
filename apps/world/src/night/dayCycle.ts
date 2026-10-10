/**
 * The Lattice keeps its own hours. A Lattice day passes in twenty minutes at 1× (faster at higher speeds), and
 * it starts late in the afternoon, so the first night falls a few minutes after you arrive. `?hour=22` starts
 * at a given hour instead.
 */
import { clock } from "../clock.ts";

export const DAY_MS = 20 * 60_000;

/** Skips ahead (the Kernel console's "lights out" and "sunrise"): `ms` eases toward `target`, a time-lapse. */
export const daySkip = { ms: 0, target: 0 };

/** Ease a skip along. Called once a frame. */
export function tickDaySkip(dt: number) {
  daySkip.ms += (daySkip.target - daySkip.ms) * Math.min(1, dt * 0.9);
}

/** The Lattice hour right now. */
export function hourNow(): number {
  return latticeHour(clock.sim + daySkip.ms);
}

/** Skip forward to the next time the clock reads `hour`. */
export function skipTo(hour: number) {
  const ahead = (((hour - latticeHour(clock.sim + daySkip.target)) % 24) + 24) % 24;
  daySkip.target += (ahead / 24) * DAY_MS;
}

const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
const asked = Number(q.get("hour"));
export const START_HOUR = q.has("hour") && Number.isFinite(asked) ? ((asked % 24) + 24) % 24 : 16;

/** Lattice hour of day (0…24, fractional) for a Lattice time in ms. */
export function latticeHour(simMs: number, start = START_HOUR): number {
  return (((start + (simMs / DAY_MS) * 24) % 24) + 24) % 24;
}

/** Which Lattice day it is, from 1. */
export function latticeDay(simMs: number, start = START_HOUR): number {
  return 1 + Math.floor((start + (simMs / DAY_MS) * 24) / 24);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 in full day, 1 in full night, easing through dusk (18:30–20:30) and dawn (04:30–06:30). */
export function darkness(hour: number): number {
  return Math.max(smooth(18.5, 20.5, hour), 1 - smooth(4.5, 6.5, hour));
}

export type Shift = "day" | "dusk" | "night" | "dawn";

export function shiftOf(hour: number): Shift {
  if (hour >= 18.5 && hour < 20.5) return "dusk";
  if (hour >= 20.5 || hour < 4.5) return "night";
  if (hour < 6.5) return "dawn";
  return "day";
}

export const SHIFT_LABEL: Record<Shift, string> = { day: "Day shift", dusk: "Dusk", night: "Night shift", dawn: "Dawn" };

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
