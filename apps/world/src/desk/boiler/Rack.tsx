import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Connection } from "../connections.ts";
import { RC, useFlow, type FlowLayoutFn, type FlowLine, type Pt } from "../flow/index.ts";
import { PlanWatch } from "../skippy/PlanWatch.tsx";
import { roomLink } from "../hero/roomLink.ts";
import { ROOM_META } from "../roomPulse.ts";
import type { Fitting, GState, PipeRow } from "../systemsGraph.ts";
import { BAD } from "../wvCanvas.ts";
import { connectionFor, fittingsOf, pipeState, pressureOf, roomConnections } from "./pressure.ts";
import { changesOf, lookOf, rackCols, rowGeo, segId, segsOf, STATE_LONG, STATE_WORD, type Seg } from "./rack.ts";

/**
 * The Boiler Room's stage (#390): Today's particle-line language (the flow kit) carrying every real link. Each room
 * is one straight line across the stage, a valve for each connection in the order its data flows, the room's keeper
 * standing in one column where the room's own work happens. A connection that is up flows steadily in the room's
 * colour; one under load (busy or slow) thins out; one not connected yet is a dashed waiting bed; a broken one stops
 * dead with a red knot at its valve. When a state really changes, the line says so once: a packet runs a line that
 * came back, a red spray marks one that broke, and a plain word rises off its valve. Progressive disclosure: a valve
 * opens that one connection (how it works, how it signs in, how often) under its line, and a room's name opens its
 * whole flow below the stage. The header (headline, ledger, security) is passed in and sits over the same canvas.
 */

export const ACCENT = RC.boiler!;
const rgbOf = (room: string) => RC[room] ?? ACCENT;
const keeper = (r: PipeRow) => (ROOM_META[r.room as keyof typeof ROOM_META] ?? ROOM_META.boiler).submind;
/** The line's height in a track, px: a desk, and a phone. */
const LINE_Y = { d: 26, p: 20 };
/** At most this many live events speak at once (a burst of changes reads as one moment, not a flood). */
const EVENTS_MAX = 3;

interface Sel {
  row: string;
  fit: string;
}

