/**
 * Where everything sits in the Iris (#666): one pure layout for the three layers that must agree, the nanite eye (a 2D
 * canvas), the Council in 3D (councilScene.ts, an orthographic camera in the same CSS pixels) and the buttons over
 * each member. The ten subminds sit on a ring like a clock face, the first at twelve o'clock and on clockwise; Skippy
 * is the pupil in the middle. Two lids of nanites make the eye around the ring.
 */

export interface Seat {
  id: string;
  /** Centre of the figure, in the stage's CSS pixels. */
  x: number;
  y: number;
  /** Angle on the ring, radians (0 at twelve o'clock, clockwise). */
  a: number;
}

export interface IrisLayout {
  w: number;
  h: number;
  /** The pupil: Skippy's centre. */
  cx: number;
  cy: number;
  /** The ring's radius. */
  r: number;
  /** A member's height and Skippy's, in pixels. */
  member: number;
  skippy: number;
  /** The eye's half-width and half-height (its corners sit at cx ± eyeX). */
  eyeX: number;
  eyeY: number;
  seats: Seat[];
  phone: boolean;
}

/**
 * The layout for a stage `w` by `h`. `reach` is how far left the eye may run past the stage (behind the list on a wide
 * screen); 0 on a phone.
 */
export function irisLayout(w: number, h: number, ids: readonly string[], phone: boolean, reach = 0): IrisLayout {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.max(40, Math.min(w * (phone ? 0.37 : 0.35), h * (phone ? 0.37 : 0.34)));
  const member = r * (phone ? 0.46 : 0.42);
  const skippy = r * 0.9;
  const eyeY = r * 1.3;
  const eyeX = Math.min(w / 2 + reach, r * 2.05);
  const n = ids.length || 1;
  const seats = ids.map((id, i) => {
    const a = (i / n) * Math.PI * 2;
    return { id, a, x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r };
  });
  return { w, h, cx, cy, r, member, skippy, eyeX, eyeY, seats, phone };
}

/** A point on one of the eye's lids at u (0 at the left corner, 1 at the right); `upper` picks the lid. */
export function lidAt(L: IrisLayout, u: number, upper: boolean, out: [number, number] = [0, 0]): [number, number] {
  // A cubic from corner to corner whose middle reaches eyeY: controls at 4/3 of it.
  const x0 = L.cx - L.eyeX;
  const x3 = L.cx + L.eyeX;
  const k = (upper ? -1 : 1) * L.eyeY * (4 / 3);
  const t = u;
  const mt = 1 - t;
  const b1 = 3 * mt * mt * t;
  const b2 = 3 * mt * t * t;
  const xc1 = L.cx - L.eyeX * 0.5;
  const xc2 = L.cx + L.eyeX * 0.5;
  out[0] = mt * mt * mt * x0 + b1 * xc1 + b2 * xc2 + t * t * t * x3;
  out[1] = L.cy + (b1 + b2) * k;
  return out;
}

/** The lid's half-height at x (for keeping the seats inside the eye). */
export function lidHeightAt(L: IrisLayout, x: number): number {
  // Find u for x by bisection (x is monotonic in u).
  let lo = 0;
  let hi = 1;
  const p: [number, number] = [0, 0];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    lidAt(L, mid, true, p);
    if (p[0] < x) lo = mid;
    else hi = mid;
  }
  lidAt(L, (lo + hi) / 2, true, p);
  return L.cy - p[1];
}
