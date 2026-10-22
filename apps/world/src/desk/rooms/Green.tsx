import { useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { Parts, Poly, TAU, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import "./rooms.css";

/**
 * The Green (#225): the fantasy league, as a floodlit pitch at night. First the matchup on the scoreboard with a win
 * chance, the lineup with start-or-sit calls, and the best waiver pickups; below, standings, trades, injuries and the
 * season. Nothing is connected yet: the scoreboard is dark and every card shows its back. Read-only at first; tapping a
 * pickup opens Sleeper.
 */

const TURF = "172,200,114";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

const WAITS: Wait[] = [
  { what: "Your Sleeper username or league ID", why: "Sleeper's API is public and read-only, so no key: just which league is yours." },
  { what: "A FantasyPros API key", why: "Rankings and start-or-sit advice. Requested; it stays on the server.", state: "asked" },
  { what: "OpenAI for the weekly take", why: "The Commentator's preview of the matchup, written once a week." },
];

const LATER = ["Standings", "Trades on the table", "Injuries", "The season, week by week"];

/** The pitch: yard lines as threads under two floodlights, motes drifting in the light. */
function pitchSpec(): VizSpec {
  return {
    lay(V) {
      const lines: { p: Poly; P: Parts }[] = [];
      const n = 11;
      for (let i = 0; i < n; i++) {
        const x = (V.W * (i + 0.5)) / n;
        const lean = (x - V.W / 2) * 0.18;
        lines.push({ p: new Poly().set([x - lean, x + lean * 0.4], [0, V.H]), P: new Parts(i === 5 ? 40 : 12, 0.1) });
      }
      V.s.g = { lines };
    },
    draw(V, c, t, dt) {
      const { lines } = V.s.g as { lines: { p: Poly; P: Parts }[] };
      // Floodlights from the two top corners.
      for (const [x, s] of [
        [V.W * 0.08, 1],
        [V.W * 0.92, -1],
      ] as const) {
        const g = c.createRadialGradient(x, -20, 0, x, -20, V.H * 1.3);
        g.addColorStop(0, "rgba(236,240,220,.16)");
        g.addColorStop(0.5, "rgba(172,200,114,.05)");
        g.addColorStop(1, "rgba(172,200,114,0)");
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x, -20);
        c.lineTo(x + s * V.W * 0.62, V.H);
        c.lineTo(x + s * V.W * 0.08, V.H);
        c.closePath();
        c.globalAlpha = 0.8 + 0.2 * Math.sin(t * 0.6 + s);
        c.fill();
        c.globalAlpha = 1;
      }
      lines.forEach((l, i) => weave(c, l.p, l.P, { a: i === 5 ? 0.6 : 0.3, sp: 0.5, sz: 0.6, v: 6 + (i % 3) * 3, rgb: TURF, rgb2: "236,240,220", line: i === 5 ? 0.22 : 0.09 }, t, dt));
      // The centre circle.
      c.strokeStyle = `rgba(${TURF},.16)`;
      c.lineWidth = 0.8;
      c.beginPath();
      c.ellipse(V.W / 2, V.H * 0.55, V.W * 0.08, V.H * 0.2, 0, 0, TAU);
      c.stroke();
    },
  };
}

export function Green() {
  const cv = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(pitchSpec, []);
  useViz(cv, spec);
  return (
    <div className="wv-page rm rm-green" data-room="green">
      <header className="rm-head gr-head">
        <div>
          <p className="wv-eyb">The Green · under the floodlights</p>
          <h1 className="wv-h1 desk__title">
            No kickoff until <em>the league's on the board.</em>
          </h1>
          <p className="wv-sub">
            The Green will run your Sleeper league: this week's matchup and your chance of winning it, who to start and who to sit, and the pickups worth a waiver claim.
            Nothing is connected yet, so the board is dark.
          </p>
        </div>
        <Keeper page="green" />
      </header>

      <section className="gr-pitch" aria-label="This week's matchup">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <div className="gr-board" role="img" aria-label="Scoreboard: no matchup yet">
          <div className="gr-side">
            <span>You</span>
            <b>--</b>
          </div>
          <div className="gr-mid">
            <span>Week</span>
            <b>--</b>
            <em>Win chance --%</em>
          </div>
          <div className="gr-side">
            <span>Them</span>
            <b>--</b>
          </div>
        </div>
        <p className="gr-pitch-note">The scoreboard lights up when Sleeper is connected.</p>
      </section>

      <section className="gr-lineup" aria-label="Your lineup">
        <div className="wv-sechead">
          <div>
            <p className="wv-eyb">Start or sit</p>
            <h2 className="wv-h2">The lineup, face down</h2>
          </div>
          <p className="wv-note">Each card turns over to its player, with a start or sit call and why.</p>
        </div>
        <ul>
          {SLOTS.map((s, i) => (
            <li key={i} tabIndex={0} aria-label={`${s}: no player yet`}>
              <span className="gr-card">
                <span className="gr-front">
                  <b>{s}</b>
                  <i aria-hidden="true" />
                </span>
                <span className="gr-back">Waiting on Sleeper</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="gr-row">
        <section className="gr-wire" aria-label="Waiver pickups">
          <p className="wv-eyb">On the waiver wire</p>
          <h2 className="rm-h2">The pickups worth a claim</h2>
          <p className="wv-note">The top few free agents for your roster, ranked. Tapping one opens Sleeper to make the claim; the Desk never makes moves for you.</p>
          <p className="gr-later-k">Further down, once it's live</p>
          <ul className="gr-later">
            {LATER.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
        <Waits items={WAITS} className="gr-waits" />
      </div>
    </div>
  );
}
