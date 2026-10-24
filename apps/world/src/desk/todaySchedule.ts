import type { RoomId } from "../chronicle.ts";
import { nextRuns, QUEUE_MINUTES, UPKEEP_EVERY_MS } from "./crewRuns.ts";
import { mountainHour } from "./ilyrTime.ts";
import type { TodayIcon } from "./todayIcons.tsx";

/**
 * Today's little schedule (#363, Nikita 2026-10-24: "the world clock stuff, what the crew does next, little
 * schedule"): what runs next and when, from the fixed schedule in docs/FOUNDRY.md (crewRuns.ts) and the world clock's own
 * next step. Nothing here is guessed beyond that schedule: the queue checks, upkeep and the morning ideas are cron
 * times, Skippy presents Today in Ilyr about every five hours and the whole day after midnight (#365), and Ilyr's hour comes from the clock's reading (then hourly, as the
 * step runs). Pure, so it is tested on its own (todaySchedule.test.ts).
 */

export const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The queue checks run four times an hour, a quarter-hour apart. */
const QUEUE_EVERY = (60 / QUEUE_MINUTES.length) * 60_000;

export interface Run {
  key: "queue" | "upkeep" | "ideas" | "story" | "hour";
  at: number;
  room: RoomId;
  icon: TodayIcon;
  what: string;
  who: string;
  /** How often it comes round, for how far along the wait is. */
  every: number;
}

/** The next Mountain wall-clock hour `h` after `now`, to the minute. */
export function nextMountain(now: number, h: number): number {
  let wait = (h - mountainHour(now)) * HOUR;
  if (wait <= 0) wait += DAY;
  return now + wait - (now % 60_000);
}

/** Today in Ilyr's editions (#365): "so far" after 5 am, 10 am, 3 pm and 8 pm Mountain, the whole day after midnight. */
export const EDITION_HOURS = [0, 5, 10, 15, 20] as const;

/** Skippy's next edition of Today in Ilyr: the first world step after the hour, when the Chronicle has news. */
export function nextEdition(now: number): Run {
  const at = Math.min(...EDITION_HOURS.map((h) => nextMountain(now, h)));
  const final = Math.abs(at - nextMountain(now, 0)) < 60_000;
  return { key: "story", at, room: "archive", icon: "story", what: final ? "Today in Ilyr, the whole day" : "Today in Ilyr, so far", who: "Skippy", every: 5 * HOUR };
}

/** Everything that runs next, soonest first. `hourAt` is the world clock's next step (null when it isn't reading). */
export function upcoming(now: number, hourAt: number | null): Run[] {
  const r = nextRuns(new Date(now));
  const list: Run[] = [
    { key: "queue", at: r.queue.getTime(), room: "foundry", icon: "queue", what: "Queue check", who: "the dock crew", every: QUEUE_EVERY },
    { key: "upkeep", at: r.upkeep.getTime(), room: "workshop", icon: "upkeep", what: "Upkeep", who: "Rivet", every: UPKEEP_EVERY_MS },
    { key: "ideas", at: r.ideas.getTime(), room: "spire", icon: "dawn", what: "Morning ideas", who: "Rusty", every: DAY },
    nextEdition(now),
  ];
  if (hourAt !== null && hourAt > now) list.push({ key: "hour", at: hourAt, room: "boiler", icon: "hour", what: "Ilyr's next hour", who: "the world clock", every: HOUR });
  return list.sort((a, b) => a.at - b.at);
}

/** How far through its wait a run is, 0..1 (1 when it is due). */
export function along(run: Run, now: number): number {
  return Math.min(1, Math.max(0, 1 - (run.at - now) / run.every));
}

/** Every time a run comes round inside [now, now + span), for the ribbon. */
export function occurrences(run: Run, now: number, span: number): number[] {
  const out: number[] = [];
  // The story and the ideas come once a day, so only their first time can sit inside a window shorter than a day.
  for (let t = run.at; t < now + span && out.length < 200; t += run.every) if (t >= now) out.push(t);
  return out;
}

/** The quiet hours for pings (10 PM to 7 AM, Mountain) that overlap [now, now + span), as [from, to] pairs. */
export function quietBands(now: number, span: number): [number, number][] {
  const h = mountainHour(now);
  const inQuiet = h >= 22 || h < 7;
  const out: [number, number][] = [];
  let from = inQuiet ? now : nextMountain(now, 22);
  while (from < now + span) {
    const to = nextMountain(from + 60_000, 7);
    out.push([from, Math.min(to, now + span)]);
    from = nextMountain(to + 60_000, 22);
  }
  return out;
}

/** Whether pings are quiet at `now`. */
export const isQuiet = (now: number) => {
  const h = mountainHour(now);
  return h >= 22 || h < 7;
};

/** "now", "in 45 s", "in 7 min", "in 2 h 10 min". */
export function until(at: number, now: number, seconds = false): string {
  const ms = at - now;
  if (ms <= 0) return "now";
  if (seconds && ms < 60_000) return `in ${Math.ceil(ms / 1000)} s`;
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `in ${m} min`;
  const hh = Math.floor(m / 60);
  return m % 60 ? `in ${hh} h ${m % 60} min` : `in ${hh} h`;
}

/** "2:05 am", Mountain, like the rest of the Desk. */
export const mtTime = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" }).toLowerCase();

const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
/** 21 → "XXI": the hour of the day as the bridge's chart writes it (#385); 0 is the day's last hour, XXIV. */
export function roman(n: number): string {
  let out = "";
  let k = Math.max(0, Math.floor(n));
  for (const [v, s] of ROMAN)
    while (k >= v) {
      out += s;
      k -= v;
    }
  return out || "XXIV";
}
