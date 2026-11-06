import { useRef } from "react";
import { DECK_FONT, DECK_GLYPHS, useDeckCanvas } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * Under the print farm (#932): the Workshop's console sits on a build plate. A fine gold grid, ruled every five, that
 * holds in the middle and breaks into dashes toward the sides; a nozzle laying one slow serpentine pass whose line cools
 * behind it; and sigil nanites settling down onto the plate the way filament lays down, layer on layer, brighter at the
 * sides where the grid comes undone into them. Drawn by the engine's deck loop (30 fps, on screen only, still under
 * reduced motion). Nothing here stands for a real print: it's the room's look, and the console over it carries the facts.
 */

const GOLD = "201,168,92";
const HI = "232,199,122";

type N = { x: number; y: number; v: number; s: number; g: number; t: number; floor: number };

export function PlateSigils() {
  const ref = useRef<HTMLCanvasElement>(null);
  const ns = useRef<N[]>([]);
  const trail = useRef<{ x: number; y: number; a: number }[]>([]);
  useDeckCanvas(ref, ({ c, w, h, t, dt, sized, phone }) => {
    const seed = (n: N, fresh: boolean) => {
      n.x = Math.random() * w;
      n.y = fresh ? Math.random() * h : -12;
      n.v = 5 + Math.random() * 12;
      n.s = 9 + Math.random() * 7;
      n.g = Math.floor(Math.random() * DECK_GLYPHS.length);
      n.t = 0;
      n.floor = h * (0.55 + Math.random() * 0.45);
      return n;
    };
    if (sized) {
      const want = Math.round(Math.min(phone ? 40 : 130, (w * h) / 10000));
      ns.current = Array.from({ length: want }, () => seed({ x: 0, y: 0, v: 0, s: 0, g: 0, t: 0, floor: 0 }, true));
      trail.current = [];
    }
    const edge = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    // The plate: a 10 px rule, a stronger one every five, whole in the middle and dashed toward the sides.
    const minor = phone ? 14 : 18;
    c.lineWidth = 1;
    for (let i = 0, x = (w / 2) % minor; x < w; x += minor, i++) {
      const e = edge(x);
      const major = Math.round((x - w / 2) / minor) % 5 === 0;
      c.strokeStyle = `rgba(${GOLD},${(major ? 0.07 : 0.025) + e * (major ? 0.06 : 0.03)})`;
      c.setLineDash(e > 0.6 ? [2 + (1 - e) * 8, 3 + e * 9] : []);
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, h);
      c.stroke();
    }
    c.setLineDash([]);
    for (let y = minor / 2, i = 0; y < h; y += minor, i++) {
      const major = i % 5 === 0;
      const g = c.createLinearGradient(0, 0, w, 0);
      const a = major ? 0.1 : 0.035;
      g.addColorStop(0, `rgba(${GOLD},${a * 1.6})`);
      g.addColorStop(0.3, `rgba(${GOLD},${a * 0.6})`);
      g.addColorStop(0.7, `rgba(${GOLD},${a * 0.6})`);
      g.addColorStop(1, `rgba(${GOLD},${a * 1.6})`);
      c.strokeStyle = g;
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(w, y + 0.5);
      c.stroke();
    }
    // The nozzle: one serpentine pass across the plate, its line cooling from bright gold to nothing behind it.
    const rows = phone ? 6 : 9;
    const span = w * 0.86;
    const per = 7;
    const k = (t / per) % rows;
    const row = Math.floor(k);
    const f = k - row;
    const nx = w * 0.07 + (row % 2 ? 1 - f : f) * span;
    const ny = h * 0.12 + (row / (rows - 1)) * h * 0.76;
    const tr = trail.current;
    tr.push({ x: nx, y: ny, a: 1 });
    for (const p of tr) p.a -= dt * 0.12;
    while (tr.length && tr[0]!.a <= 0) tr.shift();
    if (tr.length > 1) {
      c.lineCap = "round";
      for (let i = 1; i < tr.length; i++) {
        const p = tr[i]!;
        const q = tr[i - 1]!;
        if (Math.abs(p.y - q.y) > 4) continue;
        c.strokeStyle = `rgba(${p.a > 0.85 ? HI : GOLD},${(p.a * 0.32).toFixed(3)})`;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(q.x, q.y);
        c.lineTo(p.x, p.y);
        c.stroke();
      }
      c.fillStyle = `rgba(${HI},0.55)`;
      c.beginPath();
      c.arc(nx, ny, 2.4, 0, Math.PI * 2);
      c.fill();
      const halo = c.createRadialGradient(nx, ny, 0, nx, ny, 22);
      halo.addColorStop(0, `rgba(${HI},0.18)`);
      halo.addColorStop(1, `rgba(${HI},0)`);
      c.fillStyle = halo;
      c.fillRect(nx - 22, ny - 22, 44, 44);
    }
    // The nanites settle down onto the plate, turning over, and fade where they land.
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const n of ns.current) {
      n.y += n.v * dt;
      n.t += dt;
      if (n.t > 1.4 + n.s / 12) {
        n.t = 0;
        n.g = (n.g + 1 + Math.floor(Math.random() * 5)) % DECK_GLYPHS.length;
      }
      if (n.y > n.floor + 30) seed(n, false);
      const land = n.y > n.floor ? 1 - (n.y - n.floor) / 30 : Math.min(1, (n.y + 12) / 60);
      const a = (0.08 + edge(n.x) * 0.36) * Math.max(0, land);
      if (a < 0.02) continue;
      c.font = `${n.s.toFixed(0)}px ${DECK_FONT}`;
      c.fillStyle = `rgba(${n.y > n.floor ? HI : GOLD},${Math.min(0.7, a).toFixed(3)})`;
      c.fillText(DECK_GLYPHS[n.g]!, n.x, n.y);
    }
  });
  return <canvas ref={ref} className="ws-deck-sig" aria-hidden="true" />;
}
