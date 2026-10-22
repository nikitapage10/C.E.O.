import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BANNERS } from "./RoomBanner.tsx";
import type { FlowId, Fitting, GState, PipeRow } from "./systemsGraph.ts";
import { reducedMotion } from "./wvCanvas.ts";

/**
 * The Boiler Room's pipe rack (#241): every room that has connections gets one straight pipe, left to right in its
 * room's colour, with each connection a fitting along it in the order the data flows (systemsGraph.ts, pipeRows). The
 * room's keeper sits on the pipe where its own work happens: what feeds the room comes before, what it feeds comes
 * after. Live pipes carry a flow, running ones a brighter one, and a pipe not connected yet is dashed with a hollow
 * valve. Nothing crosses. Tapping a pipe flows it open, then hands over to the room's whole flow (SystemsGraph.tsx).
 * On a phone each pipe turns to run down the page.
 */

const WORD: Record<GState, string> = { ok: "steady", run: "running now", wait: "not connected yet", bad: "down" };
const STATE: Record<GState, string> = { ok: "live", run: "running now", wait: "not connected yet", bad: "down" };

/** The room for each fitting that feeds a room, left of the keeper; half the keeper's place; the pipe's capped end. */
const SLOT = 96;
const HUB = 34;
const END = 14;
/** How long the tapped pipe takes to flow open before its room's flow takes over. */
const OPEN_MS = 760;

/** Where the i-th of n fittings after the keeper sits along the pipe, and the i-th of n before it. */
const outX = (hub: number, i: number, n: number) => `(${hub}px + (100% - ${hub + END}px) * ${((i + 1) / (n + 0.5)).toFixed(4)})`;
const inX = (slots: number, i: number, n: number) => `${(slots - n + i + 0.5) * SLOT}px`;

export function PipeRack({ rows, onOpen }: { rows: PipeRow[]; onOpen: (id: FlowId) => void }) {
  const slots = Math.max(1, ...rows.map((r) => r.ins.length));
  const hub = slots * SLOT + HUB;
  const [hot, setHot] = useState<string | null>(null);
  const [opening, setOpening] = useState<FlowId | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = (id: FlowId) => {
    if (opening) return;
    if (reducedMotion()) return onOpen(id);
    setOpening(id);
    timer.current = window.setTimeout(() => onOpen(id), OPEN_MS);
  };

  return (
    <div className={`pr-rack${opening ? " is-opening" : ""}${hot ? " has-hot" : ""}`} style={{ "--hub": `${hub}px` } as CSSProperties} onMouseLeave={() => setHot(null)}>
      {rows.map((r) => {
        // Each piece of pipe flows open a beat after the one before it.
        let beat = 0;
        const fitting = (f: Fitting, x: string, a: string, b: string, w: string) => (
          <div
            key={`${f.side}-${f.id}`}
            className={`pr-fit is-${f.state} k-${f.k}${hot === f.id ? " is-twin" : ""}${f.id === "lattice" ? " is-outlet" : ""}`}
            data-node={f.id}
            style={{ "--x": `calc(${x})`, "--a": `calc(${a})`, "--b": `calc(${b})`, "--w": w, "--d": `${beat++ * 55}ms` } as CSSProperties}
            onMouseEnter={() => setHot(f.id)}
            title={`${f.l}, ${f.s}: ${STATE[f.state]}`}
          >
            <i className="pr-seg" />
            <span className="pr-v" />
            <span className="pr-l">
              <b>{f.l}</b>
              <small>{f.s}</small>
            </span>
          </div>
        );
        const n = r.outs.length;
        const outW = `min(170px, calc((100% - ${hub + END}px) / ${n + 0.5} - 12px))`;
        const last = n ? outX(hub, n - 1, n) : `${hub}px`;
        const ins = r.ins.map((f, i) => fitting(f, inX(slots, i, r.ins.length), inX(slots, i, r.ins.length), i + 1 < r.ins.length ? inX(slots, i + 1, r.ins.length) : `${hub}px`, `${SLOT - 10}px`));
        const hubBeat = beat++;
        const outs = r.outs.map((f, i) => fitting(f, outX(hub, i, n), i ? outX(hub, i - 1, n) : `${hub}px`, outX(hub, i, n), outW));
        return (
          <div key={r.id} className={`pr-row is-${r.stc}${opening === r.id ? " is-open" : ""}`} data-room={r.room} data-pipe={r.id} onClick={() => open(r.id)}>
            <button
              type="button"
              className="pr-head"
              onClick={(e) => {
                e.stopPropagation();
                open(r.id);
              }}
              aria-label={`${r.name}, ${WORD[r.stc]}: open its whole flow, ${r.steps} steps`}
            >
              <b>{r.name}</b>
              <span className="pr-sub">{r.sub}</span>
              <span className={`pr-st is-${r.stc}`}>
                <i />
                {WORD[r.stc]}
              </span>
              <em>
                {r.steps} steps
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" />
                </svg>
              </em>
            </button>
            <div className="pr-line" aria-hidden="true">
              {ins}
              <div className="pr-hub" style={{ "--d": `${hubBeat * 55}ms` } as CSSProperties}>
                <img src={`/desk/agent-${BANNERS[r.id].voice.id}.webp`} alt="" decoding="async" />
              </div>
              {outs}
              <i className={`pr-cap is-${r.outs[n - 1]?.state ?? r.stc}`} style={{ "--a": `calc(${last})`, "--d": `${beat * 55}ms` } as CSSProperties} />
            </div>
          </div>
        );
      })}
      <p className="pr-foot">Each pipe is a room; each fitting on it is a real connection, in the order the data flows. Dashed ones aren't connected yet. Tap a pipe to see its whole flow.</p>
    </div>
  );
}
