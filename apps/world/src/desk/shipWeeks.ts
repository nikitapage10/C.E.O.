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
  /** How long it took, issue opened to issue closed, in ms; null when either time is missing. */
  took: number | null;
  href: string | null;
  pictures: NonNullable<Change["pictures"]>;
}

export interface ShipWeek {
  /** The week's Monday, "2026-10-26". */
  monday: string;
  /** Newest first. */
  entries: ShipEntry[];
  /** The median `took` of the week's changes that have one, in ms; null when none does. */
  median: number | null;
}

const plain = (title: string) => {
  const t = title.replace(/^Idea:\s*/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** A span in ms, written short: "42 min", "3 h", "2 d" (rounded to the nearest, a minute at least). */
export function formatSpan(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

/** The middle of the spans (the mean of the two middle ones for an even count); null for none. */
export function medianSpan(spans: readonly number[]): number | null {
  if (!spans.length) return null;
  const s = [...spans].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

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
    list.push({ key: c.key, title: plain(c.title), short: c.short, builder: c.by ? CREW[c.by].name : "", at: c.at, took: c.openedAt !== undefined && Number.isFinite(c.openedAt) ? Math.max(0, c.at - c.openedAt) : null, href: c.issue?.url ?? c.landed?.url ?? null, pictures: c.pictures ?? [] });
    by.set(monday, list);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([monday, entries]) => ({ monday, entries: entries.sort((a, b) => b.at - a.at), median: medianSpan(entries.flatMap((e) => (e.took === null ? [] : [e.took]))) }));
}
