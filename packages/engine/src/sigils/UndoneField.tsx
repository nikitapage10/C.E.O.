import { useEffect, useRef } from "react";
import { reducedMotion } from "./wvCanvas.ts";

/**
 * The 3D scenes' edges, carried under a room's hero in 2D (#922, #936; Nikita 2026-11-06: what sits under a room's
 * hero must look the part): a canvas behind a room's sections with the Senate's language in it (undone.ts). A gold
 * wire grid that holds in the middle and breaks into dashes toward the sides, and sigil nanites drifting up out of it,
 * turning over as they go and fading out at the top, the way the scenes' edges come undone into code. The Foundry's
 * console (the Deep Furnace) was the first; the Boiler Room's Map, Controls, Security and Compliance share it.
 *
 * Plain canvas, no three.js, so it costs a page nothing to load. It draws only while on screen and the tab is
 * visible, at 30 frames a second, fewer glyphs on a phone; under reduced motion it draws once and holds still.
 * The host gives it a class that places it (absolute, behind the content, pointer-events off).
 */

/** The same runes and code the 3D scenes' nanites are drawn from (undone.ts SIGIL_GLYPHS), kept here so this stays light. */
const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];
const GOLD = "201,168,92";
const GOLD_HI = "232,199,122";

export interface UndoneFieldProps {
  className: string;
  /** The grid's pitch in px (default 44). */
  step?: number;
  /** How many nanites at most on a desk and on a phone (default 150 and 46); fewer on a small canvas. */
  most?: [number, number];
}

export function UndoneField({ className, step = 44, most = [150, 46] }: UndoneFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [desk, phone] = most;
  useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    const reduce = reducedMotion();
    let w = 0;
    let h = 0;
    let dpr = 1;
    type N = { x: number; y: number; v: number; s: number; g: number; t: number; hi: boolean };
    let ns: N[] = [];
    const seed = (n: N, fresh: boolean) => {
      n.x = Math.random() * w;
      n.y = fresh ? Math.random() * h : h + 10;
      n.v = 6 + Math.random() * 16;
      n.s = 9 + Math.random() * 8;
      n.g = Math.floor(Math.random() * GLYPHS.length);
      n.t = Math.random() * 4;
      n.hi = Math.random() < 0.22;
      return n;
    };
    const size = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const want = Math.round(Math.min(w < 760 ? phone : desk, (w * h) / 9000));
      ns = Array.from({ length: want }, (_, i) => ns[i] ?? seed({ x: 0, y: 0, v: 0, s: 0, g: 0, t: 0, hi: false }, true));
    };
    /** 0 in the middle, 1 at the sides: where the grid comes undone. */
    const edge = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    let T = 0;
    const draw = (dt: number) => {
      T += dt;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      // The wire grid: whole in the middle, dashes toward the sides, flickering where it breaks.
      c.lineWidth = 1;
      for (let x = (w / 2) % step; x < w; x += step) {
        const e = edge(x);
        c.strokeStyle = `rgba(${GOLD},${0.05 + e * 0.07})`;
        c.setLineDash(e > 0.55 ? [3 + (1 - e) * 10, 4 + e * 10] : []);
        c.lineDashOffset = -T * 6;
        c.beginPath();
        c.moveTo(x + 0.5, 0);
        c.lineTo(x + 0.5, h);
        c.stroke();
      }
      c.setLineDash([]);
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, `rgba(${GOLD},0.12)`);
      g.addColorStop(0.3, `rgba(${GOLD},0.04)`);
      g.addColorStop(0.7, `rgba(${GOLD},0.04)`);
      g.addColorStop(1, `rgba(${GOLD},0.12)`);
      c.strokeStyle = g;
      for (let y = step / 2; y < h; y += step) {
        c.beginPath();
        c.moveTo(0, y + 0.5);
        c.lineTo(w, y + 0.5);
        c.stroke();
      }
      // The nanites: rising, turning over, brighter toward the sides where the grid gives way to them.
      c.textAlign = "center";
      c.textBaseline = "middle";
      for (const n of ns) {
        n.y -= n.v * dt;
        n.t += dt;
        if (n.t > 1.6 + n.s / 10) {
          n.t = 0;
          n.g = (n.g + 1 + Math.floor(Math.random() * 5)) % GLYPHS.length;
        }
        if (n.y < -12) seed(n, false);
        const life = Math.min(1, n.y / (h * 0.35)) * Math.min(1, (h + 10 - n.y) / 40);
        const a = (0.1 + edge(n.x) * 0.38) * Math.max(0, life) * (n.hi ? 1.6 : 1);
        if (a < 0.02) continue;
        c.font = `${n.s.toFixed(0)}px "Noto Sans Runic","Geist Mono Variable",monospace`;
        c.fillStyle = `rgba(${n.hi ? GOLD_HI : GOLD},${Math.min(0.75, a).toFixed(3)})`;
        c.fillText(GLYPHS[n.g]!, n.x, n.y);
      }
    };
    size();
    draw(0);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => (size(), draw(0))) : null;
    ro?.observe(cv);
    if (reduce) return () => ro?.disconnect();
    let on = true;
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((en) => (on = en[en.length - 1]!.isIntersecting)) : null;
    io?.observe(cv);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!on || document.visibilityState === "hidden") {
        last = now;
        return;
      }
      if (now - last < 1000 / 30 - 2) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      draw(dt);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [step, desk, phone]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
