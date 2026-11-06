import { SIGILS } from "@ceo/engine/sigils/sigils.ts";

/**
 * Relay's background field (#950, Nikita 2026-11-06: the mast was "kind of corny"): the whole page behind the Thread,
 * very faint. A wireframe floor in Relay's blue line, laid in perspective to a far horizon like the Senate's grid but
 * much quieter, drifting slowly toward the viewer, and white nanites (dots, and a few of the room's sigils) drifting up
 * through it at three depths, the far ones slow, small and dim. It never competes with the words: everything sits under
 * 8% alpha, and the page masks it down further behind the cards (thread.css, `.cx-field`).
 *
 * Plain 2D canvas, no three.js: about 120 particles and some 40 lines a frame, at most 24 frames a second, at a capped
 * pixel ratio. The component (./RelayField.tsx) pauses it while Relay is kept out of sight (#934), the tab is hidden
 * or the page is scrolled away, and draws one still frame under reduced motion.
 */

export interface Field {
  /** Draws one frame at `t` seconds. */
  frame(t: number): void;
  resize(w: number, h: number, dpr: number): void;
}

interface Mote {
  x: number;
  y: number;
  /** Depth 0 (far) to 1 (near). */
  z: number;
  /** A sigil (index into SIGILS), or -1 for a plain dot. */
  g: number;
  phase: number;
}

/** Relay's light: thread.css --cx-blue and the white of its nanites. */
const LINE = "134, 182, 255";
const WHITE = "238, 242, 255";

/** A small seeded random, so the field is the same every load (and in screenshots). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createField(cv: HTMLCanvasElement, opts: { phone: boolean }): Field | null {
  const c = cv.getContext("2d");
  if (!c) return null;
  const rnd = rng(950);
  const count = opts.phone ? 60 : 120;
  const motes: Mote[] = Array.from({ length: count }, () => ({ x: rnd(), y: rnd(), z: rnd() ** 1.6, g: rnd() < 0.22 ? Math.floor(rnd() * SIGILS.length) : -1, phase: rnd() * Math.PI * 2 })).sort((a, b) => Math.round(a.z * 2) - Math.round(b.z * 2));
  let W = 0;
  let H = 0;
  let D = 1;
  let cols: HTMLCanvasElement | null = null;

  const floor = (t: number) => {
    // The horizon a little above the middle; the floor below it, in perspective, its rows drifting toward the viewer.
    const hy = H * 0.52;
    const depth = H - hy;
    c.lineWidth = 1;
    // Rows: spaced by 1/z, so they crowd toward the horizon.
    const ROWS = 16;
    const drift = (t * 0.035) % 1;
    for (let i = 0; i < ROWS; i++) {
      const k = (i + drift) / ROWS;
      const y = hy + depth * k * k;
      const a = 0.012 + 0.05 * k * k;
      c.strokeStyle = `rgba(${LINE}, ${a})`;
      c.beginPath();
      c.moveTo(0, Math.round(y) + 0.5);
      c.lineTo(W, Math.round(y) + 0.5);
      c.stroke();
    }
    // Columns: lines from the vanishing point out to the floor's front edge. They never move, so they are drawn once
    // per size onto their own canvas (`cols`) and only copied here: a gradient per line per frame is costly on a
    // software renderer.
    if (cols) c.drawImage(cols, 0, 0, W, H);
    // A faint ceiling: the same rows mirrored above, dimmer, so the field has depth both ways.
    for (let i = 0; i < 8; i++) {
      const k = (i + drift) / 8;
      const y = hy - hy * 0.9 * k * k;
      c.strokeStyle = `rgba(${LINE}, ${0.008 + 0.022 * k * k})`;
      c.beginPath();
      c.moveTo(0, Math.round(y) + 0.5);
      c.lineTo(W, Math.round(y) + 0.5);
      c.stroke();
    }
  };

  const drawCols = () => {
    if (typeof document === "undefined") return null;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(W * D));
    off.height = Math.max(1, Math.round(H * D));
    const o = off.getContext("2d");
    if (!o) return null;
    o.setTransform(D, 0, 0, D, 0, 0);
    const hy = H * 0.52;
    const vx = W * 0.58;
    const COLS = opts.phone ? 14 : 26;
    o.lineWidth = 1;
    for (let j = -COLS; j <= COLS; j++) {
      const fx = vx + (j / COLS) * W * 1.6;
      const g = o.createLinearGradient(vx, hy, fx, H);
      g.addColorStop(0, `rgba(${LINE}, 0)`);
      g.addColorStop(1, `rgba(${LINE}, ${0.045 * (1 - Math.abs(j / COLS) * 0.5)})`);
      o.strokeStyle = g;
      o.beginPath();
      o.moveTo(vx, hy);
      o.lineTo(fx, H);
      o.stroke();
    }
    return off;
  };

  const nanites = (t: number) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    let font = "";
    for (const m of motes) {
      // Up and a little sideways, the near ones faster: parallax.
      const speed = 0.004 + m.z * 0.014;
      const y = (((m.y - t * speed) % 1) + 1) % 1;
      const x = m.x + Math.sin(t * 0.2 + m.phase) * 0.004 * (0.4 + m.z);
      const px = x * W;
      const py = y * H;
      // Fade in at the bottom and out at the top, and twinkle a little.
      const edge = Math.min(1, y * 6, (1 - y) * 6);
      const a = (0.05 + 0.2 * m.z) * edge * (0.75 + 0.25 * Math.sin(t * 1.3 + m.phase));
      if (a < 0.01) continue;
      c.fillStyle = `rgba(${WHITE}, ${a.toFixed(3)})`;
      if (m.g >= 0) {
        // Three sizes only (the motes are sorted by them), so the font is set a few times a frame, not per glyph.
        const f = `${6 + Math.round(m.z * 2) * 2.5}px "Geist Mono Variable", ui-monospace, monospace`;
        if (f !== font) c.font = font = f;
        c.fillText(SIGILS[m.g]!, px, py);
      } else {
        const r = 0.5 + m.z * 0.9;
        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  };

  return {
    resize(w, h, dpr) {
      W = w;
      H = h;
      D = dpr;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = drawCols();
    },
    frame(t) {
      if (!W || !H) return;
      c.clearRect(0, 0, W, H);
      floor(t);
      nanites(t);
    },
  };
}
