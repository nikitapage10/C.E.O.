import { edgeFactor } from "@ceo/engine/web/wasdPan.ts";

/**
 * The Senate's camera never has a podium in its face (#925). Nikita, 2026-11-06: sometimes a podium drifts in front of
 * the camera "and fills half the screen as a dark shape. That should never happen."
 *
 * Three rules keep it so (rotundaScene.ts):
 * - The layout: the gallery's tiers start beyond the furthest the camera ever stands (`GALLERY_R0` over `CAMERA_MAX_R`),
 *   so none is ever between the camera and the floor, and its figures fade out before they could come near
 *   (`GALLERY_FADE`, in their shaders).
 * - The keys: A/D turn the camera within `YAW_ARC` either side of its own view and W/S move it within `ZOOM`, both
 *   with a soft edge (`softStep`), so it never swings round to face a member's podium from close by.
 * - The keep-out: a member's podium that comes into a capsule round the camera and the first stretch of its view shrinks
 *   away smoothly before it could loom (`keepOutScale`), whatever path it is on, and comes back as it leaves.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The keep-out round the camera: this far either side of its line of sight, along the first `reach` of it. */
export const KEEP_OUT = { radius: 2.4, reach: 4 } as const;

/** A/D's arc either side of the session's own view (radians); with the chamber's slow sway it stays clear of the seats. */
export const YAW_ARC = 0.45;
/** W/S's range, as a share of the session's own distance. */
export const ZOOM = { in: 0.86, out: 1.1 } as const;

/** The furthest the camera ever stands from the chamber's centre, on the ground: a tall phone, the room's widest dolly, zoomed out. */
export const CAMERA_MAX_R = 17.5 * 1.04 * ZOOM.out;
/** Where the gallery's first tier stands, well beyond that. */
export const GALLERY_R0 = 23;
/** Gallery figures this close to the camera are faded out entirely (they never are, by the layout: a second guard). */
export const GALLERY_FADE = { from: 14, to: 9 } as const;

/**
 * Moves `v` by `d` within [lo, hi]: freely in the middle, resisted toward either end (the wasdPan rubber band), stopped
 * at the end. A step back toward the middle always goes through.
 */
export function softStep(v: number, d: number, lo: number, hi: number): number {
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  if (!(half > 0)) return mid;
  const u = (v - mid) / half;
  const out = d !== 0 && (u === 0 || Math.sign(d) === Math.sign(u));
  const n = v + (out ? d * edgeFactor(Math.min(1, Math.abs(u))) : d);
  return Math.max(lo, Math.min(hi, n));
}

/** How far `p` is from the keep-out's axis: the segment from the camera `cam` along its unit view `dir` for `reach`. */
export function fromSight(p: V3, cam: V3, dir: V3, reach: number = KEEP_OUT.reach): number {
  const vx = p.x - cam.x;
  const vy = p.y - cam.y;
  const vz = p.z - cam.z;
  const t = Math.max(0, Math.min(reach, vx * dir.x + vy * dir.y + vz * dir.z));
  return Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
}

/**
 * The size a podium is drawn at so it never fills the camera's view: whole outside the keep-out (a capsule of `radius`
 * round the first `reach` of the line of sight, the camera itself included), shrinking smoothly to nothing by half way
 * in. Shrinking, not pushing: a podium whose path crosses the line of sight can't be pushed round it without a jump
 * from one side to the other, but it can vanish and come back, smoothly, the far side of it.
 */
export function keepOutScale(p: V3, cam: V3, dir: V3, keep: { radius: number; reach: number } = KEEP_OUT): number {
  const d = fromSight(p, cam, dir, keep.reach);
  const lo = keep.radius * 0.5;
  if (d >= keep.radius) return 1;
  if (d <= lo) return 0;
  const u = (d - lo) / (keep.radius - lo);
  return u * u * (3 - 2 * u);
}
