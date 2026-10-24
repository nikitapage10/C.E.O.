import { useMemo, useRef } from "react";
import { reducedMotion, spr, useViz, type VizSpec } from "../wvCanvas.ts";
import { seed } from "./terrain.ts";

/**
 * What's moving the world, as weather (#387): every world market is a pressure system over the band, its strength the
 * day's move (rising odds build pressure, falling odds draw it down). The field's isobars are traced live, the market
 * on the stage sits nearest the reader and draws brightest, and motes of light ride the wind along the isobars, the way
 * air runs round a system. The whole field drifts slowly east. Shapes only: the figures are on the board beside it.
 */

const MINT = "124,205,172";
const INK = "236,238,243";

export interface FrontIn {
  id: string;
  change24h: number | null;
}

interface Sys {
  x: number;
  y: number;
  s: number;
  r: number;
}

interface Field {
  sys: Sys[];
  gw: number;
  gh: number;
  cell: number;
  g: Float32Array;
  motes: Float32Array;
}

/** Where a level crosses a cell edge running from value a to value b, starting at o. */
const cut = (o: number, cell: number, lv: number, a: number, b: number) => o + (cell * (lv - a)) / (b - a);

const LEVELS = [-0.9, -0.62, -0.38, -0.18, 0.18, 0.38, 0.62, 0.9];

/** The systems' places: the stage's market to the left of centre, the rest scattered by their ids across the band. */
function place(fs: readonly FrontIn[], at: number, W: number, H: number): Sys[] {
  const max = Math.max(0.02, ...fs.map((f) => Math.abs(f.change24h ?? 0)));
  return fs.map((f, i) => {
    const sd = seed(f.id);
    const sd2 = seed(`${f.id}~`);
    const stage = i === at;
    const s = (f.change24h ?? 0) / max;
    return {
      x: stage ? W * 0.3 : W * (0.06 + 0.88 * sd),
      y: stage ? H * 0.42 : H * (0.12 + 0.76 * sd2),
      s: (stage ? 1.25 : 0.85) * (Math.abs(s) < 0.08 ? Math.sign(s || 1) * 0.08 : s),
      r: Math.min(W, H * 2.2) * (stage ? 0.26 : 0.13 + 0.09 * Math.abs(s)),
    };
  });
}

function sample(F: Field, x: number, y: number, ox: number): number {
  let v = 0;
  for (const p of F.sys) {
    const dx = x - p.x - ox;
    const dy = y - p.y;
    v += p.s * Math.exp(-(dx * dx + dy * dy) / (p.r * p.r));
  }
  return v;
}

