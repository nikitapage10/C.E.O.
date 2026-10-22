import { useEffect, useRef } from "react";
import { reducedMotion } from "./motion.tsx";
import type { RoomPulse } from "./roomPulse.ts";

/**
 * Today's hero art: the nine rooms as threads in their colours, drawn across the hero, gathering through one glowing
 * knot (the Lattice) and fanning out to their labels. How heavy and bright a thread is, and how many motes run along
 * it, comes from the room's real activity (roomPulse.ts). On the day's first open the threads draw themselves in
 * (about 1.8 s); later opens settle in half a second. A click or a key finishes it at once; it never holds the page.
 * Cheap on purpose: one canvas at up to 30 fps, paused when off screen or hidden, a single still frame with reduced
 * motion.
 */

export type Opening = "first" | "settle";

const TAU = Math.PI * 2;

interface Geometry {
  w: number;
  h: number;
  kx: number;
  ky: number;
  ex: number;
  narrow: boolean;
}

function geometry(w: number, h: number): Geometry {
  const narrow = w < 720;
  return narrow ? { w, h, kx: w * 0.78, ky: h * 0.5, ex: w * 1.04, narrow } : { w, h, kx: w * 0.63, ky: h * 0.5, ex: w * 0.795, narrow };
}

/** A point on room i's thread at s in 0..1 (left edge, through the knot at s=0.62, out to its label). */
function point(g: Geometry, i: number, count: number, s: number, t: number, phase: number): [number, number] {
  const spread = (i - (count - 1) / 2) / ((count - 1) / 2); // -1..1
  const y0 = g.h * 0.5 + spread * g.h * (g.narrow ? 0.42 : 0.36);
  const y1 = g.h * 0.5 + spread * g.h * 0.4;
  const K = 0.62;
  let x: number;
  let y: number;
  if (s <= K) {
    const u = s / K;
    const e = u * u * (3 - 2 * u);
    x = u * g.kx;
    y = y0 + (g.ky - y0) * e;
    const env = Math.sin(Math.PI * u) * (1 - u * 0.6);
    y += Math.sin(u * 7 + t * 0.55 + phase) * g.h * 0.05 * env;
  } else {
    const u = (s - K) / (1 - K);
    const e = 1 - (1 - u) * (1 - u);
    x = g.kx + (g.ex - g.kx) * u;
    y = g.ky + (y1 - g.ky) * e;
    y += Math.sin(u * 5 + t * 0.7 + phase) * g.h * 0.012 * Math.sin(Math.PI * u);
  }
  return [x, y];
}

function sprite(colour: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  const r = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,0.95)");
  r.addColorStop(0.18, colour);
  r.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = r;
  x.fillRect(0, 0, 32, 32);
  return c;
}

