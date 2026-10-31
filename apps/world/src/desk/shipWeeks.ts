import { mountainClock, previousWeek, weekStartOf } from "../../../../api/_world/weeks.ts";
import { CREW, type Change } from "../foundry.ts";

/**
 * The Archive's "Week by week": what the Foundry shipped, grouped by week (Monday to Sunday in Mountain time, named by
 * its Monday, the same weeks the Chronicle keeps). Plain maths over the changelog the Desk already loads
 * (shipWeeks.test.ts), no fetch and no DOM.
 */

/** How many weeks the section looks back over, this one included. */
export const WEEKS_SHOWN = 6;
/** The newest weeks that start open; older ones fold away. */
export const WEEKS_OPEN = 2;

export interface ShipEntry {
  key: string;
  title: string;
  /** The issue's `**Short:**` line, or "". */
  short: string;
  /** The builder's name from the Builder line, or "". */
  builder: string;
  at: number;
  href: string | null;
  pictures: NonNullable<Change["pictures"]>;
}

export interface ShipWeek {
  /** The week's Monday, "2026-10-26". */
  monday: string;
  /** Newest first. */
  entries: ShipEntry[];
}

const plain = (title: string) => {
  const t = title.replace(/^Idea:\s*/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The changes shipped in the last `weeks` weeks (counting the one `now` falls in), grouped by week, newest week first and newest change first. Empty weeks are left out. */
export function shipWeeks(changelog: readonly Change[], now: number, weeks = WEEKS_SHOWN): ShipWeek[] {
  let oldest = weekStartOf(mountainClock(now).day);
  for (let i = 1; i < weeks; i++) oldest = previousWeek(oldest);
  const by = new Map<string, ShipEntry[]>();
  for (const c of changelog) {
    if (!Number.isFinite(c.at) || c.at > now) continue;
    const monday = weekStartOf(mountainClock(c.at).day);
    if (monday < oldest) continue;
    const list = by.get(monday) ?? [];
    list.push({ key: c.key, title: plain(c.title), short: c.short, builder: c.by ? CREW[c.by].name : "", at: c.at, href: c.issue?.url ?? c.landed?.url ?? null, pictures: c.pictures ?? [] });
    by.set(monday, list);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([monday, entries]) => ({ monday, entries: entries.sort((a, b) => b.at - a.at) }));
}
