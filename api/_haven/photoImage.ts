/**
 * The meal photo library's image work (#687): read a PNG (what OpenAI sends) or a JPEG (an upload), make the 720 px
 * JPEG the Desk shows. Pure JavaScript: the Functions package is one bundled file (azure/build.mjs), so no native
 * image library; PNG is inflated with Node's own zlib and JPEG goes through jpeg-js. Only what these photos need:
 * 8-bit, non-interlaced PNG (grey, RGB, grey+alpha, RGBA, palette), baseline or progressive JPEG.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { inflateSync } from "node:zlib";
import jpeg from "jpeg-js";

/** Pixels, four bytes each (RGBA). */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The width the Desk shows. */
export const SMALL_WIDTH = 720;
/** The most pixels an image may have (OpenAI's largest is 1536 × 1024; an upload gets room to spare). */
export const MAX_PIXELS = 16_000_000;
const JPEG_QUALITY = 82;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ImageKind = "png" | "jpeg";

/** What the bytes are, by their own magic number, or null. */
export function kindOf(bytes: Uint8Array): ImageKind | null {
  if (bytes.length > 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** A PNG's pixels. Throws on anything outside the shapes above. */
export function decodePng(bytes: Uint8Array): Rgba {
  if (kindOf(bytes) !== "png") throw new Error("not a png");
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const len = u32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (body.length !== len) throw new Error("png cut short");
    if (type === "IHDR") {
      width = u32(body, 0);
      height = u32(body, 4);
      depth = body[8]!;
      color = body[9]!;
      if (body[12] !== 0) throw new Error("interlaced png");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") alpha = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!width || !height || width * height > MAX_PIXELS) throw new Error("png size");
  if (depth !== 8 || ![0, 2, 3, 4, 6].includes(color)) throw new Error("png format");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color as 0 | 2 | 3 | 4 | 6];
  const stride = width * channels;
  const total = idat.reduce((n, b) => n + b.length, 0);
  const packed = new Uint8Array(total);
  let off = 0;
  for (const b of idat) {
    packed.set(b, off);
    off += b.length;
  }
  const raw = inflateSync(packed, { maxOutputLength: (stride + 1) * height });
  if (raw.length < (stride + 1) * height) throw new Error("png data short");
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= channels ? lines[dst + x - channels]! : 0;
      const b = y > 0 ? lines[dst - stride + x]! : 0;
      const c = x >= channels && y > 0 ? lines[dst - stride + x - channels]! : 0;
      let out: number;
      if (filter === 0) out = v;
      else if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error("png filter");
      lines[dst + x] = out & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    let r: number, g: number, bl: number, al = 255;
    if (color === 0 || color === 4) {
      r = g = bl = lines[j]!;
      if (color === 4) al = lines[j + 1]!;
    } else if (color === 3) {
      const k = lines[j]!;
      if (!palette || k * 3 + 2 >= palette.length) throw new Error("png palette");
      r = palette[k * 3]!;
      g = palette[k * 3 + 1]!;
      bl = palette[k * 3 + 2]!;
      if (alpha && k < alpha.length) al = alpha[k]!;
    } else {
      r = lines[j]!;
      g = lines[j + 1]!;
      bl = lines[j + 2]!;
      if (color === 6) al = lines[j + 3]!;
    }
    data.set([r, g, bl, al], i * 4);
  }
  return { width, height, data };
}

/** Any of the two kinds' pixels. */
export function decodeImage(bytes: Uint8Array): Rgba {
  const kind = kindOf(bytes);
  if (kind === "png") return decodePng(bytes);
  if (kind === "jpeg") {
    const got = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 256 });
    return { width: got.width, height: got.height, data: got.data };
  }
  throw new Error("not an image");
}

/** The image at `width` (never wider than it was), each pixel the average of the ones it covers; alpha onto white. */
export function shrink(img: Rgba, width: number): Rgba {
  const w = Math.min(width, img.width);
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3]! / 255;
          r += img.data[i]! * a + 255 * (1 - a);
          g += img.data[i + 1]! * a + 255 * (1 - a);
          b += img.data[i + 2]! * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** The pixels as a JPEG. */
export function encodeJpeg(img: Rgba, quality = JPEG_QUALITY): Uint8Array {
  return new Uint8Array(jpeg.encode({ width: img.width, height: img.height, data: img.data }, quality).data);
}

/** The Desk's copy: 720 px wide (or the image's own width when smaller), JPEG. */
export function smallJpeg(bytes: Uint8Array): { jpeg: Uint8Array; width: number; height: number; full: Rgba } {
  const full = decodeImage(bytes);
  const small = shrink(full, SMALL_WIDTH);
  return { jpeg: encodeJpeg(small), width: full.width, height: full.height, full };
}
