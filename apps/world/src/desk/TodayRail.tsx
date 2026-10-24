import { useMemo } from "react";
import { chronicleDay, useWorldFeed } from "../chronicle.ts";
import { clockState, useWorldClock } from "../worldClock.ts";
import { mountainHour, PART } from "./ilyrTime.ts";
import { useNow } from "./motion.tsx";
import { Icon } from "./todayIcons.tsx";
import { isQuiet, mtTime, roman, until, upcoming, type Run } from "./todaySchedule.ts";

/**
 * The bridge's instruments beside the astrolabe (#385; the rail of #363, Nikita 2026-10-24: "the world clock stuff,
 * what the crew does next, little schedule"): the ship's reading of Ilyr's hour, set in Roman numerals like a chart's,
 * and the ephemeris, the crew's next runs as a ship's table of what comes over the horizon when, each with its glyph in
 * its room's colour and a live countdown. The same runs sit on the astrolabe's rim; pointing at one lights the other.
 * Real data only: the schedule is the crew's fixed one (todaySchedule.ts), and the clock says plainly when it isn't
 * reading. No "last checked" times unless something is wrong.
 */

/** The runs coming up, recomputed once a minute; `now` ticks every second for the first countdown. */
export function useRuns(): { now: number; runs: Run[] } {
  const now = useNow(1000);
  const hourAt = useWorldClock((s) => (s.reading?.nextAt ? Date.parse(s.reading.nextAt) : null));
  const minute = Math.floor(now / 60_000);
  const runs = useMemo(() => upcoming(minute * 60_000, hourAt !== null && Number.isFinite(hourAt) ? hourAt : null), [minute, hourAt]);
  return { now, runs };
}

/** Ilyr's hour, as the bridge reads it: the hour in numerals, the part of the day, and the clocks it runs by. */
export function IlyrReadout({ now }: { now: number }) {
  const reading = useWorldClock((s) => s.reading);
  const status = useWorldClock((s) => s.status);
  const world = useWorldFeed().feed;
  const h = mountainHour(now);
  const state = clockState(reading, status, now);
  const today = chronicleDay(now);
  const written = world ? world.recent.filter((e) => e.day === today).length : null;
  const utc = new Date(now).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  const hour = Math.floor(h) || 24;
  // Said only when something is off: a stalled or late clock, or one that isn't answering.
  const warn = status === "failed" ? "The world clock isn't answering." : state === "down" ? "The world clock has stopped." : state === "slow" ? "An hour of Ilyr is overdue." : null;
  return (
    <div className={`td-read is-${state}`}>
      <p className="td-read-k">
        <Icon name={h >= 6 && h < 20 ? "dawn" : "moon"} />
        {PART(h)} in Ilyr
      </p>
      <p className="td-read-h">
        <span className="td-sr">Hour {hour} of 24</span>
        <b aria-hidden="true">{roman(hour)}</b>
        <span aria-hidden="true">of XXIV</span>
      </p>
      <p className="td-read-t">
        <span>{mtTime(now)} Mountain</span>
        <span>{utc} crew</span>
        {written !== null && <span>{written === 1 ? "1 hour written" : `${written} hours written`}</span>}
      </p>
      {warn && (
        <p className="td-read-warn" role="status">
          {warn}
        </p>
      )}
    </div>
  );
}

/** The ephemeris: what the crew does next, soonest first, as a table read down the side of the chart. */
export function Ephemeris({ runs, now, hotRun, onHotRun }: { runs: Run[]; now: number; hotRun: string | null; onHotRun: (k: string | null) => void }) {
  const quiet = isQuiet(now);
  return (
    <section className="td-eph" aria-labelledby="td-eph-h">
      <p className="td-k" id="td-eph-h">
        <span>Coming up</span> what the crew does next
      </p>
      <ol className="td-eph-l">
        {runs.map((r, i) => (
          <li
            key={r.key}
            className={`td-eph-r${i === 0 ? " is-next" : ""}${hotRun === r.key ? " is-hot" : ""}`}
            data-room={r.room}
            onPointerEnter={() => onHotRun(r.key)}
            onPointerLeave={() => onHotRun(null)}
          >
            <span className="td-eph-g" aria-hidden="true">
              <Icon name={r.icon} />
            </span>
            <span className="td-eph-w">
              <b>{r.what}</b>
              <span>{r.who}</span>
            </span>
            <time dateTime={new Date(r.at).toISOString()}>
              <span>{mtTime(r.at)}</span>
              <b>{until(r.at, now, i === 0)}</b>
            </time>
          </li>
        ))}
      </ol>
      <p className={`td-eph-q${quiet ? " is-on" : ""}`}>
        <Icon name="moon" />
        {quiet ? "Pings are quiet until 7 AM, Mountain. The crew works on." : "Pings go quiet from 10 PM to 7 AM, Mountain: the dashed arc on the rim."}
      </p>
    </section>
  );
}
