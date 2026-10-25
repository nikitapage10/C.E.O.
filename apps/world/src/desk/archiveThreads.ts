import type { HistoryEntry, RoomId } from "../chronicle.ts";

/**
 * The Archive's threads (#431): the week's Book of Hours as particle lines. Each day is a row of twenty-four hours, and
 * every room the day visited runs through it as a fine thread, from the day's first written hour to its last. Where
 * the Historian set a scene in that room, the thread is drawn in toward the row's middle and tied off with a knot, so
 * an hour that gathered several rooms reads as a stitch. Plain maths, no DOM and no canvas (archiveThreads.test.ts).
 */

/** The rooms in the order their threads lie in a day's row, top to bottom. */
export const THREAD_ORDER: RoomId[] = ["foundry", "relay", "boiler", "archive", "breakroom", "spire", "exchange", "green", "workshop", "studio"];

const MT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" });
/** The hour of a moment in Mountain time, the Chronicle's clock. */
export const mountainHour = (at: number) => Number(MT.format(new Date(at))) % 24;

/** One room's thread through one day. */
export interface Thread {
  room: RoomId;
  /** The hours (0..23) the Historian set a scene there, ascending, no repeats. */
  hours: number[];
  scenes: number;
  /** Lines the cast spoke there that day. */
  lines: number;
}

/** A day's row: its threads in THREAD_ORDER, and the span of hours written (from, to: to is exclusive). */
export interface DayThreads {
  threads: Thread[];
  from: number;
  to: number;
}

/** A day's hours (oldest first) as threads, one per room it visited. */
export function threadsOf(entries: HistoryEntry[], hourOf: (e: HistoryEntry) => number = (e) => mountainHour(Date.parse(e.at))): DayThreads {
  const by = new Map<RoomId, Thread>();
  let from = 24;
  let to = 0;
  for (const e of entries) {
    const h = hourOf(e);
    from = Math.min(from, h);
    to = Math.max(to, h + 1);
    for (const s of e.scenes) {
      const t = by.get(s.room) ?? { room: s.room, hours: [], scenes: 0, lines: 0 };
      if (!t.hours.includes(h)) t.hours.push(h);
      t.scenes++;
      t.lines += s.lines.length;
      by.set(s.room, t);
    }
  }
  const threads = THREAD_ORDER.map((r) => by.get(r)).filter((t): t is Thread => !!t);
  for (const t of threads) t.hours.sort((a, b) => a - b);
  return entries.length ? { threads, from, to } : { threads: [], from: 0, to: 0 };
}

/** A band on the canvas: a day's row. */
export interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far a knot draws its thread in toward the row's middle (1 leaves it where it lies). */
const PULL = 0.3;

/**
 * Where thread `k` of `n` lies in a band, as points through the written span: one point per hour at the hour's middle
 * (drawn in where it has a scene), and the span's two ends. Also where its knots sit.
 */
export function threadPath(band: Band, k: number, n: number, t: Thread, from: number, to: number): { via: [number, number][]; knots: [number, number][] } {
  const x = (h: number) => band.x + (h / 24) * band.w;
  const mid = band.y + band.h / 2;
  const gap = n > 1 ? Math.min(11, (band.h * 0.8) / (n - 1)) : 0;
  const off = (k - (n - 1) / 2) * gap;
  const on = new Set(t.hours);
  const via: [number, number][] = [[x(from), mid + off]];
  const knots: [number, number][] = [];
  for (let h = from; h < to; h++) {
    const y = mid + off * (on.has(h) ? PULL : 1);
    via.push([x(h + 0.5), y]);
    if (on.has(h)) knots.push([x(h + 0.5), y]);
  }
  via.push([x(to), mid + off]);
  return { via, knots };
}

/** A thread's volume, 0..1: its scenes against the week's busiest thread, never so faint it vanishes. */
export const threadDensity = (scenes: number, most: number) => Math.min(1, 0.18 + 0.52 * (scenes / Math.max(1, most)));

/** A thread's pace, px/s: busier talk runs a little faster. */
export const threadRate = (lines: number) => Math.min(46, 12 + lines * 2.2);
