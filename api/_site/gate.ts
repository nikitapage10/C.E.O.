/**
 * The whole-site gate (#236, #238; docs/SECURITY.md, "The site lock"): who may reach a page or an API route once the
 * site is locked. The Desk passkey is the only way in (#238). The same decision runs in front of everything on
 * Vercel (middleware.ts, Routing Middleware) and in front of every Azure function (azure/src/index.ts).
 *
 * In order:
 *   1. Not locked (or SITE_GATE=off): everything passes, as before.
 *   2. The ways in pass:
 *        /api/site-login (any method)          the login page, its script (?part=script) and its sign-out
 *        /api/desk-auth, GET, HEAD and POST, without a `site` query other than "login"
 *                                             the Desk's passkey ceremony: sign-in and "Add this device" (#238). The
 *                                             function guards itself: a sign-in needs a passkey, an enrolment the Desk
 *                                             key, removing a device a Desk session; its GET says only whether this
 *                                             browser is signed in. ?site=password (the lock's control) stays gated.
 *   3. Static files built from the public repo pass on GET or HEAD: the hashed bundles (/assets/), the models
 *      (/models/), the Desk's and the Lattice's images (/desk/, /tide/), the PWA manifest and the service worker. They
 *      hold nothing that isn't already public on GitHub, the manifest and its icons are fetched without cookies by
 *      the browser, and keeping them out of the gate saves a check per model.
 *   4. Machine callers with their own key:
 *        POST /api/world-step                 the hourly step: open by design (calling it more often changes nothing,
 *                                             docs/WORLD.md), and its answer says only whether it stepped and when
 *        POST /api/desk-pings + Authorization: Bearer <DESK_PINGS_SECRET>   the pings scan, checked here too
 *        POST /api/skippy-answer + Authorization: Bearer <SUBMIND_FEED_TOKEN>   a hand-off's answer from Skippy's or a
 *                                             submind's thread (#312), checked here too and again in api/skippy.ts
 *        any request + x-ceo-site-bypass: <SITE_BYPASS_TOKEN>   the live watch (it reads site-bypass-token from the
 *                                             Key Vault, #313; Vercel's copy also served the public-mode seed)
 *        GET <a room read> + x-ceo-room-key: <SUBMIND_LOG_TOKEN>    a submind thread reading its room's data
 *        POST /api/room-feed + x-ceo-room-key: <SUBMIND_FEED_TOKEN> a submind thread posting a room event
 *                                             (or either as Authorization: Bearer)
 *                                             (#281, api/_site/roomkeys.ts: each key opens only its own exact
 *                                             method, path and query; the handlers check the key again)
 *   5. A good site session cookie (api/_site/session.ts) for the current version, renewed once a day of use.
 *   6. Anything else: an API route gets 401 { error: "site-locked" }; a page gets the login page, with 401.
 *
 * Every refusal carries `x-ceo-site-gate: locked`, which the Desk and the Lattice look for (apps/world/src/siteGate.ts)
 * to send the browser to the login page when only the API is gated (Azure).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readCookie } from "../_desk/session.js";
import { LOGIN_CSP, loginPage } from "./page.js";
import { SITE_COOKIE, renewedSite, sessionFits, siteCookie, siteSessionOf } from "./session.js";
import { roomKeyPass } from "./roomkeys.js";
import { currentState, siteKeys, type SiteKeys, type SiteState, type SiteStore } from "./state.js";

type Env = Record<string, string | undefined>;

export const BYPASS_HEADER = "x-ceo-site-bypass";
export const GATE_HEADER = "x-ceo-site-gate";
/** The shortest SITE_BYPASS_TOKEN that counts: a shorter one is ignored, so a weak token can't open the site. */
export const MIN_BYPASS = 32;

export const LOGIN_PATH = "/api/site-login";
/** The Desk's sign-in function (api/desk-auth.ts): the passkey ceremony the login page uses (#238). */
export const PASSKEY_PATH = "/api/desk-auth";
const STATIC_PREFIXES = ["/assets/", "/models/", "/desk/", "/tide/"];
const STATIC_FILES = new Set(["/manifest.webmanifest", "/sw.js", "/favicon.ico", "/robots.txt"]);

/** Why a request was let through (for tests, and the x-ceo-site-gate header on the way out). */
export type Pass = "off" | "login" | "passkey" | "static" | "world-step" | "pings-secret" | "submind-token" | "bypass" | "room-log" | "room-feed" | "session";

export type Decision = { allow: true; why: Pass; setCookie?: string } | { allow: false; response: Response };

export interface GateContext {
  state: SiteState & { unknown?: boolean };
  /** The site's signing keys, or null when neither SITE_SESSION_SECRET nor FOUNDRY_DESK_KEY is set. */
  keys: SiteKeys | null;
  env: Env;
  now: number;
}

