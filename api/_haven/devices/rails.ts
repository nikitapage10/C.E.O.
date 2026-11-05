/**
 * The safety rails on the home devices' physical actions (#632, docs/HOME-DEVICES.md, "Safety rails"). Each is checked
 * on the server, before the vendor is called, whoever asks (the Desk or the phone):
 *
 *   Feeding     at most HOME_FEED_CAP manual feeds a Mountain day per feeder (default 2), counted separately for the
 *               dry feeder (one portion each) and the wet feeder (one lid opening each). The count is reserved before
 *               the vendor call and given back when the call fails, in the private store (`haven/devices/feeds.json`,
 *               opaque device ids and numbers only).
 *   Litter      a clean cycle only when the robot itself reports it is ready: online, idle, no cat inside or in the
 *               sensor's wait, the drawer not full and the bonnet on.
 *   Vacuum      start, pause, dock and named rooms only (the rooms must match the map's names: rooms.ts).
 *   Thermostat  (#637) set points only from THERMO_MIN_F to THERMO_MAX_F (60 to 80 °F), whole degrees; in heatcool
 *               the cool point at least THERMO_GAP_F above the heat point; no set point while it is off or in eco;
 *               a mode only from the ones the thermostat itself offers.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { readJson, updateJson } from "../json.js";
import { isThermoMode, type ActionId, type DeviceReading, type RunArgs, type ThermoMode, type WetMeal } from "./types.js";
import { litterReady } from "./whisker.js";

export const FEEDS_PATH = "haven/devices/feeds.json";
/** The default manual feeds a day per feeder, and the most the setting may raise it to. */
export const FEED_CAP_DEFAULT = 2;
export const FEED_CAP_MAX = 6;

/** HOME_FEED_CAP as a number from 0 to FEED_CAP_MAX; the default when it is missing or not a whole number. */
export function feedCap(raw: string | undefined): number {
  const n = Number((raw ?? "").trim());
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 0 ? Math.min(n, FEED_CAP_MAX) : FEED_CAP_DEFAULT;
}

/** The calendar day in Denver, as YYYY-MM-DD. */
export function mountainDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

interface Feeds {
  day: string;
  counts: Record<string, number>;
}

const clean = (raw: unknown, day: string): Feeds => {
  const f = (raw && typeof raw === "object" ? raw : {}) as Partial<Feeds>;
  if (f.day !== day || !f.counts || typeof f.counts !== "object") return { day, counts: {} };
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(f.counts)) if (/^[0-9a-f]{12}$/.test(k) && Number.isInteger(v) && v > 0) counts[k] = v;
  return { day, counts };
};

/** The day's manual feeds, per feeder. */
export class FeedLedger {
  constructor(private readonly blob: BlobBackend) {}

  async today(now: number): Promise<Record<string, number>> {
    return clean(await readJson(this.blob, FEEDS_PATH, null), mountainDay(now)).counts;
  }

  /**
   * Takes `n` of today's feeds for this feeder (each dry portion counts as one), or refuses the lot when they would go
   * past the cap. `count` is the day's count after the take, or as it stands when refused.
   */
  async reserve(id: string, cap: number, now: number, n = 1): Promise<{ ok: boolean; count: number }> {
    const day = mountainDay(now);
    const take = Math.max(1, Math.floor(n));
    return updateJson<unknown, { ok: boolean; count: number }>(this.blob, FEEDS_PATH, null, (raw) => {
      const f = clean(raw, day);
      const count = f.counts[id] ?? 0;
      if (count + take > cap) return { next: null, result: { ok: false, count } };
      return { next: { day, counts: { ...f.counts, [id]: count + take } }, result: { ok: true, count: count + take } };
    });
  }

  /** Gives `n` feeds back when the vendor call failed. */
  async release(id: string, now: number, n = 1): Promise<void> {
    const day = mountainDay(now);
    const back = Math.max(1, Math.floor(n));
    await updateJson(this.blob, FEEDS_PATH, null as unknown, (raw) => {
      const f = clean(raw, day);
      const count = f.counts[id] ?? 0;
      if (!count) return { next: null, result: undefined };
      const counts = { ...f.counts, [id]: Math.max(0, count - back) };
      if (!counts[id]) delete counts[id];
      return { next: { day, counts }, result: undefined };
    });
  }
}

/** The most dry portions one ask may take (the cap still decides how many are left today). */
export const PORTIONS_MAX = 6;

