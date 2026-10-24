import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Connection } from "./connections.ts";
import { connectionFor, fittingsOf, pipeLayout, pipeState, pressureOf, roomConnections, type Pressure } from "./boiler/pressure.ts";
import { roomLink } from "./hero/roomLink.ts";
import { ROOM_META } from "./roomPulse.ts";
import type { Fitting, GState, PipeRow } from "./systemsGraph.ts";

/**
 * The Boiler Room's manifold (#241, redrawn for #369): every room with connections is one steel line, left to right,
 * with each real connection a valve on it in the order the data flows (systemsGraph.ts, pipeRows) and the room's
 * keeper at the boiler where its own work happens. Every segment shows its connection's real state: flowing (beads of
 * the room's colour run through it), running hot (faster and brighter), dry (a dashed ghost of a pipe, not connected
 * yet) or burst (split open, spraying, with the valve shaking). Progressive disclosure: tap a valve and an inspector
 * opens under its line with that connection from connections.ts (how it works, how it signs in, how often); tap a line
 * and the rack folds into a picker of thin lines while the room's whole flow opens below (SystemsGraph.tsx, or
 * RoomDetail for a room with no flow drawn yet). Motion is CSS (boiler.css) and stops under prefers-reduced-motion.
 */

const WORD: Record<GState, string> = { ok: "flowing", run: "running hot", wait: "dry, not connected yet", bad: "burst, down" };
const SHORT: Record<GState, string> = { ok: "Flowing", run: "Running hot", wait: "Dry", bad: "Burst" };

/** Geometry: the head's gutter, the slot each feed takes before the boiler, the boiler's radius, the pipe's height. */
const GEO = {
  full: { head: 232, slot: 96, pad: 26, r: 19, h: 118, y: 46 },
  phone: { head: 0, slot: 44, pad: 16, r: 15, h: 52, y: 26 },
  thin: { head: 196, slot: 40, pad: 16, r: 11, h: 40, y: 20 },
};
type Geo = (typeof GEO)[keyof typeof GEO];

/** The spray from a burst: each drop's flight, size and start. */
const SPRAY = [
  { dx: -14, dy: -20, r: 1.6, d: 0 },
  { dx: 10, dy: -24, r: 1.3, d: 0.18 },
  { dx: 18, dy: -10, r: 1.1, d: 0.42 },
  { dx: -20, dy: -6, r: 1.2, d: 0.3 },
  { dx: 4, dy: 22, r: 1.5, d: 0.55 },
  { dx: -6, dy: 26, r: 1.2, d: 0.75 },
  { dx: 0, dy: -28, r: 1, d: 0.9 },
];

const keeper = (r: PipeRow) => (ROOM_META[r.room as keyof typeof ROOM_META] ?? ROOM_META.boiler).submind;
const rc = (room: string) => ({ "--rc": `var(--rc-${room}, var(--room-boiler))` }) as CSSProperties;

/** The shared paint for every line: brushed steel, brass, a valve's cast body. Drawn once, used by every svg. */
export function PipeDefs() {
  return (
    <svg className="bx-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bx-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3f47" />
          <stop offset=".28" stopColor="#9aa0ac" />
          <stop offset=".46" stopColor="#c9ced8" />
          <stop offset=".7" stopColor="#555a64" />
          <stop offset="1" stopColor="#1d1f24" />
        </linearGradient>
        <linearGradient id="bx-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d5330" />
          <stop offset=".35" stopColor="#e3c58e" />
          <stop offset=".6" stopColor="#b08850" />
          <stop offset="1" stopColor="#4a3820" />
        </linearGradient>
        <radialGradient id="bx-cast" cx=".36" cy=".3" r=".8">
          <stop offset="0" stopColor="#d5d9e1" />
          <stop offset=".45" stopColor="#6c717c" />
          <stop offset="1" stopColor="#1b1d22" />
        </radialGradient>
        <filter id="bx-blur" x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
    </svg>
  );
}

