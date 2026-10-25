import { useEffect, useMemo, useRef } from "react";
import { clamp, RC, useViz, WHITE, type VizSpec } from "./wvCanvas.ts";

/**
 * The sky behind every Desk page (the approved Weave, 81-sky-fx.js): a fine dust drifting on a slow flow field, mostly
 * white with a few motes in the rooms' colours, parting around the pointer. One small canvas, drawn by the Desk's one
 * shared loop (wvCanvas.ts) in the same frames as the page's own canvases, so the two never ask the browser for frames
 * of their own (#417); it stops when the tab is hidden and holds one still frame with reduced motion.
 *
 * Performance (#417, Nikita: "still kind of laggy"): the motes are filled in runs of one colour and one alpha (the
 * alpha in 48 steps, finer than the eye can tell on dust this faint), so a frame sets the canvas's colour and alpha a
 * few dozen times instead of twice per mote, and the canvas batches each run.
 */

const ROOMS = Object.keys(RC);
/** The dust's colours: white first, then each room's. */
const COLS = [WHITE, ...ROOMS.map((r) => RC[r]!)];
const FILLS = COLS.map((c) => `rgb(${c})`);
/** Alpha steps for the runs. */
const LV = 48;
/**
 * The most backing pixels the dust draws into (#417). It is faint motes a pixel or two across over the whole window:
 * on a laptop's Retina screen it draws at about the window's own size and lets the browser scale it up, about a third of the pixels
 * to clear and lay down every frame, and the dust looks the same.
 */
const BACKING_PX = 1_600_000;

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  amb: number;
  s: number;
  sz: number;
  col: number;
}

function skySpec(mouse: { x: number; y: number }): VizSpec {
  let W = 0;
  let H = 0;
  const P: Mote[] = [];
  // The runs, rebuilt each frame: how many motes per colour and alpha step, and the motes in that order.
  const count = new Int32Array(COLS.length * (LV + 1));
  const at = new Int32Array(COLS.length * (LV + 1));
  let order = new Int32Array(0);
  let lv = new Int32Array(0);
  const mk = (): Mote => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: 0,
    vy: 0,
    a: 0,
    amb: 0.04 + Math.random() * 0.14,
    s: Math.random(),
    sz: Math.random() < 0.12 ? 1.7 : 1.1,
    col: Math.random() < 0.8 ? 0 : 1 + ((Math.random() * ROOMS.length) | 0),
  });
  const ang = (x: number, y: number, t: number) => Math.sin(x * 0.0043 + t * 0.24) * 2.1 + Math.cos(y * 0.0051 - t * 0.18) * 2.1 + Math.sin((x + y) * 0.002 + t * 0.1) * 1.4;
  const step = (t: number, dt: number) => {
    const f = dt * 60;
    const R = 90;
    const R2 = R * R;
    for (const p of P) {
      const a = ang(p.x, p.y, t);
      p.vx = p.vx * 0.965 + Math.cos(a) * 0.018 * f;
      p.vy = p.vy * 0.965 + Math.sin(a) * 0.018 * f;
      const ex = p.x - mouse.x;
      const ey = p.y - mouse.y;
      const e2 = ex * ex + ey * ey;
      let ta = p.amb;
      if (e2 < R2) {
        const ed = Math.sqrt(e2) + 0.01;
        let k = 1 - ed / R;
        k = k * k * 1.4 * f;
        p.vx += (ex / ed) * k;
        p.vy += (ey / ed) * k;
        ta = Math.min(0.55, ta + 0.22);
      }
      p.x += p.vx * f;
      p.y += p.vy * f;
      if (p.x < -10) p.x = W + 10;
      else if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      else if (p.y > H + 10) p.y = -10;
      p.a += (ta - p.a) * Math.min(1, 0.04 * f);
    }
  };
  return {
    blend: "source-over",
    scale: (w, h, dpr) => Math.min(dpr, Math.max(1, Math.sqrt(BACKING_PX / Math.max(1, w * h)))),
    lay(V) {
      if (V.W === W && V.H === H) return;
      const ow = W;
      const oh = H;
      W = V.W;
      H = V.H;
      const n = Math.round(clamp((W * H) / 2000, 180, 560));
      while (P.length < n) P.push(mk());
      if (P.length > n) P.length = n;
      if (ow && oh)
        for (const p of P) {
          p.x *= W / ow;
          p.y *= H / oh;
        }
      else for (const p of P) p.a = p.amb;
      order = new Int32Array(n);
      lv = new Int32Array(n);
    },
    draw(_V, c, t, dt) {
      if (dt) step(t, dt);
      count.fill(0);
      const n = P.length;
      for (let i = 0; i < n; i++) {
        const q = P[i]!;
        const l = q.a < 0.01 ? -1 : Math.round(q.a * (0.75 + 0.25 * Math.sin(t * 3 + q.s * 60)) * LV);
        lv[i] = l;
        if (l > 0) count[q.col * (LV + 1) + Math.min(LV, l)]!++;
      }
      let o = 0;
      for (let k = 0; k < count.length; k++) {
        at[k] = o;
        o += count[k]!;
      }
      for (let i = 0; i < n; i++) {
        const l = lv[i]!;
        if (l > 0) order[at[P[i]!.col * (LV + 1) + Math.min(LV, l)]!++] = i;
      }
      let i = 0;
      for (let k = 0; k < count.length; k++) {
        const m = count[k]!;
        if (!m) continue;
        c.fillStyle = FILLS[(k / (LV + 1)) | 0]!;
        c.globalAlpha = (k % (LV + 1)) / LV;
        for (const end = i + m; i < end; i++) {
          const q = P[order[i]!]!;
          c.fillRect(q.x - q.sz / 2, q.y - q.sz / 2, q.sz, q.sz);
        }
      }
      c.globalAlpha = 1;
    },
  };
}

export function DeskSky() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -1e4, y: -1e4 }).current;
  const spec = useMemo(() => skySpec(mouse), [mouse]);
  useViz(ref, spec);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => (mouse.x = mouse.y = -1e4);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [mouse]);
  return <canvas ref={ref} className="desk__dust" aria-hidden="true" />;
}
