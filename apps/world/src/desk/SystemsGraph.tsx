import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BAD, bez, eOut, knot, Parts, Poly, RC, reducedMotion, RUN, TAU, weave, WHITE, useViz, type VizSpec } from "./wvCanvas.ts";
import { GH, GL, type Flow, type FlowId, type GEdge, type GNode, type GState } from "./systemsGraph.ts";

/**
 * One room's whole flow in the Weave (85-graph.js), opened from its pipe on the rack (PipeRack.tsx): every part as a
 * node on a spring and every connection as a thread of light in the room's colour, dashed while it isn't connected
 * yet, with a panel of every step: what travels, how it signs in, how often. The model is systemsGraph.ts.
 */

const BRASS = "198,150,84";

const ROOM_NAME: Record<string, string> = { foundry: "Foundry", boiler: "Boiler Room", archive: "Archive", relay: "Relay", exchange: "Exchange", green: "Green" };
const STATE_WORD: Record<GState, string> = { ok: "Working", run: "Running now", wait: "Not connected yet", bad: "Down" };

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  on: boolean;
  tr: string;
}

interface Live {
  e: GEdge;
  i: number;
  al: number;
  aT: number;
  poly: Poly;
  xs: number[];
  ys: number[];
  P: Parts;
  ctr: string;
  /** How far the thread has flowed out from its first node, 0 to 1: a new connection runs along its pipe. */
  gr: number;
}

