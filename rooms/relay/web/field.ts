import { SIGILS } from "@ceo/engine/sigils/sigils.ts";

/**
 * Relay's background field (#950, Nikita 2026-11-06: the mast was "kind of corny"): the whole page behind the Thread,
 * very faint. A wireframe floor in Relay's blue line, laid in perspective to a far horizon like the Senate's grid but
 * much quieter, drifting slowly toward the viewer, and white nanites (dots, and a few of the room's sigils) drifting up
 * through it at three depths, the far ones slow, small and dim. It never competes with the words: everything sits under
 * 8% alpha, and the page masks it down further behind the cards (thread.css, `.cx-field`).
 *
 * Plain 2D canvas, no three.js: about 120 particles and some 40 lines a frame, at most 30 frames a second, at a capped
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
  const motes: Mote[] = Array.from({ length: count }, () => ({ x: rnd(), y: rnd(), z: rnd() ** 1.6, g: rnd() < 0.22 ? Math.floor(rnd() * SIGILS.length) : -1, phase: rnd() * Math.PI * 2 }));
  let W = 0;
  let H = 0;
  let D = 1;

  const floor = (t: number) => {
    // The horizon a little above the middle; the floor below it, in perspective, its rows drifting toward the viewer.
    const hy = H * 0.52;
    const vx = W * 0.58;
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
    // Columns: lines from the vanishing point out to the floor's front edge.
    const COLS = opts.phone ? 14 : 26;
    for (let j = -COLS; j <= COLS; j++) {
      const fx = vx + (j / COLS) * W * 1.6;
      const g = c.createLinearGradient(vx, hy, fx, H);
      g.addColorStop(0, `rgba(${LINE}, 0)`);
      g.addColorStop(1, `rgba(${LINE}, ${0.045 * (1 - Math.abs(j / COLS) * 0.5)})`);
      c.strokeStyle = g;
      c.beginPath();
      c.moveTo(vx, hy);
      c.lineTo(fx, H);
      c.stroke();
    }
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

  const nanites = (t: number) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
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
        c.font = `${Math.round((6 + m.z * 5) * D) / D}px "Geist Mono Variable", ui-monospace, monospace`;
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
    },
    frame(t) {
      if (!W || !H) return;
      c.clearRect(0, 0, W, H);
      floor(t);
      nanites(t);
    },
  };
}
