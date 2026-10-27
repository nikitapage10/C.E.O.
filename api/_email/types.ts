/**
 * The email agent's private state (#263, docs/GMAIL.md). Everything here stays on the private path: the sealed blobs
 * in the Azure copy's `ceo-state` container and the signed-in Desk. Only `EmailStatus` (./status.ts) ever leaves it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { GmailState } from "./status.js";

/** How Dialtone sorted a mail. "unsorted": it came in while the month's cap was reached, so no model read it. */
export const EMAIL_KINDS = ["needs-you", "fyi", "noise", "unsorted"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** One new inbox mail, as the Desk shows it. Private: subject and sender are Nikita's mail. */
export interface EmailItem {
  /** Gmail's message id (hex), for "Open in Gmail" and to mark it done. */
  id: string;
  /** When Gmail received it (ms). */
  at: number;
  /** The sender's display name, or the address when there is none. */
  from: string;
  subject: string;
  kind: EmailKind;
  /** Dialtone's one line on what it is. */
  summary: string;
  /** Dialtone's suggested next step, a few words. */
  action: string;
  /** Blasto's short advice, for needs-you mail only. */
  advice?: string;
  /** Blasto's draft reply, for needs-you mail only, when one makes sense. Never sent by C.E.O. */
  draft?: string;
  /** Nikita marked it handled on the Desk. */
  done: boolean;
}

export interface EmailMonth {
  usd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface EmailState {
  v: 1;
  /** Gmail's history id the next check starts from; null before the first check. */
  historyId: string | null;
  /** The last message ids already handled, newest last, so a message is never sorted twice. */
  seen: string[];
  /** The mail the Desk shows, newest first, kept a week at most. */
  items: EmailItem[];
  /** Claude spend by month ("2026-10"). */
  spend: Record<string, EmailMonth>;
  /** Today's counts (Mountain day "2026-10-22"). `skipped`: money, legal and skip-list mail, counted only (#323). `urgent`: urgent money or legal alerts among them, a count and nothing else (#415). */
  day: { day: string; newCount: number; noise: number; skipped: number; urgent: number };
  /** Mail counted while paused, this month. */
  unsorted: number;
  /** Plain job-application confirmations counted this month ("2026-10"); a count only, never an item. Signed-in view only. */
  applied: { month: string; count: number };
  gmail: GmailState;
  lastCheck: number | null;
  /** What went wrong on the last check, by kind only. */
  lastError: "gmail" | "claude" | "token" | "store" | null;
  /** Needs-you mail not pinged yet (held through the quiet hours). */
  pingPending: number;
  /** A tick holds the state until this time (ms), so two overlapping ticks never both sort the same mail. */
  busyUntil: number;
  /**
   * Whether this connection's catch-up was listed (#323). False on a fresh state, a state saved before the catch-up
   * existed, and after a connect or reconnect: the next check then lists the unread inbox mail of the last 48 hours.
   */
  catchUpListed: boolean;
  /** The catch-up's message ids still to sort, at most CATCH_UP_MAX; ids only, sealed with the rest. */
  catchUp: string[];
}

/** The refresh token's record, sealed at rest. */
export interface TokenRecord {
  refresh: string;
  /** When Gmail was connected (ms). */
  connectedAt: number;
}

/** At most this many items, and this many seen ids. */
export const MAX_ITEMS = 60;
export const MAX_SEEN = 500;
/** Items older than this are dropped. */
export const ITEM_KEEP_MS = 7 * 24 * 60 * 60_000;
/** At most this many new mails are read in one tick; the rest wait for the next one. */
export const MAX_PER_TICK = 12;
/** At most this many mails in one connection's catch-up (gmail.ts lists no more). */
export const CATCH_UP_MAX = 24;

export function emptyEmailState(): EmailState {
  return { v: 1, historyId: null, seen: [], items: [], spend: {}, day: { day: "", newCount: 0, noise: 0, skipped: 0, urgent: 0 }, unsorted: 0, applied: { month: "", count: 0 }, gmail: "not-connected", lastCheck: null, lastError: null, pingPending: 0, busyUntil: 0, catchUpListed: false, catchUp: [] };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A stored state read back defensively: anything odd becomes its empty value. */
export function readEmailState(v: unknown): EmailState {
  const e = emptyEmailState();
  if (!v || typeof v !== "object") return e;
  const o = v as Record<string, unknown>;
  const items = Array.isArray(o.items) ? (o.items as unknown[]).map(readItem).filter((x): x is EmailItem => x !== null) : [];
  const day = (o.day && typeof o.day === "object" ? o.day : {}) as Record<string, unknown>;
  return {
    v: 1,
    historyId: typeof o.historyId === "string" && /^\d{1,30}$/.test(o.historyId) ? o.historyId : null,
    seen: Array.isArray(o.seen) ? (o.seen as unknown[]).filter((s): s is string => typeof s === "string").slice(-MAX_SEEN) : [],
    items: items.slice(0, MAX_ITEMS),
    spend: o.spend && typeof o.spend === "object" && !Array.isArray(o.spend) ? (o.spend as Record<string, EmailMonth>) : {},
    day: { day: str(day.day, 10), newCount: num(day.newCount), noise: num(day.noise), skipped: num(day.skipped), urgent: num(day.urgent) },
    unsorted: num(o.unsorted),
    applied: (() => {
      const a = (o.applied && typeof o.applied === "object" ? o.applied : {}) as Record<string, unknown>;
      return { month: /^\d{4}-\d{2}$/.test(String(a.month)) ? String(a.month) : "", count: Math.max(0, Math.floor(num(a.count))) };
    })(),
    gmail: o.gmail === "connected" || o.gmail === "refused" ? o.gmail : "not-connected",
    lastCheck: typeof o.lastCheck === "number" ? o.lastCheck : null,
    lastError: o.lastError === "gmail" || o.lastError === "claude" || o.lastError === "token" || o.lastError === "store" ? o.lastError : null,
    pingPending: num(o.pingPending),
    busyUntil: num(o.busyUntil),
    catchUpListed: o.catchUpListed === true,
    catchUp: Array.isArray(o.catchUp) ? (o.catchUp as unknown[]).filter((s): s is string => typeof s === "string" && /^[0-9a-f]{6,32}$/.test(s)).slice(0, CATCH_UP_MAX) : [],
  };
}

function readItem(v: unknown): EmailItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^[0-9a-f]{6,32}$/.test(o.id) || typeof o.at !== "number") return null;
  const kind = (EMAIL_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as EmailKind) : "unsorted";
  return {
    id: o.id,
    at: o.at,
    from: str(o.from, 120),
    subject: str(o.subject, 200),
    kind,
    summary: str(o.summary, 240),
    action: str(o.action, 140),
    ...(typeof o.advice === "string" && o.advice && { advice: o.advice.slice(0, 800) }),
    ...(typeof o.draft === "string" && o.draft && { draft: o.draft.slice(0, 2000) }),
    done: o.done === true,
  };
}

/** What GET /api/email answers a signed-in Desk: the status plus the private list. */
export interface EmailView {
  ok: true;
  status: import("./status.js").EmailStatus;
  /** Whether Connect Gmail can work here (the client id and secret and the token key are set). */
  canConnect: boolean;
  items: EmailItem[];
  /** Urgent money or legal alerts skipped today: a count only, nothing of the mail is kept (#415). */
  urgentSkipped: number;
  /** Plain job-application confirmations this month: a count, shown to a signed-in Desk only (#522). */
  applied: number;
  /** This month's Claude spend and the cap, in dollars. */
  spend: { usd: number; budget: number };
}