export function SystemsGraph({ nodes, flows, mode, setMode }: { nodes: Record<string, GNode>; flows: Record<FlowId, Flow>; mode: FlowId; setMode: (m: "overview" | FlowId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [phone, setPhone] = useState(false);
  const [sel, setSel] = useState<{ edge?: number; node?: string } | null>(null);
  const edges = flows[mode].edges;
  const lay = GL[phone ? "p" : "d"][mode];
  const shown = Object.keys(lay).filter((id) => nodes[id]);
  // The engine's state: positions on springs, live threads (fading out the old ones), and what is selected.
  const st = useRef({ pos: {} as Record<string, Pos>, live: [] as Live[], old: [] as Live[], sel: null as typeof sel, lastW: 0, mode: "", spawn: null as string | null });
  st.current.sel = sel;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPhone(el.clientWidth < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setSel(null);
  }, [mode]);

  // A new mode (or new states) re-weaves: the old threads fade, the new ones grow from the room's node.
  const sig = `${mode}|${edges.map((e) => `${e.a}${e.b}${e.state}`).join()}`;
  useEffect(() => {
    const S = st.current;
    const changedMode = S.mode !== mode;
    if (changedMode) {
      S.spawn = flows[mode].room;
      for (const l of S.live) {
        l.aT = 0;
        S.old.push(l);
      }
      S.live = [];
    }
    const prev = new Map(S.live.map((l) => [`${l.e.a}>${l.e.b}`, l]));
    S.live = edges.map((e, i) => {
      const had = prev.get(`${e.a}>${e.b}`);
      if (had && had.e.state === e.state) return { ...had, e, i };
      const gr = had ? 1 : 0;
      const n = e.state === "wait" ? 18 : e.state === "run" ? 120 : 80;
      return { e, i, al: had?.al ?? 0, aT: 1, poly: new Poly(), xs: new Array<number>(32), ys: new Array<number>(32), P: new Parts(n, 0.12), ctr: "", gr };
    });
    S.mode = mode;
    vz.current?.relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const spec = useMemo<VizSpec>(() => {
    const place = (W: number, H: number, snap: boolean) => {
      const S = st.current;
      const L = GL[W < 640 ? "p" : "d"][(S.mode || "foundry") as FlowId];
      if (!S.lastW || Math.abs(W - S.lastW) > 2) snap = true;
      S.lastW = W;
      const spawn = S.spawn ? S.pos[S.spawn] : null;
      for (const id of Object.keys(nodes)) {
        const p = L[id];
        const n = (S.pos[id] ??= { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, on: false, tr: "" });
        if (p) {
          n.tx = p[0] * W;
          n.ty = p[1] * H;
          if (!n.on || snap) {
            if (snap || !spawn?.on) {
              n.x = n.tx;
              n.y = n.ty;
            } else {
              n.x = spawn.x + (Math.random() - 0.5) * 40;
              n.y = spawn.y + (Math.random() - 0.5) * 40;
            }
            n.vx = n.vy = 0;
          }
          n.on = true;
        } else n.on = false;
      }
    };
    const curve = (l: Live) => {
      const S = st.current;
      const A = S.pos[l.e.a];
      const B = S.pos[l.e.b];
      if (!A || !B) return false;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      if (Math.abs(dx) >= Math.abs(dy) * 0.8) bez(A.x, A.y, A.x + dx * 0.5, A.y, B.x - dx * 0.5, B.y, B.x, B.y, 32, l.xs, l.ys);
      else bez(A.x, A.y, A.x, A.y + dy * 0.5, B.x, B.y - dy * 0.5, B.x, B.y, 32, l.xs, l.ys);
      if (l.gr < 1) {
        const m = Math.max(2, Math.ceil(32 * eOut(l.gr)));
        l.poly.set(l.xs.slice(0, m), l.ys.slice(0, m));
      } else l.poly.set(l.xs, l.ys);
      return true;
    };
    return {
      lay(V) {
        place(V.W, V.H, false);
      },
      draw(V, c, t, dt) {
        const S = st.current;
        const rm = reducedMotion();
        const box = host.current;
        if (!box) return;
        // Nodes: springs toward their places.
        const k = 90;
        const cc = 2 * Math.sqrt(k) * 0.9;
        for (const [id, n] of Object.entries(S.pos)) {
          if (!n.on) continue;
          if (rm || !dt) {
            n.x = n.tx;
            n.y = n.ty;
          } else {
            n.vx += (k * (n.tx - n.x) - cc * n.vx) * dt;
            n.vy += (k * (n.ty - n.y) - cc * n.vy) * dt;
            n.x += n.vx * dt;
            n.y += n.vy * dt;
          }
          const el = box.querySelector<HTMLElement>(`.wv-gn[data-node="${id}"]`);
          if (!el) continue;
          const off = el.classList.contains("is-room") ? 15 : el.classList.contains("has-pf") ? 6 : 8;
          const tr = `translate(${n.x.toFixed(1)}px,${(n.y - off).toFixed(1)}px) translateX(-50%)`;
          if (tr !== n.tr) {
            el.style.transform = tr;
            n.tr = tr;
          }
        }
        S.old = S.old.filter((l) => l.al >= 0.02);
        const sl = S.sel;
        for (const l of [...S.live, ...S.old]) {
          l.al += (l.aT - l.al) * (rm ? 1 : Math.min(1, (dt || 0.016) * 4));
          l.gr = rm ? 1 : Math.min(1, l.gr + (dt || 0.016) * 1.25);
          if (l.al < 0.02) continue;
          const A = S.pos[l.e.a];
          const B = S.pos[l.e.b];
          if (l.aT > 0 && (!A?.on || !B?.on)) continue;
          if (!curve(l)) continue;
          const rgb = RC[l.e.room] ?? WHITE;
          let hi = 1;
          if (sl?.edge !== undefined) hi = sl.edge === l.i && l.aT > 0 ? 1.6 : 0.4;
          else if (sl?.node) hi = l.e.a === sl.node || l.e.b === sl.node ? 1.6 : 0.3;
          const a = l.al * hi;
          const s = l.e.state;
          // The pipe under the thread: a brass under-stroke, the Boiler Room's pipework.
          c.globalAlpha = 1;
          c.beginPath();
          c.moveTo(l.poly.x[0]!, l.poly.y[0]!);
          for (let q = 1; q < l.poly.n; q++) c.lineTo(l.poly.x[q]!, l.poly.y[q]!);
          c.lineCap = "round";
          c.strokeStyle = `rgba(${BRASS},${0.13 * a})`;
          c.lineWidth = 6;
          c.stroke();
          c.strokeStyle = `rgba(${BRASS},${0.07 * a})`;
          c.lineWidth = 9;
          c.stroke();
          if (s === "wait") weave(c, l.poly, l.P, { a: 0.6 * a, sp: 0.7, sz: 0.7, v: 0, rgb, line: 0.5 * a, dash: [3, 5], nofade: true }, t, 0);
          else weave(c, l.poly, l.P, { a: (s === "run" ? 1.7 : 1.35) * a, sp: s === "run" ? 2.4 : 1.8, sz: s === "run" ? 1.05 : 0.92, v: s === "run" ? 70 : s === "bad" ? 8 : 34, rgb: s === "bad" ? BAD : rgb, rgb2: s === "run" ? RUN : WHITE, line: (s === "run" ? 0.46 : 0.34) * a, lw: s === "run" ? 1.3 : 1, jit: 0.3 }, t, dt);
          const chip = l.aT > 0 ? box.querySelector<HTMLElement>(`.wv-gchip[data-i="${l.i}"]`) : null;
          if (chip) {
            const m = l.poly.at(0.5);
            const tr = `translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px) translate(-50%,-50%)`;
            if (tr !== l.ctr) {
              chip.style.transform = tr;
              l.ctr = tr;
            }
          }
        }
        // A glow under the rooms, a knot on what's running.
        for (const [id, n] of Object.entries(S.pos)) {
          if (!n.on) continue;
          const el = box.querySelector<HTMLElement>(`.wv-gn[data-node="${id}"]`);
          if (!el) continue;
          const room = el.dataset.room;
          if (el.classList.contains("is-room") && room) {
            const rgb = RC[room] ?? WHITE;
            const g = c.createRadialGradient(n.x, n.y, 0, n.x, n.y, 46);
            g.addColorStop(0, `rgba(${rgb},${el.classList.contains("is-wait") ? 0.12 : 0.26})`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            c.globalAlpha = 1;
            c.fillStyle = g;
            c.beginPath();
            c.arc(n.x, n.y, 46, 0, TAU);
            c.fill();
          } else if (el.classList.contains("is-run")) knot(c, n.x, n.y, 0.55, t, RUN, 0.8);
        }
      },
    };
    // The nodes are fixed for the page's life; the rest is read from the ref each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const vz = useViz(cv, spec);
  useEffect(() => vz.current?.relayout(), [phone, mode, vz]);

  // Chips light up a moment after a flow is woven.
  const [chipsOn, setChipsOn] = useState(false);
  useEffect(() => {
    setChipsOn(false);
    const t = window.setTimeout(() => setChipsOn(true), reducedMotion() ? 0 : 700);
    return () => window.clearTimeout(t);
  }, [mode]);

  const back = useCallback(() => setMode("overview"), [setMode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  const clickNode = (id: string) => setSel({ node: id });
  const onCanvas = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = host.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: number | null = null;
    let bd = 12;
    for (const l of st.current.live) {
      for (let i = 0; i < l.poly.n; i += 2) {
        const d = Math.hypot(l.poly.x[i]! - x, l.poly.y[i]! - y);
        if (d < bd) {
          bd = d;
          best = l.i;
        }
      }
    }
    if (best !== null) setSel({ edge: best });
  };

  const height = GH[phone ? "p" : "d"][mode];
  const flow = flows[mode];
  return (
    <>
      <div ref={host} className="wv-graph is-focus" style={{ height } as React.CSSProperties} onClick={onCanvas}>
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <div className="wv-gnodes">
          {Object.values(nodes).map((d) => {
            const on = shown.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                data-node={d.id}
                data-room={d.room}
                tabIndex={on ? 0 : -1}
                aria-hidden={on ? undefined : true}
                className={`wv-gn is-${d.k}${d.state === "wait" ? " is-wait" : ""}${d.state === "run" ? " is-run" : ""}${d.state === "bad" ? " is-bad" : ""}${d.pf ? " has-pf" : ""}${on ? "" : " is-out"}${sel?.node === d.id ? " is-sel" : ""}`}
                onClick={() => clickNode(d.id)}
              >
                <span className="wv-gd" />
                {d.pf && <img className="wv-gpf" src={`/desk/agent-${d.pf}.webp`} alt="" />}
                <b>{d.l}</b>
                <span>{d.s}</span>
              </button>
            );
          })}
        </div>
        <div className="wv-gchips" aria-hidden="true">
          {edges.map((e, i) =>
              e.kinds?.length ? (
                <div key={`${mode}-${i}`} data-i={i} className={`wv-gchip${chipsOn ? " is-on" : ""}`} style={{ "--rc": RC[e.room] } as React.CSSProperties}>
                  <i>{e.kinds[0]}</i>
                </div>
              ) : null,
            )}
        </div>
        <div className="wv-gtop">
          <button className="wv-back wv-gback" type="button" onClick={back} tabIndex={0}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3 5 8l5 5" />
            </svg>
            All lines<span className="wv-back-k">Esc</span>
          </button>
          <p className="wv-gtitle">
            {flow.t}
            <span>{flow.sub}</span>
          </p>
        </div>
      </div>
      <FlowPanel flow={flow} nodes={nodes} sel={sel} onStep={(i) => setSel({ edge: i })} />
    </>
  );
}

function GSt({ s, text }: { s: GState; text: string }) {
  return (
    <span className={`wv-gst${s === "run" ? " is-run" : s === "wait" ? " is-wait" : s === "bad" ? " is-bad" : ""}`}>
      <i />
      {text}
    </span>
  );
}

function FlowPanel({ flow, nodes, sel, onStep }: { flow: Flow; nodes: Record<string, GNode>; sel: { edge?: number; node?: string } | null; onStep: (i: number) => void }) {
  const first = Math.max(
    0,
    flow.edges.findIndex((e) => e.state === "run"),
  );
  const i = sel?.edge ?? (sel?.node ? null : first);
  const e = i !== null ? flow.edges[i] : null;
  const n = sel?.node ? nodes[sel.node] : null;
  const name = (id: string) => nodes[id]?.l ?? id;
  return (
    <aside className="wv-gpanel" aria-live="polite" style={{ "--rc": `var(--rc-${flow.room})` } as React.CSSProperties}>
      <div className="wv-gp-l">
        <p className="wv-eyb">{ROOM_NAME[flow.room]}</p>
        <h3>{flow.t}, every step</h3>
        <GSt s={flow.stc} text={flow.st} />
        <p className="wv-gp-p">{flow.p}</p>
        <ol className="wv-gsteps">
          {flow.edges.map((x, k) => (
            <li key={k}>
              <button type="button" aria-current={k === i ? "true" : "false"} onClick={() => onStep(k)}>
                <b>
                  {name(x.a)} to {name(x.b)}
                  <small>{x.label}</small>
                </b>
                <em>{x.kinds?.join(", ")}</em>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="wv-gp-r">
        {n ? (
          <>
            {n.pf && <img className="wv-pf" src={`/desk/agent-${n.pf}.webp`} alt="" style={{ width: 52, height: 52, marginBottom: 12, borderRadius: "50%" }} />}
            <p className="wv-eyb">A part</p>
            <h3>{n.l}</h3>
            <GSt s={n.state} text={STATE_WORD[n.state]} />
            <dl className="wv-gdl">
              <div>
                <dt>What it is</dt>
                <dd>
                  {n.l}, {n.s}.
                </dd>
              </div>
              <div>
                <dt>Fed by</dt>
                <dd>{flow.edges.filter((x) => x.b === n.id).map((x) => name(x.a)).join(", ") || "nothing here"}</dd>
              </div>
              <div>
                <dt>Feeds</dt>
                <dd>{flow.edges.filter((x) => x.a === n.id).map((x) => name(x.b)).join(", ") || "nothing here"}</dd>
              </div>
            </dl>
          </>
        ) : e && i !== null ? (
          <>
            <p className="wv-eyb">
              Step {i + 1} of {flow.edges.length}
            </p>
            <h3>
              {name(e.a)} to {name(e.b)}
            </h3>
            <GSt s={e.state} text={STATE_WORD[e.state]} />
            {e.kinds && e.kinds.length > 0 && (
              <div className="wv-gkinds">
                {e.kinds.map((k) => (
                  <i key={k}>{k}</i>
                ))}
              </div>
            )}
            <dl className="wv-gdl">
              <div>
                <dt>What travels</dt>
                <dd>
                  {e.label}. {e.how}
                </dd>
              </div>
              {e.auth && (
                <div>
                  <dt>How it signs in</dt>
                  <dd>{e.auth}</dd>
                </div>
              )}
              {e.when && (
                <div>
                  <dt>How often</dt>
                  <dd>{e.when}</dd>
                </div>
              )}
            </dl>
          </>
        ) : null}
      </div>
    </aside>
  );
}
