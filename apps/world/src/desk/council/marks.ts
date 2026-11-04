/**
 * Each room's sigil as a few strokes (#666), the shapes the Council wore as figures of light on the old Today
 * (confluence/beings.ts), simplified to line marks: drawn glowing onto each can's coat in councilScene.ts, and as the
 * stand-in figures before (or without) WebGL. Stroked in the current strokeStyle, centred on 0,0, radius 1.
 */

type Mark = (c: CanvasRenderingContext2D) => void;

const TAU = Math.PI * 2;
const curve = (c: CanvasRenderingContext2D, f: (a: number) => [number, number], n = 96) => {
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    const [x, y] = f((i / n) * TAU);
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.closePath();
  c.stroke();
};
const circle = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.stroke();
};
const poly = (c: CanvasRenderingContext2D, pts: [number, number][], close = true) => {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  if (close) c.closePath();
  c.stroke();
};

export const MARKS: Record<string, Mark> = {
  // The Foundry: a three-lobed knot.
  foundry: (c) => curve(c, (a) => {
    const r = 0.3 + 0.7 * Math.abs(Math.cos(1.5 * a));
    return [r * Math.cos(a - Math.PI / 2), r * Math.sin(a - Math.PI / 2)];
  }),
  // Relay: the infinity of a line that never closes.
  relay: (c) => curve(c, (a) => {
    const d = 1 + Math.sin(a) ** 2;
    return [Math.cos(a) / d, (Math.sin(a) * Math.cos(a)) / d * 1.1];
  }),
  // The Boiler Room: a gear.
  boiler: (c) => {
    curve(c, (a) => {
      const r = 0.78 + 0.18 * Math.sign(Math.sin(a * 8));
      return [r * Math.cos(a), r * Math.sin(a)];
    }, 160);
    circle(c, 0, 0, 0.3);
  },
  // The Archive: an atom, three orbits.
  archive: (c) => {
    for (let k = 0; k < 3; k++) {
      c.save();
      c.rotate((k * Math.PI) / 3);
      c.beginPath();
      c.ellipse(0, 0, 0.95, 0.36, 0, 0, TAU);
      c.stroke();
      c.restore();
    }
    circle(c, 0, 0, 0.1);
  },
  // The Break Room: three bubbles.
  breakroom: (c) => {
    circle(c, -0.42, 0.3, 0.42);
    circle(c, 0.42, 0.3, 0.42);
    circle(c, 0, -0.4, 0.42);
  },
  // The Spire: a crystal.
  spire: (c) => {
    poly(c, [
      [0, -1],
      [0.42, -0.5],
      [0.36, 0.7],
      [0, 1],
      [-0.36, 0.7],
      [-0.42, -0.5],
    ]);
    poly(c, [
      [0, -1],
      [0, 1],
    ], false);
  },
  // The Exchange: a cube.
  exchange: (c) => {
    const h = (k: number) => [Math.cos((k * Math.PI) / 3 - Math.PI / 2) * 0.95, Math.sin((k * Math.PI) / 3 - Math.PI / 2) * 0.95] as [number, number];
    poly(c, [0, 1, 2, 3, 4, 5].map(h));
    poly(c, [h(5), [0, 0], h(1)], false);
    poly(c, [
      [0, 0],
      h(3),
    ], false);
  },
  // The Green: a cup.
  green: (c) => {
    c.beginPath();
    c.moveTo(-0.62, -0.8);
    c.lineTo(0.62, -0.8);
    c.quadraticCurveTo(0.6, 0.1, 0, 0.2);
    c.quadraticCurveTo(-0.6, 0.1, -0.62, -0.8);
    c.stroke();
    poly(c, [
      [0, 0.2],
      [0, 0.7],
    ], false);
    poly(c, [
      [-0.38, 0.8],
      [0.38, 0.8],
    ], false);
    c.beginPath();
    c.arc(-0.66, -0.45, 0.24, Math.PI / 2, (Math.PI * 3) / 2);
    c.stroke();
    c.beginPath();
    c.arc(0.66, -0.45, 0.24, -Math.PI / 2, Math.PI / 2);
    c.stroke();
  },
  // The Workshop: a spiral.
  workshop: (c) => {
    c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU * 2.4;
      const r = 0.08 + (i / 120) * 0.9;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.stroke();
  },
  // The Studio: a camera, two reels on a body.
  studio: (c) => {
    circle(c, -0.38, -0.5, 0.3);
    circle(c, 0.3, -0.5, 0.3);
    c.strokeRect(-0.7, -0.15, 1.1, 0.75);
    poly(c, [
      [0.4, 0.05],
      [0.9, -0.15],
      [0.9, 0.6],
      [0.4, 0.4],
    ]);
  },
};

/** Draws a room's mark at x,y with radius `r` in `rgb` ("r,g,b"), with a soft glow. */
export function drawMark(c: CanvasRenderingContext2D, id: string, x: number, y: number, r: number, rgb: string, a = 1, width = 1.4) {
  const m = MARKS[id];
  if (!m) return;
  c.save();
  c.translate(x, y);
  c.scale(r, r);
  c.lineWidth = width / r;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.strokeStyle = `rgba(${rgb},${a})`;
  c.shadowColor = `rgba(${rgb},${Math.min(1, a * 0.9)})`;
  c.shadowBlur = r * 0.5;
  m(c);
  c.restore();
}
