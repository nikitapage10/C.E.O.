import "./zodConfig.ts";
import { z } from "zod";

/**
 * What Relay may ever tell the site (#149, docs/RELAY-PRIVACY.md, "Mac to the site"). The Lattice and the Desk are
 * public, so the hub on the MacBook sends them counts, enum states and timestamps, and nothing else: no names, no
 * handles, no message text, no drafts, no summaries, no free strings of any kind.
 *
 * `RelayStatusSchema` is an allowlist. Every object is strict, so an unknown key fails the whole status, and the only
 * strings it accepts are the enum values below. Counts are small whole numbers and timestamps fall in a plausible
 * window, so a phone number can't pass as either. The hub checks a status with `readRelayStatus` before it sends
 * one, and anything on the site that takes a status checks it again, the same way, before it stores or shows it.
 *
 * A refused status is dropped whole, never repaired: a hub that tried to send something extra has a bug, and the
 * site keeps showing the last good status. The problems it reports name the place and the kind of fault, never the
 * value or an unknown key's name, since either could be the private thing itself.
 */

/** The shape's version. A new field means a new version, a spec change and a test. */
export const RELAY_STATUS_VERSION = 1;

/** The hub's own state. "wiped" is the last status a full wipe sends, with every count at zero. */
export const RELAY_HUB_STATES = ["off", "starting", "listening", "paused", "error", "wiped"] as const;
export type RelayHubState = (typeof RELAY_HUB_STATES)[number];

/** A link the hub depends on: BlueBubbles and Messages, or the OpenAI API. */
export const RELAY_LINK_STATES = ["up", "down", "unknown"] as const;
export type RelayLinkState = (typeof RELAY_LINK_STATES)[number];

/** The largest count the site takes. Far above any real day, far below a phone number. */
export const RELAY_MAX_COUNT = 9_999;
/** The longest median reply time a day can show, in minutes (30 days). */
export const RELAY_MAX_MEDIAN_MINUTES = 43_200;
/** Timestamps are Date.now() style milliseconds between these two dates. */
export const RELAY_EARLIEST = Date.UTC(2026, 0, 1);
export const RELAY_LATEST = Date.UTC(2100, 0, 1);
/** The most raw JSON `parseRelayStatus` reads; a real status is well under 1 KB. */
export const RELAY_MAX_BYTES = 4_096;

const count = z.number().int().min(0).max(RELAY_MAX_COUNT);
const timestamp = z.number().int().min(RELAY_EARLIEST).max(RELAY_LATEST);

/** One day of the reply strip. */
export const RelayDaySchema = z.strictObject({
  /** Midnight of the day. */
  day: timestamp,
  /** Replies sent that day. */
  sent: count,
  /** Median minutes to reply that day, rounded; null when no replies were tracked. */
  medianMinutes: z.number().int().min(0).max(RELAY_MAX_MEDIAN_MINUTES).nullable(),
});
export type RelayDay = z.infer<typeof RelayDaySchema>;

/** Everything Relay may send to the site, and the only thing. */
export const RelayStatusSchema = z.strictObject({
  v: z.literal(RELAY_STATUS_VERSION),
  /** When the hub made this status. */
  at: timestamp,
  hub: z.enum(RELAY_HUB_STATES),
  /** BlueBubbles and Messages. */
  messages: z.enum(RELAY_LINK_STATES),
  /** The OpenAI API (Dialtone and Blasto). */
  models: z.enum(RELAY_LINK_STATES),
  /** Threads waiting on a reply from Nikita. */
  owed: count,
  /** Of those, the ones Dialtone sorted "reply sooner". */
  sooner: count,
  /** Of those, the ones waiting past the overdue window. */
  overdue: count,
  /** Of those, the ones pushed to the next nudge. */
  later: count,
  /** Threads that need nothing (groups, codes, promos). */
  settled: count,
  /** Owed threads with Blasto's draft ready. */
  draftsReady: count,
  sentToday: count,
  /** Days in a row with nobody left waiting past their window. */
  streakDays: count,
  /** The last seven days at most, oldest first. */
  week: z.array(RelayDaySchema).max(7),
  /** The next of Dialtone's daily nudges, or null when none is set. */
  nextNudgeAt: timestamp.nullable(),
});
export type RelayStatus = z.infer<typeof RelayStatusSchema>;

/** The top-level keys a status may carry, in order. The spec lists the same ones. */
export const RELAY_STATUS_KEYS = Object.keys(RelayStatusSchema.shape) as (keyof RelayStatus)[];

/** The count fields, for checks that treat them alike. */
export const RELAY_COUNT_KEYS = ["owed", "sooner", "overdue", "later", "settled", "draftsReady", "sentToday", "streakDays"] as const satisfies readonly (keyof RelayStatus)[];

export type RelayStatusRead = { ok: true; status: RelayStatus } | { ok: false; problems: string[] };

/** A problem as "where: what", with the path made only of known keys and indexes, and never the value. */
function problemOf(issue: z.core.$ZodIssue): string {
  const where = issue.path.length ? issue.path.map(String).join(".") : "status";
  if (issue.code === "unrecognized_keys") return `${where}: ${issue.keys.length === 1 ? "an unknown key" : `${issue.keys.length} unknown keys`}`;
  return `${where}: ${issue.code}`;
}

/**
 * Checks a status against the allowlist. On success it returns a fresh copy built from the schema, so nothing rides
 * along on the object the hub or a request handed in.
 */
export function readRelayStatus(input: unknown): RelayStatusRead {
  const res = RelayStatusSchema.safeParse(input);
  if (!res.success) return { ok: false, problems: [...new Set(res.error.issues.map(problemOf))] };
  const s = res.data;
  // Of the owed threads, each subset can't be larger than the whole.
  if (s.sooner > s.owed || s.overdue > s.owed || s.later > s.owed || s.draftsReady > s.owed) return { ok: false, problems: ["status: a part is larger than owed"] };
  if (s.hub === "wiped" && RELAY_COUNT_KEYS.some((k) => s[k] !== 0)) return { ok: false, problems: ["status: a wiped hub reports counts"] };
  return { ok: true, status: { ...s, week: s.week.map((d) => ({ ...d })) } };
}

/** Reads a status from raw JSON (a request body, say): capped in size, then checked like any other. */
export function parseRelayStatus(raw: string): RelayStatusRead {
  if (raw.length > RELAY_MAX_BYTES) return { ok: false, problems: ["status: too large"] };
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return { ok: false, problems: ["status: not JSON"] };
  }
  return readRelayStatus(input);
}

/** The status the site shows before the hub has ever reported, and after a wipe. */
export function emptyRelayStatus(at: number, hub: "off" | "wiped" = "off"): RelayStatus {
  return { v: RELAY_STATUS_VERSION, at, hub, messages: "unknown", models: "unknown", owed: 0, sooner: 0, overdue: 0, later: 0, settled: 0, draftsReady: 0, sentToday: 0, streakDays: 0, week: [], nextNudgeAt: null };
}
