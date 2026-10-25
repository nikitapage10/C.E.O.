import type { FlowLine, Pt } from "../flow/index.ts";
import type { SecurityFeed } from "./feed.ts";
import type { RiskStatus } from "./model.ts";

/**
 * Security and Compliance as particle lines (#445): every check one line, read by its state alone. Pure, so it is unit
 * tested (checks.test.ts); the pages (SecurityPage, CompliancePage) and the rack that draws them (Checks.tsx) only
 * hand states in.
 *
 *   pass  the check passes, the control is in place: the line flows steady and full.
 *   part  it passes with something still known or planned (an expected-fail eval, open alerts, more planned): it flows
 *         but thins out past its middle.
 *   wait  not reported yet, waiting on GitHub, built but not live: the kit's dashed waiting bed, a few slow motes.
 *   fail  failing, open: the line runs only so far and stops dead at a red knot; past it, a bare bed.
 *   off   not applicable here: a faint dashed bed and nothing on it.
 */

export type CheckState = "pass" | "part" | "wait" | "fail" | "off";

/** Where a failing line stops, 0..1 along it. */
export const KNOT_U = 0.62;

export const STATE_WORD: Record<CheckState, string> = { pass: "Passing", part: "Passing, with gaps", wait: "Waiting", fail: "Failing", off: "Not applicable" };

/** A scan's last run, as a check. */
export function scanState(feed: SecurityFeed | null, w: SecurityFeed["workflows"][number] | undefined): CheckState {
  if (!feed || !w) return "wait";
  return w.state === "pass" ? "pass" : w.state === "fail" ? "fail" : w.state === "other" ? "part" : "wait";
}

/** An OWASP risk's status, as a check: covered flows, more planned thins, open stops at a knot, accepted waits. */
export const RISK_CHECK: Record<RiskStatus, CheckState> = { covered: "pass", tracked: "part", open: "fail", accepted: "wait", "not-applicable": "off" };

/** An alert count: none open flows, some open thins (they're being worked on), unreported waits. */
export function alertState(c: SecurityFeed["alerts"]["codeScanning"] | undefined, feed: SecurityFeed | null): CheckState {
  if (!feed || !c) return "wait";
  return c.open ? "part" : "pass";
}

/** A repo switch: on flows, off stops at a knot, unreported waits. */
export const switchState = (s: SecurityFeed["features"][number]["state"] | undefined): CheckState => (s === "on" ? "pass" : s === "off" ? "fail" : "wait");

/** The Scorecard's overall score: 4 and up passes (as the Boiler Room's posture reads it), below fails. */
export const scoreState = (card: SecurityFeed["scorecard"] | undefined): CheckState => (!card ? "wait" : card.score >= 4 ? "pass" : "fail");

export interface Look {
  density: number;
  rate: number;
  bright: number;
  bed: number;
  waiting?: boolean;
  thin?: { at: number; keep: number };
  red?: boolean;
}

/**
 * How a state looks as a line. `fill` (0..1) scales a passing line's density by a real share (a score of 10). The
 * lines here run long, so they carry fewer particles a pixel than the pipes' short stretches: the page stays light.
 */
export function lookOf(s: CheckState, fill = 1): Look {
  if (s === "pass") return { density: 0.2 + 0.4 * fill, rate: 38, bright: 1, bed: 0.24 };
  if (s === "part") return { density: 0.5, rate: 24, bright: 0.9, bed: 0.16, thin: { at: 0.45, keep: 0.3 } };
  if (s === "fail") return { density: 0.5, rate: 16, bright: 1, bed: 0.24, red: true };
  if (s === "off") return { density: 0, rate: 0, bright: 0.2, bed: 0.035, waiting: true };
  return { density: 0, rate: 0, bright: 0.5, bed: 0.06, waiting: true };
}

