/**
 * The Senate Record (#1181): the motions the Senate argued and the chair's rulings, as GET /api/senate-record answers
 * them (api/senate-record.ts), checked before the Archive draws them. Plain data, no DOM (senateRecord.test.ts).
 */

export interface RecordLine {
  motion: string;
  /** The chair's ruling; absent for a motion argued before the record kept rulings. */
  close?: string;
  at?: string;
}

const str = (v: unknown, max = 240): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/** The answer's entries that have the record's shape; anything else is dropped. Null when the answer isn't the record. */
export function readRecord(v: unknown): RecordLine[] | null {
  const entries = v && typeof v === "object" ? (v as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(entries)) return null;
  const out: RecordLine[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const motion = str(o.motion);
    if (!motion) continue;
    const close = str(o.close);
    const at = str(o.at, 40);
    out.push({ motion, ...(close ? { close } : {}), ...(at && Number.isFinite(Date.parse(at)) ? { at } : {}) });
  }
  return out;
}

/** A motion as it reads in the record: a leading "that" gets its capital ("That the disc is a lamp"). */
export const motionLine = (m: string): string => (m ? m[0]!.toUpperCase() + m.slice(1) : m);

/** When an argument was argued, short: "14 Nov · 12:05" (this year) or "14 Nov 2025" (an older year). */
export function whenArgued(at: string, now: number, timeZone?: string): string {
  const d = new Date(at);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone });
  if (!sameYear) return day;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  return `${day} · ${time}`;
}