/** How many dry portions were asked for: 1 when not said, a whole number from 1 to PORTIONS_MAX, else null. */
export function portionsOf(v: unknown): number | null {
  if (v === undefined || v === null) return 1;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= PORTIONS_MAX ? n : null;
}

/** The Polar wet feeder's tray holds three bowls and only turns one way (counter-clockwise, a bowl at a time). */
export const PLATES = 3;

/**
 * How many single turns bring bowl `want` (1 to 3) to the front from bowl `now`; with no bowl asked, one (the next).
 * null when the bowl asked isn't 1 to 3, or the current bowl isn't known for a numbered ask.
 */
export function rotateSteps(now: number | undefined, want: unknown): number | null {
  if (want === undefined || want === null) return 1;
  const n = typeof want === "number" ? want : typeof want === "string" && /^\d$/.test(want.trim()) ? Number(want) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > PLATES) return null;
  if (!now || now < 1 || now > PLATES) return null;
  return (((n - now) % PLATES) + PLATES) % PLATES;
}

/* ── The wet tray (#637 scope; Nikita, 2026-11-04: "you're going to have to remember the scheduling and the tray") ── */

/** The tray's private notes: which bowl is in front and which were served from here today. Never in the repo. */
export const TRAY_PATH = "haven/wet-tray.json";

export interface TrayState {
  day: string;
  /** The bowl in front after the last thing done from here. */
  front: number | null;
  /** Bowls opened from here today (a manual opening empties that bowl for the day). */
  served: number[];
}

const plateOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= PLATES;

export function cleanTray(raw: unknown, day: string): TrayState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (o.day !== day) return { day, front: plateOk(o.front) ? o.front : null, served: [] };
  return { day, front: plateOk(o.front) ? o.front : null, served: Array.isArray(o.served) ? [...new Set(o.served.filter(plateOk))].sort() : [] };
}

export class TrayLog {
  constructor(private readonly blob: BlobBackend) {}

  async read(now: number): Promise<TrayState> {
    return cleanTray(await readJson(this.blob, TRAY_PATH, null), mountainDay(now));
  }

  /** Notes the bowl now in front and, for an opening, that it was served. */
  async note(now: number, front: number | null, served?: number): Promise<TrayState> {
    const day = mountainDay(now);
    return updateJson<unknown, TrayState>(this.blob, TRAY_PATH, null, (raw) => {
      const t = cleanTray(raw, day);
      const next: TrayState = { day, front: plateOk(front) ? front : t.front, served: plateOk(served) && !t.served.includes(served) ? [...t.served, served].sort() : t.served };
      return { next, result: next };
    });
  }
}

/** Minutes past midnight in Denver. */
function denverMinutes(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n("hour") * 60 + n("minute");
}

const minutesOf = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The next scheduled meal after now (today's later ones first, then tomorrow's first), or null without a plan. */
export function nextMeal(meals: WetMeal[] | undefined, now: number): (WetMeal & { tomorrow: boolean }) | null {
  const list = (meals ?? []).filter((m) => minutesOf(m.time) !== null).sort((a, b) => minutesOf(a.time)! - minutesOf(b.time)!);
  if (!list.length) return null;
  const at = denverMinutes(now);
  const later = list.find((m) => minutesOf(m.time)! > at);
  return later ? { ...later, tomorrow: false } : { ...list[0]!, tomorrow: true };
}

