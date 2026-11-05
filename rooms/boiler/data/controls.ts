import type { LinkState } from "../../../apps/world/src/systems.ts";
import { isHalloweenNight } from "../../../apps/world/src/veil/veil.ts";
import type { Link, Vendor, VendorProblem, VendorState } from "../../../apps/world/src/desk/homeDevices.ts";
import { isQuiet, nextMountain } from "../../../apps/world/src/desk/todaySchedule.ts";

/**
 * Boiler Room > Controls (#647): the panel board's arithmetic, kept apart from the page so it can be tested. Meters
 * read a month's spend against a cap (amber at 80%, red at 100%), with the days left and where the month ends at this
 * pace; breakers say what each switch is doing and when it last changed; connections say what each link can do from
 * here. Nothing here invents a number: a meter with no data is "waiting", and the page says so.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Skippy as a full agent (#646): its own month's cap and the warning before it. Until #646 ships it has no ledger the Desk can read. */
export const SKIPPY_AGENT_CAP_USD = 60;
export const SKIPPY_AGENT_WARN_USD = 50;
/** Amber from this share of a cap, red from 1. */
export const WARN_SHARE = 0.8;

export type MeterTone = "ok" | "warn" | "over" | "wait";

/** The calendar month of `now` in UTC (how the providers bill): days left (today counts), its length and how far through it is. */
export function monthClock(now: number): { daysLeft: number; days: number; elapsed: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { daysLeft: Math.max(1, Math.ceil((end - now) / DAY)), days: Math.round((end - start) / DAY), elapsed: Math.min(1, Math.max(0, (now - start) / (end - start))) };
}

/** Where the month ends at this pace. The first day counts as a whole day, so one early call doesn't project a fortune. */
export function projectMonth(used: number, now: number): number {
  const { days, elapsed } = monthClock(now);
  return used / Math.max(elapsed, 1 / days);
}

/** A meter's tone: amber at `warnAt` (80% of the cap unless said), red at the cap. */
export function meterTone(used: number | null, cap: number | null, warnAt?: number): MeterTone {
  if (used === null || cap === null || !(cap > 0)) return "wait";
  if (used >= cap) return "over";
  return used >= (warnAt ?? cap * WARN_SHARE) ? "warn" : "ok";
}

/** What the signed-out view says instead of a figure: the state only. */
export const TONE_WORD: Record<MeterTone, string> = { ok: "Normal", warn: "Near its cap", over: "At its cap", wait: "Waiting" };

/** One share of a meter's spend. */
export interface Share {
  id: string;
  label: string;
  usd: number;
}

/** A share's width on a meter, 0..1 of the cap (the bar never runs past the cap; the readout says by how much). */
export function shareWidths(shares: Share[], cap: number): { id: string; from: number; width: number }[] {
  let at = 0;
  return shares.map((s) => {
    const from = Math.min(1, at / cap);
    at += Math.max(0, s.usd);
    return { id: s.id, from, width: Math.max(0, Math.min(1, at / cap) - from) };
  });
}

/* ── Breakers ── */

/** Quiet hours for pings (10 PM to 7 AM Mountain): on or off now, when that last changed and when it changes next. */
export function quietState(now: number): { on: boolean; changed: number; next: number } {
  const on = isQuiet(now);
  const next = nextMountain(now, on ? 7 : 22);
  return { on, next, changed: next - (on ? 9 : 15) * HOUR };
}

/**
 * The costume party (the Hallowed Veil, veil/veil.ts): on by itself from dusk on October 31 (Mountain) to midnight,
 * or when the Kernel console in the Lattice calls one for a visit. When it was last on or off, by the calendar.
 */
export function costumeState(now: number): { on: boolean; changed: number } {
  const on = isHalloweenNight(new Date(now));
  const y = new Date(now).getUTCFullYear();
  // October 31 is always on daylight time in Denver (UTC−6): dusk is 00:00 UTC on November 1, midnight 06:00 UTC.
  const opens = (yr: number) => Date.UTC(yr, 10, 1, 0);
  const closes = (yr: number) => Date.UTC(yr, 10, 1, 6);
  if (on) return { on, changed: opens(y) };
  return { on, changed: closes(now >= closes(y) ? y : y - 1) };
}

