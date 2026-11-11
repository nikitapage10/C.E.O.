/**
 * The Builder's read key (#800; docs/SECURITY.md, "The Builder's read key"). Nikita, 2026-11-05: anything private, the
 * Builder (a Claude Code cloud session) should be able to read, even without a passkey, so it can check a Haven change
 * against the real floor plan and data before shipping it.
 *
 * Requests carrying `x-ceo-builder-key: <BUILDER_READ_KEY>` pass the site lock and the passkey check on exactly these
 * GET or HEAD reads, with the query shapes below, and nothing else:
 *   /api/haven-plan                 the floor plan
 *   /api/haven-meals                the meal planner file
 *   /api/haven-photos?id=<id>[&size=full] and ?view=catalog[&ids=a,b]   the Kitchen's meal photos
 *   /api/foundry-shot?id=shot-<hex>  a screenshot Skippy took of the page for a Foundry issue (#1027)
 * Any other method or path stays refused (the gate's usual 401, or a handler's own refusal when a write reaches it). The
 * key counts only when it is set, at least 32 characters, and different from every other key; it is compared in
 * constant time and never logged. Unset, the header does nothing.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const BUILDER_HEADER = "x-ceo-builder-key";
export const BUILDER_KEY = "BUILDER_READ_KEY";
/** The shortest builder key that counts: a shorter one is ignored. */
export const MIN_BUILDER_KEY = 32;

/** The settings the builder key may never equal: a copy of one of these would make it a master key. */
const OTHER_SECRETS = ["FOUNDRY_DESK_KEY", "SITE_BYPASS_TOKEN", "SITE_SESSION_SECRET", "DESK_PINGS_SECRET", "GMAIL_TOKEN_KEY", "SUBMIND_LOG_TOKEN", "SUBMIND_FEED_TOKEN", "HOME_TOKEN_KEY"] as const;

/** The private reads the key opens: path, and the query keys each may carry (any other key is refused). */
const READS: Readonly<Record<string, readonly string[]>> = {
  "/api/haven-plan": [],
  "/api/haven-meals": [],
  "/api/haven-photos": ["id", "size", "view", "ids"],
  // A screenshot Skippy took for a Foundry issue (#1027): the issue names it by its opaque id only.
  "/api/foundry-shot": ["id"],
};

function same(given: string, want: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/** The builder key from the environment, or null when it doesn't count (unset, short, or equal to another secret). */
export function builderKeyValue(env: Env): string | null {
  const want = env[BUILDER_KEY]?.trim();
  if (!want || want.length < MIN_BUILDER_KEY) return null;
  for (const name of OTHER_SECRETS) {
    const other = env[name]?.trim();
    if (other && same(other, want)) return null;
  }
  return want;
}

/** Whether the request is one of the reads the key opens (method, path, query), not looking at the key. */
export function isBuilderRead(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const url = new URL(request.url);
  const p = url.pathname;
  if (p.includes("%") || p.includes("..") || p.includes("//") || !Object.hasOwn(READS, p)) return false;
  const allowed = READS[p]!;
  const keys = [...url.searchParams.keys()];
  return new Set(keys).size === keys.length && keys.every((k) => allowed.includes(k));
}

/** For the gate and the three handlers: a valid builder key on one of its reads. */
export function builderReads(request: Request, env: Env): boolean {
  if (!isBuilderRead(request)) return false;
  const want = builderKeyValue(env);
  const given = request.headers.get(BUILDER_HEADER)?.trim();
  return Boolean(want && given && same(given, want));
}
