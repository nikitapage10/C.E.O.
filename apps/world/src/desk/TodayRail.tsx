import { useMemo, useRef } from "react";
import { chronicleDay, useWorldFeed } from "../chronicle.ts";
import { clockState, useWorldClock } from "../worldClock.ts";
import { mountainHour, PART } from "./ilyrTime.ts";
import { useNow } from "./motion.tsx";
import { Icon } from "./todayIcons.tsx";
import { along, HOUR, isQuiet, mtTime, occurrences, quietBands, until, upcoming, type Run } from "./todaySchedule.ts";
import { HOT, knot, Parts, Poly, RC, sprMix, TAU, weave, WHITE, useViz, type VizSpec } from "./wvCanvas.ts";

/**
 * Today's side rail (#363, Nikita 2026-10-24: "the world clock stuff, what the crew does next, little schedule… maybe
 * with icons or things on the side"): the world clock (Ilyr's hour on its dial, and the clocks it runs by), then the
 * next twelve hours as a little ribbon with what the crew does next under it, each with its icon and a live countdown.
 * It stays beside the page on a wide screen and folds in under "Right now" on a phone. Real data only: the schedule is
 * the crew's fixed one (todaySchedule.ts) and the clock's line says plainly when it isn't reading.
 */

/** How far ahead the ribbon looks. */
const SPAN = 12 * HOUR;

export function TodayRail({ now }: { now: number }) {
  return (
    <aside className="td-rail" aria-label="Clock and schedule" data-in>
      <ClockCard now={now} />
      <NextCard />
    </aside>
  );
}

function ClockCard({ now }: { now: number }) {
  const reading = useWorldClock((s) => s.reading);
  const status = useWorldClock((s) => s.status);
  const world = useWorldFeed().feed;
  const cv = useRef<HTMLCanvasElement>(null);
  const h = mountainHour(now);
  const spec = useMemo(() => dialSpec(h), [h]);
  useViz(cv, spec);
  const state = clockState(reading, status, now);
  const today = chronicleDay(now);
  const written = world ? world.recent.filter((e) => e.day === today).length : null;
  const next = reading?.nextAt ? Date.parse(reading.nextAt) : NaN;
  const nextLine =
    status === "failed" ? "Not answering" : status === "off" ? "Not running here" : status !== "ready" ? "Reading…" : !Number.isFinite(next) ? "After the first step" : next > now ? until(next, now) : state === "ok" ? "any minute now" : "overdue";
  const utc = new Date(now).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  return (
    <section className={`td-card td-clock is-${state}`} aria-label="World clock">
      <div className="td-clock-top">
        <div className="td-dial">
          <canvas ref={cv} className="wv-cv" aria-hidden="true" />
          <p>
            <b>{Math.floor(h) || 24}</b>
            <span>of 24</span>
          </p>
        </div>
        <div>
          <p className="wv-eyb">
            <Icon name={h >= 6 && h < 20 ? "dawn" : "moon"} />
            World clock
          </p>
          <h3 className="td-h3">{PART(h)} in Ilyr</h3>
          <p className="td-clock-here">
            {mtTime(now)} <span>Mountain</span>
          </p>
        </div>
      </div>
      <dl className="td-facts">
        <div>
          <dt>Next hour</dt>
          <dd>{nextLine}</dd>
        </div>
        <div>
          <dt>Last hour</dt>
          <dd>{reading?.source === "claude" ? "by Claude" : reading?.source === "scripted" ? "from the agents' lines" : "None yet"}</dd>
        </div>
        <div>
          <dt>Today so far</dt>
          <dd>{written === null ? "Reading…" : `${written} ${written === 1 ? "hour" : "hours"} written`}</dd>
        </div>
        <div>
          <dt>Crew clock</dt>
          <dd>{utc} UTC</dd>
        </div>
      </dl>
      {(state === "slow" || state === "down") && <p className="td-clock-warn">{state === "down" ? "The clock has stopped." : "An hour is overdue."}</p>}
    </section>
  );
}

/** Ilyr's day as a dial: the hours lit so far, a thread of particles running round to now. */
function dialSpec(h: number): VizSpec {
  let r = 0;
  let cx = 0;
  let cy = 0;
  const poly = new Poly();
  const P = new Parts(90, 0.3);
  return {
    lay(V) {
      r = Math.min(V.W, V.H) / 2 - 8;
      cx = V.W / 2;
      cy = V.H / 2;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i <= 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * (Math.max(0.02, h) / 24) * TAU;
        xs.push(cx + Math.cos(a) * r);
        ys.push(cy + Math.sin(a) * r);
      }
      poly.set(xs, ys);
    },
    draw(_V, c, t, dt) {
      for (let k = 0; k < 24; k++) {
        const a = -Math.PI / 2 + (k / 24) * TAU;
        const lit = k <= h;
        const night = k >= 22 || k < 6;
        const col = night ? RC.relay! : k >= 17 ? HOT : WHITE;
        c.globalAlpha = lit ? (night ? 0.55 : 0.7) : 0.18;
        c.strokeStyle = `rgba(${col},1)`;
        c.lineWidth = k % 6 === 0 ? 1.6 : 1;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
        c.lineTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
        c.stroke();
      }
      weave(c, poly, P, { a: 0.9, sp: 1.4, sz: 0.6, v: 18, rgb: WHITE, rgb2: HOT, line: 0.12, col: (u) => sprMix(RC.relay!, HOT, u) }, t, dt);
      const e = poly.at(1);
      knot(c, e.x, e.y, 0.58, t, HOT, 1);
    },
  };
}

