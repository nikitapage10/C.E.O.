/**
 * The Desk's sessions (#132, docs/THREAT-MODEL.md, R3). After a passkey sign-in the browser holds one cookie: an
 * HttpOnly, Secure, SameSite=Strict token, signed with a key derived from the Desk key (api/_desk/keys.ts) and good
 * for 30 minutes from the last use. Every signed-in request renews it quietly, up to 12 hours after the sign-in,
 * when a passkey is needed again. Scripts on the page can't read it, other sites can't send it, and it names the
 * passkey it came from, so removing a device ends its sessions at once.
 *
 * The same signing carries a sign-in's or an enrolment's one-time challenge between its two steps, in a second short
 * cookie that lasts five minutes.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { deskKeyFor } from "./keys.js";
import type { AuthStore, Passkey } from "./store.js";

/** A session lasts this long after its last use (seconds)… */
export const IDLE_S = 30 * 60;
/** …and never longer than this after the passkey sign-in (seconds). */
export const MAX_S = 12 * 60 * 60;
/** A sign-in or enrolment challenge lasts this long (seconds). */
export const CHALLENGE_S = 5 * 60;

/** `__Host-`: the browser keeps it only when it is Secure, for the whole site, and set by this host alone. */
export const SESSION_COOKIE = "__Host-ceo-desk";
/**
 * One challenge cookie per step, so starting an enrolment never spoils a sign-in the Desk has ready, or the reverse.
 * `keys` is the Keys form's step-up (#330, api/_keys/route.ts): a fresh passkey answer for each key it sets.
 */
export const CHALLENGE_COOKIE = { signin: "__Host-ceo-desk-signin", enrol: "__Host-ceo-desk-enrol", keys: "__Host-ceo-desk-keys" } as const;

export interface Session {
  t: "session";
  /** The passkey it was opened with. */
  c: string;
  /** Signed in at (s). */
  s: number;
  /** Ends at, unless used again (s). */
  e: number;
}

export interface Challenge {
  t: "enrol" | "signin" | "keys";
  /** The WebAuthn challenge, base64url. */
  ch: string;
  /** Ends at (s). */
  e: number;
  /** Enrolment only: the device's label, as Nikita gave it. */
  label?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** A token: the payload and its HMAC, both base64url, joined by a dot. */
export function signToken(key: Buffer, payload: object): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(createHmac("sha256", key).update(body).digest())}`;
}

/** The payload of a token signed with this key, or null for anything else. Compared in constant time. */
export function readToken(key: Buffer, token: string | null | undefined): Record<string, unknown> | null {
  if (!token || token.length > 2048) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A new session for a passkey sign-in at `now` (ms). */
export function newSession(credential: string, now: number): Session {
  const s = Math.floor(now / 1000);
  return { t: "session", c: credential, s, e: Math.min(s + IDLE_S, s + MAX_S) };
}

/** The session renewed by a use at `now` (ms): 30 more minutes, never past 12 hours from the sign-in. */
export function renewed(session: Session, now: number): Session {
  return { ...session, e: Math.min(Math.floor(now / 1000) + IDLE_S, session.s + MAX_S) };
}

/** A session token's payload if it is good at `now` (ms): signed by us, a session, unexpired on both clocks. */
export function sessionOf(key: Buffer, token: string | null | undefined, now: number): Session | null {
  const p = readToken(key, token);
  const at = Math.floor(now / 1000);
  if (!p || p.t !== "session" || typeof p.c !== "string" || !p.c || typeof p.s !== "number" || typeof p.e !== "number") return null;
  if (p.e <= at || p.s + MAX_S <= at || p.s > at + 60 || p.e > p.s + MAX_S) return null;
  return { t: "session", c: p.c, s: p.s, e: p.e };
}

/** A challenge token's payload if it is good at `now` (ms) for this step. */
export function challengeOf(key: Buffer, token: string | null | undefined, step: Challenge["t"], now: number): Challenge | null {
  const p = readToken(key, token);
  if (!p || p.t !== step || typeof p.ch !== "string" || typeof p.e !== "number" || p.e <= Math.floor(now / 1000)) return null;
  return { t: step, ch: p.ch, e: p.e, ...(typeof p.label === "string" && { label: p.label }) };
}

/** A Set-Cookie value for one of the Desk's cookies; a max age of 0 clears it. */
export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

/** The cookie that holds a session, lasting as long as the session does. */
export async function sessionCookie(deskKey: string, session: Session, now: number): Promise<string> {
  return cookie(SESSION_COOKIE, signToken(await deskKeyFor(deskKey, "session"), session), session.e - Math.floor(now / 1000));
}

export const clearSession = () => cookie(SESSION_COOKIE, "", 0);

/** One cookie's value from a request. */
export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/**
 * A write must come from the Desk's own pages: when the browser names the page's origin, it has to be this site's.
 * (The SameSite=Strict cookie already stays home; this is the second lock.)
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: unknown, status: number, cookies: string[] = []): Response {
  const res = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

export interface DeskDeps {
  /** The Desk key (FOUNDRY_DESK_KEY); empty when it isn't set. */
  deskKey: string;
  store: AuthStore | null;
  now: number;
}

export type Signed = { ok: true; session: Session; passkey: Passkey; cookie: string } | { ok: false; response: Response };

/**
 * The gate on every Desk write and private read (#132): a good session cookie for a passkey that is still enrolled,
 * from this site's own pages. On success it hands back the renewed cookie to send with the answer; otherwise the
 * answer to send instead: 503 when sign-in isn't set up, 403 from another site, 401 { error: "signed-out" } (and the
 * stale cookie cleared) when there is no good session.
 */
export async function requireSession(request: Request, deps: DeskDeps): Promise<Signed> {
  if (!deps.deskKey || !deps.store) return { ok: false, response: json({ error: "not-set-up" }, 503) };
  if (!sameOrigin(request)) return { ok: false, response: json({ error: "cross-site" }, 403) };
  const given = readCookie(request, SESSION_COOKIE);
  const session = sessionOf(await deskKeyFor(deps.deskKey, "session"), given, deps.now);
  const passkey = session ? (await deps.store.passkeys()).find((p) => p.id === session.c) : undefined;
  if (!session || !passkey) return { ok: false, response: json({ error: "signed-out" }, 401, given ? [clearSession()] : []) };
  const next = renewed(session, deps.now);
  return { ok: true, session: next, passkey, cookie: await sessionCookie(deps.deskKey, next, deps.now) };
}

/** Sends the renewed session cookie with an answer. */
export function withCookie(res: Response, signed: { cookie: string }): Response {
  res.headers.append("Set-Cookie", signed.cookie);
  return res;
}
