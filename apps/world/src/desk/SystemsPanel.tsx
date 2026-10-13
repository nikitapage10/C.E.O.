import { useMemo } from "react";
import { daysSinceIncident, LINK_STATE_LABEL, useSystems, type Link, type LinkState } from "../systems.ts";
import { FlowTies, StatePill, useFlowPop } from "./FlowPop.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import { routesOf } from "./popover.ts";
import { PopScope } from "./Popovers.tsx";

/**
 * Systems: the real links Relay depends on, drawn as a schematic. Working links carry flowing current,
 * slow ones pulse amber, a down link breaks red, and anything not connected yet is a grey dotted line. Every link and
 * wire can be hovered, focused or tapped to say what it is and how it connects, in a pop-over at the mouse (#94).
 */

type Pt = [number, number];
interface Layout {
  w: number;
  h: number;
  nodes: Record<string, Pt>;
}

const EDGES: [string, string][] = [
  ["mac", "hub"],
  ["hub", "bluebubbles"],
  ["hub", "messages"],
  ["hub", "openai"],
  ["bluebubbles", "dialtone"],
  ["messages", "dialtone"],
  ["bluebubbles", "postmaster"],
  ["openai", "postmaster"],
];

/** The same wires by their ends, for what feeds each link and what it feeds. */
const WIRES = EDGES.map(([from, to]) => ({ from, to }));

const WIDE: Layout = {
  w: 760,
  h: 350,
  nodes: { mac: [70, 170], hub: [240, 170], bluebubbles: [440, 52], messages: [440, 170], openai: [440, 288], dialtone: [670, 108], postmaster: [670, 232] },
};

const TALL: Layout = {
  w: 360,
  h: 540,
  nodes: { mac: [180, 46], hub: [180, 150], bluebubbles: [62, 292], messages: [180, 292], openai: [298, 292], dialtone: [110, 450], postmaster: [250, 450] },
};

const RANK: Record<LinkState, number> = { ok: 0, slow: 1, off: 2, down: 3 };

/** A link is only as good as its weaker end. */
function edgeState(a: Link | undefined, b: Link | undefined): LinkState {
  const sa = a?.state ?? "off";
  const sb = b?.state ?? "off";
  return RANK[sa] >= RANK[sb] ? sa : sb;
}

function curve([x0, y0]: Pt, [x1, y1]: Pt, tall: boolean) {
  if (tall) {
    const my = (y0 + y1) / 2;
    return `M ${x0} ${y0} C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`;
  }
  const mx = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
}

function Shape({ kind }: { kind: Link["kind"] }) {
  if (kind === "machine") return <rect x="-22" y="-16" width="44" height="32" rx="4" className="node__shape" />;
  if (kind === "agent") return <polygon points="0,-24 21,-12 21,12 0,24 -21,12 -21,-12" className="node__shape" />;
  return <circle r="21" className="node__shape" />;
}

