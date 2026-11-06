/**
 * The Skippy probe's key (#955): its path and its token, apart from api/_skippy/probe.ts so the site gate (which also
 * runs as Vercel's middleware) loads nothing else of Skippy's.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** The probe's own path; on Vercel vercel.json rewrites it to /api/skippy?probe=1. */
export const PROBE_PATH = "/api/skippy-probe";
/** The setting that holds the probe's token. */
export const PROBE_TOKEN = "SKIPPY_PROBE_TOKEN";
/** The shortest token that counts, as for the site's other machine keys. */
export const MIN_PROBE_TOKEN = 32;
/** The settings the probe's token may never equal: a copy of one of these would let it open more than the probe. */
const OTHER_SECRETS = ["FOUNDRY_DESK_KEY", "SITE_BYPASS_TOKEN", "SITE_SESSION_SECRET", "DESK_PINGS_SECRET", "GMAIL_TOKEN_KEY", "SUBMIND_LOG_TOKEN", "SUBMIND_FEED_TOKEN", "BUILDER_READ_KEY", "HOME_TOKEN_KEY"] as const;

/** The probe's token, or "" when it isn't set, is too short to count, or copies another secret. */
export function probeToken(env: Record<string, string | undefined>): string {
  const t = env[PROBE_TOKEN]?.trim() ?? "";
  if (t.length < MIN_PROBE_TOKEN) return "";
  return OTHER_SECRETS.some((n) => env[n]?.trim() === t) ? "" : t;
}

/** Whether a request is the probe's. */
export function isProbe(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === PROBE_PATH || url.searchParams.has("probe");
}

