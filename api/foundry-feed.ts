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
 * The open pull requests come along as `open` (#432): each one's number, link, when it opened, whether it is a draft,
 * the issue it works on (from its branch or a "Closes #n") and its checks summed up to one state, read from its head
 * commit's check runs. Nothing else from the pull request (no title, no body) leaves this function. They are read every
 * 30 seconds, so the Foundry page sees a job's pull request open and its checks go green.
 *
 * Build progress (#488) comes along as `branches` (the issues with a pushed `chat/` or `foundry/` branch, numbers only)
 * and `timings`: for the recently merged pull requests, only when each milestone happened (first commit, opened, checks
 * started, checks green, merged, deployed by Deploy to Azure), so the Desk can measure how long each step takes. The
 * open pull requests carry their own checks' start and finish times too. Read every ten minutes; branches every 30 s.
 *
 * GET → { issues, runs, e2e, live, pulls, commits, jobs, open, branches, timings }: the GitHub JSON the Desk parses (apps/world/src/foundry.ts,
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

/** How long the open pull requests and their checks are kept, in seconds. */
const OPEN_TTL = 30;
/** The most open pull requests whose checks are read (the crew runs four jobs at once). */
const OPEN_CHECKED = 6;

export type PullChecks = "pass" | "fail" | "running" | "unknown";

/** One open pull request, as the Foundry page reads it: no title and no body. */
export interface OpenPull {
  number: number;
  html_url: string;
  created_at: string;
  draft: boolean;
  /** The issue it works on: its branch's number ("chat/432-foundry-fit"), else a "Closes #n" in its title or body. */
  issue: number | null;
  checks: PullChecks;
  /** When its head commit's first check started, and when the last one finished green (null until then; #488). */
  checksAt?: string | null;
  greenAt?: string | null;
}

/** The issue a pull request works on, from its branch name or a closing keyword; null when it names none. */
export function linkedIssue(ref: string, text: string): number | null {
  const b = /(?:^|\/)(\d+)-/.exec(ref)?.[1];
  if (b) return Number(b);
  const c = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(text)?.[1];
  return c ? Number(c) : null;
}

/** A head commit's check runs summed up: any failed is red, any still going is running, all done and fine is green. */
export function checksOf(list: unknown): PullChecks {
  const runs = (list as { check_runs?: unknown[] } | null)?.check_runs;
  if (!Array.isArray(runs) || !runs.length) return "unknown";
  let running = false;
  for (const r of runs as Record<string, unknown>[]) {
    const c = str(r.conclusion);
    if (c && ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(c)) return "fail";
    if (str(r.status) !== "completed") running = true;
  }
  return running ? "running" : "pass";
}

/** When a head commit's checks started (the earliest run), and when they all finished green (the latest), or null. */
export function checkTimes(list: unknown): { checksAt: string | null; greenAt: string | null } {
  const runs = (list as { check_runs?: unknown[] } | null)?.check_runs;
  if (!Array.isArray(runs) || !runs.length) return { checksAt: null, greenAt: null };
  let start: string | null = null;
  let end: string | null = null;
  for (const r of runs as Record<string, unknown>[]) {
    const a = str(r.started_at);
    const b = str(r.completed_at);
    if (a && (!start || a < start)) start = a;
    if (b && (!end || b > end)) end = b;
  }
  return { checksAt: start, greenAt: checksOf(list) === "pass" ? end : null };
}

/** The issues with a pushed branch in the Foundry's naming ("chat/488-…", "foundry/build/30-…"): numbers only. */
export function branchIssues(list: unknown): number[] {
  const out = new Set<number>();
  for (const b of Array.isArray(list) ? (list as Record<string, unknown>[]) : []) {
    const n = /^(?:chat|foundry\/[a-z]+)\/(\d+)-/.exec(str(b.name) ?? "")?.[1];
    if (n) out.add(Number(n));
  }
  return [...out].sort((a, b) => a - b);
}

/** One merged pull request's milestones, as ISO times (null where GitHub didn't say): no title, no body, no branch. */
export interface PullTiming {
  issue: number | null;
  pushed: string | null;
  opened: string;
  checksAt: string | null;
  greenAt: string | null;
  merged: string;
  deployed: string | null;
}

/** The most merged pull requests measured. */
const TIMED = 12;

/**
 * The recently merged pull requests' milestones: its first commit (the branch pushed), when it opened, when its head's
 * checks started and finished green, when it merged, and when Deploy to Azure finished shipping its merge commit.
 */
export async function readTimings(closed: unknown, firstCommit: (n: number) => Promise<unknown>, checks: (sha: string) => Promise<unknown>, deploys: unknown): Promise<PullTiming[]> {
  const pulls = (Array.isArray(closed) ? (closed as Record<string, unknown>[]) : []).filter((p) => str(p.merged_at) && str(p.created_at) && typeof p.number === "number").slice(0, TIMED);
  const runs = ((deploys as { workflow_runs?: unknown[] } | null)?.workflow_runs ?? []) as Record<string, unknown>[];
  return Promise.all(
    pulls.map(async (p): Promise<PullTiming> => {
      const head = (p.head ?? {}) as Record<string, unknown>;
      const sha = str(head.sha);
      const merge = str(p.merge_commit_sha);
      const [first, list] = await Promise.all([firstCommit(p.number as number).catch(() => null), sha && /^[0-9a-f]{7,40}$/.test(sha) ? checks(sha).catch(() => null) : Promise.resolve(null)]);
      const c = (Array.isArray(first) ? (first[0] as { commit?: { committer?: { date?: unknown } } } | undefined) : undefined)?.commit?.committer?.date;
      const deploy = runs.find((r) => merge && r.head_sha === merge && r.conclusion === "success");
      return { issue: linkedIssue(str(head.ref) ?? "", `${str(p.title) ?? ""}\n${str(p.body) ?? ""}`), pushed: str(c), opened: p.created_at as string, ...checkTimes(list), merged: p.merged_at as string, deployed: deploy ? str(deploy.updated_at) : null };
    }),
  );
}

/** GitHub's open pull requests cut down to what the page shows, newest first, each with its checks. */
export async function readOpen(list: unknown, checks: (sha: string) => Promise<unknown>): Promise<OpenPull[]> {
  const pulls = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  const out: OpenPull[] = [];
  for (const p of pulls) {
    const number = typeof p.number === "number" ? p.number : null;
    const url = str(p.html_url);
    const created = str(p.created_at);
    const head = (p.head ?? {}) as Record<string, unknown>;
    if (number === null || !url || !created) continue;
    out.push({ number, html_url: url, created_at: created, draft: p.draft === true, issue: linkedIssue(str(head.ref) ?? "", `${str(p.title) ?? ""}\n${str(p.body) ?? ""}`), checks: "unknown", checksAt: null, greenAt: null });
  }
  await Promise.all(
    out.slice(0, OPEN_CHECKED).map(async (o, i) => {
      const sha = str(((pulls.find((p) => p.number === o.number)?.head ?? {}) as Record<string, unknown>).sha);
      if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return;
      const list = await checks(sha).catch(() => null);
      out[i] = { ...o, checks: checksOf(list), ...checkTimes(list) };
    }),
  );
  return out;
}

const openPulls = memo(OPEN_TTL * 1000, async () =>
  readOpen(
    await read("/pulls?state=open&sort=created&direction=desc&per_page=12").catch(() => []),
    (sha) => read(`/commits/${sha}/check-runs?per_page=50`),
  ),
);

/** The pushed branches, for build progress (#488): read with the open pull requests. */
const branches = memo(OPEN_TTL * 1000, async () => branchIssues(await read("/branches?per_page=100").catch(() => [])));

/** How long the merged pull requests' milestones are kept, in seconds: they never change once read. */
const TIMINGS_TTL = 600;

const timings = memo(TIMINGS_TTL * 1000, async () => {
  const [closed, deploys] = await Promise.all([read("/pulls?state=closed&sort=updated&direction=desc&per_page=30"), read("/actions/workflows/deploy-azure.yml/runs?branch=main&per_page=40").catch(() => ({ workflow_runs: [] }))]);
  return readTimings(
    closed,
    (n) => read(`/pulls/${n}/commits?per_page=1`),
    (sha) => read(`/commits/${sha}/check-runs?per_page=50`),
    deploys,
  );
});

const feed = memo(TTL * 1000, async () => {
  const [issues, runs, e2e, live, pulls, commits, board, prs, pushed, timed] = await Promise.all([
    read("/issues?labels=foundry&state=all&sort=updated&per_page=40"),
    read("/actions/workflows/checks.yml/runs?branch=main&per_page=1").catch(() => ({ workflow_runs: [] })),
    read("/actions/workflows/e2e.yml/runs?branch=main&per_page=5").catch(() => ({ workflow_runs: [] })),
    read("/actions/workflows/live-watch.yml/runs?branch=main&per_page=1").catch(() => ({ workflow_runs: [] })),
    read("/pulls?state=closed&sort=updated&direction=desc&per_page=20").catch(() => []),
    read("/commits?sha=main&per_page=40").catch(() => []),
    jobs(),
    openPulls().catch((): OpenPull[] => []),
    branches().catch((): number[] => []),
    timings().catch((): PullTiming[] => []),
  ]);
  return JSON.stringify({ issues, runs, e2e, live, pulls, commits, jobs: board, open: prs, branches: pushed, timings: timed });
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
