import { CanvasTexture, Color, SRGBColorSpace, type Texture } from "three";

/**
 * The KayKit characters are painted from a small palette atlas. Recolouring is a hue swap on that atlas:
 * every texel in a band (the robe, the trim) takes the new colour's hue and saturation, and keeps its own
 * shading, shifted so the band's typical lightness lands on the new colour's.
 */
export interface Band {
  /** Centre hue, degrees. */
  hue: number;
  /** Half-width, degrees. */
  width: number;
  /** Texels greyer than this are left alone (metal, skin highlights). */
  minSat: number;
  /** The band's typical lightness, 0–1. */
  refL: number;
}

const cache = new Map<string, Texture>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

const inBand = (h: number, s: number, band: Band) => {
  if (s < band.minSat) return false;
  let d = Math.abs(h - band.hue) % 360;
  if (d > 180) d = 360 - d;
  return d <= band.width;
};

/** A copy of `source` with each band repainted. Cached per source and colours. */
export function recolor(key: string, source: Texture, swaps: { band: Band; color: string }[]): Texture {
  const id = `${key}|${swaps.map((s) => s.color).join(",")}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const img = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const targets = swaps.map(({ band, color }) => {
    const c = new Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl, SRGBColorSpace);
    return { band, h: hsl.h, s: hsl.s, l: hsl.l };
  });
  const out = new Color();
  const rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = rgbToHsl(px[i]! / 255, px[i + 1]! / 255, px[i + 2]! / 255);
    const t = targets.find((x) => inBand(h, s, x.band));
    if (!t) continue;
    const nl = Math.min(0.97, Math.max(0.02, l + (t.l - t.band.refL)));
    out.setHSL(t.h, Math.min(1, t.s * (0.6 + s * 0.5)), nl, SRGBColorSpace).getRGB(rgb, SRGBColorSpace);
    px[i] = Math.round(rgb.r * 255);
    px[i + 1] = Math.round(rgb.g * 255);
    px[i + 2] = Math.round(rgb.b * 255);
  }
  ctx.putImageData(data, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = source.flipY;
  tex.wrapS = source.wrapS;
  tex.wrapT = source.wrapT;
  tex.magFilter = source.magFilter;
  tex.minFilter = source.minFilter;
  tex.anisotropy = 4;
  cache.set(id, tex);
  return tex;
}
