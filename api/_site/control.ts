/**
 * The site password, set from the Desk (#236, docs/SECURITY.md, "The site password"), at /api/site-password: on Vercel
 * rewritten (vercel.json) to api/desk-auth.ts?site=password, which hands it here; on Azure its own function. Every
 * call needs a Desk session (a passkey sign-in, api/_desk/session.ts), from the Desk's own pages; the site session
 * alone is not enough. Underscore folder: Vercel never serves it as a function on its own.
 *
 * GET                                 → { on, source, set?, second }: whether the site is locked, and by what
 *                                       ("blob": set here; "env": SITE_PASSWORD_HASH; "none"; "off": SITE_GATE=off).
 * POST { action: "set", password }    → stores the new password's salted hash (never the password), with a new
 *                                       session version: every other browser signs in again with the new password.
 *                                       This browser gets a fresh site session, so setting it never locks Nikita out.
 * POST { action: "signout-all" }      → a new session version: every site session ends but this browser's.
 * POST { action: "off" }              → forgets the stored hash: the site is public again (unless SITE_PASSWORD_HASH
 *                                       is set in Vercel).
 *
 * Refusals: 401 { error: "signed-out" } without a Desk session, 403 from another site, 400 { error: "too-short" |
 * "too-long" | "blank" | "missing" }, 503 { error: "not-set-up" } without the Desk key or the blob store.
 */

import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { hashPassword, passwordProblem } from "./password.js";
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

/** What the Desk is told: never the hash or the version. */
const view = (state: SiteState, record: SiteRecord | null) => ({
  on: state.on,
  source: state.source,
  ...(record?.set && state.source === "blob" && { set: record.set }),
  second: state.factors.includes("passkey"),
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
  const body = (await request.json().catch(() => null)) as { action?: unknown; password?: unknown } | null;
  if (!body || typeof body !== "object") return withCookie(json({ error: "bad-request" }, 400), signed);

  const old = await deps.site.read();
  let record: SiteRecord;
  if (body.action === "set") {
    const problem = passwordProblem(body.password);
    if (problem) return withCookie(json({ error: problem }, 400), signed);
    record = { ...(old ?? {}), v: 1, hash: await hashPassword(body.password as string), sv: newVersion(), set: new Date(deps.now).toISOString() };
  } else if (body.action === "signout-all") {
    record = { ...(old ?? {}), v: 1, sv: newVersion() };
  } else if (body.action === "off") {
    record = { v: 1, sv: newVersion(), ...(old?.second && { second: old.second }) };
  } else {
    return withCookie(json({ error: "bad-request" }, 400), signed);
  }
  await deps.site.write(record);
  rememberState(record, deps.now);

  const state = stateOf(record, deps.env);
  const cookies: string[] = [];
  const keys = await siteKeys(deps.env);
  // This browser stays in: a fresh site session under the new version.
  if (state.on && keys) cookies.push(siteCookie(keys.session, newSiteSession(state.sv, deps.now, ["password"]), deps.now));
  return withCookie(json(view(state, record), 200, cookies), signed);
}

export async function GET(request: Request): Promise<Response> {
  return handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
