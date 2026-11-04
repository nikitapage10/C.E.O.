/**
 * The two things the site gate checks for Hey Skippy (#627) with nothing but the environment: a phone key's shape and
 * an answer's signed audio link. Kept apart from the stores so the gate (and Vercel's middleware) pulls in nothing else.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Every phone key starts with this, so a leaked one is easy to recognise (and to search for in a scanner). */
export const KEY_PREFIX = "skp_";
/** A phone key's shape: the prefix and 32 random bytes as base64url (43 characters). */
export const KEY_SHAPE = /^skp_[A-Za-z0-9_-]{43}$/;
/**
 * The header the shortcut sends the key in. The Static Web App in front of the site replaces `Authorization` on its
 * way to the Function App, so a Bearer token only arrives on the Function App's own address; this one arrives either way.
 */
export const PHONE_KEY_HEADER = "x-ceo-phone-key";

/** The phone key a request carries: `x-ceo-phone-key: <key>` first, else `Authorization: Bearer <key>`. Null for none. */
export function phoneKeyOf(request: Request): string | null {
  const own = request.headers.get(PHONE_KEY_HEADER)?.trim();
  if (own) return own;
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

const B64 = /^[A-Za-z0-9_-]+$/;
/** A stored answer's id: 12 random bytes as base64url. */
export const AUDIO_ID = /^[A-Za-z0-9_-]{16}$/;

/** The key audio links are signed with: derived from the Desk key, never the Desk key itself. */
export function audioKey(deskKey: string): Buffer | null {
  const k = deskKey.trim();
  return k.length >= 16 ? createHmac("sha256", k).update("ceo-phone-audio-v1").digest() : null;
}

const macOf = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest("base64url");

/** A link token for one stored answer. */
export function signAudio(deskKey: string, id: string, until: number): string | null {
  const key = audioKey(deskKey);
  if (!key || !AUDIO_ID.test(id)) return null;
  const body = `pa1.${Math.floor(until).toString(36)}.${id}`;
  return `${body}.${macOf(key, body)}`;
}

/** The stored answer's id when the token is signed by this Desk key and unexpired; null otherwise. */
export function audioIdOf(token: string | null | undefined, deskKey: string, now: number): string | null {
  if (!token || token.length > 160) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "pa1" || !parts.slice(1).every((p) => B64.test(p)) || !AUDIO_ID.test(parts[2]!)) return null;
  const key = audioKey(deskKey);
  if (!key) return null;
  const want = Buffer.from(macOf(key, parts.slice(0, 3).join(".")));
  const got = Buffer.from(parts[3]!);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const until = parseInt(parts[1]!, 36);
  return Number.isFinite(until) && until > now ? parts[2]! : null;
}

