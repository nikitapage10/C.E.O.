/**
 * One small HTTP helper for the vendor clients (#632): JSON in and out, a timeout, and errors that carry no detail.
 * A vendor's answer can hold tokens, serials and account data, so nothing here logs it, and a failure is only ever
 * a fixed code ("vendor" with the HTTP status), never the body.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** How long one vendor call may take. */
export const VENDOR_TIMEOUT_MS = 10_000;

/** A vendor call failed: the HTTP status (0 for a network failure or timeout), and nothing else. */
export class VendorError extends Error {
  /** `resetAt`: on a 429, when the vendor says to ask again (epoch ms), if its headers say (#1077). */
  constructor(
    readonly status: number,
    readonly resetAt?: number,
  ) {
    super(`vendor call failed (${status})`);
    this.name = "VendorError";
  }
}

/** The JSON a vendor answered, or a VendorError. `okStatus` lists the statuses that still carry a JSON answer. */
export async function callJson(fetchFn: Fetch, url: string, init: RequestInit = {}, timeoutMs = VENDOR_TIMEOUT_MS): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new VendorError(0);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new VendorError(res.status, res.status === 429 ? resetOf(res.headers) : undefined);
  }
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new VendorError(res.status);
  }
}

/**
 * When a rate-limited vendor says to ask again (#1077): `Retry-After` (seconds or a date), or a reset time in
 * `X-RateLimit-Reset` / `API-RateLimit-Reset` (epoch seconds or ms). Undefined when none says.
 */
export function resetOf(h: Headers, now = Date.now()): number | undefined {
  const ra = h.get("retry-after");
  if (ra) {
    const s = Number(ra);
    if (Number.isFinite(s) && s >= 0) return now + s * 1000;
    const d = Date.parse(ra);
    if (Number.isFinite(d)) return d;
  }
  for (const k of ["x-ratelimit-reset", "api-ratelimit-reset"]) {
    const v = Number(h.get(k));
    if (Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  }
  return undefined;
}

/** A URL with its query string, from a map of plain values. */
export function withQuery(base: string, query: Record<string, string | number>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
  return u.toString();
}
