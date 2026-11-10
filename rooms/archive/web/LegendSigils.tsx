import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";
import type { DeckFrame } from "@ceo/engine/sigils/deckCanvas.ts";
import { WT_SILVER_RGB } from "../data/warTable.ts";

/**
 * Under the war table (#977): where the places are listed below the table (a phone), they lie on the Tide's own deck,
 * the way the Foundry's, Workshop's, Annex's and Studio's sections lie on theirs (#932). The shared wire and nanites
 * (UndoneField) in the Tide's silver, never gold, and under them the drowned table's ripples running out from two
 * points the way its mesh rings the islands. The room's look only: the tablets over it carry the places and their notes.
 */

const SILVER = WT_SILVER_RGB;

function ripples({ c, w, h, t }: DeckFrame) {
  const springs: [number, number, number][] = [
    [w * 0.22, h * 0.18, 0],
    [w * 0.8, h * 0.62, 2.3],
  ];
  c.lineWidth = 1;
  for (const [x, y, off] of springs) {
    for (let i = 0; i < 7; i++) {
      const k = (((t + off) / 9 + i / 7) % 1 + 1) % 1;
      const r = 18 + k * Math.max(w, h) * 0.7;
      const a = 0.13 * (1 - k) * Math.min(1, k * 10);
      if (a < 0.01) continue;
      c.strokeStyle = `rgba(${SILVER},${a.toFixed(3)})`;
      c.setLineDash(k > 0.5 ? [4, 5 + k * 12] : []);
      c.beginPath();
      c.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }
  c.setLineDash([]);
}

const TONE = { wire: SILVER, glyph: SILVER, hi: "245,248,252" };

export function LegendSigils() {
  return <UndoneField className="wt-legend-sig" tone={TONE} under={ripples} step={40} most={[60, 40]} />;
}
