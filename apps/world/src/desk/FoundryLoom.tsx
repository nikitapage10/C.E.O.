import { useState } from "react";
import { CREW, MODEL, crewOf, modelOf, openIdeas, type Change, type Crate, type FoundryData } from "../foundry.ts";
import { formatWait } from "./deskData.ts";
import { CountUp, useWidth } from "./motion.tsx";
import { Avatar } from "./ui.tsx";

/**
 * The Foundry's loom (the Weave, Nikita 2026-10-22): every piece of work in flight as a thread, braided in from the
 * left and tied off at its stage (ideas, building, checked and waiting on you, shipped in the last day), coloured by
 * whoever holds it: Rivet's mint, Rusty's blue, Rocky's amber (the models' own colours), the Foundry's orange for an
 * idea nobody holds yet. Motes run along what is being built right now. Tap a knot to follow its thread; the card
 * below says what it is, who has it and where it stands. Real GitHub data only.
 */

type Stage = "ideas" | "building" | "checked" | "shipped";
const STAGES: { id: Stage; label: string; x: number }[] = [
  { id: "ideas", label: "Ideas", x: 0.17 },
  { id: "building", label: "Building", x: 0.4 },
  { id: "checked", label: "Checked, your call", x: 0.62 },
  { id: "shipped", label: "Shipped, last day", x: 0.82 },
];

interface Strand {
  key: string;
  stage: Stage;
  title: string;
  colour: string;
  who: string | null;
  model: string | null;
  url: string | null;
  at: number;
  state: string;
  short: string;
  moving: boolean;
}

const DAY = 86_400_000;
const clean = (t: string) => t.replace(/^Idea:\s*/i, "");

function strands(data: FoundryData, pending: Crate[], now: number): Strand[] {
  const out: Strand[] = [];
  const crates = data.crates;
  for (const c of openIdeas(crates, pending)) {
    out.push({ key: `i${c.number}`, stage: "ideas", title: clean(c.title), colour: "var(--room-foundry)", who: c.builder ? CREW[c.builder].name : null, model: c.model ?? null, url: c.url || null, at: c.updatedAt, state: c.revising ? "Being reshaped" : c.asking ? "Rivet has a question" : "Waiting for your pick", short: c.pitch, moving: false });
  }
  for (const c of crates) {
    if (c.kind === "idea" || c.state === "shipped" || c.state === "queued") continue;
    const who = crewOf(c, crates);
    const stage: Stage = c.state === "working" ? "building" : "checked";
    out.push({
      key: `c${c.number}`,
      stage,
      title: clean(c.title),
      colour: MODEL[who].colour,
      who: CREW[who].name,
      model: modelOf(c, who),
      url: c.url,
      at: c.updatedAt,
      state: c.state === "working" ? (c.paused ? "Paused" : "Building now") : c.state === "stuck" ? "Stuck after every rung" : "Built and checked, waiting for your OK",
      short: c.short || c.pitch,
      moving: c.state === "working" && !c.paused,
    });
  }
  for (const ch of data.changelog.filter((x: Change) => now - x.at < DAY).slice(0, 6)) {
    out.push({ key: `s${ch.key}`, stage: "shipped", title: ch.title, colour: ch.by ? MODEL[ch.by].colour : "var(--room-foundry)", who: ch.by ? CREW[ch.by].name : null, model: null, url: ch.landed?.url ?? ch.issue?.url ?? null, at: ch.at, state: "Shipped", short: ch.short, moving: false });
  }
  return out;
}

