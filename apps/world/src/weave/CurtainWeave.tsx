import { useEffect, useRef } from "react";
import { bez, clamp, eOut, Parts, Poly, RC, reducedMotion, TAU, weave, WHITE } from "../desk/wvCanvas.ts";

/**
 * The curtain's Weave (#374): while the Lattice loads, the Desk's dust drifts behind the sigil and threads of light
 * draw in toward it from the dark, one more for each stretch of real progress, with dots riding them inward. One small
 * canvas on its own loop at about 30 frames a second; it stops with the curtain, and reduced motion holds one still frame.
 */

const ROOMS = Object.keys(RC);
const THREADS = 7;

interface Mote {
  x: number;
  y: number;
  a: number;
  s: number;
  sz: number;
  col: string;
}

export function CurtainWeave({ pct }: { pct: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const progress = useRef(pct);
  /** With reduced motion: redraw the one still frame (progress moves, nothing else does). */
  const still = useRef<(() => void) | null>(null);
  useEffect(() => {
    progress.current = pct;
    still.current?.();
  }, [pct]);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let W = 0;
    let H = 0;
    let DPR = 1;
    const motes: Mote[] = [];
    const lines = Array.from({ length: THREADS }, (_, i) => ({
      ang: (i / THREADS) * TAU + 0.35 + Math.random() * 0.4,
      bend: (Math.random() - 0.5) * 0.9,
      rgb: i % 2 ? RC[ROOMS[(i * 3) % ROOMS.length]!]! : WHITE,
      poly: new Poly(),
      P: new Parts(18, 0.2),
      shown: 0,
    }));
    const xs: number[] = [];
    const ys: number[] = [];
    const size = () => {
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === W && h === H && dpr === DPR) return;
      W = w;
      H = h;
      DPR = dpr;
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      const n = Math.round(clamp((W * H) / 5200, 90, 260));
      motes.length = 0;
      for (let i = 0; i < n; i++)
        motes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          a: 0.06 + Math.random() * 0.22,
          s: Math.random(),
          sz: Math.random() < 0.12 ? 1.7 : 1.1,
          col: Math.random() < 0.82 ? WHITE : RC[ROOMS[(Math.random() * ROOMS.length) | 0]!]!,
        });
      // The threads run in from beyond the edges to the sigil's ring (the loader's mark sits a little above centre).
      const cx = W / 2;
      const cy = H / 2 - 70;
      const R = Math.hypot(W, H) * 0.55;
      for (const l of lines) {
        const sx = cx + Math.cos(l.ang) * R;
        const sy = cy + Math.sin(l.ang) * R;
        const ex = cx + Math.cos(l.ang) * 74;
        const ey = cy + Math.sin(l.ang) * 74;
        const nx = -(ey - sy);
        const ny = ex - sx;
        bez(sx, sy, sx + (ex - sx) * 0.35 + nx * l.bend * 0.3, sy + (ey - sy) * 0.35 + ny * l.bend * 0.3, sx + (ex - sx) * 0.75 + nx * l.bend * 0.12, sy + (ey - sy) * 0.75 + ny * l.bend * 0.12, ex, ey, 36, xs, ys);
        l.poly.set(xs, ys);
      }
    };
    const draw = (t: number, dt: number) => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const m of motes) {
        if (dt) {
          m.x += Math.sin(m.y * 0.004 + t * 0.2) * 6 * dt;
          m.y += Math.cos(m.x * 0.004 - t * 0.17) * 6 * dt;
          if (m.x < -4) m.x = W + 4;
          else if (m.x > W + 4) m.x = -4;
          if (m.y < -4) m.y = H + 4;
          else if (m.y > H + 4) m.y = -4;
        }
        ctx.globalAlpha = m.a * (0.75 + 0.25 * Math.sin(t * 2.4 + m.s * 60));
        ctx.fillStyle = `rgb(${m.col})`;
        ctx.fillRect(m.x - m.sz / 2, m.y - m.sz / 2, m.sz, m.sz);
      }
      // The first thread from the start, then one more for each stretch of progress, drawing in from the dark.
      const p = progress.current / 100;
      lines.forEach((l, i) => {
        const want = clamp(p * (THREADS - 1) * 1.15 - i + 1, 0, 1);
        l.shown = dt ? l.shown + (want - l.shown) * Math.min(1, dt * 2.2) : want;
        if (l.shown < 0.01) return;
        weave(ctx, l.poly, l.P, { a: 0.75, sp: 1.4, sz: 1.05, v: l.poly.len / 6, rgb: l.rgb, rgb2: WHITE, line: 0.1, lw: 0.6, head: eOut(l.shown), I: (u) => 0.25 + 0.75 * u }, t, dt);
      });
      ctx.globalAlpha = 1;
    };
    size();
    const reduced = reducedMotion();
    let raf = 0;
    let last = performance.now();
    let T = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      T += dt;
      size();
      draw(T, dt);
    };
    if (reduced) {
      still.current = () => draw(T, 0);
      draw(T, 0);
    } else raf = requestAnimationFrame(frame);
    const onResize = () => {
      size();
      if (reduced) draw(T, 0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      still.current = null;
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={ref} className="lw-curtain" aria-hidden="true" />;
}
