import { ROOM_IDS, roomToWorld, streamCurve, type RoomId } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { Vector3, type Camera } from "three";
import { agentPositions } from "../clock.ts";
import { bez, clamp, eOut, knot, Parts, Poly, reducedMotion, spr, sstep, TAU, weave, WHITE } from "../desk/wvCanvas.ts";
import { useOverlay } from "../hud/Hud.tsx";
import { useWorld } from "../store.ts";
import { PULSE_MS, roomRgb, weaveBus } from "./bus.ts";
import { derive, type Derived } from "./live.ts";

/**
 * The Weave in the Lattice (#374), drawn from inside the scene's frame so it sits exactly on the world: projected 3D
 * points, painted on a 2D canvas (WeaveCanvas) with the Desk's own thread and particle helpers (desk/wvCanvas.ts).
 * No meshes, no materials: the GPU's draw calls stay what they were. All of it reads real work only:
 *
 * - a room with real work running (a task a real agent started, TaskRecord.live) carries dots in its colour along its
 *   stream, out from the Kernel; more work, more dots;
 * - an agent working a real task, while you're close enough to see, has a thread of light rising from them with dots
 *   riding up it, and a few motes turning round them;
 * - each new line on the real agents' feed flies as a thread from its room to the Signals panel, and lands as a knot.
 *
 * Nothing draws with reduced motion. H's clean view keeps the world's dots and drops the threads into the HUD; after
 * the overlay's quiet-spell fade the threads dim with it.
 */

const V = new Vector3();
const P2 = { x: 0, y: 0 };

/** World to canvas pixels; false behind the camera. */
function project(cam: Camera, x: number, y: number, z: number, W: number, H: number): boolean {
  V.set(x, y, z).project(cam);
  if (V.z > 1 || V.z < -1) return false;
  P2.x = (V.x + 1) * 0.5 * W;
  P2.y = (1 - V.y) * 0.5 * H;
  return true;
}

/** Each room's stream as world points, Kernel end first (work goes out to the rooms). */
const STREAMS = new Map<RoomId, readonly (readonly number[])[]>(ROOM_IDS.map((r) => [r, streamCurve(r, 20).reverse()]));

interface Flow {
  poly: Poly;
  P: Parts;
  n: number;
}
interface Flight {
  poly: Poly;
  P: Parts;
  landed: boolean;
}

/** What this frame drew covers (so the next clears only that), grown point by point, with room for the glows. */
const BOX = [0, 0, 0, 0];
function grow(x: number, y: number, pad = 18) {
  if (x - pad < BOX[0]!) BOX[0] = x - pad;
  if (y - pad < BOX[1]!) BOX[1] = y - pad;
  if (x + pad > BOX[2]!) BOX[2] = x + pad;
  if (y + pad > BOX[3]!) BOX[3] = y + pad;
}
function growPoly(p: Poly) {
  for (let i = 0; i < p.n; i++) grow(p.x[i]!, p.y[i]!);
}

const MOTES = 10;
/** Samples along a worker's rising thread. */
const TETHER = 8;
const xs: number[] = [];
const ys: number[] = [];

