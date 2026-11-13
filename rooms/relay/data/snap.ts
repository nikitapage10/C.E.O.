/**
 * The codex's snapping (#1161, Nikita: "as I initiate the scroll, it kind of bounces into place for the next text or
 * email"). Pure logic, no DOM: the stops a scroll can land on, how many a gesture advances, and the spring that
 * carries the scroll there with a slight overshoot.
 *
 *   stopsOf      every place the codex may rest: each entry's top, plus a few more down an entry taller than the page.
 *   stepFrom     the stop one gesture away (or a few, for a big fling) from a scroll position.
 *   WheelGate    turns a stream of wheel events (mouse notch or trackpad fling with its long inertia tail) into one step.
 *   swipeSteps   the same for a touch swipe.
 *   springAt     the underdamped spring's position at a time, easing out with a small overshoot.
 */

/** The most stops a single gesture may advance. */
export const MAX_STEPS = 3;

/** Where the codex may rest. `tops` are the entries' offsetTops in order; `view` the page's height; `max` the furthest scroll. */
export function stopsOf(tops: readonly number[], view: number, max: number): number[] {
  const out: number[] = [];
  const end = Math.max(0, max);
  for (let i = 0; i < tops.length; i++) {
    const a = Math.min(tops[i]!, end);
    const next = i + 1 < tops.length ? tops[i + 1]! : end + view;
    const last = next - view; // the scroll that puts this entry's foot at the page's foot
    if (out.length === 0 || a > out[out.length - 1]! + 1) out.push(a);
    if (last > a + view * 0.1) {
      // An entry taller than the page: rest down it in steps, ending with its foot in view.
      const stride = view * 0.85;
      for (let y = a + stride; y < last - view * 0.15; y += stride) out.push(y);
      out.push(Math.min(last, end));
    }
  }
  if (out.length === 0) out.push(0);
  return out.filter((v, i) => i === 0 || v > out[i - 1]! + 1);
}

/** The index of the stop nearest a scroll position. */
export function nearestStop(stops: readonly number[], at: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) if (Math.abs(stops[i]! - at) < Math.abs(stops[best]! - at)) best = i;
  return best;
}

/** The stop `steps` away (negative is up) from where the scroll stands, clamped to the first and last. */
export function stepFrom(stops: readonly number[], at: number, steps: number): number {
  const i = nearestStop(stops, at);
  const j = Math.max(0, Math.min(stops.length - 1, i + Math.trunc(steps)));
  return stops[j]!;
}

/** A wheel event's delta in px, whatever unit the browser reports it in. */
export function wheelPx(deltaY: number, deltaMode: number, page: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * page : deltaY;
}

const QUIET_MS = 140; // a gap this long ends a gesture
const MIN_LOCK_MS = 320; // a fresh push can't start a new step sooner than this
const TRIGGER_PX = 24; // how much it takes to begin a step (ignores a graze)
const BIG_PX = 260; // one event this big in a gesture's first push counts as a big fling

/**
 * One gesture, one step. The first push of a burst of wheel events starts a step; the rest of the burst, the long
 * inertia tail of a trackpad fling included, is swallowed. A new gesture starts after a quiet gap, or when the wheel
 * speeds up again after the step has had time to land (the finger pushing again mid-tail).
 */
export class WheelGate {
  private last = -Infinity;
  private lastAbs = 0;
  private lockedAt = -Infinity;
  private locked = false;
  private acc = 0;

  /** Feed one event (px, positive is down). Returns the steps to take: 0 while swallowing, else ±1..MAX_STEPS. */
  feed(now: number, dy: number): number {
    const abs = Math.abs(dy);
    const quiet = now - this.last > QUIET_MS;
    const pushedAgain = this.locked && now - this.lockedAt >= MIN_LOCK_MS && abs > this.lastAbs * 1.6 && abs >= TRIGGER_PX;
    this.last = now;
    this.lastAbs = abs;
    if (quiet || pushedAgain) {
      this.locked = false;
      this.acc = 0;
    }
    if (this.locked || abs === 0) return 0;
    if (this.acc !== 0 && Math.sign(this.acc) !== Math.sign(dy)) this.acc = 0;
    this.acc += dy;
    if (Math.abs(this.acc) < TRIGGER_PX) return 0;
    this.locked = true;
    this.lockedAt = now;
    const big = Math.max(abs, Math.abs(this.acc));
    const n = Math.min(MAX_STEPS, 1 + Math.floor(big / BIG_PX));
    return Math.sign(this.acc) * n;
  }

  /** Whether a gesture is still being swallowed. */
  get busy(): boolean {
    return this.locked;
  }
  reset(): void {
    this.locked = false;
    this.acc = 0;
    this.last = -Infinity;
  }
}

/** Steps for a touch swipe: dy is the finger's travel (negative is up, which goes down the list), ms how long it took. */
export function swipeSteps(dy: number, ms: number, page: number): number {
  const dist = Math.abs(dy);
  const speed = dist / Math.max(1, ms); // px per ms
  if (dist < 36 && speed < 0.35) return 0;
  if (dist < Math.min(60, page * 0.08) && speed < 0.5) return 0;
  const n = speed > 3 ? 3 : speed > 1.8 ? 2 : 1;
  return (dy < 0 ? 1 : -1) * Math.min(MAX_STEPS, n);
}

/** The spring: damping ratio and natural frequency (rad/s). About 4% overshoot, settled in about half a second. */
export const SPRING = { zeta: 0.72, omega: 10.5 } as const;
/** How long the spring takes to settle, ms. */
export const SPRING_MS = 700;

/** The position `t` ms into a spring from `from` to `to` (underdamped, starts at rest). Plain: a straight line, no bounce. */
export function springAt(from: number, to: number, t: number, calm = false): number {
  if (calm || t >= SPRING_MS) return t >= (calm ? 0 : SPRING_MS) ? to : from;
  const { zeta, omega } = SPRING;
  const s = t / 1000;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const k = zeta * omega;
  const e = Math.exp(-k * s);
  const x = 1 - e * (Math.cos(wd * s) + (k / wd) * Math.sin(wd * s));
  return from + (to - from) * x;
}