/** What the crew does next: the next twelve hours as a ribbon, then each run with its countdown. Ticks every second. */
function NextCard() {
  const now = useNow(1000);
  const hourAt = useWorldClock((s) => (s.reading?.nextAt ? Date.parse(s.reading.nextAt) : null));
  const minute = Math.floor(now / 60_000);
  // The list itself changes at most once a minute; only the first countdown ticks by the second.
  const runs = useMemo(() => upcoming(minute * 60_000, hourAt !== null && Number.isFinite(hourAt) ? hourAt : null), [minute, hourAt]);
  const quiet = isQuiet(now);
  return (
    <section className="td-card td-next" aria-label="What the crew does next">
      <p className="wv-eyb">
        <Icon name="later" />
        Coming up
      </p>
      <h3 className="td-h3">What the crew does next</h3>
      <Ribbon runs={runs} minute={minute} />
      <ol className="td-runs">
        {runs.map((r, i) => (
          <RunRow key={r.key} run={r} now={now} first={i === 0} />
        ))}
      </ol>
      <p className={`td-quiet${quiet ? " is-on" : ""}`}>
        <Icon name="moon" />
        {quiet ? "Pings are quiet until 7 AM, Mountain. The crew works on." : "Pings go quiet from 10 PM to 7 AM, Mountain."}
      </p>
    </section>
  );
}

function RunRow({ run, now, first }: { run: Run; now: number; first: boolean }) {
  const f = along(run, now);
  return (
    <li className={`td-run${first ? " is-next" : ""}`} data-room={run.room}>
      <span className="td-run-ic" style={{ "--f": f.toFixed(4) } as React.CSSProperties}>
        <svg className="td-run-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="16" pathLength={1} />
          <circle className="is-f" cx="18" cy="18" r="16" pathLength={1} />
        </svg>
        <Icon name={run.icon} />
      </span>
      <span className="td-run-t">
        <b>{run.what}</b>
        <span>
          {run.who}, {mtTime(run.at)}
        </span>
      </span>
      <time dateTime={new Date(run.at).toISOString()}>{until(run.at, now, first)}</time>
    </li>
  );
}

/** The next twelve hours: the quiet hours shaded, every run a tick in its room's colour, the soonest pulsing. */
function Ribbon({ runs, minute }: { runs: Run[]; minute: number }) {
  const now = minute * 60_000;
  const W = 280;
  const x = (t: number) => 6 + ((t - now) / SPAN) * (W - 12);
  const bands = quietBands(now, SPAN);
  const marks = runs.flatMap((r) => occurrences(r, now, SPAN).map((t, k) => ({ r, t, k })));
  const hours = [now, now + SPAN / 2, now + SPAN];
  return (
    <div className="td-ribbon">
      <svg viewBox={`0 0 ${W} 58`} aria-hidden="true">
        <defs>
          <linearGradient id="td-sheen" x1="0" x2="1">
            <stop offset="0" stopColor="#ffdcaa" stopOpacity="0" />
            <stop offset=".5" stopColor="#ffdcaa" stopOpacity=".5" />
            <stop offset="1" stopColor="#ffdcaa" stopOpacity="0" />
          </linearGradient>
        </defs>
        {bands.map(([a, b]) => (
          <rect key={a} className="td-rb-quiet" x={x(a)} y="6" width={Math.max(0, x(b) - x(a))} height="30" rx="3" />
        ))}
        <line className="td-rb-axis" x1="6" x2={W - 6} y1="21" y2="21" />
        <rect className="td-rb-sheen" x="-60" y="20" width="60" height="2" fill="url(#td-sheen)" />
        {marks.map(({ r, t, k }) => (
          <line
            key={`${r.key}${t}`}
            className={`td-rb-m is-${r.key}${k === 0 && r === runs[0] ? " is-next" : ""}`}
            data-room={r.room}
            x1={x(t)}
            x2={x(t)}
            y1={r.key === "queue" ? 17 : r.key === "hour" ? 14 : 9}
            y2={r.key === "queue" ? 25 : r.key === "hour" ? 28 : 33}
            style={{ "--k": Math.min(12, k) } as React.CSSProperties}
          />
        ))}
        <circle className="td-rb-now" cx="6" cy="21" r="3" />
      </svg>
      <p className="td-rb-ax">
        {hours.map((t, i) => (
          <span key={t} style={{ left: `${(i / (hours.length - 1)) * 100}%` }}>
            {i === 0 ? "Now" : mtTime(t)}
          </span>
        ))}
      </p>
    </div>
  );
}
