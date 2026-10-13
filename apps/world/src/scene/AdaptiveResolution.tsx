import { PerformanceMonitor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect } from "react";

type Quality = "high" | "low";

/**
 * Adaptive resolution: on a sharp screen, the canvas drops its pixel ratio only while the frame rate stays low,
 * and goes back to full sharpness once it recovers.
 *
 * drei's PerformanceMonitor averages the frame rate over quarter seconds and decides every 2.5 s: it steps down
 * when most of those averages sit below 50 fps, and back up only when most are back near full speed (57 fps on a
 * 60 Hz screen). The gap between the two is the hysteresis that stops it flickering. Each step
 * is a quarter of the range, never below a pixel ratio of 1, so a high-DPI screen goes 2 → 1.75 → 1.5 → 1.25 → 1.
 * On a 1x screen there's nothing to drop and it does nothing.
 */

const FLOOR = 1;
const STEPS = 4;

/** Highest pixel ratio for a quality setting on this screen. */
export function maxDpr(quality: Quality): number {
  const device = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(device, quality === "high" ? 2 : 1.25);
}

/** The ratio the monitor last settled on, so a re-render of the Canvas keeps it instead of snapping back. */
let current: number | null = null;

/** What the Canvas's `dpr` prop should be: the adaptive value when there is one, otherwise the full range. */
export function canvasDpr(quality: Quality): number | [number, number] {
  const max = maxDpr(quality);
  return current === null ? [Math.min(FLOOR, max), max] : Math.min(Math.max(current, Math.min(FLOOR, max)), max);
}

/**
 * [lower, upper] fps bounds: step down below the first, up above the second. The monitor's "refresh rate" is the
 * fastest it has seen, not the screen's, so the 50 fps line stays fixed (a slow machine would otherwise lower its own
 * bar and never step down); only the upper bound follows it, so a screen that tops out under 60 can still step up.
 */
const LOWER = 50;
const UPPER = 57;
export const bounds = (refresh: number): [number, number] => [LOWER, Math.max(LOWER + 5, Math.min(UPPER, refresh * 0.95))];

export function AdaptiveResolution({ quality }: { quality: Quality }) {
  const setDpr = useThree((s) => s.setDpr);
  const max = maxDpr(quality);
  const floor = Math.min(FLOOR, max);

  const onChange = useCallback(
    ({ factor }: { factor: number }) => {
      const dpr = Math.round((floor + (max - floor) * factor) * 100) / 100;
      current = dpr;
      setDpr(dpr);
    },
    [floor, max, setDpr],
  );

  // A new range (quality switched) starts again from full sharpness, as the remounted monitor does.
  useEffect(() => {
    current = null;
    setDpr([floor, max]);
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.dpr = () => ({ current, floor, max });
  }, [floor, max, setDpr]);

  // Nothing to trade on a 1x screen (or the low setting on one): skip the monitor altogether.
  if (max <= floor) return null;
  // Keyed on the range so a quality change starts again from full sharpness.
  return <PerformanceMonitor key={`${floor}-${max}`} factor={1} step={1 / STEPS} bounds={bounds} onChange={onChange} />;
}
