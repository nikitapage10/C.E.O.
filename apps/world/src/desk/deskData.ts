/**
 * What the Desk shows, as plain data. Phase 2: the hub on the MacBook fills this in. Until then the Desk
 * renders `EMPTY_DESK`, which is honestly empty: no invented messages, only the shape of what will come.
 */

export type Urgency = "sooner" | "normal";

export interface OwedReply {
  id: string;
  /** Who is waiting. */
  name: string;
  /** Their last message, short. */
  preview: string;
  /** Date.now() of the message you have not answered. */
  since: number;
  urgency: Urgency;
  channel: "iMessage" | "SMS";
  /** Blasto's draft, if one is ready. */
  draft?: string;
}

export interface ReplyDay {
  /** Midnight of the day, Date.now() style. */
  day: number;
  /** Median minutes to reply that day; null when no replies were tracked. */
  medianMinutes: number | null;
  /** Replies sent that day. */
  sent: number;
}

export interface Approval {
  id: string;
  title: string;
  /** Which agent is asking. */
  agent: string;
  detail: string;
}

export interface DeskData {
  owed: OwedReply[];
  /** Threads Dialtone looked at and decided need nothing (group chats, codes, promos). */
  settled: number;
  /** The last seven days, oldest first. */
  week: ReplyDay[];
  /** Days in a row with nobody left waiting past their window. */
  streakDays: number;
  sentToday: number;
  approvals: Approval[];
  /** Dialtone's daily nudges, as [hour, minute]. */
  nudges: [number, number][];
}

/** A reply counts as overdue after this long. */
export const OVERDUE_MS = 4 * 60 * 60 * 1000;

const DAY = 86_400_000;

function midnight(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Seven empty days ending today: the strip's hairlines, with nothing on them. */
export function emptyWeek(now = Date.now()): ReplyDay[] {
  const today = midnight(now);
  return Array.from({ length: 7 }, (_, i) => ({ day: today - (6 - i) * DAY, medianMinutes: null, sent: 0 }));
}

export const EMPTY_DESK: DeskData = {
  owed: [],
  settled: 0,
  week: emptyWeek(),
  streakDays: 0,
  sentToday: 0,
  approvals: [],
  nudges: [
    [12, 30],
    [19, 0],
  ],
};

/** The Desk's data. Phase 2 swaps this for a subscription to the hub. */
export function useDeskData(): DeskData {
  return EMPTY_DESK;
}

/** Owed replies, oldest wait first. */
export function byWait(owed: OwedReply[]): OwedReply[] {
  return [...owed].sort((a, b) => (a.urgency === b.urgency ? a.since - b.since : a.urgency === "sooner" ? -1 : 1));
}

/** "3m", "2h 10m", "3d". */
export function formatWait(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Mean of the days that have a median, in minutes; null when none do. */
export function averageReply(week: ReplyDay[]): number | null {
  const known = week.map((d) => d.medianMinutes).filter((m): m is number => m !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** The next nudge after `now`, as Date.now() style. */
export function nextNudge(nudges: [number, number][], now = Date.now()): number | null {
  if (!nudges.length) return null;
  const today = midnight(now);
  const times = nudges.flatMap(([h, m]) => [today + (h * 60 + m) * 60_000, today + DAY + (h * 60 + m) * 60_000]);
  return times.filter((t) => t > now).sort((a, b) => a - b)[0] ?? null;
}
