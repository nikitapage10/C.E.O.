/**
 * Shared by the Desk's two read feeds (api/foundry-feed.ts, api/foundry-usage.ts). Vercel's edge cache keys on the
 * whole URL, so a made-up query string like `?z=123` always missed it and cost GitHub reads from the Foundry's token
 * (5,000 an hour, shared with the Desk buttons and the world step). Two guards here: an unknown query is sent to the
 * canonical URL so the edge answers from its copy, and a warm function remembers its last answer for a short while
 * and lets simultaneous requests share one read.
 */

/** A 308 to the same path with no query when the request carries any, else null. The feeds take no parameters. */
export function canonical(req: Request): Response | null {
  const url = new URL(req.url);
  if (!url.search) return null;
  return new Response(null, { status: 308, headers: { Location: url.pathname, "Cache-Control": "public, s-maxage=3600" } });
}

/** Remembers one answer for `ttlMs`, and hands every caller during a read the same promise. A failed read isn't kept. */
export function memo<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let kept: { at: number; value: T } | null = null;
  let flying: Promise<T> | null = null;
  return () => {
    if (kept && Date.now() - kept.at < ttlMs) return Promise.resolve(kept.value);
    flying ??= load()
      .then((value) => {
        kept = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        flying = null;
      });
    return flying;
  };
}
