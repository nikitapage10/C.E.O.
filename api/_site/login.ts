/**
 * The locked site's login (#236, #238; docs/SECURITY.md, "The site lock"), at /api/site-login. On Vercel that path is
 * rewritten (vercel.json) to the Desk's sign-in function, api/desk-auth.ts?site=login, which hands it here, so the
 * login adds no function to the deployment; on Azure it is its own function (azure/src/index.ts). The gate
 * (api/_site/gate.ts) always lets this path through: it is the way in.
 *
 * The Desk passkey is the only way in (Nikita, 2026-10-22: no password). The page's script runs the Desk's own
 * WebAuthn ceremony against /api/desk-auth (sign-in, or "Add this device" with the Desk key), which sets the site
 * cookie on success (passkeySiteCookie below). Nothing here checks a password: there is none.
 *
 * GET  ?next=/path          → the login page (200), or straight on to `next` (303) when the site isn't locked or this
 *                             browser is already signed in.
 * GET  ?part=script         → the login page's passkey script (api/_site/page.ts, LOGIN_SCRIPT).
 * POST action=signout       → ends this browser's site session; the login page says so. Any other post: 400.
 *
 * Environment: SITE_SESSION_SECRET (optional; else keys come from FOUNDRY_DESK_KEY), SITE_GATE=off (break glass),
 * and the private blob store.
 *
 * Underscore folder: Vercel never serves it as a function on its own.
 */

import { readCookie, sameOrigin } from "../_desk/session.js";
import { LOGIN_CSP, LOGIN_SCRIPT, loginPage, safeNext, type LoginPageOptions } from "./page.js";
import { SITE_COOKIE, clearSiteCookie, newSiteSession, sessionFits, siteCookie, siteSessionOf } from "./session.js";
import { pickSiteStore, siteKeys, stateOf, type SiteStore } from "./state.js";

type Env = Record<string, string | undefined>;

export interface LoginDeps {
  env: Env;
  store: SiteStore | null;
  now: number;
}

const live = (): LoginDeps => ({ env: process.env, store: pickSiteStore(), now: Date.now() });

const HTML = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": LOGIN_CSP,
};

/** Whether the Desk's passkeys can be used here: the Desk key is set on the server. */
const passkeyOn = (env: Env) => Boolean(env.FOUNDRY_DESK_KEY?.trim());

function page(status: number, opts: LoginPageOptions, cookies: string[] = []): Response {
  const res = new Response(loginPage(opts), { status, headers: HTML });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

function goTo(next: string): Response {
  return new Response(null, { status: 303, headers: { Location: safeNext(next), "Cache-Control": "no-store" } });
}

function script(): Response {
  return new Response(LOGIN_SCRIPT, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * The site cookie for a passkey sign-in or a new device (#238), when the site is locked: api/desk-auth.ts adds it to
 * a successful `signin` or `enrol`, so the Desk passkey opens the whole site for 180 days (renewed with use). Null
 * when the site isn't locked or has no keys, or the store can't be read (the Desk sign-in still works).
 */
export async function passkeySiteCookie(env: Env, store: SiteStore | null, now: number): Promise<string | null> {
  try {
    const state = stateOf(store ? await store.read() : null, env);
    if (!state.on) return null;
    const keys = await siteKeys(env);
    return keys ? siteCookie(keys.session, newSiteSession(state.sv, now, ["passkey"]), now) : null;
  } catch {
    return null;
  }
}

export async function handleGet(request: Request, deps: LoginDeps = live()): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("part") === "script") return script();
  const next = safeNext(url.searchParams.get("next"));
  let state;
  try {
    // Straight from the store (never this instance's cached copy): the page must see the newest lock.
    state = stateOf(deps.store ? await deps.store.read() : null, deps.env);
  } catch {
    return page(503, { next, message: "unknown", passkey: passkeyOn(deps.env) });
  }
  if (!state.on) return goTo(next);
  const keys = await siteKeys(deps.env);
  if (keys && sessionFits(siteSessionOf(keys.session, readCookie(request, SITE_COOKIE), deps.now), state)) return goTo(next);
  return page(200, { next, passkey: passkeyOn(deps.env), ...(!keys && { message: "off" as const }) });
}

/** A form's `action` field, from a form post or JSON. */
async function actionOf(request: Request): Promise<string | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("application/json")) {
      const body = (await request.json()) as { action?: unknown } | null;
      return typeof body?.action === "string" ? body.action : null;
    }
    if (type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")) {
      const v = (await request.formData()).get("action");
      return typeof v === "string" ? v : null;
    }
  } catch {
    // unreadable: no action
  }
  return null;
}

export async function handlePost(request: Request, deps: LoginDeps = live()): Promise<Response> {
  if (!sameOrigin(request)) return new Response(JSON.stringify({ error: "cross-site" }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if ((await actionOf(request)) === "signout") return page(200, { message: "signed-out", passkey: passkeyOn(deps.env) }, [clearSiteCookie()]);
  // There is no password to post (#238): the way in is the passkey, through /api/desk-auth.
  return new Response(JSON.stringify({ error: "bad-request" }), { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  return handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
