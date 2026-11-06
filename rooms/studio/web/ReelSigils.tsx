import { useRef } from "react";
import { DECK_FONT, DECK_GLYPHS, useDeckCanvas } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * Under the sound stage (#932): the Studio's console sits on an edit bay's screen. A gold timecode ruler along the top
 * with its ticks running by, faint track lanes under it, one waveform line drawn across the middle the way an audio
 * track shows (whole in the middle, breaking into dashes toward the sides), and sigil nanites scrolling past right to
 * left like frames under a playhead, brighter at the sides where the lanes come undone into them. Drawn by the engine's
 * deck loop (30 fps, on screen only, still under reduced motion). It's the room's look only: no voice is recorded yet,
 * so the waveform is a drawing, not a reading; the console over it carries the facts.
 */

const GOLD = "201,168,92";
const HI = "232,199,122";

type N = { x: number; y: number; v: number; s: number; g: number; t: number };

export function ReelSigils() {
  const ref = useRef<HTMLCanvasElement>(null);
  const ns = useRef<N[]>([]);
  useDeckCanvas(ref, ({ c, w, h, t, dt, sized, phone }) => {
    const lanes = phone ? 7 : 9;
    const laneH = h / lanes;
    const seed = (n: N, fresh: boolean) => {
      n.x = fresh ? Math.random() * w : w + 12;
      n.y = (Math.floor(Math.random() * lanes) + 0.5) * laneH;
      n.v = 10 + Math.random() * 18;
      n.s = 9 + Math.random() * 6;
      n.g = Math.floor(Math.random() * DECK_GLYPHS.length);
      n.t = Math.random() * 2;
      return n;
    };
    if (sized) ns.current = Array.from({ length: Math.round(Math.min(phone ? 40 : 130, (w * h) / 9500)) }, () => seed({ x: 0, y: 0, v: 0, s: 0, g: 0, t: 0 }, true));
    const edge = (x: number) => Math.min(1, Math.abs(x / w - 0.5) * 2);
    // Track lanes: hairlines between them, brighter at the sides.
    for (let i = 1; i < lanes; i++) {
      const y = Math.round(i * laneH) + 0.5;
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, `rgba(${GOLD},0.11)`);
      g.addColorStop(0.3, `rgba(${GOLD},0.03)`);
      g.addColorStop(0.7, `rgba(${GOLD},0.03)`);
      g.addColorStop(1, `rgba(${GOLD},0.11)`);
      c.strokeStyle = g;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    // The ruler: ticks every 12 px running left, a longer one each second's worth.
    const tick = 12;
    const off = (t * 24) % (tick * 10);
    for (let x = -off, i = 0; x < w; x += tick, i++) {
      const major = i % 10 === 0;
      c.strokeStyle = `rgba(${GOLD},${(major ? 0.3 : 0.12) + edge(x) * 0.12})`;
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, major ? 14 : 6);
      c.stroke();
    }
    // The waveform: a drawn line, whole in the middle and dashed toward the sides.
    const mid = h * 0.5;
    c.lineWidth = 1.2;
    let px = 0;
    let py = mid;
    for (let x = 0; x <= w; x += 4) {
      const e = edge(x);
      const amp = laneH * 0.9 * (0.35 + 0.65 * Math.abs(Math.sin(x * 0.004 + t * 0.2))) * (1 - e * 0.5);
      const y = mid + Math.sin(x * 0.045 + t * 1.6) * Math.sin(x * 0.011 - t * 0.7) * amp;
      if (x > 0 && !(e > 0.6 && Math.floor(x / 8) % 2)) {
        c.strokeStyle = `rgba(${HI},${(0.22 - e * 0.1).toFixed(3)})`;
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(x, y);
        c.stroke();
      }
      px = x;
      py = y;
    }
    // The nanites: frames scrolling under the playhead, right to left along the lanes.
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const n of ns.current) {
      n.x -= n.v * dt;
      n.t += dt;
      if (n.t > 1.5 + n.s / 12) {
        n.t = 0;
        n.g = (n.g + 1 + Math.floor(Math.random() * 5)) % DECK_GLYPHS.length;
      }
      if (n.x < -12) seed(n, false);
      const a = (0.07 + edge(n.x) * 0.36) * Math.min(1, n.y / (h * 0.2));
      if (a < 0.02) continue;
      c.font = `${n.s.toFixed(0)}px ${DECK_FONT}`;
      c.fillStyle = `rgba(${n.s > 13 ? HI : GOLD},${Math.min(0.7, a).toFixed(3)})`;
      c.fillText(DECK_GLYPHS[n.g]!, n.x, n.y);
    }
  });
  return <canvas ref={ref} className="st-deck-sig" aria-hidden="true" />;
}
