import { useMemo, useRef } from "react";
import { Parts, Poly, eOut, reducedMotion, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import { bell, landforms, seed, type LandIn, type Landform } from "./terrain.ts";

/**
 * The book drawn as one cross-section of sea and land (#387). Sea level is what was paid: a position in profit rises
 * through it as an island, one at a loss stands under it as a seamount, and each footprint is the position's share of
 * the book. Contour lines run through the land (bright above the water, dim beneath it), the surface swells with light
 * riding it, and the land rises from the sea floor when the book first reads. Hovering a landform or its row lights
 * both. The drawing carries shapes only; every figure sits in the plain ledger beside it. With no book (signed out,
 * waiting) it is the open sea, nothing more.
 */

const MINT = "124,205,172";
const INK = "236,238,243";

/** Where the waterline sits, as a share of the canvas's height. */
export const SEA = 0.6;
/** Room kept above the highest summit for the markers. */
const TOP = 70;

export interface TerrainItem extends LandIn {
  market: string;
}

interface Laid {
  fs: Landform[];
  sds: number[];
  xs: Float32Array;
  ys: Float32Array;
  own: Int16Array;
  sea: number;
  floor: number;
  born: number;
  surf: Poly;
  P: Parts;
}

/** The skyline's height at each column for a given growth (0..1), and which landform owns that column. */
function skyline(L: Laid, W: number, grow: number) {
  const n = L.xs.length;
  const up = L.sea - TOP;
  for (let i = 0; i < n; i++) {
    const x = L.xs[i]! / W;
    let best = L.floor;
    let who = -1;
    for (let k = 0; k < L.fs.length; k++) {
      const f = L.fs[k]!;
      const b = bell(x, f, L.sds[k]!);
      if (b <= 0) continue;
      const summit = f.rise >= 0 ? L.sea - f.rise * up : L.sea + -f.rise * (L.floor - L.sea - 22);
      const y = L.floor - (L.floor - summit) * b * grow;
      if (y < best) {
        best = y;
        who = k;
      }
    }
    // A sea floor with a slow swell of its own, so the deep isn't a ruler line.
    const bed = L.floor - 6 - 4 * Math.sin(x * 9 + 1.3) - 2 * Math.sin(x * 23);
    L.ys[i] = Math.min(best, bed);
    L.own[i] = best < bed ? who : -1;
  }
}

function spec(items: readonly TerrainItem[], hot: { current: number | null }): VizSpec {
  const fs = landforms(items);
  const sds = items.map((p) => seed(p.market));
  return {
    blend: "source-over",
    lay(V) {
      const step = 3;
      const n = Math.ceil(V.W / step) + 1;
      const xs = new Float32Array(n);
      for (let i = 0; i < n; i++) xs[i] = Math.min(V.W, i * step);
      const sea = Math.round(V.H * SEA);
      const surf = new Poly();
      const prev = V.s.L as Laid | undefined;
      V.s.L = {
        fs,
        sds,
        xs,
        ys: new Float32Array(n),
        own: new Int16Array(n),
        sea,
        floor: V.H - 4,
        born: prev?.born ?? -1,
        surf,
        P: new Parts(Math.round(V.W / 9), 0.08),
      } satisfies Laid;
    },
    draw(V, c, t, dt) {
      const L = V.s.L as Laid;
      if (L.born < 0) L.born = t;
      const still = reducedMotion();
      const grow = still ? 1 : eOut((t - L.born) / 1.8);
      skyline(L, V.W, grow);
      const { xs, ys, own, sea } = L;
      const n = xs.length;
      const H = V.H;
      const W = V.W;
      const h = hot.current;

      // The sea's own lines first, kept to open water: the land is clipped out of them.
      c.save();
      c.beginPath();
      c.moveTo(0, 0);
      for (let i = 0; i < n; i++) c.lineTo(xs[i]!, ys[i]!);
      c.lineTo(W, 0);
      c.closePath();
      c.clip();
      c.lineWidth = 1;
      for (let y = sea + 12, k = 1; y < H; y += 12, k++) {
        const a = 0.12 * Math.pow(1 - (y - sea) / (H - sea), 1.6);
        c.strokeStyle = `rgba(${INK},${a.toFixed(3)})`;
        c.setLineDash([1, 5 + k]);
        c.lineDashOffset = still ? 0 : -t * (6 + k * 2);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(W, y);
        c.stroke();
      }
      c.setLineDash([]);
      c.restore();

      // The land: contour lines through it, bright where it stands in air, dim through the water.
      c.save();
      c.beginPath();
      c.moveTo(0, H);
      for (let i = 0; i < n; i++) c.lineTo(xs[i]!, ys[i]!);
      c.lineTo(W, H);
      c.closePath();
      c.clip();
      const g = c.createLinearGradient(0, sea - (sea - TOP), 0, H);
      g.addColorStop(0, `rgba(${MINT},.10)`);
      g.addColorStop(0.5, `rgba(${MINT},.035)`);
      g.addColorStop(1, `rgba(${INK},.0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      c.lineWidth = 1;
      for (let y = sea - 4; y > 0; y -= 6) {
        c.strokeStyle = `rgba(${MINT},${(0.34 + 0.3 * (1 - y / sea)).toFixed(3)})`;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(W, y);
        c.stroke();
      }
      c.setLineDash([2, 4]);
      for (let y = sea + 6; y < H; y += 6) {
        c.strokeStyle = `rgba(${INK},${(0.16 * (1 - (y - sea) / (H - sea)) + 0.03).toFixed(3)})`;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(W, y);
        c.stroke();
      }
      c.setLineDash([]);
      c.restore();

      // The skyline itself: mint in air, faint under water; the hot landform's run drawn brighter.
      c.lineJoin = "round";
      for (const under of [false, true]) {
        c.save();
        c.beginPath();
        if (under) c.rect(0, sea, W, H - sea);
        else c.rect(0, 0, W, sea);
        c.clip();
        let run = -2;
        for (let i = 0; i < n; i++) {
          const o = own[i]!;
          const hl = h !== null && o === h;
          if (i === 0 || (hl ? 1 : 0) !== run) {
            if (i > 0) c.stroke();
            run = hl ? 1 : 0;
            c.lineWidth = hl ? 2 : 1.2;
            c.strokeStyle = under ? `rgba(${INK},${hl ? 0.7 : 0.28})` : `rgba(${MINT},${hl ? 1 : h === null ? 0.85 : 0.5})`;
            c.beginPath();
            c.moveTo(xs[Math.max(0, i - 1)]!, ys[Math.max(0, i - 1)]!);
          }
          c.lineTo(xs[i]!, ys[i]!);
        }
        c.stroke();
        c.restore();
      }

      // Each summit marked by a sounding line up to its number (the markers sit in the page above the canvas).
      L.fs.forEach((f, k) => {
        const i = Math.round((f.cx * W) / (W / (n - 1)));
        const sy = ys[Math.min(n - 1, Math.max(0, i))]!;
        const x = f.cx * W;
        const hl = h === k;
        c.strokeStyle = f.rise >= 0 ? `rgba(${MINT},${hl ? 0.9 : 0.35})` : `rgba(${INK},${hl ? 0.75 : 0.22})`;
        c.lineWidth = 1;
        c.setLineDash([1, 3]);
        c.beginPath();
        c.moveTo(x, sy - 5);
        c.lineTo(x, 40);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = f.rise >= 0 ? `rgba(${MINT},${hl ? 1 : 0.8})` : `rgba(${INK},${hl ? 0.9 : 0.5})`;
        c.beginPath();
        c.arc(x, sy, hl ? 3.2 : 2.2, 0, Math.PI * 2);
        c.fill();
      });

      // The surface: a slow swell with light riding it.
      const m = 48;
      const sx = new Float32Array(m + 1);
      const sy = new Float32Array(m + 1);
      for (let i = 0; i <= m; i++) {
        const x = (i / m) * W;
        sx[i] = x;
        sy[i] = sea + (still ? 0 : Math.sin(x / 70 + t * 0.9) * 1.6 + Math.sin(x / 23 - t * 1.3) * 0.6);
      }
      L.surf.set(sx, sy);
      c.globalCompositeOperation = "lighter";
      weave(c, L.surf, L.P, { a: 0.55, sp: 1.2, sz: 0.6, v: 14, rgb: MINT, rgb2: INK, line: 0.5, lw: 1 }, t, dt);
      c.globalCompositeOperation = "source-over";
    },
  };
}

/** The canvas; `hot` is read every frame, so hovering never re-lays the land. */
export function Terrain({ items, hot }: { items: readonly TerrainItem[]; hot: number | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const hotRef = useRef<number | null>(hot);
  hotRef.current = hot;
  const key = items.map((p) => `${p.market}:${p.value.toFixed(2)}:${p.pnl.toFixed(2)}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sp = useMemo(() => spec(items, hotRef), [key]);
  useViz(cv, sp);
  return <canvas ref={cv} className="wv-cv xc-terrain-cv" aria-hidden="true" />;
}
