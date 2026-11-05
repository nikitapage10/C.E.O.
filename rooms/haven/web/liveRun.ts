import { useEffect, useState } from "react";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";

/**
 * The vacuum's live run on the Hall's map (#814, the B2 Live run concept Nikita picked). While the vacuum is out and
 * the Hall is open, the page asks GET /api/haven/devices/map every few seconds (passkey session only: it is the home's
 * floor plan), and stops the moment the run ends or the page closes. The answer is checked here field by field; the
 * drawing is LiveRun.tsx. Pure helpers are tested in liveRun.test.ts.
 */

export interface LiveRoom {
  segment: number;
  name: string;
  runs: number[];
  cx: number;
  cy: number;
  order: number | null;
  pct: number | null;
  state: "done" | "now" | "next" | "off";
}

export interface LiveMap {
  w: number;
  h: number;
  rooms: LiveRoom[];
  walls: number[];
  path: number[];
  robot: { x: number; y: number; a: number | null } | null;
  charger: { x: number; y: number } | null;
}

/** What the map read says: the run's map, or why there is none (not cleaning, or the map couldn't be read). */
export type LiveRead = { kind: "map"; map: LiveMap } | { kind: "idle" } | { kind: "unavailable" } | { kind: "off" };

/** How often the Hall asks while the vacuum is out. */
export const LIVE_POLL_MS = 4000;

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fin = (v: unknown, lo = -1e5, hi = 1e5): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const nums = (v: unknown, max: number): number[] => (Array.isArray(v) ? v.slice(0, max).filter((n): n is number => fin(n)) : []);
const STATES = ["done", "now", "next", "off"] as const;

/** The map read's answer, checked; anything off-shape is dropped. */
export function readLive(v: unknown): LiveRead {
  const b = o(v);
  if (b.state === "idle") return { kind: "idle" };
  const m = o(b.map);
  if (!fin(m.w, 1, 4096) || !fin(m.h, 1, 4096) || !Array.isArray(m.rooms)) return { kind: "unavailable" };
  const rooms: LiveRoom[] = m.rooms
    .slice(0, 40)
    .map(o)
    .filter((r) => fin(r.segment, 1, 255) && fin(r.cx) && fin(r.cy))
    .map((r) => ({
      segment: r.segment as number,
      name: typeof r.name === "string" ? r.name.slice(0, 40) : `Room ${r.segment as number}`,
      runs: nums(r.runs, 30_000),
      cx: r.cx as number,
      cy: r.cy as number,
      order: fin(r.order, 1, 40) ? r.order : null,
      pct: fin(r.pct, 0, 100) ? Math.round(r.pct) : null,
      state: STATES.includes(r.state as LiveRoom["state"]) ? (r.state as LiveRoom["state"]) : "off",
    }));
  const robot = o(m.robot);
  const charger = o(m.charger);
  return {
    kind: "map",
    map: {
      w: m.w,
      h: m.h,
      rooms,
      walls: nums(m.walls, 60_000),
      path: nums(m.path, 6_000),
      robot: fin(robot.x) && fin(robot.y) ? { x: robot.x, y: robot.y, a: fin(robot.a, -360, 360) ? robot.a : null } : null,
      charger: fin(charger.x) && fin(charger.y) ? { x: charger.x, y: charger.y } : null,
    },
  };
}

/** Runs (y, x, length, …) as one SVG path, `cell` tall. */
export function runsPath(runs: number[], cell = 2): string {
  let d = "";
  for (let i = 0; i + 2 < runs.length; i += 3) d += `M${runs[i + 1]} ${runs[i]}h${runs[i + 2]}v${cell}h${-runs[i + 2]!}z`;
  return d;
}

/** Flat x, y, … as points. */
export function pointsOf(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/** A polyline's length. */
function lengthOf(pts: [number, number][]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return n;
}

/**
 * Where the robot is drawn `t` (0–1) of the way from the last reading to this one: it rides the new stretch of path
 * (the points this reading added), so the cleaned band never runs ahead of it. Returns the path to draw up to it, the
 * point and the heading (degrees, SVG's: 0 is +x, clockwise).
 */
export function ride(prev: [number, number][], next: [number, number][], robot: { x: number; y: number; a: number | null } | null, t: number): { path: [number, number][]; at: [number, number] | null; heading: number | null } {
  const e = t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const end: [number, number] | null = robot ? [robot.x, robot.y] : next.length ? next[next.length - 1]! : null;
  // The new stretch: the points after what was drawn before (a run that restarted draws from the beginning).
  const kept = prev.length && prev.length <= next.length && next[0]![0] === prev[0]![0] && next[0]![1] === prev[0]![1] ? prev.length - 1 : 0;
  const base = next.slice(0, kept + 1);
  const tail: [number, number][] = [...next.slice(kept)];
  if (end && (!tail.length || tail[tail.length - 1]![0] !== end[0] || tail[tail.length - 1]![1] !== end[1])) tail.push(end);
  const fromA = robot?.a ?? null;
  const svgHeading = fromA !== null ? -fromA : null;
  if (tail.length < 2) return { path: next, at: end, heading: svgHeading };
  const total = lengthOf(tail);
  let want = total * e;
  const drawn: [number, number][] = [...base.slice(0, -1), tail[0]!];
  for (let i = 1; i < tail.length; i++) {
    const a = tail[i - 1]!, b = tail[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want <= seg || i === tail.length - 1) {
      const f = seg ? Math.min(1, want / seg) : 1;
      const at: [number, number] = [+(a[0] + (b[0] - a[0]) * f).toFixed(2), +(a[1] + (b[1] - a[1]) * f).toFixed(2)];
      drawn.push(at);
      const along = seg ? (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI : null;
      return { path: drawn, at, heading: e >= 1 && svgHeading !== null ? svgHeading : (along ?? svgHeading) };
    }
    want -= seg;
    drawn.push(b);
  }
  return { path: next, at: end, heading: svgHeading };
}

/**
 * Reads the live map every LIVE_POLL_MS while `on` (the vacuum is out, the Hall is open and the tab is showing), and
 * stops as soon as it isn't. Each request waits for the last, so a slow answer never stacks them.
 */
export function useLiveMap(device: string | null, on: boolean): LiveRead | null {
  const [read, setRead] = useState<LiveRead | null>(null);
  useEffect(() => {
    if (!on || !device) {
      setRead(null);
      return;
    }
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/haven/devices/map?device=${encodeURIComponent(device)}`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
          if (res.status === 401) useDeskAuth.getState().lost();
          const got: LiveRead = res.status === 404 || res.status === 405 || !(res.headers.get("content-type") ?? "").includes("json") ? { kind: "off" } : res.ok ? readLive(await res.json()) : { kind: "unavailable" };
          if (stop) return;
          setRead(got);
          if (got.kind === "idle" || got.kind === "off") return;
        } catch {
          if (!stop) setRead({ kind: "unavailable" });
        }
      }
      if (!stop) timer = window.setTimeout(() => void tick(), LIVE_POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [device, on]);
  return read;
}
