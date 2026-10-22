/**
 * The site lock, from the Desk (#236, #238; docs/SECURITY.md, "The site lock"), at /api/site-password (the route's
 * name is kept from #236): on Vercel rewritten (vercel.json) to api/desk-auth.ts?site=password, which hands it here;
 * on Azure its own function. Every call needs a Desk session (a passkey sign-in, api/_desk/session.ts), from the
 * Desk's own pages; the site session alone is not enough. The gate never exempts this route. Underscore folder:
 * Vercel never serves it as a function on its own.
 *
 * The Desk passkey is the only way in: there is no password to set (Nikita, 2026-10-22).
 *
 * GET                            → { on, source, locked?, second }: whether the site is locked ("blob": from here;
 *                                  "none"; "off": SITE_GATE=off), since when, and whether the 2FA hook is on.
 * POST { action: "lock" }        → locks the site with the Desk passkey as the way in. A new session version: every
 *                                  other browser signs in once with its passkey. This browser gets a fresh site
 *                                  session, so locking never locks Nikita out of the device in hand.
 * POST { action: "signout-all" } → a new session version: every site session ends but this browser's.
 * POST { action: "off" }         → unlocks: the site is public again.
 *
 * Refusals: 401 { error: "signed-out" } without a Desk session, 403 from another site, 400 { error: "bad-request" },
 * 409 { error: "not-locked" } for signout-all while unlocked, 503 { error: "not-set-up" } without the Desk key or
 * the blob store.
 */

import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { newSiteSession, siteCookie } from "./session.js";
import { newVersion, pickSiteStore, rememberState, siteKeys, stateOf, type SiteRecord, type SiteState, type SiteStore } from "./state.js";

type Env = Record<string, string | undefined>;

export interface PasswordDeps extends DeskDeps {
  env: Env;
  site: SiteStore | null;
}

const live = (): PasswordDeps => ({ deskKey: process.env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(), now: Date.now(), env: process.env, site: pickSiteStore() });

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const res = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

/** What the Desk is told: never the version. */
const view = (state: SiteState, record: SiteRecord | null) => ({
  on: state.on,
  source: state.source,
  ...(record?.locked && state.on && { locked: record.locked }),
  second: state.factors.length > 1,
});

export async function handleGet(request: Request, deps: PasswordDeps = live()): Promise<Response> {
  if (!deps.site) return json({ error: "not-set-up" }, 503);
  const signed = await requireSession(request, deps);
  if (!signed.ok) return signed.response;
  const record = await deps.site.read();
  return withCookie(json(view(stateOf(record, deps.env), record)), signed);
}

export async function handlePost(request: Request, deps: PasswordDeps = live()): Promise<Response> {
  if (!deps.site) return json({ error: "not-set-up" }, 503);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const signed = await requireSession(request, deps);
  if (!signed.ok) return signed.response;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (!body || typeof body !== "object") return withCookie(json({ error: "bad-request" }, 400), signed);

  const old = await deps.site.read();
  let record: SiteRecord;
  if (body.action === "lock") {
    const { open: _open, ...kept } = old ?? {};
    record = { ...kept, v: 1, passkey: true, locked: old?.passkey && old.locked ? old.locked : new Date(deps.now).toISOString(), sv: newVersion() };
  } else if (body.action === "signout-all") {
    if (old?.open) return withCookie(json({ error: "not-locked" }, 409), signed);
    record = { ...(old ?? {}), v: 1, passkey: true, sv: newVersion() };
  } else if (body.action === "off") {
    record = { v: 1, open: true, sv: newVersion(), ...(old?.second && { second: old.second }) };
  } else {
    return withCookie(json({ error: "bad-request" }, 400), signed);
  }
  await deps.site.write(record);
  rememberState(record, deps.now);

  const state = stateOf(record, deps.env);
  const cookies: string[] = [];
  const keys = await siteKeys(deps.env);
  // This browser stays in: a fresh site session under the new version (the Desk session behind it was a passkey's).
  if (state.on && keys) cookies.push(siteCookie(keys.session, newSiteSession(state.sv, deps.now, ["passkey"]), deps.now));
  return withCookie(json(view(state, record), 200, cookies), signed);
}

export async function GET(request: Request): Promise<Response> {
  return handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
