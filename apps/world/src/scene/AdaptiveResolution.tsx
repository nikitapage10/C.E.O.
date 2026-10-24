import { PerformanceMonitor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import { useWorld } from "../store.ts";

type Quality = "high" | "low";

/**
 * Resolution (#327): sharp is the rule. Resolution is never the lever for frame rate on a desktop, because a picture
 * that goes soft and sharp again while you watch is worse than a few frames (Nikita, 2026-10-23: "sometimes blurry,
 * then something happens and they're clear"). Frame time is won back elsewhere (still furniture, detail levels).
 *
 * - **Desktop** (a fine pointer, more than four cores): the canvas draws at the screen's own pixel ratio, up to 2,
 *   and stays there. No monitor runs.
 * - **Phones and low-power machines**: they start at the same sharp ratio, capped at 2. drei's PerformanceMonitor
 *   watches the frame rate (it averages quarter seconds and decides every 2.5 s: down when most sit below 50 fps, up
 *   when most are back near full speed, a gap that stops it flickering), but what it decides is only *held*: it
 *   lands when the view changes (a new room in focus, or back to the overview), one step at a time, never in the
 *   middle of a look. Each step is a quarter of the way to a ratio of 1.
 * - `?quality=low` caps the ratio at 1.25, as before.
 */

const FLOOR = 1;
const STEPS = 4;

/** A phone, a tablet or a low-power machine: the only places resolution may ever step down. */
export function lowPower(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const cores = navigator.hardwareConcurrency || 8;
  return coarse || cores <= 4;
}

/** The sharp pixel ratio for a quality setting on this screen: the screen's own, up to 2 (1.25 on low). */
export function maxDpr(quality: Quality): number {
  const device = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(device, quality === "high" ? 2 : 1.25);
}

/** The ratio last settled on (phones only), so a re-render of the Canvas keeps it instead of snapping back. */
let current: number | null = null;

/** What the Canvas's `dpr` prop should be: the sharp ratio, or on a phone the one it last settled on. */
export function canvasDpr(quality: Quality): number {
  const max = maxDpr(quality);
  return current === null ? max : Math.min(Math.max(current, Math.min(FLOOR, max)), max);
}

/**
 * [lower, upper] fps bounds: step down below the first, up above the second. The monitor's "refresh rate" is the
 * fastest it has seen, not the screen's, so the 50 fps line stays fixed (a slow machine would otherwise lower its own
 * bar and never step down); only the upper bound follows it, so a screen that tops out under 60 can still step up.
 */
const LOWER = 50;
const UPPER = 57;
export const bounds = (refresh: number): [number, number] => [LOWER, Math.max(LOWER + 5, Math.min(UPPER, refresh * 0.95))];

/** One step from `now` toward `wanted`, on the quarter-step grid between `floor` and `max`. */
export function stepToward(now: number, wanted: number, floor: number, max: number): number {
  const step = (max - floor) / STEPS;
  if (step <= 0 || Math.abs(wanted - now) < step / 2) return now;
  const next = wanted < now ? now - step : now + step;
  return Math.round(Math.min(max, Math.max(floor, next)) * 100) / 100;
}

export function AdaptiveResolution({ quality }: { quality: Quality }) {
  const setDpr = useThree((s) => s.setDpr);
  const max = maxDpr(quality);
  const floor = Math.min(FLOOR, max);
  const adaptive = lowPower() && max > floor;
  /** What the monitor would like, held until the view changes. */
  const wanted = useRef(max);

  const onChange = useCallback(
    ({ factor }: { factor: number }) => {
      wanted.current = Math.round((floor + (max - floor) * factor) * 100) / 100;
    },
    [floor, max],
  );

  // A new range (quality switched) starts again from full sharpness.
  useEffect(() => {
    current = null;
    wanted.current = max;
    setDpr(max);
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.dpr = () => ({ current: current ?? max, floor: adaptive ? floor : max, max, adaptive });
  }, [floor, max, adaptive, setDpr]);

  // Phones only: a held step lands when the view changes, one step per change.
  useEffect(() => {
    if (!adaptive) return;
    return useWorld.subscribe((s, prev) => {
      if (s.focus === prev.focus) return;
      const now = current ?? max;
      const next = stepToward(now, wanted.current, floor, max);
      if (next === now) return;
      current = next;
      setDpr(next);
    });
  }, [adaptive, floor, max, setDpr]);

  if (!adaptive) return null;
  // Keyed on the range so a quality change starts again from full sharpness.
  return <PerformanceMonitor key={`${floor}-${max}`} factor={1} step={1 / STEPS} bounds={bounds} onChange={onChange} />;
}
