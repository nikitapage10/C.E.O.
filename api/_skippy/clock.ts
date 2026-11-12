/**
 * Nikita's clock (#1069): today's date and time where he lives, for every prompt that has to know what "today" is.
 * A call's quick search once hedged that a forecast page "may not be today's date" because nothing told it the date;
 * the lookups, the spoken turns and the weather read all say it from here.
 *
 * Pure: no I/O.
 */

/** Nikita's time zone, the Desk's and the call's (voicecrew.ts CALL_TIMEZONE). */
export const HOME_TZ = "America/Denver";

/** "Thursday, November 12, 2026, 10:41 AM Mountain time". */
export function clockLine(now: number): string {
  const day = new Date(now).toLocaleString("en-US", { timeZone: HOME_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = new Date(now).toLocaleString("en-US", { timeZone: HOME_TZ, hour: "numeric", minute: "2-digit" });
  return `${day}, ${time} Mountain time`;
}

/** The date alone, as a lookup's answer would say it: "Thursday, November 12". */
export const dayLine = (now: number): string => new Date(now).toLocaleString("en-US", { timeZone: HOME_TZ, weekday: "long", month: "long", day: "numeric" });
