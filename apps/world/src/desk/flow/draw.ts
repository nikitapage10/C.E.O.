import { gauss, type Parts, type Poly, spr, sstep, WHITE } from "../wvCanvas.ts";
import { Motes, NEAR } from "./motes.ts";
import { passes } from "./path.ts";

/**
 * The particle line itself (#428): Today's river streams (Confluence, #413), as one function every page draws with.
 * Particles ride the line at their own speeds, scattered about it by depth; the far, small ones are batched into
 * plain squares (Motes) and only the near, bright ones get the glowing sprite. Today's stage (confluence/stage.ts)
 * draws its streams with it, so a page's lines and Today's are the same light.
 */

/** One shared queue for the small motes: filled and flushed within one line's draw. */
const MOTES = new Motes();

export interface StreamOpts {
  /** "r,g,b". */
  rgb: string;
  /** Alpha, 0..1 (Today: its focus fade, halved for a room not set up). */
  a: number;
  /** Speed along the line, px/s. */
  v: number;
  /** Half-width of the scatter about the line, px. */
  sp: number;
  /** How much wider the scatter runs at the end (Today's river opening: 3); 0 keeps it even. */
  widen?: number;
  /** How much bigger the particles grow toward the end (Today: .35). */
  swell?: number;
  /** Draw only up to here, 0..1 (a line growing in). */
  head?: number;
  /** Filtering: past `at`, only `keep` (0..1) of the particles go on. */
  thin?: { at: number; keep: number };
  /** Travel from the end back to the start. */
  reverse?: boolean;
}

/** Draw one line's particles, moving them by `dt` (0 for a still frame). */
export function stream(c: CanvasRenderingContext2D, poly: Poly, P: Parts, o: StreamOpts, t: number, dt: number) {
  if (poly.n < 2) return;
  const L = poly.len;
  const sp = spr(o.rgb);
  const sw = spr(WHITE);
  const head = o.head ?? 1;
  const widen = o.widen ?? 0;
  const swell = o.swell ?? 0;
  const thin = o.thin;
  for (let k = 0; k < P.n; k++) {
    let u = P.u[k]!;
    if (dt) {
      u += (P.v[k]! * o.v * dt) / L;
      if (u > 1) {
        u -= 1;
        P.o[k] = gauss();
      }
      P.u[k] = u;
    }
    if (u > head) continue;
    if (thin && u > thin.at && !passes(k, thin.keep)) continue;
    const z = P.z[k]!;
    const edge = sstep(0, 0.05, u) * (1 - 0.55 * sstep(0.9, 1, u));
    const al = o.a * (0.25 + 0.75 * z) * edge;
    if (al < 0.03) continue;
    const q = o.reverse ? 1 - u : u;
    const p = poly.at(q);
    const w = o.sp * (1 + widen * sstep(0.5, 0.85, u)) * (0.5 + 0.5 * z);
    const off = P.o[k]! * w + Math.sin(t * 1.6 + P.p[k]! * 5) * 1.2;
    const sz = (0.8 + z * 2) * (1 + swell * sstep(0.5, 0.9, u));
    const x = p.x - p.ty * off;
    const y = p.y + p.tx * off;
    if (z < NEAR && !P.c[k]) {
      if (edge > 0.5) MOTES.add(x, y, sz, z > 0.2);
      continue;
    }
    c.globalAlpha = al;
    c.drawImage(P.c[k] ? sw : sp, x - sz, y - sz, sz * 2, sz * 2);
  }
  MOTES.flush(c, o.rgb, o.a);
}

/** A moment on a line (Today's knots): a glow in the line's colour with a white core; `big` for the open one. */
export function knotAt(c: CanvasRenderingContext2D, x: number, y: number, rgb: string, a: number, big = false) {
  c.globalAlpha = (big ? 0.9 : 0.5) * a;
  const r = big ? 13 : 8;
  c.drawImage(spr(rgb), x - r, y - r, r * 2, r * 2);
  c.globalAlpha = Math.min(1, (big ? 1 : 0.7) * a);
  c.drawImage(spr(WHITE), x - 2.2, y - 2.2, 4.4, 4.4);
}
