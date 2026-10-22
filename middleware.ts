/**
 * The whole-site gate on Vercel (#236, #238; docs/SECURITY.md, "The site lock"): Vercel Routing Middleware, which runs
 * in front of every request to the deployment, the static pages and files as well as the /api functions, before
 * vercel.json's rewrites. It runs on the Node.js runtime so it can share the functions' crypto and blob store code.
 *
 * Until the site is locked from the Desk ("Lock the site", the Desk passkey as the way in), it lets everything
 * through, as before. Once it is locked, a page without a site session gets the login page and an API route gets
 * 401; the exemptions are in api/_site/gate.ts and docs/SECURITY.md. SITE_GATE=off in Vercel's settings (and a redeploy) turns it off whatever
 * is stored: the break-glass switch.
 *
 * The local build (scripts/boot-check.mjs, tests/e2e/dist-server.ts) doesn't run this file unless asked to
 * (tests/e2e/gate.spec.ts does, with the gate on).
 */

import { get } from "@vercel/blob";
import { next } from "@vercel/functions/middleware";
import { gateRequest } from "./api/_site/gate.js";
import { BlobSiteStore, RECORD_PATH, readRecord, type SiteRecord, type SiteStore } from "./api/_site/state.js";
import { pickBlob } from "./api/_blob.js";

export const config = { runtime: "nodejs" };

/**
 * The site record as the middleware reads it: the blob store as the functions use it, and, should that sign-in fail
 * in front of the functions, once more with the OIDC token Vercel hands the request, if it does.
 */
class MiddlewareSiteStore implements SiteStore {
  constructor(
    private readonly base: SiteStore,
    private readonly oidcToken: string | undefined,
  ) {}
  async read(): Promise<SiteRecord | null> {
    try {
      return await this.base.read();
    } catch (e) {
      if (!this.oidcToken) throw e;
      const found = await get(RECORD_PATH, { access: "private", useCache: false, oidcToken: this.oidcToken });
      if (!found?.stream) return null;
      return readRecord(await new Response(found.stream).json().catch(() => null));
    }
  }
  async write(): Promise<void> {
    throw new Error("the middleware never writes");
  }
}

export default async function middleware(request: Request): Promise<Response> {
  const blob = pickBlob(process.env);
  const store = blob ? new MiddlewareSiteStore(new BlobSiteStore(blob), request.headers.get("x-vercel-oidc-token") ?? undefined) : null;
  const decision = await gateRequest(request, { env: process.env, store, now: Date.now() });
  if (!decision.allow) return decision.response;
  return decision.setCookie ? next({ headers: { "Set-Cookie": decision.setCookie } }) : next();
}
