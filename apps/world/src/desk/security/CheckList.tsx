import { useState, type ReactNode } from "react";
import type { Check } from "./Checks.tsx";
import { BOUNDARIES, ZONES, type Boundary } from "./model.ts";
import { Facts } from "./parts.tsx";

/**
 * Security and Compliance on one screen (#746): every check as one folded line (a dot, its name, its state in words,
 * its figure), opening in place to what it is, why it matters and its detail. Nothing the particle lines (Checks.tsx)
 * said is dropped; it just takes one line until asked.
 */
export function CheckList({ checks, label }: { checks: Check[]; label: string }) {
  return (
    <ul className="bx-checks" aria-label={label}>
      {checks.map((c) => (
        <li key={c.id}>
          <details>
            <summary>
              <i className={`bx-dot is-${c.state}`} aria-hidden="true" />
              <span>
                <b>{c.name}</b>
                <small>{c.sub}</small>
              </span>
              <em>{c.value}</em>
            </summary>
            <div className="bx-cbody">
              {c.kicker ? <p className="fl-k">{c.kicker}</p> : null}
              {c.about ? <Facts e={c.about} /> : null}
              {c.detail}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/* ── the trust map: the seven zones, each boundary a line coloured by its guard ── */

type ZoneId = keyof typeof ZONES;
const NAME: Partial<Record<ZoneId, string>> = { claude: "Model APIs", vercel: "Azure production", builder: "Claude Code sessions" };
const W = 230;
const H = 58;
const AT: Record<ZoneId, [number, number]> = {
  public: [155, 64],
  browser: [155, 436],
  vercel: [450, 250],
  relay: [450, 436],
  claude: [745, 64],
  github: [745, 250],
  builder: [745, 436],
};

/** Each boundary's curve: boundaries between the same two zones fan out side by side. */
export function boundaryPaths(list: readonly Boundary[] = BOUNDARIES): { b: Boundary; d: string; mid: [number, number] }[] {
  const pairs = new Map<string, Boundary[]>();
  for (const b of list) {
    const k = [b.from, b.to].sort().join("|");
    pairs.set(k, [...(pairs.get(k) ?? []), b]);
  }
  return list.map((b) => {
    const k = [b.from, b.to].sort().join("|");
    const same = pairs.get(k)!;
    const j = same.indexOf(b);
    const [ax, ay] = AT[b.from as ZoneId];
    const [bx, by] = AT[b.to as ZoneId];
    // The same perpendicular for every boundary of a pair, whichever way it runs.
    const [px, py] = b.from < b.to ? [ax, ay] : [bx, by];
    const [qx, qy] = b.from < b.to ? [bx, by] : [ax, ay];
    const len = Math.hypot(qx - px, qy - py) || 1;
    const nx = -(qy - py) / len;
    const ny = (qx - px) / len;
    const off = (j - (same.length - 1) / 2) * 26;
    const mx = (ax + bx) / 2 + nx * off;
    const my = (ay + by) / 2 + ny * off;
    const cx = (ax + bx) / 2 + nx * off * 2;
    const cy = (ay + by) / 2 + ny * off * 2;
    return { b, d: `M${ax} ${ay}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${bx} ${by}`, mid: [mx, my] };
  });
}

export function TrustMap({ caption }: { caption?: (b: Boundary | null) => ReactNode }) {
  const [on, setOn] = useState<string | null>(null);
  const paths = boundaryPaths();
  const cur = BOUNDARIES.find((b) => b.id === on) ?? null;
  const hot = new Set(cur ? [cur.from, cur.to] : []);
  return (
    <>
      <svg className="bx-map" viewBox="0 0 900 500" role="group" aria-label="Trust map: seven zones and the boundaries between them">
        {paths.map(({ b, d, mid }) => (
          <g
            key={b.id}
            className={`tb is-${b.planned ? "wait" : "pass"} ${on === b.id ? "is-on" : ""}`}
            tabIndex={0}
            role="button"
            aria-label={`${b.id} ${b.name}: ${b.planned ? "waits on the Mac" : "guarded"}`}
            aria-pressed={on === b.id}
            onMouseEnter={() => setOn(b.id)}
            onFocus={() => setOn(b.id)}
            onClick={() => setOn(b.id)}
          >
            <path className="hit" d={d} />
            <path className="ln" d={d} />
            <rect x={mid[0] - 17} y={mid[1] - 8} width="34" height="16" rx="3" />
            <text x={mid[0]} y={mid[1] + 4} textAnchor="middle">
              {b.id}
            </text>
          </g>
        ))}
        {(Object.keys(AT) as ZoneId[]).map((z) => {
          const [x, y] = AT[z];
          const zone = ZONES[z];
          return (
            <g key={z} className={`zn ${z === "vercel" ? "is-hub" : ""} ${zone.planned ? "is-planned" : ""} ${hot.has(z) ? "is-on" : ""}`}>
              <rect x={x - W / 2} y={y - H / 2} width={W} height={H} rx="8" />
              <text x={x - W / 2 + 14} y={y - 4}>
                {NAME[z] ?? zone.name}
              </text>
              <text className="t2" x={x - W / 2 + 14} y={y + 15}>
                {zone.trust.length > 30 ? zone.trust.slice(0, 29) + "…" : zone.trust}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="bx-cap2" aria-live="polite">
        {caption ? caption(cur) : null}
      </div>
    </>
  );
}