/** The first `u` (0..1) of a sampled path, by arc length. */
export function cut(xs: readonly number[], ys: readonly number[], u: number): { xs: number[]; ys: number[] } {
  const n = xs.length;
  if (n < 2 || u >= 1) return { xs: [...xs], ys: [...ys] };
  const seg: number[] = [0];
  for (let i = 1; i < n; i++) seg.push(seg[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
  const want = seg[n - 1]! * Math.max(0, u);
  const ox: number[] = [xs[0]!];
  const oy: number[] = [ys[0]!];
  for (let i = 1; i < n; i++) {
    if (seg[i]! >= want) {
      const f = (want - seg[i - 1]!) / Math.max(1e-6, seg[i]! - seg[i - 1]!);
      ox.push(xs[i - 1]! + (xs[i]! - xs[i - 1]!) * f);
      oy.push(ys[i - 1]! + (ys[i]! - ys[i - 1]!) * f);
      break;
    }
    ox.push(xs[i]!);
    oy.push(ys[i]!);
  }
  return { xs: ox, ys: oy };
}

/** A line from a to b, straight, or easing into b (a bundle converging on its figure). As samples, every 6 px. */
export function route(a: Pt, b: Pt, ease: boolean): { xs: number[]; ys: number[] } {
  const n = Math.max(8, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6) + 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (!ease) {
      xs.push(a[0] + (b[0] - a[0]) * t);
      ys.push(a[1] + (b[1] - a[1]) * t);
      continue;
    }
    // A cubic that leaves level and arrives level: the strands run straight first, then gather.
    const dx = b[0] - a[0];
    const p1x = a[0] + dx * 0.45;
    const p2x = a[0] + dx * 0.7;
    const m = 1 - t;
    xs.push(m * m * m * a[0] + 3 * m * m * t * p1x + 3 * m * t * t * p2x + t * t * t * b[0]);
    ys.push(m * m * m * a[1] + 3 * m * m * t * a[1] + 3 * m * t * t * b[1] + t * t * t * b[1]);
  }
  return { xs, ys };
}

/**
 * The lines one check becomes: its run, and for a failing one the bare bed past its knot (no particles) and a red
 * knot where it stopped. `id` is the check's own; the dead stretch is `id~`.
 */
export function checkLines(id: string, s: CheckState, path: { xs: number[]; ys: number[] }, o: { rgb: string; bad: string; fill?: number; dim?: boolean; phone?: boolean }): FlowLine[] {
  const look = lookOf(s, o.fill);
  const bright = look.bright * (o.dim ? 0.35 : 1);
  const spread = o.phone ? 1.5 : 2.4;
  if (s !== "fail") return [{ id, path, rgb: o.rgb, density: look.density, rate: look.rate, bright, bed: look.bed, waiting: look.waiting, thin: look.thin, spread }];
  const run = cut(path.xs, path.ys, KNOT_U);
  const restStart = run.xs.length - 1;
  const full = cut(path.xs, path.ys, 1);
  const rest = { xs: [run.xs[restStart]!, ...full.xs.filter((_, i) => i >= restStart)], ys: [run.ys[restStart]!, ...full.ys.filter((_, i) => i >= restStart)] };
  return [
    { id, path: run, rgb: o.bad, density: look.density, rate: look.rate, bright, bed: look.bed, knots: [1], spread },
    { id: `${id}~`, path: rest, rgb: o.bad, density: 0, rate: 0, bright: 0, bed: 0.06, waiting: true, spread },
  ];
}

/**
 * What changed between two readings, for the live moments (a packet when a check comes good, a red spray when it
 * fails). A check that was only waiting to be read (the feed arriving) is not a change.
 */
export function changesOf(prev: Map<string, CheckState>, next: Map<string, CheckState>): { id: string; from: CheckState; to: CheckState }[] {
  const out: { id: string; from: CheckState; to: CheckState }[] = [];
  for (const [id, to] of next) {
    const from = prev.get(id);
    if (from !== undefined && from !== "wait" && from !== to) out.push({ id, from, to });
  }
  return out;
}
