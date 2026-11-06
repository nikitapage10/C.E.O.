import { useRef } from "react";
import { DECK_FONT, DECK_GLYPHS, useDeckCanvas } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * Under the Glasshouse (#932): the Annex's console stands behind glass. The dome's mullions in gold, a lattice of panes
 * whole in the middle that thins into dashes toward the sides; a slow glint crossing the panes the way dusk light moves
 * over the dome; and sigil nanites drifting up and swaying like pollen off the beds, brighter at the sides where the
 * glass comes undone into them. Drawn by the engine's deck loop (30 fps, on screen only, still under reduced motion);
 * it's the room's look only, and the console over it carries the facts.
 */

const GOLD = "201,168,92";
const HI = "236,214,160";

type N = { x: number; y: number; v: number; s: number; g: number; t: number; ph: number };

export function PaneSigils() {
  const ref = useRef<HTMLCanvasElement>(null);
  const ns = useRef<N[]>([]);
  useDeckCanvas(ref, ({ c, w, h, t, dt, sized, phone }) => {
    const seed = (n: N, fresh: boolean) => {
      n.x = Math.random() * w;
      n.y = fresh ? Math.random() * h : h + 10;
      n.v = 5 + Math.random() * 11;
      n.s = 9 + Math.random() * 7;
      n.g = Math.floor(Math.random() * DECK_GLYPHS.length);
      n.t = Math.random() * 3;
      n.ph = Math.random() * 6.28;
      return n;
    };
    if (sized) ns.current = Array.from({ length: Math.round(Math.min(phone ? 44 : 140, (w * h) / 9000)) }, () => seed({ x: 0, y: 0, v: 0, s: 0, g: 0, t: 0, ph: 0 }, true));
    const edge = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    // The panes: a triangular lattice, as the dome's glass is cut, whole in the middle and dashed toward the sides.
    const step = phone ? 54 : 72;
    const k = Math.tan(Math.PI / 3);
    const glint = ((t * 0.04) % 1.6) - 0.3;
    c.lineWidth = 1;
    for (const dir of [1, -1]) {
      for (let x0 = -h / k - step; x0 < w + h / k + step; x0 += step) {
        const xm = x0 + (dir * h) / (2 * k);
        const e = edge(Math.max(0, Math.min(w, xm)));
        const near = Math.max(0, 1 - Math.abs(xm / w - glint) * 6);
        c.strokeStyle = `rgba(${near > 0.05 ? HI : GOLD},${(0.035 + e * 0.07 + near * 0.12).toFixed(3)})`;
        c.setLineDash(e > 0.6 ? [3 + (1 - e) * 10, 4 + e * 10] : []);
        c.beginPath();
        c.moveTo(x0, 0);
        c.lineTo(x0 + (dir * h) / k, h);
        c.stroke();
      }
    }
    c.setLineDash([]);
    for (let y = step * 0.866 * 0.5, i = 0; y < h; y += step * 0.866, i++) {
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, `rgba(${GOLD},0.12)`);
      g.addColorStop(0.35, `rgba(${GOLD},0.035)`);
      g.addColorStop(0.65, `rgba(${GOLD},0.035)`);
      g.addColorStop(1, `rgba(${GOLD},0.12)`);
      c.strokeStyle = g;
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(w, y + 0.5);
      c.stroke();
    }
    // The nanites: pollen off the beds, rising and swaying, turning over as they go.
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const n of ns.current) {
      n.y -= n.v * dt;
      n.t += dt;
      if (n.t > 1.8 + n.s / 10) {
        n.t = 0;
        n.g = (n.g + 1 + Math.floor(Math.random() * 5)) % DECK_GLYPHS.length;
      }
      if (n.y < -12) seed(n, false);
      const x = n.x + Math.sin(t * 0.5 + n.ph) * 14;
      const life = Math.min(1, n.y / (h * 0.3)) * Math.min(1, (h + 10 - n.y) / 50);
      const a = (0.09 + edge(x) * 0.36) * Math.max(0, life);
      if (a < 0.02) continue;
      c.font = `${n.s.toFixed(0)}px ${DECK_FONT}`;
      c.fillStyle = `rgba(${n.s > 14 ? HI : GOLD},${Math.min(0.7, a).toFixed(3)})`;
      c.fillText(DECK_GLYPHS[n.g]!, x, n.y);
    }
  });
  return <canvas ref={ref} className="an-deck-sig" aria-hidden="true" />;
}
