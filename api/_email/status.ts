/**
 * What the email agent may ever tell the public site (#263, docs/GMAIL.md, "What leaves the private path"). The
 * Lattice, /api/world and the Desk's public pages see this and nothing else: counts, enum states and timestamps. No
 * subject, sender, address, snippet, summary, advice or draft, and no free string of any kind.
 *
 * `readEmailStatus` is an allowlist, written out by hand (no zod, so a Vercel function can import it without the
 * workspace): an unknown key anywhere refuses the whole status, the only strings it takes are the enum values below,
 * counts are small whole numbers and timestamps fall in a plausible window. It returns a fresh object built from the
 * known keys, so nothing rides along. Like Relay's `RelayStatus` (packages/core/src/relay.ts), a refused status is
 * dropped whole, never repaired.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const EMAIL_STATUS_VERSION = 1;

/** Whether Gmail is connected: no token yet, a working token, or Google refused it (reconnect on the Desk). */
export const GMAIL_STATES = ["not-connected", "connected", "refused"] as const;
export type GmailState = (typeof GMAIL_STATES)[number];

/**
 * The agent: "waiting" until its keys are set, "listening" while it checks every minute, "paused" when the month's
 * cap is reached (it keeps counting new mail without Claude), "error" when the last check failed.
 */
export const EMAIL_AGENT_STATES = ["waiting", "listening", "paused", "error"] as const;
export type EmailAgentState = (typeof EMAIL_AGENT_STATES)[number];

export const EMAIL_MAX_COUNT = 9_999;
export const EMAIL_EARLIEST = Date.UTC(2026, 0, 1);
export const EMAIL_LATEST = Date.UTC(2100, 0, 1);

export interface EmailStatus {
  v: typeof EMAIL_STATUS_VERSION;
  /** When the status was made (ms). */
  at: number;
  gmail: GmailState;
  agent: EmailAgentState;
  /** Open mail sorted "needs you" that Nikita hasn't marked done. */
  needsYou: number;
  /** Open mail sorted FYI. */
  fyi: number;
  /** Promotions and noise, today. */
  noise: number;
  /** New inbox mail today (Mountain), sorted or not. */
  newToday: number;
  /** New mail counted while paused, not sorted. */
  unsorted: number;
  /** The month's spend as a whole percentage of the cap, 0 to 100. */
  budgetPct: number;
  /** When Gmail was last checked (ms), or null before the first check. */
  lastCheck: number | null;
}

export const EMAIL_STATUS_KEYS = ["v", "at", "gmail", "agent", "needsYou", "fyi", "noise", "newToday", "unsorted", "budgetPct", "lastCheck"] as const satisfies readonly (keyof EmailStatus)[];
export const EMAIL_COUNT_KEYS = ["needsYou", "fyi", "noise", "newToday", "unsorted"] as const satisfies readonly (keyof EmailStatus)[];

const isCount = (n: unknown, max = EMAIL_MAX_COUNT): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
const isTime = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= EMAIL_EARLIEST && n <= EMAIL_LATEST;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** The status, rebuilt from the allowlist; null for anything else. */
export function readEmailStatus(input: unknown): EmailStatus | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(EMAIL_STATUS_KEYS as readonly string[]).includes(k))) return null;
  if (o.v !== EMAIL_STATUS_VERSION || !isTime(o.at) || !oneOf(GMAIL_STATES, o.gmail) || !oneOf(EMAIL_AGENT_STATES, o.agent)) return null;
  if (!EMAIL_COUNT_KEYS.every((k) => isCount(o[k])) || !isCount(o.budgetPct, 100)) return null;
  if (o.lastCheck !== null && !isTime(o.lastCheck)) return null;
  return {
    v: EMAIL_STATUS_VERSION,
    at: o.at,
    gmail: o.gmail,
    agent: o.agent,
    needsYou: o.needsYou as number,
    fyi: o.fyi as number,
    noise: o.noise as number,
    newToday: o.newToday as number,
    unsorted: o.unsorted as number,
    budgetPct: o.budgetPct as number,
    lastCheck: o.lastCheck,
  };
}

/** Before the agent has ever run. */
export function emptyEmailStatus(at: number, agent: EmailAgentState = "waiting"): EmailStatus {
  return { v: EMAIL_STATUS_VERSION, at, gmail: "not-connected", agent, needsYou: 0, fyi: 0, noise: 0, newToday: 0, unsorted: 0, budgetPct: 0, lastCheck: null };
}
