/**
 * When the home's devices run next, in words (#952, Nikita 2026-11-06: "when is the next wet food cycle for my cat?"
 * and "what's the vacuum cleaner's next schedule?"). One place for every schedule Skippy answers from: the wet
 * feeder's Petlibro plan (or the device list's own next meal when the plan doesn't come back to the Haven's shared
 * account), the dry feeder's plan for today, and the vacuum's schedules from the Roborock app.
 *
 * The Roborock schedules are the app's own (python-roborock's get_schedules: GET {rriot.r.a}/user/devices/{duid}/jobs,
 * Hawk-signed), each a cron line "minute hour day month weekday" in the home's time, with `enabled` and `repeated`. A
 * repeating one names weekdays (0 or 7 Sunday … 6 Saturday, "*" or "?" every day); a one-off one names its day and
 * month. Only the time and the days are kept: never a room, a map or an id.
 *
 * Pure, all in Mountain time. Underscore folder: Vercel never serves it as a function.
 */

import { denverNow } from "./petlibro.js";
import { clockWords, noPlanWords } from "./rails.js";
import type { DeviceReading } from "./types.js";

/** One Roborock schedule: "HH:MM", the weekdays it repeats on (0 Sunday … 6 Saturday; empty is every day), or the one
 * day it runs once ("MM-DD"), and whether it is switched on. */
export interface VacSchedule {
  time: string;
  days: number[];
  once?: string;
  on: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => String(n).padStart(2, "0");

/** One cron line as Roborock writes it, or null when it isn't one this reads. */
export function cronSchedule(cron: unknown, enabled: unknown): VacSchedule | null {
  if (typeof cron !== "string") return null;
  const f = cron.trim().split(/\s+/);
  if (f.length < 2 || f.length > 6) return null;
  const min = Number(f[0]);
  const hour = Number(f[1]);
  if (!Number.isInteger(min) || !Number.isInteger(hour) || min < 0 || min > 59 || hour < 0 || hour > 23) return null;
  const time = `${two(hour)}:${two(min)}`;
  const on = enabled !== false && enabled !== 0;
  const dom = f[2] ?? "*";
  const month = f[3] ?? "*";
  const dow = f[4] ?? "*";
  if (/^\d{1,2}$/.test(dom) && /^\d{1,2}$/.test(month) && (dow === "?" || dow === "*")) {
    const d = Number(dom);
    const m = Number(month);
    return d >= 1 && d <= 31 && m >= 1 && m <= 12 ? { time, days: [], once: `${two(m)}-${two(d)}`, on } : null;
  }
  if (dow === "*" || dow === "?") return { time, days: [], on };
  const days = [...new Set(dow.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 7).map((n) => n % 7))].sort();
  return days.length ? { time, days, on } : null;
}

/** The schedules out of Roborock's jobs answer ({ success, result: [...] }, or the list itself). At most 20. */
export function roborockSchedules(answer: unknown): VacSchedule[] {
  const o = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  const list = Array.isArray(answer) ? answer : Array.isArray(o.result) ? o.result : [];
  return list
    .slice(0, 20)
    .map((j) => (j && typeof j === "object" ? (j as Record<string, unknown>) : {}))
    .map((j) => cronSchedule(j.cron, j.enabled))
    .filter((s): s is VacSchedule => s !== null);
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Today's date in Mountain time, "MM-DD". */
function denverDay(now: number, plusDays = 0): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now + plusDays * 86_400_000));
  return `${p.find((x) => x.type === "month")?.value}-${p.find((x) => x.type === "day")?.value}`;
}

