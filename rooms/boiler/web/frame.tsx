import { useState, type CSSProperties, type ReactNode } from "react";
import { ago } from "../../../apps/world/src/desk/foundryGraph.ts";
import { needsLayout, type Need, type NeedGo } from "../data/pages.ts";
import "./pages.css";

/**
 * The frame the Boiler Room's Controls, Security and Compliance pages share (#746): a short head, then the "Needs you"
 * column beside the page's own board. With nothing waiting on Nikita the column isn't drawn at all, not even empty,
 * and the board runs the full width (Nikita, 2026-11-05: "when nothing needs me, that section just disappears").
 * Ink-dark like the Map, brass for the one accent, coral for what's broken.
 */

export function BoilerFrame({
  page,
  tabs,
  title,
  say,
  needs,
  now,
  onGo,
  children,
}: {
  page: "controls" | "security" | "compliance";
  tabs: ReactNode;
  title: ReactNode;
  say?: ReactNode;
  needs: readonly Need[];
  now: number;
  onGo: (go: NeedGo) => void;
  children?: ReactNode;
}) {
  const layout = needsLayout(needs);
  return (
    <div className={`bx bx-${page}`} data-room="boiler" data-needs={layout}>
      <header className="bx-top">
        <div className="bx-tt">
          <p className="bx-eyb">
            <span>Boiler Room</span> · {page[0]!.toUpperCase() + page.slice(1)}
          </p>
          <h1 className="bx-h1 desk__title">{title}</h1>
          {say ? <p className="bx-say">{say}</p> : null}
        </div>
        {tabs}
      </header>
      <div className="bx-body">
        {layout === "split" ? (
          <aside className="bx-needs" aria-label="Needs you">
            <p className="bx-k">Needs you · {needs.length}</p>
            {needs.map((n) => (
              <NeedCard key={n.id} n={n} now={now} onGo={onGo} />
            ))}
            <p className="bx-flav">The Pessimist keeps the boiler. He expected this.</p>
          </aside>
        ) : null}
        <div className="bx-main">{children}</div>
      </div>
    </div>
  );
}

function NeedCard({ n, now, onGo }: { n: Need; now: number; onGo: (go: NeedGo) => void }) {
  const when = n.when ?? (n.at ? ago(n.at, now) : null);
  return (
    <article className={`bx-need is-${n.tone}`} data-need={n.id}>
      <h3>
        <span>{n.title}</span>
        {when ? <small>{when}</small> : null}
      </h3>
      <p>{n.body}</p>
      {n.go ? (
        n.go.kind === "url" ? (
          <a className="bx-btn is-pri" href={n.go.href} target="_blank" rel="noopener noreferrer">
            {n.go.label} ↗
          </a>
        ) : (
          <button type="button" className="bx-btn is-pri" onClick={() => onGo(n.go!)}>
            {n.go.label}
          </button>
        )
      ) : n.locked ? (
        <p className="bx-locked">{n.locked}</p>
      ) : null}
    </article>
  );
}

