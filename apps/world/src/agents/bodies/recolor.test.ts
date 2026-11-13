import { Color, SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";
import { hslOf, repaint, type Band } from "./recolor.ts";

/** The fast recolour (#1110) paints the same bytes the old per-texel three.js Color pass did. Made-up pixels. */

const NAVY: Band = { hue: 225, width: 30, minSat: 0.2, refL: 0.3 };

function oldWay(px: Uint8ClampedArray, band: Band, color: string): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px);
  const c = new Color(color);
  const t = { h: 0, s: 0, l: 0 };
  c.getHSL(t, SRGBColorSpace);
  const hsl = hslOf(out);
  const o = new Color();
  const rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0, j = 0; i < out.length; i += 4, j += 3) {
    const h = hsl[j]!;
    const s = hsl[j + 1]!;
    let d = Math.abs(h - band.hue) % 360;
    if (d > 180) d = 360 - d;
    if (s < band.minSat || d > band.width) continue;
    const nl = Math.min(0.97, Math.max(0.02, hsl[j + 2]! + (t.l - band.refL)));
    o.setHSL(t.h, Math.min(1, t.s * (0.6 + s * 0.5)), nl, SRGBColorSpace).getRGB(rgb, SRGBColorSpace);
    out[i] = Math.round(rgb.r * 255);
    out[i + 1] = Math.round(rgb.g * 255);
    out[i + 2] = Math.round(rgb.b * 255);
  }
  return out;
}

describe("recolouring an atlas (#1110)", () => {
  it("matches the old pass within a step, and leaves texels outside the band alone", () => {
    const px = new Uint8ClampedArray(4 * 512);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = rnd();
      px[i + 1] = rnd();
      px[i + 2] = rnd();
      px[i + 3] = 255;
    }
    for (const color of ["#e05a2b", "#3fbf7f", "#c9a24a"]) {
      const want = oldWay(px, NAVY, color);
      const got = new Uint8ClampedArray(px);
      const c = new Color(color);
      const t = { h: 0, s: 0, l: 0 };
      c.getHSL(t, SRGBColorSpace);
      repaint(got, hslOf(px), [{ band: NAVY, ...t }]);
      let worst = 0;
      for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i]! - want[i]!));
      expect(worst, color).toBeLessThanOrEqual(1);
    }
  });
});
