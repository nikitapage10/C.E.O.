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
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { readJson, updateJson } from "../json.js";
import type { DeviceReading } from "./types.js";
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

  /** Takes one of today's feeds for this feeder, or refuses past the cap. */
  async reserve(id: string, cap: number, now: number): Promise<{ ok: boolean; count: number }> {
    const day = mountainDay(now);
    return updateJson<unknown, { ok: boolean; count: number }>(this.blob, FEEDS_PATH, null, (raw) => {
      const f = clean(raw, day);
      const count = f.counts[id] ?? 0;
      if (count >= cap) return { next: null, result: { ok: false, count } };
      return { next: { day, counts: { ...f.counts, [id]: count + 1 } }, result: { ok: true, count: count + 1 } };
    });
  }

  /** Gives a feed back when the vendor call failed. */
  async release(id: string, now: number): Promise<void> {
    const day = mountainDay(now);
    await updateJson(this.blob, FEEDS_PATH, null as unknown, (raw) => {
      const f = clean(raw, day);
      const count = f.counts[id] ?? 0;
      if (!count) return { next: null, result: undefined };
      const counts = { ...f.counts, [id]: count - 1 };
      if (!counts[id]) delete counts[id];
      return { next: { day, counts }, result: undefined };
    });
  }
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