export function LatticeThreads({ pulses, opening, hovered }: { pulses: RoomPulse[]; opening: Opening; hovered: React.RefObject<string | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef(pulses);
  live.current = pulses;
  // With reduced motion the canvas is one still frame: drawn again whenever the rooms' pulses change.
  const redrawStill = useRef<(() => void) | null>(null);
  useEffect(() => redrawStill.current?.(), [pulses]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = reducedMotion();
    const css = getComputedStyle(canvas);
    const colourOf = (v: string) => {
      const m = /var\((--[\w-]+)\)/.exec(v);
      return (m ? css.getPropertyValue(m[1]!).trim() : v) || "#9fd2ff";
    };
    const sprites = new Map<string, HTMLCanvasElement>();
    const spriteOf = (c: string) => sprites.get(c) ?? (sprites.set(c, sprite(c)), sprites.get(c)!);
    const knotSprite = sprite("#cfe6ff");

    let g = geometry(1, 1);
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      g = geometry(r.width, r.height);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(performance.now());
    });
    ro.observe(canvas);

    // Motes: per thread, positions along it.
    const motes: { i: number; s: number; v: number }[] = [];
    const seed = (k: number) => {
      const x = Math.sin(k * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };
    const reseed = () => {
      motes.length = 0;
      live.current.forEach((p, i) => {
        const count = p.real ? Math.round(2 + p.activity * 9) : Math.round(1 + p.activity * 4);
        for (let k = 0; k < count; k++) motes.push({ i, s: seed(i * 31 + k), v: (0.035 + p.activity * 0.05) * (0.7 + seed(k + i) * 0.6) });
      });
    };
    reseed();

    const start = performance.now();
    const drawIn = still ? 0 : opening === "first" ? 1900 : 520;
    let skipAt: number | null = null;
    const skip = () => {
      skipAt ??= performance.now();
    };
    window.addEventListener("keydown", skip, { once: true });
    canvas.parentElement?.addEventListener("pointerdown", skip, { once: true });

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const raw = drawIn ? Math.min(1, (now - start) / drawIn) : 1;
      const p = skipAt !== null ? 1 : raw;
      const ps = live.current;
      if (motes.length === 0 || motes.some((m) => m.i >= ps.length)) reseed();
      ctx.clearRect(0, 0, g.w, g.h);
      ctx.globalCompositeOperation = "lighter";
      const hot = hovered.current;
      const N = 70;
      ps.forEach((pulse, i) => {
        const colour = colourOf(pulse.colour);
        const stagger = i * 0.045;
        const reach = Math.max(0, Math.min(1, (p - stagger) / (1 - 0.4)));
        if (reach <= 0) return;
        const dim = hot && hot !== pulse.id ? 0.35 : 1;
        const bright = (pulse.real ? 0.22 + pulse.activity * 0.5 : 0.1 + pulse.activity * 0.3) * dim * (hot === pulse.id ? 1.6 : 1);
        const phase = i * 0.9;
        ctx.beginPath();
        for (let k = 0; k <= N * reach; k++) {
          const [x, y] = point(g, i, ps.length, k / N, t, phase);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        // A soft wide glow under a fine line.
        ctx.strokeStyle = colour;
        ctx.globalAlpha = bright * 0.22;
        ctx.lineWidth = 5 + pulse.activity * 5;
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, bright * 1.25);
        ctx.lineWidth = pulse.real ? 1 + pulse.activity * 1.1 : 0.8;
        if (pulse.state === "waiting" || pulse.state === "sim") ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      // Motes run along the threads toward the knot and out.
      if (p > 0.5) {
        const fade = Math.min(1, (p - 0.5) * 2);
        for (const m of motes) {
          const pulse = ps[m.i];
          if (!pulse) continue;
          if (!still) m.s = (m.s + m.v / 30) % 1;
          const [x, y] = point(g, m.i, ps.length, m.s, t, m.i * 0.9);
          const size = pulse.real ? 7 + pulse.activity * 7 : 5;
          ctx.globalAlpha = fade * (pulse.real ? 0.85 : 0.4) * (hot && hot !== pulse.id ? 0.3 : 1) * Math.sin(Math.PI * m.s) ** 0.4;
          ctx.drawImage(spriteOf(colourOf(pulse.colour)), x - size / 2, y - size / 2, size, size);
        }
      }
      // The knot: the Lattice itself, breathing.
      if (p > 0.55) {
        const k = Math.min(1, (p - 0.55) / 0.45);
        const r = (g.narrow ? 40 : 64) * (1 + Math.sin(t * 1.3) * 0.06) * k;
        ctx.globalAlpha = 0.55 * k;
        ctx.drawImage(knotSprite, g.kx - r, g.ky - r, r * 2, r * 2);
        ctx.globalAlpha = 0.9 * k;
        ctx.beginPath();
        ctx.arc(g.kx, g.ky, 2.6, 0, TAU);
        ctx.fillStyle = "#f2f7ff";
        ctx.fill();
        ctx.globalAlpha = 0.35 * k;
        ctx.strokeStyle = "#cfe6ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(g.kx, g.ky, 14 + Math.sin(t * 0.9) * 2, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      canvas.dataset.drawn = p >= 1 ? "1" : "0";
    };

    let raf = 0;
    let last = 0;
    let onScreen = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (still) {
        draw(performance.now());
        return;
      }
      if (onScreen && document.visibilityState === "visible") raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      run();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", run);
    run();
    if (still) redrawStill.current = () => {
      reseed();
      draw(performance.now());
    };
    return () => {
      redrawStill.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("keydown", skip);
    };
  }, [opening, hovered]);

  return <canvas ref={ref} className="hero-threads" aria-hidden="true" />;
}

/** Where each room's label sits beside its thread's end, as a fraction of the hero's height. */
export function labelTop(i: number, count: number): number {
  const spread = (i - (count - 1) / 2) / ((count - 1) / 2);
  return 0.5 + spread * 0.4;
}
