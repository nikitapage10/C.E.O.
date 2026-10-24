import { useEffect, useMemo, useRef } from "react";
import { mountainHour } from "../ilyrTime.ts";
import { portrait } from "../deskData.ts";
import type { PulseState, RoomPulse } from "../roomPulse.ts";
import { SkippyAvatar } from "../skippy/index.ts";
import { Icon } from "../todayIcons.tsx";
import { occurrences, until, mtTime, HOUR, type Run } from "../todaySchedule.ts";
import { kick, reducedMotion, useViz } from "../wvCanvas.ts";
import { dialAngle, GEO, ORB, orrerySpec, planetAngle, shellOf, type DialMarks, type OrbItem, type OrbState } from "./orrery.ts";
import { roomLink } from "./roomLink.ts";

/** The order the rooms take on their shells: the Foundry first, then the rest as the Lattice lists them. */
const ORDER = ["foundry", "boiler", "relay", "archive", "exchange", "green", "spire", "breakroom", "workshop", "studio"] as const;
const ORB_STATE: Record<PulseState, OrbState> = { busy: "busy", steady: "active", waiting: "wait", down: "down", sim: "off" };
export const STATE_WORD: Record<PulseState, string> = { busy: "Busy", steady: "Steady", waiting: "Waiting", down: "Needs a look", sim: "Not set up" };
/** How far ahead the dial shows the crew's runs. */
const AHEAD = 12 * HOUR;

/**
 * The astrolabe on Today's bridge (#385): Skippy at the centre (his portrait opens the chat), the rooms' subminds on
 * their shells, the strands of light between them (orrery.ts), and the crew's next runs set on the rim's inner track
 * as glyphs. Pointing at a submind holds the chart still, lights its strand (and its report in the Council, `onHot`),
 * and says its report under the chart; a tap walks into the room. Real data only (roomPulse.ts, todaySchedule.ts).
 */