function ConnFacts({ c }: { c: Connection }) {
  return (
    <>
      <p className="bx-kinds">
        {c.kinds.map((k) => (
          <i key={k}>{k}</i>
        ))}
        {c.status === "planned" && <i className="is-planned">Planned</i>}
      </p>
      {c.id === "elevenlabs-agents" && <PlanWatch className="plan-watch--bx" />}
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

const Close = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

function Inspector({ r, f, onClose, onOpen }: { r: PipeRow; f: Fitting; onClose: () => void; onOpen: () => void }) {
  const c = connectionFor(f.id, r.room);
  const fits = fittingsOf(r);
  return (
    <div className={`bx-insp fl-panel is-${f.state}`} role="region" aria-label={`${f.l} on the ${r.name} line`}>
      <div className="bx-insp-h">
        <div>
          <p className="fl-k">
            {r.name} · link {fits.indexOf(f) + 1} of {fits.length} · {f.side === "in" ? `feeds ${r.name}` : `fed by ${r.name}`}
          </p>
          <h3 className="fl-h2">{c?.name ?? f.l}</h3>
          <p className="bx-insp-s">{c?.serves ?? `${f.l}, ${f.s}.`}</p>
        </div>
        <span className={`bx-st is-${f.state}`}>
          <i />
          {STATE_LONG[f.state]}
        </span>
        <button type="button" className="bx-x" onClick={onClose} aria-label="Close">
          <Close />
        </button>
      </div>
      {c ? <ConnFacts c={c} /> : <p className="bx-insp-p">A part on the {r.name} line, with no outside service of its own to sign in to. Its state is the state of the connection into it.</p>}
      <button type="button" className="fl-btn" onClick={onOpen}>
        {r.flow ? `The whole ${r.name} flow, ${r.steps} steps` : `Every ${r.name} connection`}
        <Arrow />
      </button>
    </div>
  );
}

const stateOfConn = (c: Connection, fits: Fitting[], room: string): GState => {
  const f = fits.find((x) => connectionFor(x.id, room)?.id === c.id);
  return f ? f.state : c.status === "planned" ? "wait" : "ok";
};

/** The detail for a room with no whole flow drawn yet: every connection it owns, each in its real state. */
export function RoomDetail({ r, onClose }: { r: PipeRow; onClose: () => void }) {
  const list = roomConnections(r.room);
  const fits = fittingsOf(r);
  return (
    <section className="bx-room" style={{ "--rc": rgbOf(r.room) } as CSSProperties} aria-label={`${r.name}'s connections`}>
      <div className="bx-room-h">
        <button type="button" className="fl-btn" onClick={onClose}>
          All lines <span className="bx-esc">Esc</span>
        </button>
        <div>
          <p className="fl-eyb">
            <span>{r.name}</span>
            <i />
            {list.length} {list.length === 1 ? "connection" : "connections"}
          </p>
          <h2 className="fl-h2">{r.sub.charAt(0).toUpperCase() + r.sub.slice(1)}</h2>
        </div>
        <a className="fl-btn is-pri" href={`/${r.id}`} onClick={roomLink(`/${r.id}`)}>
          Open the room
          <Arrow />
        </a>
      </div>
      <ol className="bx-room-l">
        {list.map((c, i) => {
          const s = stateOfConn(c, fits, r.room);
          return (
            <li key={c.id} className={`is-${s}`}>
              <div className="bx-room-t">
                <span className="bx-room-n fl-num">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.serves}</p>
                </div>
                <span className={`bx-st is-${s}`}>
                  <i />
                  {STATE_WORD[s]}
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

export function Rack({ rows, open, onOpen, header, children }: { rows: PipeRow[]; open: string | null; onOpen: (id: string | null) => void; header: ReactNode; children?: ReactNode }) {
  const stage = useRef<HTMLElement>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const cols = useMemo(() => rackCols(rows), [rows]);
  const geos = useMemo(() => new Map(rows.map((r) => [r.id, rowGeo(r, cols)])), [rows, cols]);
  const segs = useMemo(() => new Map(rows.map((r) => [r.id, segsOf(r, geos.get(r.id)!)])), [rows, geos]);
  const bySeg = useMemo(() => {
    const m = new Map<string, { r: PipeRow; s: Seg }>();
    for (const r of rows) for (const s of segs.get(r.id)!) m.set(s.id, { r, s });
    return m;
  }, [rows, segs]);

  const layout = useCallback<FlowLayoutFn>(
    ({ rel, phone }) => {
      const root = stage.current;
      if (!root) return { lines: [] };
      const lines: FlowLine[] = [];
      const anchors: Record<string, Pt> = {};
      const ly = phone ? LINE_Y.p : LINE_Y.d;
      for (const r of rows) {
        const el = root.querySelector(`[data-bx-track="${r.id}"]`);
        if (!el) continue;
        const t = rel(el);
        if (!t.w) continue;
        const y = t.y + ly;
        const X = (u: number) => t.x + u * t.w;
        const dim = open !== null && open !== r.id;
        for (const s of segs.get(r.id)!) {
          const look = lookOf(s.state, s.valveU);
          const a = X(s.a) + (s.valveU === 0 ? 8 : 0);
          const b = X(s.b) - (s.valveU === 1 ? 8 : 0);
          if (b - a < 6) continue;
          lines.push({
            id: s.id,
            path: { from: [a, y], to: [b, y], bend: 0 },
            rgb: look.red ? BAD : rgbOf(r.room),
            density: look.density,
            rate: look.rate,
            waiting: look.waiting,
            thin: look.thin,
            knots: look.knots,
            bright: look.bright * (dim ? 0.3 : 1),
            bed: look.bed,
            spread: phone ? 1.6 : 2.4,
          });
          anchors[`v:${s.id}`] = [X(s.valveU ? s.b : s.a), y - 14];
        }
      }
      return { lines, anchors };
    },
    [rows, segs, open],
  );

  const { cv, field, bind } = useFlow(layout, {
    accent: ACCENT,
    ground: true,
    backing: 1_100_000,
    onHover: setHot,
    onPick: (id) => {
      const x = bySeg.get(id);
      if (x) setSel((s) => (s?.row === x.r.id && s.fit === x.s.fit.id ? null : { row: x.r.id, fit: x.s.fit.id }));
    },
  });

  // Anything that moves the DOM under the lines (a valve's detail opening, a room opening) asks for a fresh layout.
  useLayoutEffect(() => field.relayout(), [field, sel, open]);

  // Real changes only: a link that comes back runs a packet, one that breaks sprays red, and a word rises off its valve.
  const seen = useRef<Map<string, GState> | null>(null);
  useEffect(() => {
    const prev = seen.current;
    seen.current = new Map(rows.flatMap((r) => [...r.ins, ...r.outs].map((f) => [segId(r.id, f), f.state] as const)));
    if (!prev) return;
    const t = window.setTimeout(() => {
      for (const c of changesOf(prev, rows).slice(0, EVENTS_MAX)) {
        const u = bySeg.get(c.id)?.s.valveU ?? 1;
        if (c.to === "bad") {
          field.burst(c.id, { u, n: 30, rgb: BAD });
          field.rise(`${c.fit.l} · broken`, { at: `v:${c.id}`, rgb: BAD });
        } else if (c.to === "ok" || c.to === "run") {
          field.pulse(c.id);
          field.rise(`${c.fit.l} · ${c.to === "ok" ? "flowing" : "under load"}`, { at: `v:${c.id}` });
        }
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [rows, bySeg, field]);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  const pick = (r: PipeRow) => {
    setSel(null);
    onOpen(open === r.id ? null : r.id);
  };
  const hotSeg = hot ? bySeg.get(hot) : undefined;

  return (
    <section ref={stage} className="fl-stage bx-stage" aria-label="The Boiler Room: every real link" {...bind} data-hot={hot ?? undefined}>
      <canvas ref={cv} className="fl-cv" aria-hidden="true" />
      {header}
      <div className="bx-rack" role="list" aria-label="Every room's links">
        {rows.map((r) => {
          const g = geos.get(r.id)!;
          const fits = fittingsOf(r);
          const p = pressureOf(fits);
          const st = pipeState(r);
          const k = keeper(r);
          const isOpen = open === r.id;
          const s = sel?.row === r.id ? fits.find((f) => f.id === sel.fit) : undefined;
          const at = (f: Fitting) => (f.side === "in" ? g.ins[r.ins.indexOf(f)]! : g.outs[r.outs.indexOf(f)]!);
          return (
            <div key={r.id} role="listitem" className={`bx-row is-${st}${isOpen ? " is-open" : ""}${open && !isOpen ? " is-dim" : ""}`} style={{ "--rc": rgbOf(r.room) } as CSSProperties} data-pipe={r.id} data-room={r.room}>
              <button type="button" className="bx-head" aria-expanded={isOpen} onClick={() => pick(r)} aria-label={`${r.name}: ${p.flowing} of ${p.total} links flowing${p.burst ? `, ${p.burst} broken` : ""}. ${r.flow ? `Open its whole flow, ${r.steps} steps` : "Open its connections"}`}>
                <b>{r.name}</b>
                <small>{r.sub}</small>
                <span className={`bx-st is-${st}`}>
                  <i />
                  {p.flowing} of {p.total} flowing
                </span>
              </button>
              <div className="bx-track" data-bx-track={r.id}>
                <span className="bx-hub" style={{ left: `${g.hub * 100}%`, "--share": `${Math.round(p.share * 100)}%` } as CSSProperties} title={k.title}>
                  <img src={`/desk/agent-${k.id}.webp`} alt="" loading="lazy" decoding="async" />
                  <small>{k.title}</small>
                </span>
                {fits.map((f) => {
                  const id = segId(r.id, f);
                  const on = sel?.row === r.id && sel.fit === f.id;
                  const lit = on || hotSeg?.s.id === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`bx-v is-${f.state}${lit ? " is-lit" : ""}`}
                      style={{ left: `${at(f) * 100}%` }}
                      aria-pressed={on}
                      aria-label={`${f.l}, ${f.s}: ${STATE_LONG[f.state]}. How it works`}
                      title={`${f.l}: ${STATE_LONG[f.state]}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSel(on ? null : { row: r.id, fit: f.id });
                      }}
                    >
                      <i />
                      <b>{f.l}</b>
                      <small>{f.s}</small>
                    </button>
                  );
                })}
              </div>
              {s && <Inspector r={r} f={s} onClose={() => setSel(null)} onOpen={() => pick(r)} />}
            </div>
          );
        })}
      </div>
      {children}
    </section>
  );
}