function Diagram({ layout, links, className, keyPrefix }: { layout: Layout; links: Link[]; className: string; keyPrefix: string }) {
  const tall = layout === TALL;
  const byId = new Map(links.map((l) => [l.id, l]));
  return (
    <svg viewBox={`0 0 ${layout.w} ${layout.h}`} className={`schematic fsys__schematic ${className}`} role="group" aria-label="Diagram of the links Relay depends on">
      {EDGES.map(([a, b], i) => {
        const pa = layout.nodes[a];
        const pb = layout.nodes[b];
        const la = byId.get(a);
        const lb = byId.get(b);
        if (!pa || !pb || !la || !lb) return null;
        return <Wire key={`${a}-${b}`} popId={`${keyPrefix}-${a}-${b}`} d={curve(pa, pb, tall)} mid={[(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]} from={la} to={lb} index={i} />;
      })}
      {links.map((l) => {
        const p = layout.nodes[l.id];
        if (!p) return null;
        return <Part key={l.id} popId={`${keyPrefix}-${l.id}`} at={p} link={l} tall={tall} byId={byId} />;
      })}
    </svg>
  );
}

/** A wire between two links, which explains that it's only as good as its weaker end. */
function Wire({ popId, d, mid, from, to, index }: { popId: string; d: string; mid: Pt; from: Link; to: Link; index: number }) {
  const state = edgeState(from, to);
  const pop = useFlowPop(popId, state);
  return (
    <g className={`wire wire--${state} fsys__wire ${pop.open ? "is-picked" : ""}`} aria-label={`${from.label} to ${to.label}: ${LINK_STATE_LABEL[state]}`} {...pop.props}>
      <path d={d} className="wire__track" />
      <path d={d} className="wire__flow" style={{ animationDelay: `${-index * 0.37}s` }} />
      <path d={d} className="fsys__hit" />
      {state === "down" && (
        <g transform={`translate(${mid[0]} ${mid[1]})`} className="wire__break">
          <circle r="9" />
          <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" />
        </g>
      )}
      {pop.card(
        <>
          <span className="fsys__eyebrow">Route</span>
          <h3 className="fsys__title">
            {from.label} → {to.label}
          </h3>
          <StatePill state={state} text={LINK_STATE_LABEL[state]} />
          <p className="fsys__what">A link is only as good as its weaker end.</p>
          <dl className="conn-pop__facts flow-pop__ties">
            <div>
              <dt>From</dt>
              <dd>
                {from.label} · {LINK_STATE_LABEL[from.state]}
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>
                {to.label} · {LINK_STATE_LABEL[to.state]}
              </dd>
            </div>
          </dl>
        </>,
      )}
    </g>
  );
}

/** A link, which explains what it is, when the hub last heard from it, and what it's wired to. */
function Part({ popId, at, link: l, tall, byId }: { popId: string; at: Pt; link: Link; tall: boolean; byId: Map<string, Link> }) {
  const pop = useFlowPop(popId, l.state);
  const load = Math.max(0, Math.min(1, l.load));
  const c = 2 * Math.PI * 30;
  const ties = routesOf(WIRES, l.id);
  const names = (ids: string[]) => ids.map((id) => byId.get(id)?.label ?? id);
  return (
    <g
      transform={`translate(${at[0]} ${at[1]})`}
      className={`node node--${l.state} node--${l.kind} fsys__node ${pop.open ? "is-picked" : ""}`}
      aria-label={`${l.label}: ${LINK_STATE_LABEL[l.state]}`}
      {...pop.props}
    >
      <circle r="40" className="fsys__ring" />
      <circle r="34" className="node__aura" />
      <circle r="30" className="node__gauge-track" />
      <circle r="30" className="node__gauge" strokeDasharray={`${(c * load).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90)" />
      <Shape kind={l.kind} />
      <circle r="4" className="node__core" />
      <text y={tall ? 50 : 52} className="node__label">
        {l.label}
      </text>
      <text y={tall ? 63 : 65} className="node__state">
        {LINK_STATE_LABEL[l.state]}
      </text>
      {pop.card(
        <>
          <span className="fsys__eyebrow">Part · {l.kind}</span>
          <h3 className="fsys__title">{l.label}</h3>
          <StatePill state={l.state} text={LINK_STATE_LABEL[l.state]} />
          <p className="fsys__what">{l.what}</p>
          <p className="fsys__source">{l.lastSeen ? `Heard ${new Date(l.lastSeen).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}` : "Never heard from"}</p>
          {l.note && <p className="fsys__what">{l.note}</p>}
          <FlowTies from={names(ties.from)} to={names(ties.to)} />
          <HowItWorks system="relay" part={l.id} />
        </>,
      )}
    </g>
  );
}

export function SystemsPanel({ now }: { now: number }) {
  const all = useSystems((s) => s.links);
  const links = useMemo(() => all.filter((l) => l.room === "relay"), [all]);
  const lastIncident = useSystems((s) => s.lastIncident);
  const working = links.filter((l) => l.state === "ok").length;
  const days = Math.max(0, daysSinceIncident(lastIncident, now));
  const digits = String(Math.min(999, days)).split("");
  const anyDown = links.some((l) => l.state === "down");

  return (
    <div className="systems">
      <div className="systems__map">
        <PopScope prefix="relay-sys">
          <Diagram layout={WIDE} links={links} className="schematic--wide" keyPrefix="wide" />
          <Diagram layout={TALL} links={links} className="schematic--tall" keyPrefix="tall" />
        </PopScope>
        <ul className="systems__legend" aria-hidden="true">
          <li className="ok">Working</li>
          <li className="slow">Slow</li>
          <li className="down">Down</li>
          <li className="off">Not connected</li>
        </ul>
        <p className="fsys__hint">Hover or tap any part or wire to see what it is and how it connects.</p>
      </div>
      <aside className="systems__side">
        <div className={`incident ${anyDown ? "incident--alarm" : ""}`}>
          <span className="incident__eyebrow">Days since last incident</span>
          <div className="incident__digits" aria-label={`${days} days`}>
            {digits.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <span className="incident__cap">{anyDown ? "Something is down right now" : lastIncident === null ? "No incident on record" : `Last one ${new Date(lastIncident).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}</span>
        </div>
        <p className="systems__tally">
          <b>{working}</b> of {links.length} links working
        </p>

      </aside>
      <ul className="systems__list">
        {links.map((l) => (
          <li key={l.id} className={`link--${l.state}`}>
            <span className="systems__dot" aria-hidden="true" />
            <span className="systems__name">{l.label}</span>
            <span className="systems__what">{l.what}</span>
            <span className="systems__state">{LINK_STATE_LABEL[l.state]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