export function Astrolabe({ pulses, now, since, hot, onHot, runs, rnow, hotRun, onHotRun }: { pulses: RoomPulse[]; now: number; since: number; hot: string | null; onHot: (id: string | null) => void; runs: Run[]; rnow: number; hotRun: string | null; onHotRun: (k: string | null) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const byId = useMemo(() => new Map(pulses.map((p) => [p.id as string, p])), [pulses]);
  const placed = ORDER.map((id) => byId.get(id)).filter((p): p is RoomPulse => !!p);
  const counts = [0, 0, 0];
  for (const p of placed) counts[shellOf(p)]!++;
  const seen = [0, 0, 0];
  const planets = placed.map((p) => {
    const shell = shellOf(p);
    return { p, shell, k: seen[shell]!++, n: counts[shell]! };
  });

  const span = Math.max(1, now - since);
  const at = (t: number) => 0.12 + 0.84 * Math.min(1, Math.max(0, (t - since) / span));
  const key = planets.map(({ p, shell, k, n }) => `${p.id}${p.state}${shell}${k}${n}${p.activity.toFixed(2)}${p.events.map((t) => at(t).toFixed(3)).join(",")}`).join("|");
  const minute = Math.floor(now / 60_000);
  const runKey = runs.map((r) => `${r.key}${r.at}`).join("|");
  // Rebuilt only when what it draws changes; the strands themselves are kept (orrery.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo<OrbItem[]>(() => planets.map(({ p, shell, k, n }) => ({ id: p.id, st: ORB_STATE[p.state], lvl: p.activity, ev: p.events.filter((t) => t >= since && t <= now).map(at), shell, k, n })), [key]);
  const dial = useMemo<DialMarks>(() => {
    const t0 = minute * 60_000;
    const dots = runs.flatMap((r) => occurrences(r, t0, AHEAD).slice(1).map((t) => ({ h: mountainHour(t), room: r.room })));
    return { h: mountainHour(t0), quiet: [22, 31], dots };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, runKey]);
  const spec = useMemo(() => orrerySpec(items, dial), [items, dial]);
  useViz(cv, spec);

  // The lit strand follows `hot`, from a submind here, a line in Right now, or a report in the Council (#363).
  useEffect(() => {
    ORB.hot = hot;
    if (reducedMotion()) ORB.V?.relayout();
    else kick();
  }, [hot]);
  useEffect(
    () => () => {
      ORB.hot = null;
      ORB.hold = false;
    },
    [],
  );

  // The runs' glyphs on the inner track; two close together step in and out so neither hides the other.
  const beads = useMemo(() => {
    let last = -Infinity;
    let alt = 0;
    return runs
      .filter((r) => r.at - rnow < AHEAD)
      .map((r) => ({ r, a: dialAngle(mountainHour(r.at)) }))
      .sort((x, y) => x.r.at - y.r.at)
      .map(({ r, a }) => {
        const close = r.at - last < 40 * 60_000;
        alt = close ? alt + 1 : 0;
        last = r.at;
        const rr = GEO.track + (alt % 2 ? -0.048 : alt ? 0.03 : 0);
        return { r, x: 50 + Math.cos(a) * rr * 100, y: 50 + Math.sin(a) * rr * 100 };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, Math.floor(rnow / 60_000)]);

  const lit = hot ? byId.get(hot) : null;
  const litRun = hotRun ? runs.find((r) => r.key === hotRun) : null;
  const live = pulses.filter((p) => p.real && p.state !== "sim").length;
  const hold = (on: boolean) => {
    ORB.hold = on;
  };

  return (
    <figure className="td-astro" aria-label="The astrolabe: Skippy at the centre, the rooms' subminds in orbit, Ilyr's day on the rim">
      <div className="td-astro-sq" onPointerEnter={() => hold(true)} onPointerLeave={() => hold(false)} onFocus={() => hold(true)} onBlur={() => hold(false)}>
        <canvas ref={cv} className="wv-cv td-astro-cv" aria-hidden="true" />
        <span className="td-sun">
          <SkippyAvatar size="md" className="td-sun-can" />
        </span>
        <ol className="td-pls">
          {planets.map(({ p, shell, k, n }) => {
            const a = planetAngle(shell, k, n, ORB.rot);
            const r = GEO.shells[shell]! * 100;
            const doing = p.doing ?? p.status;
            return (
              <li key={p.id}>
                <a
                  className={`td-pl is-${p.state} is-s${shell}${hot === p.id ? " is-hot" : hot ? " is-dim" : ""}`}
                  data-room={p.id}
                  data-side={Math.cos(a) >= 0 ? "r" : "l"}
                  style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
                  href={p.href}
                  onClick={roomLink(p.href)}
                  onPointerEnter={() => onHot(p.id)}
                  onPointerLeave={() => onHot(null)}
                  onFocus={() => onHot(p.id)}
                  onBlur={() => onHot(null)}
                  aria-label={`${p.name}, ${STATE_WORD[p.state].toLowerCase()}: ${doing}. ${p.submind.title} reports: ${p.report}`}
                >
                  <span className="td-pl-pf">
                    <img src={portrait(p.submind.id) ?? `/desk/agent-${p.submind.id}.webp`} alt="" width={48} height={48} decoding="async" />
                  </span>
                  <span className="td-pl-t" aria-hidden="true">
                    <b>{p.name}</b>
                    <em>{STATE_WORD[p.state]}</em>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        <ul className="td-beads" aria-hidden="true">
          {beads.map(({ r, x, y }, i) => (
            <li
              key={r.key}
              className={`td-bead${i === 0 ? " is-next" : ""}${hotRun === r.key ? " is-hot" : ""}`}
              data-room={r.room}
              style={{ left: `${x}%`, top: `${y}%` }}
              onPointerEnter={() => onHotRun(r.key)}
              onPointerLeave={() => onHotRun(null)}
            >
              <Icon name={r.icon} />
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="td-astro-cap" aria-live="polite">
        <span key={lit?.id ?? litRun?.key ?? "all"} data-room={lit?.id ?? litRun?.room}>
          {lit ? (
            <>
              <b>
                {lit.submind.title}, {lit.name}
              </b>
              {lit.report}
            </>
          ) : litRun ? (
            <>
              <b>
                {litRun.what}, {mtTime(litRun.at)}
              </b>
              {litRun.who} · {until(litRun.at, rnow)}
            </>
          ) : (
            <>
              <b>How to read it</b>
              {live} of {pulses.length} rooms run real work, on the inner orbit. Light runs out from Skippy to each submind, more the busier its room; the knots are today's moments, from the morning at his end to now at theirs. The rim is Ilyr's day: lit so far, dashed while pings sleep, the crew's next runs set along it. Point at a submind to hear it; tap to walk in.
            </>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
