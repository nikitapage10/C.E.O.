/**
 * The Foundry's read feed for the Desk and the Lattice, as a Vercel function. The browser used to ask GitHub
 * directly, but GitHub allows an anonymous visitor only 60 requests an hour, and a few reloads used that up, leaving
 * the Desk stuck on "Connecting to GitHub…". Here the four reads go out with the Foundry's token (5,000 an hour) and
 * the answer is cached at Vercel's edge for a few seconds, so every open tab shares one set of requests.
 *
 * GET → { issues, runs, pulls, commits }: the raw GitHub JSON the Desk parses (apps/world/src/foundry.ts).
 */

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;

const env = (name: string): string => process.env[name] ?? "";

async function read(path: string): Promise<unknown> {
  const token = env("FOUNDRY_GITHUB_TOKEN");
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export async function GET(): Promise<Response> {
  try {
    const [issues, runs, pulls, commits] = await Promise.all([
      read("/issues?labels=foundry&state=all&sort=updated&per_page=40"),
      read("/actions/workflows/checks.yml/runs?branch=main&per_page=1").catch(() => ({ workflow_runs: [] })),
      read("/pulls?state=closed&sort=updated&direction=desc&per_page=20").catch(() => []),
      read("/commits?sha=main&per_page=40").catch(() => []),
    ]);
    return new Response(JSON.stringify({ issues, runs, pulls, commits }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=5, stale-while-revalidate=25" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "github" }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
