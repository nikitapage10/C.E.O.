import { useEffect, useRef } from "react";
import { clamp, RC, reducedMotion, WHITE } from "./wvCanvas.ts";

/**
 * The sky behind every Desk page (the approved Weave, 81-sky-fx.js): a fine dust drifting on a slow flow field, mostly
 * white with a few motes in the rooms' colours, parting around the pointer. One small canvas on its own loop at about
 * 30 frames a second; it stops when the tab is hidden and holds one still frame with reduced motion.
 */

const ROOMS = Object.keys(RC);

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  amb: number;
  s: number;
  sz: number;
  col: string;
}

export function DeskSky() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let W = 0;
    let H = 0;
    let DPR = 1;
    const P: Mote[] = [];
    const mouse = { x: -1e4, y: -1e4 };
    const mk = (): Mote => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: 0,
      vy: 0,
      a: 0,
      amb: 0.04 + Math.random() * 0.14,
      s: Math.random(),
      sz: Math.random() < 0.12 ? 1.7 : 1.1,
      col: Math.random() < 0.8 ? WHITE : RC[ROOMS[(Math.random() * ROOMS.length) | 0]!]!,
    });
    const size = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === W && h === H && dpr === DPR) return;
      const ow = W;
      const oh = H;
      W = w;
      H = h;
      DPR = dpr;
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      const n = Math.round(clamp((W * H) / 2000, 180, 560));
      while (P.length < n) P.push(mk());
      if (P.length > n) P.length = n;
      if (ow && oh)
        for (const p of P) {
          p.x *= W / ow;
          p.y *= H / oh;
        }
      else for (const p of P) p.a = p.amb;
    };
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
    const draw = (t: number) => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const q of P) {
        if (q.a < 0.01) continue;
        ctx.globalAlpha = q.a * (0.75 + 0.25 * Math.sin(t * 3 + q.s * 60));
        ctx.fillStyle = `rgb(${q.col})`;
        ctx.fillRect(q.x - q.sz / 2, q.y - q.sz / 2, q.sz, q.sz);
      }
      ctx.globalAlpha = 1;
    };
    size();
    let raf = 0;
    let last = performance.now();
    let T = Math.random() * 100;
    const still = reducedMotion();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      T += dt;
      step(T, dt);
      draw(T);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (still) {
        draw(T);
        return;
      }
      if (document.visibilityState === "visible") {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => (mouse.x = mouse.y = -1e4);
    const onResize = () => {
      size();
      if (still) draw(T);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  return <canvas ref={ref} className="desk__dust" aria-hidden="true" />;
}