function spec(fs: readonly FrontIn[], at: number): VizSpec {
  return {
    blend: "lighter",
    lay(V) {
      const cell = V.W < 600 ? 10 : 12;
      const gw = Math.ceil(V.W / cell) + 1;
      const gh = Math.ceil(V.H / cell) + 1;
      const N = Math.round(Math.min(220, (V.W * V.H) / 4200));
      const motes = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        motes[i * 3] = Math.random() * V.W;
        motes[i * 3 + 1] = Math.random() * V.H;
        motes[i * 3 + 2] = Math.random() * 6;
      }
      V.s.F = { sys: place(fs, at, V.W, V.H), gw, gh, cell, g: new Float32Array(gw * gh), motes } satisfies Field;
    },
    draw(V, c, t, dt) {
      const F = V.s.F as Field;
      const { gw, gh, cell, g } = F;
      const still = reducedMotion();
      // The field drifts east and wraps, so a front keeps rolling in.
      const ox = still ? 0 : ((t * 6) % (V.W * 0.2)) - V.W * 0.1;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = sample(F, i * cell, j * cell, ox);

      // Isobars by marching squares, one level at a time.
      c.lineWidth = 1;
      for (const lv of LEVELS) {
        const a = 0.06 + 0.16 * Math.abs(lv);
        c.strokeStyle = lv > 0 ? `rgba(${MINT},${a.toFixed(3)})` : `rgba(${INK},${(a * 0.7).toFixed(3)})`;
        c.setLineDash(lv > 0 ? [] : [3, 4]);
        c.beginPath();
        for (let j = 0; j < gh - 1; j++) {
          for (let i = 0; i < gw - 1; i++) {
            const a0 = g[j * gw + i]!;
            const a1 = g[j * gw + i + 1]!;
            const a2 = g[(j + 1) * gw + i + 1]!;
            const a3 = g[(j + 1) * gw + i]!;
            const k = (a0 > lv ? 1 : 0) | (a1 > lv ? 2 : 0) | (a2 > lv ? 4 : 0) | (a3 > lv ? 8 : 0);
            if (k === 0 || k === 15) continue;
            const x = i * cell;
            const y = j * cell;
            // Each edge's crossing is worked out only when a segment needs it, with nothing allocated per cell.
            switch (k) {
              case 1:
              case 14:
                c.moveTo(x, cut(y, cell, lv, a0, a3));
                c.lineTo(cut(x, cell, lv, a0, a1), y);
                break;
              case 2:
              case 13:
                c.moveTo(cut(x, cell, lv, a0, a1), y);
                c.lineTo(x + cell, cut(y, cell, lv, a1, a2));
                break;
              case 3:
              case 12:
                c.moveTo(x, cut(y, cell, lv, a0, a3));
                c.lineTo(x + cell, cut(y, cell, lv, a1, a2));
                break;
              case 4:
              case 11:
                c.moveTo(x + cell, cut(y, cell, lv, a1, a2));
                c.lineTo(cut(x, cell, lv, a3, a2), y + cell);
                break;
              case 6:
              case 9:
                c.moveTo(cut(x, cell, lv, a0, a1), y);
                c.lineTo(cut(x, cell, lv, a3, a2), y + cell);
                break;
              case 7:
              case 8:
                c.moveTo(x, cut(y, cell, lv, a0, a3));
                c.lineTo(cut(x, cell, lv, a3, a2), y + cell);
                break;
              case 5:
                c.moveTo(x, cut(y, cell, lv, a0, a3));
                c.lineTo(cut(x, cell, lv, a0, a1), y);
                c.moveTo(x + cell, cut(y, cell, lv, a1, a2));
                c.lineTo(cut(x, cell, lv, a3, a2), y + cell);
                break;
              case 10:
                c.moveTo(cut(x, cell, lv, a0, a1), y);
                c.lineTo(x + cell, cut(y, cell, lv, a1, a2));
                c.moveTo(x, cut(y, cell, lv, a0, a3));
                c.lineTo(cut(x, cell, lv, a3, a2), y + cell);
                break;
            }
          }
        }
        c.stroke();
      }
      c.setLineDash([]);

      // The wind: motes run along the isobars (across the gradient), with a little westerly under them.
      const m = F.motes;
      const sp = spr(MINT);
      const sw = spr(INK);
      for (let i = 0; i < m.length; i += 3) {
        let x = m[i]!;
        let y = m[i + 1]!;
        if (!still && dt) {
          const e = 2;
          const gx = (sample(F, x + e, y, ox) - sample(F, x - e, y, ox)) / (2 * e);
          const gy = (sample(F, x, y + e, ox) - sample(F, x, y - e, ox)) / (2 * e);
          x += (-gy * 2600 + 5) * dt;
          y += gx * 2600 * dt;
          m[i + 2] = m[i + 2]! + dt;
          if (x < -4 || x > V.W + 4 || y < -4 || y > V.H + 4 || m[i + 2]! > 7) {
            x = Math.random() * V.W;
            y = Math.random() * V.H;
            m[i + 2] = 0;
          }
          m[i] = x;
          m[i + 1] = y;
        }
        const life = m[i + 2]!;
        const fade = Math.min(1, life / 0.8, (7 - life) / 0.8);
        const v = sample(F, x, y, ox);
        c.globalAlpha = Math.max(0, fade) * (0.15 + 0.5 * Math.min(1, Math.abs(v)));
        const z = 1.4 + Math.min(1, Math.abs(v)) * 1.6;
        c.drawImage(v >= 0 ? sp : sw, x - z, y - z, z * 2, z * 2);
      }
      c.globalAlpha = 1;
    },
  };
}

export function Fronts({ items, at }: { items: readonly FrontIn[]; at: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const key = items.map((f) => `${f.id}:${f.change24h ?? "-"}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sp = useMemo(() => spec(items, at), [key, at]);
  useViz(cv, sp);
  return <canvas ref={cv} className="wv-cv xc-fronts-cv" aria-hidden="true" />;
}
