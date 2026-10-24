import { clamp, isPhone, RC, ring, spr, TAU, WHITE, type VizSpec } from "./wvCanvas.ts";

/**
 * The Book of Hours (#388): the week in Ilyr as a codex page, seven columns of days and twenty-four rows of hours. Every
 * hour the Historian wrote is a little swarm of ink motes drifting in its cell, one mote for each line the cast spoke
 * that hour (capped), so a busy hour is visibly fuller than a quiet one; an hour that shipped work carries a bright
 * core; hours not written are a single faint point and hours still to come are fainter still. Shapes only: every value
 * comes from the world's own pages.
 *
 * Kept cheap on purpose (Nikita, "the desk is still kind of laggy"): the grid, the points and the shown day's wash are
 * painted once per layout into an offscreen layer, and each frame only blits that layer and moves the motes, a fixed
 * pool capped by screen size. Nothing here reads the layout during a frame or re-renders React.
 */

/** One hour of the week, as the Book draws it. */
export interface HourCell {
  /** Lines spoken that hour, across its scenes. */
  lines: number;
  /** Changes the builders shipped that hour. */
  ships: number;
  written: boolean;
  /** Still to come. */
  future: boolean;
}

/** What the Book reads every frame without a re-render: the cell under the pointer, and where the reading is. */
export interface BookLive {
  hover: number;
  /** Today's written cells in order, and how far along them Skippy's reading is (0..1) while it plays. */
  read: number[];
  pr: number;
  on: boolean;
}

const VIOLET = RC.archive!;
/** The most motes a page carries: a laptop draws these at ease, a phone fewer. */
const MAX_MOTES = 1100;
const MAX_MOTES_PHONE = 480;

