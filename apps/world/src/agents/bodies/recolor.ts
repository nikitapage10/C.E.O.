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

/** HSL (h in degrees, s and l 0–1) to sRGB bytes; the same numbers three's `Color.setHSL(…, SRGB).getRGB(…, SRGB)` gives. */
function hslToRgb(h: number, s: number, l: number, out: Uint8ClampedArray | number[], at: number): void {
  const hue = (((h / 360) % 1) + 1) % 1;
  const q = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  };
  out[at] = Math.round(ch(hue + 1 / 3) * 255);
  out[at + 1] = Math.round(ch(hue) * 255);
  out[at + 2] = Math.round(ch(hue - 1 / 3) * 255);
}

/** A source atlas read once (#1110): its pixels and each texel's hue, saturation and lightness, shared by every colour. */
interface Read {
  w: number;
  h: number;
  px: Uint8ClampedArray;
  hsl: Float32Array;
}
const reads = new WeakMap<object, Read>();

/** Every texel's HSL, once per atlas: the pass that used to run again for each colour. */
export function hslOf(px: Uint8ClampedArray): Float32Array {
  const out = new Float32Array((px.length / 4) * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    const [h, s, l] = rgbToHsl(px[i]! / 255, px[i + 1]! / 255, px[i + 2]! / 255);
    out[j] = h;
    out[j + 1] = s;
    out[j + 2] = l;
  }
  return out;
}

/** Repaints the texels of `px` that fall in a band (`hsl` read from the same pixels), in place. */
export function repaint(px: Uint8ClampedArray, hsl: Float32Array, targets: { band: Band; h: number; s: number; l: number }[]): void {
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    const h = hsl[j]!;
    const s = hsl[j + 1]!;
    const t = targets.find((x) => inBand(h, s, x.band));
    if (!t) continue;
    const nl = Math.min(0.97, Math.max(0.02, hsl[j + 2]! + (t.l - t.band.refL)));
    hslToRgb(t.h * 360, Math.min(1, t.s * (0.6 + s * 0.5)), nl, px, i);
  }
}

/** A copy of `source` with each band repainted. Cached per source and colours. */
export function recolor(key: string, source: Texture, swaps: { band: Band; color: string }[]): Texture {
  const id = `${key}|${swaps.map((s) => s.color).join(",")}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const img = source.image as CanvasImageSource & { width: number; height: number };
  let read = reads.get(img);
  if (!read) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, c.width, c.height).data;
    read = { w: c.width, h: c.height, px, hsl: hslOf(px) };
    reads.set(img, read);
  }
  const canvas = document.createElement("canvas");
  canvas.width = read.w;
  canvas.height = read.h;
  // CPU-backed, as before: three uploads it as a texture, which reads it straight from memory.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const data = new ImageData(new Uint8ClampedArray(read.px), read.w, read.h);
  const targets = swaps.map(({ band, color }) => {
    const c = new Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl, SRGBColorSpace);
    return { band, h: hsl.h, s: hsl.s, l: hsl.l };
  });
  repaint(data.data, read.hsl, targets);
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
