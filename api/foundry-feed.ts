/**
 * The Foundry's read feed for the Desk and the Lattice, as a Vercel function. The browser used to ask GitHub
 * directly, but GitHub allows an anonymous visitor only 60 requests an hour, and a few reloads used that up, leaving
 * the Desk stuck on "Connecting to GitHub…". Here the four reads go out with the Foundry's token (5,000 an hour; api/_github.ts) and
 * the answer is cached at Vercel's edge for a few seconds, so every open tab shares one set of requests.
 *
 * A request with any query string is redirected to the bare URL so it hits the edge cache, and a warm function keeps
 * its last answer for the same few seconds (api/_feedcache.ts).
 *
 * The scheduled jobs on the Boiler Room's board (#301) come along as `jobs`: the newest scheduled run of each workflow
 * with a cron, plus Visual QA's newest push run, trimmed to the workflow's name, the run's state and times and its
 * link. Nothing else from the run leaves this function. They change at most hourly, so they are read every two minutes.
 *
 * GET → { issues, runs, e2e, live, pulls, commits, jobs }: the GitHub JSON the Desk parses (apps/world/src/foundry.ts,
 * apps/world/src/desk/jobs.ts).
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

/** The workflows on the Boiler Room's job board: every one with a `schedule:` trigger, and Visual QA (after each push). */
export const JOB_FILES = ["backup-azure.yml", "checks.yml", "e2e.yml", "world-step.yml", "desk-pings.yml", "live-watch.yml", "codeql.yml", "scorecard.yml", "visual-qa.yml"] as const;

/** How long the jobs' reads are kept, in seconds: the board's runs change at most hourly. */
const JOBS_TTL = 120;

/** One run on the job board: only its workflow's name, state, times and link. */
export interface JobRun {
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at: string | null;
  html_url: string;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The newest run from GitHub's list, cut down to what the board shows, or null when there is none. */
export function trimRun(list: unknown): JobRun | null {
  const run = (list as { workflow_runs?: unknown[] } | null)?.workflow_runs?.[0] as Record<string, unknown> | undefined;
  if (!run || typeof run !== "object") return null;
  const name = str(run.name);
  const status = str(run.status);
  const created = str(run.created_at);
  const url = str(run.html_url);
  if (!name || !status || !created || !url) return null;
  return { name, status, conclusion: str(run.conclusion), created_at: created, run_started_at: str(run.run_started_at), html_url: url };
}

const jobs = memo(JOBS_TTL * 1000, () =>
  Promise.all(
    JOB_FILES.map((file) =>
      read(`/actions/workflows/${file}/runs?${file === "visual-qa.yml" ? "branch=main&event=push" : "event=schedule"}&per_page=1`)
        .then((list) => ({ file, run: trimRun(list) }))
        .catch(() => ({ file, run: null })),
    ),
  ),
);

const feed = memo(TTL * 1000, async () => {
  const [issues, runs, e2e, live, pulls, commits, board] = await Promise.all([
    read("/issues?labels=foundry&state=all&sort=updated&per_page=40"),
    read("/actions/workflows/checks.yml/runs?branch=main&per_page=1").catch(() => ({ workflow_runs: [] })),
    read("/actions/workflows/e2e.yml/runs?branch=main&per_page=5").catch(() => ({ workflow_runs: [] })),
    read("/actions/workflows/live-watch.yml/runs?branch=main&per_page=1").catch(() => ({ workflow_runs: [] })),
    read("/pulls?state=closed&sort=updated&direction=desc&per_page=20").catch(() => []),
    read("/commits?sha=main&per_page=40").catch(() => []),
    jobs(),
  ]);
  return JSON.stringify({ issues, runs, e2e, live, pulls, commits, jobs: board });
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