/** Two secrets compared in constant time (both hashed first, so their lengths don't show). */
export function secretMatches(given: string | null | undefined, want: string | null | undefined): boolean {
  if (!given || !want) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/** A static file from the public build: GET or HEAD only, and a plain path (nothing encoded). */
export function isStaticPath(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.includes("%") || pathname.includes("..")) return false;
  return STATIC_FILES.has(pathname) || STATIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Whether a request carries the workflows' bypass token (SITE_BYPASS_TOKEN, at least 32 characters). */
export function hasBypass(request: Request, env: Env): boolean {
  const want = env.SITE_BYPASS_TOKEN?.trim();
  return Boolean(want && want.length >= MIN_BYPASS && secretMatches(request.headers.get(BYPASS_HEADER)?.trim(), want));
}

/**
 * The Desk's passkey ceremony (#238): /api/desk-auth on GET, HEAD or POST, with no `site` query (or `site=login`, the
 * login itself). Not ?site=password, which rewrites to the lock's control and stays behind the gate.
 */
export function isPasskeyPath(request: Request, url: URL): boolean {
  if (url.pathname !== PASSKEY_PATH) return false;
  if (!["GET", "HEAD", "POST"].includes(request.method)) return false;
  const site = url.searchParams.getAll("site");
  return site.length === 0 || (site.length === 1 && site[0] === "login");
}

/** The pings workflow's scan, with the right DESK_PINGS_SECRET (api/desk-pings.ts checks it again). */
function isPingsScan(request: Request, pathname: string, env: Env): boolean {
  if (request.method !== "POST" || pathname !== "/api/desk-pings") return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && secretMatches(auth.slice(7).trim(), env.DESK_PINGS_SECRET?.trim());
}

/**
 * A hand-off's answer coming back (#312), with the room threads' write key (SUBMIND_FEED_TOKEN, at least 32
 * characters). Only this one path and method: the key opens nothing else on the site.
 */
function isSkippyAnswer(request: Request, pathname: string, env: Env): boolean {
  if (request.method !== "POST" || pathname !== "/api/skippy-answer") return false;
  const want = env.SUBMIND_FEED_TOKEN?.trim();
  const auth = request.headers.get("authorization") ?? "";
  return Boolean(want && want.length >= MIN_BYPASS && auth.startsWith("Bearer ") && secretMatches(auth.slice(7).trim(), want));
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  [GATE_HEADER]: "locked",
} as const;

/** The refusal for this request: JSON for the API and anything but a page load, the login page for a page. */
export function locked(request: Request, message?: "unknown" | "off", passkey = true): Response {
  const url = new URL(request.url);
  const page = (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/");
  if (!page) {
    const status = message === "unknown" ? 503 : 401;
    return new Response(JSON.stringify({ error: message === "unknown" ? "site-unavailable" : "site-locked" }), {
      status,
      headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" },
    });
  }
  return new Response(request.method === "HEAD" ? null : loginPage({ next: url.pathname + url.search, message, passkey }), {
    status: message === "unknown" ? 503 : 401,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": LOGIN_CSP,
    },
  });
}

/** The gate's decision for one request. */
export function decide(request: Request, ctx: GateContext): Decision {
  const { state, env } = ctx;
  if (!state.on) return { allow: true, why: "off" };
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === LOGIN_PATH) return { allow: true, why: "login" };
  if (isPasskeyPath(request, url)) return { allow: true, why: "passkey" };
  if (isStaticPath(request.method, pathname)) return { allow: true, why: "static" };
  if (request.method === "POST" && pathname === "/api/world-step") return { allow: true, why: "world-step" };
  if (isPingsScan(request, pathname, env)) return { allow: true, why: "pings-secret" };
  if (isSkippyAnswer(request, pathname, env)) return { allow: true, why: "submind-token" };
  if (hasBypass(request, env)) return { allow: true, why: "bypass" };
  const room = roomKeyPass(request, env);
  if (room) return { allow: true, why: room };
  // The passkey works only where the Desk key is set; without it, the login page says signing in isn't set up.
  const passkey = Boolean(env.FOUNDRY_DESK_KEY?.trim());
  if (state.unknown) return { allow: false, response: locked(request, "unknown", passkey) };
  if (!ctx.keys) return { allow: false, response: locked(request, "off", passkey) };
  const session = siteSessionOf(ctx.keys.session, readCookie(request, SITE_COOKIE), ctx.now);
  if (!sessionFits(session, state)) return { allow: false, response: locked(request, undefined, passkey) };
  const next = renewedSite(session, ctx.now);
  return { allow: true, why: "session", ...(next && { setCookie: siteCookie(ctx.keys.session, next, ctx.now) }) };
}

export interface GateDeps {
  env: Env;
  /** The site record's store, or null when no blob store is connected (then only the environment decides). */
  store: SiteStore | null;
  now: number;
}

/**
 * The gate for one request, with the state read (cached per instance, api/_site/state.ts). A refused request that
 * carries a cookie we signed, for another version, re-reads the record once (at most every 2 s): right after "Sign
 * out everywhere" or locking again, an instance's copy can be older than the browser's new cookie.
 */
export async function gateRequest(request: Request, deps: GateDeps): Promise<Decision> {
  const state = await currentState(deps.env, deps.store, deps.now);
  if (!state.on) return { allow: true, why: "off" };
  const keys = await (siteKeys(deps.env) ?? Promise.resolve(null));
  const first = decide(request, { state, keys, env: deps.env, now: deps.now });
  if (first.allow || !keys || !deps.store || state.unknown) return first;
  const session = siteSessionOf(keys.session, readCookie(request, SITE_COOKIE), deps.now);
  if (!session || session.v === state.sv) return first;
  const again = await currentState(deps.env, deps.store, deps.now, { fresh: true });
  return decide(request, { state: again, keys, env: deps.env, now: deps.now });
}

/**
 * A handler behind the gate, for hosts with no middleware in front (the Azure Functions, azure/src/index.ts): the
 * same decision, then the handler, with a renewed site cookie added to its answer.
 */
export function withGate(handler: (request: Request) => Response | Promise<Response>, deps: () => GateDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const decision = await gateRequest(request, deps());
    if (!decision.allow) return decision.response;
    const res = await handler(request);
    if (!decision.setCookie) return res;
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    out.headers.append("Set-Cookie", decision.setCookie);
    return out;
  };
}
