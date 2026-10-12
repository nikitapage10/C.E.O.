import { useMemo } from "react";
import { daysSinceIncident, LINK_STATE_LABEL, useSystems, type Link, type LinkState } from "../systems.ts";

/**
 * Systems: the real links Relay depends on, drawn as a schematic. Working links carry flowing current,
 * slow ones pulse amber, a down link breaks red, and anything not connected yet is a grey dotted line.
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

function Diagram({ layout, links, className }: { layout: Layout; links: Link[]; className: string }) {
  const tall = layout === TALL;
  const byId = new Map(links.map((l) => [l.id, l]));
  return (
    <svg viewBox={`0 0 ${layout.w} ${layout.h}`} className={`schematic ${className}`} role="img" aria-label="Diagram of the links Relay depends on">
      <defs>
        <pattern id={`grid-${className}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" className="schematic__grid" />
        </pattern>
      </defs>
      <rect width={layout.w} height={layout.h} fill={`url(#grid-${className})`} />
      {EDGES.map(([a, b], i) => {
        const pa = layout.nodes[a];
        const pb = layout.nodes[b];
        if (!pa || !pb) return null;
        const state = edgeState(byId.get(a), byId.get(b));
        const d = curve(pa, pb, tall);
        const mid: Pt = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        return (
          <g key={`${a}-${b}`} className={`wire wire--${state}`}>
            <path d={d} className="wire__track" />
            <path d={d} className="wire__flow" style={{ animationDelay: `${-i * 0.37}s` }} />
            {state === "down" && (
              <g transform={`translate(${mid[0]} ${mid[1]})`} className="wire__break">
                <circle r="9" />
                <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" />
              </g>
            )}
          </g>
        );
      })}
      {links.map((l) => {
        const p = layout.nodes[l.id];
        if (!p) return null;
        const load = Math.max(0, Math.min(1, l.load));
        const c = 2 * Math.PI * 30;
        return (
          <g key={l.id} transform={`translate(${p[0]} ${p[1]})`} className={`node node--${l.state} node--${l.kind}`}>
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
          </g>
        );
      })}
    </svg>
  );
}

export function SystemsPanel({ now }: { now: number }) {
  const all = useSystems((s) => s.links);
  const links = useMemo(() => all.filter((l) => l.room === "relay"), [all]);
  const lastIncident = useSystems((s) => s.lastIncident);
  const working = links.filter((l) => l.state === "ok").length;
  const days = Math.max(0, daysSinceIncident(lastIncident, now));
  const digits = String(Math.min(999, days)).padStart(3, "0").split("");
  const anyDown = links.some((l) => l.state === "down");

  return (
    <div className="systems">
      <div className="systems__map">
        <Diagram layout={WIDE} links={links} className="schematic--wide" />
        <Diagram layout={TALL} links={links} className="schematic--tall" />
        <ul className="systems__legend" aria-hidden="true">
          <li className="ok">Working</li>
          <li className="slow">Slow</li>
          <li className="down">Down</li>
          <li className="off">Not connected</li>
        </ul>
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
