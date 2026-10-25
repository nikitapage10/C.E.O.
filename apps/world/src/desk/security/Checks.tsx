import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RC, useFlow, type FlowLayoutFn, type FlowLine } from "../flow/index.ts";
import { BAD } from "../wvCanvas.ts";
import { changesOf, checkLines, route, STATE_WORD, type CheckState } from "./checks.ts";
import type { Explain } from "./explain.ts";
import { Facts } from "./parts.tsx";

/**
 * Security and Compliance's stage (#445): the Boiler Room's particle-line language (the flow kit, as the pipes page
 * #390 draws it) carrying every check. One line a check, in the Pessimist's steel: it flows when it passes, thins out
 * when it passes with gaps, lies dashed while it waits to be reported, and stops dead at a red knot when it fails.
 * A group with a figure (`end`) is a bundle: its lines gather into that figure, the framework they add up to. A check's
 * name (or its line) opens what it is and why it matters under it; when a state really changes, the line says so
 * once (a packet when it comes good, a red spray when it fails, and a plain word rising off it).
 */

export const ACCENT = RC.boiler!;
const EVENTS_MAX = 3;

export interface Check {
  id: string;
  name: ReactNode;
  /** Plain words for screen readers and the rising word (no markup). */
  label: string;
  /** The state in words, under the name. */
  sub: string;
  state: CheckState;
  /** 0..1: a passing line's real share (a score out of 10). */
  fill?: number;
  /** The figure at the line's end (a gate group): a time, a score, a count. */
  value?: ReactNode;
  kicker?: string;
  about?: Explain;
  detail?: ReactNode;
}

export interface Group {
  id: string;
  title: string;
  note?: ReactNode;
  aside?: ReactNode;
  checks: Check[];
  /** A bundle's figure: the lines gather into it. */
  end?: ReactNode;
  /** Under the group's lines. */
  foot?: ReactNode;
}

const tone = (s: CheckState) => `is-${s}`;
const base = (id: string) => (id.endsWith("~") ? id.slice(0, -1) : id);

export function CheckRack({ groups, header, label, stage = true }: { groups: Group[]; header?: ReactNode; label: string; stage?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const sig = groups.map((g) => `${g.id}:${g.end ? 1 : 0}:${g.checks.map((c) => `${c.id}=${c.state}/${c.fill ?? 1}`).join(",")}`).join("|");

  const layout = useCallback<FlowLayoutFn>(
    ({ rel, phone }) => {
      const el = root.current;
      if (!el) return { lines: [] };
      const lines: FlowLine[] = [];
      for (const g of groups) {
        const endEl = g.end && !phone ? el.querySelector(`[data-sx-end="${g.id}"]`) : null;
        const e = endEl ? rel(endEl) : null;
        for (const c of g.checks) {
          const tEl = el.querySelector(`[data-sx-track="${CSS.escape(c.id)}"]`);
          if (!tEl) continue;
          const t = rel(tEl);
          if (t.w < 8) continue;
          const y = t.y + t.h / 2;
          const to: [number, number] = e ? [e.x - 6, e.y + e.h / 2] : [t.x + t.w, y];
          lines.push(...checkLines(c.id, c.state, route([t.x, y], to, !!e), { rgb: ACCENT, bad: BAD, fill: c.fill, phone }));
        }
      }
      return { lines };
    },
    // The layout follows the checks' states, not every new array the page hands in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );

  const { cv, field, bind } = useFlow(layout, {
    accent: ACCENT,
    ground: stage,
    backing: 800_000,
    onHover: (id) => setHot(id ? base(id) : null),
    onPick: (id) => setOpen((o) => (o === base(id) ? null : base(id))),
  });

  useLayoutEffect(() => {
    field.setFocus(open);
    field.relayout();
  }, [field, open]);

  // Real changes only: a check that comes good runs a packet, one that fails sprays red, and a word rises off it.
  const seen = useRef<Map<string, CheckState> | null>(null);
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.checks.map((c) => [c.id, c] as const))), [groups]);
  useEffect(() => {
    const prev = seen.current;
    const next = new Map([...byId].map(([id, c]) => [id, c.state] as const));
    seen.current = next;
    if (!prev) return;
    const t = window.setTimeout(() => {
      for (const ch of changesOf(prev, next).slice(0, EVENTS_MAX)) {
        const c = byId.get(ch.id);
        if (!c) continue;
        if (ch.to === "fail") {
          field.burst(ch.id, { n: 30, rgb: BAD });
          field.rise(`${c.label} · failing`, { at: ch.id, rgb: BAD });
        } else if (ch.to === "pass") {
          field.pulse(ch.id);
          field.rise(`${c.label} · passing`, { at: ch.id });
        }
      }
    }, 160);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, field]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const Tag = stage ? "section" : "div";
  return (
    <Tag ref={root as React.Ref<HTMLDivElement>} className={stage ? "fl-stage sx-stage" : "sx-more"} aria-label={label} {...bind}>
      <canvas ref={cv} className="fl-cv" aria-hidden="true" />
      {header}
      {groups.map((g) => (
        <section key={g.id} className={`sx-group${g.end ? " is-bundle" : ""}`} aria-label={g.title}>
          <div className="sx-ghead">
            <p className="fl-k">
              <span>{g.title}</span>
              {g.note ? <> · {g.note}</> : null}
            </p>
            {g.aside}
          </div>
          <div className="sx-gbody">
            <ol className="sx-rows">
              {g.checks.map((c) => {
                const isOpen = open === c.id;
                const lit = isOpen || hot === c.id;
                return (
                  <li key={c.id} className={`sx-row ${tone(c.state)}${isOpen ? " is-open" : ""}${lit ? " is-lit" : ""}${open && !isOpen ? " is-dim" : ""}`}>
                    <button
                      type="button"
                      className="sx-name"
                      aria-expanded={isOpen}
                      aria-label={`${c.label}: ${c.sub}. What it is`}
                      onClick={() => setOpen(isOpen ? null : c.id)}
                      onMouseEnter={() => !open && field.setFocus(c.id)}
                      onMouseLeave={() => !open && field.setFocus(null)}
                    >
                      <b>{c.name}</b>
                      <small className={`sx-st ${tone(c.state)}`}>
                        <i />
                        {c.sub}
                      </small>
                    </button>
                    <div className="sx-track" data-sx-track={c.id} aria-hidden="true" />
                    {!g.end && <div className="sx-val">{c.value}</div>}
                    {isOpen && (
                      <div className="sx-open fl-panel" role="region" aria-label={c.label}>
                        {c.kicker && <p className="fl-k">{c.kicker}</p>}
                        {c.about && <Facts e={c.about} />}
                        {c.detail}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {g.end && (
              <div className="sx-end" data-sx-end={g.id}>
                {g.end}
              </div>
            )}
          </div>
          {g.foot}
        </section>
      ))}
    </Tag>
  );
}

/** The key to the lines, as the pipes page draws its own. */
export function Key({ words = {} }: { words?: Partial<Record<CheckState, string>> }) {
  const w = { ...STATE_WORD, part: "With gaps", ...words };
  return (
    <ul className="sx-key" aria-label="Key">
      {(["pass", "part", "wait", "fail"] as const).map((s) => (
        <li key={s} className={`is-${s}`}>
          {w[s]}
        </li>
      ))}
    </ul>
  );
}
