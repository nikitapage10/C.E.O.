import { useEffect, useMemo, useRef } from "react";
import { reducedMotion, spr, useViz, type VizSpec } from "../wvCanvas.ts";
import { seed } from "./terrain.ts";

/**
 * What's moving the world, as weather (#387): every world market is a pressure system over the band, its strength the
 * day's move (rising odds build pressure, falling odds draw it down). The isobars are traced once a layout and slide
 * with the field; the day's biggest mover sits nearest the reader, the market on the stage draws brightest, and motes
 * of light ride the wind along the isobars, the way air runs round a system. The whole field sways slowly east and
 * back. Shapes only: the figures are on the board beside it.
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
  /** The isobars, drawn once per layout onto their own canvas, wider than the band, which then only slides (a GPU
   * transform: no canvas is redrawn or re-uploaded for it). */
  sheet: HTMLCanvasElement | null;
  /** The sheet's last offset, so a frame that hasn't moved it writes nothing. */
  ox: number;
  /** The field sampled on a grid over the sheet (field coordinates, from x0), for the motes' wind. */
  gw: number;
  gh: number;
  cell: number;
  x0: number;
  g: Float32Array;
  motes: Float32Array;
  /** The band's width (the field and the isobars span it) and the motes' canvas width, which may be narrower. */
  W: number;
  H: number;
  MW: number;
}

/** The fade toward the band's edges (it used to be a CSS mask, which re-composites every frame). */
function fade(x: number, y: number, W: number, H: number): number {
  const dx = (x - W * 0.3) / (W * 1.2);
  const dy = (y - H * 0.4) / (H * 0.9);
  const d = Math.sqrt(dx * dx + dy * dy);
  return d <= 0.4 ? 1 : d >= 1 ? 0.35 : 1 - ((d - 0.4) / 0.6) * 0.65;
}

/** The field's value at a field point, read off the grid (bilinear), so a mote costs four reads, not six exponentials. */
function at(F: Field, fx: number, fy: number): number {
  const u = (fx - F.x0) / F.cell;
  const v = fy / F.cell;
  const i = Math.max(0, Math.min(F.gw - 2, Math.floor(u)));
  const j = Math.max(0, Math.min(F.gh - 2, Math.floor(v)));
  const a = Math.max(0, Math.min(1, u - i));
  const b = Math.max(0, Math.min(1, v - j));
  const g = F.g;
  const k = j * F.gw + i;
  return (g[k]! * (1 - a) + g[k + 1]! * a) * (1 - b) + (g[k + F.gw]! * (1 - a) + g[k + F.gw + 1]! * a) * b;
}

/** Where a level crosses a cell edge running from value a to value b, starting at o. */
const cut = (o: number, cell: number, lv: number, a: number, b: number) => o + (cell * (lv - a)) / (b - a);

const LEVELS = [-0.9, -0.62, -0.38, -0.18, 0.18, 0.38, 0.62, 0.9];

/**
 * The systems' places: the day's biggest mover (first, as the board sorts them) anchored left of centre by the stage,
 * the rest scattered by their ids across the band. The field doesn't move when the stage turns to another market, so
 * the weather stays put and only the light picks out the market being read.
 */
