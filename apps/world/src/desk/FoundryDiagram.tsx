import { useEffect, useMemo, useState } from "react";
import { MAX_AT_ONCE, useFoundry } from "../foundry.ts";
import { LINK_STATE_LABEL } from "../systems.ts";
import { FlowTies, StatePill, useFlowPop } from "./FlowPop.tsx";
import { ago, capUse, foundryGraph, type FoundrySetup, type GraphEdge, type GraphKind, type GraphNode, type GraphNodeId } from "./foundryGraph.ts";
import { nextCheck } from "./FoundryPage.tsx";
import { routesOf } from "./popover.ts";
import { PopScope } from "./Popovers.tsx";

/**
 * The Foundry's system, drawn like Relay's: an idea's route from Nikita to the live site, each part lit by its real
 * state. Every part and every wire can be hovered, focused or tapped to say what it is, where its reading comes from
 * and how it connects, in a pop-over at the mouse (FlowPop.tsx, issue #94). The states are worked out in
 * foundryGraph.ts.
 */

type Pt = [number, number];
interface Layout {
  w: number;
  h: number;
  nodes: Record<GraphNodeId, Pt>;
}

const WIDE: Layout = {
  w: 1000,
  h: 540,
  nodes: {
    nikita: [60, 70],
    desk: [200, 70],
    shaping: [350, 70],
    issues: [500, 70],
    queue: [650, 70],
    builder: [820, 70],
    rivet: [690, 260],
    rusty: [820, 260],
    rocky: [950, 260],
    blob: [200, 260],
    checks: [700, 450],
    main: [480, 450],
    deploy: [260, 450],
  },
};

const TALL: Layout = {
  w: 360,
  h: 990,
  nodes: {
    nikita: [62, 50],
    desk: [180, 50],
    blob: [298, 50],
    shaping: [62, 220],
    issues: [180, 220],
    queue: [298, 220],
    builder: [180, 390],
    rivet: [62, 560],
    rusty: [180, 560],
    rocky: [298, 560],
    checks: [180, 730],
    main: [100, 900],
    deploy: [260, 900],
  },
};

/** Where a part's ring ends, and where its three lines of words end below it. */
const RIM = 38;
const UNDER = 86;

/**
 * A wire runs from edge to edge, never through a part's words: along a row it leaves from the side; between rows it
 * leaves from under the words and comes in at the top (or the other way round going up).
 */
function curve([x0, y0]: Pt, [x1, y1]: Pt) {
  if (Math.abs(y1 - y0) < 40) {
    const dir = Math.sign(x1 - x0) || 1;
    const a = x0 + dir * RIM;
    const b = x1 - dir * RIM;
    const mx = (a + b) / 2;
    return `M ${a} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${b} ${y1}`;
  }
  const down = y1 > y0;
  const a = down ? y0 + UNDER : y0 - RIM;
  const b = down ? y1 - RIM : y1 + UNDER;
  const my = (a + b) / 2;
  return `M ${x0} ${a} C ${x0} ${my}, ${x1} ${my}, ${x1} ${b}`;
}

function Shape({ kind }: { kind: GraphKind }) {
  if (kind === "person") return <rect x="-20" y="-20" width="40" height="40" rx="9" className="node__shape" />;
  if (kind === "agent") return <polygon points="0,-24 21,-12 21,12 0,24 -21,12 -21,-12" className="node__shape" />;
  if (kind === "store") return <polygon points="0,-23 23,0 0,23 -23,0" className="node__shape" />;
  return <circle r="21" className="node__shape" />;
}

const edgeKey = (e: GraphEdge) => `${e.from}-${e.to}`;

function Diagram({ layout, nodes, edges, className, keyPrefix }: { layout: Layout; nodes: GraphNode[]; edges: GraphEdge[]; className: string; keyPrefix: string }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg
      viewBox={`0 0 ${layout.w} ${layout.h}`}
      className={`schematic fsys__schematic ${className}`}
      role="group"
      aria-label="Diagram of the Foundry's system: an idea's route from you to the live site"
    >
      {edges.map((e, i) => (
        <Wire key={edgeKey(e)} popId={`${keyPrefix}-${edgeKey(e)}`} layout={layout} edge={e} from={byId.get(e.from)!} to={byId.get(e.to)!} index={i} />
      ))}
      {nodes.map((n) => (
        <Part key={n.id} popId={`${keyPrefix}-${n.id}`} layout={layout} node={n} edges={edges} byId={byId} />
      ))}
    </svg>
  );
}

/** A wire, which explains what travels along it and how it's routed. */
function Wire({ popId, layout, edge: e, from, to, index }: { popId: string; layout: Layout; edge: GraphEdge; from: GraphNode; to: GraphNode; index: number }) {
  const pop = useFlowPop(popId, e.state);
  const pa = layout.nodes[e.from];
  const pb = layout.nodes[e.to];
  const d = curve(pa, pb);
  const mid: Pt = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  return (
    <g className={`wire wire--${e.state} fsys__wire ${pop.open ? "is-picked" : ""}`} aria-label={`${from.label} to ${to.label}: ${e.label}, ${LINK_STATE_LABEL[e.state]}`} {...pop.props}>
      <path d={d} className="wire__track" />
      <path d={d} className="wire__flow" style={{ animationDelay: `${-index * 0.37}s` }} />
      <path d={d} className="fsys__hit" />
      {e.state === "down" && (
        <g transform={`translate(${mid[0]} ${mid[1]})`} className="wire__break">
          <circle r="9" />
          <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" />
        </g>
      )}
      {pop.card(
        <>
          <span className="fsys__eyebrow">
            Route · {from.label} → {to.label}
          </span>
          <h3 className="fsys__title">{e.label}</h3>
          <StatePill state={e.state} text={LINK_STATE_LABEL[e.state]} />
          <p className="fsys__what">{e.what}</p>
          <dl className="conn-pop__facts flow-pop__ties">
            <div>
              <dt>From</dt>
              <dd>
                {from.label} · {from.status}
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>
                {to.label} · {to.status}
              </dd>
            </div>
          </dl>
        </>,
      )}
    </g>
  );
}

