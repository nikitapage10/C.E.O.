import { useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { Parts, Poly, TAU, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import "./rooms.css";

/**
 * The Workshop (#225): from a sentence to a thing on the shelf, as a maker's bench on blueprint paper. A style preset
 * and a prompt make a picture from the front and the side, Meshy turns it into a model that spins on the turntable, the
 * Mac slices it, and one tap sends it to the Bambu Lab printer, with its progress and camera. Nothing is connected
 * yet, so the stations wait, the turntable is empty, and nothing ever prints without a tap.
 */

const TEAL = "98,196,192";

const STATIONS = [
  { k: "01", t: "Style", s: "A preset and your prompt", w: "Ready when the rest is" },
  { k: "02", t: "Picture", s: "Front and side, from OpenAI", w: "Waits on the image model" },
  { k: "03", t: "Model", s: "Meshy turns it into 3D", w: "Waits on a Meshy key" },
  { k: "04", t: "Slice", s: "Bambu Studio or OrcaSlicer, on the Mac", w: "Waits on the hub" },
  { k: "05", t: "Print", s: "The Bambu Lab printer, over the LAN", w: "Waits on the printer" },
];

const WAITS: Wait[] = [
  { what: "A Meshy API key", why: "Turns the front and side pictures into a model. Kept on the server." },
  { what: "The printer's serial and LAN access code", why: "So the hub on the Mac can send a sliced file and read back progress and the camera. Kept on the Mac, never here." },
  { what: "The hub on the MacBook", why: "Slices with Bambu Studio or OrcaSlicer, and talks to the printer on your network." },
  { what: "OpenAI for the pictures", why: "One prompt, two views: front and side, in the chosen style." },
];

/** The bench: the stations joined by one thread, and an empty turntable turning slowly on the right. */
function benchSpec(stations: React.RefObject<HTMLOListElement | null>, table: React.RefObject<HTMLDivElement | null>): VizSpec {
  return {
    lay(V) {
      const lis = Array.from(stations.current?.children ?? []) as HTMLElement[];
      const pts = lis.map((li) => {
        const r = V.rel(li.querySelector(".ws-node") ?? li);
        return [r.x + r.w / 2, r.y + r.h / 2] as const;
      });
      const xs: number[] = [];
      const ys: number[] = [];
      pts.forEach(([x, y], i) => {
        if (i) {
          const [px, py] = pts[i - 1]!;
          for (let k = 1; k <= 12; k++) {
            const u = k / 12;
            xs.push(px + (x - px) * u);
            ys.push(py + (y - py) * u + Math.sin(u * Math.PI) * (i % 2 ? 6 : -6));
          }
        } else {
          xs.push(x);
          ys.push(y);
        }
      });
      const tr = table.current ? V.rel(table.current) : null;
      V.s.w = { p: xs.length > 1 ? new Poly().set(xs, ys) : null, P: new Parts(60, 0.1), tr };
    },
    draw(V, c, t, dt) {
      const w = V.s.w as { p: Poly | null; P: Parts; tr: { x: number; y: number; w: number; h: number } | null };
      if (w.p) weave(c, w.p, w.P, { a: 0.55, sp: 0.9, sz: 0.7, v: 22, rgb: TEAL, rgb2: "236,238,243", line: 0.16, dash: [4, 4] }, t, dt);
      const tr = w.tr;
      if (!tr) return;
      const cx = tr.x + tr.w / 2;
      const cy = tr.y + tr.h * 0.62;
      const rx = Math.min(tr.w * 0.36, 150);
      const ry = rx * 0.32;
      c.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        c.strokeStyle = `rgba(${TEAL},${0.32 - k * 0.09})`;
        c.beginPath();
        c.ellipse(cx, cy + k * 7, rx, ry, 0, 0, TAU);
        c.stroke();
      }
      // Ticks around the rim, turning.
      const a0 = t * 0.35;
      for (let i = 0; i < 48; i++) {
        const a = a0 + (i / 48) * TAU;
        const x = cx + Math.cos(a) * rx;
        const y = cy + Math.sin(a) * ry;
        const front = Math.sin(a) > 0;
        c.globalAlpha = front ? 0.7 : 0.25;
        c.fillStyle = `rgb(${TEAL})`;
        c.fillRect(x - 0.7, y - (i % 4 ? 1.5 : 3), 1.4, i % 4 ? 3 : 6);
      }
      c.globalAlpha = 1;
      // A dimension line over the empty plate.
      c.strokeStyle = `rgba(${TEAL},.28)`;
      c.setLineDash([2, 4]);
      c.beginPath();
      c.moveTo(cx, cy - ry - 8);
      c.lineTo(cx, tr.y + 26);
      c.stroke();
      c.setLineDash([]);
    },
  };
}

export function Workshop() {
  const cv = useRef<HTMLCanvasElement>(null);
  const stations = useRef<HTMLOListElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const spec = useMemo(() => benchSpec(stations, table), []);
  useViz(cv, spec);
  return (
    <div className="wv-page rm rm-workshop" data-room="workshop">
      <header className="rm-head">
        <div>
          <p className="wv-eyb">The Workshop · the maker's bench</p>
          <h1 className="wv-h1 desk__title">
            From a sentence <em>to a thing on the shelf.</em>
          </h1>
          <p className="wv-sub">
            Describe something; the Workshop draws it from the front and the side, Meshy makes it a model you can turn, the Mac slices it, and the Bambu Lab printer
            prints it when you tap. Nothing is connected yet.
          </p>
        </div>
        <Keeper page="workshop" />
      </header>

      <section className="ws-bench" aria-label="The pipeline">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <ol className="ws-stations" ref={stations}>
          {STATIONS.map((s) => (
            <li key={s.k}>
              <span className="ws-node" aria-hidden="true">
                {s.k}
              </span>
              <b>{s.t}</b>
              <span>{s.s}</span>
              <em>{s.w}</em>
            </li>
          ))}
        </ol>
        <div className="ws-table" ref={table}>
          <p className="wv-eyb">The turntable</p>
          <p className="ws-table-note">Empty. The model turns here once Meshy is connected.</p>
        </div>
        <div className="ws-bed" aria-label="The print bed: empty">
          <p className="wv-eyb">The print bed</p>
          <div className="ws-plate" aria-hidden="true" />
          <p className="ws-table-note">Nothing prints without your tap.</p>
        </div>
      </section>

      <Waits items={WAITS} className="ws-waits" />
    </div>
  );
}
