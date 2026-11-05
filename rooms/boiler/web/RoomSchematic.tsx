import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { STATE_SAY, type RoomPipe, type RoomSection } from "../data/rooms.ts";
import { cardOf, NODE_H, NODE_W, schematic, type SchemLink, type SchemModel, type SchemNode } from "../data/schematic.ts";

/**
 * A room's own schematic on the Map (#751), in the pipes' brass: each part a plate with its kind and live state, each
 * connection a pipe in its state's colour (flowing, late, shut, broken with a crack, dashed while not connected), and
 * every plate and pipe opening its card. Laid out by boiler/schematic.ts from the real model; left to right on a desk,
 * top to bottom on a phone. Plain SVG, so it costs the page no 3D.
 */

const KIND_WORD: Record<SchemNode["kind"], string> = { person: "you", service: "service", agent: "agent", store: "storage", room: "room", job: "schedule", planned: "planned" };

export type SchemTarget = { pipe: RoomPipe; el: Element };

export function RoomSchematic({
  section,
  model,
  current,
  onHover,
  onPick,
}: {
  section: RoomSection;
  model: SchemModel;
  current: string | null;
  onHover: (t: SchemTarget | null) => void;
  onPick: (t: SchemTarget) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 900, h: 560 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dir = size.w < 600 ? "tb" : "lr";
  const sch = schematic(section, model, dir);
  // Fit it to the map when it can be read that small; past that it scrolls.
  const scale = Math.max(dir === "lr" ? 0.62 : 0.55, Math.min(1.15, (size.w - 16) / sch.w, dir === "lr" ? (size.h - 52) / sch.h : 9));
  const pipeFor = (t: { node: SchemNode } | { link: SchemLink }): RoomPipe => {
    const id = "node" in t ? t.node.pipe : t.link.pipe;
    return (id && section.pipes.find((p) => p.id === id)) || cardOf(t, section, sch.nodes);
  };
  const act = (t: { node: SchemNode } | { link: SchemLink }) => ({
    tabIndex: 0,
    role: "button",
    onMouseEnter: (e: React.MouseEvent) => onHover({ pipe: pipeFor(t), el: e.currentTarget }),
    onMouseLeave: () => onHover(null),
    onFocus: (e: React.FocusEvent) => onHover({ pipe: pipeFor(t), el: e.currentTarget }),
    onBlur: () => onHover(null),
    onClick: (e: React.MouseEvent) => onPick({ pipe: pipeFor(t), el: e.currentTarget }),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick({ pipe: pipeFor(t), el: e.currentTarget });
      }
    },
  });
  // A link's words fit the gap between columns; its card has them whole.
  const lblMax = dir === "lr" ? 17 : 26;
  const broken = sch.links.filter((l) => l.state === "leak" || l.state === "shut").length;

  return (
    <div className={`bp-schem is-${dir}`} ref={box} style={{ "--rc": section.c } as CSSProperties} data-room-schematic={section.id}>
      <p className="bp-schem-h">
        <b style={{ color: section.c }}>{section.name}</b> · schematic · {sch.nodes.length} parts, {sch.links.length} links
        {broken ? <em> · {broken} broken</em> : null}
      </p>
      <svg className="bp-schem-svg" viewBox={`0 0 ${sch.w} ${sch.h}`} width={Math.round(sch.w * scale)} height={Math.round(sch.h * scale)} role="group" aria-label={`${section.name}: every part and connection`}>
        {sch.links.map((l) => {
          const pipe = l.pipe ?? `schem:${section.id}:${l.id}`;
          const a = sch.nodes.find((n) => n.id === l.a)!;
          const b = sch.nodes.find((n) => n.id === l.b)!;
          return (
            <g key={l.id} className={`sc-link is-${l.state}${current === pipe ? " is-cur" : ""}`} aria-label={`${a.name} to ${b.name}${l.label ? `, ${l.label}` : ""}: ${STATE_SAY[l.state]}`} data-link={l.id} data-pipe={pipe} {...act({ link: l })}>
              <path className="sc-case" d={l.d} />
              <path className="sc-core" d={l.d} />
              {l.state === "ok" || l.state === "late" ? <path className="sc-flow" d={l.d} /> : null}
              <path className="sc-hit" d={l.d} />
              {l.state === "leak" || l.state === "shut" ? (
                <g className="sc-crack" transform={`translate(${l.mid[0]} ${l.mid[1]})`}>
                  <circle r="9" />
                  <path d={l.state === "leak" ? "M-4 -4L4 4M4 -4L-4 4" : "M-5 0H5"} />
                </g>
              ) : l.label ? (
                <text className="sc-lbl" x={l.mid[0]} y={l.mid[1] - 8} textAnchor="middle">
                  {l.label.length > lblMax ? `${l.label.slice(0, lblMax - 1)}…` : l.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {sch.nodes.map((n) => {
          const pipe = n.pipe ?? `schem:${section.id}:${n.id}`;
          const x = n.x - NODE_W / 2;
          const y = n.y - NODE_H / 2;
          return (
            <g key={n.id} className={`sc-node is-${n.state} k-${n.kind}${current === pipe ? " is-cur" : ""}`} aria-label={`${n.name}, ${KIND_WORD[n.kind]}: ${STATE_SAY[n.state]}`} data-node={n.id} data-pipe={pipe} {...act({ node: n })}>
              <rect className="sc-plate" x={x} y={y} width={NODE_W} height={NODE_H} rx="6" />
              <rect className="sc-band" x={x} y={y} width="4" height={NODE_H} rx="2" />
              <circle className="sc-port" cx={sch.dir === "lr" ? x : n.x} cy={sch.dir === "lr" ? n.y : y} r="3.5" />
              <circle className="sc-port" cx={sch.dir === "lr" ? x + NODE_W : n.x} cy={sch.dir === "lr" ? n.y : y + NODE_H} r="3.5" />
              <text className="sc-name" x={x + 14} y={y + 22}>
                {n.name.length > 19 ? `${n.name.slice(0, 18)}…` : n.name}
              </text>
              <text className="sc-sub" x={x + 14} y={y + 40}>
                {n.sub.length > 24 ? `${n.sub.slice(0, 23)}…` : n.sub}
              </text>
              <text className="sc-kind" x={x + NODE_W - 10} y={y + 14} textAnchor="end">
                {KIND_WORD[n.kind]}
              </text>
              <circle className="sc-lamp" cx={x + NODE_W - 12} cy={y + NODE_H - 13} r="4" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