function place(fs: readonly FrontIn[], W: number, H: number): Sys[] {
  const at = 0;
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

function sample(sys: readonly Sys[], x: number, y: number): number {
  let v = 0;
  for (const p of sys) {
    const dx = x - p.x;
    const dy = y - p.y;
    v += p.s * Math.exp(-(dx * dx + dy * dy) / (p.r * p.r));
  }
  return v;
}

/** The isobars by marching squares, one level at a time, onto the sheet; done once per layout, never per frame. */
function trace(F: Field, c: CanvasRenderingContext2D, dpr: number) {
  const { gw, gh, cell, g, x0 } = F;
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
        // Sheet coordinates: the grid starts at x0 in the field, which is the sheet's left edge.
        const x = i * cell;
        const y = j * cell;
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
  // The edges fade, baked into the sheet once.
  const W = F.W;
  const H = F.H;
  c.globalCompositeOperation = "destination-in";
  // An ellipse 1.2 widths by 0.9 heights round the stage: a circle, squashed about its centre.
  const r = W * 1.2;
  const k = (H * 0.9) / r;
  const gr = c.createRadialGradient(W * 0.3 - x0, H * 0.4, 0, W * 0.3 - x0, H * 0.4, r);
  gr.addColorStop(0, "rgba(0,0,0,1)");
  gr.addColorStop(0.4, "rgba(0,0,0,1)");
  gr.addColorStop(1, "rgba(0,0,0,.35)");
  c.setTransform(dpr, 0, 0, dpr * k, 0, dpr * H * 0.4 * (1 - k));
  c.fillStyle = gr;
  c.fillRect(-W, -H / k, W * 4, (H * 3) / k);
  c.globalCompositeOperation = "source-over";
}

/** How far the field has swayed at time t: slowly east and back, never a jump. */
const sway = (t: number, W: number) => Math.sin(t * 0.045) * W * 0.09;

function spec(fs: readonly FrontIn[], sheetRef: { current: HTMLCanvasElement | null }, atRef: { current: number }): VizSpec {
  return {
    blend: "lighter",
    lay(V) {
      // The motes' canvas covers only the open water left of the board (see the css); the field spans the whole band.
      const MW = V.W;
      const W = Math.max(MW, V.cv.parentElement?.clientWidth ?? MW);
      const H = V.H;
      const cell = W < 600 ? 10 : 12;
      const x0 = -W * 0.1;
      const gw = Math.ceil((W * 1.2) / cell) + 1;
      const gh = Math.ceil(H / cell) + 1;
      const N = Math.round(Math.min(130, (MW * H) / 5200));
      const motes = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        motes[i * 3] = Math.random() * MW;
        motes[i * 3 + 1] = Math.random() * H;
        motes[i * 3 + 2] = Math.random() * 6;
      }
      const sys = place(fs, W, H);
      const g = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = sample(sys, x0 + i * cell, j * cell);
      const F: Field = { sys, sheet: null, ox: NaN, gw, gh, cell, x0, g, motes, W, H, MW };
      const sheet = sheetRef.current;
      const sc = sheet?.getContext("2d");
      if (sheet && sc) {
        sheet.width = Math.ceil(W * 1.2 * V.dpr);
        sheet.height = Math.ceil(H * V.dpr);
        sheet.style.width = `${W * 1.2}px`;
        sheet.style.height = `${H}px`;
        sheet.style.left = `${x0}px`;
        sc.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
        sc.clearRect(0, 0, W * 1.2, H);
        trace(F, sc, V.dpr);
        F.sheet = sheet;
      }
      V.s.F = F;
    },
    draw(V, c, t, dt) {
      const F = V.s.F as Field;
      const still = reducedMotion();
      const { W, H, MW } = F;
      const ox = still ? 0 : sway(t, W);
      // The isobars slide with the field: a transform on their own layer, written only when it moves.
      const q = Math.round(ox * 4) / 4;
      if (F.sheet && q !== F.ox) {
        F.ox = q;
        F.sheet.style.transform = `translate3d(${q}px,0,0)`;
      }

      // The wind: motes run along the isobars (across the gradient), with a little westerly under them.
      const m = F.motes;
      const sp = spr(MINT);
      const sw = spr(INK);
      const e = F.cell * 0.5;
      // The market on the stage: motes inside its system burn brighter and a little larger.
      const st = F.sys[atRef.current] ?? null;
      const sr2 = st ? (st.r * 1.15) ** 2 : 1;
      for (let i = 0; i < m.length; i += 3) {
        let x = m[i]!;
        let y = m[i + 1]!;
        if (!still && dt) {
          const fx = x - ox;
          const gx = (at(F, fx + e, y) - at(F, fx - e, y)) / (2 * e);
          const gy = (at(F, fx, y + e) - at(F, fx, y - e)) / (2 * e);
          x += (-gy * 2600 + 5) * dt;
          y += gx * 2600 * dt;
          m[i + 2] = m[i + 2]! + dt;
          if (x < -4 || x > MW + 4 || y < -4 || y > H + 4 || m[i + 2]! > 7) {
            x = Math.random() * MW;
            y = Math.random() * H;
            m[i + 2] = 0;
          }
          m[i] = x;
          m[i + 1] = y;
        }
        const life = m[i + 2]!;
        const f = Math.min(1, life / 0.8, (7 - life) / 0.8);
        const raw = at(F, x - ox, y);
        const v = Math.min(1, Math.abs(raw));
        let lit = 0;
        if (st) {
          const dx = x - ox - st.x;
          const dy = y - st.y;
          lit = Math.exp(-(dx * dx + dy * dy) / sr2);
        }
        c.globalAlpha = Math.min(1, Math.max(0, f) * (0.15 + 0.5 * v) * fade(x, y, W, H) * (1 + 1.3 * lit));
        const z = 1.4 + v * 1.6 + lit * 0.9;
        c.drawImage(raw >= 0 ? sp : sw, x - z, y - z, z * 2, z * 2);
      }
      c.globalAlpha = 1;
    },
  };
}

export function Fronts({ items, at }: { items: readonly FrontIn[]; at: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLCanvasElement>(null);
  // Read every frame, so turning the stage never re-lays the field.
  const atRef = useRef(at);
  atRef.current = at;
  const key = items.map((f) => `${f.id}:${f.change24h ?? "-"}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sp = useMemo(() => spec(items, sheet, atRef), [key]);
  const vz = useViz(cv, sp);
  // With reduced motion the loop only draws on a layout, so a stage picked by hand asks for one.
  useEffect(() => {
    if (reducedMotion()) vz.current?.relayout();
  }, [at, vz]);
  return (
    <>
      <canvas ref={sheet} className="xc-fronts-sheet" aria-hidden="true" />
      <canvas ref={cv} className="wv-cv xc-fronts-cv" aria-hidden="true" />
    </>
  );
}
