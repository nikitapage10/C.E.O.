/**
 * The subminds' two room keys (#281; docs/SKIPPY.md, "Room keys"; docs/SECURITY.md, "The subminds' room keys").
 * Nikita approved both on 2026-10-22. Each active submind's project thread ("Skippy, the <job>") holds them as
 * environment secrets and sends one as `Authorization: Bearer <key>`:
 *
 *   SUBMIND_LOG_TOKEN    read-only. GET only, and only the room data below (LOG_READS): the Asked Skippy logs of the
 *                        four active rooms, the Green's league board, the Exchange's board and Nikita's positions, the
 *                        world feed (and one day of it), the Foundry feed, and the room feed itself.
 *   SUBMIND_FEED_TOKEN   write-only. POST /api/room-feed only, a short room event (api/_room/feed.ts). It reads
 *                        nothing: the answer says only that the event was kept.
 *
 * Neither key can change a setting (no other POST, and the Desk's own writes still need a passkey session), trade
 * (positions are read through the allow-listed GETs in api/_exchange/positions.ts), send anything (no email, invoice
 * or ping route takes them), or reach an upstream secret (no route returns one). Both live only in the Azure Key
 * Vault (`submind-log-token`, `submind-feed-token`; infra/resources.bicep). Each must be at least 32 characters and
 * different from the other and from the site's own secrets, or it counts as unset; both are compared in constant
 * time (secretMatches, hashed first so their lengths don't show).
 *
 * The site gate (api/_site/gate.ts) lets a request through on a key only for exactly these method, path and query
 * shapes; the handlers behind it check the key again, so the same holds while the site is unlocked.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const LOG_TOKEN = "SUBMIND_LOG_TOKEN";
export const FEED_TOKEN = "SUBMIND_FEED_TOKEN";
/** The shortest room key that counts: a shorter one is ignored, so a weak key opens nothing. */
export const MIN_ROOM_KEY = 32;

/** The settings a room key may never equal: a copy of one of these would make the room key a master key. */
const OTHER_SECRETS = ["FOUNDRY_DESK_KEY", "SITE_BYPASS_TOKEN", "SITE_SESSION_SECRET", "DESK_PINGS_SECRET", "GMAIL_TOKEN_KEY"] as const;

export type RoomKey = "log" | "feed";

/** The rooms whose Asked Skippy log the read key may see: the four with an active submind. Never Relay's or "none". */
export const KEY_LOG_ROOMS = ["green", "exchange", "boiler", "foundry"] as const;

/** The room feed's address (api/_room/feed.ts). */
export const ROOM_FEED_PATH = "/api/room-feed";

/** A query rule: which keys a read may carry, and what each must look like. Absent keys are fine unless required. */
type QueryRule = { [key: string]: { required?: boolean; ok: (v: string) => boolean } };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Everything the read key opens: the path, exactly, and the query it may carry (nothing more). GET only. */
export const LOG_READS: Readonly<Record<string, QueryRule>> = {
  "/api/skippy-log": { room: { required: true, ok: (v) => (KEY_LOG_ROOMS as readonly string[]).includes(v) } },
  "/api/green-league": {},
  "/api/exchange-markets": {},
  "/api/exchange-positions": {},
  "/api/world": { day: { ok: (v) => DAY.test(v) } },
  "/api/foundry-feed": {},
  [ROOM_FEED_PATH]: {},
};

/** Two secrets compared in constant time (both hashed first, so their lengths don't show). */
function same(given: string, want: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/**
 * A room key's value from the environment, or null when it doesn't count: unset, shorter than 32 characters, the
 * same as the other room key, or the same as one of the site's own secrets.
 */
export function roomKeyValue(env: Env, which: RoomKey): string | null {
  const want = env[which === "log" ? LOG_TOKEN : FEED_TOKEN]?.trim();
  if (!want || want.length < MIN_ROOM_KEY) return null;
  const other = env[which === "log" ? FEED_TOKEN : LOG_TOKEN]?.trim();
  if (other && same(other, want)) return null;
  const others = OTHER_SECRETS.map((name) => env[name]?.trim()).filter((v): v is string => Boolean(v));
  if (others.some((v) => same(v, want))) return null;
  return want;
}

/**
 * The header a room key travels in. Its own header first, as the live watch's bypass does: the Static Web App's proxy
 * in front of the functions may keep `Authorization` for its own sign-in. `Authorization: Bearer <key>` works too
 * (on the Function App's own address, or Vercel).
 */
export const ROOM_KEY_HEADER = "x-ceo-room-key";

/** The room key a request carries (its own header, else a bearer token), or null. */
export function bearerOf(request: Request): string | null {
  const own = request.headers.get(ROOM_KEY_HEADER)?.trim();
  if (own) return own;
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer /i.test(auth)) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/** Which room key a request carries, if any (both compared, in constant time, whichever matches). */
export function roomKeyOf(request: Request, env: Env): RoomKey | null {
  const given = bearerOf(request);
  if (!given) return null;
  const log = roomKeyValue(env, "log");
  const feed = roomKeyValue(env, "feed");
  // Both are always compared, so the time taken doesn't say which key (if either) was close.
  const isLog = log ? same(given, log) : false;
  const isFeed = feed ? same(given, feed) : false;
  if (isLog) return "log";
  if (isFeed) return "feed";
  return null;
}

/** Whether `url`'s query fits a rule exactly: no other key, no key twice, every value in shape, the required ones there. */
function queryFits(url: URL, rule: QueryRule): boolean {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return false;
  for (const k of keys) {
    const r = rule[k];
    if (!r || !r.ok(url.searchParams.get(k) ?? "")) return false;
  }
  return Object.entries(rule).every(([k, r]) => !r.required || url.searchParams.has(k));
}

/** A plain path: nothing encoded, no dot segments, no trailing slash games. */
const plain = (pathname: string) => !pathname.includes("%") && !pathname.includes("..") && !pathname.includes("//");

/** Whether a request is one of the reads the read key opens (method, path and query; not the key itself). */
export function isLogRead(request: Request): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (!plain(url.pathname) || !Object.hasOwn(LOG_READS, url.pathname)) return false;
  return queryFits(url, LOG_READS[url.pathname]!);
}

/** Whether a request is the one write the feed key opens: POST /api/room-feed with no query. */
export function isFeedWrite(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === "POST" && url.pathname === ROOM_FEED_PATH && url.search === "";
}

/**
 * The gate's question: does this request carry a room key, and is it one of that key's own requests? "room-log" for
 * a read with the read key, "room-feed" for the write with the feed key; null for everything else (the wrong key for
 * the request, a key on any other route or method, no key).
 */
export function roomKeyPass(request: Request, env: Env): "room-log" | "room-feed" | null {
  const key = roomKeyOf(request, env);
  if (key === "log" && isLogRead(request)) return "room-log";
  if (key === "feed" && isFeedWrite(request)) return "room-feed";
  return null;
}

/** For a handler: whether this GET carries the read key (the handler already knows it is one of its own reads). */
export function readsWithLogKey(request: Request, env: Env): boolean {
  return request.method === "GET" && roomKeyOf(request, env) === "log";
}
