import type { RoomId } from "@ceo/core";
import { RC, WHITE } from "../desk/wvCanvas.ts";

/**
 * The Lattice's Weave (#374): the Desk's dots and threads of light, brought into the Lattice. One small 2D canvas over
 * the 3D world (WeaveCanvas) that the scene draws on once per frame (WeaveProbe), so it costs the GPU no draw calls.
 * This is what the two halves share: the canvas, where a signal lands in the HUD, and the signals on their way.
 */

export interface Pulse {
  /** The feed line it carries (hud/format.ts), so each one flies once. */
  id: string;
  room: RoomId;
  born: number;
}

export const weaveBus = {
  canvas: null as HTMLCanvasElement | null,
  /** The knot on the Signals panel where a signal's thread lands (null while the panel isn't showing). */
  knot: null as HTMLElement | null,
  pulses: [] as Pulse[],
  /** The overlay faded after a quiet spell (#328): threads to the HUD dim with it. */
  idle: false,
  /** Frames the scene ran the Weave in, and how many of them drew something (for window.__ceo.weave()). */
  frames: 0,
  drawn: 0,
  /** What a drawing frame of the Weave costs on the main thread, in ms (a running average). */
  ms: 0,
};

/** At most this many threads in flight; a burst of signals shows as a few, not a tangle. */
export const MAX_PULSES = 4;
export const PULSE_MS = 2600;

export function addPulse(p: Pulse) {
  const ps = weaveBus.pulses;
  if (ps.some((q) => q.id === p.id)) return;
  ps.push(p);
  if (ps.length > MAX_PULSES) ps.splice(0, ps.length - MAX_PULSES);
}

/** A room's thread colour (the Desk's room colours, as "r,g,b"). */
export const roomRgb = (room: RoomId | undefined): string => (room && RC[room]) || WHITE;