/** A part, which explains what it is, its live reading, where that comes from, and what it's wired to. */
function Part({ popId, layout, node: n, edges, byId }: { popId: string; layout: Layout; node: GraphNode; edges: GraphEdge[]; byId: Map<GraphNodeId, GraphNode> }) {
  const pop = useFlowPop(popId, n.state);
  const pt = layout.nodes[n.id];
  const load = Math.max(0, Math.min(1, n.load));
  const c = 2 * Math.PI * 30;
  const ties = routesOf(edges, n.id);
  const names = (ids: GraphNodeId[]) => ids.map((id) => byId.get(id)?.label ?? id);
  return (
    <g
      transform={`translate(${pt[0]} ${pt[1]})`}
      className={`node node--${n.state} ${n.kind === "agent" ? "node--agent" : ""} fsys__node ${pop.open ? "is-picked" : ""}`}
      aria-label={`${n.label}, ${n.sub}: ${n.status}`}
      {...pop.props}
    >
      <circle r="40" className="fsys__ring" />
      <circle r="34" className="node__aura" />
      <circle r="30" className="node__gauge-track" />
      <circle r="30" className="node__gauge" strokeDasharray={`${(c * load).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90)" />
      <Shape kind={n.kind} />
      <circle r="4" className="node__core" />
      <text y={52} className="node__label">
        {n.label}
      </text>
      <text y={65} className="node__sub">
        {n.sub}
      </text>
      <text y={78} className="node__state">
        {n.status}
      </text>
      {pop.card(
        <>
          <span className="fsys__eyebrow">Part · {n.sub}</span>
          <h3 className="fsys__title">{n.label}</h3>
          <StatePill state={n.state} text={n.status} />
          <p className="fsys__what">{n.what}</p>
          <p className="fsys__source">{n.source}</p>
          <FlowTies from={names(ties.from)} to={names(ties.to)} />
          {n.url && (
            <a className="fsys__link" href={n.url} target="_blank" rel="noreferrer">
              Open →
            </a>
          )}
        </>,
      )}
    </g>
  );
}

/** What api/foundry says is set up, asked once per visit to the page. */
function useSetup(): FoundrySetup {
  const [setup, setSetup] = useState<FoundrySetup>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/foundry")
      .then((r) =>
        r.ok && (r.headers.get("content-type") ?? "").includes("json")
          ? (r.json() as Promise<{
              direct?: boolean;
              shape?: boolean;
              images?: boolean;
            }>)
          : null,
      )
      .then(
        (s) =>
          live &&
          setSetup(
            s
              ? {
                  direct: s.direct ?? false,
                  shape: s.shape ?? false,
                  images: s.images ?? false,
                }
              : "unreached",
          ),
      )
      .catch(() => live && setSetup("unreached"));
    return () => {
      live = false;
    };
  }, []);
  return setup;
}

export function FoundryDiagram({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const setup = useSetup();
  const next = nextCheck(now);
  const { nodes, edges } = useMemo(() => foundryGraph({ now, connected, data, setup, nextCheck: next }), [now, connected, data, setup, next]);
  const cap = capUse(data.crates);
  const working = nodes.filter((n) => n.state === "ok").length;

  return (
    <div className="fsys">
      <div className="fsys__map">
        <PopScope prefix="fsys">
          <Diagram layout={WIDE} nodes={nodes} edges={edges} className="schematic--wide" keyPrefix="wide" />
          <Diagram layout={TALL} nodes={nodes} edges={edges} className="schematic--tall" keyPrefix="tall" />
        </PopScope>
        <p className="fsys__hint">Hover or tap any part or wire to see what it is, how work is routed through it, and where its reading comes from.</p>
      </div>
        <dl className="fsys__readouts">
          <div>
            <dt>Jobs at once</dt>
            <dd>
              <b>{connected ? cap.inCap : "–"}</b> / {MAX_AT_ONCE}
            </dd>
          </div>
          <div>
            <dt>Emergency slot</dt>
            <dd>
              <b>{connected ? cap.outside : "–"}</b> running
            </dd>
          </div>
          <div>
            <dt>Waiting a turn</dt>
            <dd>
              <b>{connected ? cap.waiting : "–"}</b> {cap.waiting === 1 ? "job" : "jobs"}
            </dd>
          </div>
          <div>
            <dt>Checks on main</dt>
            <dd>{data.checks.at ? `${nodes.find((n) => n.id === "checks")!.status} · ${ago(data.checks.at, now)}` : "No run read"}</dd>
          </div>
          <div>
            <dt>Last push to main</dt>
            <dd>{data.lastCommit ? ago(data.lastCommit.at, now) : "Not read yet"}</dd>
          </div>
          <div>
            <dt>Parts working</dt>
            <dd>
              <b>{working}</b> of {nodes.length}
            </dd>
          </div>
        </dl>
      <ul className="systems__legend fsys__legend" aria-label="Legend">
        <li className="ok">Working</li>
        <li className="slow">Busy or waiting</li>
        <li className="down">Down or stuck</li>
        <li className="off">Not connected or not measurable</li>
        <li className="fsys__key fsys__key--agent">Crew</li>
        <li className="fsys__key fsys__key--service">Service</li>
        <li className="fsys__key fsys__key--store">Store</li>
      </ul>
    </div>
  );
}
