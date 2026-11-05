import type { DeviceReading } from "@ceo/desk/homeDevices.ts";

/**
 * The device plates' geometry (#766, the A1 Plates concept Nikita picked): where each live reading sits on its render.
 * Every render is a square photo, and its overlay shares the photo's 0–100 space, so a reading is drawn on the part of
 * the product it is about: the hopper's window, the fountain's tank, the litter drawer, the vacuum's turret. Pure, so
 * the numbers are tested; DevicePlates.tsx draws them. Nothing here invents a value: a missing reading gives null.
 */

/** The renders, generated concept stand-ins (no logos, not the makers' photos), in public/desk/haven/. */
export type Render = "dry" | "wet" | "wettop" | "fountain" | "litter" | "vacuum" | "vactop";
export const renderUrl = (r: Render): string => `${import.meta.env.BASE_URL}desk/haven/${r}.webp`;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const known = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/* ── Dry feeder: the kibble window on the hopper ── */

/** The hopper's window in render space (x, top, width, bottom). */
export const HOPPER = { x: 41.3, top: 23, w: 5.4, bottom: 59 } as const;

/**
 * What the window shows. Petlibro says only whether food is low (`surplusGrain`), never a percentage, so the window
 * is either clear with a gold "OK" beside it, or shaded down to its last fifth with an ember "Low": a state, not a made-up
 * level. Offline shades the whole window and says so.
 */
export function hopperOf(d: DeviceReading | null): { shadeTo: number; tickY: number; word: string; tone: "ok" | "warn" | "wait" } | null {
  if (!d) return null;
  const { top, bottom } = HOPPER;
  if (!d.online) return { shadeTo: bottom, tickY: (top + bottom) / 2, word: "offline", tone: "wait" };
  if (d.foodLow) {
    const y = bottom - (bottom - top) * 0.18;
    return { shadeTo: y, tickY: y, word: "Low", tone: "warn" };
  }
  return { shadeTo: top, tickY: top + 3, word: "OK", tone: "ok" };
}

/* ── Wet feeder: the tray from above ── */

/** Where each bowl sits on the top-down render, in degrees (0 = right, 90 = the bottom, the front). */
export const BOWL_ANGLE: Record<1 | 2 | 3, number> = { 1: -90, 2: 30, 3: 150 };

/** How far to turn the tray so the bowl in front lands at the bottom; 0 when the front bowl isn't known. */
export function trayTurn(front: number | undefined): number {
  return front === 1 || front === 2 || front === 3 ? 90 - BOWL_ANGLE[front] : 0;
}

/** A bowl's number chip, as a percent of the tray's box, after the turn. */
export function bowlChip(bowl: 1 | 2 | 3, turn: number, r = 21): { left: number; top: number } {
  const a = ((BOWL_ANGLE[bowl] + turn) * Math.PI) / 180;
  return { left: +(50 + Math.cos(a) * r).toFixed(2), top: +(50 + Math.sin(a) * r).toFixed(2) };
}

/** The bowl in front, 1 to 3, or null. */
export const frontBowl = (d: DeviceReading | null): 1 | 2 | 3 | null => (d && (d.plate === 1 || d.plate === 2 || d.plate === 3) ? d.plate : null);

/* ── Fountain: the tank behind the base's face ── */

/** The base's face (the tank's x-ray): x, top, width, bottom. */
export const TANK = { x: 15, top: 47, w: 55, bottom: 77 } as const;

/** The waterline's y for a reading, or null when the fountain didn't say. */
export function waterline(level: number | null | undefined): number | null {
  if (!known(level)) return null;
  return +(TANK.bottom - ((TANK.bottom - TANK.top) * clamp(level)) / 100).toFixed(2);
}

/** Whether the fountain is running, from its state words. */
export const flowing = (d: DeviceReading | null): boolean => !!d && d.online && !/off|stop|pause|dry|empty/i.test(d.state);

/* ── Litter-Robot: the globe and the drawer ── */

export const GLOBE = { cx: 52, cy: 41, r: 29.5 } as const;
export const DRAWER = { x: 25, y: 73.2, w: 26 } as const;

/** Whether the globe is turning: a cycle, or the moment after Clean now. */
export const cycling = (d: DeviceReading | null, flash = false): boolean => flash || (!!d && d.online && /cycl|clean/i.test(d.state));

/** The drawer gauge's width in render units, or null. */
export const drawerWidth = (level: number | null | undefined): number | null => (known(level) ? +((DRAWER.w * clamp(level)) / 100).toFixed(2) : null);

/* ── Vacuum: the dock and the turret ── */

export const TURRET = { cx: 45.6, cy: 56.3, r: 4.6, squash: 0.42 } as const;

/** Where the robot is, from its state words: on the dock charging, out (cleaning, returning), or on the dock idle. */
export function dockOf(d: DeviceReading | null): "charging" | "away" | "docked" | "off" {
  if (!d || !d.online) return "off";
  if (/clean|vacuum|mop|segment|room|zone|spot|return|mapping/i.test(d.state) && !/dock|charg/i.test(d.state)) return "away";
  if (/charg/i.test(d.state) || (d.state === "docked" && known(d.battery) && d.battery < 100)) return "charging";
  return "docked";
}

/** The battery ring's dash offset for a circumference, or null when the battery isn't known. */
export function ringOffset(battery: number | null | undefined, circumference: number): number | null {
  return known(battery) ? +(circumference * (1 - clamp(battery) / 100)).toFixed(3) : null;
}
