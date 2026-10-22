/**
 * The site session (#236, #238): what a browser holds after signing in to the locked site once with the Desk passkey.
 * One cookie, `__Host-ceo-site`: HttpOnly, Secure, SameSite=Lax, for the whole site, holding a signed token
 * (HMAC-SHA256, the same token format as the Desk's own sessions, api/_desk/session.ts) with
 *
 *   t   "site"
 *   v   the session version it was made under (api/_site/state.ts): a new version ends it
 *   s   when it signed in (s)
 *   e   when it ends unless used again (s): 180 days after its last renewal
 *   f   how it signed in: ["passkey"]; the 2FA hook would add "approval". A #236 password session ("password") is
 *       no longer read: that browser signs in again with the passkey
 *
 * It slides: a request with a session that has been used for a day or more since its last renewal gets a fresh one
 * for another 180 days, so a device in use is never asked again. Lax, not Strict, so following a link to the site
 * from elsewhere (a ping, a bookmark, an email) arrives signed in; writes still need the Desk's own Strict session.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { readToken, signToken } from "../_desk/session.js";
import type { Factor, SiteState } from "./state.js";

export type { Factor };

export const SITE_COOKIE = "__Host-ceo-site";
/** A site session lasts this long after its last renewal (seconds). */
export const SITE_SESSION_S = 180 * 24 * 60 * 60;
/** A session is renewed once it is this old since its last renewal (seconds). */
export const RENEW_AFTER_S = 24 * 60 * 60;

export interface SiteSession {
  t: "site";
  v: string;
  s: number;
  e: number;
  f: Factor[];
}

export function newSiteSession(version: string, now: number, factors: Factor[] = ["passkey"]): SiteSession {
  const s = Math.floor(now / 1000);
  return { t: "site", v: version, s, e: s + SITE_SESSION_S, f: factors };
}

/** A site token's session if it is good at `now` (ms): signed with this key, a site session, unexpired. */
export function siteSessionOf(key: Buffer, token: string | null | undefined, now: number): SiteSession | null {
  const p = readToken(key, token);
  const at = Math.floor(now / 1000);
  if (!p || p.t !== "site" || typeof p.v !== "string" || typeof p.s !== "number" || typeof p.e !== "number") return null;
  if (!Array.isArray(p.f) || p.f.length === 0 || !p.f.every((x) => x === "passkey" || x === "approval")) return null;
  if (p.e <= at || p.s > at + 60 || p.e > at + SITE_SESSION_S + 60) return null;
  return { t: "site", v: p.v, s: p.s, e: p.e, f: p.f as Factor[] };
}

/** Whether a session opens the site in this state: the current version, and every factor the state asks for. */
export function sessionFits(session: SiteSession | null, state: Pick<SiteState, "sv" | "factors">): session is SiteSession {
  return Boolean(session && session.v === state.sv && session.f.length > 0 && state.factors.every((f) => session.f.includes(f)));
}

/** The session renewed at `now`, or null when it was renewed less than a day ago (no new cookie needed). */
export function renewedSite(session: SiteSession, now: number): SiteSession | null {
  const at = Math.floor(now / 1000);
  if (session.e - at > SITE_SESSION_S - RENEW_AFTER_S) return null;
  return { ...session, e: at + SITE_SESSION_S };
}

export function siteCookie(key: Buffer, session: SiteSession, now: number): string {
  const maxAge = Math.max(0, session.e - Math.floor(now / 1000));
  return `${SITE_COOKIE}=${signToken(key, session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearSiteCookie = () => `${SITE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
