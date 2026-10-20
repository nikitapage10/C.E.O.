import { span } from "../worldClock.ts";

/**
 * When the Foundry crew runs next (issue #205), from the fixed schedule in docs/FOUNDRY.md: queue checks at :06, :21,
 * :36 and :51 every hour (UTC), upkeep every 5 hours from an anchor (runs may start a few minutes late), and the
 * morning ideas at 9:00 Mountain time (DST-safe: it reads the Denver wall clock, like the Veil does).
 */
export const QUEUE_MINUTES = [6, 21, 36, 51] as const;
export const UPKEEP_ANCHOR_MS = Date.parse("2026-10-13T20:51:00Z");
export const UPKEEP_EVERY_MS = 5 * 3_600_000;

export interface NextRuns {
  queue: Date;
  upkeep: Date;
  ideas: Date;
}

const denver = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "numeric", hourCycle: "h23" });

function isNineInDenver(ms: number): boolean {
  const parts = denver.formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return get("hour") === 9 && get("minute") === 0;
}

/** The next 9:00 Denver strictly after `ms`: 15:00Z (MDT) or 16:00Z (MST) on a nearby UTC day. */
function nextIdeas(ms: number): number {
  const day = Math.floor(ms / 86_400_000);
  let best = Infinity;
  for (let d = day - 1; d <= day + 2; d++) {
    for (const h of [15, 16]) {
      const t = d * 86_400_000 + h * 3_600_000;
      if (t > ms && t < best && isNineInDenver(t)) best = t;
    }
  }
  return best;
}

export function nextRuns(now: Date): NextRuns {
  const ms = now.getTime();
  const hour = Math.floor(ms / 3_600_000) * 3_600_000;
  let queue = Infinity;
  for (const h of [0, 1]) for (const m of QUEUE_MINUTES) {
    const t = hour + h * 3_600_000 + m * 60_000;
    if (t > ms && t < queue) queue = t;
  }
  const steps = Math.floor((ms - UPKEEP_ANCHOR_MS) / UPKEEP_EVERY_MS) + 1;
  const upkeep = UPKEEP_ANCHOR_MS + Math.max(0, steps) * UPKEEP_EVERY_MS;
  return { queue: new Date(queue), upkeep: new Date(upkeep), ideas: new Date(nextIdeas(ms)) };
}

/** "in 5 min", "in about 2 h 10 min" (upkeep may start a few minutes late). */
export function countdown(to: Date, now: Date, about = false): string {
  return `in ${about ? "about " : ""}${span(to.getTime() - now.getTime())}`;
}

/** "9:00 am", in Mountain time like the rest of the Desk. */
export function runTime(at: Date): string {
  return at.toLocaleTimeString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" }).toLowerCase();
}
