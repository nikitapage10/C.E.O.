/**
 * The site password's sign-in (#236, docs/SECURITY.md, "The site password"), at /api/site-login. On Vercel that path is
 * rewritten (vercel.json) to the Desk's sign-in function, api/desk-auth.ts?site=login, which hands it here, so the site
 * password adds no function to the deployment; on Azure it is its own function (azure/src/index.ts). The gate
 * (api/_site/gate.ts) always lets this path through: it is the way in.
 *
 * GET  ?next=/path                      → the login page (200), or straight on to `next` (303) when the site isn't
 *                                         locked or this browser is already signed in.
 * POST password=…&next=/path (a form)   → the password checked against the stored hash in constant time; right: a
 *                                         180-day site session cookie and 303 to `next`; wrong: the login page again
 *                                         with one generic line (401). Too many tries: 429 with how long to wait.
 * POST action=signout                   → ends this browser's site session; the login page says so.
 *
 * Tries are counted per address (a keyed hash, never the address) and across all addresses in the private store
 * (api/_desk/limits.ts, rules siteAddress and siteAll): five free from one address, then a minute, five minutes,
 * fifteen, then an hour's lock. A form from another site is refused.
 *
 * Environment: SITE_SESSION_SECRET (optional; else keys come from FOUNDRY_DESK_KEY), SITE_PASSWORD_HASH (optional),
 * SITE_GATE=off (break glass), and the private blob store.
 *
 * Underscore folder: Vercel never serves it as a function on its own.
 */

import { addressOf, Gate } from "../_desk/limits.js";
import { readCookie, sameOrigin } from "../_desk/session.js";
import { MemoryAuthStore, pickAuthStore, type AuthStore } from "../_desk/store.js";
import { loginPage, safeNext, type LoginPageOptions } from "./page.js";
import { verifyPassword } from "./password.js";
import { SITE_COOKIE, clearSiteCookie, newSiteSession, sessionFits, siteCookie, siteSessionOf } from "./session.js";
import { pickSiteStore, siteKeys, stateOf, type SiteStore } from "./state.js";

type Env = Record<string, string | undefined>;

export interface LoginDeps {
  env: Env;
  store: SiteStore | null;
  /** Where the try counters live; an instance's memory when no blob store is connected. */
  limits: AuthStore;
  now: number;
}

/** No blob store, no shared counters: this instance's own memory still slows a guesser down. */
const localLimits = new MemoryAuthStore();

const live = (): LoginDeps => ({ env: process.env, store: pickSiteStore(), limits: pickAuthStore() ?? localLimits, now: Date.now() });

const HTML = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function page(status: number, opts: LoginPageOptions, cookies: string[] = [], extra: Record<string, string> = {}): Response {
  const res = new Response(loginPage(opts), { status, headers: { ...HTML, ...extra } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

function goTo(next: string, cookies: string[] = []): Response {
  const res = new Response(null, { status: 303, headers: { Location: safeNext(next), "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

/** The record straight from the store (never this instance's cached copy: a sign-in must see the newest password). */
async function freshState(deps: LoginDeps) {
  return stateOf(deps.store ? await deps.store.read() : null, deps.env);
}

export async function handleGet(request: Request, deps: LoginDeps = live()): Promise<Response> {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  let state;
  try {
    state = await freshState(deps);
  } catch {
    return page(503, { next, message: "unknown" });
  }
  if (!state.on) return goTo(next);
  const keys = await siteKeys(deps.env);
  if (keys && sessionFits(siteSessionOf(keys.session, readCookie(request, SITE_COOKIE), deps.now), state)) return goTo(next);
  return page(200, { next });
}

/** The form's fields, from a form post or JSON. */
async function fields(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(body ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
    }
    if (type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const out: Record<string, string> = {};
      for (const k of ["password", "next", "action"]) {
        const v = form.get(k);
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    // unreadable: no fields
  }
  return {};
}

export async function handlePost(request: Request, deps: LoginDeps = live()): Promise<Response> {
  if (!sameOrigin(request)) return new Response(JSON.stringify({ error: "cross-site" }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const form = await fields(request);
  const next = safeNext(form.next);
  if (form.action === "signout") return page(200, { message: "signed-out" }, [clearSiteCookie()]);

  let state;
  try {
    state = await freshState(deps);
  } catch {
    return page(503, { next, message: "unknown" });
  }
  if (!state.on) return goTo(next);
  const keys = await siteKeys(deps.env);
  if (!keys || !state.hash) return page(503, { next, message: "off" });

  const gate = await Gate.open(deps.limits, "site", addressOf(request), keys.client, deps.now);
  const wait = gate.wait();
  if (wait > 0) return page(429, { next, message: "locked", waitMinutes: wait / 60_000 }, [], { "Retry-After": String(Math.ceil(wait / 1000)) });

  if (!(await verifyPassword(form.password, state.hash))) {
    await gate.fail();
    return page(401, { next, message: "wrong" });
  }
  await gate.clear();
  return goTo(next, [siteCookie(keys.session, newSiteSession(state.sv, deps.now, ["password"]), deps.now)]);
}

export async function GET(request: Request): Promise<Response> {
  return handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
