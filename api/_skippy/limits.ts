/**
 * How often Nikita can talk to Skippy (#224): every message is a paid Claude call, so even a signed-in session is
 * held to a pace, counted per passkey (a keyed hash of its id, never the id) in the same record as the Desk's
 * sign-in counters (api/_desk/limits.ts, in the private blob store). At most CHAT_RULES.minute.max messages a
 * minute and CHAT_RULES.hour.max an hour; past either, the answer is 429 with how long to wait, and nothing reaches
 * Claude. A window starts at its first message and ends a fixed time later.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac } from "node:crypto";
import { prune, type Bucket, type Limits } from "../_desk/limits.js";

export const CHAT_RULES = {
  minute: { max: 8, ms: 60_000 },
  hour: { max: 60, ms: 60 * 60_000 },
} as const;

type Window = keyof typeof CHAT_RULES;
const WINDOWS = Object.keys(CHAT_RULES) as Window[];

/** The tag a passkey's chat counters go by: an HMAC of its id under the Desk's client key. */
export const chatTag = (passkey: string, clientKey: Buffer) => createHmac("sha256", clientKey).update(`skippy:${passkey}`).digest("hex").slice(0, 20);

const keyOf = (w: Window, tag: string) => `skippy:${w}:${tag}`;

/** A window's bucket: `fails` counts messages, `last` is when the window opened, `until` when it closes. */
const live = (b: Bucket | undefined, now: number): Bucket | null => (b && typeof b.until === "number" && b.until > now ? b : null);

/** How long until one more message is allowed (ms; 0 when it is). */
export function chatWait(limits: Limits, tag: string, now: number): number {
  let wait = 0;
  for (const w of WINDOWS) {
    const b = live(limits[keyOf(w, tag)], now);
    if (b && b.fails >= CHAT_RULES[w].max) wait = Math.max(wait, b.until - now);
  }
  return wait;
}

/** The counters with one more message counted. */
export function countChat(limits: Limits, tag: string, now: number): Limits {
  const next: Limits = { ...limits };
  for (const w of WINDOWS) {
    const b = live(limits[keyOf(w, tag)], now);
    next[keyOf(w, tag)] = b ? { ...b, fails: b.fails + 1 } : { fails: 1, last: now, until: now + CHAT_RULES[w].ms };
  }
  return prune(next, now);
}
