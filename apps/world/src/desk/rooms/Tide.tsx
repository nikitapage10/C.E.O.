import { useMemo, useRef } from "react";
import { Waits, type Wait } from "./parts.tsx";
import { Parts, Poly, TAU, useViz, weave, type VizSpec } from "../wvCanvas.ts";

/**
 * The Tide in the Archive (#225): Nikita's D&D world. Once it's connected: the active campaign, the next session and
 * the storyline's thread, then the people and factions, the maps, the pictures and the session notes, with a way to the
 * Tide's own website. Until then the chart is blank and the page says what it waits on; no campaign is made up here.
 */

const VIOLET = "168,144,226";
const GILT = "214,188,114";

const LEAVES = [
  { t: "The campaign", s: "Which one is running, and where the party stands" },
  { t: "Next session", s: "When, who's coming, and what to prepare" },
  { t: "The storyline", s: "The thread so far, session by session" },
];

const CHAPTERS = ["People and factions", "Maps", "Pictures", "Session notes"];

const WAITS: Wait[] = [
  { what: "The Tide's website", why: "Its address, and a read-only feed of the campaign, the sessions and the storyline." },
  { what: "Private pictures, in Azure Blob", why: "Maps and art the party shouldn't see yet, shown only when you're signed in." },
];

/** A blank sea chart: tide lines drifting across it, gilt motes riding them. */
function chartSpec(): VizSpec {
  return {
    lay(V) {
      const lines = Array.from({ length: 7 }, (_, i) => {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k <= 40; k++) {
          xs.push((k / 40) * V.W);
          ys.push(0);
        }
        return { i, xs, ys, p: new Poly(), P: new Parts(i === 3 ? 34 : 12, 0.2) };
      });
      V.s.c = { lines };
    },
    draw(V, c, t, dt) {
      const { lines } = V.s.c as { lines: { i: number; xs: number[]; ys: number[]; p: Poly; P: Parts }[] };
      for (const l of lines) {
        const base = V.H * (0.16 + l.i * 0.115);
        for (let k = 0; k <= 40; k++) {
          const u = k / 40;
          l.ys[k] = base + Math.sin(u * TAU * 1.2 + t * 0.25 + l.i * 0.9) * 9 + Math.sin(u * TAU * 3.1 - t * 0.4 + l.i) * 3;
        }
        l.p.set(l.xs, l.ys);
        weave(c, l.p, l.P, { a: l.i === 3 ? 0.6 : 0.3, sp: 0.6, sz: 0.6, v: 8 + l.i, rgb: l.i === 3 ? GILT : VIOLET, rgb2: GILT, line: l.i === 3 ? 0.2 : 0.08 }, t, dt);
      }
      // The compass rose, faint, in the corner.
      const cx = V.W - 54;
      const cy = 50;
      c.strokeStyle = `rgba(${GILT},.3)`;
      c.lineWidth = 0.8;
      c.beginPath();
      c.arc(cx, cy, 22, 0, TAU);
      c.stroke();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU - Math.PI / 2;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
        c.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
        c.stroke();
      }
    },
  };
}

export function Tide() {
  const cv = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(chartSpec, []);
  useViz(cv, spec);
  return (
    <section className="ar-tide" aria-label="The Tide">
      <div className="ar-tide-head">
        <p className="wv-eyb">The Tide · the campaign</p>
        <h2 className="wv-h2">
          <span className="ar-initial" aria-hidden="true">
            T
          </span>
          <span className="wv-sr">T</span>he chart is blank until the Tide is connected.
        </h2>
        <p className="wv-sub">
          Your D&amp;D world lives here too: the campaign that's running, the next session and the story so far, with its people, maps and pictures. The Historian keeps a
          shelf ready for it.
        </p>
      </div>
      <div className="ar-chart">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <ul className="ar-leaves">
          {LEAVES.map((l) => (
            <li key={l.t}>
              <b>{l.t}</b>
              <span>{l.s}</span>
              <em>Not connected yet</em>
            </li>
          ))}
        </ul>
      </div>
      <div className="ar-tide-foot">
        <ul className="ar-chapters" aria-label="Chapters to come">
          {CHAPTERS.map((c, i) => (
            <li key={c}>
              <i>{["I", "II", "III", "IV"][i]}</i>
              {c}
            </li>
          ))}
        </ul>
        <span className="ar-site" aria-disabled="true">
          The Tide's website <small>not linked yet</small>
        </span>
      </div>
      <Waits items={WAITS} title="What the Tide waits on" className="ar-waits" />
    </section>
  );
}