export function bookSpec(cells: HourCell[], shownCol: number, nowIdx: number, live: { current: BookLive }): VizSpec {
  let cw = 0;
  let ch = 0;
  let layer: HTMLCanvasElement | null = null;
  // The mote pool: cell, frequencies, phases, radii, size, depth, and whether it's a pale (white) mote.
  let N = 0;
  let cell = new Uint8Array(0);
  let fa = new Float32Array(0);
  let fb = new Float32Array(0);
  let pa = new Float32Array(0);
  let pb = new Float32Array(0);
  let rx = new Float32Array(0);
  let ry = new Float32Array(0);
  let sz = new Float32Array(0);
  let z = new Float32Array(0);
  let pale = new Uint8Array(0);
  const ships: number[] = [];
  const cx = (i: number) => (Math.floor(i / 24) + 0.5) * cw;
  const cy = (i: number) => ((i % 24) + 0.5) * ch;

  return {
    scale: (W, H, dpr) => (W * H > 600_000 ? Math.min(dpr, 1.5) : dpr),
    lay(V) {
      cw = V.W / 7;
      ch = V.H / 24;
      // The still layer: the shown day's wash, the column rules, the quarter-day guides, and a point per unwritten hour.
      layer ??= document.createElement("canvas");
      layer.width = Math.round(V.W * V.dpr);
      layer.height = Math.round(V.H * V.dpr);
      const g = layer.getContext("2d")!;
      g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      g.clearRect(0, 0, V.W, V.H);
      if (shownCol >= 0) {
        const gr = g.createLinearGradient(0, 0, 0, V.H);
        gr.addColorStop(0, `rgba(${VIOLET},.11)`);
        gr.addColorStop(0.5, `rgba(${VIOLET},.05)`);
        gr.addColorStop(1, `rgba(${VIOLET},.11)`);
        g.fillStyle = gr;
        g.fillRect(shownCol * cw + 1, 0, cw - 2, V.H);
      }
      g.fillStyle = "rgba(236,238,243,.055)";
      for (let d = 1; d < 7; d++) g.fillRect(Math.round(d * cw), 0, 1, V.H);
      g.fillStyle = "rgba(236,238,243,.04)";
      for (const h of [6, 12, 18]) g.fillRect(0, Math.round(h * ch), V.W, 1);
      // A written hour's ink has bled a little into the page: a soft bloom, fuller the more was said.
      const bloom = spr(VIOLET);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        if (!c.written) continue;
        const r = Math.min(cw * 0.62, ch * 1.5);
        g.globalAlpha = 0.1 + 0.22 * Math.min(1, c.lines / 12) + (Math.floor(i / 24) === shownCol ? 0.08 : 0);
        g.drawImage(bloom, cx(i) - r, cy(i) - r * 0.62, r * 2, r * 1.24);
      }
      g.globalAlpha = 1;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        if (c.written) continue;
        g.fillStyle = c.future ? "rgba(236,238,243,.07)" : "rgba(236,238,243,.22)";
        g.fillRect(cx(i) - 0.7, cy(i) - 0.7, 1.4, 1.4);
      }

      // The motes: one per line spoken (at least four, at most fourteen a cell), thinned evenly to the page's cap.
      const want = cells.map((c) => (c.written ? clamp(3 + c.lines, 4, 14) : 0));
      const total = want.reduce((a, b) => a + b, 0);
      const cap = isPhone(V.cv) ? MAX_MOTES_PHONE : MAX_MOTES;
      const f = total > cap ? cap / total : 1;
      const per = want.map((n) => (n ? Math.max(2, Math.floor(n * f)) : 0));
      N = per.reduce((a, b) => a + b, 0);
      cell = new Uint8Array(N);
      fa = new Float32Array(N);
      fb = new Float32Array(N);
      pa = new Float32Array(N);
      pb = new Float32Array(N);
      rx = new Float32Array(N);
      ry = new Float32Array(N);
      sz = new Float32Array(N);
      z = new Float32Array(N);
      pale = new Uint8Array(N);
      let k = 0;
      per.forEach((n, i) => {
        for (let j = 0; j < n; j++, k++) {
          cell[k] = i;
          fa[k] = 0.16 + Math.random() * 0.32;
          fb[k] = 0.12 + Math.random() * 0.3;
          pa[k] = Math.random() * TAU;
          pb[k] = Math.random() * TAU;
          rx[k] = cw * 0.38 * (0.25 + 0.75 * Math.random());
          ry[k] = ch * 0.34 * (0.3 + 0.7 * Math.random());
          const d = Math.random();
          z[k] = d * d;
          sz[k] = 0.75 + z[k]! * 1.5;
          pale[k] = Math.random() < 0.22 ? 1 : 0;
        }
      });
      ships.length = 0;
      cells.forEach((c, i) => c.ships > 0 && ships.push(i));
    },
    draw(V, c, t) {
      if (layer) c.drawImage(layer, 0, 0, V.W, V.H);
      const L = live.current;
      const hover = L.hover;
      // While the reading plays, today's hours light in order up to where Skippy is.
      const readTo = L.on && L.read.length ? Math.floor(L.pr * L.read.length) : -1;
      const reading = readTo >= 0 ? L.read[Math.min(readTo, L.read.length - 1)]! : -1;
      const sv = spr(VIOLET);
      const sw = spr(WHITE);
      const scale = Math.min(2.4, Math.max(1.2, ch / 12));
      for (let k = 0; k < N; k++) {
        const i = cell[k]!;
        const col = Math.floor(i / 24);
        let I = col === shownCol ? 0.9 : 0.58;
        let grow = 1;
        if (i === hover) {
          I = 1.35;
          grow = 1.35;
        }
        if (readTo >= 0 && col === shownCol) {
          const at = L.read.indexOf(i);
          if (at >= 0 && at <= readTo) I = Math.max(I, 1.1);
          if (i === reading) {
            I = 1.5;
            grow = 1.45;
          }
        }
        const x = cx(i) + Math.sin(t * fa[k]! + pa[k]!) * rx[k]! * grow;
        const y = cy(i) + Math.sin(t * fb[k]! + pb[k]!) * ry[k]! * grow;
        const a = I * (0.45 + 0.55 * z[k]!);
        const s = sz[k]! * scale * (i === hover ? 1.2 : 1);
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(pale[k] ? sw : sv, x - s, y - s, s * 2, s * 2);
      }
      // A change shipped: a bright core in its hour, breathing slowly.
      for (const i of ships) {
        const b = 0.75 + 0.25 * Math.sin(t * 1.3 + i);
        const r = Math.min(cw, ch * 2.2) * 0.42 * b;
        c.globalAlpha = 0.55;
        c.drawImage(sv, cx(i) - r, cy(i) - r, r * 2, r * 2);
        c.globalAlpha = 0.95;
        c.drawImage(sw, cx(i) - 2.6, cy(i) - 2.6, 5.2, 5.2);
      }
      c.globalAlpha = 1;
      if (nowIdx >= 0) ring(c, cx(nowIdx), cy(nowIdx), Math.min(cw, ch * 1.6) * (0.36 + 0.05 * Math.sin(t * 2)), VIOLET, 0.55);
      if (hover >= 0 && hover !== nowIdx) ring(c, cx(hover), cy(hover), Math.min(cw, ch * 1.6) * 0.44, WHITE, 0.3);
    },
  };
}