/** The next run of the switched-on schedules, within a week (or a one-off within a year): days from today and the time. */
export function nextVacRun(list: VacSchedule[], now: number): { inDays: number; time: string; once?: string } | null {
  const { minutes, weekday } = denverNow(now);
  // denverNow's weekday is Petlibro's (1 Monday … 7 Sunday); the cron's is 0 Sunday … 6 Saturday.
  const today = weekday % 7;
  let best: { inDays: number; time: string; once?: string } | null = null;
  const better = (c: { inDays: number; time: string }) => !best || c.inDays < best.inDays || (c.inDays === best.inDays && c.time < best.time);
  for (const s of list) {
    if (!s.on) continue;
    if (s.once) {
      for (let d = 0; d < 366; d++) {
        if (denverDay(now, d) !== s.once) continue;
        if (d === 0 && minutesOf(s.time) <= minutes) break;
        const c = { inDays: d, time: s.time, once: s.once };
        if (better(c)) best = c;
        break;
      }
      continue;
    }
    for (let d = 0; d < 8; d++) {
      const day = (today + d) % 7;
      if (s.days.length && !s.days.includes(day)) continue;
      if (d === 0 && minutesOf(s.time) <= minutes) continue;
      const c = { inDays: d, time: s.time };
      if (better(c)) best = c;
      break;
    }
  }
  return best;
}

/** "today", "tomorrow", "on Thursday", or "on December 15". */
function whenWords(inDays: number, now: number, once?: string): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (once && inDays >= 7) return `on ${MONTHS[Number(once.slice(0, 2)) - 1]} ${Number(once.slice(3))}`;
  const { weekday } = denverNow(now + inDays * 86_400_000);
  return `on ${DAY_NAMES[weekday % 7]}`;
}

/** The vacuum's schedule in one spoken sentence. */
export function vacScheduleWords(r: Pick<DeviceReading, "schedule" | "online">, now: number): string {
  const list = r.schedule;
  if (!list) return "The Roborock app's schedule didn't come back just now.";
  if (!list.length) return "There's no cleaning schedule set in the Roborock app.";
  const next = nextVacRun(list, now);
  if (!next) return "Every cleaning schedule in the Roborock app is switched off.";
  const more = list.filter((s) => s.on).length - 1;
  return `The vacuum's next scheduled clean is ${whenWords(next.inDays, now, next.once)} at ${clockWords(next.time)}${more > 0 ? ` (${more + 1} schedules are on)` : ""}.`;
}

/** The wet feeder's next meal in one spoken sentence, from its plan, or the device list's own next meal ("" when the plan's meals carry no place in the day). */
export function wetNextWords(r: Pick<DeviceReading, "meals" | "nextFeed" | "planOn" | "online">): string {
  if (!r.online) return "The wet food feeder is offline.";
  const meals = r.meals ?? [];
  const next = meals.find((m) => m.status === "now") ?? meals.find((m) => m.status === "next");
  if (next) {
    const bowl = next.plate ? `, bowl ${next.plate}${next.label ? ` (${next.label})` : ""}` : next.label ? ` (${next.label})` : "";
    return next.status === "now" ? `The wet food feeder's meal is on now${bowl}, until ${clockWords(next.end ?? next.time)}.` : `The next wet meal is at ${clockWords(next.time)}${bowl}.`;
  }
  // Meals without a place in the day (read without the clock): the tray's own schedule line says them.
  if (meals.length && meals.some((m) => !m.status)) return "";
  // Every meal today is done: tomorrow's first, when the plan repeats daily (Petlibro's wet plan does).
  if (meals.length) return `That's all of today's wet meals; the next is tomorrow at ${clockWords(meals[0]!.time)}${meals[0]!.plate ? `, bowl ${meals[0]!.plate}` : ""}.`;
  if (r.planOn !== false && r.nextFeed) return `The next wet meal is at ${clockWords(r.nextFeed.time)}.`;
  return noPlanWords(r);
}

/** The dry feeder's next meal in one spoken sentence, from today's plan. */
export function dryNextWords(r: Pick<DeviceReading, "plan" | "online">): string {
  if (!r.online) return "The dry food feeder is offline.";
  const plan = r.plan ?? [];
  if (!plan.length) return "The dry food feeder has no schedule for today in the Petlibro app.";
  const next = plan.find((m) => m.status === "next");
  const portions = (n?: number) => (n ? `, ${n} portion${n === 1 ? "" : "s"}` : "");
  if (next) return `The next dry meal is at ${clockWords(next.time)}${portions(next.portions)}.`;
  const first = plan.find((m) => m.on);
  return first ? `That's all of today's dry meals; the first is at ${clockWords(first.time)}${portions(first.portions)}.` : "Every dry meal in the Petlibro app is switched off.";
}
