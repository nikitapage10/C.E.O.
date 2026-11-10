import { useRef } from "react";
import { DECK_FONT, DECK_GLYPHS, useDeckCanvas, type DeckFrame } from "./deckCanvas.ts";

/**
 * The 3D scenes' edges, carried under a room's hero in 2D (#922, #936; Nikita 2026-11-06: what sits under a room's
 * hero must look the part): a canvas behind a room's sections with the Senate's language in it (undone.ts). A gold
 * wire grid that holds in the middle and breaks into dashes toward the sides, and sigil nanites drifting up out of it,
 * turning over as they go and fading out at the top, the way the scenes' edges come undone into code. The Foundry's
 * console (the Deep Furnace) was the first; the Boiler Room's Map, Controls, Security and Compliance share it.
 *
 * Plain canvas, no three.js, so it costs a page nothing to load. The engine's deck loop (deckCanvas.ts, #932) draws it:
 * only while on screen and the tab is visible, at 30 frames a second, fewer glyphs on a phone; under reduced motion
 * once, held still. A room can lay its own motif between the grid and the nanites with `under` (the Foundry hangs its
 * chains, rings and embers there). The host gives it a class that places it (absolute, behind the content, pointer-events off).
 */

const GOLD = "201,168,92";
const GOLD_HI = "232,199,122";

export interface UndoneFieldProps {
  className: string;
  /** The grid's pitch in px (default 44). */
  step?: number;
  /** How many nanites at most on a desk and on a phone (default 150 and 46); fewer on a small canvas. */
  most?: [number, number];
  /** A room's own layer, drawn over the grid and under the nanites each frame. Fixed for the page's life. */
  under?: (f: DeckFrame) => void;
  /** The wire's and the nanites' colours as "r,g,b" (default the Senate's gold): Relay keeps its blue wire and white
   *  nanites, the Archive the Tide's silver (#977). */
  tone?: { wire: string; glyph: string; hi: string };
}

type N = { x: number; y: number; v: number; s: number; g: number; t: number; hi: boolean };

export function UndoneField({ className, step = 44, most = [150, 46], under, tone }: UndoneFieldProps) {
  const WIRE = tone?.wire ?? GOLD;
  const GLYPH = tone?.glyph ?? GOLD;
  const HI = tone?.hi ?? GOLD_HI;
  const ref = useRef<HTMLCanvasElement>(null);
  const ns = useRef<N[]>([]);
  useDeckCanvas(ref, (f) => {
    const { c, w, h, t: T, dt, sized, phone } = f;
    const seed = (n: N, fresh: boolean) => {
      n.x = Math.random() * w;
      n.y = fresh ? Math.random() * h : h + 10;
      n.v = 6 + Math.random() * 16;
      n.s = 9 + Math.random() * 8;
      n.g = Math.floor(Math.random() * DECK_GLYPHS.length);
      n.t = Math.random() * 4;
      n.hi = Math.random() < 0.22;
      return n;
    };
    if (sized) {
      const want = Math.round(Math.min(phone ? most[1] : most[0], (w * h) / 9000));
      ns.current = Array.from({ length: want }, (_, i) => ns.current[i] ?? seed({ x: 0, y: 0, v: 0, s: 0, g: 0, t: 0, hi: false }, true));
    }
    /** 0 in the middle, 1 at the sides: where the grid comes undone. */
    const edge = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    // The wire grid: whole in the middle, dashes toward the sides, flickering where it breaks.
    c.lineWidth = 1;
    for (let x = (w / 2) % step; x < w; x += step) {
      const e = edge(x);
      c.strokeStyle = `rgba(${WIRE},${0.05 + e * 0.07})`;
      c.setLineDash(e > 0.55 ? [3 + (1 - e) * 10, 4 + e * 10] : []);
      c.lineDashOffset = -T * 6;
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, h);
      c.stroke();
    }
    c.setLineDash([]);
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgba(${WIRE},0.12)`);
    g.addColorStop(0.3, `rgba(${WIRE},0.04)`);
    g.addColorStop(0.7, `rgba(${WIRE},0.04)`);
    g.addColorStop(1, `rgba(${WIRE},0.12)`);
    c.strokeStyle = g;
    for (let y = step / 2; y < h; y += step) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(w, y + 0.5);
      c.stroke();
    }
    c.textAlign = "center";
    c.textBaseline = "middle";
    if (under) {
      c.save();
      under(f);
      c.restore();
    }
    // The nanites: rising, turning over, brighter toward the sides where the grid gives way to them.
    for (const n of ns.current) {
      n.y -= n.v * dt;
      n.t += dt;
      if (n.t > 1.6 + n.s / 10) {
        n.t = 0;
        n.g = (n.g + 1 + Math.floor(Math.random() * 5)) % DECK_GLYPHS.length;
      }
      if (n.y < -12) seed(n, false);
      const life = Math.min(1, n.y / (h * 0.35)) * Math.min(1, (h + 10 - n.y) / 40);
      const a = (0.1 + edge(n.x) * 0.38) * Math.max(0, life) * (n.hi ? 1.6 : 1);
      if (a < 0.02) continue;
      c.font = `${n.s.toFixed(0)}px ${DECK_FONT}`;
      c.fillStyle = `rgba(${n.hi ? HI : GLYPH},${Math.min(0.75, a).toFixed(3)})`;
      c.fillText(DECK_GLYPHS[n.g]!, n.x, n.y);
    }
  });
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
