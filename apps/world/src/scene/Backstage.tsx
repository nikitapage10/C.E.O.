import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import { bootMarks, useBoot } from "../boot.ts";
import { sendTiming, type TripKind } from "../bootBeacon.ts";
import { trips } from "../latticeWarm.ts";

/**
 * The Lattice behind the Desk (#373).
 *
 * Warmed before its first visit (latticeWarm.ts), the canvas doesn't draw on its own (Scene.tsx: the frame loop runs
 * only on screen), but a frame now and then, out of sight, does what the first frames on screen would otherwise
 * stop for: textures go up to the graphics card, the shadow and post passes get their programs, and the still
 * furniture (StillFurniture.tsx), which watches props settle over a few seconds, bakes each room's pieces. One frame
 * every GAP_MS (or ten times as long as the last one took, so the Desk keeps nine tenths of the page's time on a slow
 * machine) while the browser is idle, until the world has finished streaming in and settled (SETTLE_MS more), at most
 * MAX_FRAMES. Once the Lattice has been on screen it never draws hidden again.
 */
const GAP_MS = 600;
const SETTLE_MS = 8000;
const MAX_FRAMES = 120;

type Idle = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

export function Backstage() {
  const active = useBoot((s) => s.active);
  const visited = useBoot((s) => s.visited);
  const drawing = useBoot((s) => s.drawing);
  const get = useThree((s) => s.get);

  // Back on screen after a while away: the clock forgets the pause, so nothing that moves with time jumps.
  useLayoutEffect(() => {
    if (active) get().clock.oldTime = performance.now();
  }, [active, get]);

  useEffect(() => {
    if (active || visited || !drawing) return;
    const w = window as Idle;
    let frames = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      const state = get();
      // A frame at a time, in seconds, the way the frame loop keeps its clock when it's off ("never").
      const t0 = performance.now();
      state.advance(state.clock.elapsedTime + 1 / 60);
      const took = performance.now() - t0;
      frames += 1;
      const settled = bootMarks.models !== undefined && performance.now() - bootMarks.models > SETTLE_MS;
      if (frames < MAX_FRAMES && !settled) timer = setTimeout(next, Math.max(GAP_MS, took * 10));
    };
    const next = () => {
      if (stopped) return;
      if (w.requestIdleCallback) idle = w.requestIdleCallback(step, { timeout: 2000 });
      else step();
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (idle !== undefined) w.cancelIdleCallback?.(idle);
    };
  }, [active, visited, drawing, get]);

  return null;
}

/** A renderer count, or 0 when it isn't one (a mesh with no real place yet can make the triangle count NaN). */
const count = (n: number) => (Number.isFinite(n) ? n : 0);

/** How long the frame-rate window runs after each arrival. */
const FPS_MS = 5000;

/**
 * Times each arrival in the Lattice for the boot-timing beacon (bootBeacon.ts): from the click (latticeWarm.ts,
 * trips) to the first frame drawn on screen and to the curtain lifting, then the frame rate and the slowest frame
 * over the next FPS_MS, and the draw calls and shader programs of the last frame. Timings and counts only.
 */
export function TripTimer() {
  const active = useBoot((s) => s.active);
  const gl = useThree((s) => s.gl);
  const trip = useRef<{ kind: TripKind; asked: number; first?: number; start?: number; frames: number; last: number; worst: number } | null>(null);

  useEffect(() => {
    if (!active) {
      trip.current = null;
      return;
    }
    const kind: TripKind = trips.count <= 1 ? (trips.asked === 0 ? "direct" : trips.warmed ? "warmed" : "first") : "return";
    trip.current = { kind, asked: trips.asked, frames: 0, last: 0, worst: 0 };
  }, [active]);

  useFrame(() => {
    const t = trip.current;
    if (!t || !useBoot.getState().active) return;
    const now = performance.now();
    // The canvas only draws once the shader compile is in (boot.ts), so the first frame here is the first one drawn.
    t.first ??= now;
    // The frame rate counts from the curtain lifting (or the first frame, when it lifted out of sight beforehand).
    const curtain = bootMarks.curtain;
    if (curtain === undefined) return;
    if (t.start === undefined) {
      t.start = now;
      t.last = now;
      return;
    }
    t.frames += 1;
    t.worst = Math.max(t.worst, now - t.last);
    t.last = now;
    if (now - t.start < FPS_MS) return;
    trip.current = null;
    const fps = Math.round((t.frames * 1000) / (now - t.start));
    const first = t.first;
    // Read the counts once this frame has been drawn (they're reset as each frame starts, Scene.tsx RenderInfo).
    setTimeout(() => {
      const info = gl.info.render;
      sendTiming({
        kind: t.kind,
        trip: trips.count,
        firstFrame: Math.round(first - t.asked),
        curtain: Math.round(Math.max(curtain, first) - t.asked),
        fps,
        worstFrame: Math.round(t.worst),
        draws: count(info.calls),
        triangles: count(info.triangles),
        programs: count(gl.info.programs?.length ?? 0),
      });
    }, 0);
  });

  return null;
}
