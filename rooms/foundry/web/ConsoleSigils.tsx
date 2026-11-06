import { useEffect, useRef } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";

/**
 * The furnace's look carried under it (#922, Nikita 2026-11-06 01:04Z: what sits under a room's hero must look the
 * part): a 2D canvas behind the Foundry's console with the Deep Furnace's language in it. A gold wire grid that holds
 * in the middle and breaks into dashes toward the edges, and sigil nanites drifting up out of it, turning over as they
 * go and fading out at the top, the way the shaft's edges come undone into code (@ceo/engine/sigils/undone.ts).
 *
 * Plain canvas, no three.js, so it costs the page nothing to load. It draws only while on screen and the tab is
 * visible, at 30 frames a second, fewer glyphs on a phone; under reduced motion it draws once and holds still.
 */

/** The same runes and code the 3D scenes' nanites are drawn from (undone.ts SIGIL_GLYPHS), kept here so this stays light. */
const GLYPHS = [..."ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ{}<>/=;∴"];
const GOLD = "201,168,92";
const GOLD_HI = "232,199,122";

export function ConsoleSigils() {
  const ref = useRef<HTMLCanvasElement>(null);
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
      const want = Math.round(Math.min(w < 760 ? 46 : 150, (w * h) / 9000));
      ns = Array.from({ length: want }, (_, i) => ns[i] ?? seed({ x: 0, y: 0, v: 0, s: 0, g: 0, t: 0, hi: false }, true));
    };
    /** 0 in the middle of the console, 1 at its sides: where the grid comes undone. */
    const edge = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    let T = 0;
    const draw = (dt: number) => {
      T += dt;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      // The wire grid: whole in the middle, dashes toward the sides, flickering where it breaks.
      const step = 44;
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
      for (let y = step / 2; y < h; y += step) {
        c.setLineDash([]);
        const g = c.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, `rgba(${GOLD},0.12)`);
        g.addColorStop(0.3, `rgba(${GOLD},0.04)`);
        g.addColorStop(0.7, `rgba(${GOLD},0.04)`);
        g.addColorStop(1, `rgba(${GOLD},0.12)`);
        c.strokeStyle = g;
        c.beginPath();
        c.moveTo(0, y + 0.5);
        c.lineTo(w, y + 0.5);
        c.stroke();
      }
      c.setLineDash([]);
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
  }, []);
  return <canvas ref={ref} className="fo-deck-sig" aria-hidden="true" />;
}