/** "6pm", "7:30am". */
export function clockWords(hhmm: string): string {
  const mins = minutesOf(hhmm) ?? 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/**
 * A warning when what was just done may throw off the next scheduled meal, or "" when it lines up. The plan opens
 * whichever bowl is in front at meal time, so the bowl in front should be the one the plan gives that meal, and
 * not one already served from here today.
 */
export function trayWarning(front: number | null, tray: TrayState, meals: WetMeal[] | undefined, now: number): string {
  const next = nextMeal(meals, now);
  if (!next || !front) return "";
  const when = `${next.tomorrow ? "tomorrow's first meal" : "the next scheduled meal"} at ${clockWords(next.time)}`;
  // Served bowls are today's; tomorrow's meal comes after a refill.
  const empty = !next.tomorrow && tray.served.includes(front);
  if (next.plate && next.plate !== front) return ` Heads up: bowl ${front} is in front, but ${when} is set for bowl ${next.plate}.`;
  if (empty) return ` Heads up: ${when} will open bowl ${front}, which was already served today.`;
  return "";
}

/**
 * What to say when the plan doesn't come back: the Haven signs in with a second account the feeder is shared to, so
 * an empty plan may only mean that account can't see it. The device list's own next meal, or its plan switch, still
 * says something when Petlibro sends them.
 */
export function noPlanWords(r: Pick<DeviceReading, "nextFeed" | "planOn">): string {
  if (r.planOn === false) return "The feeding schedule is switched off in the Petlibro app.";
  if (r.nextFeed) return `No schedule visible to the Haven's account; the feeder says the next meal is at ${clockWords(r.nextFeed.time)}.`;
  return "No schedule visible to the Haven's account.";
}

/** "What's in the wet feeder": the tray and the plan in plain words, naming each bowl's meal when the app does. */
export function traySummary(r: Pick<DeviceReading, "plate" | "meals" | "state" | "online" | "nextFeed" | "planOn">, tray: TrayState, now: number): string {
  if (!r.online) return "The wet food feeder is offline.";
  const front = r.plate ?? tray.front;
  const lines = [front ? `Bowl ${front} is in front${r.state === "lid open" ? " and the lid is open" : ", lid closed"}.` : `I can't tell which bowl is in front${r.state === "lid open" ? "; the lid is open" : ""}.`];
  lines.push(tray.served.length ? `Served from here today: bowl ${tray.served.join(" and ")}.` : "Nothing served from here today.");
  const meals = (r.meals ?? []).filter((m) => minutesOf(m.time) !== null);
  if (meals.length) {
    lines.push(`Scheduled: ${meals.map((m) => `${clockWords(m.time)}${m.plate ? ` (bowl ${m.plate}${m.label ? `, ${m.label}` : ""})` : m.label ? ` (${m.label})` : ""}`).join(", ")}.`);
    lines.push(trayWarning(front ?? null, tray, meals, now).trim());
  } else lines.push(noPlanWords(r));
  return lines.filter(Boolean).join(" ");
}

/* ── The wet tray's auto-close (#713; Nikita, 2026-11-04: "it opens it up for 2 hours and then closes it") ── */

/** The auto-close's private note: which feeder, the opening to close, and when. One at a time. Never in the repo. */
export const WET_CLOSE_PATH = "haven/devices/wet-close.json";
/** How long an opening from here stays open. */
export const WET_OPEN_MS = 2 * 60 * 60_000;
/** The beat of the Function timer that closes it (azure/src/index.ts, haven_tasks: every five minutes). */
export const CLOSE_BEAT_MS = 5 * 60_000;
/** How long past its time a close that can't get through (offline, Petlibro down) is tried before it is dropped. */
export const CLOSE_GIVE_UP_MS = 60 * 60_000;

export interface WetClose {
  /** The feeder's opaque id. */
  id: string;
  /** The opening wet.open answered with, when it did (stopFeedNow closes it). */
  feedId?: number | string;
  /** When the window began: the opening, or the latest reset. */
  from: number;
  /** When it closes: two hours on, rounded up to the timer's next beat, so the time shown is the time it shuts. */
  closeAt: number;
}

/** When an opening at `now` closes: two hours later, on the timer's next five-minute beat. */
export function closeAtFor(now: number): number {
  return Math.ceil((now + WET_OPEN_MS) / CLOSE_BEAT_MS) * CLOSE_BEAT_MS;
}

const goodTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function cleanWetClose(raw: unknown): WetClose | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^[0-9a-f]{12}$/.test(o.id) || !goodTime(o.from) || !goodTime(o.closeAt)) return null;
  const feedId = (typeof o.feedId === "number" && Number.isFinite(o.feedId)) || (typeof o.feedId === "string" && /^[\w-]{1,40}$/.test(o.feedId)) ? o.feedId : undefined;
  return { id: o.id, ...(feedId !== undefined && { feedId }), from: o.from, closeAt: o.closeAt };
}

/** The pending auto-close, in the private store. */
export class WetCloseNote {
  constructor(private readonly blob: BlobBackend) {}

  async read(): Promise<WetClose | null> {
    return cleanWetClose(await readJson(this.blob, WET_CLOSE_PATH, null));
  }

  async set(next: WetClose): Promise<void> {
    await updateJson<unknown, void>(this.blob, WET_CLOSE_PATH, null, () => ({ next, result: undefined }));
  }

  /** Drops the pending close for this feeder; with `closeAt`, only if it is still that one (not reset meanwhile). */
  async clear(id: string, closeAt?: number): Promise<boolean> {
    return updateJson<unknown, boolean>(this.blob, WET_CLOSE_PATH, null, (raw) => {
      const cur = cleanWetClose(raw);
      if (!cur || cur.id !== id || (closeAt !== undefined && cur.closeAt !== closeAt)) return { next: null, result: false };
      return { next: {}, result: true };
    });
  }
}

