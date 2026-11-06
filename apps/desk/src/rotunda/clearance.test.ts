import { describe, expect, it } from "vitest";
import { CAMERA_MAX_R, GALLERY_FADE, GALLERY_R0, KEEP_OUT, YAW_ARC, ZOOM, fromSight, keepOutScale, softStep } from "./clearance.ts";

/** No podium ever in the Senate camera's face (#925): the keep-out, the keys' soft limits, and the gallery's layout. */

/** The camera at its closest to the floor: the deepest dolly, zoomed in. */
const CAM = { x: 0, y: 4.9, z: 13.2 * 0.92 * 0.86 };
const DIR = (() => {
  const d = { x: 0, y: 2.6 - 4.9, z: 0.8 - 13.2 * 0.92 * 0.86 };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
})();
/** A point `t` along the line of sight, moved `side` across it (on the ground) and `up` straight up. */
const at = (t: number, side: number, up: number) => ({ x: CAM.x + DIR.x * t + side, y: CAM.y + DIR.y * t + up, z: CAM.z + DIR.z * t });

describe("the camera's keep-out (#925)", () => {
  it("leaves a podium out of it whole", () => {
    expect(keepOutScale({ x: -5.4, y: 2.2, z: 4.8 }, CAM, DIR)).toBe(1);
    // The floor's spots, seen from the closest the camera comes.
    for (const p of [
      { x: -2.3, y: 2.4, z: 2.8 },
      { x: 2.4, y: 2.9, z: 2.4 },
      { x: -3, y: 2.7, z: 2 },
      { x: 0, y: 4.7, z: -1.7 },
    ])
      expect(keepOutScale(p, CAM, DIR)).toBe(1);
  });

  it("shrinks one that drifts into the camera's face to nothing", () => {
    for (const p of [at(2, 0.3, 0), at(0, 0, 0), at(-0.5, 0, 0), at(3.5, 0.2, -0.4), at(5, 0, 0.3)]) expect(keepOutScale(p, CAM, DIR)).toBe(0);
  });

  it("shrinks it smoothly, never a jump, as it glides across the view", () => {
    let was: number | null = null;
    for (let i = 0; i <= 400; i++) {
      const s = keepOutScale(at(2.5, -4 + i * 0.02, 0), CAM, DIR);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      if (was !== null) expect(Math.abs(s - was)).toBeLessThan(0.05);
      was = s;
    }
  });

  it("measures from the line of sight, the camera included", () => {
    expect(fromSight(CAM, CAM, DIR)).toBe(0);
    expect(fromSight(at(2, 1, 0), CAM, DIR)).toBeCloseTo(1);
    expect(fromSight(at(-3, 0, 0), CAM, DIR)).toBeCloseTo(3);
    expect(fromSight(at(KEEP_OUT.reach + 2, 0, 0), CAM, DIR)).toBeCloseTo(2);
  });
});

describe("WASD round the Senate (#925)", () => {
  it("turns freely inside the arc, resisted toward its edge, and never past it", () => {
    expect(softStep(0, 0.1, -YAW_ARC, YAW_ARC)).toBeCloseTo(0.1);
    let v = 0;
    for (let i = 0; i < 500; i++) v = softStep(v, 0.05, -YAW_ARC, YAW_ARC);
    expect(v).toBeLessThanOrEqual(YAW_ARC);
    expect(v).toBeGreaterThan(YAW_ARC * 0.8);
    // Near the edge a step outward gets through less than a step back in.
    const out = softStep(v, 0.05, -YAW_ARC, YAW_ARC) - v;
    const back = v - softStep(v, -0.05, -YAW_ARC, YAW_ARC);
    expect(out).toBeLessThan(back);
    expect(back).toBeCloseTo(0.05);
  });

  it("keeps the zoom to its tight range", () => {
    let z = 1;
    for (let i = 0; i < 500; i++) z = softStep(z, -0.05, ZOOM.in, ZOOM.out);
    expect(z).toBeGreaterThanOrEqual(ZOOM.in);
    for (let i = 0; i < 500; i++) z = softStep(z, 0.05, ZOOM.in, ZOOM.out);
    expect(z).toBeLessThanOrEqual(ZOOM.out);
  });
});

describe("the gallery's layout (#925)", () => {
  it("stands beyond the furthest the camera goes, further than its figures' fade", () => {
    expect(GALLERY_R0 - CAMERA_MAX_R).toBeGreaterThan(2);
    expect(GALLERY_FADE.to).toBeLessThan(GALLERY_FADE.from);
  });
});
