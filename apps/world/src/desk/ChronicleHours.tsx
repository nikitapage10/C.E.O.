import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { hourLabel, type DayPage, type HistoryEntry, type RoomId } from "../chronicle.ts";
import { weekDaysOf } from "../../../../api/_world/weeks.ts";
import { mountainHour, threadDensity, threadPath, threadRate, threadsOf, type DayThreads } from "./archiveThreads.ts";
import { hoursOf, ROOM_NAME, shortDay } from "./ChronicleWeave.tsx";
import { polyOf, RC, useFlow, type FlowLayoutFn, type FlowLine } from "./flow/index.ts";
import { mixRgb } from "./wvCanvas.ts";

export { mountainHour };

/**
 * The Book of Hours, threaded (#431; Nikita, 2026-10-24: "I kind of used to like when you had those little lines
 * better… do it like a better version of it"). The Archive's stage on the Desk's flow kit: the week in Ilyr as seven
 * rows of twenty-four hours, and through each day every room it visited as a fine particle line, running from the
 * day's first written hour to its last. Where the Historian set a scene in a room, its thread is drawn in toward the
 * row's middle and tied off with a knot, so an hour that gathered several rooms reads as a stitch. A busier room's
 * thread carries more light and runs a little faster. While Skippy reads, the thread of the room being read lights
 * and a packet runs it; a new hour landing runs a packet down each of today's threads.
 *
 * Room colours are used with restraint: each thread is the room's colour folded halfway into Historian violet. Every
 * fact the lines show is also in plain type: the tallies, each day's count, and the caption under the pointer.
 */

const VIOLET = RC.archive!;
const tint = (room: RoomId) => mixRgb(RC[room] ?? VIOLET, VIOLET, 0.5);