/* ── Connections ── */

/** What a link can do from here: a key to set in the Keys form, Gmail's own connect, or nothing (a read-only feed). */
export type LinkAction = { kind: "key"; key: string } | { kind: "gmail" } | { kind: "none" };

/** The links whose credential is a key on the Keys form (api/_keys/allowlist.ts), and Gmail's OAuth. */
export const LINK_ACTIONS: Record<string, LinkAction> = {
  gmail: { kind: "gmail" },
  openai: { kind: "key", key: "claude-api-key" },
  fantasypros: { kind: "key", key: "fantasypros" },
  paypal: { kind: "key", key: "paypal-client-id" },
  world: { kind: "key", key: "claude-api-key" },
  shaping: { kind: "key", key: "claude-api-key" },
};

export const actionOf = (id: string): LinkAction => LINK_ACTIONS[id] ?? { kind: "none" };

/** The button's word for a link in a given state: connect when it's off, reconnect when it's down. */
export function actionWord(action: LinkAction, state: LinkState): string | null {
  if (action.kind === "none") return null;
  if (action.kind === "gmail") return state === "ok" || state === "slow" ? "Disconnect" : state === "down" ? "Reconnect" : "Connect";
  return state === "off" ? "Connect · set key" : state === "down" ? "Reconnect · replace key" : "Replace key";
}

/** The room whose pipe a link runs in, for "Its pipe" (the Boiler Room's `?room=`). */
export const pipeOf = (room: string) => (room === "world" ? "boiler" : room);

/** One house connection's row on the Connections circuit (#672): the same shape as the Systems links' rows. */
export interface HouseRow {
  id: string;
  label: string;
  what: string;
  room: "boiler";
  state: LinkState;
  lastSeen: null;
  word?: string;
}

/** The house's connections, in the order the Boiler Room's pipe lists them (systemsGraph.ts). */
export const HOUSE_LINKS: readonly { id: Vendor | Link; label: string; what: string }[] = [
  { id: "roborock", label: "Roborock", what: "The vacuum: status, start, dock and rooms" },
  { id: "petlibro", label: "Petlibro", what: "The dry and wet food feeders and the water fountain" },
  { id: "whisker", label: "Whisker", what: "The Litter-Robot: drawer, last visit and a clean cycle" },
  { id: "nest", label: "Google Nest", what: "The thermostat: temperature, mode and set point" },
  { id: "tasks", label: "Google Tasks", what: "Quick-adds into the Haven's to-dos" },
  { id: "kroger", label: "King Soopers", what: "Sends the kitchen list to your King Soopers cart" },
];

/** The short reason after "Down" on a row, when the server said why (signed in only). */
const PROBLEM_WORD: Record<VendorProblem, string> = {
  "no-account": "Down · no such account",
  refused: "Down · sign-in refused",
  "signed-out": "Down · signed out",
  unreachable: "Down · no answer",
  vendor: "Down",
};

/**
 * The house's rows, from the home devices' real states (homeDevices.ts): live is Live, down is Down (with its reason
 * when signed in), waiting is Waiting. Before the first answer, or where the route doesn't run, every row waits.
 */
export function houseRows(vendors: Partial<Record<Vendor, VendorState>> | null, links: Partial<Record<Link, VendorState>> | null, problems: Partial<Record<Vendor, VendorProblem>> = {}): HouseRow[] {
  return HOUSE_LINKS.map(({ id, label, what }) => {
    const s = (vendors as Record<string, VendorState | undefined> | null)?.[id] ?? (links as Record<string, VendorState | undefined> | null)?.[id];
    const state: LinkState = s === "live" ? "ok" : s === "down" ? "down" : "off";
    const why = (problems as Record<string, VendorProblem | undefined>)[id];
    return { id, label, what, room: "boiler", state, lastSeen: null, ...(state === "down" && why && { word: PROBLEM_WORD[why] }) };
  });
}