/** A small pressure dial: the share of a line's connections carrying flow, as an arc around the count. */
export function Dial({ p, state, size = 34 }: { p: Pressure; state: GState; size?: number }) {
  const r = size / 2 - 3;
  return (
    <svg className={`bx-dial is-${state}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="bx-dial-bg" cx={size / 2} cy={size / 2} r={r} pathLength={100} />
      <circle className="bx-dial-v" cx={size / 2} cy={size / 2} r={r} pathLength={100} strokeDasharray={`${Math.round(p.share * 100)} 100`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy=".35em" textAnchor="middle">
        {p.flowing}
      </text>
    </svg>
  );
}

/** One stretch of pipe between two fittings, in its connection's state. */
function Seg({ a, b, y, state, thin }: { a: number; b: number; y: number; state: GState; thin: boolean }) {
  const h = thin ? 8 : 12;
  if (b - a < 2) return null;
  if (state === "bad") {
    const m = (a + b) / 2;
    return (
      <g className="bx-seg is-bad">
        <rect className="bx-shell" x={a} y={y - h / 2} width={Math.max(0, m - 5 - a)} height={h} rx={h / 2} />
        <rect className="bx-shell" x={m + 5} y={y - h / 2} width={Math.max(0, b - m - 5)} height={h} rx={h / 2} />
        <line className="bx-flow" x1={a} y1={y} x2={m - 6} y2={y} />
        <g className="bx-burst" transform={`translate(${m} ${y})`}>
          <circle className="bx-halo" r={thin ? 9 : 14} />
          <circle className="bx-steam" r={8} filter="url(#bx-blur)" />
          <path className="bx-crack" d={`M-5 ${-h / 2} L-2 -2 L-6 1 L-3 ${h / 2} M5 ${-h / 2} L2 -1 L6 2 L3 ${h / 2}`} />
          {!thin && SPRAY.map((s, i) => <circle key={i} className="bx-drop" r={s.r} style={{ "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, "--dl": `${s.d}s` } as CSSProperties} />)}
        </g>
      </g>
    );
  }
  return (
    <g className={`bx-seg is-${state}`}>
      <rect className="bx-shell" x={a} y={y - h / 2} width={b - a} height={h} rx={h / 2} />
      {state !== "wait" && (
        <>
          <line className="bx-glow" x1={a + 3} y1={y} x2={b - 3} y2={y} />
          <line className="bx-flow" x1={a + 3} y1={y} x2={b - 3} y2={y} />
        </>
      )}
    </g>
  );
}

/** A valve: a brass flange on the pipe, a cast body shaped by what the part is, and a handwheel on its stem. */
function Valve({ f, x, y, thin, hot, wheel }: { f: Fitting; x: number; y: number; thin: boolean; hot: boolean; wheel: boolean }) {
  const s = thin ? 4.5 : 7;
  return (
    <g className={`bx-valve is-${f.state} k-${f.k}${hot ? " is-hot" : ""}${f.id === "lattice" ? " is-outlet" : ""}`} transform={`translate(${x} ${y})`}>
      <g className="bx-shake">
        <rect className="bx-flange" x={-3} y={-(s + 4)} width={6} height={2 * (s + 4)} rx={1.5} />
        {wheel && (
          <g className="bx-stem">
            <line x1={0} y1={-s - 3} x2={0} y2={-s - 11} />
            <g transform={`translate(0 ${-s - 16})`}>
              <g className="bx-wheel">
                <circle r={6.5} />
                <path d="M-6.5 0H6.5M0 -6.5V6.5" />
                <circle className="bx-wheel-c" r={1.6} />
              </g>
            </g>
          </g>
        )}
        {f.k === "store" ? (
          <rect className="bx-body" x={-s} y={-s} width={2 * s} height={2 * s} rx={2} />
        ) : f.k === "agent" ? (
          <rect className="bx-body" x={-s * 0.8} y={-s * 0.8} width={1.6 * s} height={1.6 * s} rx={1.5} transform="rotate(45)" />
        ) : (
          <circle className="bx-body" r={s} />
        )}
        <circle className="bx-lamp" r={thin ? 1.6 : 2.4} />
      </g>
    </g>
  );
}

interface Sel {
  row: string;
  fit: string;
}

function Line({ r, w, geo, phone, thin, slots, sel, surge, isOpen, dim, onOpen, onValve }: { r: PipeRow; w: number; geo: Geo; phone: boolean; thin: boolean; slots: number; sel: Sel | null; surge: number; isOpen: boolean; dim: boolean; onOpen: () => void; onValve: (f: Fitting) => void }) {
  const tw = Math.max(120, w - geo.head);
  const maxIns = phone ? r.ins.length : slots;
  // On a phone the slots shrink so every valve on a long line still fits across the screen.
  const slot = phone ? Math.min(geo.slot, (tw - 2 * geo.pad - 2 * geo.r) / (r.ins.length + r.outs.length + 1.2)) : geo.slot;
  const hub = geo.pad + geo.r + 10 + maxIns * slot;
  const L = pipeLayout(r, tw, hub, slot, geo.pad);
  const y = geo.y;
  const fits = fittingsOf(r);
  const p = pressureOf(fits);
  const st = pipeState(r);
  const k = keeper(r);
  const first = L.ins[0] ?? hub;
  const labels = !phone && !thin;
  // Each segment carries the state of the connection at its downstream end (feeds) or upstream end (what it feeds).
  const segs: { a: number; b: number; s: GState }[] = [];
  r.ins.forEach((f, i) => segs.push({ a: L.ins[i]!, b: i + 1 < r.ins.length ? L.ins[i + 1]! : hub - geo.r, s: f.state }));
  r.outs.forEach((f, i) => segs.push({ a: i ? L.outs[i - 1]! : hub + geo.r, b: L.outs[i]!, s: f.state }));
  const lastOut = r.outs.length ? L.outs[r.outs.length - 1]! : hub + geo.r;
  const outW = r.outs.length ? Math.min(168, (L.end - hub) / (r.outs.length + 0.6) - 10) : 0;
  const label = `${r.name}: ${p.flowing} of ${p.total} connections flowing${p.burst ? `, ${p.burst} burst` : ""}. ${r.flow ? `Open its whole flow, ${r.steps} steps` : "Open its connections"}`;
  return (
    <div className={`bx-line is-${st}${isOpen ? " is-open" : ""}${dim ? " is-dim" : ""}`} style={rc(r.room)} data-pipe={r.id} data-room={r.room} onClick={onOpen}>
      <button
        type="button"
        className="bx-head"
        aria-expanded={isOpen}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <Dial p={p} state={st} size={thin ? 26 : 34} />
        <span className="bx-head-t">
          <b>{r.name}</b>
          {!thin && <small>{r.sub}</small>}
        </span>
        <span className={`bx-st is-${st}`}>
          <i />
          {thin ? `${p.flowing}/${p.total}` : `${SHORT[st]} · ${p.flowing} of ${p.total}`}
        </span>
      </button>
      <div className="bx-track" style={{ height: geo.h }}>
        <svg className="bx-svg" width={tw} height={geo.h} viewBox={`0 0 ${tw} ${geo.h}`} aria-hidden="true">
          {segs.map((g, i) => (
            <Seg key={i} a={g.a} b={g.b} y={y} state={g.s} thin={thin} />
          ))}
          <Seg a={lastOut} b={L.end} y={y} state={r.outs[r.outs.length - 1]?.state === "wait" || st === "wait" ? "wait" : "ok"} thin={thin} />
          <rect className="bx-cap" x={L.end - 2} y={y - (thin ? 7 : 10)} width={7} height={thin ? 14 : 20} rx={1.5} />
          {r.ins.map((f, i) => (
            <Valve key={`i-${f.id}`} f={f} x={L.ins[i]!} y={y} thin={thin} wheel={!thin && !phone} hot={sel?.row === r.id && sel.fit === f.id} />
          ))}
          {r.outs.map((f, i) => (
            <Valve key={`o-${f.id}`} f={f} x={L.outs[i]!} y={y} thin={thin} wheel={!thin && !phone} hot={sel?.row === r.id && sel.fit === f.id} />
          ))}
          <g className="bx-boiler" transform={`translate(${hub} ${y})`}>
            <circle className="bx-boiler-bg" r={geo.r + 6} pathLength={100} />
            <circle className="bx-boiler-v" r={geo.r + 6} pathLength={100} strokeDasharray={`${Math.round(p.share * 100)} 100`} transform="rotate(-90)" />
            <circle r={geo.r + 2} fill="url(#bx-brass)" />
            <clipPath id={`bx-k-${r.id}`}>
              <circle r={geo.r} />
            </clipPath>
            <rect x={-geo.r} y={-geo.r} width={geo.r * 2} height={geo.r * 2} fill="#14161b" clipPath={`url(#bx-k-${r.id})`} />
            <image href={`/desk/agent-${k.id}.webp`} x={-geo.r} y={-geo.r} width={geo.r * 2} height={geo.r * 2} clipPath={`url(#bx-k-${r.id})`} preserveAspectRatio="xMidYMid slice" />
          </g>
          {surge > 0 && <line key={surge} className="bx-surge" x1={first} y1={y} x2={L.end} y2={y} pathLength={100} />}
        </svg>
        {labels &&
          fits.map((f) => {
            const i = r.ins.indexOf(f);
            const x = i >= 0 ? L.ins[i]! : L.outs[r.outs.indexOf(f)]!;
            return (
              <span key={`l-${f.side}-${f.id}`} className={`bx-lab is-${f.state}${sel?.row === r.id && sel.fit === f.id ? " is-hot" : ""}`} style={{ left: x, top: y + 18, width: i >= 0 ? slot - 8 : outW } as CSSProperties}>
                <b>{f.l}</b>
                <small>{f.s}</small>
              </span>
            );
          })}
        {labels && (
          <span className="bx-lab is-keeper" style={{ left: hub, top: y + geo.r + 10, width: 120 } as CSSProperties}>
            <small>{k.title}</small>
          </span>
        )}
        {!thin &&
          fits.map((f) => {
            const i = r.ins.indexOf(f);
            const x = i >= 0 ? L.ins[i]! : L.outs[r.outs.indexOf(f)]!;
            return (
              <button
                key={`h-${f.side}-${f.id}`}
                type="button"
                className="bx-hit"
                style={{ left: x, top: y } as CSSProperties}
                aria-label={`${f.l}, ${f.s}: ${WORD[f.state]}. How it works`}
                aria-pressed={sel?.row === r.id && sel.fit === f.id}
                title={`${f.l}: ${WORD[f.state]}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onValve(f);
                }}
              />
            );
          })}
      </div>
    </div>
  );
}

const stateOfConn = (c: Connection, fits: Fitting[], room: string): GState => {
  const f = fits.find((x) => connectionFor(x.id, room)?.id === c.id);
  return f ? f.state : c.status === "planned" ? "wait" : "ok";
};

/** What one connection is: its kinds, then how it works, how it signs in and how often. */
function ConnFacts({ c }: { c: Connection }) {
  return (
    <>
      <div className="bx-kinds">
        {c.kinds.map((k) => (
          <i key={k}>{k}</i>
        ))}
        {c.status === "planned" && <i className="is-planned">Planned</i>}
      </div>
      <dl className="bx-facts">
        <div>
          <dt>How it works</dt>
          <dd>{c.how}</dd>
        </div>
        <div>
          <dt>Signs in</dt>
          <dd>{c.auth}</dd>
        </div>
        <div>
          <dt>How often</dt>
          <dd>{c.when}</dd>
        </div>
      </dl>
    </>
  );
}

function Inspector({ r, f, onClose, onOpen }: { r: PipeRow; f: Fitting; onClose: () => void; onOpen: () => void }) {
  const c = connectionFor(f.id, r.room);
  const fits = fittingsOf(r);
  const at = fits.indexOf(f);
  return (
    <div className={`bx-insp is-${f.state}`} style={rc(r.room)} role="region" aria-label={`${f.l} on the ${r.name} line`}>
      <div className="bx-insp-h">
        <div>
          <p className="bx-eyb">
            {r.name} line · valve {at + 1} of {fits.length} · {f.side === "in" ? `feeds ${r.name}` : `fed by ${r.name}`}
          </p>
          <h3>{c?.name ?? f.l}</h3>
          <p className="bx-insp-s">{c?.serves ?? `${f.l}, ${f.s}.`}</p>
        </div>
        <span className={`bx-st is-${f.state}`}>
          <i />
          {WORD[f.state]}
        </span>
        <button type="button" className="bx-x" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {c ? <ConnFacts c={c} /> : <p className="bx-insp-p">A part on the {r.name} line, with no outside service of its own to sign in to. Its state is the state of the connection into it.</p>}
      <button type="button" className="bx-go" onClick={onOpen}>
        {r.flow ? `The whole ${r.name} flow, ${r.steps} steps` : `Every ${r.name} connection`}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </button>
    </div>
  );
}

/** The detail for a line with no whole flow drawn yet: every connection the room owns, each in its real state. */
export function RoomDetail({ r, onClose }: { r: PipeRow; onClose: () => void }) {
  const list = roomConnections(r.room);
  const fits = fittingsOf(r);
  return (
    <section className="bx-room" style={rc(r.room)} aria-label={`${r.name}'s connections`}>
      <div className="bx-room-h">
        <button type="button" className="bx-back" onClick={onClose}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3 5 8l5 5" />
          </svg>
          All lines<span className="bx-key">Esc</span>
        </button>
        <div>
          <p className="bx-eyb">
            {r.name} · {list.length} {list.length === 1 ? "connection" : "connections"}
          </p>
          <h2 className="bx-h2">{r.sub.charAt(0).toUpperCase() + r.sub.slice(1)}</h2>
        </div>
        <a className="bx-go" href={`/${r.id}`} onClick={roomLink(`/${r.id}`)}>
          Open the room
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </a>
      </div>
      <ol className="bx-room-l">
        {list.map((c, i) => {
          const s = stateOfConn(c, fits, r.room);
          return (
            <li key={c.id} className={`is-${s}`} style={{ "--i": i } as CSSProperties}>
              <div className="bx-room-t">
                <span className="bx-room-n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.serves}</p>
                </div>
                <span className={`bx-st is-${s}`}>
                  <i />
                  {SHORT[s]}
                </span>
              </div>
              <ConnFacts c={c} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function PipeRack({ rows, open, onOpen }: { rows: PipeRow[]; open: string | null; onOpen: (id: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1100);
  const [sel, setSel] = useState<Sel | null>(null);
  const [surge, setSurge] = useState<{ id: string; n: number } | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  const phone = w < 640;
  const thin = open !== null;
  const geo = thin ? (phone ? { ...GEO.thin, head: 0 } : GEO.thin) : phone ? GEO.phone : GEO.full;
  const slots = Math.max(1, ...rows.map((r) => r.ins.length));
  const pick = (r: PipeRow) => {
    setSel(null);
    if (open === r.id) return onOpen(null);
    setSurge((s) => ({ id: r.id, n: (s?.n ?? 0) + 1 }));
    onOpen(r.id);
  };

  return (
    <div ref={host} className={`bx-rack${thin ? " is-thin" : ""}${phone ? " is-phone" : ""}`}>
      <PipeDefs />
      {rows.map((r) => {
        const hot = sel?.row === r.id ? fittingsOf(r).find((f) => f.id === sel.fit) : undefined;
        return (
          <div key={r.id} className="bx-slot">
            <Line
              r={r}
              w={w}
              geo={geo}
              phone={phone}
              thin={thin}
              slots={slots}
              sel={sel}
              surge={surge?.id === r.id ? surge.n : 0}
              isOpen={open === r.id}
              dim={thin && open !== r.id}
              onOpen={() => pick(r)}
              onValve={(f) => setSel(sel?.row === r.id && sel.fit === f.id ? null : { row: r.id, fit: f.id })}
            />
            {hot && !thin && <Inspector r={r} f={hot} onClose={() => setSel(null)} onOpen={() => pick(r)} />}
          </div>
        );
      })}
    </div>
  );
}