/** A board panel: a title, a line under it, its chart, and its full detail folded under a toggle. */
export function Panel({
  id,
  title,
  sub,
  tone,
  open,
  onToggle,
  chart,
  children,
  className = "",
}: {
  id: string;
  title: string;
  sub?: ReactNode;
  tone?: string;
  open: boolean;
  onToggle: () => void;
  chart?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bx-panel ${open ? "is-open" : ""} ${className}`} id={id}>
      <header className="bx-ph">
        {tone ? <i className={`bx-dot is-${tone}`} aria-hidden="true" /> : null}
        <h2 id={`${id}-h`}>{title}</h2>
        {sub ? <span className="bx-psub">{sub}</span> : null}
        {children ? (
          <button type="button" className="bx-fold" aria-expanded={open} aria-controls={`${id}-d`} onClick={onToggle}>
            {open ? "Less" : "Details"}
            <i aria-hidden="true">{open ? "–" : "+"}</i>
          </button>
        ) : null}
      </header>
      {chart}
      {children && open ? (
        <div className="bx-detail" id={`${id}-d`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Which panels are open, one set per page. */
export function useOpen(initial: string[] = []): [Set<string>, (id: string, on?: boolean) => void] {
  const [open, setOpen] = useState(() => new Set(initial));
  const toggle = (id: string, on?: boolean) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  return [open, toggle];
}

/* ── the charts: plain SVG, decoration beside words that say the same (aria-hidden), no library ── */

/** A small area sparkline, its last value marked. */
export function Spark({ values, w = 120, h = 28 }: { values: readonly number[]; w?: number; h?: number }) {
  const max = Math.max(...values, 0);
  const n = values.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - (max > 0 ? (v / max) * (h - 7) : 0);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <svg className="bx-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path className="bx-spark-a" d={`${d}L${x(n - 1).toFixed(1)} ${h}L${x(0).toFixed(1)} ${h}Z`} />
      <path className="bx-spark-l" d={d} />
      <circle className="bx-spark-e" cx={x(n - 1)} cy={y(values[n - 1]!)} r="2.4" />
    </svg>
  );
}

/** Spend against a cap: the fill, the 80% mark and where the month is heading. Without a share, an empty track. */
export function CapBar({ share, proj, warn = 0.8, tone }: { share: number | null; proj?: number | null; warn?: number; tone: string }) {
  return (
    <span className={`bx-cap is-${tone}`} aria-hidden="true" style={{ "--v": share === null ? 0 : Math.min(1, share), "--p": proj ? Math.min(1, proj) : 0, "--w": warn } as CSSProperties}>
      {share !== null ? <i className="bx-cap-f" /> : null}
      {share !== null && proj && proj > share ? <i className="bx-cap-p" /> : null}
      <i className="bx-cap-m" />
    </span>
  );
}

/** A donut of parts, a figure in its middle. */
export function Donut({ parts, size = 108, label }: { parts: { n: number; tone: string }[]; size?: number; label: ReactNode }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="bx-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="bx-donut-t" cx={size / 2} cy={size / 2} r={r} />
        {total > 0
          ? parts.map((p, i) => {
              const len = (p.n / total) * c;
              const el = p.n ? <circle key={i} className={`bx-donut-s is-${p.tone}`} cx={size / 2} cy={size / 2} r={r} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} /> : null;
              off += len;
              return el;
            })
          : null}
      </svg>
      <div className="bx-donut-c">{label}</div>
    </div>
  );
}

/** A coverage ring: share filled, its words in the middle. */
export function Ring({ v, tone, text, size = 72 }: { v: number; tone: string; text: string; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  return (
    <div className="bx-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="bx-donut-t" cx={size / 2} cy={size / 2} r={r} />
        {v > 0 ? <circle className={`bx-donut-s is-${tone}`} cx={size / 2} cy={size / 2} r={r} strokeDasharray={`${v * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /> : null}
      </svg>
      <b className="bx-ring-c">{text}</b>
    </div>
  );
}

/** A row of runs, oldest first: one cell a run, coloured by its result. */
export function RunStrip({ marks, slots = 20 }: { marks: readonly { state: string }[]; slots?: number }) {
  const pad = Math.max(0, slots - marks.length);
  return (
    <span className="bx-runs" aria-hidden="true">
      {Array.from({ length: pad }, (_, i) => (
        <i key={`p${i}`} className="is-none" />
      ))}
      {marks.map((m, i) => (
        <i key={i} className={`is-${m.state}`} />
      ))}
    </span>
  );
}

/** The last day as a strip, with a tick where the link last answered. */
export function SyncStrip({ pos, tone }: { pos: number | null; tone: string }) {
  return (
    <span className={`bx-sync is-${tone}`} aria-hidden="true">
      {pos !== null ? <i className="bx-sync-f" style={{ "--x": pos } as CSSProperties} /> : null}
      {pos !== null ? <i className="bx-sync-t" style={{ "--x": pos } as CSSProperties} /> : null}
    </span>
  );
}

/** One stacked bar of parts, each a share of the whole. */
export function StackBar({ parts, total }: { parts: { n: number; tone: string; label: string }[]; total: number }) {
  return (
    <span className="bx-stack" aria-hidden="true">
      {total > 0 ? parts.filter((p) => p.n > 0).map((p) => <i key={p.label} className={`is-${p.tone}`} style={{ flexGrow: p.n }} title={`${p.n} ${p.label}`} />) : <i className="is-none" style={{ flexGrow: 1 }} />}
    </span>
  );
}
