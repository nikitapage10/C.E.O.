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
    const embers = Array.from({ length: 40 }, () => ({ x: Math.random() * 1600, y: Math.random() * 1200, v: 14 + Math.random() * 26, p: Math.random() * 6.28 }));
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
      c.textAlign = "center";
      c.textBaseline = "middle";
      // The forge's iron (#932, Nikita 01:50Z: "molten seams, chains and ring motifs"): a chain hung down each side,
      // swaying a little, and the shaft's rings turning slowly behind them, tilted as the furnace's are.
      const chainAt = (x0: number, phase: number) => {
        const link = w < 760 ? 9 : 12;
        const n = Math.ceil((h * 0.8) / link);
        for (let i = 0; i < n; i++) {
          const y = i * link * 0.82;
          const sway = Math.sin(T * 0.6 + phase + i * 0.06) * (i / n) * 6;
          const a = 0.22 * (1 - i / n) + 0.04;
          c.strokeStyle = `rgba(${i % 2 ? GOLD : GOLD_HI},${a.toFixed(3)})`;
          c.lineWidth = 1.2;
          c.beginPath();
          if (i % 2) c.ellipse(x0 + sway, y, link * 0.18, link * 0.52, 0, 0, Math.PI * 2);
          else c.ellipse(x0 + sway, y, link * 0.36, link * 0.52, 0, 0, Math.PI * 2);
          c.stroke();
        }
      };
      const cx = w < 760 ? 10 : Math.min(60, w * 0.03);
      chainAt(cx, 0);
      chainAt(w - cx, 2.1);
      if (w >= 760) {
        for (let k = 0; k < 3; k++) {
          const ry = h * (0.2 + k * 0.22);
          const rw = 120 - k * 18;
          const tilt = 0.24 + 0.05 * Math.sin(T * 0.3 + k);
          const spin = (T * 0.25 + k * 1.3) % (Math.PI * 2);
          for (const side of [-1, 1]) {
            const x0 = side < 0 ? cx + 70 : w - cx - 70;
            c.strokeStyle = `rgba(${GOLD},${(0.1 - k * 0.02).toFixed(3)})`;
            c.lineWidth = 1;
            c.beginPath();
            c.ellipse(x0, ry, rw / 2, (rw / 2) * tilt, 0, 0, Math.PI * 2);
            c.stroke();
            // A rune riding each ring round.
            const gx = x0 + Math.cos(spin * side) * (rw / 2);
            const gy = ry + Math.sin(spin * side) * (rw / 2) * tilt;
            c.fillStyle = `rgba(${GOLD_HI},0.35)`;
            c.font = `10px "Noto Sans Runic","Geist Mono Variable",monospace`;
            c.fillText(GLYPHS[(k * 7 + 3) % GLYPHS.length]!, gx, gy);
          }
        }
      }
      // Embers off the melt, rising through the lower console.
      for (const e of embers) {
        e.y -= e.v * dt;
        e.x += Math.sin(T * 1.3 + e.p) * dt * 6;
        if (e.y < h * 0.25) {
          e.y = h + Math.random() * 40;
          e.x = Math.random() * w;
        }
        const life = Math.min(1, (h - e.y) / 80) * Math.min(1, (e.y - h * 0.25) / (h * 0.25));
        c.fillStyle = `rgba(255,${140 + Math.round(60 * e.p / 6.3)},70,${(life * 0.5).toFixed(3)})`;
        c.fillRect(e.x, e.y, 1.6, 1.6);
      }
      // The nanites: rising, turning over, brighter toward the sides where the grid gives way to them.
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
