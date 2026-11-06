import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import { DECK_FONT, DECK_GLYPHS, type DeckFrame } from "@ceo/engine/sigils/deckCanvas.ts";

/**
 * The furnace's look carried under it (#922, Nikita 2026-11-06 01:04Z: what sits under a room's hero must look the
 * part): the gold wire grid and the sigil nanites behind the Foundry's console, from the engine's shared field
 * (@ceo/engine/sigils/UndoneField.tsx, which the Boiler Room's pages share since #936), with the forge's own iron laid
 * between them (#932, Nikita 01:50Z: below the Foundry was "pretty boring and lame"): a chain hung down each side,
 * the shaft's rings turning slowly with a rune riding each, and embers rising off the melt.
 */

const GOLD = "201,168,92";
const GOLD_HI = "232,199,122";
const embers = Array.from({ length: 40 }, () => ({ x: Math.random() * 1600, y: Math.random() * 1200, v: 14 + Math.random() * 26, p: Math.random() * 6.28 }));

function forgeIron({ c, w, h, t: T, dt, phone }: DeckFrame) {
  const chainAt = (x0: number, phase: number) => {
    const link = phone ? 9 : 12;
    const n = Math.ceil((h * 0.8) / link);
    c.lineWidth = 1.2;
    for (let i = 0; i < n; i++) {
      const y = i * link * 0.82;
      const sway = Math.sin(T * 0.6 + phase + i * 0.06) * (i / n) * 6;
      const a = 0.22 * (1 - i / n) + 0.04;
      c.strokeStyle = `rgba(${i % 2 ? GOLD : GOLD_HI},${a.toFixed(3)})`;
      c.beginPath();
      c.ellipse(x0 + sway, y, link * (i % 2 ? 0.18 : 0.36), link * 0.52, 0, 0, Math.PI * 2);
      c.stroke();
    }
  };
  const cx = phone ? 10 : Math.min(60, w * 0.03);
  chainAt(cx, 0);
  chainAt(w - cx, 2.1);
  if (!phone) {
    c.lineWidth = 1;
    c.font = `10px ${DECK_FONT}`;
    for (let k = 0; k < 3; k++) {
      const ry = h * (0.2 + k * 0.22);
      const rw = 120 - k * 18;
      const tilt = 0.24 + 0.05 * Math.sin(T * 0.3 + k);
      const spin = (T * 0.25 + k * 1.3) % (Math.PI * 2);
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? cx + 70 : w - cx - 70;
        c.strokeStyle = `rgba(${GOLD},${(0.1 - k * 0.02).toFixed(3)})`;
        c.beginPath();
        c.ellipse(x0, ry, rw / 2, (rw / 2) * tilt, 0, 0, Math.PI * 2);
        c.stroke();
        // A rune riding each ring round.
        c.fillStyle = `rgba(${GOLD_HI},0.35)`;
        c.fillText(DECK_GLYPHS[(k * 7 + 3) % DECK_GLYPHS.length]!, x0 + Math.cos(spin * side) * (rw / 2), ry + Math.sin(spin * side) * (rw / 2) * tilt);
      }
    }
  }
  // Embers off the melt, rising through the lower console.
  for (const e of embers) {
    e.y -= e.v * dt;
    e.x += Math.sin(T * 1.3 + e.p) * dt * 6;
    if (e.y < h * 0.25 || e.y > h + 60 || e.x > w) {
      e.y = h + Math.random() * 40;
      e.x = Math.random() * w;
    }
    const life = Math.min(1, (h - e.y) / 80) * Math.min(1, (e.y - h * 0.25) / (h * 0.25));
    if (life <= 0) continue;
    c.fillStyle = `rgba(255,${140 + Math.round((60 * e.p) / 6.3)},70,${(life * 0.5).toFixed(3)})`;
    c.fillRect(e.x, e.y, 1.6, 1.6);
  }
}

export function ConsoleSigils() {
  return <UndoneField className="fo-deck-sig" under={forgeIron} />;
}