export function FoundryLoom({ data, pending, now, connected }: { data: FoundryData; pending: Crate[]; now: number; connected: boolean }) {
  const [box, width] = useWidth<HTMLDivElement>(1100);
  const all = strands(data, pending, now);
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = all.find((s) => s.key === picked) ?? all.find((s) => s.moving) ?? null;
  const narrow = width < 640;
  const h = narrow ? 260 : 290;
  const top = 70;
  const bottom = h - 22;

  // Each stage's strands stack around the middle; the threads braid in from the left edge.
  const placed = all.map((s) => {
    const group = all.filter((x) => x.stage === s.stage);
    const k = group.indexOf(s);
    const spread = Math.min(46, (bottom - top - 30) / Math.max(1, group.length));
    const y = (top + bottom) / 2 + (k - (group.length - 1) / 2) * spread;
    const stage = STAGES.find((st) => st.id === s.stage)!;
    const x = stage.x * width;
    const y0 = (top + bottom) / 2 + Math.sin(all.indexOf(s) * 1.7) * 40;
    const d = `M0 ${y0.toFixed(1)} C${(x * 0.3).toFixed(1)} ${(y0 + 60).toFixed(1)}, ${(x * 0.55).toFixed(1)} ${(y - 70).toFixed(1)}, ${(x * 0.78).toFixed(1)} ${(y + 6).toFixed(1)} S${(x - 10).toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    return { ...s, x, y, d };
  });

  const count = (id: Stage) => all.filter((s) => s.stage === id).length;

  return (
    <section className="fy-loom" aria-label="The Foundry's loom: work in flight">
      <div className="fy-loom__stage" ref={box}>
        <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={`${all.length} pieces of work: ${STAGES.map((s) => `${count(s.id)} ${s.label}`).join(", ")}`}>
          {STAGES.map((st) => (
            <g key={st.id} className="fy-loom__col">
              <line x1={st.x * width} x2={st.x * width} y1={top - 6} y2={bottom} />
            </g>
          ))}
          {placed.map((s, i) => (
            <g key={s.key} className={`fy-loom__strand ${chosen?.key === s.key ? "on" : chosen ? "dim" : ""} ${s.moving ? "moving" : ""}`} style={{ "--c": s.colour, "--i": i } as React.CSSProperties}>
              <path className="fy-loom__glow" d={s.d} />
              <path className="fy-loom__line" d={s.d} pathLength={1} />
              {s.moving && [0, 1, 2].map((m) => <circle key={m} className="fy-loom__mote" r="2.6" style={{ offsetPath: `path("${s.d}")`, animationDelay: `${m * -1.1}s` } as React.CSSProperties} />)}
              <circle className="fy-loom__knot" cx={s.x} cy={s.y} r={s.moving ? 6 : 4.5} />
              <circle
                className="fy-loom__hit"
                cx={s.x}
                cy={s.y}
                r="16"
                role="button"
                tabIndex={0}
                aria-label={`${s.title}: ${s.state}`}
                onClick={() => setPicked(s.key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPicked(s.key))}
              />
              {!narrow && (
                <text x={s.x + 12} y={s.y + 4} className="fy-loom__label">
                  {s.title.length > 26 ? `${s.title.slice(0, 25)}…` : s.title}
                </text>
              )}
            </g>
          ))}
        </svg>
        <ol className="fy-loom__heads">
          {STAGES.map((st) => (
            <li key={st.id} style={{ left: `${st.x * 100}%` }}>
              <b>
                <CountUp value={count(st.id)} />
              </b>
              <span>{st.label}</span>
            </li>
          ))}
        </ol>
        {!all.length && <p className="fy-loom__empty">{connected ? "The loom is bare: nothing in flight, nothing shipped in the last day." : "Reaching GitHub for the crew's work…"}</p>}
      </div>
      {chosen && (
        <div className="fy-loom__card" key={chosen.key} style={{ "--c": chosen.colour } as React.CSSProperties}>
          {chosen.who && <Avatar agent={chosen.who} room="foundry" />}
          <div className="fy-loom__what">
            <p className="eyebrow">
              {chosen.state}
              {chosen.who ? ` · ${chosen.who}${chosen.model ? ` on ${chosen.model}` : ""}` : ""} · {formatWait(now - chosen.at)} ago
            </p>
            <h3>{chosen.title}</h3>
            {chosen.short && <p>{chosen.short}</p>}
          </div>
          {chosen.url && (
            <a className="btn btn--sm" href={chosen.url} target="_blank" rel="noreferrer">
              Follow the thread →
            </a>
          )}
        </div>
      )}
    </section>
  );
}
