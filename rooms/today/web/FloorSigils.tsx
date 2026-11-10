import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import type { DeckFrame } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * Under the Senate's chamber (#977): the floor below the docket carries the chamber's tiers on. Over the shared gold
 * wire and its nanites (UndoneField), the benches' rings spread from the dais above the fold, whole in the middle and
 * breaking into dashes toward the sides, with the aisles running out between them and a faint light walking each ring.
 * The room's look only: the panels over it carry the facts.
 */

const GOLD = "201,168,92";
const HI = "232,199,122";

function tiers({ c, w, h, t, phone }: DeckFrame) {
  const cx = w / 2;
  const cy = -Math.min(h * 0.08, 120);
  const rings = phone ? 7 : 10;
  const gap = Math.max(70, Math.min(150, (h + Math.abs(cy)) / rings));
  c.lineWidth = 1;
  for (let i = 1; i <= rings; i++) {
    const r = i * gap;
    // Whole across the middle, dashed out toward the sides (the angle off straight down).
    for (let a = 0.08; a < Math.PI - 0.08; a += 0.02) {
      const side = Math.abs(a - Math.PI / 2) / (Math.PI / 2);
      if (side > 0.55 && Math.floor(a * 60 + i) % 3 === 0) continue;
      const al = (0.11 - i * 0.006) * (1 - side * 0.7);
      if (al <= 0.01) continue;
      c.strokeStyle = `rgba(${GOLD},${al.toFixed(3)})`;
      c.beginPath();
      c.arc(cx, cy, r, a, a + 0.016);
      c.stroke();
    }
    // A light walking the ring, slower further out.
    const at = Math.PI / 2 + Math.sin(t * (0.22 - i * 0.012) + i * 1.7) * 1.1;
    const g = c.createRadialGradient(cx + Math.cos(at) * r, cy + Math.sin(at) * r, 0, cx + Math.cos(at) * r, cy + Math.sin(at) * r, 26);
    g.addColorStop(0, `rgba(${HI},${(0.22 - i * 0.012).toFixed(3)})`);
    g.addColorStop(1, `rgba(${HI},0)`);
    c.fillStyle = g;
    c.fillRect(cx + Math.cos(at) * r - 26, cy + Math.sin(at) * r - 26, 52, 52);
  }
  // The aisles: rays from the dais, fading as they run down.
  const aisles = phone ? 4 : 6;
  for (let k = 1; k < aisles; k++) {
    const a = (Math.PI * k) / aisles;
    const g = c.createLinearGradient(cx, cy, cx + Math.cos(a) * rings * gap, cy + Math.sin(a) * rings * gap);
    g.addColorStop(0, `rgba(${GOLD},0.14)`);
    g.addColorStop(1, `rgba(${GOLD},0)`);
    c.strokeStyle = g;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * gap, cy + Math.sin(a) * gap);
    c.lineTo(cx + Math.cos(a) * rings * gap, cy + Math.sin(a) * rings * gap);
    c.stroke();
  }
}

export function FloorSigils() {
  return <UndoneField className="td-deck-sig" under={tiers} most={[110, 36]} />;
}
