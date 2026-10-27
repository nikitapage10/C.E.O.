/**
 * A room's tempo (#262): how its real activity moves the particle lines. One signal per room (`RoomPulse.activity`,
 * 0..1, built from real data only in roomPulse.ts) becomes four multipliers the kit applies to every line on the room's
 * pages: busier rooms run faster, carry more, glow brighter and spread thicker. Rooms with nothing connected (simulated,
 * or waiting on a source) idle: slow, sparse and dim, never fake flow. Pure and tested; the hook is useTempo.ts.
 */

export interface Tempo {
  /** 0..1, the room's activity as the lines show it (quantised, so a tiny change never re-lays the field). */
  level: number;
  /** Nothing real is moving the room: it idles. */
  idle: boolean;
  /** Multipliers on each line's own rate, density, brightness and spread. */
  rate: number;
  density: number;
  bright: number;
  spread: number;
}

/** The neutral tempo: a page with no room (the Lattice map, the harness) keeps its own look exactly. */
export const NEUTRAL: Tempo = { level: 0.35, idle: false, rate: 1, density: 1, bright: 1, spread: 1 };

/** What an idle room's lines do: barely drift. */
export const IDLE: Tempo = { level: 0, idle: true, rate: 0.5, density: 0.55, bright: 0.7, spread: 0.9 };

/** The activity where a page's own look is unchanged; quieter rooms slow below it, busier ones speed above it. */
const MID = 0.35;
const STEPS = 20;

export interface TempoIn {
  real: boolean;
  state: "busy" | "steady" | "waiting" | "down" | "sim";
  activity: number;
}

/** A room's tempo from its pulse. */
export function tempoOf(p: TempoIn | null | undefined): Tempo {
  if (!p) return NEUTRAL;
  if (!p.real || p.state === "sim" || p.state === "waiting") return IDLE;
  const raw = Number.isFinite(p.activity) ? Math.max(0, Math.min(1, p.activity)) : 0;
  // A room that's down still shows its lines (the page says what broke), held low and slow.
  const level = Math.round((p.state === "down" ? Math.min(raw, 0.15) : raw) * STEPS) / STEPS;
  const d = level - MID;
  return {
    level,
    idle: false,
    rate: round(1 + d * 1.2),
    density: round(1 + d * 0.9),
    bright: round(1 + d * 0.45),
    spread: round(1 + d * 0.6),
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Apply a tempo to one line's own numbers (the kit's defaults when a line leaves them out). */
export function tempoLine(t: Tempo, L: { rate?: number; density?: number; bright?: number; spread?: number; waiting?: boolean }) {
  if (L.waiting) return { rate: L.rate ?? 40, density: L.density ?? 0.5, bright: L.bright ?? 0.85, spread: L.spread ?? 2 };
  return {
    rate: (L.rate ?? 40) * t.rate,
    density: Math.min(1, (L.density ?? 0.5) * t.density),
    bright: Math.min(1, (L.bright ?? 0.85) * t.bright),
    spread: (L.spread ?? 2) * t.spread,
  };
}

/** The small legend by the lines: "Foundry · 14 runs today", "Workshop · idle, nothing connected". */
export function legendOf(p: { name: string; drive: string } & TempoIn): string {
  const t = tempoOf(p);
  if (t.idle) return `${p.name} · idle, ${p.drive}`;
  return `${p.name} · ${p.drive}`;
}

/** Today's legend (#262): the busiest real rooms, most active first (up to `most`), and how many rooms idle. */
export function driveOf<P extends { id: string; name: string; drive: string } & TempoIn>(pulses: readonly P[], most = 3): { lead: P[]; idle: number } {
  const live = pulses.map((p) => ({ p, t: tempoOf(p) })).filter((x) => !x.t.idle);
  const lead = live.sort((a, b) => b.t.level - a.t.level).slice(0, most).map((x) => x.p);
  return { lead, idle: pulses.length - live.length };
}
