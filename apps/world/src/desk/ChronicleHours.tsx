import { useEffect, useMemo, useRef, useState } from "react";
import { hourLabel, type DayPage, type HistoryEntry } from "../chronicle.ts";
import { weekDaysOf } from "../../../../api/_world/weeks.ts";
import { bookSpec, type BookLive, type HourCell } from "./chronicleViz.ts";
import { hoursOf, shortDay } from "./ChronicleWeave.tsx";
import { useViz } from "./wvCanvas.ts";

/**
 * The Book of Hours (#388), the Archive's centrepiece: the week in Ilyr laid out as a codex page, a column per day and a
 * row per hour, each written hour a swarm of ink motes (one per line spoken), each change shipped a bright core. Point
 * at an hour to read it in plain type underneath; pick it to open that day at that hour. The canvas only draws; every
 * fact it shows is also in the caption and the day below.
 */

const MT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" });
/** The hour of a moment in Mountain time, the Chronicle's clock. */
export const mountainHour = (at: number) => Number(MT.format(new Date(at))) % 24;

const TICKS = [
  { h: 0, l: "midnight" },
  { h: 6, l: "6 am" },
  { h: 12, l: "noon" },
  { h: 18, l: "6 pm" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BookOfHours({
  monday,
  shown,
  today,
  now,
  days,
  pages,
  recent,
  live,
  onPick,
  onWeek,
  prevWeek,
  nextWeek,
}: {
  monday: string;
  shown: string;
  today: string;
  now: number;
  days: string[];
  pages: Record<string, DayPage | "loading" | "failed">;
  recent: HistoryEntry[];
  live: { current: BookLive };
  onPick: (day: string, step?: number) => void;
  onWeek: (day: string) => void;
  prevWeek: string | null;
  nextWeek: string | null;
}) {
  const week = weekDaysOf(monday);
  const hrsBy = week.map((d) => hoursOf(d, pages[d], recent));
  const hourNow = mountainHour(now);
  const todayCol = week.indexOf(today);
  const shownCol = week.indexOf(shown);
  // A cell per hour of the week: its latest entry, the lines spoken and the changes shipped.
  const entries: (HistoryEntry | null)[] = Array.from({ length: 168 }, () => null);
  const cells: HourCell[] = Array.from({ length: 168 }, (_, i) => {
    const d = week[Math.floor(i / 24)]!;
    const h = i % 24;
    return { lines: 0, ships: 0, written: false, future: d > today || (d === today && h > hourNow) };
  });
  hrsBy.forEach((hrs, col) => {
    for (const e of hrs) {
      const i = col * 24 + mountainHour(Date.parse(e.at));
      const c = cells[i]!;
      c.written = true;
      c.lines += e.scenes.reduce((n, s) => n + s.lines.length, 0);
      c.ships += e.remarks.length;
      entries[i] = e;
    }
  });
  const sig = JSON.stringify(cells);
  const nowIdx = todayCol >= 0 ? todayCol * 24 + hourNow : -1;
  // Today's written hours in order, which the reading lights as it goes.
  useEffect(() => {
    const cs = JSON.parse(sig) as HourCell[];
    live.current.read = todayCol >= 0 ? cs.map((c, i) => (c.written && Math.floor(i / 24) === todayCol ? i : -1)).filter((i) => i >= 0) : [];
  }, [sig, todayCol, live]);
  const spec = useMemo(() => bookSpec(cells, shownCol, nowIdx, live), [sig, shownCol, nowIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);

  // The hour under the pointer (or picked with the keys), or the latest written hour when there's none.
  const [at, setAt] = useState(-1);
  const latest = entries.reduce((best, e, i) => (e && (best < 0 || Date.parse(e.at) > Date.parse(entries[best]!.at)) ? i : best), -1);
  const focus = at >= 0 ? at : latest;
  const point = (i: number) => {
    live.current.hover = i;
    setAt(i);
  };
  const cellAt = (ev: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const col = Math.floor(((ev.clientX - r.left) / r.width) * 7);
    const row = Math.floor(((ev.clientY - r.top) / r.height) * 24);
    return col >= 0 && col < 7 && row >= 0 && row < 24 ? col * 24 + row : -1;
  };
  const open = (i: number) => {
    const e = entries[i];
    if (e) onPick(week[Math.floor(i / 24)]!, e.step);
  };
  const key = (ev: React.KeyboardEvent) => {
    const i = at >= 0 ? at : latest >= 0 ? latest : 0;
    const mv: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -24, ArrowRight: 24 };
    if (ev.key in mv) {
      ev.preventDefault();
      point(Math.max(0, Math.min(167, i + mv[ev.key]!)));
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      open(i);
    }
  };

  const hours = hrsBy.reduce((n, h) => n + h.length, 0);
  const lines = cells.reduce((n, c) => n + c.lines, 0);
  const ships = cells.reduce((n, c) => n + c.ships, 0);
  const f = focus >= 0 ? { d: week[Math.floor(focus / 24)]!, h: focus % 24, e: entries[focus], c: cells[focus]! } : null;
  const fs = f ? shortDay(f.d) : null;
  const first = shortDay(week[0]!);
  const last = shortDay(week[6]!);

  return (
    <section className="ax-book" aria-label="The week in Ilyr, hour by hour">
      <header className="ax-book-head">
        <div>
          <p className="ax-k">The week in Ilyr · hour by hour</p>
          <h2 className="ax-book-h">
            {first.month} <span>to</span> {last.month}
          </h2>
        </div>
        <div className="ax-book-nav" role="group" aria-label="Weeks">
          <button type="button" disabled={!prevWeek} onClick={() => prevWeek && onWeek(prevWeek)} aria-label="The week before">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <button type="button" disabled={!nextWeek} onClick={() => nextWeek && onWeek(nextWeek)} aria-label="The week after">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        </div>
      </header>
      <dl className="ax-book-tally">
        <div>
          <dt>Hours written</dt>
          <dd>{hours}</dd>
        </div>
        <div>
          <dt>Lines spoken</dt>
          <dd>{lines}</dd>
        </div>
        <div>
          <dt>Changes shipped</dt>
          <dd>{ships}</dd>
        </div>
      </dl>

      <div className="ax-codex">
        <ol className="ax-codex-days">
          {week.map((d, i) => {
            const s = shortDay(d);
            const has = days.includes(d) || hrsBy[i]!.length > 0;
            return (
              <li key={d} className={[d === shown && "is-shown", d === today && "is-today"].filter(Boolean).join(" ") || undefined}>
                <button type="button" disabled={!has} aria-pressed={d === shown} onClick={() => onPick(d)} aria-label={`Open ${s.long} ${s.month}`}>
                  <span>{d === today ? "Today" : s.wd}</span>
                  <b>{s.d}</b>
                  <small>{d > today ? "to come" : plural(hrsBy[i]!.length, "hour")}</small>
                </button>
              </li>
            );
          })}
        </ol>
        <ol className="ax-codex-ticks" aria-hidden="true">
          {TICKS.map((t) => (
            <li key={t.h} style={{ "--h": t.h } as React.CSSProperties}>
              {t.l}
            </li>
          ))}
        </ol>
        <div
          className="ax-codex-page"
          tabIndex={0}
          role="grid"
          aria-label="Hours of the week. Arrow keys move between hours; Enter opens one."
          onPointerMove={(ev) => {
            const i = cellAt(ev);
            if (i !== at) point(i);
          }}
          onPointerLeave={() => point(-1)}
          onClick={(ev) => {
            // A tap first shows the hour (a mouse has already pointed at it), the next one opens it.
            const i = cellAt(ev);
            if (i < 0) return;
            if (i !== at) point(i);
            else open(i);
          }}
          onKeyDown={key}
          onBlur={() => point(-1)}
        >
          <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        </div>
      </div>

      <div className="ax-caption" aria-live="polite">
        {f && fs ? (
          <>
            <p className="ax-caption-when">
              <b>
                {f.d === today ? "Today" : fs.long} {fs.d}
              </b>
              <span>{f.e ? hourLabel(f.e.at) : TICKS.find((t) => t.h === f.h)?.l ?? (f.h < 12 ? `${f.h} am` : `${f.h - 12} pm`)}</span>
              {f.e && (
                <small>
                  {plural(f.c.lines, "line")}
                  {f.c.ships ? ` · ${plural(f.c.ships, "change")} shipped` : ""}
                  {f.e.source === "scripted" ? " · scripted" : ""}
                </small>
              )}
            </p>
            <p className="ax-caption-s">{f.e ? f.e.summary : f.c.future ? "This hour hasn't come yet." : "Nothing was written down in this hour."}</p>
            {f.e && (
              <button className="ax-link" type="button" onClick={() => open(focus)}>
                Open the hour
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </button>
            )}
          </>
        ) : (
          <p className="ax-caption-s is-empty">Nothing written this week yet. Each hour the world takes a step, a little ink settles in its square.</p>
        )}
      </div>
      <ul className="ax-key" aria-label="How to read the page">
        <li>
          <i className="is-ink" aria-hidden="true" />
          An hour written, a mote for each line spoken
        </li>
        <li>
          <i className="is-ship" aria-hidden="true" />A change shipped
        </li>
        <li>
          <i className="is-none" aria-hidden="true" />
          Not written
        </li>
      </ul>
    </section>
  );
}