/**
 * The first scheduled meal that starts after `from` and by `to`, or null. A meal that opens inside the window is the
 * schedule's to finish, so the auto-close stands down for it (the schedule wins).
 */
export function mealInWindow(meals: WetMeal[] | undefined, from: number, to: number): WetMeal | null {
  if (to <= from) return null;
  const at = denverMinutes(from);
  const span = (to - from) / 60_000;
  let best: { m: WetMeal; d: number } | null = null;
  for (const m of meals ?? []) {
    const start = minutesOf(m.time);
    if (start === null) continue;
    // Minutes from `from` to the meal's next start; a window of two hours never wraps a whole day.
    const d = (start - at + 24 * 60) % (24 * 60);
    if (d > 0 && d <= span && (!best || d < best.d)) best = { m, d };
  }
  return best?.m ?? null;
}

/** A moment as Nikita's clock reads it in Denver: "6:15pm". */
export function clockAt(ms: number): string {
  const mins = denverMinutes(ms);
  return clockWords(`${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`);
}

/** Why the litter gate said no, in a word, or null when it may run. */
export function litterBlock(r: DeviceReading): "offline" | "cat" | "cycling" | "drawer" | "not-ready" | null {
  if (litterReady(r)) return null;
  if (!r.online) return "offline";
  if (r.catInside) return "cat";
  if (r.state === "cycling" || r.state === "paused") return "cycling";
  if (r.state === "drawer full") return "drawer";
  return "not-ready";
}

/* ── The thermostat (#637) ── */

/** The lowest and highest set point taken, in °F (Nikita, 2026-11-04: "sane rails, 60 to 80"). */
export const THERMO_MIN_F = 60;
export const THERMO_MAX_F = 80;
/** In heatcool, the cool point must sit at least this far above the heat point (Nest's own minimum is about 3 °F). */
export const THERMO_GAP_F = 3;

/** What the Desk or the phone asked the thermostat for. */
export interface ThermoAsk {
  /** One set point, for heat or cool mode. */
  tempF?: unknown;
  heatF?: unknown;
  coolF?: unknown;
  mode?: unknown;
}

export type ThermoBlock = "range" | "eco" | "mode-off" | "no-setpoint" | "gap" | "bad-mode" | "offline";

/** A whole °F from what was asked, or null when it isn't a number. */
function wholeF(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

const inRange = (f: number) => f >= THERMO_MIN_F && f <= THERMO_MAX_F;

/**
 * The thermostat's rails: the arguments the client may send, or why not. Checked against the thermostat's own
 * reading (its mode, the modes it offers, eco), so a set point never reaches Nest outside 60 to 80 °F.
 */
export function thermostatPlan(r: DeviceReading, action: ActionId, ask: ThermoAsk): { ok: true; args: RunArgs } | { ok: false; code: ThermoBlock } {
  if (!r.online) return { ok: false, code: "offline" };
  if (action === "thermostat.mode") {
    const mode = typeof ask.mode === "string" ? ask.mode.toLowerCase() : ask.mode;
    if (!isThermoMode(mode)) return { ok: false, code: "bad-mode" };
    if (r.modes?.length && !r.modes.includes(mode)) return { ok: false, code: "bad-mode" };
    return { ok: true, args: { mode } };
  }
  if (action !== "thermostat.set") return { ok: false, code: "bad-mode" };
  const mode: ThermoMode | undefined = r.mode;
  if (!mode || mode === "off") return { ok: false, code: "mode-off" };
  if (r.eco) return { ok: false, code: "eco" };
  if (mode === "heatcool") {
    const heat = wholeF(ask.heatF);
    const cool = wholeF(ask.coolF);
    if (heat === null || cool === null) return { ok: false, code: "no-setpoint" };
    if (!inRange(heat) || !inRange(cool)) return { ok: false, code: "range" };
    if (cool - heat < THERMO_GAP_F) return { ok: false, code: "gap" };
    return { ok: true, args: { heatF: heat, coolF: cool } };
  }
  const one = wholeF(ask.tempF ?? (mode === "heat" ? ask.heatF : ask.coolF));
  if (one === null) return { ok: false, code: "no-setpoint" };
  if (!inRange(one)) return { ok: false, code: "range" };
  return { ok: true, args: mode === "heat" ? { heatF: one } : { coolF: one } };
}
