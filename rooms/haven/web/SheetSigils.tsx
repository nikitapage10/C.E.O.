import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import type { DeckFrame } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * Under a Haven room's sheet (#977): the Kitchen, the Hall, the Pets, the Gym and each room open over the house on the
 * Haven's own deck, the way the Foundry's, Workshop's, Annex's and Studio's sections sit on theirs (#932). The shared
 * gold wire and nanites (UndoneField), and under them a draughtsman's floor plan: a few rooms' walls in fine gold,
 * door swings at their openings, and a lamp-warm light slowly sweeping across, as if the plan were being read. It's a
 * drawing, never the real plan (that stays behind the passkey and is drawn only in the 3D house): the cards over it
 * carry the facts.
 */

const GOLD = "240,201,135";

/** Rooms as shares of the canvas: x, y, width, height, and which wall has its door (0 top, 1 right, 2 bottom, 3 left). */
const ROOMS: [number, number, number, number, number][] = [
  [0.03, 0.06, 0.2, 0.26, 1],
  [0.23, 0.06, 0.14, 0.18, 2],
  [0.03, 0.32, 0.14, 0.3, 0],
  [0.77, 0.08, 0.2, 0.22, 3],
  [0.81, 0.3, 0.16, 0.3, 0],
  [0.68, 0.6, 0.29, 0.3, 3],
  [0.03, 0.62, 0.22, 0.3, 1],
];

function plan({ c, w, h, t, phone }: DeckFrame) {
  const sweep = ((t / 14) % 1) * (w + 400) - 200;
  c.lineWidth = 1;
  for (const [rx, ry, rw, rh, door] of phone ? ROOMS.slice(0, 4) : ROOMS) {
    const x = Math.round(rx * w) + 0.5;
    const y = Math.round(ry * h) + 0.5;
    const ww = Math.round(rw * w);
    const hh = Math.round(rh * h);
    const near = Math.max(0, 1 - Math.abs(x + ww / 2 - sweep) / 260);
    c.strokeStyle = `rgba(${GOLD},${(0.09 + near * 0.12).toFixed(3)})`;
    // The walls, with a gap for the door; its swing drawn as a quarter arc.
    const d = Math.min(34, ww * 0.3, hh * 0.3);
    const segs: [number, number, number, number][] = [
      [x, y, x + ww, y],
      [x + ww, y, x + ww, y + hh],
      [x + ww, y + hh, x, y + hh],
      [x, y + hh, x, y],
    ];
    segs.forEach(([x1, y1, x2, y2], i) => {
      c.beginPath();
      if (i !== door) {
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
      } else {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const ux = Math.sign(x2 - x1);
        const uy = Math.sign(y2 - y1);
        c.moveTo(x1, y1);
        c.lineTo(mx - (ux * d) / 2, my - (uy * d) / 2);
        c.moveTo(mx + (ux * d) / 2, my + (uy * d) / 2);
        c.lineTo(x2, y2);
        c.stroke();
        c.setLineDash([2, 3]);
        c.beginPath();
        const hx = mx - (ux * d) / 2;
        const hy = my - (uy * d) / 2;
        const start = Math.atan2(uy, ux);
        c.arc(hx, hy, d, start, start + Math.PI / 2);
        c.stroke();
        c.setLineDash([]);
        return;
      }
      c.stroke();
    });
  }
  // The lamp light reading the plan.
  const g = c.createLinearGradient(sweep - 200, 0, sweep + 200, 0);
  g.addColorStop(0, `rgba(${GOLD},0)`);
  g.addColorStop(0.5, `rgba(${GOLD},0.035)`);
  g.addColorStop(1, `rgba(${GOLD},0)`);
  c.fillStyle = g;
  c.fillRect(sweep - 200, 0, 400, h);
}

const TONE = { wire: GOLD, glyph: "201,168,92", hi: "255,226,170" };

export function SheetSigils() {
  return <UndoneField className="hv-sheet-sig" tone={TONE} under={plan} most={[110, 36]} />;
}