export function WeaveProbe() {
  const still = reducedMotion();
  useEffect(() => {
    if (!still) return;
    const c = weaveBus.canvas;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }, [still]);

  const [S] = useState(() => ({
    flows: new Map<RoomId, Flow>(),
    flights: new Map<string, Flight>(),
    tethers: new Map<string, Flow>(),
    derived: { rooms: [], workers: [] } as Derived,
    seen: null as unknown,
    W: 0,
    H: 0,
    DPR: 1,
    dirty: false,
    last: performance.now(),
    knotRect: null as DOMRect | null,
    knotAt: 0,
    cam: new Float64Array(16),
    box: [0, 0, 0, 0],
  }));

  useFrame(({ camera, clock }) => {
    const cv = weaveBus.canvas;
    weaveBus.frames++;
    if (still || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const now = performance.now();
    // About 30 frames a second, as the Desk's canvases run, except while the camera moves: then every frame, so the
    // dots stay on the world.
    const m = camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++)
      if (m[i] !== S.cam[i]) {
        moved = true;
        S.cam[i] = m[i]!;
      }
    if (!moved && now - S.last < 30) return;
    const dt = Math.min(0.05, (now - S.last) / 1000);
    S.last = now;
    const t = clock.elapsedTime;

    const s = useWorld.getState();
    if (s.lattice !== S.seen) {
      S.seen = s.lattice;
      S.derived = derive(s.lattice);
      for (const id of S.tethers.keys()) if (!S.derived.workers.some((w) => w.id === id)) S.tethers.delete(id);
    }
    const { derived, flows, flights } = S;
    const clean = useOverlay.getState().clean;
    const pulses = weaveBus.pulses;
    while (pulses.length && now - pulses[0]!.born > PULSE_MS) flights.delete(pulses.shift()!.id);
    const threads = !clean && pulses.length > 0;

    if (!derived.rooms.length && !derived.workers.length && !threads) {
      if (S.dirty) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        S.dirty = false;
        S.box = [0, 0, 0, 0];
      }
      return;
    }

    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w !== S.W || h !== S.H || dpr !== S.DPR) {
      S.W = w;
      S.H = h;
      S.DPR = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      S.box = [0, 0, 0, 0];
    }
    const W = w;
    const H = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clear only what the last frame drew (a full clear when the size changed).
    const b = S.box;
    if (b[2]! > b[0]!) ctx.clearRect(b[0]!, b[1]!, b[2]! - b[0]!, b[3]! - b[1]!);
    BOX[0] = BOX[1] = 1e9;
    BOX[2] = BOX[3] = -1e9;
    S.dirty = true;
    weaveBus.drawn++;

    // Real work riding the streams, out from the Kernel to the rooms doing it.
    for (const [room, n] of derived.rooms) {
      const pts = STREAMS.get(room)!;
      xs.length = ys.length = 0;
      let ok = true;
      for (const p of pts) {
        if (!project(camera, p[0]!, p[1]!, p[2]!, W, H)) {
          ok = false;
          break;
        }
        xs.push(P2.x);
        ys.push(P2.y);
      }
      if (!ok) continue;
      const want = 10 + 6 * Math.min(n, 4);
      let f = flows.get(room);
      if (!f || f.n !== want) flows.set(room, (f = { poly: new Poly(), P: new Parts(want, 0.25), n: want }));
      f.poly.set(xs, ys);
      growPoly(f.poly);
      weave(ctx, f.poly, f.P, { a: 1, sp: 1.6, sz: 1.45, v: f.poly.len / 9, rgb: roomRgb(room), rgb2: WHITE, I: (u) => 0.5 + 0.5 * Math.sin(u * Math.PI) }, t, dt);
    }

    // An agent at real work, once close enough to read: a thread of light rising from them toward the stream, dots
    // riding up it, and motes turning round them.
    const sw = spr(WHITE);
    for (const wk of derived.workers) {
      const at = agentPositions.get(wk.id);
      if (!at) continue;
      if (!project(camera, at.x, at.y + 1, at.z, W, H)) continue;
      const ax = P2.x;
      const ay = P2.y;
      if (ax < -60 || ax > W + 60 || ay < -60 || ay > H + 60) continue;
      if (!project(camera, at.x, at.y + 2, at.z, W, H)) continue;
      const pxm = Math.abs(ay - P2.y);
      if (pxm < 22) continue;
      const near = sstep(22, 40, pxm);
      const sc = spr(wk.rgb);
      xs.length = ys.length = 0;
      for (let k = 0; k <= TETHER; k++) {
        const u = k / TETHER;
        const sway = Math.sin(t * 0.7 + wk.seed * TAU + u * 2.2) * 0.12 * u;
        if (!project(camera, at.x + sway, at.y + 1.35 + u * 3.4, at.z + sway * 0.6, W, H)) break;
        xs.push(P2.x);
        ys.push(P2.y);
      }
      if (xs.length > 2) {
        let te = S.tethers.get(wk.id);
        if (!te) S.tethers.set(wk.id, (te = { poly: new Poly(), P: new Parts(10, 0.3), n: 10 }));
        te.poly.set(xs, ys);
        growPoly(te.poly);
        weave(ctx, te.poly, te.P, { a: near, sp: 0.6, sz: clamp(pxm * 0.028, 1, 2), v: te.poly.len / 3.2, rgb: wk.rgb, rgb2: WHITE, line: 0.32 * near, lw: 0.8, I: (u) => 1 - u * 0.8 }, t, dt);
      }
      for (let k = 0; k < MOTES; k++) {
        const ph = wk.seed * TAU + k * 2.399;
        const rise = (t * (0.1 + 0.03 * ((k * 7) % 3)) + k / MOTES + wk.seed) % 1;
        const ang = ph + t * (k % 2 ? 0.35 : -0.28);
        const r = 0.42 + 0.22 * Math.sin(ph * 3 + t * 0.6);
        if (!project(camera, at.x + Math.cos(ang) * r, at.y + 0.25 + rise * 2.1, at.z + Math.sin(ang) * r, W, H)) continue;
        const a = Math.sin(rise * Math.PI) * near;
        if (a < 0.03) continue;
        const sz = clamp(pxm * 0.045, 1.1, 3.2) * (k % 3 ? 1 : 1.35);
        ctx.globalAlpha = a;
        ctx.drawImage(k % 3 ? sw : sc, P2.x - sz, P2.y - sz, sz * 2, sz * 2);
        grow(P2.x, P2.y, 6);
      }
      ctx.globalAlpha = 1;
    }

    // A real signal's thread, from its room to the Signals panel's knot.
    if (threads) {
      const el = weaveBus.knot;
      if (el && now - S.knotAt > 400) {
        S.knotAt = now;
        S.knotRect = el.getBoundingClientRect();
      }
      const kr = el ? S.knotRect : null;
      if (kr && kr.width > 0) {
        const cr = cv.getBoundingClientRect();
        const tx = kr.left + kr.width / 2 - cr.left;
        const ty = kr.top + kr.height / 2 - cr.top;
        const dim = weaveBus.idle ? 0.3 : 1;
        for (const p of pulses) {
          const age = now - p.born;
          const a0 = roomToWorld(p.room, 0, 4, 0);
          let fx = W * 0.5;
          let fy = H + 30;
          if (project(camera, a0[0], a0[1], a0[2], W, H)) {
            fx = clamp(P2.x, -30, W + 30);
            fy = clamp(P2.y, -30, H + 30);
          }
          const dx = tx - fx;
          const dy = ty - fy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 20) continue;
          const lift = Math.min(160, d * 0.28);
          bez(fx, fy, fx + dx * 0.25, fy + dy * 0.25 - lift, tx - dx * 0.25, ty - lift * 0.6, tx, ty, 32, xs, ys);
          xs.length = ys.length = 32;
          let fl = flights.get(p.id);
          if (!fl) flights.set(p.id, (fl = { poly: new Poly(), P: new Parts(22, 0.3), landed: false }));
          fl.poly.set(xs, ys);
          growPoly(fl.poly);
          grow(tx, ty, 24);
          const head = eOut(age / 1100);
          const fade = (1 - sstep(1300, PULSE_MS, age)) * dim;
          if (fade < 0.02) continue;
          const rgb = roomRgb(p.room);
          ctx.globalAlpha = 1;
          weave(ctx, fl.poly, fl.P, { a: 0.9 * fade, sp: 1.2, sz: 1.1, v: fl.poly.len / 1.6, rgb, rgb2: WHITE, line: 0.16 * fade, lw: 0.7, head }, t, dt);
          if (age > 1000) {
            if (!fl.landed) {
              fl.landed = true;
              el?.animate?.([{ transform: "scale(1)" }, { transform: "scale(2.2)", offset: 0.25 }, { transform: "scale(1)" }], { duration: 900, easing: "cubic-bezier(.2,.7,.2,1)" });
            }
            knot(ctx, tx, ty, 0.8, t, rgb, (1 - sstep(1000, PULSE_MS, age)) * dim);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    S.box = BOX[2]! > BOX[0]! ? [Math.max(0, Math.floor(BOX[0]!)), Math.max(0, Math.floor(BOX[1]!)), Math.min(W, Math.ceil(BOX[2]!)), Math.min(H, Math.ceil(BOX[3]!))] : [0, 0, 0, 0];
    weaveBus.ms += (performance.now() - now - weaveBus.ms) * 0.1;
  });
  return null;
}
