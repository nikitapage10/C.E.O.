/**
 * The whole-site gate (#236, docs/SECURITY.md, "The site password"): who may reach a page or an API route once a
 * site password is set. The same decision runs in front of everything on Vercel (middleware.ts, Routing Middleware)
 * and in front of every Azure function (azure/src/index.ts).
 *
 * In order:
 *   1. No password set (or SITE_GATE=off): everything passes, as before.
 *   2. The login itself (/api/site-login) passes: it is the way in.
 *   3. Static files built from the public repo pass on GET or HEAD: the hashed bundles (/assets/), the models
 *      (/models/), the Desk's and the Lattice's images (/desk/, /tide/), the PWA manifest and the service worker. They
 *      hold nothing that isn't already public on GitHub, the manifest and its icons are fetched without cookies by
 *      the browser, and keeping them out of the gate saves a check per model.
 *   4. Machine callers with their own key:
 *        POST /api/world-step                 the hourly step: open by design (calling it more often changes nothing,
 *                                             docs/WORLD.md), and its answer says only whether it stepped and when
 *        POST /api/desk-pings + Authorization: Bearer <DESK_PINGS_SECRET>   the pings scan, checked here too
 *        any request + x-ceo-site-bypass: <SITE_BYPASS_TOKEN>   the GitHub workflows that read the site (the backup,
 *                                             the Azure seed, the live watch)
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
import { loginPage } from "./page.js";
import { SITE_COOKIE, renewedSite, sessionFits, siteCookie, siteSessionOf } from "./session.js";
import { currentState, siteKeys, type SiteKeys, type SiteState, type SiteStore } from "./state.js";

type Env = Record<string, string | undefined>;

export const BYPASS_HEADER = "x-ceo-site-bypass";
export const GATE_HEADER = "x-ceo-site-gate";
/** The shortest SITE_BYPASS_TOKEN that counts: a shorter one is ignored, so a weak token can't open the site. */
export const MIN_BYPASS = 32;

export const LOGIN_PATH = "/api/site-login";
const STATIC_PREFIXES = ["/assets/", "/models/", "/desk/", "/tide/"];
const STATIC_FILES = new Set(["/manifest.webmanifest", "/sw.js", "/favicon.ico", "/robots.txt"]);

/** Why a request was let through (for tests, and the x-ceo-site-gate header on the way out). */
export type Pass = "off" | "login" | "static" | "world-step" | "pings-secret" | "bypass" | "session";

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

/** The pings workflow's scan, with the right DESK_PINGS_SECRET (api/desk-pings.ts checks it again). */
function isPingsScan(request: Request, pathname: string, env: Env): boolean {
  if (request.method !== "POST" || pathname !== "/api/desk-pings") return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && secretMatches(auth.slice(7).trim(), env.DESK_PINGS_SECRET?.trim());
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  [GATE_HEADER]: "locked",
} as const;

/** The refusal for this request: JSON for the API and anything but a page load, the login page for a page. */
export function locked(request: Request, message?: "unknown" | "off"): Response {
  const url = new URL(request.url);
  const page = (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/");
  if (!page) {
    const status = message === "unknown" ? 503 : 401;
    return new Response(JSON.stringify({ error: message === "unknown" ? "site-unavailable" : "site-locked" }), {
      status,
      headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" },
    });
  }
  return new Response(request.method === "HEAD" ? null : loginPage({ next: url.pathname + url.search, message }), {
    status: message === "unknown" ? 503 : 401,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

/** The gate's decision for one request. */
export function decide(request: Request, ctx: GateContext): Decision {
  const { state, env } = ctx;
  if (!state.on) return { allow: true, why: "off" };
  const pathname = new URL(request.url).pathname;
  if (pathname === LOGIN_PATH) return { allow: true, why: "login" };
  if (isStaticPath(request.method, pathname)) return { allow: true, why: "static" };
  if (request.method === "POST" && pathname === "/api/world-step") return { allow: true, why: "world-step" };
  if (isPingsScan(request, pathname, env)) return { allow: true, why: "pings-secret" };
  if (hasBypass(request, env)) return { allow: true, why: "bypass" };
  if (state.unknown) return { allow: false, response: locked(request, "unknown") };
  if (!ctx.keys) return { allow: false, response: locked(request, "off") };
  const session = siteSessionOf(ctx.keys.session, readCookie(request, SITE_COOKIE), ctx.now);
  if (!sessionFits(session, state)) return { allow: false, response: locked(request) };
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
 * out everywhere" or a new password, an instance's copy can be older than the browser's new cookie.
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
