/**
 * The Foundry's read feed for the Desk and the Lattice, as a Vercel function. The browser used to ask GitHub
 * directly, but GitHub allows an anonymous visitor only 60 requests an hour, and a few reloads used that up, leaving
 * the Desk stuck on "Connecting to GitHub…". Here the four reads go out with the Foundry's token (5,000 an hour; api/_github.ts) and
 * the answer is cached at Vercel's edge for a few seconds, so every open tab shares one set of requests.
 *
 * A request with any query string is redirected to the bare URL so it hits the edge cache, and a warm function keeps
 * its last answer for the same few seconds (api/_feedcache.ts).
 *
 * GET → { issues, runs, pulls, commits }: the raw GitHub JSON the Desk parses (apps/world/src/foundry.ts).
 */

import { canonical, memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;

async function read(path: string): Promise<unknown> {
  const token = await githubToken("read");
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

/** Cache lifetime in seconds, for both the edge header and the in-function memo. */
const TTL = 5;

const feed = memo(TTL * 1000, async () => {
  const [issues, runs, pulls, commits] = await Promise.all([
    read("/issues?labels=foundry&state=all&sort=updated&per_page=40"),
    read("/actions/workflows/checks.yml/runs?branch=main&per_page=1").catch(() => ({ workflow_runs: [] })),
    read("/pulls?state=closed&sort=updated&direction=desc&per_page=20").catch(() => []),
    read("/commits?sha=main&per_page=40").catch(() => []),
  ]);
  return JSON.stringify({ issues, runs, pulls, commits });
});

export async function GET(req: Request): Promise<Response> {
  const redirect = canonical(req);
  if (redirect) return redirect;
  try {
    return new Response(await feed(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${TTL}, stale-while-revalidate=25` },
    });
  } catch {
    return new Response(JSON.stringify({ error: "github" }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