const TICKS = [
  { h: 0, l: "midnight" },
  { h: 6, l: "6 am" },
  { h: 12, l: "noon" },
  { h: 18, l: "6 pm" },
  { h: 24, l: "midnight" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lineId = (col: number, room: RoomId) => `${col}|${room}`;
const hourWord = (h: number) => TICKS.find((t) => t.h === h)?.l ?? (h < 12 ? `${h} am` : `${h - 12} pm`);

/** What the read-along is reading: a line in a room on a day. */
export interface Reading {
  day: string;
  room: RoomId;
  i: number;
}

export function ThreadedWeek({
  head,
  monday,
  shown,
  today,
  now,
  days,
  pages,
  recent,
  waiting,
  latestStep,
  reading,
  onPick,
  onWeek,
  prevWeek,
  nextWeek,
}: {
  head: ReactNode;
  monday: string;
  shown: string;
  today: string;
  now: number;
  days: string[];
  pages: Record<string, DayPage | "loading" | "failed">;
  recent: HistoryEntry[];
  /** The world isn't being saved yet: the days so far wait, dashed. */
  waiting: boolean;
  latestStep: number | null;
  reading: Reading | null;
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
  // A cell per hour of the week: its latest entry.
  const entries: (HistoryEntry | null)[] = Array.from({ length: 168 }, () => null);
  hrsBy.forEach((hrs, col) => {
    for (const e of hrs) entries[col * 24 + mountainHour(Date.parse(e.at))] = e;
  });
  const rows: DayThreads[] = hrsBy.map((hrs) => threadsOf(hrs));
  const sig = JSON.stringify(rows);
  const stage = useRef<HTMLElement>(null);
  const [hot, setHot] = useState<string | null>(null);

  // The layout: read the rows' boxes (only here, never in a frame) and lay each day's threads through its row.
  const layout = useCallback<FlowLayoutFn>(
    ({ rel }) => {
      const root = stage.current;
      if (!root) return { lines: [] };
      const ds = JSON.parse(sig) as DayThreads[];
      const most = Math.max(1, ...ds.flatMap((d) => d.threads.map((t) => t.scenes)));
      const lines: FlowLine[] = [];
      ds.forEach((d, col) => {
        const el = root.querySelector(`[data-ax-band="${col}"]`);
        if (!el) return;
        const band = rel(el);
        if (!band.w) return;
        if (!d.threads.length) {
          // Not being saved yet: the days so far wait, dashed. Never fake flow.
          const upTo = col === todayCol ? (hourNow + 1) / 24 : col < todayCol || todayCol < 0 ? 1 : 0;
          if (waiting && upTo > 0) lines.push({ id: `${col}|wait`, path: { from: [band.x, band.y + band.h / 2], to: [band.x + band.w * upTo, band.y + band.h / 2], bend: 0 }, waiting: true });
          return;
        }
        d.threads.forEach((t, k) => {
          const { via, knots } = threadPath(band, k, d.threads.length, t, d.from, d.to);
          const poly = polyOf({ via });
          lines.push({
            id: lineId(col, t.room),
            path: { via },
            rgb: tint(t.room),
            density: threadDensity(t.scenes, most),
            rate: threadRate(t.lines),
            bright: col === shownCol ? 1 : 0.85,
            spread: 0.9,
            bed: 0.06,
            knots: knots.map(([x, y]) => poly.nearest(x, y).u),
          });
        });
      });
      return { lines };
    },
    [sig, todayCol, shownCol, waiting, hourNow],
  );
  const { cv, field, bind } = useFlow(layout, { accent: VIOLET, ground: true, backing: 650_000, onHover: setHot, tol: 6 });

  // The read-along: the room being read lights on its day, and a packet runs its thread.
  const readKey = reading ? `${reading.day}|${reading.room}|${reading.i}` : "";
  const lastRead = useRef<string | null>(null);
  useEffect(() => {
    if (!reading) {
      if (lastRead.current) field.setFocus(null);
      lastRead.current = null;
      return;
    }
    const col = week.indexOf(reading.day);
    const id = col >= 0 ? lineId(col, reading.room) : null;
    if (!id || !field.line(id)) return;
    field.setFocus(id);
    field.pulse(id, { size: 8 });
    if (lastRead.current !== id) field.rise(ROOM_NAME[reading.room], { at: id });
    lastRead.current = id;
  }, [readKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new hour written while the page is open: a packet down each of today's threads.
  const seen = useRef(latestStep);
  useEffect(() => {
    const was = seen.current;
    seen.current = latestStep;
    if (latestStep == null || was == null || latestStep <= was || todayCol < 0) return;
    const t = rows[todayCol]?.threads ?? [];
    const timers = t.map((x, i) => window.setTimeout(() => field.pulse(lineId(todayCol, x.room)), 400 + i * 140));
    if (t.length) field.rise("an hour written", { at: lineId(todayCol, t[t.length - 1]!.room) });
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [latestStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // The hour under the pointer (or picked with the keys), or the latest written hour when there's none.
  const [at, setAt] = useState(-1);
  const latest = entries.reduce((best, e, i) => (e && (best < 0 || Date.parse(e.at) > Date.parse(entries[best]!.at)) ? i : best), -1);
  const focus = at >= 0 ? at : latest;
  const cellAt = (ev: { clientX: number; target: EventTarget }) => {
    const band = ev.target instanceof Element ? ev.target.closest("[data-ax-band]") : null;
    if (!band) return -1;
    const r = band.getBoundingClientRect();
    const col = Number(band.getAttribute("data-ax-band"));
    const h = Math.floor(((ev.clientX - r.left) / r.width) * 24);
    return h >= 0 && h < 24 ? col * 24 + h : -1;
  };
  const open = (i: number) => {
    if (i < 0) return;
    const e = entries[i];
    const col = Math.floor(i / 24);
    if (e) onPick(week[col]!, e.step);
    else if (hrsBy[col]!.length) onPick(week[col]!);
  };
  const key = (ev: React.KeyboardEvent) => {
    const i = at >= 0 ? at : latest >= 0 ? latest : 0;
    const mv: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 };
    if (ev.key in mv) {
      ev.preventDefault();
      setAt(Math.max(0, Math.min(167, i + mv[ev.key]!)));
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      open(i);
    }
  };

  const hours = hrsBy.reduce((n, h) => n + h.length, 0);
  const spoken = hrsBy.reduce((n, h) => n + h.reduce((m, e) => m + e.scenes.reduce((k, s) => k + s.lines.length, 0), 0), 0);
  const ships = hrsBy.reduce((n, h) => n + h.reduce((m, e) => m + e.remarks.length, 0), 0);
  const roomsWeek = new Map<RoomId, number>();
  for (const r of rows) for (const t of r.threads) roomsWeek.set(t.room, (roomsWeek.get(t.room) ?? 0) + t.scenes);
  const f = focus >= 0 ? { d: week[Math.floor(focus / 24)]!, h: focus % 24, e: entries[focus] } : null;
  const fs = f ? shortDay(f.d) : null;
  const fFuture = f ? f.d > today || (f.d === today && f.h > hourNow) : false;
  const hotRoom = hot && !hot.endsWith("|wait") ? (hot.split("|")[1] as RoomId) : null;
  const hotDay = hot ? Number(hot.split("|")[0]) : -1;
  const hotThread = hotRoom ? rows[hotDay]?.threads.find((t) => t.room === hotRoom) : null;
  const first = shortDay(week[0]!);
  const last = shortDay(week[6]!);

  return (
    <section ref={stage} className="fl-stage ax-stage" aria-label="The Archive" {...bind} data-hot={hot ?? undefined}>
      <canvas ref={cv} className="fl-cv" aria-hidden="true" />
      <div className="ax-head">{head}</div>

      <div className="ax-week">
        <header className="ax-week-head">
          <div>
            <p className="fl-k">
              <span>The Book of Hours</span>
              <span className="ax-week-k"> · the week in Ilyr, hour by hour</span>
            </p>
            <h2 className="fl-h2 ax-week-h">
              {first.month} <em>to</em> {last.month}
            </h2>
          </div>
          <dl className="ax-tally">
            <div>
              <dt>Hours written</dt>
              <dd className="fl-num">{hours}</dd>
            </div>
            <div>
              <dt>Lines spoken</dt>
              <dd className="fl-num">{spoken}</dd>
            </div>
            <div>
              <dt>Changes shipped</dt>
              <dd className="fl-num">{ships}</dd>
            </div>
          </dl>
          <div className="ax-week-nav" role="group" aria-label="Weeks">
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

        <ol className="ax-ticks" aria-hidden="true">
          {TICKS.map((t) => (
            <li key={t.h} style={{ "--h": t.h } as React.CSSProperties}>
              {t.l}
            </li>
          ))}
        </ol>
        <ol
          className="ax-rows"
          role="grid"
          tabIndex={0}
          aria-label="Hours of the week. Arrow keys move between hours; Enter opens one."
          onPointerMove={(ev) => {
            const i = cellAt(ev);
            if (i >= 0 && i !== at) setAt(i);
          }}
          onPointerLeave={() => setAt(-1)}
          onClick={(ev) => {
            // A tap first shows the hour (a mouse has already pointed at it), the next one opens it.
            const i = cellAt(ev);
            if (i < 0) return;
            if (i !== at) setAt(i);
            else open(i);
          }}
          onKeyDown={key}
          onBlur={() => setAt(-1)}
        >
          {week.map((d, col) => {
            const s = shortDay(d);
            const n = hrsBy[col]!.length;
            const has = days.includes(d) || n > 0;
            const isAt = focus >= 0 && Math.floor(focus / 24) === col;
            const cls = [d === shown && "is-shown", d === today && "is-today", d > today && "is-future", isAt && "is-at"].filter(Boolean).join(" ");
            return (
              <li key={d} className={cls || undefined} role="row">
                <button
                  type="button"
                  className="ax-day-l"
                  disabled={!has}
                  aria-pressed={d === shown}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onPick(d);
                  }}
                  aria-label={`Open ${s.long} ${s.month}`}
                >
                  <span>{d === today ? "Today" : s.wd}</span>
                  <b className="fl-num">{s.d}</b>
                  <small>{d > today ? "to come" : n ? plural(n, "hour") : "none yet"}</small>
                </button>
                <div
                  className="ax-band"
                  data-ax-band={col}
                  role="gridcell"
                  aria-label={`${s.long}: ${n ? `${plural(rows[col]!.threads.length, "room")} over ${plural(n, "hour")}` : "nothing written"}`}
                  style={d === today ? ({ "--now": (hourNow + 0.5) / 24 } as React.CSSProperties) : undefined}
                >
                  {isAt && <i className="ax-cur" style={{ "--h": focus % 24 } as React.CSSProperties} aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="ax-caption" aria-live="polite">
          {f && fs ? (
            <>
              <p className="ax-caption-when">
                <b className="fl-num">
                  {f.d === today ? "Today" : fs.long} {fs.d}
                </b>
                <span>{f.e ? hourLabel(f.e.at) : hourWord(f.h)}</span>
                {f.e && (
                  <small>
                    {[...new Set(f.e.scenes.map((x) => ROOM_NAME[x.room]))].join(", ") || "no scene"}
                    {` · ${plural(
                      f.e.scenes.reduce((k, x) => k + x.lines.length, 0),
                      "line",
                    )}`}
                    {f.e.remarks.length ? ` · ${plural(f.e.remarks.length, "change")} shipped` : ""}
                    {f.e.source === "scripted" ? " · scripted" : ""}
                  </small>
                )}
              </p>
              <p className="ax-caption-s">{f.e ? f.e.summary : fFuture ? "This hour hasn't come yet." : "Nothing was written down in this hour."}</p>
              {hotThread && hotRoom && (
                <p className="ax-caption-th">
                  <i style={{ "--c": `rgb(${tint(hotRoom)})` } as React.CSSProperties} aria-hidden="true" />
                  {shortDay(week[hotDay]!).long}, the {ROOM_NAME[hotRoom]}: {plural(hotThread.scenes, "scene")} over {plural(hotThread.hours.length, "hour")}, {plural(hotThread.lines, "line")} spoken
                </p>
              )}
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
            <p className="ax-caption-s is-empty">{waiting ? "The threads wait for the world's first step. Each hour the Historian writes, the rooms it visited run on as threads." : "Nothing written this week yet. Each hour the world takes a step, the rooms it visits run on as threads."}</p>
          )}
        </div>
        <ul className="ax-key" aria-label="How to read the threads">
          <li>
            <i className="is-thread" aria-hidden="true" />A thread for each room a day visited
          </li>
          <li>
            <i className="is-knot" aria-hidden="true" />A knot where a scene was set
          </li>
          {[...roomsWeek.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([r, n]) => (
              <li key={r} className="ax-key-room">
                <i style={{ "--c": `rgb(${tint(r)})` } as React.CSSProperties} aria-hidden="true" />
                {ROOM_NAME[r]} <small className="fl-num">{n}</small>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
