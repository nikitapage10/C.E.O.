/**
 * Which week it is in Ilyr (#211; docs/WORLD.md): the week runs Monday to Sunday in Mountain time and is named by its
 * Monday ("2026-10-19"). Pure date helpers with no imports, so the world step, the story route and the Desk's
 * Chronicle all take them as they are.
 */

const MT = "America/Denver";
/** The Sunday evening the week is told: the first step at or after this hour (Mountain time). */
export const WEEK_TOLD_HOUR = 18;

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};

/** The Monday of the week a "2026-10-13" day falls in. */
export function weekStartOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** The seven days of a week, Monday first. */
export const weekDaysOf = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** The week before this one (by its Monday). */
export const previousWeek = (monday: string) => addDays(monday, -7);

/** A moment's Mountain-time day, weekday (0 = Sunday) and hour. */
export function mountainClock(at: number): { day: string; weekday: number; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: MT, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday, hour: Number(parts.hour) };
}

/** The week to tell right now: this week's Monday on a Sunday from 6 pm Mountain on, else null. */
export function weekDue(at: number): string | null {
  const { day, weekday, hour } = mountainClock(at);
  return weekday === 0 && hour >= WEEK_TOLD_HOUR ? weekStartOf(day) : null;
}
