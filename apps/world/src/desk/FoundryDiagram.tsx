import { useEffect, useMemo, useState } from "react";
import { MAX_AT_ONCE, useFoundry } from "../foundry.ts";
import { LINK_STATE_LABEL, type LinkState } from "../systems.ts";
import { ago, capUse, foundryGraph, type FoundrySetup, type GraphEdge, type GraphKind, type GraphNode, type GraphNodeId } from "./foundryGraph.ts";
import { nextCheck } from "./FoundryPage.tsx";

/**
 * The Foundry's system, drawn like Relay's: an idea's route from Nikita to the live site, each part lit by its real
 * state. Every part and every wire can be hovered, focused or tapped to say what it is and where its reading comes
 * from. The states are worked out in foundryGraph.ts.
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

/** What's picked: a part, or a wire by its two ends. */
type Pick = { node: GraphNodeId } | { edge: string } | null;
const edgeKey = (e: GraphEdge) => `${e.from}-${e.to}`;

function Diagram({
  layout,
  nodes,
  edges,
  pick,
  onPick,
  className,
}: {
  layout: Layout;
  nodes: GraphNode[];
  edges: GraphEdge[];
  pick: Pick;
  onPick: (p: Pick) => void;
  className: string;
}) {
  const picked = (p: Pick) => JSON.stringify(p) === JSON.stringify(pick);
  const keys = (p: Pick) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(p);
    }
  };
  return (
    <svg
      viewBox={`0 0 ${layout.w} ${layout.h}`}
      className={`schematic fsys__schematic ${className}`}
      role="group"
      aria-label="Diagram of the Foundry's system: an idea's route from you to the live site"
    >
      {edges.map((e, i) => {
        const pa = layout.nodes[e.from];
        const pb = layout.nodes[e.to];
        const d = curve(pa, pb);
        const mid: Pt = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const p: Pick = { edge: edgeKey(e) };
        const name = nodes.find((n) => n.id === e.from)!.label + " to " + nodes.find((n) => n.id === e.to)!.label;
        return (
          <g
            key={edgeKey(e)}
            className={`wire wire--${e.state} fsys__wire ${picked(p) ? "is-picked" : ""}`}
            tabIndex={0}
            role="button"
            aria-label={`${name}: ${e.label}, ${LINK_STATE_LABEL[e.state]}`}
            onMouseEnter={() => onPick(p)}
            onFocus={() => onPick(p)}
            onClick={() => onPick(p)}
            onKeyDown={keys(p)}
          >
            <path d={d} className="wire__track" />
            <path d={d} className="wire__flow" style={{ animationDelay: `${-i * 0.37}s` }} />
            <path d={d} className="fsys__hit" />
            {e.state === "down" && (
              <g transform={`translate(${mid[0]} ${mid[1]})`} className="wire__break">
                <circle r="9" />
                <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" />
              </g>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const pt = layout.nodes[n.id];
        const load = Math.max(0, Math.min(1, n.load));
        const c = 2 * Math.PI * 30;
        const p: Pick = { node: n.id };
        return (
          <g
            key={n.id}
            transform={`translate(${pt[0]} ${pt[1]})`}
            className={`node node--${n.state} ${n.kind === "agent" ? "node--agent" : ""} fsys__node ${picked(p) ? "is-picked" : ""}`}
            tabIndex={0}
            role="button"
            aria-label={`${n.label}, ${n.sub}: ${n.status}`}
            onMouseEnter={() => onPick(p)}
            onFocus={() => onPick(p)}
            onClick={() => onPick(p)}
            onKeyDown={keys(p)}
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
          </g>
        );
      })}
    </svg>
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

function Detail({ pick, nodes, edges }: { pick: Pick; nodes: GraphNode[]; edges: GraphEdge[] }) {
  const node = pick && "node" in pick ? nodes.find((n) => n.id === pick.node) : undefined;
  const edge = pick && "edge" in pick ? edges.find((e) => edgeKey(e) === pick.edge) : undefined;
  if (node) {
    return (
      <div className={`fsys__detail fsys__detail--${node.state}`} aria-live="polite">
        <span className="fsys__eyebrow">Part · {node.sub}</span>
        <h3 className="fsys__title">{node.label}</h3>
        <StatePill state={node.state} text={node.status} />
        <p className="fsys__what">{node.what}</p>
        <p className="fsys__source">{node.source}</p>
        {node.url && (
          <a className="fsys__link" href={node.url} target="_blank" rel="noreferrer">
            Open →
          </a>
        )}
      </div>
    );
  }
  if (edge) {
    const from = nodes.find((n) => n.id === edge.from)!;
    const to = nodes.find((n) => n.id === edge.to)!;
    return (
      <div className={`fsys__detail fsys__detail--${edge.state}`} aria-live="polite">
        <span className="fsys__eyebrow">
          Route · {from.label} → {to.label}
        </span>
        <h3 className="fsys__title">{edge.label}</h3>
        <StatePill state={edge.state} text={LINK_STATE_LABEL[edge.state]} />
        <p className="fsys__what">{edge.what}</p>
      </div>
    );
  }
  return (
    <div className="fsys__detail fsys__detail--empty">
      <span className="fsys__eyebrow">How to read it</span>
      <p className="fsys__what">Hover or tap any part or wire to see what it is, how work is routed through it, and where its reading comes from.</p>
    </div>
  );
}

function StatePill({ state, text }: { state: LinkState; text: string }) {
  return (
    <span className={`pill pill--${state}`}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

export function FoundryDiagram({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const setup = useSetup();
  const next = nextCheck(now);
  const { nodes, edges } = useMemo(() => foundryGraph({ now, connected, data, setup, nextCheck: next }), [now, connected, data, setup, next]);
  const [pick, setPick] = useState<Pick>(null);
  const cap = capUse(data.crates);
  const working = nodes.filter((n) => n.state === "ok").length;

  return (
    <div className="fsys">
      <div className="fsys__map">
        <Diagram layout={WIDE} nodes={nodes} edges={edges} pick={pick} onPick={setPick} className="schematic--wide" />
        <Diagram layout={TALL} nodes={nodes} edges={edges} pick={pick} onPick={setPick} className="schematic--tall" />
      </div>
      <div className="fsys__under">
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
        <Detail pick={pick} nodes={nodes} edges={edges} />
      </div>
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
